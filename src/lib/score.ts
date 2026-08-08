// Per-cell module scores — Seurat's AddModuleScore / Scanpy's score_genes.
//
// The naive version of this, "mean expression of the set", is dominated by how
// abundant the set's genes happen to be: a signature of ribosomal genes scores
// high in every cell and means nothing. The published algorithm subtracts a
// control set matched on expression level, so the score reads as "higher than
// genes of comparable abundance" rather than "abundant".
//
//   1. average every gene across all cells
//   2. bin genes into `nbin` bins of equal count by that average
//   3. for each set gene, draw `ctrl` control genes from its own bin
//   4. per cell: mean(set) − mean(controls)
//
// A score near zero therefore means "no different from background", and the
// zero point is meaningful — unlike a raw mean, which has no natural reference.

import type { Source } from './source.ts'
import { hash, rng } from './demo.ts'

export interface ModuleScore {
  /** One value per cell, in dataset order. */
  scores: Float32Array
  /** Set genes found in the object. */
  used: string[]
  /** Requested genes the object does not measure. */
  missing: string[]
  /** Control genes drawn, for the record. */
  control: string[]
}

export interface ScoreOpts {
  /** Seurat's `nbin`. */
  nbin: number
  /** Seurat's `ctrl` — control genes drawn per set gene. */
  ctrl: number
}

export const SCORE_DEFAULTS: ScoreOpts = { nbin: 24, ctrl: 100 }

/**
 * Mean expression of every gene, for the expression bins.
 *
 * A whole-transcriptome pass, so the answer is remembered per object: the bins
 * do not change when the gene set does, and on a collection this is the
 * difference between one pass per set and one pass ever.
 */
const AVERAGES = new WeakMap<Source, Map<string, number>>()

function geneAveragesSync(src: Source): Map<string, number> | null {
  const hit = AVERAGES.get(src)
  if (hit) return hit
  const n = src.d.cells.length
  const out = new Map<string, number>()
  if (!src.scanSync((gene, each) => {
    let sum = 0
    each((_cell, value) => { sum += value })
    out.set(gene, sum / n)
  })) return null
  AVERAGES.set(src, out)
  return out
}

async function geneAveragesAsync(
  src: Source,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<Map<string, number>> {
  const hit = AVERAGES.get(src)
  if (hit) return hit
  const n = src.d.cells.length
  const out = new Map<string, number>()
  await src.scan((gene, each) => {
    let sum = 0
    each((_cell, value) => { sum += value })
    out.set(gene, sum / n)
  }, onProgress, cancelled)
  if (cancelled?.()) return out
  AVERAGES.set(src, out)
  return out
}

/** Which of the requested genes this object measures, in the order asked. */
function resolve(src: Source, requested: string[]) {
  const byLower = new Map(src.genes.map(g => [g.toLowerCase(), g]))
  const used: string[] = []
  const missing: string[] = []
  for (const g of requested) {
    const hit = byLower.get(g.toLowerCase())
    if (!hit) missing.push(g)
    else if (!used.includes(hit)) used.push(hit)
  }
  return { used, missing }
}

/**
 * Steps 1–3: the control set, and the per-gene weight each side contributes.
 *
 * Split out from the accumulation because the accumulation is the part that
 * touches the matrix, and a collection has to stream it.
 */
function plan(
  src: Source, used: string[], avg: Map<string, number>, opts: ScoreOpts,
) {
  const allGenes = src.genes
  const sorted = [...allGenes].sort((a, b) => (avg.get(a) ?? 0) - (avg.get(b) ?? 0))
  const nbin = Math.max(1, Math.min(opts.nbin, sorted.length))
  const binOf = new Map<string, number>()
  const bins: string[][] = Array.from({ length: nbin }, () => [])
  sorted.forEach((g, i) => {
    const b = Math.min(nbin - 1, Math.floor((i * nbin) / sorted.length))
    binOf.set(g, b)
    bins[b].push(g)
  })

  // 3. controls from the same bin, deterministic and excluding the set itself
  const setOf = new Set(used)
  const control: string[] = []
  const R = rng(hash(used.join('|')))
  for (const g of used) {
    const pool = bins[binOf.get(g) ?? 0].filter(x => !setOf.has(x))
    if (!pool.length) continue
    // Sampling with replacement, as Seurat does when a bin is smaller than `ctrl`.
    for (let i = 0; i < Math.min(opts.ctrl, pool.length * 4); i++) {
      control.push(pool[Math.floor(R() * pool.length)])
    }
  }
  const ctrlGenes = control.length ? control : allGenes.filter(g => !setOf.has(g))

  // 4. per cell, mean(set) − mean(controls): one signed weight per gene, so the
  // accumulation is a single walk over whichever genes carry a weight — and a
  // collection can do that walk while it streams.
  const uniqueCtrl = [...new Set(ctrlGenes)]
  // The set first, then the controls — the same order the sum was accumulated in
  // before this was split apart, so the scores are bit-for-bit what they were.
  const weight = new Map<string, number>()
  for (const g of used) weight.set(g, 1 / used.length)
  const ctrlWeight = new Map<string, number>()
  for (const g of ctrlGenes) ctrlWeight.set(g, (ctrlWeight.get(g) ?? 0) + 1 / ctrlGenes.length)
  for (const g of uniqueCtrl) weight.set(g, -(ctrlWeight.get(g) ?? 0))
  return { weight, control: uniqueCtrl }
}

/** Fold one gene's values into the running score. */
const fold = (scores: Float32Array, w: number) =>
  (cell: number, value: number) => { scores[cell] += value * w }

export function moduleScore(
  src: Source, requested: string[], opts: ScoreOpts = SCORE_DEFAULTS,
): ModuleScore {
  const n = src.d.cells.length
  const { used, missing } = resolve(src, requested)
  if (!used.length) return { scores: new Float32Array(n), used, missing, control: [] }
  const avg = geneAveragesSync(src)
  if (!avg) return { scores: new Float32Array(n), used, missing, control: [] }

  const { weight, control } = plan(src, used, avg, opts)
  const scores = new Float32Array(n)
  for (const [g, w] of weight) {
    if (w !== 0) src.forEachNonZero(g, fold(scores, w))
  }
  return { scores, used, missing, control }
}

/**
 * The same score, streamed.
 *
 * Two passes, and they are honest about it: the bins need every gene's average
 * before the control set exists, and the control set is drawn from bins spread
 * across the whole transcriptome. The averages are cached per object, so only
 * the first set on a collection pays for both.
 */
export async function moduleScoreAsync(
  src: Source, requested: string[], opts: ScoreOpts = SCORE_DEFAULTS,
  onProgress?: (phase: string, done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<ModuleScore> {
  const n = src.d.cells.length
  const { used, missing } = resolve(src, requested)
  if (!used.length) return { scores: new Float32Array(n), used, missing, control: [] }

  const avg = await geneAveragesAsync(
    src, (a, b) => onProgress?.('expression bins', a, b), cancelled)
  if (cancelled?.()) return { scores: new Float32Array(n), used, missing, control: [] }

  const { weight, control } = plan(src, used, avg, opts)
  const scores = new Float32Array(n)
  await src.scan((gene, each) => {
    const w = weight.get(gene)
    if (w) each(fold(scores, w))
  }, (a, b) => onProgress?.('module score', a, b), cancelled)
  return { scores, used, missing, control }
}

/** Summary of a score within one subset of cells. */
export function summarise(scores: Float32Array, index: number[]) {
  if (!index.length) return { mean: 0, med: 0, q1: 0, q3: 0, min: 0, max: 0, n: 0 }
  const v = index.map(i => scores[i]).sort((a, b) => a - b)
  const q = (f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))]
  return {
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    med: q(0.5), q1: q(0.25), q3: q(0.75),
    min: v[0], max: v[v.length - 1], n: v.length,
  }
}
