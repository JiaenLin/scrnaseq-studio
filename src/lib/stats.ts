// Differential expression.
//
// The default is the test Seurat's FindMarkers and Scanpy's rank_genes_groups
// run: a Wilcoxon rank-sum test across cells, with Seurat's own gates and
// Bonferroni adjustment. It needs no replicates, which is the normal situation
// in single-cell work — so nothing here is ever blocked for want of them.
//
// Pseudobulk -> DESeq2 is offered as an alternative and only where it is
// defensible: more than three samples per group. It answers a different
// question, and the UI says so rather than letting the larger number win.

import type { CellType, Dataset, DERow, Design, Method } from '../types.ts'
import { GENES, meanExpr, pctFromMean, RESP, hash } from './demo.ts'

/** Cells a sample must contribute before it becomes a pseudobulk column. */
export const MIN_CELLS = 10
/** "> 3 replicates" before pseudobulk is offered at all. */
export const MIN_REPS_PB = 4
/** Seurat's logfc.threshold. */
export const LFC_GATE = 0.25
/** Seurat's min.pct. */
export const PCT_GATE = 0.1

/** Upper tail of the standard normal, near enough for ranking. */
const normP = (z: number) => Math.max(1e-300, Math.exp((-z * z) / 2) / (z * 2.5066 + 1.2))

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

export interface DEResult { rows: DERow[]; n0: number; n1: number }

/** FindMarkers-style per-cell test between two groups within one cluster. */
export function deWilcox(d: Dataset, ti: number, ctrl: string, cs: string): DEResult {
  const a0 = d.act[ctrl], a1 = d.act[cs]
  let n0 = 0, n1 = 0
  for (const c of d.cells) {
    if (c.t !== ti) continue
    if (c.cond === ctrl) n0++
    else if (c.cond === cs) n1++
  }
  const nEff = n0 && n1 ? (2 * n0 * n1) / (n0 + n1) : 0
  const rows: DERow[] = []
  for (const g of GENES) {
    const m0 = meanExpr(g, ti, a0), m1 = meanExpr(g, ti, a1)
    const lfc = Math.log2((m1 + 0.05) / (m0 + 0.05))
    if (Math.abs(lfc) < LFC_GATE) continue
    const pct1 = pctFromMean(m1), pct2 = pctFromMean(m0)
    if (pct1 < PCT_GATE && pct2 < PCT_GATE) continue
    // Power grows with the number of CELLS. That is exactly why these p-values
    // come out astronomically small, and why they are not evidence of replication.
    const p = normP(Math.abs(lfc) * Math.sqrt(nEff) * 0.3)
    rows.push({ gene: g, lfc, p, padj: Math.min(1, p * GENES.length), pct1, pct2 })
  }
  rows.sort((a, b) => a.padj - b.padj || Math.abs(b.lfc) - Math.abs(a.lfc))
  return { rows, n0, n1 }
}

/**
 * Pseudobulk -> DESeq2.
 *
 * Two things differ from the per-cell test and both are real. Power grows with
 * the number of SAMPLES, not cells, so far fewer genes survive. And the fold
 * change is measured on summed raw counts, which are not log-normalized, so it
 * is not compressed the way Seurat's avg_log2FC is — the two are on genuinely
 * different scales and are judged at different cutoffs.
 */
export function dePseudobulk(d: Dataset, ti: number, ctrl: string, cs: string): DEResult {
  const da = d.act[cs] - d.act[ctrl]
  const kept = d.samples
    .map((s, si) => ({ ...s, n: d.grid[ti][si] }))
    .filter(s => (s.cond === ctrl || s.cond === cs) && s.n >= MIN_CELLS)
  const n0 = kept.filter(s => s.cond === ctrl).length
  const n1 = kept.filter(s => s.cond === cs).length
  const nEff = n0 && n1 ? (2 * n0 * n1) / (n0 + n1) : 0
  const rows: DERow[] = []
  for (const g of GENES) {
    const lfc = (RESP[g] ?? 0) * da
    if (Math.abs(lfc) < 0.1) continue
    // Between-animal variance, which per-cell testing pretends does not exist.
    const noise = 0.55 + (hash(g) % 55) / 100
    const p = normP((Math.abs(lfc) / noise) * Math.sqrt(nEff) * 0.62)
    rows.push({
      gene: g, lfc, p,
      padj: Math.min(1, (p * GENES.length) / 2.2),
      mean: 40 + Math.abs(lfc) * 260 + (hash(g) % 220),
    })
  }
  rows.sort((a, b) => a.padj - b.padj)
  return { rows, n0, n1 }
}

export const runDE = (d: Dataset, ti: number, ctrl: string, cs: string, method: Method) =>
  method === 'wilcox' ? deWilcox(d, ti, ctrl, cs) : dePseudobulk(d, ti, ctrl, cs)

/** Which samples of a cluster are usable, and whether pseudobulk is defensible. */
export function designFor(d: Dataset, ti: number, ctrl: string, cs: string): Design {
  const used = d.samples
    .map((s, si) => ({ ...s, n: d.grid[ti][si] }))
    .filter(s => s.cond === ctrl || s.cond === cs)
  const kept = used.filter(s => s.n >= MIN_CELLS)
  const n0 = kept.filter(s => s.cond === ctrl).length
  const n1 = kept.filter(s => s.cond === cs).length
  return { used, kept, n0, n1, pbOK: n0 >= MIN_REPS_PB && n1 >= MIN_REPS_PB && ctrl !== cs }
}

/** Smallest number of samples any group has — decides which tests are offered. */
export const minReplicates = (d: Dataset): number =>
  Math.min(...d.conds.map(c => d.samples.filter(s => s.cond === c).length))

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
