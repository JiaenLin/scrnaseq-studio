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

/** Mean expression of every gene, for the expression bins. */
function geneAverages(src: Source, genes: string[]): Map<string, number> {
  const n = src.d.cells.length
  const out = new Map<string, number>()
  for (const gene of genes) {
    let sum = 0
    src.forEachNonZero(gene, (_cell, value) => { sum += value })
    out.set(gene, sum / n)
  }
  return out
}

export function moduleScore(
  src: Source,
  requested: string[],
  opts: ScoreOpts = SCORE_DEFAULTS,
): ModuleScore {
  const allGenes = src.genes
  const byLower = new Map(allGenes.map(g => [g.toLowerCase(), g]))
  const used: string[] = []
  const missing: string[] = []
  for (const g of requested) {
    const hit = byLower.get(g.toLowerCase())
    if (!hit) missing.push(g)
    else if (!used.includes(hit)) used.push(hit)
  }
  const n = src.d.cells.length
  if (!used.length) {
    return { scores: new Float32Array(n), used, missing, control: [] }
  }

  // 1–2. bin every gene by average expression, equal counts per bin
  const avg = geneAverages(src, allGenes)
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

  // 4. per cell, mean(set) − mean(controls). Accumulated over non-zeros only,
  // so cost is the set's own sparsity rather than genes × cells.
  const scores = new Float32Array(n)
  for (const g of used) {
    src.forEachNonZero(g, (cell, value) => { scores[cell] += value / used.length })
  }
  const uniqueCtrl = [...new Set(ctrlGenes)]
  const weight = new Map<string, number>()
  for (const g of ctrlGenes) weight.set(g, (weight.get(g) ?? 0) + 1 / ctrlGenes.length)
  for (const g of uniqueCtrl) {
    const w = weight.get(g) ?? 0
    src.forEachNonZero(g, (cell, value) => { scores[cell] -= value * w })
  }
  return { scores, used, missing, control: uniqueCtrl }
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
