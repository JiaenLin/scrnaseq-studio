import { useState } from 'react'
import type { CellType, GroupBy } from '../types.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'

/**
 * Which cell types and which groups a figure draws.
 *
 * Two axes rather than one list of populations. Grouped by cell type x group
 * the columns are the PRODUCT — 133 clusters against 20 groups is 2 660
 * toggles, which is not a control, it is a second figure to read. Filtering the
 * two axes separately is both smaller and what the reader is actually asking:
 * "these four populations, in these two conditions".
 *
 * Hiding is by cluster INDEX and by group NAME, so it survives regrouping: turn
 * a group off, switch from cell type to cell type x group, and it is still off.
 *
 * Collapsed until it is used, because on an object with 133 cell types a
 * permanently-open list of 133 checkboxes is the tallest thing on the page and
 * almost nobody touches it.
 */
export default function ColumnFilter({
  types, conds, groupBy, hideT, hideC, onHideT, onHideC, palKey, label = 'Columns',
}: {
  types: CellType[]
  conds: string[]
  groupBy: GroupBy
  hideT: Set<number>
  hideC: Set<string>
  onHideT: (next: Set<number>) => void
  onHideC: (next: Set<string>) => void
  palKey: PaletteKey
  label?: string
}) {
  const [open, setOpen] = useState(false)
  // Cell types matter unless the columns ARE the groups; groups matter unless
  // the columns are the cell types. A control that cannot change the figure is
  // worse than an absent one.
  const showTypes = groupBy !== 'cond'
  const showConds = groupBy !== 'type' && conds.length > 1

  const toggleT = (ti: number) => {
    const next = new Set(hideT)
    if (!next.delete(ti)) next.add(ti)
    // Never all of them: the figure would have no columns and the only way back
    // would be this control, which is easy to scroll past.
    if (next.size >= types.length) return
    onHideT(next)
  }
  const toggleC = (c: string) => {
    const next = new Set(hideC)
    if (!next.delete(c)) next.add(c)
    if (next.size >= conds.length) return
    onHideC(next)
  }

  const nT = types.length - hideT.size
  const nC = conds.length - hideC.size
  const some = (showTypes && hideT.size > 0) || (showConds && hideC.size > 0)

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button className="chip" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          {open ? '▾' : '▸'} {label}
        </button>
        <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>
          {showTypes && `${nT} of ${types.length} cell type${types.length === 1 ? '' : 's'}`}
          {showTypes && showConds && ' · '}
          {showConds && `${nC} of ${conds.length} groups`}
          {!showTypes && !showConds && 'every population'}
        </span>
        {some && (
          <button className="btn btn-quiet"
            onClick={() => { onHideT(new Set()); onHideC(new Set()) }}>Show all</button>
        )}
      </div>
      {open && (
        <div className="panel mt-2">
          {showTypes && (
            <>
              <div className="glabel mb-1.5">Cell types</div>
              <div className="grid gap-1"
                style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>
                {types.map((t, ti) => {
                  const on = !hideT.has(ti)
                  return (
                    <button key={t.key} onClick={() => toggleT(ti)} aria-pressed={on}
                      className="type-toggle flex items-center gap-1.5 rounded-[--r-md] px-2 py-1 text-left"
                      style={{ opacity: on ? 1 : 0.45 }}>
                      <i className="sw flex-none" style={{ background: pal(ti, palKey) }} />
                      <span className="min-w-0 flex-1 tx-micro">{t.name}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {showConds && (
            <>
              <div className={`glabel mb-1.5 ${showTypes ? 'mt-3' : ''}`}>Groups</div>
              <div className="flex flex-wrap gap-1.5">
                {conds.map(c => (
                  <button key={c} className="chip" aria-pressed={!hideC.has(c)}
                    onClick={() => toggleC(c)}>{c}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
