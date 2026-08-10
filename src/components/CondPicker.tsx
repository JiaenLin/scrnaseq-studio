import { useEffect, useRef, useState } from 'react'

/**
 * One side of a comparison: a condition, or several taken together.
 *
 * A dropdown of checkboxes rather than a native multi-select. A native one
 * needs ctrl-click to add a second item and shows a scrolling box the size of
 * the whole level list, and the common case here is still one level — so this
 * has to read as a plain picker until the reader wants more from it, and then
 * be obvious.
 *
 * Pooling levels is a real analysis decision, not a display convenience: 6 h
 * and 12 h together is a different experiment from either alone. So the button
 * always names every level it is standing for, and the count is never hidden
 * behind a "3 selected".
 */
export default function CondPicker({ label, all, value, other, onChange }: {
  label: string
  /** Every condition the object carries, in the object's own order. */
  all: string[]
  value: string[]
  /** The other side, so a level cannot be put on both at once. */
  other: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const shut = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', shut)
    return () => document.removeEventListener('mousedown', shut)
  }, [open])

  const toggle = (c: string) => {
    const has = value.includes(c)
    // The last level cannot be removed: a side with nothing on it is not a
    // comparison, and the only way back would be this menu.
    if (has && value.length === 1) return
    const next = has ? value.filter(x => x !== c) : [...value, c]
    // Kept in the object's own order rather than click order, so "0 h + 6 h"
    // never reads as "6 h + 0 h" and a caption is stable across two readers
    // who picked the same levels in a different sequence.
    onChange(all.filter(c2 => next.includes(c2)))
  }

  const text = value.join(' + ') || '—'

  return (
    <div className="relative flex items-center gap-1.5" ref={box}>
      <span className="glabel">{label}</span>
      <button
        className="sel text-left"
        style={{ minWidth: 74, maxWidth: 230 }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.length > 1 ? `${value.length} groups pooled: ${text}` : text}
        onClick={() => setOpen(v => !v)}
      >
        <span className="block truncate">{text}</span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-1 min-w-[190px] rounded-xl p-1.5"
          style={{
            background: 'var(--surface)', border: '1px solid var(--line-2)',
            boxShadow: '0 10px 30px rgba(15,23,42,.16)',
          }}
        >
          {all.map(c => {
            const on = value.includes(c)
            const taken = other.includes(c)
            return (
              <button
                key={c} role="option" aria-selected={on} disabled={taken}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--sunk)]"
                style={{ opacity: taken ? 0.4 : 1 }}
                title={taken ? 'already on the other side of this comparison' : undefined}
                onClick={() => toggle(c)}
              >
                <span
                  className="grid h-[14px] w-[14px] flex-none place-items-center rounded-[4px] text-[10px] text-white"
                  style={{
                    background: on ? 'var(--accent)' : 'transparent',
                    border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`,
                  }}
                >{on ? '✓' : ''}</span>
                <span className="truncate">{c}</span>
              </button>
            )
          })}
          {value.length > 1 && (
            <p className="px-2 pb-1 pt-1.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
              {value.length} groups pooled — every cell in any of them is treated as
              one group by the test.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
