import { useRef, useState } from 'react'
import Popover from './Popover.tsx'

/** Frozen, so the default does not make a new array on every render. */
const NONE: string[] = []

/**
 * Several of something, chosen from a list: the groups on one side of a
 * comparison, or the cell types a contrast runs over.
 *
 * A dropdown of checkboxes rather than a native multi-select. A native one
 * needs ctrl-click to add a second item and shows a scrolling box the size of
 * the whole list, and the common case here is still one item — so this has to
 * read as a plain picker until the reader wants more from it, and then be
 * obvious.
 *
 * Pooling is a real analysis decision, not a display convenience: 6 h and 12 h
 * together is a different experiment from either alone, and three cardiomyocyte
 * states tested as one is a different test from three tables. So the button
 * always names every item it is standing for, and the count is never hidden
 * behind a "3 selected" until the names genuinely will not fit.
 *
 * This was CondPicker, for conditions only. The cell type beside it was a plain
 * `<select>` — one cluster, always one, with the first one chosen for you.
 */
export default function PickMany({
  label, lead, all, value, other = NONE, noun = 'groups', empty = '—', onChange,
}: {
  label: string
  /**
   * What to DRAW in front of the button, when that is not the label.
   *
   * The pair reads as one thing — a contrast — so the second one is led by
   * "vs" rather than by a second uppercase noun. That is 45px of a row whose
   * labels were costing more than its values, and it says what the pair is
   * for: `CONTROL [aged_control] VS [aged_hfd]`. `label` stays as written for
   * the accessible name and the menu's heading, because "vs groups" is not
   * something to hand a screen reader.
   */
  lead?: string
  /** Every condition the object carries, in the object's own order. */
  all: string[]
  value: string[]
  /** The other side, so a level cannot be put on both at once. Empty when there is none. */
  other?: string[]
  /** What a plural of these is called, in the pooled footnote and the tooltip. */
  noun?: string
  /** What the button reads when nothing is ticked. */
  empty?: string
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  const toggle = (c: string) => {
    const has = value.includes(c)
    // The last one CAN be removed. It could not be, on the reasoning that a side
    // with nothing on it is not a comparison — which is true, and is a reason to
    // refuse to RUN rather than to refuse to unpick. Nothing is pre-selected any
    // more, so empty is where every picker starts; a control that can reach a
    // state it will not let you return to is worse than the state.
    const next = has ? value.filter(x => x !== c) : [...value, c]
    // Kept in the object's own order rather than click order, so "0 h + 6 h"
    // never reads as "6 h + 0 h" and a caption is stable across two readers
    // who picked the same levels in a different sequence.
    onChange(all.filter(c2 => next.includes(c2)))
  }

  const text = value.join(' + ') || empty

  return (
    // `flex-1` on the wrapper, not only on the button inside it. Without it
    // this group is sized to its own content, so when the row runs out of room
    // the leftover space goes to whichever control asked for the most — the
    // cell-type select, which had a 220px appetite — and the pickers were left
    // on their floor while it kept 146. The three controls that hold a NAME now
    // share what is left equally.
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="glabel flex-none">{lead ?? label}</span>
      <button
        ref={trigger}
        className="sel min-w-0 flex-1 text-left"
        // Four pooled levels is "e7.0 + e8.0 + e13.0 + e13.5" — 26 characters,
        // and at 230 px that truncated to an ellipsis on the one control whose
        // whole job is to say which groups are being compared. It grows with
        // what it holds instead of being clipped to a fixed width.
        //
        // The floor is 112, not 78. 78 fits "Quiescent" and nothing an object
        // actually carries: `aged_control` came back as "aged_c…", and two
        // groups that differ after the sixth character — which is what a
        // factorial design looks like — were the same six characters twice.
        // Below 112 the row scrolls instead, which at least keeps the name.
        style={{ minWidth: 112, maxWidth: 420 }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.length > 1 ? `${value.length} ${noun} pooled: ${text}` : text}
        onClick={() => setOpen(v => !v)}
      >
        <span className="block truncate">{text}</span>
      </button>
      <Popover open={open} anchor={trigger} role="listbox" label={`${label} ${noun}`}
        width={230} onClose={() => setOpen(false)}>
        <div className="p-1.5">
          {all.map(c => {
            const on = value.includes(c)
            const taken = other.includes(c)
            return (
              <button
                key={c} role="option" aria-selected={on} disabled={taken}
                className="flex w-full items-center gap-2 rounded-[--r-md] px-2 py-1.5 text-left tx-small hover:bg-[var(--sunk)]"
                style={{ opacity: taken ? 0.4 : 1 }}
                title={taken ? 'already on the other side of this comparison' : undefined}
                onClick={() => toggle(c)}
              >
                {/* --sel and --surface, like every other selected thing in the
                    studio. White on the dark theme's lighter accent was about
                    2.3:1 — a state indicator you have to look twice at. */}
                {/* aria-hidden: `aria-selected` on the option already carries
                    the state, and without it the tick landed INSIDE the
                    accessible name — a screen reader read "✓0 h", and so did
                    anything else matching on the name. */}
                <span
                  aria-hidden
                  className="grid h-[14px] w-[14px] flex-none place-items-center rounded-[--r-sm] tx-micro"
                  style={{
                    background: on ? 'var(--sel)' : 'transparent',
                    color: 'var(--surface)',
                    border: `1.5px solid ${on ? 'var(--sel)' : 'var(--line-2)'}`,
                  }}
                >{on ? '✓' : ''}</span>
                <span className="truncate">{c}</span>
              </button>
            )
          })}
          {value.length > 1 && (
            <p className="px-2 pb-1 pt-1.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
              {value.length} {noun} pooled, tested as one.
            </p>
          )}
        </div>
      </Popover>
    </div>
  )
}
