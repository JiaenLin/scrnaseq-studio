// Proving the contrast tabs did not change their answer when they moved off the page.
//
// Dev/bench only — see bench.html. A sibling of bench.ts rather than an
// addition to it: that file measures FindAllMarkers and belongs to the engine,
// this one answers the only question the DEG table, the volcano and enrichment
// have to answer before they are allowed to use it — are the numbers the same?
//
// "The same" here means bit for bit. Not "the same top twenty", not "within a
// tolerance": every row of the table, in order, with gene, log2FC, p, padj,
// pct.1 and pct.2 compared by Object.is. A tolerance would hide exactly the bug
// worth finding — a group label built differently on the two sides — because
// that bug moves a p-value by a little, not by a lot.

import { readCollectionIndex } from './lib/collection.ts'
import { openCollection } from './lib/collection-source.ts'
import { isSuperseded, runJob } from './lib/engine.ts'
import { deWilcoxAsync, wilcoxSpec, type DEResult } from './lib/stats.ts'
import type { Source } from './lib/source.ts'

const out = document.getElementById('log') as HTMLPreElement
const log = (s: string) => { out.textContent += s + '\n'; console.log(s) }
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * How blocked the page was.
 *
 * A copy of the bench's heartbeat rather than an import, so this file can be
 * read on its own and so neither bench edits the other's measurement. A timer
 * asked to fire every 16 ms cannot fire while the main thread is inside a loop,
 * so the gaps it records ARE the jank, in the unit the user feels.
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

async function open(file: File) {
  const index = await readCollectionIndex(file)
  if (!index) throw new Error('not a collection')
  src = await openCollection(file, index)
  return {
    cells: src.d.cells.length,
    genes: src.genes.length,
    clusters: src.types.length,
    conds: src.d.conds,
  }
}

/**
 * The cluster where a contrast is most worth running.
 *
 * The one with the most cells on its smaller side: a contrast of 4 cells against
 * 9 000 tells you nothing about whether the two paths agree, because almost
 * every gene falls at the first gate and never reaches the rank test.
 */
function best(ctrl: string, cs: string) {
  const s = need()
  let ti = 0
  let score = -1
  for (let t = 0; t < s.types.length; t++) {
    const n1 = s.group(t, cs).length
    const n2 = s.group(t, ctrl).length
    const m = Math.min(n1, n2)
    if (m > score) { score = m; ti = t }
  }
  return { ti, name: s.types[ti].name, n1: s.group(ti, cs).length, n2: s.group(ti, ctrl).length }
}

/** The path the studio now takes: the worker reads the file and tests every gene. */
async function workerRun(ti: number, ctrl: string, cs: string): Promise<DEResult> {
  const s = need()
  const hb = heartbeat()
  const t0 = performance.now()
  let messages = 0
  let lastPct = -1
  const running = runJob<'wilcox'>(s, { kind: 'wilcox', ...wilcoxSpec(s, ti, ctrl, cs) },
    (phase, done, total) => {
      messages++
      const pct = Math.floor((100 * done) / total / 10) * 10
      if (pct !== lastPct) { lastPct = pct; log(`  ${phase} ${pct}%  ${secs(performance.now() - t0)}`) }
    })!
  const res = await running.promise
  const ms = performance.now() - t0
  const b = hb.stop()
  log('WORKER — the contrast runs off the page')
  log(`  total ${secs(ms)}`)
  log(`  main thread: worst gap ${b.worst.toFixed(0)} ms, ${b.stalls} gaps over 100 ms in ${b.ticks} ticks`)
  log(`  progress messages: ${messages}`)
  log(`  rows: ${res.rows.length.toLocaleString()} · ${res.n1} vs ${res.n0} cells`)
  return res
}

/** What the studio did before: the same arithmetic, on the main thread. */
async function pageRun(ti: number, ctrl: string, cs: string): Promise<DEResult> {
  const s = need()
  const hb = heartbeat()
  const t0 = performance.now()
  let lastPct = -1
  const res = await deWilcoxAsync(s, ti, ctrl, cs, (done, total) => {
    const pct = Math.floor((100 * done) / total / 10) * 10
    if (pct !== lastPct) { lastPct = pct; log(`  ${pct}%  ${secs(performance.now() - t0)}`) }
  })
  const ms = performance.now() - t0
  const b = hb.stop()
  log('MAIN THREAD — the path this replaces')
  log(`  total ${secs(ms)}`)
  log(`  main thread: worst gap ${b.worst.toFixed(0)} ms, ${b.stalls} gaps over 100 ms in ${b.ticks} ticks`)
  log(`  rows: ${res.rows.length.toLocaleString()} · ${res.n1} vs ${res.n0} cells`)
  return res
}

/** Every row, every field, or the first place they part company. */
function compareDE(a: DEResult, b: DEResult): string {
  if (a.n0 !== b.n0 || a.n1 !== b.n1) {
    return `group sizes differ: ${a.n1}/${a.n0} vs ${b.n1}/${b.n0}`
  }
  if (a.rows.length !== b.rows.length) {
    return `${a.rows.length} rows vs ${b.rows.length}`
  }
  for (let i = 0; i < a.rows.length; i++) {
    const x = a.rows[i]
    const y = b.rows[i]
    if (x.gene !== y.gene) return `row ${i}: ${x.gene} vs ${y.gene}`
    for (const f of ['lfc', 'p', 'padj', 'pct1', 'pct2'] as const) {
      if (!Object.is(x[f], y[f])) {
        return `row ${i} (${x.gene}): ${f} ${String(x[f])} vs ${String(y[f])}`
      }
    }
  }
  return `IDENTICAL — ${a.rows.length.toLocaleString()} rows, every field bit for bit`
}

/**
 * One contrast, both ways.
 *
 * The worker runs first and the main thread second, so the main thread's own
 * chunk cache cannot be what makes the worker look fast.
 */
async function compare(ctrl?: string, cs?: string) {
  const s = need()
  const c0 = ctrl ?? s.d.conds[0]
  const c1 = cs ?? s.d.conds[s.d.conds.length - 1]
  const pick = best(c0, c1)
  log(`CONTRAST — ${c1} vs ${c0} in ${pick.name} (cluster ${pick.ti}): ${pick.n1} vs ${pick.n2} cells`)
  const a = await workerRun(pick.ti, c0, c1)
  const b = await pageRun(pick.ti, c0, c1)
  const verdict = compareDE(a, b)
  log(`NUMBERS: ${verdict}`)
  return { verdict, rows: a.rows.length, n1: a.n1, n0: a.n0, cluster: pick.name, ctrl: c0, cs: c1 }
}

/**
 * A withdrawn contrast must have nowhere to land.
 *
 * Not "the stale answer was ignored" — that the studio could get wrong later.
 * The first pass is cancelled and then checked long after the worker could
 * possibly have finished it: it must still be superseded, never resolved.
 */
async function race(ctrl?: string, cs?: string) {
  const s = need()
  const c0 = ctrl ?? s.d.conds[0]
  const c1 = cs ?? s.d.conds[s.d.conds.length - 1]
  // BOTH sides must be contrasts that actually read the file. A cluster with no
  // cells on one side is answered without a pass at all, and cancelling a job
  // that already finished proves nothing — the first version of this test did
  // exactly that and reported a fault that was not there.
  const pick = best(c0, c1)
  let second = -1
  let bestM = 0
  for (let t = 0; t < s.types.length; t++) {
    if (t === pick.ti) continue
    const m = Math.min(s.group(t, c1).length, s.group(t, c0).length)
    if (m > bestM) { bestM = m; second = t }
  }
  if (second < 0) throw new Error('this object has only one testable cluster for that contrast')
  log(`  withdrawing ${s.types[pick.ti].name}, asking ${s.types[second].name} instead`)

  // Read through a function: what the withdrawn pass did is written by a
  // callback, and narrowing it to the value it was initialised with is exactly
  // the wrong answer.
  let first = 'still pending'
  const outcome = () => first
  const a = runJob<'wilcox'>(s, { kind: 'wilcox', ...wilcoxSpec(s, pick.ti, c0, c1) }, () => {})!
  void a.promise.then(
    () => { first = 'RESOLVED — a superseded answer reached the page' },
    (e: unknown) => { first = isSuperseded(e) ? 'superseded' : `error: ${String(e)}` })

  // Far enough in that the pass is genuinely under way, nowhere near its end.
  await new Promise(r => setTimeout(r, 1500))
  if (outcome() !== 'still pending') {
    throw new Error(`the first pass ended on its own (${outcome()}) — nothing was withdrawn`)
  }
  a.cancel()
  // A different question of the same object, exactly as changing the cell type
  // in the studio does.
  const t0 = performance.now()
  const b = runJob<'wilcox'>(s, { kind: 'wilcox', ...wilcoxSpec(s, second, c0, c1) }, () => {})!
  const res = await b.promise
  // Long after anything the first pass could still be doing.
  await new Promise(r => setTimeout(r, 4000))
  log('SUPERSESSION')
  log(`  the withdrawn contrast: ${outcome()}`)
  log(`  the replacement: ${res.rows.length.toLocaleString()} rows in ${secs(performance.now() - t0)}`)
  log(`  verdict: ${outcome() === 'superseded' ? 'nothing stale could land' : 'BROKEN'}`)
  return outcome() === 'superseded'
}

Object.assign(window, {
  benchDE: { open, best, workerRun, pageRun, compareDE, compare, race, text: () => out.textContent },
})
