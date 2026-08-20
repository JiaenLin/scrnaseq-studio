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
  const [at, setAt] = useState<{ top: number; left: number; maxH: number } | null>(null)

  // Before paint, so the panel never shows at 0,0 for a frame first.
  useLayoutEffect(() => {
    if (!open) { setAt(null); return }
    const place = () => {
      const a = anchor.current
      if (!a) return
      const r = a.getBoundingClientRect()
      const w = width ?? box.current?.offsetWidth ?? 220
      // scrollHeight, not offsetHeight: once maxHeight is applied the panel's
      // offsetHeight IS the cap, so measuring that on the second pass would
      // report the clamp back to itself and the panel would never re-open to
      // its full size when there is room for it.
      const h = box.current?.scrollHeight ?? 0
      const GAP = 6
      const EDGE = 8
      let left = align === 'right' ? r.right - w : r.left
      // Never off the left or right edge of the window.
      left = Math.max(EDGE, Math.min(left, window.innerWidth - w - EDGE))

      /**
       * Below if it fits, above if that is roomier, and SCROLLING if neither.
       *
       * The old rule flipped above only when the panel fitted there whole, and
       * capped nothing — so a list longer than the window ran off the bottom of
       * the screen with no way to reach the end of it. Forty-three cell types
       * does that on a laptop, and the object this was reported on has exactly
       * that many.
       */
      const below = window.innerHeight - r.bottom - GAP - EDGE
      const above = r.top - GAP - EDGE
      const useAbove = h > below && above > below
      const maxH = Math.max(120, useAbove ? above : below)
      const top = useAbove ? Math.max(EDGE, r.top - GAP - Math.min(h, maxH)) : r.bottom + GAP
      setAt({ top, left, maxH })
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
    const held = { was: false }
    /**
     * Escape closes; Tab stays inside.
     *
     * The panel is a child of <body>, so without this Tab walks out of it into
     * whatever happens to follow the app in the document — the reader is
     * suddenly tabbing through a menu they cannot see. Focus is also returned
     * to the trigger on close, which is the half people notice: press Escape
     * and you are back where you were rather than at the top of the page.
     *
     * This matters more than it did: there is now a save menu on every panel of
     * a small multiple, so there can be a hundred of these on one tab.
     */
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const el = box.current
      if (!el) return
      const focusable = [...el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(n => n.offsetParent !== null || n === document.activeElement)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const on = document.activeElement
      // Tabbing within the panel counts as being in it, whether or not focusin
      // has fired yet for the element being moved to.
      held.was = true
      // Wrap at both ends, and pull focus in if it is not in the panel at all.
      if (!el.contains(on)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && on === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && on === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('mousedown', shut)
    document.addEventListener('keydown', key)
    // Where focus was, so it can go back. Read now rather than on close: by
    // then the trigger may already have been re-rendered.
    const from = anchor.current
    /**
     * Whether focus was ever inside, tracked rather than checked at teardown.
     *
     * Asking `panel.contains(document.activeElement)` in the cleanup does not
     * work and measurably did not: React removes the portal before the cleanup
     * runs, so by then the node is detached and focus has already fallen to
     * <body>. The question "should focus go back to the trigger?" has to be
     * answered while the panel is still on screen.
     */
    const watch = () => { if (box.current?.contains(document.activeElement)) held.was = true }
    document.addEventListener('focusin', watch)
    return () => {
      document.removeEventListener('mousedown', shut)
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', watch)
      // Only if the reader was in the panel — otherwise somebody who clicked
      // elsewhere on the page would be yanked back to the trigger.
      if (held.was) from?.focus()
    }
  }, [open, anchor, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={box} role={role} aria-label={label}
      className="menu-in fixed rounded-[--r-md]"
      style={{
        top: at?.top ?? -9999, left: at?.left ?? -9999, width,
        // Scrolls itself rather than the page: the panel is fixed and portalled
        // to the body, so a list that outgrows the window has nowhere else to
        // go. `overscroll-contain` keeps a flick at the end of the list from
        // carrying on into the page behind it.
        maxHeight: at?.maxH,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
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
