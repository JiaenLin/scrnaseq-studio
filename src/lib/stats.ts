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
import { condKey, type Conds, type NonZeroWalk, type Source } from './source.ts'

/** Cells a sample must contribute before it becomes a pseudobulk column. */
export const MIN_CELLS = 10
/** "> 3 replicates" before pseudobulk is offered at all. */
export const MIN_REPS_PB = 4
/** Seurat's logfc.threshold. */
export const LFC_GATE = 0.25
/** Seurat's min.pct. */
export const PCT_GATE = 0.1
/**
 * Seurat's min.cells.group: a side smaller than this is not tested at all.
 *
 * Refusing only the empty case is not the same convention, and the difference is
 * not academic. PreOPC at e18.0 (294 cells) against PreOPC at e12.5 (ONE cell)
 * returned 6 741 rows, 88 of them at adjusted p below 0.05, the best at 6e-61 —
 * and every one of those rows had pct.1 = 0.000 and pct.2 = 1.000, because the
 * whole result was a description of that one cell. The rank-sum is happy to
 * report it: with n2 = 1 the variance is small and the separation is perfect.
 * This atlas has 211 cluster x group combinations holding one or two cells, and
 * every one of them is reachable from the contrast picker.
 */
export const MIN_CELLS_GROUP = 3

/**
 * Upper tail of the standard normal.
 *
 * This was Abramowitz & Stegun 26.2.17, which is a 7.5e-8 ABSOLUTE approximation
 * — and absolute accuracy is worth nothing here, because the tail it is
 * approximating is 1e-20. Measured against scipy, the error it actually made was
 * 2.0 % relative at z = 6–10, 8.0 % at 10–20, 13.1 % at 20–30 and 16.2 % at
 * 30–38. It is monotone, so it never reordered a table, but every p past z ≈ 5
 * was wrong in its second significant figure and the atlas is full of them.
 *
 * The Chebyshev erfc below is accurate to 3.4e-13 RELATIVE over every z the
 * double can represent a tail for.
 *
 * The floor stays, and is now the only thing here that is not exact: past
 * z = 38.6 the tail is smaller than the smallest double and no arrangement of
 * this arithmetic will change that. `logNormalTail` is where the answer past
 * that point lives.
 */
export function normalTail(z: number): number {
  return Math.max(Number.MIN_VALUE, 0.5 * erfc(Math.abs(z) / Math.SQRT2))
}

/**
 * The same tail in logs, which does not underflow.
 *
 * exp(-z²/2) leaves the double at z = 38.6, so `normalTail` returns its floor
 * for every z past that and cannot tell 1e-330 from 1e-2174. On the atlas that
 * is not an edge case: 11.1 % of all rows and 96 % of the rows in a displayed
 * top ten sit on that floor, which is why the ranking, the volcano axis and the
 * combined score read this function instead.
 *
 * Below z = 2 the tail is O(1) and the erfc serves. Above it the Laplace
 * continued fraction
 *
 *     Q(x) = phi(x) / (x + 1/(x + 2/(x + 3/(x + ...))))
 *
 * converges quickly and never evaluates the tail itself. Measured against
 * scipy's log_ndtr on 5 892 points: 3.6e-12 absolute in the log over
 * z = 0.5..150, which is one to two ulp of the log value — at z = 150 the
 * -z²/2 term alone cannot be formed more accurately than that in a double.
 */
export function logNormalTail(z: number): number {
  const x = Math.abs(z)
  if (x < 2) return Math.log(0.5 * erfc(x / Math.SQRT2))
  let f = 0
  for (let k = 80; k >= 1; k--) f = k / (x + f)
  // log(1 / sqrt(2 * pi))
  return -0.5 * x * x - 0.9189385332046728 - Math.log(x + f)
}

/**
 * Chebyshev coefficients for erfc — Numerical Recipes 3rd ed. §6.2.2. Written to
 * the last digit a double actually holds, so that what is read here is what runs.
 * Module scope because `erfc` is called once per reported row.
 */
const ERFC_COF = [-1.3026537197817094, 6.419697923564902e-1, 1.9476473204185836e-2,
  -9.56151478680863e-3, -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5,
  -2.0278578112534e-5, -1.624290004647e-6, 1.30365583558e-6, 1.5626441722e-8,
  -8.5238095915e-8, 6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
  9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13,
  -1.12708e-13, 3.81e-16, 7.106e-15]

/**
 * Complementary error function for x >= 0.
 *
 * Only ever called with |z| / sqrt(2), so the reflection for negative x is not
 * written; it would be a branch nothing takes.
 */
function erfc(x: number): number {
  const t = 2 / (2 + x)
  const ty = 4 * t - 2
  let d = 0, dd = 0
  for (let j = ERFC_COF.length - 1; j > 0; j--) {
    const tmp = d; d = ty * d - dd + ERFC_COF[j]; dd = tmp
  }
  return t * Math.exp(-x * x + 0.5 * (ERFC_COF[0] + ty * d) - dd)
}

/** −log10 of the two-sided p, from the z statistic. This one never saturates. */
export const nlpFromZ = (z: number): number =>
  Math.max(0, -(logNormalTail(z) + Math.LN2) / Math.LN10)

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
 * A result row while it is still being computed, carrying the gene's index
 * rather than its name.
 *
 * Names are attached at the very end, by `named`. The reason is the worker: a
 * job crosses to it as numbers and comes back as numbers, and 31 053 gene names
 * have no business being copied into another thread and back to say which rows
 * won. Everything up to `named` is the same arithmetic either way.
 */
export interface RawRow {
  gene: number
  lfc: number
  p: number
  padj: number
  /**
   * −log10 of the adjusted p, carried alongside it because `padj` cannot hold
   * the answer. Filled in by `finish`, exactly as `padj` is; until then it is
   * −log10 of the RAW p. This is the significance the ranking, the volcano and
   * the combined score use — `p` and `padj` stay as they are so exports,
   * thresholds and everything a user reads keep their present meaning.
   */
  nlp: number
  /**
   * Benjamini–Hochberg, alongside the Bonferroni in `padj`.
   *
   * Seurat reports both — `p_val_adj` is Bonferroni over the genes tested, and
   * people routinely want the FDR as well, because Bonferroni over thirty
   * thousand genes is severe enough to hide real biology. Nothing in this app
   * changes meaning: `padj` is still what the thresholds cut on and what the
   * CSV has always called padj. This is a second column beside it.
   */
  fdr: number
  pct1: number
  pct2: number
}

export interface RawResult {
  rows: RawRow[]
  n0: number
  n1: number
}

/** Attach the gene names. The last step of every path, and the only one. */
export const named = (genes: readonly string[], r: RawResult): DEResult => ({
  rows: r.rows.map(x => ({
    gene: genes[x.gene], lfc: x.lfc, p: x.p, padj: x.padj, fdr: x.fdr, nlp: x.nlp,
    pct1: x.pct1, pct2: x.pct2,
  })),
  n0: r.n0,
  n1: r.n1,
})

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
 *
 * A walk yields STORED entries, and a stored entry is allowed to be 0 — a
 * scanpy .h5ad that was log1p'd in place keeps its explicit zeros. Such a value
 * is a zero like any other: it is not a detection, and it belongs in the zero
 * block rather than ranked above it.
 */
function testGene(
  gene: number, each: NonZeroWalk, lab: Int8Array, n1: number, n2: number,
): RawRow | null {
  const xs: number[] = []
  const gs: number[] = []
  let d1 = 0, d2 = 0, s1 = 0, s2 = 0

  each((cell, value) => {
    const g = lab[cell]
    if (g < 0 || value === 0) return
    xs.push(value)
    gs.push(g)
    if (g === 0) { d1++; s1 += Math.expm1(value) } else { d2++; s2 += Math.expm1(value) }
  })

  const pct1 = d1 / n1
  const pct2 = d2 / n2
  if (pct1 < PCT_GATE && pct2 < PCT_GATE) return null
  const lfc = Math.log2(s1 / n1 + 1) - Math.log2(s2 / n2 + 1)
  if (!Number.isFinite(lfc) || Math.abs(lfc) < LFC_GATE) return null

  const { p, nlp } = rankSumSparseFull(xs, gs, n1 - d1, n2 - d2)
  return { gene, lfc, p, padj: 1, fdr: 1, nlp, pct1, pct2 }
}

/**
 * Two-sided Wilcoxon rank-sum from the non-zero values plus the zero counts.
 *
 * `xs` holds the values that are not zero; `z1` and `z2` count the ones that
 * are, whether they were stored or merely absent. Passing a zero inside `xs`
 * would rank it as its own group beside the block it belongs to.
 */
export const rankSumSparse = (
  xs: number[], gs: number[], z1: number, z2: number,
): number => rankSumSparseFull(xs, gs, z1, z2).p

/** The same, keeping the log-scale significance the linear p cannot hold. */
export function rankSumSparseFull(
  xs: number[], gs: number[], z1: number, z2: number,
): { p: number; nlp: number } {
  const n1 = gs.reduce((k, g) => k + (g === 0 ? 1 : 0), 0) + z1
  const n2 = gs.length - (n1 - z1) + z2
  const n = n1 + n2
  if (!n1 || !n2 || n < 3) return { p: 1, nlp: 0 }
  const zeros = z1 + z2
  if (!xs.length) return { p: 1, nlp: 0 }

  const order = xs.map((_x, i) => i).sort((p, q) => xs[p] - xs[q])
  let nNeg = 0
  for (let k = 0; k < xs.length; k++) if (xs[k] < 0) nNeg++
  // The zero block sits above the negatives and below the positives, at ranks
  // nNeg+1..nNeg+zeros — one tie group of that size. On log-normalized data
  // nNeg is 0 and this is the familiar "zeros take ranks 1..zeros".
  let r1 = z1 * (nNeg + (1 + zeros) / 2)
  let tieSum = zeros > 1 ? zeros ** 3 - zeros : 0

  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++
    const size = j - i + 1
    const rank = (i < nNeg ? 0 : zeros) + i + 1 + (size - 1) / 2
    for (let k = i; k <= j; k++) if (gs[order[k]] === 0) r1 += rank
    if (size > 1) tieSum += size ** 3 - size
    i = j + 1
  }

  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2
  const varU = ((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1)))
  if (varU <= 0) return { p: 1, nlp: 0 }
  const z = (Math.abs(u - mu) - 0.5) / Math.sqrt(varU)
  return { p: Math.min(1, 2 * normalTail(z)), nlp: nlpFromZ(z) }
}

/**
 * Adjust, then rank.
 *
 * The sort key is `nlp`, not `padj`. They are the same ordering wherever `padj`
 * is a number — but past z = 38.46 `padj` is the Number.MIN_VALUE floor for
 * every row alike, and on the atlas that is 11% of all rows and 96% of every
 * displayed top ten. A sort on `padj` there is a sort on a constant, so the
 * order fell through to the |log2FC| tiebreak and the marker table's primary
 * key was doing nothing. `nlp` still separates those rows.
 */
function finish(rows: RawRow[], nTested: number): RawRow[] {
  const shift = Math.log10(nTested)

  /**
   * BH FIRST, and on its own ordering.
   *
   * This used to run after the display sort, reading its ranks off it. The
   * reasoning written here was that nlp descending IS p ascending, so the
   * ranks could be taken for free — and that is true of nlp, but the loop
   * above clamped `nlp` to 0 for every row with padj >= 1 BEFORE the sort. So
   * the key was constant across half the table, the order there fell through
   * to the |log2FC| tiebreak, and the step-up's running minimum then dragged
   * one small q up through thousands of unrelated rows.
   *
   * Measured on a 4 000-row simulation against a reference step-up: 57% of
   * rows disagreed, 678 rows with raw p > 0.05 reported an FDR below 0.05, and
   * a gene at p = 0.53 came out at 2.6e-4. An adversarial review found it by
   * checking against R's p.adjust; it is not subtle once looked for, and it
   * survived because the comment sounded like it had been thought about.
   *
   * The ordering is the UNCLAMPED nlp, descending — which is genuinely p
   * ascending, and separates rows whose p has bottomed out at the double's
   * floor where sorting on p itself would not. The denominator is nTested
   * rather than rows.length, because genes dropped by the effect-size
   * pre-filter were still tested.
   */
  const byP = [...rows].sort((a, b) => b.nlp - a.nlp)
  let prev = 1
  for (let i = byP.length - 1; i >= 0; i--) {
    prev = Math.min(prev, (byP[i].p * nTested) / (i + 1))
    byP[i].fdr = Math.min(1, prev)
  }

  // Only now: Bonferroni, and the display clamp that made the key unusable.
  for (const r of rows) {
    r.padj = Math.min(1, r.p * nTested)
    r.nlp = Math.max(0, r.nlp - shift)
  }
  rows.sort((x, y) => y.nlp - x.nlp || Math.abs(y.lfc) - Math.abs(x.lfc))
  return rows
}

/* ---------------- what a job is, apart from where it runs ---------------- */

/**
 * A question, stated in numbers only.
 *
 * These are what cross to the worker. They hold no closures, no Source and no
 * strings, so the same value can be built on the page, structured-cloned, and
 * answered on either side — and there is nothing in them a worker could
 * interpret differently.
 */
export interface WilcoxSpec {
  /** 0 = the "1" side (pct.1, fold-change numerator), 1 = control, -1 = not tested. */
  lab: Int8Array
  n1: number
  n2: number
  nGenes: number
}

export interface MarkersSpec {
  /** Per cell: its cluster, or -1 for a cell the condition filter excludes. */
  owner: Int32Array
  /** Cells per cluster, after that filter. */
  size: Int32Array
  /**
   * Which clusters to test. 1 for wanted, 0 to skip.
   *
   * It restricts what is REPORTED, never what a cluster is compared against:
   * every cluster's "rest" is still every other cell in the object, including
   * the cells of clusters nobody asked about. Narrowing the question must not
   * quietly change the answer to it.
   *
   * It is also where the saving is. The gates are evaluated before the sort and
   * a gene with no cluster passing skips the sort entirely — so asking about
   * two clusters instead of twenty-four discards, unsorted, every gene that
   * says nothing about those two. A gene expressed evenly everywhere has |lfc|
   * near zero for any single cluster, and those are the dense, expensive genes.
   */
  want: Uint8Array
  nUsed: number
  nGenes: number
}


/**
 * Is this condition on that side of the comparison?
 *
 * `null` means every condition, which is what the whole-object views pass.
 */
export const inConds = (cond: string, side: Conds): boolean =>
  (side == null ? true : typeof side === 'string' ? cond === side : side.includes(cond))

/** Two sides that share a condition are not two sides. */
export const sameOrOverlapping = (a: Conds, b: Conds): boolean => {
  const A = a == null ? [] : typeof a === 'string' ? [a] : a
  const B = b == null ? [] : typeof b === 'string' ? [b] : b
  if (!A.length || !B.length) return true
  return A.some(x => B.includes(x))
}

/** How a side reads in a caption: "6 h", or "6 h + 12 h". */
export const condLabel = (side: Conds): string =>
  (side == null ? 'all' : typeof side === 'string' ? side : side.join(' + '))

/**
 * The comparison a DEG table asks for, as numbers.
 *
 * Each side may be one condition or several unioned. Only the membership of the
 * two groups changes — the rank sums, the gates, the fold change and every
 * number below this are the same test on a different partition, so a comparison
 * of two single levels is byte-for-byte what it was before sets existed.
 */
export function wilcoxSpec(src: Source, ti: number, ctrl: Conds, cs: Conds): WilcoxSpec {
  // `a` is the "1" side: pct.1, and the numerator of the fold change.
  const a = src.group(ti, cs)
  const b = src.group(ti, ctrl)
  return {
    lab: labels(src.d.cells.length, a, b),
    n1: a.length,
    n2: b.length,
    nGenes: src.genes.length,
  }
}

/** Which cells take part in FindAllMarkers, and which cluster each belongs to. */
export function markersSpec(
  src: Source, cond?: string | null, want?: Iterable<number> | null,
): MarkersSpec {
  const nT = src.types.length
  const n = src.d.cells.length
  const owner = new Int32Array(n)
  const size = new Int32Array(nT)
  let nUsed = 0
  for (let i = 0; i < n; i++) {
    const c = src.d.cells[i]
    if (cond && c.cond !== cond) { owner[i] = -1; continue }
    owner[i] = c.t
    size[c.t]++
    nUsed++
  }
  // Absent means all of them, so an existing caller keeps its behaviour.
  const mask = new Uint8Array(nT)
  if (want == null) mask.fill(1)
  else for (const c of want) if (c >= 0 && c < nT) mask[c] = 1
  return { owner, size, want: mask, nUsed, nGenes: src.genes.length }
}

/**
 * FindMarkers: two groups within one cluster.
 *
 * Split into "set up the comparison" and "fold one gene in", so the same
 * arithmetic serves an object held in memory, one streamed off disk, and one
 * streamed inside a worker. There is no second implementation to drift.
 */
export function wilcoxPlan(spec: WilcoxSpec) {
  const { lab, n1, n2 } = spec
  const rows: RawRow[] = []
  return {
    empty: n1 < MIN_CELLS_GROUP || n2 < MIN_CELLS_GROUP,
    n0: n2,
    n1,
    visit: (gene: number, each: NonZeroWalk) => {
      const r = testGene(gene, each, lab, n1, n2)
      if (r) rows.push(r)
    },
    done: (): RawResult => ({ rows: finish(rows, spec.nGenes), n0: n2, n1 }),
  }
}

export function deWilcox(src: Source, ti: number, ctrl: Conds, cs: Conds): DEResult {
  const plan = wilcoxPlan(wilcoxSpec(src, ti, ctrl, cs))
  if (plan.empty || !src.scanSync((gi, each) => plan.visit(gi, each))) {
    return { rows: [], n0: plan.n0, n1: plan.n1 }
  }
  return named(src.genes, plan.done())
}

export async function deWilcoxAsync(
  src: Source, ti: number, ctrl: string, cs: string,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<DEResult> {
  const plan = wilcoxPlan(wilcoxSpec(src, ti, ctrl, cs))
  if (plan.empty) return { rows: [], n0: plan.n0, n1: plan.n1 }
  await src.scan(plan.visit, onProgress, cancelled)
  return named(src.genes, plan.done())
}

/**
 * FindAllMarkers: every cluster against every other cell, in one pass.
 *
 * On a single-condition object this is the only differential test there is, and
 * it is the one that answers "what is this cluster" — so it has to be a real
 * test, not the ranking-by-mean the dot plot uses for its colours.
 *
 * All clusters share one pass because they share the work. Comparing cluster c
 * against the rest sorts exactly the same values as comparing cluster c+1
 * against the rest — only the group labels differ — so the sort, the tie
 * correction and the zero block are computed once and each cluster's rank sum
 * accumulates alongside. The result is identical to running the test per
 * cluster, which `scripts/test-stats.mjs` asserts row for row; on a 64-cluster
 * object it is what makes the tab finish at all.
 */
export function markersPlan(spec: MarkersSpec) {
  const { owner, size, nUsed } = spec
  // Older callers and cached specs predate the mask; all clusters is what they
  // meant, and defaulting to none here would return an empty table in silence.
  const want = spec.want ?? new Uint8Array(size.length).fill(1)
  const nT = size.length
  const rows: RawRow[][] = Array.from({ length: nT }, () => [])

  // Reused across genes: a gene touches a few hundred cells and allocating
  // three arrays per gene per cluster is most of the cost otherwise.
  //
  // The values are held as their IEEE754 total-order key rather than as the
  // numbers, because the ordering is found by a radix sort. For a float32 bit
  // pattern b the key is (b | 0x80000000) when b is non-negative and ~b when it
  // is not, which sorts as a plain uint32 in exactly float order. Every Source
  // walks a Float32Array, so the round trip through `f32` loses nothing and
  // equal values keep equal bit patterns — the tie groups are the ones the
  // comparator sort found.
  //
  // This is the pass. Measured on the 292 495-cell atlas, the comparator sort
  // was 197 s of a 259 s marker run — 76 % of it, against 31 s of inflate and
  // 17 s of everything else. At 259 ns per non-zero it was the object; the radix
  // is 23 ns.
  let cap = 1024
  let keyA = new Uint32Array(cap)
  let keyB = new Uint32Array(cap)
  let whoA = new Int32Array(cap)
  let whoB = new Int32Array(cap)
  const cnt = new Uint32Array(256)
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  const r1 = new Float64Array(nT)
  const d1 = new Int32Array(nT)
  const s1 = new Float64Array(nT)
  // Which clusters passed the gates, so the tail loop tests nothing twice.
  const pass = new Int32Array(nT)

  const visit = (gene: number, each: NonZeroWalk) => {
    let m = 0
    let sAll = 0
    let nNeg = 0
    d1.fill(0); s1.fill(0)
    each((cell, value) => {
      const c = owner[cell]
      // A stored 0 is a zero, not a detection — see testGene. Skipping it here
      // is what keeps `zeros` below equal to the number of cells at zero.
      if (c < 0 || value === 0) return
      if (value < 0) nNeg++
      if (m === cap) {
        cap *= 2
        const nk = new Uint32Array(cap); nk.set(keyA); keyA = nk
        keyB = new Uint32Array(cap)
        const nw = new Int32Array(cap); nw.set(whoA); whoA = nw
        whoB = new Int32Array(cap)
      }
      f32[0] = value
      const bits = u32[0]
      keyA[m] = (bits & 0x80000000) ? (~bits) >>> 0 : (bits | 0x80000000) >>> 0
      whoA[m] = c
      m++
      d1[c]++
      const e = Math.expm1(value)
      s1[c] += e
      sAll += e
    })
    if (!m) return

    // The gates first. Everything they read — d1, s1, sAll, m — is already in
    // hand, and a gene no cluster can report is a gene that need not be sorted.
    // 43 % of the atlas's genes are in that state.
    let nPass = 0
    for (let c = 0; c < nT; c++) {
      if (!want[c]) continue
      const n1 = size[c]
      const n2 = nUsed - n1
      if (n1 < MIN_CELLS_GROUP || n2 < MIN_CELLS_GROUP) continue
      const pct1 = d1[c] / n1
      const pct2 = (m - d1[c]) / n2
      if (pct1 < PCT_GATE && pct2 < PCT_GATE) continue
      const lfc = Math.log2(s1[c] / n1 + 1) - Math.log2((sAll - s1[c]) / n2 + 1)
      if (!Number.isFinite(lfc) || Math.abs(lfc) < LFC_GATE) continue
      pass[nPass++] = c
    }
    if (!nPass) return

    // LSD radix, four bytes. A byte that is the same in every key — which the
    // exponent usually is — costs one counting pass and no movement.
    let sk = keyA, sw = whoA, dk = keyB, dw = whoB
    for (let shift = 0; shift < 32; shift += 8) {
      cnt.fill(0)
      for (let i = 0; i < m; i++) cnt[(sk[i] >>> shift) & 255]++
      if (cnt[(sk[0] >>> shift) & 255] === m) continue
      let at = 0
      for (let b = 0; b < 256; b++) { const c = cnt[b]; cnt[b] = at; at += c }
      for (let i = 0; i < m; i++) {
        const j = cnt[(sk[i] >>> shift) & 255]++
        dk[j] = sk[i]; dw[j] = sw[i]
      }
      const tk = sk; sk = dk; dk = tk
      const tw = sw; sw = dw; dw = tw
    }
    // Keep whichever pair the last pass landed in; both are ours either way.
    keyA = sk; whoA = sw; keyB = dk; whoB = dw

    r1.fill(0)
    const zeros = nUsed - m
    let tieSum = zeros > 1 ? zeros ** 3 - zeros : 0
    let i = 0
    while (i < m) {
      let j = i
      const key = sk[i]
      while (j + 1 < m && sk[j + 1] === key) j++
      const groupSize = j - i + 1
      // The zero block sits above the negatives, at ranks nNeg+1..nNeg+zeros.
      const rank = (i < nNeg ? 0 : zeros) + i + 1 + (groupSize - 1) / 2
      for (let k = i; k <= j; k++) r1[sw[k]] += rank
      if (groupSize > 1) tieSum += groupSize ** 3 - groupSize
      i = j + 1
    }

    for (let q = 0; q < nPass; q++) {
      const c = pass[q]
      const n1 = size[c]
      const n2 = nUsed - n1
      const pct1 = d1[c] / n1
      const pct2 = (m - d1[c]) / n2
      const lfc = Math.log2(s1[c] / n1 + 1) - Math.log2((sAll - s1[c]) / n2 + 1)
      // The zero block contributes this cluster's z1 cells at its mean rank.
      const { p, nlp } = rankFromSums(
        r1[c] + (n1 - d1[c]) * (nNeg + (1 + zeros) / 2), n1, n2, tieSum)
      rows[c].push({ gene, lfc, p, padj: 1, fdr: 1, nlp, pct1, pct2 })
    }
  }

  return {
    empty: !nUsed,
    visit,
    done: (): RawResult[] => rows.map((rs, c) => ({
      rows: finish(rs, spec.nGenes), n0: nUsed - size[c], n1: size[c],
    })),
  }
}

/** The tail of the rank-sum test, once the group's rank total is known. */
function rankFromSums(
  r1: number, n1: number, n2: number, tieSum: number,
): { p: number; nlp: number } {
  const n = n1 + n2
  if (!n1 || !n2 || n < 3) return { p: 1, nlp: 0 }
  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2
  const varU = ((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1)))
  if (varU <= 0) return { p: 1, nlp: 0 }
  const z = (Math.abs(u - mu) - 0.5) / Math.sqrt(varU)
  return { p: Math.min(1, 2 * normalTail(z)), nlp: nlpFromZ(z) }
}

/** Every cluster's markers, synchronously. Empty when the source is lazy. */
export function deMarkersAll(src: Source, cond?: string | null): DEResult[] {
  const plan = markersPlan(markersSpec(src, cond))
  const blank = src.types.map(() => ({ rows: [], n0: 0, n1: 0 }))
  if (plan.empty || !src.scanSync(plan.visit)) return blank
  return plan.done().map(r => named(src.genes, r))
}

export async function deMarkersAllAsync(
  src: Source, cond: string | null | undefined,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<DEResult[]> {
  const plan = markersPlan(markersSpec(src, cond))
  if (plan.empty) return src.types.map(() => ({ rows: [], n0: 0, n1: 0 }))
  await src.scan(plan.visit, onProgress, cancelled)
  return plan.done().map(r => named(src.genes, r))
}

/**
 * One cluster against every other cell. Kept for tests and single-cluster use.
 *
 * Deliberately without the MIN_CELLS_GROUP floor that `markersPlan` and
 * `wilcoxPlan` apply. This is the per-cluster reference the one-pass
 * implementation is checked against, and a reference carrying the same policy as
 * the thing it is checking would agree with it for the wrong reason. The floor
 * belongs at the entry points the app reaches — which are those two plans, both
 * of which the worker consults before it scans anything; nothing in src/ calls
 * this.
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
  const plan = wilcoxPlan({
    lab: labels(src.d.cells.length, a, b),
    n1: a.length, n2: b.length, nGenes: src.genes.length,
  })
  if (!src.scanSync(plan.visit)) return { rows: [], n0: b.length, n1: a.length }
  return named(src.genes, plan.done())
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
  src: Source, ti: number, ctrl: Conds, cs: Conds,
): PseudobulkColumn[] {
  if (!src.pseudobulk) return []
  const cluster = src.clusters[ti]
  const condOf = new Map(src.d.samples.map(s => [s.id, s.cond]))
  return src.pseudobulk.columns
    .map(c => ({ ...c, cond: condOf.get(c.sample) ?? '' }))
    .filter(c => c.cluster === cluster
      && (inConds(c.cond, ctrl) || inConds(c.cond, cs))
      && c.nCells >= MIN_CELLS)
}

/** Which samples of a cluster are usable, and whether pseudobulk is defensible. */
export function designFor(src: Source, ti: number, ctrl: Conds, cs: Conds): Design {
  const counts = new Map<string, number>()
  for (const c of src.d.cells) {
    if (c.t === ti) counts.set(c.s, (counts.get(c.s) ?? 0) + 1)
  }
  const used = src.d.samples
    .map(s => ({ ...s, n: counts.get(s.id) ?? 0 }))
    .filter(s => inConds(s.cond, ctrl) || inConds(s.cond, cs))
  const kept = used.filter(s => s.n >= MIN_CELLS)
  const n0 = kept.filter(s => inConds(s.cond, ctrl)).length
  const n1 = kept.filter(s => inConds(s.cond, cs)).length
  return {
    used, kept, n0, n1,
    // Overlapping sides would put the same cells on both, which is not a
    // comparison — the same guard the single-level form had, generalised.
    pbOK: n0 >= MIN_REPS_PB && n1 >= MIN_REPS_PB && !sameOrOverlapping(ctrl, cs),
  }
}

/** Smallest number of samples any group has — decides which tests are offered. */
export const minReplicates = (src: Source): number =>
  Math.min(...src.d.conds.map(c => src.d.samples.filter(s => s.cond === c).length))

/** Key a computed pseudobulk run, stable across cluster renaming. */
export const pbKey = (t: CellType, ctrl: Conds, cs: Conds) =>
  `${t.key}|${condKey(ctrl)}|${condKey(cs)}`

/**
 * Signed ranking metric: −log10(p) × log2FC.
 *
 * Sorting by p alone puts a tiny, highly significant change above a large one;
 * sorting by fold change alone promotes noise. The product keeps both, and its
 * sign keeps the direction, so one column orders a table sensibly.
 *
 * It takes `nlp`, not `p`. Taking −log10 of a saturated p gives 323 for every
 * row that saturated, so this column reported 323 × log2FC — a fold-change
 * ranking wearing a significance column's name — for 96% of every displayed top
 * ten on the atlas. The old `p <= 0 ? 300` guard never fired at all: normalTail
 * is floored at MIN_VALUE and so never returns zero.
 */
export function combinedScore(lfc: number, nlp: number): number | null {
  if (!Number.isFinite(lfc) || !Number.isFinite(nlp)) return null
  return nlp * lfc
}
