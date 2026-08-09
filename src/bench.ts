// The bench. Dev-server only — see bench.html.
//
// Everything here reports wall time AND main-thread blocking, because on this
// problem they are different questions. A pass that takes four minutes off the
// page is a success; a pass that takes three minutes on it is a failure however
// fast it is.

import { readCollectionIndex } from './lib/collection.ts'
import { openCollection } from './lib/collection-source.ts'
import { isSuperseded, runJob } from './lib/engine.ts'
import { makeChunkCache, readGenes } from './lib/chunked.ts'
import { planChunks } from './lib/part-scan.ts'
import { deMarkersAllAsync, markersSpec } from './lib/stats.ts'
import type { Source } from './lib/source.ts'
import type { DEResult } from './lib/stats.ts'

const out = document.getElementById('log') as HTMLPreElement
const log = (s: string) => { out.textContent += s + '\n'; console.log(s) }
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * How blocked the page was.
 *
 * A timer asked to fire every 16 ms cannot fire while the main thread is inside
 * a loop, so the gaps it records ARE the jank, measured the way a user feels it.
 */
function heartbeat() {
  let last = performance.now()
  let worst = 0
  let stalls = 0
  let ticks = 0
  const h = setInterval(() => {
    const now = performance.now()
    const gap = now - last
    last = now
    ticks++
    if (gap > 100) stalls++
    if (gap > worst) worst = gap
  }, 16)
  return {
    stop() {
      clearInterval(h)
      return { worst, stalls, ticks }
    },
  }
}

let src: Source | null = null

const need = (): Source => {
  if (!src) throw new Error('open a collection first')
  return src
}

document.getElementById('open')!.addEventListener('click', async () => {
  const file = (document.getElementById('file') as HTMLInputElement).files?.[0]
  if (!file) { log('choose a file'); return }
  const t0 = performance.now()
  const index = await readCollectionIndex(file)
  if (!index) { log('not a collection'); return }
  src = await openCollection(file, index, (phase, done, total) => {
    if (done === total) log(`  ${phase}: ${done}/${total}`)
  })
  log(`opened in ${secs(performance.now() - t0)} — ${src.d.nCells.toLocaleString()} cells, `
    + `${src.genes.length.toLocaleString()} genes, ${src.types.length} clusters, ${src.nParts} parts`)
  const plan = src.remote!.plan
  log(`  ${planChunks(plan)} chunks of ${plan.chunkGenes} genes, per part`)
})

/** Shape A: the worker opens the file and does everything. */
async function shapeA(): Promise<DEResult[]> {
  const s = need()
  const hb = heartbeat()
  const t0 = performance.now()
  let lastPct = -1
  let messages = 0
  const running = runJob<'markers'>(s, { kind: 'markers', ...markersSpec(s, null) },
    (phase, done, total) => {
      messages++
      const pct = Math.floor((100 * done) / total / 10) * 10
      if (pct !== lastPct) { lastPct = pct; log(`  ${phase} ${pct}%  ${secs(performance.now() - t0)}`) }
    })!
  const res = await running.promise
  const ms = performance.now() - t0
  const b = hb.stop()
  log(`SHAPE A — worker reads the file`)
  log(`  total ${secs(ms)}`)
  log(`  main thread: worst gap ${b.worst.toFixed(0)} ms, ${b.stalls} gaps over 100 ms in ${b.ticks} ticks`)
  log(`  progress messages: ${messages}`)
  log(`  rows: ${res.reduce((n, r) => n + r.rows.length, 0).toLocaleString()} across ${res.length} clusters`)
  return res
}

/**
 * Shape B: the page reads every gene and posts the vectors to a worker.
 *
 * Only the sending side is timed, because only the sending side is on the main
 * thread — and that is the whole question. The statistics are not run at all
 * here, so this is a LOWER BOUND on what shape B would cost the page.
 */
async function shapeB() {
  const s = need()
  const plan = s.remote!.plan
  const file = s.remote!.file
  const w = new Worker(new URL('./bench-worker.ts', import.meta.url), { type: 'module' })
  const hb = heartbeat()
  const t0 = performance.now()

  const scratch = plan.parts.map(() => makeChunkCache(1))
  const getBytes = plan.parts.map(p => async (from: number, to: number) =>
    new Uint8Array(await file.slice(p.base + from, p.base + to).arrayBuffer()))
  const nChunks = planChunks(plan)
  let bytes = 0
  let readMs = 0
  let postMs = 0
  const idxs: number[] = []

  for (let k = 0; k < nChunks; k++) {
    const lo = k * plan.chunkGenes
    const hi = Math.min(plan.nGenes, lo + plan.chunkGenes)
    idxs.length = 0
    for (let g = lo; g < hi; g++) idxs.push(g)

    const r0 = performance.now()
    const perPart = await Promise.all(plan.parts.map((p, pi) =>
      readGenes(getBytes[pi], p.chunkptr, p.indptr, p.chunkGenes, idxs, scratch[pi])))
    readMs += performance.now() - r0

    // Flatten to what a compute worker would need: cells and values per gene.
    const p0 = performance.now()
    const payload: { cells: Int32Array; values: Float32Array }[] = []
    const transfer: Transferable[] = []
    for (const part of perPart) {
      for (const v of part) {
        payload.push({ cells: v.cells, values: v.values })
        bytes += v.cells.byteLength + v.values.byteLength
        transfer.push(v.cells.buffer as Transferable, v.values.buffer as Transferable)
      }
    }
    w.postMessage({ cmd: 'batch', parts: payload }, transfer)
    postMs += performance.now() - p0
    if (k % 50 === 0) log(`  chunk ${k}/${nChunks}  ${secs(performance.now() - t0)}`)
  }

  const ms = performance.now() - t0
  const b = hb.stop()
  const counted = await new Promise<{ values: number; batches: number }>(res => {
    w.addEventListener('message', e => res(e.data as { values: number; batches: number }), { once: true })
    w.postMessage({ cmd: 'total' })
  })
  w.terminate()
  log(`SHAPE B — page reads, posts vectors in (statistics NOT run: a lower bound)`)
  log(`  total ${secs(ms)} — reading+inflating ${secs(readMs)}, packing+postMessage ${secs(postMs)}`)
  log(`  main thread: worst gap ${b.worst.toFixed(0)} ms, ${b.stalls} gaps over 100 ms in ${b.ticks} ticks`)
  log(`  moved ${(bytes / 1e9).toFixed(2)} GB in ${counted.batches.toLocaleString()} messages `
    + `(${counted.values.toLocaleString()} stored values)`)
}

/** What the studio does today: everything on the page. */
async function oldPath(): Promise<DEResult[]> {
  const s = need()
  const hb = heartbeat()
  const t0 = performance.now()
  let lastPct = -1
  const res = await deMarkersAllAsync(s, null, (done, total) => {
    const pct = Math.floor((100 * done) / total / 10) * 10
    if (pct !== lastPct) { lastPct = pct; log(`  ${pct}%  ${secs(performance.now() - t0)}`) }
  })
  const ms = performance.now() - t0
  const b = hb.stop()
  log(`MAIN-THREAD PATH (what is deployed today)`)
  log(`  total ${secs(ms)}`)
  log(`  main thread: worst gap ${b.worst.toFixed(0)} ms, ${b.stalls} gaps over 100 ms in ${b.ticks} ticks`)
  log(`  rows: ${res.reduce((n, r) => n + r.rows.length, 0).toLocaleString()} across ${res.length} clusters`)
  return res
}

/**
 * Supersession: the withdrawn question must never answer.
 *
 * A pass is started, cancelled part-way, and another started in its place. What
 * is asserted is not "the first one was ignored" but that it had nowhere to
 * land: its promise ends as superseded and stays that way, checked again well
 * after the worker could possibly have finished it. Run on a small collection so
 * the whole race takes a second.
 */
async function race() {
  const s = need()
  const t0 = performance.now()
  let first = 'still pending'
  const a = runJob<'markers'>(s, { kind: 'markers', ...markersSpec(s, null) }, () => {})!
  a.promise.then(
    () => { first = 'RESOLVED — a superseded answer reached the page' },
    (e: unknown) => { first = isSuperseded(e) ? 'superseded' : `error: ${String(e)}` })

  await new Promise(r => setTimeout(r, 120))
  a.cancel()
  const b = runJob<'markers'>(s, { kind: 'markers', ...markersSpec(s, null) }, () => {})!
  const res = await b.promise
  const secondMs = performance.now() - t0
  // Long after anything the first pass could still be doing.
  await new Promise(r => setTimeout(r, 4000))
  log('SUPERSESSION')
  log(`  the withdrawn pass: ${first}`)
  log(`  the replacement: ${res.reduce((n, r) => n + r.rows.length, 0).toLocaleString()} rows `
    + `across ${res.length} clusters, in ${secs(secondMs)} from the start of the first`)
  log(`  verdict: ${first === 'superseded' ? 'nothing stale could land' : 'BROKEN'}`)
  return first === 'superseded'
}

/** The only check that matters: the same rows, in the same order, to the digit. */
function compare(a: DEResult[], b: DEResult[]): string {
  if (a.length !== b.length) return `different cluster count: ${a.length} vs ${b.length}`
  let rows = 0
  for (let c = 0; c < a.length; c++) {
    if (a[c].n0 !== b[c].n0 || a[c].n1 !== b[c].n1) return `cluster ${c}: group sizes differ`
    if (a[c].rows.length !== b[c].rows.length) {
      return `cluster ${c}: ${a[c].rows.length} rows vs ${b[c].rows.length}`
    }
    for (let i = 0; i < a[c].rows.length; i++) {
      const x = a[c].rows[i]
      const y = b[c].rows[i]
      if (x.gene !== y.gene) return `cluster ${c} row ${i}: ${x.gene} vs ${y.gene}`
      for (const f of ['lfc', 'p', 'padj', 'pct1', 'pct2'] as const) {
        if (!Object.is(x[f], y[f])) {
          return `cluster ${c} row ${i} (${x.gene}): ${f} ${String(x[f])} vs ${String(y[f])}`
        }
      }
      rows++
    }
  }
  return `IDENTICAL — ${rows.toLocaleString()} rows, every field bit for bit`
}

document.getElementById('shapeA')!.addEventListener('click', () => { void shapeA() })
document.getElementById('shapeB')!.addEventListener('click', () => { void shapeB() })
document.getElementById('oldPath')!.addEventListener('click', () => { void oldPath() })
document.getElementById('compare')!.addEventListener('click', async () => {
  const a = await shapeA()
  const b = await oldPath()
  log(`NUMBERS: ${compare(a, b)}`)
})

// So a browser probe can drive this without clicking.
Object.assign(window, {
  bench: {
    open: async (file: File) => {
      const index = await readCollectionIndex(file)
      src = await openCollection(file, index!)
      return { cells: src.d.nCells, genes: src.genes.length, clusters: src.types.length }
    },
    shapeA, shapeB, oldPath, compare, race,
    text: () => out.textContent,
  },
})
