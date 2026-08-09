// Mean expression and detection rate for a whole grid of genes × clusters.
//
// This is what a dot plot draws, and `src.mean` / `src.pct` already answer it
// one cell of the grid at a time. That is the right shape for a handful of
// genes and the wrong one for a marker plot of an atlas: each call asks the
// Source for the gene's dense vector, the Source's cache holds 64 genes, and
// 390 genes across 133 clusters therefore rebuilds a 292 495-value array about
// fifty thousand times. Measured at three seconds of frozen tab, arriving at
// the exact moment the worker finished a pass that never froze anything.
//
// One walk over the cells per gene instead, accumulating every cluster at once.
// The cells are walked in ascending order and each belongs to exactly one
// cluster, so each cluster's sum is built from the same values in the same
// order as `src.mean` builds it — the same floating-point additions, not merely
// an equivalent formula. scripts/test-dots.mjs asserts that cell by cell.

import type { Cell } from '../types.ts'
import type { Source } from './source.ts'

export interface DotGrid {
  /** Row-major, gene-major: value for gene `gi`, cluster `ti` is at gi*nT + ti. */
  mean: Float64Array
  pct: Float64Array
  nT: number
}

export const dotAt = (g: DotGrid, gi: number, ti: number): number => gi * g.nT + ti

export function dotGrid(src: Source, genes: readonly string[], nT: number): DotGrid {
  const mean = new Float64Array(genes.length * nT)
  const pct = new Float64Array(genes.length * nT)
  if (!genes.length || !nT) return { mean, pct, nT }

  const cells: Cell[] = src.d.cells
  const size = new Int32Array(nT)
  for (const c of cells) if (c.t >= 0 && c.t < nT) size[c.t]++

  const sum = new Float64Array(nT)
  const hit = new Int32Array(nT)
  for (let gi = 0; gi < genes.length; gi++) {
    const v = src.vector(genes[gi])
    sum.fill(0)
    hit.fill(0)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i].t
      if (c < 0 || c >= nT) continue
      const x = v[i]
      sum[c] += x
      if (x > 0) hit[c]++
    }
    for (let c = 0; c < nT; c++) {
      if (!size[c]) continue
      mean[gi * nT + c] = sum[c] / size[c]
      pct[gi * nT + c] = hit[c] / size[c]
    }
  }
  return { mean, pct, nT }
}
