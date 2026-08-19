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

import type { NonZeroWalk, Source } from './source.ts'
import { hash, rng } from './demo.ts'
import { geneIndex, lowerIndex } from './genes.ts'

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

/* ---------------- step 1: the average of every gene ---------------- */

/**
 * The two whole-transcriptome halves of a module score, split so that either
 * half can run wherever it belongs.
 *
 * Averages are indexed by GENE INDEX rather than keyed by name, for the same
 * reason the DE tests are: this array is what crosses to the worker, and 31 053
 * gene names have no business being copied into another thread to say what the
 * mean of each was. `src.genes[i]` is there for the one caller that needs a
 * string.
 */
export interface AveragesSpec {
  nGenes: number
  nCells: number
}

/** Fold one gene into the running averages. Shared by every path. */
export function averagesPlan(spec: AveragesSpec) {
  const avg = new Float64Array(spec.nGenes)
  return {
    visit: (gene: number, each: NonZeroWalk) => {
      let sum = 0
      each((_cell, value) => { sum += value })
      avg[gene] = sum / spec.nCells
    },
    done: (): Float64Array => avg,
  }
}

export const averagesSpec = (src: Source): AveragesSpec =>
  ({ nGenes: src.genes.length, nCells: src.d.cells.length })

/**
 * Mean expression of every gene, for the expression bins.
 *
 * A whole-transcriptome pass, so the answer is remembered per object: the bins
 * do not change when the gene set does, and on a collection this is the
 * difference between one pass per set and one pass ever.
 */
const AVERAGES = new WeakMap<Source, Float64Array>()

/**
 * The averages of an object held in memory.
 *
 * A collection never reaches this — its averages come back from the worker and
 * are remembered by `useJob`'s per-object cache under a key that does not change,
 * so the second gene set on an atlas pays for no pass at all.
 */
export function geneAveragesSync(src: Source): Float64Array | null {
  const hit = AVERAGES.get(src)
  if (hit) return hit
  const p = averagesPlan(averagesSpec(src))
  if (!src.scanSync(p.visit)) return null
  const avg = p.done()
  AVERAGES.set(src, avg)
  return avg
}

async function geneAveragesAsync(
  src: Source,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<Float64Array> {
  const hit = AVERAGES.get(src)
  if (hit) return hit
  const p = averagesPlan(averagesSpec(src))
  await src.scan(p.visit, onProgress, cancelled)
  const avg = p.done()
  if (cancelled?.()) return avg
  AVERAGES.set(src, avg)
  return avg
}

/**
 * Which of the requested genes this object measures, in the order asked.
 *
 * Matched through the object's naming, so a set written in symbols resolves
 * against an object whose matrix is indexed by accessions — which is the whole
 * reason the built-in sets used to report "none of these genes are measured" on
 * an Ensembl-indexed atlas that measures every one of them.
 *
 * A symbol that names several rows brings back all of them. Nothing was merged
 * when the bundle was written and nothing is merged here: two accessions under
 * one symbol are two genes, and the score says so by counting both.
 */
export function resolve(src: Source, requested: string[]) {
  const byLower = lowerIndex(src.genes)
  const used: string[] = []
  const missing: string[] = []
  for (const g of requested) {
    const hits = src.names ? src.names.match(g) : []
    if (hits.length) {
      for (const h of hits) if (!used.includes(h)) used.push(h)
      continue
    }
    const hit = byLower.get(g.toLowerCase())
    if (!hit) missing.push(g)
    else if (!used.includes(hit)) used.push(hit)
  }
  return { used, missing }
}

/* ---------------- steps 2–3: the control set, as numbers ---------------- */

/**
 * The weight every gene carries in the score, by gene index.
 *
 * This is the whole of what the accumulation needs, and it is cloneable — so the
 * bins and the control draw are decided ONCE, on the page, and both the inline
 * path and the worker are handed the same answer. Deciding it twice is the one
 * way the two could disagree about a number while both looking correct, so
 * there is no second implementation to drift.
 */
export interface ScorePlan {
  /** Per gene index: signed weight. Exactly 0 means the gene takes no part. */
  weight: Float64Array
  /**
   * The genes that carry a weight, in gene order.
   *
   * Gene order, not set-then-controls, because Float32 addition is not
   * associative and a matrix streamed off disk can only be walked in gene
   * order. Accumulating differently on the two paths made the same object
   * score differently depending on whether it was held in memory or read from
   * a collection — 2,043 of 2,638 cells disagreed, by up to 1.9e-7. That is
   * numerically nothing and exactly the wrong thing to leave in place: the two
   * numbers are answers to the same question. Matching the streamed order
   * shifts scores from a previous release in their last bits, which is the
   * lesser of the two.
   */
  order: Int32Array
  /** Control genes drawn, by index, for the record. */
  control: Int32Array
}

/**
 * Steps 1–3: the control set, and the per-gene weight each side contributes.
 *
 * Split out from the accumulation because the accumulation is the part that
 * touches the matrix, and a collection has to stream it.
 */
export function scorePlan(
  src: Source, used: string[], avg: Float64Array, opts: ScoreOpts,
): ScorePlan {
  const nGenes = src.genes.length
  const at = geneIndex(src.genes)
  const usedIdx = used.map(g => at.get(g) ?? -1).filter(i => i >= 0)

  const sorted = Array.from({ length: nGenes }, (_v, i) => i)
    .sort((a, b) => avg[a] - avg[b])
  const nbin = Math.max(1, Math.min(opts.nbin, sorted.length))
  const binOf = new Int32Array(nGenes)
  const bins: number[][] = Array.from({ length: nbin }, () => [])
  sorted.forEach((g, i) => {
    const b = Math.min(nbin - 1, Math.floor((i * nbin) / sorted.length))
    binOf[g] = b
    bins[b].push(g)
  })

  // 3. controls from the same bin, deterministic and excluding the set itself.
  // The seed is the gene NAMES, not the indices: the same signature has to score
  // the same on an object whose genes happen to be in a different order.
  const inSet = new Uint8Array(nGenes)
  for (const i of usedIdx) inSet[i] = 1
  const control: number[] = []
  const R = rng(hash(used.join('|')))
  for (const g of usedIdx) {
    const pool = bins[binOf[g]].filter(x => !inSet[x])
    if (!pool.length) continue
    // Sampling with replacement, as Seurat does when a bin is smaller than `ctrl`.
    for (let i = 0; i < Math.min(opts.ctrl, pool.length * 4); i++) {
      control.push(pool[Math.floor(R() * pool.length)])
    }
  }
  const ctrlGenes = control.length
    ? control
    : Array.from({ length: nGenes }, (_v, i) => i).filter(i => !inSet[i])

  // 4. per cell, mean(set) − mean(controls): one signed weight per gene, so the
  // accumulation is a single walk over whichever genes carry a weight — and a
  // collection can do that walk while it streams.
  const uniqueCtrl = [...new Set(ctrlGenes)]
  const weight = new Float64Array(nGenes)
  for (const g of usedIdx) weight[g] = 1 / usedIdx.length
  const ctrlWeight = new Float64Array(nGenes)
  for (const g of ctrlGenes) ctrlWeight[g] += 1 / ctrlGenes.length
  for (const g of uniqueCtrl) weight[g] = -ctrlWeight[g]
  return {
    weight,
    order: Int32Array.from([...usedIdx, ...uniqueCtrl]).sort(),
    control: Int32Array.from(uniqueCtrl),
  }
}

/* ---------------- step 4: the accumulation ---------------- */

/** Fold one gene's values into the running score. */
const fold = (scores: Float32Array, w: number) =>
  (cell: number, value: number) => { scores[cell] += value * w }

/** What the accumulating pass needs, and nothing else. */
export interface ScoreSpec {
  weight: Float64Array
  nCells: number
  nGenes: number
}

/**
 * Several signatures, scored in ONE pass over the matrix.
 *
 * A module score is a weighted walk over the genes that carry a weight, and
 * nothing about that walk is specific to one signature — so scoring seven sets
 * one at a time reads the file seven times for no reason. On an object held in
 * memory that is a wasted second; on a 5.8 GB collection it is seven passes of
 * several minutes each, which is the difference between the analysis being
 * available and not.
 *
 * The weights are held gene-major and sparse, as a CSR over genes: `ptr[g]` to
 * `ptr[g+1]` are the entries for gene g, each naming a SET and the weight it
 * gives that gene. Gene-major because the pass is gene-major — one lookup per
 * gene, then one walk over its cells adding to however many sets weight it,
 * which for a real signature is one or two. A dense nSets x nGenes matrix would
 * be the same information at 30 x 31 053 doubles and would make the inner loop
 * proportional to the number of SETS rather than to the number of sets that
 * actually contain the gene.
 */
export interface ScoreManySpec {
  /** Offsets into `set`/`w`, length nGenes + 1. */
  ptr: Int32Array
  /** Which set each entry belongs to. */
  set: Int32Array
  /** The weight that gene carries in that set. Never 0. */
  w: Float64Array
  nSets: number
  nCells: number
  nGenes: number
}

/** Scores for several sets: set `s`, cell `i` is at `s * nCells + i`. */
export function scoreManyAccumPlan(spec: ScoreManySpec) {
  const scores = new Float32Array(spec.nSets * spec.nCells)
  const { ptr, set, w, nCells } = spec
  return {
    visit: (gene: number, each: NonZeroWalk) => {
      const from = ptr[gene], to = ptr[gene + 1]
      if (from === to) return
      each((cell, value) => {
        for (let k = from; k < to; k++) scores[set[k] * nCells + cell] += value * w[k]
      })
    },
    done: (): Float32Array => scores,
  }
}

/**
 * The weights for several signatures, folded into one gene-major structure.
 *
 * Each set keeps its OWN control genes — `scorePlan` is run per set, unchanged
 * — because the control set is matched to that signature's expression levels
 * and sharing one across seven signatures would score every one of them against
 * the wrong baseline. What is shared is the pass, not the statistics.
 */
export function scoreManyPlan(
  src: Source, sets: readonly string[][], avg: Float64Array, opts: ScoreOpts,
): ScoreManySpec {
  const nGenes = src.genes.length
  const per = sets.map(used => scorePlan(src, used, avg, opts))
  // Counted first so the arrays are allocated once at the right size.
  const counts = new Int32Array(nGenes)
  for (const p of per) {
    for (const g of p.order) if (p.weight[g] !== 0) counts[g]++
  }
  const ptr = new Int32Array(nGenes + 1)
  for (let g = 0; g < nGenes; g++) ptr[g + 1] = ptr[g] + counts[g]
  const total = ptr[nGenes]
  const set = new Int32Array(total)
  const w = new Float64Array(total)
  const at = ptr.slice(0, nGenes)
  per.forEach((p, si) => {
    for (const g of p.order) {
      const val = p.weight[g]
      if (val === 0) continue
      const k = at[g]++
      set[k] = si
      w[k] = val
    }
  })
  return { ptr, set, w, nSets: sets.length, nCells: src.d.cells.length, nGenes }
}

/** The same, in memory, for an object that needs no worker. */
export function scoreManyInline(src: Source, spec: ScoreManySpec): Float32Array {
  const plan = scoreManyAccumPlan(spec)
  const genes = src.genes
  for (let g = 0; g < genes.length; g++) {
    if (spec.ptr[g] === spec.ptr[g + 1]) continue
    plan.visit(g, cb => src.forEachNonZero(genes[g], cb))
  }
  return plan.done()
}

/**
 * Fold every weighted gene into the per-cell score, one gene at a time.
 *
 * Used by the streaming path and by the worker, which is the point: the file is
 * walked in gene order by both, so a collection's scores do not depend on which
 * thread produced them.
 */
export function scoreAccumPlan(spec: ScoreSpec) {
  const scores = new Float32Array(spec.nCells)
  return {
    visit: (gene: number, each: NonZeroWalk) => {
      const w = spec.weight[gene]
      if (w) each(fold(scores, w))
    },
    done: (): Float32Array => scores,
  }
}

/**
 * The accumulation an in-memory object does — in gene order, which is the only
 * order a streamed matrix can offer, so both paths reach the same number.
 */
export function scoreInline(src: Source, p: ScorePlan): Float32Array {
  const scores = new Float32Array(src.d.cells.length)
  for (const g of p.order) {
    const w = p.weight[g]
    if (w !== 0) src.forEachNonZero(src.genes[g], fold(scores, w))
  }
  return scores
}

export function moduleScore(
  src: Source, requested: string[], opts: ScoreOpts = SCORE_DEFAULTS,
): ModuleScore {
  const n = src.d.cells.length
  const { used, missing } = resolve(src, requested)
  if (!used.length) return { scores: new Float32Array(n), used, missing, control: [] }
  const avg = geneAveragesSync(src)
  if (!avg) return { scores: new Float32Array(n), used, missing, control: [] }

  const p = scorePlan(src, used, avg, opts)
  return {
    scores: scoreInline(src, p),
    used, missing,
    control: Array.from(p.control, i => src.genes[i]),
  }
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

  const p = scorePlan(src, used, avg, opts)
  const acc = scoreAccumPlan({ weight: p.weight, nCells: n, nGenes: src.genes.length })
  await src.scan(acc.visit, (a, b) => onProgress?.('module score', a, b), cancelled)
  return {
    scores: acc.done(), used, missing,
    control: Array.from(p.control, i => src.genes[i]),
  }
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
