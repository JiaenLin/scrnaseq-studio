// Small numeric helpers shared by every figure.

import type { Cell, CellType, Dataset, Identity } from '../types.ts'
import { pal, type PaletteKey } from './palette.ts'
import { hash, meanExpr, rng } from './demo.ts'

export const fmt = (n: number) => n.toLocaleString('en-US')

const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** p-values as 1.2 × 10⁻⁶¹ rather than 1.2e-61 — this text ends up in figures. */
export const sci = (p: number): string =>
  p >= 1e-4
    ? p.toPrecision(2)
    : p.toExponential(1).replace(/e-(\d+)/, (_m, d: string) =>
        ' × 10⁻' + d.split('').map(c => SUPS[+c]).join(''))

export const pctTxt = (v: number): string =>
  !v ? '0%'
    : v >= 0.1 ? `${(v * 100).toFixed(0)}%`
    : v >= 0.01 ? `${(v * 100).toFixed(1)}%`
    : `${(v * 100).toFixed(2)}%`

export interface Quantiles { min: number; q1: number; med: number; q3: number; max: number }

export function quantiles(arr: number[]): Quantiles {
  const a = [...arr].sort((x, y) => x - y)
  const q = (f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))]
  return { min: a[0], q1: q(0.25), med: q(0.5), q3: q(0.75), max: a[a.length - 1] }
}

/** Kernel density profile normalized to half-width 1, for a violin outline. */
export function density(arr: number[], lo: number, hi: number, steps = 26): number[] {
  const h = (hi - lo) / 14 || 1
  const step = Math.max(1, Math.floor(arr.length / 300))
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps
    let s = 0
    for (let k = 0; k < arr.length; k += step) {
      const z = (arr[k] - x) / h
      s += Math.exp(-0.5 * z * z)
    }
    out.push(s)
  }
  const m = maxOf(out) || 1
  return out.map(v => v / m)
}

/**
 * A "nice" axis step — 1, 1.5, 2, 2.5, 3, 4, 5, 7.5 or 10 times a power of ten.
 * Every small-multiple has a different maximum; without this the ticks come out
 * as 39% and 9.7% and no two panels can be compared at a glance.
 */
export function niceStep(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v || 1e-6)))
  const m = v / e
  const n = m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 2.5 ? 2.5
    : m <= 3 ? 3 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 7.5 ? 7.5 : 10
  return n * e
}

/** Per-cell values for one gene in one cluster and group, for a violin. */
export function sampleValues(
  gene: string, ti: number, cond: string, act: number, n = 150,
): number[] {
  const m = meanExpr(gene, ti, act)
  const G = rng(hash(`${gene}|${ti}|${cond}`))
  const drop = Math.exp(-m * 1.15)
  return Array.from({ length: n }, () =>
    G() < drop ? 0 : m * (0.35 + G() * 1.5) + G() * 0.12)
}

/**
 * The rows of the categorical axis, shared by every plot in the gene tab so the
 * views can never disagree about what they are showing.
 */
export function identities(
  d: Dataset, types: CellType[], groupBy: 'type' | 'cond' | 'both',
  ct: string, palKey: PaletteKey,
): Identity[] {
  if (groupBy === 'type')
    return types.map((t, ti) => ({
      label: t.name, full: t.name, color: pal(ti, palKey), ti, cond: d.conds[0],
    }))
  if (groupBy === 'cond') {
    const ti = Math.max(0, types.findIndex(t => t.name === ct))
    return d.conds.map((c, ci) => ({
      label: c, full: `${types[ti]?.name ?? ct} · ${c}`, color: pal(ci, palKey), ti, cond: c,
    }))
  }
  return types.flatMap((t, ti) =>
    d.conds.map((c, ci) => ({
      label: c, full: `${t.name} · ${c}`, color: pal(ti, palKey),
      dim: d.conds.length > 1 ? ci / (d.conds.length - 1) : 1,
      ti, cond: c,
    })))
}

/**
 * Smallest and largest of a list, without spreading it into a call.
 *
 * `Math.min(...xs)` passes every element as an argument, and V8 refuses past
 * about 124,000 of them — measured between 124,000 and 125,000. A per-cell
 * array crosses that at 124k cells and throws RangeError, which unmounts the
 * React tree and leaves a blank white page with no message. An atlas has
 * 292,495 cells, so every per-cell extent has to be computed by loop.
 */
export function minOf(xs: ArrayLike<number>, fallback = 0): number {
  let m = Infinity
  for (let i = 0; i < xs.length; i++) if (xs[i] < m) m = xs[i]
  return Number.isFinite(m) ? m : fallback
}

export function maxOf(xs: ArrayLike<number>, fallback = 0): number {
  let m = -Infinity
  for (let i = 0; i < xs.length; i++) if (xs[i] > m) m = xs[i]
  return Number.isFinite(m) ? m : fallback
}

/**
 * The largest value across a list of lists.
 *
 * `Math.max(...rows.flat())` is the same bug twice: the spread throws past
 * ~124,000 arguments, and `flat()` first materialises the million numbers it is
 * going to throw on. A violin panel of 133 clusters × 20 groups × 400 sampled
 * cells goes through here.
 */
export function maxOfAll(rows: readonly ArrayLike<number>[], fallback = 0): number {
  let m = -Infinity
  for (const r of rows) for (let i = 0; i < r.length; i++) if (r[i] > m) m = r[i]
  return Number.isFinite(m) ? m : fallback
}

/**
 * A colour ceiling one outlier cannot set: the qth percentile of the cells that
 * express the gene at all.
 *
 * Typed from end to end. Written as `Array.from(v).filter(x => x > 0).sort()` it
 * boxed 292 495 doubles into a JS array and then sorted them with a callback —
 * on the atlas that was most of the cost of colouring the embedding by a gene,
 * and it ran during render, so the frame that should have shown the new gene
 * was the frame that was busy sorting. Same values, same order, same answer.
 */
export function nonZeroPercentile(v: Float32Array, q: number): number {
  let n = 0
  for (let i = 0; i < v.length; i++) if (v[i] > 0) n++
  if (!n) return 1
  const nz = new Float32Array(n)
  let k = 0
  for (let i = 0; i < v.length; i++) if (v[i] > 0) nz[k++] = v[i]
  nz.sort()
  return nz[Math.floor(n * q)]
}


/**
 * A drawable axis range for values that may all be the same.
 *
 * A covariate the object does not carry comes through as a flat zero — the QC
 * panel shows a mitochondrial fraction of 0 for every cell when there was no
 * such column. Then lo === hi, the padding is zero, and every coordinate is
 * (v - y0) / 0, which is NaN. SVG rejects that attribute by attribute, so the
 * chart half-draws and the console fills with "Expected length, NaN" while the
 * numbers beside it are perfectly correct.
 */
export function axisRange(
  lo: number, hi: number, { fromZero = false } = {},
): { y0: number; y1: number } {
  const span = hi - lo
  const pad = span > 0 ? span * 0.04 : Math.max(Math.abs(hi) * 0.04, 0.5)
  const y0 = fromZero ? Math.max(0, lo - pad) : lo - pad
  const y1 = hi + pad
  return { y0, y1: y1 > y0 ? y1 : y0 + 1 }
}

/**
 * Remembered per Dataset, because a Dataset never changes and these do not
 * either.
 *
 * Both of the functions below walk every cell, and both are called from inside
 * a canvas effect — so on an atlas they were a 292 495-cell pass per redraw,
 * repeated for every panel of a split view. Nothing about the answer depends on
 * anything but `d`, so computing it more than once was only ever a cost.
 */
const EXTENT = new WeakMap<Float32Array, ReturnType<typeof computeExtent>>()
const CENTROIDS = new WeakMap<Float32Array, Map<number, { x: number; y: number }[]>>()
const BY_SAMPLE = new WeakMap<Dataset, number[][]>()

/**
 * The cells of each sample, in one pass, remembered.
 *
 * The QC card draws three panels and each was filtering every cell once per
 * sample — samples × cells × 3. The buckets do not depend on which covariate is
 * being drawn, so they are found once and the panels differ only in what they
 * read out of them.
 */
export function cellsBySample(d: Dataset): number[][] {
  let hit = BY_SAMPLE.get(d)
  if (hit) return hit
  const slot = new Map(d.samples.map((s, i) => [s.id, i]))
  hit = d.samples.map<number[]>(() => [])
  for (let i = 0; i < d.cells.length; i++) {
    const k = slot.get(d.cells[i].s)
    if (k !== undefined) hit[k].push(i)
  }
  BY_SAMPLE.set(d, hit)
  return hit
}

function computeExtent(xy: Float32Array) {
  // Read in one pass rather than materialising two 292k-element arrays first.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < x0) x0 = xy[i]
    if (xy[i] > x1) x1 = xy[i]
    if (xy[i + 1] < y0) y0 = xy[i + 1]
    if (xy[i + 1] > y1) y1 = xy[i + 1]
  }
  const fin = (v: number) => (Number.isFinite(v) ? v : 0)
  return {
    x0: fin(x0) - 0.4, x1: fin(x1) + 0.4,
    y0: fin(y0) - 0.4, y1: fin(y1) + 0.4,
  }
}

/**
 * Shared axis extent for one embedding, so split panels never rescale.
 *
 * Keyed on the coordinate array rather than the Dataset, because an object can
 * carry several embeddings of the same cells and each has its own range — a UMAP
 * drawn inside a t-SNE's extent is a plot of nothing.
 */
export function embedExtent(xy: Float32Array) {
  let hit = EXTENT.get(xy)
  if (!hit) { hit = computeExtent(xy); EXTENT.set(xy, hit) }
  return hit
}

/**
 * Where to write each cluster's name on the embedding.
 *
 * The demo generator knows where it put a cluster; a bundle does not, so the
 * label position has to come from the cells themselves. Medians rather than
 * means, because a handful of cells stranded on the far side of a UMAP would
 * otherwise drag the label into empty space.
 */
export function clusterCentroids(
  xy: Float32Array, d: Dataset, nTypes: number,
): { x: number; y: number }[] {
  let per = CENTROIDS.get(xy)
  if (!per) { per = new Map(); CENTROIDS.set(xy, per) }
  const hit = per.get(nTypes)
  if (hit) return hit
  const out = computeCentroids(xy, d, nTypes)
  per.set(nTypes, out)
  return out
}

function computeCentroids(
  xy: Float32Array, d: Dataset, nTypes: number,
): { x: number; y: number }[] {
  const xs: number[][] = Array.from({ length: nTypes }, () => [])
  const ys: number[][] = Array.from({ length: nTypes }, () => [])
  d.cells.forEach((c, i) => {
    if (c.t < nTypes) { xs[c.t].push(xy[2 * i]); ys[c.t].push(xy[2 * i + 1]) }
  })
  const mid = (v: number[]) => {
    if (!v.length) return 0
    const s = [...v].sort((a, b) => a - b)
    return s[s.length >> 1]
  }
  return xs.map((v, i) => ({ x: mid(v), y: mid(ys[i]) }))
}

/**
 * Does this covariate actually carry a measurement?
 *
 * A bundle always has a QC block — the exporter writes three floats per cell
 * whether or not the object had anything to put in them — so "the field exists"
 * is not the same question as "there is something here to look at". An object
 * with no mitochondrial genes annotated arrives with a column of zeros, and a
 * map coloured by it is a uniform grey plane with a low-to-high scale under it,
 * which says there is a gradient the reader simply cannot see.
 *
 * Stops at the first cell that differs, so on an object where the covariate is
 * real this costs a handful of comparisons rather than a pass over the cells.
 */
export function hasSignal(cells: readonly Cell[], get: (c: Cell) => number): boolean {
  if (!cells.length) return false
  const first = get(cells[0])
  for (let i = 1; i < cells.length; i++) {
    const v = get(cells[i])
    if (v !== first && Number.isFinite(v)) return true
  }
  return false
}
