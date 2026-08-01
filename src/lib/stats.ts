// Differential expression.
//
// The default is the test Seurat's FindMarkers and Scanpy's rank_genes_groups
// run: a Wilcoxon rank-sum test across cells, with Seurat's own gates and
// Bonferroni adjustment. It requires no replicates, which is the normal
// situation in single-cell work — so nothing here is ever blocked for want of
// them.
//
// This is a real implementation, and it runs against the Source interface, so
// the built-in demo objects and a real bundle go through exactly the same code.
// A separate path for the demo would be a path that can quietly disagree with
// the one that matters.

import type { CellType, DERow, Design, Method } from '../types.ts'
import type { Source } from './source.ts'

/** Cells a sample must contribute before it becomes a pseudobulk column. */
export const MIN_CELLS = 10
/** "> 3 replicates" before pseudobulk is offered at all. */
export const MIN_REPS_PB = 4
/** Seurat's logfc.threshold. */
export const LFC_GATE = 0.25
/** Seurat's min.pct. */
export const PCT_GATE = 0.1

/** Upper tail of the standard normal — Abramowitz & Stegun 26.2.17. */
export function normalTail(z: number): number {
  const x = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * x)
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))))
  return Math.max(Number.MIN_VALUE, p)
}

/**
 * Significance threshold, per method.
 *
 * |log2FC| > 1 is a bulk convention and it does not transfer. Single-cell values
 * are log-normalized before testing, so effect sizes are compressed and a cutoff
 * of 1 discards almost everything real — Seurat reports at its own
 * logfc.threshold instead. Pseudobulk runs on summed raw counts, which behave
 * like a bulk experiment, so there the bulk cutoff is the right one.
 */
export const thresholdFor = (method: Method) =>
  method === 'wilcox' ? { padj: 0.05, lfc: LFC_GATE } : { padj: 0.05, lfc: 1 }

export const isSig = (r: DERow, th: { padj: number; lfc: number }) =>
  r.padj < th.padj && Math.abs(r.lfc) >= th.lfc

export const sigCount = (rows: DERow[], th: { padj: number; lfc: number }) =>
  rows.reduce((n, r) => n + (isSig(r, th) ? 1 : 0), 0)

export interface DEResult {
  rows: DERow[]
  n0: number
  n1: number
}

/**
 * Seurat's avg_log2FC for log-normalized data: undo the log, average on the
 * linear scale, then take the ratio. Averaging the logs instead reports a
 * geometric mean, which is a different and systematically smaller number.
 */
export function avgLog2FC(v: Float32Array, a: Int32Array, b: Int32Array): number {
  let sa = 0
  for (let k = 0; k < a.length; k++) sa += Math.expm1(v[a[k]])
  let sb = 0
  for (let k = 0; k < b.length; k++) sb += Math.expm1(v[b[k]])
  return Math.log2(sa / a.length + 1) - Math.log2(sb / b.length + 1)
}

/**
 * Wilcoxon rank-sum, exploiting sparsity.
 *
 * Every zero ties for the lowest ranks, so only the non-zero values need
 * sorting — a few hundred per gene rather than every cell. Ties are corrected
 * for, which matters more here than usual: the zero block is often most of the
 * data, and ignoring it inflates every statistic in the table.
 */
export function rankSum(v: Float32Array, a: Int32Array, b: Int32Array): number {
  const n1 = a.length
  const n2 = b.length
  const n = n1 + n2
  if (!n1 || !n2 || n < 3) return 1

  const xs: number[] = []
  const gs: number[] = []
  let z1 = 0
  for (let k = 0; k < n1; k++) {
    const x = v[a[k]]
    if (x > 0) { xs.push(x); gs.push(0) } else z1++
  }
  let z2 = 0
  for (let k = 0; k < n2; k++) {
    const x = v[b[k]]
    if (x > 0) { xs.push(x); gs.push(1) } else z2++
  }
  const zeros = z1 + z2
  if (!xs.length) return 1

  const order = xs.map((_x, i) => i).sort((p, q) => xs[p] - xs[q])

  // Ranks 1..zeros are the zero block — one tie group of that size.
  let r1 = z1 * ((1 + zeros) / 2)
  let tieSum = zeros > 1 ? zeros ** 3 - zeros : 0

  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++
    const size = j - i + 1
    const rank = zeros + i + 1 + (size - 1) / 2
    for (let k = i; k <= j; k++) if (gs[order[k]] === 0) r1 += rank
    if (size > 1) tieSum += size ** 3 - size
    i = j + 1
  }

  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2
  const varU = ((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1)))
  if (varU <= 0) return 1
  const z = (Math.abs(u - mu) - 0.5) / Math.sqrt(varU)
  return Math.min(1, 2 * normalTail(z))
}

/**
 * A group membership label per cell: 0 for side A, 1 for side B, -1 for cells
 * taking no part. Built once per test rather than per gene.
 */
function labels(nCells: number, a: Int32Array, b: Int32Array): Int8Array {
  const lab = new Int8Array(nCells).fill(-1)
  for (let k = 0; k < a.length; k++) lab[a[k]] = 0
  for (let k = 0; k < b.length; k++) lab[b[k]] = 1
  return lab
}

/**
 * One gene, from its non-zero entries alone.
 *
 * Zeros never need visiting: they contribute nothing to the sums, and for the
 * rank test they are a single tie block whose size is known from the group
 * sizes. That is what makes a full 13k-gene run take a second rather than a
 * minute.
 */
function testGene(
  src: Source, gene: string, lab: Int8Array, n1: number, n2: number,
): DERow | null {
  const xs: number[] = []
  const gs: number[] = []
  let d1 = 0, d2 = 0, s1 = 0, s2 = 0

  src.forEachNonZero(gene, (cell, value) => {
    const g = lab[cell]
    if (g < 0) return
    xs.push(value)
    gs.push(g)
    if (g === 0) { d1++; s1 += Math.expm1(value) } else { d2++; s2 += Math.expm1(value) }
  })

  const pct1 = d1 / n1
  const pct2 = d2 / n2
  if (pct1 < PCT_GATE && pct2 < PCT_GATE) return null
  const lfc = Math.log2(s1 / n1 + 1) - Math.log2(s2 / n2 + 1)
  if (!Number.isFinite(lfc) || Math.abs(lfc) < LFC_GATE) return null

  const p = rankSumSparse(xs, gs, n1 - d1, n2 - d2)
  return { gene, lfc, p, padj: 1, pct1, pct2 }
}

/** Two-sided Wilcoxon rank-sum from the non-zero values plus the zero counts. */
export function rankSumSparse(
  xs: number[], gs: number[], z1: number, z2: number,
): number {
  const n1 = gs.reduce((k, g) => k + (g === 0 ? 1 : 0), 0) + z1
  const n2 = gs.length - (n1 - z1) + z2
  const n = n1 + n2
  if (!n1 || !n2 || n < 3) return 1
  const zeros = z1 + z2
  if (!xs.length) return 1

  const order = xs.map((_x, i) => i).sort((p, q) => xs[p] - xs[q])
  // Ranks 1..zeros are the zero block — one tie group of that size.
  let r1 = z1 * ((1 + zeros) / 2)
  let tieSum = zeros > 1 ? zeros ** 3 - zeros : 0

  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++
    const size = j - i + 1
    const rank = zeros + i + 1 + (size - 1) / 2
    for (let k = i; k <= j; k++) if (gs[order[k]] === 0) r1 += rank
    if (size > 1) tieSum += size ** 3 - size
    i = j + 1
  }

  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2
  const varU = ((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1)))
  if (varU <= 0) return 1
  const z = (Math.abs(u - mu) - 0.5) / Math.sqrt(varU)
  return Math.min(1, 2 * normalTail(z))
}

function finish(rows: DERow[], nTested: number): DERow[] {
  for (const r of rows) r.padj = Math.min(1, r.p * nTested)
  rows.sort((x, y) => x.padj - y.padj || Math.abs(y.lfc) - Math.abs(x.lfc))
  return rows
}

/** FindMarkers: two groups within one cluster. */
export function deWilcox(src: Source, ti: number, ctrl: string, cs: string): DEResult {
  // `a` is the "1" side: pct.1, and the numerator of the fold change.
  const a = src.group(ti, cs)
  const b = src.group(ti, ctrl)
  if (!a.length || !b.length) return { rows: [], n0: b.length, n1: a.length }
  const lab = labels(src.d.cells.length, a, b)
  const rows: DERow[] = []
  for (const gene of src.genes) {
    const r = testGene(src, gene, lab, a.length, b.length)
    if (r) rows.push(r)
  }
  return { rows: finish(rows, src.genes.length), n0: b.length, n1: a.length }
}

/**
 * FindAllMarkers: one cluster against every other cell.
 *
 * On a single-condition object this is the only differential test there is, and
 * it is the one that answers "what is this cluster" — so it has to be a real
 * test, not the ranking-by-mean the dot plot uses for its colours.
 */
export function deMarkers(src: Source, ti: number, cond?: string | null): DEResult {
  const inCluster: number[] = []
  const rest: number[] = []
  src.d.cells.forEach((c, i) => {
    if (cond && c.cond !== cond) return
    if (c.t === ti) inCluster.push(i); else rest.push(i)
  })
  const a = Int32Array.from(inCluster)
  const b = Int32Array.from(rest)
  if (!a.length || !b.length) return { rows: [], n0: b.length, n1: a.length }
  const lab = labels(src.d.cells.length, a, b)
  const rows: DERow[] = []
  for (const gene of src.genes) {
    const r = testGene(src, gene, lab, a.length, b.length)
    if (r) rows.push(r)
  }
  return { rows: finish(rows, src.genes.length), n0: b.length, n1: a.length }
}

/* ---------------- pseudobulk ---------------- */

export interface PseudobulkColumn {
  sample: string
  cluster: string
  nCells: number
  cond: string
}

/** The pseudobulk columns for one cluster and pair, after the cell floor. */
export function pseudobulkColumns(
  src: Source, ti: number, ctrl: string, cs: string,
): PseudobulkColumn[] {
  if (!src.pseudobulk) return []
  const cluster = src.clusters[ti]
  const condOf = new Map(src.d.samples.map(s => [s.id, s.cond]))
  return src.pseudobulk.columns
    .map(c => ({ ...c, cond: condOf.get(c.sample) ?? '' }))
    .filter(c => c.cluster === cluster
      && (c.cond === ctrl || c.cond === cs)
      && c.nCells >= MIN_CELLS)
}

/** Which samples of a cluster are usable, and whether pseudobulk is defensible. */
export function designFor(src: Source, ti: number, ctrl: string, cs: string): Design {
  const counts = new Map<string, number>()
  for (const c of src.d.cells) {
    if (c.t === ti) counts.set(c.s, (counts.get(c.s) ?? 0) + 1)
  }
  const used = src.d.samples
    .map(s => ({ ...s, n: counts.get(s.id) ?? 0 }))
    .filter(s => s.cond === ctrl || s.cond === cs)
  const kept = used.filter(s => s.n >= MIN_CELLS)
  const n0 = kept.filter(s => s.cond === ctrl).length
  const n1 = kept.filter(s => s.cond === cs).length
  return {
    used, kept, n0, n1,
    pbOK: n0 >= MIN_REPS_PB && n1 >= MIN_REPS_PB && ctrl !== cs,
  }
}

/** Smallest number of samples any group has — decides which tests are offered. */
export const minReplicates = (src: Source): number =>
  Math.min(...src.d.conds.map(c => src.d.samples.filter(s => s.cond === c).length))

/** Key a computed pseudobulk run, stable across cluster renaming. */
export const pbKey = (t: CellType, ctrl: string, cs: string) => `${t.key}|${ctrl}|${cs}`

/**
 * Signed ranking metric: −log10(p) × log2FC.
 *
 * Sorting by p alone puts a tiny, highly significant change above a large one;
 * sorting by fold change alone promotes noise. The product keeps both, and its
 * sign keeps the direction, so one column orders a table sensibly.
 */
export function combinedScore(lfc: number, p: number): number | null {
  if (!Number.isFinite(lfc) || !Number.isFinite(p)) return null
  return (p <= 0 ? 300 : -Math.log10(p)) * lfc
}
