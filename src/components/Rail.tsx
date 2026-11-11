import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { RailSlot } from '../lib/rail-slot.ts'

/**
 * A view's own controls, placed in the rail.
 *
 * A view keeps the state its controls change, so it also writes them; this
 * puts what it writes where the hand expects it, beside every other control
 * of the view, instead of in rows above the figure. On the server there is no
 * rail (the tests render a view on its own), so the controls render in place
 * and every label is still in the markup.
 */
export function InRail({ children }: { children: ReactNode }) {
  const slot = useContext(RailSlot)
  if (typeof document === 'undefined') return <>{children}</>
  return slot ? createPortal(children, slot) : null
}

/** One task's controls, under its name. */
export function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rail-group" role="group" aria-label={label}>
      <div className="rail-label">{label}</div>
      {children}
    </div>
  )
}

/** One of many, as full-width rows. */
export function Opts<T extends string>({ value, options, onChange, disabled }: {
  value: T
  options: { k: T; label: string; title?: string }[]
  onChange: (k: T) => void
  disabled?: (k: T) => boolean
}) {
  return (
    <div className="opts">
      {options.map(o => (
        <button key={o.k} type="button" className="opt" title={o.title}
          aria-pressed={value === o.k} disabled={disabled?.(o.k)}
          onClick={() => onChange(o.k)}>{o.label}</button>
      ))}
    </div>
  )
}

/** An on/off setting: the words on the left, a switch on the right. */
export function Toggle({ on, onChange, title, children }: {
  on: boolean
  onChange: (v: boolean) => void
  title?: string
  children: ReactNode
}) {
  return (
    <button type="button" className="opt opt-toggle" aria-pressed={on} title={title}
      onClick={() => onChange(!on)}>
      <span className="min-w-0 truncate">{children}</span>
      <span className="switch" aria-hidden />
    </button>
  )
}

/** A labelled control: the label over a full-width control. */
export function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="glabel" title={title}>{label}</span>
      {children}
    </label>
  )
}

/** One of a few numbers or short words, as a segmented control. */
export function Steps<T extends string | number>({ value, options, onChange }: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={String(o)} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
          {String(o)}
        </button>
      ))}
    </div>
  )
}
