// Sentinels: label values that say the annotator did NOT call a cell.
//
// An annotator that stops where its markers stop has to write something for
// the cells it would not call, and the single-cell family writes EXCLUDED and
// UNRESOLVED. Those are label values, not cell types. The lab keeps the cells —
// they are real cells, and a reader must see where they sit — and lists the
// levels in the bundle's `sentinels` (scrnaseq-lab, src/lib/build.ts), in every
// part and in `collection.json`.
//
// Read as clusters, which is what a level in `clusters` has always been here,
// they took a share of every composition bar and of its denominator, a legend
// entry, a row of the marker plot and a place on both sides of every marker
// test. The family's rule is the opposite: never a population, a denominator,
// a per-label statistic or a legend entry as though it were one; never dropped;
// and the number of them said out loud.
//
// So a sentinel is a FLAG on its CellType, and nothing else moves. It keeps its
// index, so every array indexed by cell type keeps its length and no code that
// does not ask can trip over a gap — and every list of populations asks. A
// bundle that declares none marks nothing, and every caller then takes exactly
// the path it took before this file existed.

import type { Cell, CellType } from '../types.ts'

/**
 * How a sentinel cell is drawn: a neutral grey that sits under the types.
 *
 * Not a palette colour, because a palette colour is a claim that the cells
 * belong together the way a type's do. Mid-grey so that it recedes on the light
 * plate and is still visible on the dark one.
 */
export const SENTINEL_GREY = '#A3A3A3'

/**
 * The declared list, checked: the names that are also levels, once each.
 *
 * Absent is "none" — a bundle from the in-browser lab, or from before the field
 * existed. A field that is present and not a list of names is an error and says
 * so: a list half-read would leave some uncalled cells counted as a cell type,
 * which renders perfectly and is wrong. A name no level carries marks nothing;
 * a part of a collection may well not hold every sentinel the whole object has.
 */
export function declaredSentinels(raw: unknown, levels: readonly string[]): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || !raw.every(s => typeof s === 'string')) {
    throw new Error('meta.json\'s sentinels is not a list of cluster names')
  }
  const have = new Set(levels)
  return [...new Set(raw as string[])].filter(s => have.has(s))
}

/**
 * The same types, with the declared names flagged.
 *
 * Matched by NAME, so it serves whichever column is standing in as the cell
 * type: a sentinel is a label value, and a carried column that names the same
 * uncalled cells with the same word means the same thing by it. Returns the
 * very same array when nothing is marked, so a memo keyed on it holds and a
 * bundle without sentinels is the object it always was.
 */
export function markSentinels(types: CellType[], names: readonly string[] | undefined): CellType[] {
  if (!names?.length) return types
  const set = new Set(names)
  if (!types.some(t => set.has(t.name))) return types
  return types.map(t => (set.has(t.name) ? { ...t, sentinel: true } : t))
}

/** Is this cell type a population? */
export const isPopulation = (t: CellType | undefined): boolean => !!t && !t.sentinel

/** Indices of the types that are populations, in the object's order. */
export function populations(types: readonly CellType[]): number[] {
  const out: number[] = []
  types.forEach((t, i) => { if (!t.sentinel) out.push(i) })
  return out
}

/** The names a picker offers: every cell type, and no sentinel. */
export const populationNames = (types: readonly CellType[]): string[] =>
  types.filter(t => !t.sentinel).map(t => t.name)

/**
 * 1 for a sentinel type, per type index — or null when there is none.
 *
 * null is the signal callers use to keep their old code path: a bundle with no
 * sentinels never pays a per-cell lookup it does not need, and its arithmetic
 * is the arithmetic it always was.
 */
export function sentinelMask(types: readonly CellType[]): Uint8Array | null {
  if (!types.some(t => t.sentinel)) return null
  return Uint8Array.from(types, t => (t.sentinel ? 1 : 0))
}

/** The same mask, from level names and a declared list — for code that has no CellTypes yet. */
export function maskOfNames(levels: readonly string[], names: readonly string[]): Uint8Array | null {
  if (!names.length) return null
  const set = new Set(names)
  return levels.some(l => set.has(l)) ? Uint8Array.from(levels, l => (set.has(l) ? 1 : 0)) : null
}

/**
 * prop[sample][type]: each type's share of the sample's TYPED cells.
 *
 * The denominator is the sample's cells that carry a cell type, and a sentinel's
 * own share is 0 — the uncalled cells are not a slice of anybody's bar. With no
 * mask this is the sum it always was, in the same order, so the same doubles.
 */
export function proportions(grid: number[][], nSamples: number, mask: Uint8Array | null): number[][] {
  return Array.from({ length: nSamples }, (_s, si) => {
    const tot = grid.reduce((a, row, ti) => (mask?.[ti] ? a : a + row[si]), 0) || 1
    return grid.map((row, ti) => (mask?.[ti] ? 0 : row[si] / tot))
  })
}

/** How many cells carry each sentinel, and in all — the number every view states. */
export interface SentinelCount {
  total: number
  /** In the object's level order, only the sentinels that have cells. */
  by: { name: string; n: number }[]
}

export function sentinelCount(cells: readonly Cell[], types: readonly CellType[]): SentinelCount {
  const mask = sentinelMask(types)
  if (!mask) return { total: 0, by: [] }
  const n = new Int32Array(types.length)
  for (const c of cells) if (c.t >= 0 && c.t < n.length && mask[c.t]) n[c.t]++
  const by: { name: string; n: number }[] = []
  types.forEach((t, i) => { if (mask[i] && n[i]) by.push({ name: t.name, n: n[i] }) })
  return { total: by.reduce((a, b) => a + b.n, 0), by }
}

/** "EXCLUDED 10, UNRESOLVED 5" — the sentence fragment the views share. */
export const countText = (s: SentinelCount): string =>
  s.by.map(b => `${b.name} ${b.n.toLocaleString('en-US')}`).join(', ')

/** "EXCLUDED and UNRESOLVED" — the names alone. */
export const namesText = (s: SentinelCount): string => {
  const names = s.by.map(b => b.name)
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
