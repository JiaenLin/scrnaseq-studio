// Small numeric helpers shared by every figure.

import type { CellType, Dataset, Identity } from '../types.ts'
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
  const m = Math.max(...out) || 1
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

/** Shared axis extent for the embedding, so split panels never rescale. */
export function embedExtent(d: Dataset) {
  const xs = d.cells.map(c => c.x)
  const ys = d.cells.map(c => c.y)
  return {
    x0: Math.min(...xs) - 0.4, x1: Math.max(...xs) + 0.4,
    y0: Math.min(...ys) - 0.4, y1: Math.max(...ys) + 0.4,
  }
}
