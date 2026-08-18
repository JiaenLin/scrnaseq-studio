import { useRef, useState } from 'react'
import { moveItem } from '../lib/order.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import Popover from './Popover.tsx'

/**
 * The order the groups are drawn in, for every figure at once.
 *
 * Beside Figure style rather than on a card, and for the same reason: it moves
 * every figure in the studio, so a control that lives on one tab would be a
 * setting you change in one place and go somewhere else to see. The object's
 * own order is the default and is one click away — this is a view of the
 * object, not an edit of it, and nothing is recomputed when it changes.
 *
 * Up and down rather than drag. A drag target is a mouse-only affordance and
 * these are buttons a keyboard reaches; with four or five groups, which is what
 * a real design has, two clicks put any level anywhere.
 */
export default function GroupOrder({ conds, custom, palKey, onChange, onReset }: {
  /** The groups in the order they are currently drawn. */
  conds: readonly string[]
  /** Whether that order is the reader's rather than the file's. */
  custom: boolean
  palKey: PaletteKey
  onChange: (next: string[]) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  const move = (from: number, to: number) => {
    const next = moveItem(conds, from, to)
    if (next !== conds) onChange(next)
  }

  return (
    <>
      <button ref={trigger} className="btn btn-sm" aria-haspopup="dialog" aria-expanded={open}
        title="The order groups are drawn in, in every figure"
        onClick={() => setOpen(v => !v)}
      >Group order{custom && <span className="ml-1 opacity-60">·</span>}</button>
      <Popover open={open} anchor={trigger} align="right" label="Group order"
        width={280} onClose={() => setOpen(false)}>
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="glabel">Groups</span>
            <button className="btn btn-quiet" disabled={!custom} onClick={onReset}>
              File order
            </button>
          </div>
          <ol className="mt-2 flex flex-col gap-1">
            {conds.map((c, i) => (
              <li key={c} className="flex items-center gap-1.5 rounded-[--r-md] px-1.5 py-1"
                style={{ background: 'var(--sunk)' }}>
                {/* The swatch, because this control changes it: the palette is
                    read by position, so moving a group moves its colour with
                    its place on the axis rather than with its name. */}
                <i className="sw flex-none" style={{ background: pal(i, palKey) }} />
                <span className="min-w-0 flex-1 truncate tx-small" title={c}>{c}</span>
                <button className="btn btn-quiet px-1.5" disabled={i === 0}
                  aria-label={`Move ${c} up`} title="Move up"
                  onClick={() => move(i, i - 1)}>↑</button>
                <button className="btn btn-quiet px-1.5" disabled={i === conds.length - 1}
                  aria-label={`Move ${c} down`} title="Move down"
                  onClick={() => move(i, i + 1)}>↓</button>
              </li>
            ))}
          </ol>
          <p className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
            Every figure that splits by group follows this. No statistic is recomputed —
            Control and Compare are chosen by name and do not move.
          </p>
        </div>
      </Popover>
    </>
  )
}
