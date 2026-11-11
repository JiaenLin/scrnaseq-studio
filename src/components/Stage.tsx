import { useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ActionSlot } from '../lib/action-slot.ts'

/** An action on what the head line names: Save, CSV. */
export function InHead({ children }: { children: ReactNode }) {
  const slot = useContext(ActionSlot)
  if (typeof document === 'undefined' || slot === undefined) return <>{children}</>
  return slot ? createPortal(children, slot) : null
}

/**
 * A view's stage: the head line (what is drawn on the left, the actions on it
 * on the right), then the body.
 *
 * `fit` fills the stage: the body takes the height that is left and its panes
 * scroll on their own, so a table runs to the bottom edge and a figure is
 * fitted in both directions. Without it the stage is a document and scrolls.
 */
export function Stage({ head, children, fit, foot }: {
  head: ReactNode
  children: ReactNode
  fit?: boolean
  foot?: ReactNode
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <ActionSlot.Provider value={slot}>
      <div className={fit ? 'fill' : undefined}>
        <header className="stage-head sticky top-0 z-20" style={{ background: 'var(--surface)' }}>
          {head}
          <div ref={setSlot} className="stage-actions" />
        </header>
        {fit ? children : <div className="stage-body">{children}</div>}
        {foot && <footer className="stage-foot">{foot}</footer>}
      </div>
    </ActionSlot.Provider>
  )
}

/**
 * A section of a document view whose head line owns the actions on it: a
 * title on the left, Save on the right, a hairline above.
 */
export function Section({ title, meta, children }: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <ActionSlot.Provider value={slot}>
      <section className="sect">
        <div className="sect-head">
          <h3 className="stage-title" title={title}>{title}</h3>
          {meta && <span className="stage-meta">{meta}</span>}
          <div ref={setSlot} className="stage-actions" />
        </div>
        {children}
      </section>
    </ActionSlot.Provider>
  )
}
