import { useEffect, useRef, useState, type ReactNode } from 'react'
import { canvasToPng, scaleForDpi, slug, svgToFile, svgToPng } from '../lib/download.ts'

/**
 * A figure, with the exports a manuscript actually asks for.
 *
 * One PNG button was enough while these were things to look at. A figure headed
 * for submission is a different object: journals want vector, or raster at
 * 300 dpi and often 600 for anything with fine detail, and a 320 px panel saved
 * 1:1 is about 90. So the menu names what it produces in the terms the author
 * has to satisfy — a format and a dpi — rather than a multiplier.
 *
 * SVG is offered first for anything drawn as SVG, because it is the only export
 * a co-author can restyle and the only one production will not resample. A
 * canvas figure is a quarter of a million points and genuinely raster; it says
 * so by not offering vector rather than by handing over an SVG with a bitmap
 * inside it.
 */
export default function Figure({ name, children, className, right, redraw }: {
  name: string
  children: ReactNode
  className?: string
  /** Extra controls to sit beside the download button. */
  right?: ReactNode
  /**
   * Re-render a canvas figure at an arbitrary size, for export.
   *
   * Without it a canvas can only be saved at the size it happens to be on
   * screen. With it the same drawing code runs against an offscreen canvas as
   * large as the target dpi needs, so the exported figure is the figure — not a
   * scaled-up copy of a small one.
   */
  redraw?: (cv: HTMLCanvasElement, w: number, h: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // A menu that stays open after its owner scrolls away is a menu that acts on
  // the wrong figure.
  useEffect(() => {
    if (!open) return
    const shut = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', shut)
    return () => document.removeEventListener('mousedown', shut)
  }, [open])

  const svgIn = () => box.current?.querySelector('svg') as SVGSVGElement | null
  const canvasIn = () => box.current?.querySelector('canvas') as HTMLCanvasElement | null

  const save = async (kind: 'svg' | number) => {
    setOpen(false)
    const svg = svgIn()
    if (kind === 'svg') {
      if (svg) svgToFile(svg, slug(name))
      return
    }
    setBusy(true)
    try {
      if (svg) {
        const w = svg.viewBox.baseVal?.width || svg.clientWidth || 800
        await svgToPng(svg, `${slug(name)}_${kind}dpi`, scaleForDpi(w, kind))
        return
      }
      const cv = canvasIn()
      if (!cv) return
      if (!redraw) return canvasToPng(cv, slug(name))
      // The on-screen canvas is already drawn at 2x its CSS box, so the dpi is
      // measured against the size the reader sees, not the backing store.
      const shown = cv.clientWidth || cv.width / 2
      const s = scaleForDpi(shown, kind)
      const out = document.createElement('canvas')
      out.width = Math.round(shown * s)
      out.height = Math.round((cv.clientHeight || cv.height / 2) * s)
      redraw(out, out.width, out.height)
      canvasToPng(out, `${slug(name)}_${kind}dpi`)
    } finally {
      setBusy(false)
    }
  }

  const vector = !!svgIn()

  return (
    <div ref={box} className={`relative ${className ?? ''}`}>
      <div className="absolute right-0 top-0 z-10 flex items-center gap-1.5">
        {right}
        <div className="relative">
          <button
            className="chip"
            aria-haspopup="menu"
            aria-expanded={open}
            title={`Download ${name}`}
            disabled={busy}
            onClick={() => setOpen(v => !v)}
          >{busy ? '…' : '⭳ Save'}</button>
          {open && (
            <div
              role="menu"
              className="menu-in absolute right-0 top-[26px] z-20 w-[212px] rounded-xl p-1.5 text-left"
              style={{
                background: 'var(--surface)', border: '1px solid var(--line)',
                boxShadow: '0 10px 30px rgba(15,23,42,.16)',
                // This one hangs off the right edge of its trigger, so it grows
                // from that corner. The shared class assumes top-left, which is
                // where every other menu in the app is anchored.
                transformOrigin: 'top right',
              }}
            >
              {vector && (
                <MenuItem onClick={() => void save('svg')}
                  title="SVG — vector" note="editable, no resampling" />
              )}
              <MenuItem onClick={() => void save(300)}
                title="PNG — 300 dpi" note="the usual journal minimum" />
              <MenuItem onClick={() => void save(600)}
                title="PNG — 600 dpi" note="line art and dense panels" />
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function MenuItem({ onClick, title, note }: { onClick: () => void; title: string; note: string }) {
  return (
    <button role="menuitem" onClick={onClick}
      className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--sunk)]">
      <span className="block text-[12.5px] font-semibold">{title}</span>
      <span className="block text-[11px]" style={{ color: 'var(--ink-3)' }}>{note}</span>
    </button>
  )
}

/** A download button for a table, kept visually identical to the figure one. */
export function CsvButton({ onClick, label = '⭳ CSV' }: { onClick: () => void; label?: string }) {
  return <button className="chip" onClick={onClick}>{label}</button>
}
