// Which carried column counts as the cell type, and which as the group.
//
// A bundle names one column "cell type" and one "group", chosen in the lab at
// convert time. That choice is often right and sometimes not: an object may
// carry `cell.type` and `sub.cluster`, or be grouped by disease when the
// question is about sex, and until now the only way to ask the other question
// was to convert the file again.
//
// It does not need converting again, because the columns are already there.
// The lab writes every extra column the reader ticked as one code per cell —
// see `CellColumns` — so re-pointing a role is arithmetic on arrays that are
// already in memory. Measured at heart-atlas scale, 1.2 M cells and 43 types:
// 4 ms to re-point every cell and 64 ms to rebuild the composition grid. It is
// a view setting that happens to look like a structural one.
//
// What it is NOT is free of consequence, and both consequences are handled
// here rather than left to be discovered:
//
//   - A group has to be a property of the SAMPLE, not of the cell. The
//     pseudobulk design counts samples per group, and `d.samples[].cond` is
//     what every replicate-based check reads. So a column is offered for the
//     group role only if it is constant within every sample; `groupable` is
//     that test, and it is one pass.
//   - The exported pseudobulk table is keyed by the cluster names the lab
//     wrote. Re-pointing the cell type leaves those keys unmatched, so the
//     pseudobulk EXPORT goes quiet — the per-cell Wilcoxon is unaffected,
//     because it reads cells rather than that table.

import type { CellType, Cell, Dataset } from '../types.ts'
import { cellColumns, type ExtraColumn } from './bundle.ts'
import type { Source } from './source.ts'

/** A column that could stand in for a role, and what it is called. */
export interface RoleOption {
  /** Index into `cellColumns(d).extras`, or -1 for the object's own choice. */
  at: number
  key: string
  levels: number
}

/**
 * The columns that could be the cell type.
 *
 * Any categorical column will do: a cell type is a label on a cell and nothing
 * downstream requires more of it than that.
 */
export function typeOptions(d: Dataset, current: string): RoleOption[] {
  const extras = cellColumns(d).extras
  return [
    { at: -1, key: current, levels: 0 },
    ...extras.map((c, i) => ({ at: i, key: c.key, levels: c.levels.length })),
  ]
}

/**
 * Is this column constant within every sample?
 *
 * The question that decides whether it can be a GROUP. A group that varies
 * inside a sample is not a group any replicate-based test can use: pseudobulk
 * would put one sample's cells on both sides of its own comparison, and
 * `designFor` would count the same animal twice. One pass, and cheap enough to
 * ask of every column every time the menu opens.
 */
export function groupable(d: Dataset, col: ExtraColumn): boolean {
  const seen = new Map<string, number>()
  for (let i = 0; i < d.cells.length; i++) {
    const s = d.cells[i].s
    const code = col.codes[i]
    const had = seen.get(s)
    if (had === undefined) seen.set(s, code)
    else if (had !== code) return false
  }
  return true
}

export function groupOptions(d: Dataset, current: string): RoleOption[] {
  const extras = cellColumns(d).extras
  return [
    { at: -1, key: current, levels: d.conds.length },
    ...extras
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => groupable(d, c))
      .map(({ c, i }) => ({ at: i, key: c.key, levels: c.levels.length })),
  ]
}

/**
 * The same object with one or both roles re-pointed.
 *
 * A NEW Dataset and new cells, never a mutation: `Source`'s accessors close
 * over the cells they were built with and its group lookups are cached by
 * `ti|cond`, so changing a cell's type underneath them would leave every cached
 * answer describing an arrangement that no longer exists. `rebind` on the
 * source is what swaps the Dataset while keeping the matrix — the expensive
 * half, which has not changed at all.
 *
 * Returns the source unchanged when neither role moves, so a memo keyed on it
 * holds and nothing re-renders.
 */
export function withRoles(
  src: Source, typeAt: number, groupAt: number,
): { src: Source; types: CellType[] } {
  const base = { src, types: src.types }
  if (typeAt < 0 && groupAt < 0) return base
  if (!src.rebind) return base

  const d = src.d
  const extras = cellColumns(d).extras
  const tCol = typeAt >= 0 ? extras[typeAt] : null
  const gCol = groupAt >= 0 ? extras[groupAt] : null
  if (!tCol && !gCol) return base

  const types: CellType[] = tCol
    ? tCol.levels.map(name => ({ name, key: name, cx: 0, cy: 0, sd: 0, base: 0, resp: 0, mk: [] }))
    : src.types

  const conds = gCol ? gCol.levels.slice() : d.conds
  const act: Record<string, number> = {}
  conds.forEach((c, i) => { act[c] = conds.length > 1 ? i / (conds.length - 1) : 0 })

  const cells: Cell[] = new Array(d.cells.length)
  for (let i = 0; i < d.cells.length; i++) {
    const c = d.cells[i]
    const cond = gCol ? gCol.levels[gCol.codes[i]] ?? c.cond : c.cond
    cells[i] = tCol || gCol
      ? { ...c, t: tCol ? tCol.codes[i] : c.t, cond, a: act[cond] ?? 0 }
      : c
  }

  // The sample's group follows the cells', which `groupable` has already made
  // unambiguous — every cell of a sample carries the same level, so the first
  // one is the sample's.
  const firstOf = new Map<string, string>()
  if (gCol) for (const c of cells) if (!firstOf.has(c.s)) firstOf.set(c.s, c.cond)
  const samples = gCol
    ? d.samples.map(s => ({ ...s, cond: firstOf.get(s.id) ?? s.cond }))
    : d.samples

  const nT = types.length
  const grid = Array.from({ length: nT }, () => new Array(samples.length).fill(0))
  const sampleAt = new Map(samples.map((s, i) => [s.id, i]))
  for (const c of cells) {
    const si = sampleAt.get(c.s)
    if (si !== undefined && c.t >= 0 && c.t < nT) grid[c.t][si]++
  }
  const prop = samples.map((_s, si) => {
    const tot = grid.reduce((a, row) => a + row[si], 0) || 1
    return grid.map(row => row[si] / tot)
  })
  const nPerCond: Record<string, number> = {}
  for (const c of conds) nPerCond[c] = 0
  for (const c of cells) nPerCond[c.cond] = (nPerCond[c.cond] ?? 0) + 1

  const next: Dataset = {
    ...d, cells, conds, act, samples, grid, prop, nPerCond,
    multi: conds.length > 1,
  }
  // The extras travel with it: re-pointing one role must not cost the menu the
  // ability to re-point the other, or to go back.
  Object.assign(next, { columns: cellColumns(d) })
  return { src: src.rebind(next, types), types }
}
