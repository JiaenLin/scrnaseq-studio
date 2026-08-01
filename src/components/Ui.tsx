import type { ReactNode } from 'react'

export function Card({ eyebrow, title, sub, children }: {
  eyebrow?: string
  title?: string
  sub?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="card">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      {title && <h2 className="mt-1 text-[14.5px] font-semibold tracking-[-0.01em]">{title}</h2>}
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  )
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="px-[13px] py-[11px]" style={{ background: 'var(--surface)' }}>
      <div className="num text-[20px] font-semibold tracking-[-0.02em]">{value}</div>
      <div className="mt-px text-[11px]" style={{ color: 'var(--ink-3)' }}>{label}</div>
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
      <div className="mb-[5px] text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</div>
      {children}
    </div>
  )
}

export const Mono = ({ children }: { children: ReactNode }) =>
  <code className="mono">{children}</code>
