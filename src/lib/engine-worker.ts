/// <reference lib="webworker" />
//
// The whole-transcriptome tests run here, not on the page.
//
// The work is a forward pass over the matrix: read a chunk, inflate it, fold
// every gene in it into a result row, drop the bytes. On the atlas that is
// 31 053 genes across 43 parts and about four minutes of solid CPU, and on the
// page four minutes of solid CPU is four minutes with no cursor and no scroll.
//
// The worker reads the FILE ITSELF. A Blob crosses to a worker by reference, so
// nothing is copied to get it here, and `chunked.ts` turns "chunk k of part p"
// into one byte range — the same code the page uses. The alternative, the page
// reading vectors and posting them in, was measured and is strictly worse: it
// leaves the inflate (which is most of the cost) on the main thread, which is
// the thing this file exists to get off it. See scripts/README of the bench, and
// the numbers in the commit message.
//
// One job at a time, and always the newest one. A job that is superseded stops
// at the next chunk boundary and never posts a result; the page has already
// stopped listening for it.

import {
  encodeTable, tableBuffers,
  type FromWorker, type Job, type JobResult, type ToWorker,
} from './jobs.ts'
import { scanMatrix, type MatrixPlan } from './part-scan.ts'
import { averagesPlan, scoreAccumPlan } from './score.ts'
import { markersPlan, wilcoxPlan } from './stats.ts'

const post = (m: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer)

let file: Blob | null = null
let plan: MatrixPlan | null = null

/** Ids the page has withdrawn. Checked at every chunk boundary. */
const dropped = new Set<number>()
/** Jobs waiting their turn, oldest first. */
const queue: { id: number; job: Job }[] = []
let busy = false

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.cmd === 'mount') {
    file = m.file
    plan = m.plan
    return
  }
  if (m.cmd === 'cancel') {
    // Enough on its own: a running job sees this at its next chunk boundary and
    // stops, and a waiting one is skipped when its turn comes.
    dropped.add(m.id)
    return
  }
  queue.push({ id: m.id, job: m.job })
  void pump()
}

/**
 * One job at a time, in the order asked, and every one of them accounted for.
 *
 * Deciding here that a new job supersedes an old one would be the wrong place to
 * decide it: the page knows which questions are still being asked and this does
 * not, and a job silently dropped here is a view left waiting behind a progress
 * bar that will never move. So nothing is dropped that the page did not cancel.
 * Supersession is the page's business, and it cancels before it asks again.
 */
async function pump(): Promise<void> {
  if (busy) return
  busy = true
  try {
    while (queue.length) {
      const { id, job } = queue.shift()!
      if (dropped.delete(id)) continue
      try {
        await run(id, job)
      } catch (err) {
        if (!dropped.has(id)) {
          post({ id, event: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      }
      dropped.delete(id)
    }
  } finally {
    busy = false
  }
}

/**
 * Progress, rate-limited by the clock rather than by the work.
 *
 * A chunk is 64 genes and lands every few hundred milliseconds, so posting per
 * chunk would be fine — but a small object, or a warm cache, can deliver
 * hundreds a second, and a flood of messages is the page doing layout instead of
 * scrolling. One every 150 ms is smooth to a human and invisible to the machine.
 */
function reporter(id: number, phase: string) {
  let last = 0
  return (done: number, total: number) => {
    const now = performance.now()
    if (done < total && now - last < 150) return
    last = now
    post({ id, event: 'progress', phase, done, total })
  }
}

/**
 * What the bar should say while this job runs.
 *
 * A module score reads the object twice and the two passes are not the same
 * work, so they are named separately rather than both called "testing every
 * gene" — a bar that returns to zero without explaining itself reads as a
 * restart, which is exactly the kind of dishonesty the progress card exists to
 * avoid.
 */
const PHASE: Record<Job['kind'], string> = {
  markers: 'testing every gene',
  wilcox: 'testing every gene',
  averages: 'expression bins',
  score: 'module score',
}

async function run(id: number, job: Job): Promise<void> {
  if (!file || !plan) throw new Error('the compute worker was asked to run before it was given a file')
  const gone = () => dropped.has(id)
  const phase = PHASE[job.kind]
  const report = reporter(id, phase)
  post({ id, event: 'progress', phase, done: 0, total: plan.nGenes })

  let result: JobResult
  if (job.kind === 'averages') {
    const p = averagesPlan(job)
    await scanMatrix(file, plan, p.visit, report, gone)
    if (gone()) return
    result = { kind: 'averages', avg: p.done() }
  } else if (job.kind === 'score') {
    const p = scoreAccumPlan(job)
    await scanMatrix(file, plan, p.visit, report, gone)
    if (gone()) return
    result = { kind: 'score', scores: p.done() }
  } else if (job.kind === 'markers') {
    const p = markersPlan(job)
    if (p.empty) {
      result = { kind: 'markers', tables: [] }
    } else {
      await scanMatrix(file, plan, p.visit, report, gone)
      if (gone()) return
      // The sort is the last of the work and it is not free on 133 tables, so it
      // gets its own phase rather than a bar that sits at 100 % saying nothing.
      post({ id, event: 'progress', phase: 'ranking', done: plan.nGenes, total: plan.nGenes })
      result = { kind: 'markers', tables: p.done().map(encodeTable) }
    }
  } else {
    const p = wilcoxPlan(job)
    if (p.empty) {
      result = { kind: 'wilcox', table: encodeTable({ rows: [], n0: p.n0, n1: p.n1 }) }
    } else {
      await scanMatrix(file, plan, p.visit, report, gone)
      if (gone()) return
      post({ id, event: 'progress', phase: 'ranking', done: plan.nGenes, total: plan.nGenes })
      result = { kind: 'wilcox', table: encodeTable(p.done()) }
    }
  }

  // Checked once more here rather than trusted: everything above is async, and
  // this is the last instant at which the page's answer is still the one it
  // asked for.
  if (gone()) return
  post({ id, event: 'done', result }, resultBuffers(result))
}

/** Every buffer in a result, so the answer moves rather than copies. */
function resultBuffers(r: JobResult): Transferable[] {
  switch (r.kind) {
    case 'markers': return r.tables.flatMap(tableBuffers) as Transferable[]
    case 'wilcox': return tableBuffers(r.table) as Transferable[]
    case 'averages': return [r.avg.buffer as Transferable]
    case 'score': return [r.scores.buffer as Transferable]
  }
}
