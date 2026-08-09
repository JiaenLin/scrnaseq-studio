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
import type { NonZeroWalk, Source } from './source.ts'

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
    gene: genes[x.gene], lfc: x.lfc, p: x.p, padj: x.padj, pct1: x.pct1, pct2: x.pct2,
  })),
  n0: r.n0,
  n1: r.n1,
})

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
  gene: number, each: NonZeroWalk, lab: Int8Array, n1: number, n2: number,
): RawRow | null {
  const xs: number[] = []
  const gs: number[] = []
  let d1 = 0, d2 = 0, s1 = 0, s2 = 0

  each((cell, value) => {
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

function finish(rows: RawRow[], nTested: number): RawRow[] {
  for (const r of rows) r.padj = Math.min(1, r.p * nTested)
  rows.sort((x, y) => x.padj - y.padj || Math.abs(y.lfc) - Math.abs(x.lfc))
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
  nUsed: number
  nGenes: number
}

/** The comparison a DEG table asks for, as numbers. */
export function wilcoxSpec(src: Source, ti: number, ctrl: string, cs: string): WilcoxSpec {
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
export function markersSpec(src: Source, cond?: string | null): MarkersSpec {
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
  return { owner, size, nUsed, nGenes: src.genes.length }
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
    empty: !n1 || !n2,
    n0: n2,
    n1,
    visit: (gene: number, each: NonZeroWalk) => {
      const r = testGene(gene, each, lab, n1, n2)
      if (r) rows.push(r)
    },
    done: (): RawResult => ({ rows: finish(rows, spec.nGenes), n0: n2, n1 }),
  }
}

export function deWilcox(src: Source, ti: number, ctrl: string, cs: string): DEResult {
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
    d1.fill(0); s1.fill(0)
    each((cell, value) => {
      const c = owner[cell]
      if (c < 0) return
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
      const n1 = size[c]
      const n2 = nUsed - n1
      if (!n1 || !n2) continue
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
      const rank = zeros + i + 1 + (groupSize - 1) / 2
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
      // The zero block contributes z1 cells at the mean rank of ranks 1..zeros.
      const p = rankFromSums(r1[c] + (n1 - d1[c]) * ((1 + zeros) / 2), n1, n2, tieSum)
      rows[c].push({ gene, lfc, p, padj: 1, pct1, pct2 })
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
function rankFromSums(r1: number, n1: number, n2: number, tieSum: number): number {
  const n = n1 + n2
  if (!n1 || !n2 || n < 3) return 1
  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2
  const varU = ((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1)))
  if (varU <= 0) return 1
  const z = (Math.abs(u - mu) - 0.5) / Math.sqrt(varU)
  return Math.min(1, 2 * normalTail(z))
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

/** One cluster against every other cell. Kept for tests and single-cluster use. */
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
