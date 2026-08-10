import type { ReactNode } from 'react'

/**
 * One card, one header shape: eyebrow, title, optional controls on the right.
 *
 * `right` exists because two tabs were hand-rolling that row — Cells built its
 * own eyebrow/h2/chips flex and Gene expression stacked a search field under
 * the title — so the same header appeared in three shapes across nine tabs.
 */
export function Card({ eyebrow, title, sub, right, children }: {
  eyebrow?: string
  title?: string
  sub?: ReactNode
  right?: ReactNode
  children?: ReactNode
}) {
  const head = eyebrow || title || sub
  return (
    <section className="card">
      {head && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {right && <div className="flex flex-wrap items-center gap-1.5">{right}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: 'var(--s3)' }}>
      <div className="num font-semibold"
        style={{ fontSize: 'var(--t-stat)', letterSpacing: 'var(--tr-stat)' }}>{value}</div>
      <div className="mt-px" style={{ color: 'var(--ink-3)', fontSize: 'var(--t-micro)' }}>{label}</div>
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, disabled }: {
  value: T
  options: { k: T; label: string; title?: string }[]
  onChange: (k: T) => void
  disabled?: (k: T) => boolean
}) {
  return (
    <div className="seg">
      {options.map(o => (
        <button
          key={o.k} type="button" title={o.title}
          aria-pressed={value === o.k}
          disabled={disabled?.(o.k)}
          onClick={() => onChange(o.k)}
        >{o.label}</button>
      ))}
    </div>
  )
}

export function Chips<T extends string | number>({ value, options, onChange, label }: {
  value: T
  options: T[]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <>
      {label && <span className="glabel">{label}</span>}
      {options.map(o => (
        <button
          key={String(o)} type="button" className="chip"
          aria-pressed={value === o} onClick={() => onChange(o)}
        >{String(o)}</button>
      ))}
    </>
  )
}

/** A named swatch row — used under every categorical figure. */
export function Legend({ items, note }: { items: [string, string][]; note?: ReactNode }) {
  return (
    <div className="legend mt-3">
      {items.map(([color, label]) => (
        <span key={label}><i className="sw" style={{ background: color }} />{label}</span>
      ))}
      {note && <span style={{ color: 'var(--ink-3)' }}>{note}</span>}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="card-title mb-1" style={{ color: 'var(--ink)', marginTop: 0 }}>{title}</div>
      {children}
    </div>
  )
}

/** An action that is not the card's main one — Save, CSV, Reset, Clear. */
export function Quiet({ onClick, title, children, disabled }: {
  onClick: () => void
  title?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button type="button" className="btn btn-quiet" title={title}
      disabled={disabled} onClick={onClick}>{children}</button>
  )
}

export const Mono = ({ children }: { children: ReactNode }) =>
  <code className="mono">{children}</code>
