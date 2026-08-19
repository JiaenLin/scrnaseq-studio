// The populations a gene-set figure is broken down by.
//
// Not `identities()` from chart.ts, and the difference is the bug this file
// exists to fix. That function answers "which rows does the GENE tab draw",
// where "across groups" legitimately means *within the cell type selected
// beside the figure* — the violin panel is showing one population's response to
// a treatment, and the cell type is a parameter of it.
//
// A module score across groups is a different question. "How does this
// signature move between aged_HFD and aged_chow" is asked of the whole object,
// and answering it for whichever cell type happened to be selected in a bar at
// the top of the page is a figure that looks like the first question and is
// the second. Reported as exactly that: the columns were restricted to one cell
// type and nothing said so.
//
// So a column here carries its own CELLS rather than a (cell type, group) pair.
// That is what lets "across groups" pool every selected cell type, which no
// pair can express — `src.group(ti, cond)` has no "all types" to pass.

import type { Cell, CellType, Dataset, GroupBy } from '../types.ts'
import { pal, type PaletteKey } from './palette.ts'

export interface Column {
  key: string
  /** What the axis says. */
  label: string
  /** What a tooltip and the CSV say. */
  full: string
  color: string
  /** Indices of the cells in this column, ascending. */
  cells: number[]
}

/**
 * The columns, and the cells in each, in one pass.
 *
 * `keepT` and `keepC` are the reader's filters — null for "everything". A
 * column that ends up empty is dropped rather than drawn: a blank stripe in a
 * heatmap reads as a score of zero, which is a claim, where the truth is that
 * the object holds no cells of that combination. On a real annotation the cell
 * type x group product is mostly empty, so this is the common case rather than
 * an edge one.
 */
export function scoreColumns(
  d: Dataset,
  types: CellType[],
  mode: GroupBy,
  palKey: PaletteKey,
  keepT: ReadonlySet<number> | null,
  keepC: ReadonlySet<string> | null,
): Column[] {
  const okT = (t: number) => t >= 0 && t < types.length && (!keepT || keepT.has(t))
  const okC = (c: string) => !keepC || keepC.has(c)
  const condAt = new Map(d.conds.map((c, i) => [c, i]))

  /** Where each cell goes, and the column list it goes into. */
  const out: Column[] = []
  const slot = new Map<number, number>()
  const at = (k: number, make: () => Omit<Column, 'cells'>) => {
    let i = slot.get(k)
    if (i === undefined) {
      i = out.length
      slot.set(k, i)
      out.push({ ...make(), cells: [] })
    }
    return i
  }

  // Built in the object's own order rather than in the order cells happen to
  // appear, so the axis does not reshuffle when a filter changes.
  if (mode === 'type') {
    types.forEach((t, ti) => {
      if (okT(ti)) at(ti, () => ({ key: t.key, label: t.name, full: t.name, color: pal(ti, palKey) }))
    })
  } else if (mode === 'cond') {
    d.conds.forEach((c, ci) => {
      if (okC(c)) at(ci, () => ({ key: c, label: c, full: c, color: pal(ci, palKey) }))
    })
  } else {
    types.forEach((t, ti) => {
      if (!okT(ti)) return
      d.conds.forEach(c => {
        if (!okC(c)) return
        at(ti * d.conds.length + (condAt.get(c) ?? 0), () => ({
          key: `${t.key}|${c}`, label: `${t.name} · ${c}`, full: `${t.name} · ${c}`,
          color: pal(ti, palKey),
        }))
      })
    })
  }

  const cells: readonly Cell[] = d.cells
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (!okT(c.t) || !okC(c.cond)) continue
    const ci = condAt.get(c.cond)
    if (ci === undefined) continue
    const k = mode === 'type' ? c.t : mode === 'cond' ? ci : c.t * d.conds.length + ci
    const at2 = slot.get(k)
    if (at2 !== undefined) out[at2].cells.push(i)
  }
  return out.filter(c => c.cells.length > 0)
}

/**
 * Every row z-scored across the columns SHOWN.
 *
 * The same rule the per-gene heatmap follows, and for the same reason: a
 * z-score says where a signature is highest among the columns on screen, so
 * dropping a cell type has to change the scale. Scaling before filtering would
 * leave a row's remaining columns pushed to one end by a mean that includes a
 * column the reader has taken away.
 *
 * A row with no spread stays at zero rather than dividing by it — a signature
 * that scores the same everywhere is not "average everywhere", and a NaN here
 * would take the figure's geometry with it.
 */
export function zByRow(values: Float64Array, nRows: number, nCols: number): Float64Array {
  const out = new Float64Array(values.length)
  for (let r = 0; r < nRows; r++) {
    const from = r * nCols
    let sum = 0
    for (let c = 0; c < nCols; c++) sum += values[from + c]
    const mean = sum / (nCols || 1)
    let ss = 0
    for (let c = 0; c < nCols; c++) ss += (values[from + c] - mean) ** 2
    const sd = Math.sqrt(ss / (nCols || 1))
    for (let c = 0; c < nCols; c++) {
      out[from + c] = sd > 1e-12
        ? Math.max(-2.5, Math.min(2.5, (values[from + c] - mean) / sd))
        : 0
    }
  }
  return out
}
