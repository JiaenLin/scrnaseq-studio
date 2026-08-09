// Talking to the compute worker.
//
// The one thing this file has to get right is that a stale answer can never be
// shown. Switching cell type or contrast mid-computation abandons the old
// question; if the old answer could still land, the studio would display
// numbers for a comparison the user is no longer looking at — wrong numbers,
// silently, which is far worse than being slow.
//
// So delivery is a lookup, not a check. `pending` maps a job id to the only
// route a result has to the page. `cancel()` deletes the entry synchronously,
// before any await, and rejects the caller itself. When the worker's `done`
// arrives a moment later there is no entry, so there is nowhere for it to go —
// not "we remembered to ignore it", but "there is no code path that could
// deliver it". Adding a job kind cannot reintroduce the bug, because no job kind
// gets to touch this.
//
// One worker per open object, replaced when a different object is opened. It
// holds the Blob and the gene offsets — a few megabytes — so re-mounting per
// question would be paid for on every tab switch.

import type { Source } from './source.ts'
import type { FromWorker, Job, JobResult, ResultOf, ToWorker } from './jobs.ts'
import { decodeTable } from './jobs.ts'

/** A running job: its answer, and the ability to withdraw the question. */
export interface Running<T> {
  promise: Promise<T>
  cancel: () => void
}

/** Thrown into a superseded job's promise. Never surfaced to the user. */
export class Superseded extends Error {
  constructor() { super('this computation was superseded') }
}

export const isSuperseded = (e: unknown): boolean => e instanceof Superseded

interface Entry {
  onProgress: (phase: string, done: number, total: number) => void
  settle: (r: FromWorker & { event: 'done' | 'error' }) => void
}

class Engine {
  private worker: Worker
  private pending = new Map<number, Entry>()
  private next = 1
  private fatal: string | null = null

  readonly src: Source

  constructor(src: Source, file: Blob, plan: NonNullable<Source['remote']>['plan']) {
    this.src = src
    this.worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
      const d = e.data
      const entry = this.pending.get(d.id)
      // No entry means the question was withdrawn. There is nothing to deliver
      // to, which is the whole of the staleness guarantee.
      if (!entry) return
      if (d.event === 'progress') { entry.onProgress(d.phase, d.done, d.total); return }
      this.pending.delete(d.id)
      entry.settle(d)
    })
    this.worker.addEventListener('error', (ev: ErrorEvent) => {
      // A worker that dies never answers, and without this every view waits
      // behind a progress bar that will never move. The failure is remembered so
      // that jobs asked for AFTER it fail immediately too, rather than each one
      // discovering the silence for itself.
      this.fatal = `the compute worker failed: ${ev.message || 'no reason given'}`
      this.failAll(this.fatal)
    })
    this.send({ cmd: 'mount', file, plan })
  }

  private send(m: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer)
  }

  private failAll(message: string) {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id)
      entry.settle({ id, event: 'error', message })
    }
  }

  run<K extends Job['kind']>(
    job: Extract<Job, { kind: K }>,
    onProgress: (phase: string, done: number, total: number) => void,
  ): Running<ResultOf[K]> {
    if (this.fatal) {
      const message = this.fatal
      return { promise: Promise.reject(new Error(message)), cancel: () => {} }
    }
    const id = this.next++
    const genes = this.src.genes
    let cancel = () => {}
    const promise = new Promise<ResultOf[K]>((resolve, reject) => {
      this.pending.set(id, {
        onProgress,
        settle: (d) => {
          if (d.event === 'error') { reject(new Error(d.message)); return }
          resolve(deliver(genes, d.result) as ResultOf[K])
        },
      })
      cancel = () => {
        // Delete first. Everything after this is best-effort: the worker is told
        // so it can stop burning CPU, and the caller is told so its promise does
        // not dangle — but the result is already undeliverable.
        if (!this.pending.delete(id)) return
        this.send({ cmd: 'cancel', id })
        reject(new Superseded())
      }
    })
    this.send({ cmd: 'run', id, job }, jobBuffers(job))
    return { promise, cancel }
  }

  close() {
    this.worker.terminate()
    this.fatal = 'this object was closed'
    this.failAll(this.fatal)
  }
}

/**
 * The one place a raw result becomes what a view renders.
 *
 * The DE kinds get their gene names attached here, on the page, because that is
 * the only side that has them. The per-cell kinds are already in their final
 * form — a value per gene or a value per cell — and are passed straight through.
 */
function deliver(genes: readonly string[], r: JobResult): ResultOf[Job['kind']] {
  switch (r.kind) {
    case 'markers': return r.tables.map(t => decodeTable(genes, t))
    case 'wilcox': return decodeTable(genes, r.table)
    case 'averages': return r.avg
    case 'score': return r.scores
  }
}

/** The job's arrays move rather than copy; the caller must not reuse them. */
function jobBuffers(job: Job): Transferable[] {
  switch (job.kind) {
    case 'markers': return [job.owner.buffer as Transferable, job.size.buffer as Transferable]
    case 'wilcox': return [job.lab.buffer as Transferable]
    case 'averages': return []
    case 'score': return [job.weight.buffer as Transferable]
  }
}

/**
 * One engine, for the object currently open.
 *
 * The studio shows one object at a time, so a second one means the first is
 * gone: its worker is terminated rather than left holding a 5.8 GB file handle.
 */
let live: Engine | null = null

function engineFor(src: Source): Engine | null {
  if (!src.remote) return null
  if (live?.src === src) return live
  live?.close()
  live = new Engine(src, src.remote.file, src.remote.plan)
  return live
}

/**
 * Ask the worker a question about the object.
 *
 * Returns null when this object's values are already in memory — there is no
 * worker for those and there should not be one, because copying the matrix into
 * a second thread costs more than the answer.
 */
export function runJob<K extends Job['kind']>(
  src: Source,
  job: Extract<Job, { kind: K }>,
  onProgress: (phase: string, done: number, total: number) => void,
): Running<ResultOf[K]> | null {
  return engineFor(src)?.run(job, onProgress) ?? null
}
