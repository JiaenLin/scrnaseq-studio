import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A panel that opens from a control, and cannot be cut in half by one.
 *
 * The studio had four of these — the group pickers, the figure style menu, the
 * save menu, the gene autocomplete — each absolutely positioned inside its own
 * trigger, each with its own outside-click handler and its own z-index. That
 * works until a trigger sits inside something that clips, and then it fails
 * silently: `overflow-x-auto` on the control bar made the bar a clipping
 * context on BOTH axes, so a menu opening downward out of a 42px strip simply
 * stopped at 42px. It was reported twice, on two different menus, because
 * fixing the one that was noticed first left the cause in place.
 *
 * So this renders into `document.body` and positions itself against the
 * trigger's box in viewport coordinates. No ancestor can clip it, because it
 * has no ancestor but the body — and there is one outside-click rule, one
 * Escape rule and one z-index instead of four.
 *
 * `position: fixed` rather than absolute + scroll offsets: the triggers live in
 * a sticky header that does not move with the page, and a fixed panel stays put
 * with it. The reposition on scroll and resize is for the cases that do move.
 */
export default function Popover({ open, anchor, align = 'left', width, label, role = 'dialog', onClose, children }: {
  open: boolean
  /** The control this opens from. The panel is placed against its box. */
  anchor: React.RefObject<HTMLElement | null>
  /** Which edge to line up with the trigger's. */
  align?: 'left' | 'right'
  width?: number
  label?: string
  role?: 'dialog' | 'listbox' | 'menu'
  onClose: () => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)

  // Before paint, so the panel never shows at 0,0 for a frame first.
  useLayoutEffect(() => {
    if (!open) { setAt(null); return }
    const place = () => {
      const a = anchor.current
      if (!a) return
      const r = a.getBoundingClientRect()
      const w = width ?? box.current?.offsetWidth ?? 220
      const h = box.current?.offsetHeight ?? 0
      const GAP = 6
      let left = align === 'right' ? r.right - w : r.left
      // Never off the left or right edge of the window.
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      // Below the trigger, unless there is no room and there is room above.
      let top = r.bottom + GAP
      if (h && top + h > window.innerHeight - 8 && r.top - GAP - h > 8) top = r.top - GAP - h
      setAt({ top, left })
    }
    place()
    // A second pass once the panel has been measured, so a tall one that has to
    // flip above the trigger does not spend a frame hanging off the bottom.
    const raf = requestAnimationFrame(place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const shut = (e: MouseEvent) => {
      const t = e.target as Node
      // The trigger handles its own toggle; closing here as well would reopen
      // and immediately close on the same click.
      if (box.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', shut)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', shut)
      document.removeEventListener('keydown', key)
    }
  }, [open, anchor, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={box} role={role} aria-label={label}
      className="menu-in fixed rounded-[--r-md]"
      style={{
        top: at?.top ?? -9999, left: at?.left ?? -9999, width,
        zIndex: 60,
        background: 'var(--surface)',
        border: '1px solid var(--line-2)',
        boxShadow: 'var(--shadow-menu)',
        // Grows from the corner it is anchored to, not from its own middle.
        transformOrigin: align === 'right' ? 'top right' : 'top left',
        visibility: at ? 'visible' : 'hidden',
      }}
    >{children}</div>,
    document.body,
  )
}
