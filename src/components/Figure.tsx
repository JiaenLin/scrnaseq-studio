import { useRef, useState, type ReactNode } from 'react'
import {
  canvasToPng, canvasWithFoot, printSize, scaleForDpi, slug, svgSheetToFile, svgSheetToPng, svgToFile, svgToPng,
  type PrintSize,
} from '../lib/download.ts'
import { figureSvg } from '../lib/figure-pick.ts'
import type { Foot } from '../lib/figure-foot.ts'
import Popover from './Popover.tsx'
import { InHead } from './Stage.tsx'

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
export default function Figure({
  name, children, className, right, redraw, extent, compact, sheet, foot, label = 'Save',
}: {
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
  /**
   * The whole figure's size in CSS pixels, when it is more than its first
   * canvas: several panels, their names and a key, composed by `redraw`.
   */
  extent?: { w: number; h: number }
  /**
   * One panel of a small multiple. Its Save is a glyph in the panel's own
   * corner that is drawn only while the pointer or the keyboard is on that
   * panel (always on a touch screen), so nine panels do not put nine buttons
   * on the stage; the whole sheet is saved from the head line.
   */
  compact?: boolean
  /**
   * The figure is a sheet of SVG panels (a small multiple): Save tiles every
   * panel's own drawing, `cols` across, into one file, in the same three
   * formats as any other figure. It was a button that wrote an SVG at once
   * beside buttons with the same glyph that opened a menu.
   */
  sheet?: { svgs: () => SVGSVGElement[]; cols: number }
  /**
   * What a reader of the file alone still needs, written under the drawing by
   * every Save: what is plotted, the key with n, what a mark means
   * (lib/figure-foot.ts). A figure that carries all of it in its own drawing
   * declares none.
   */
  foot?: Foot
  /** The button's word, when "Save" alone would not say what is saved. */
  label?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** The width this figure is saved at, read from the drawing when the menu opens. */
  const [size, setSize] = useState<PrintSize | null>(null)

  // The figure's own drawing: never the axis glyph beside a canvas, never the
  // drawn download icon of its own button (lib/figure-pick.ts).
  const svgIn = () => figureSvg<SVGSVGElement>(box.current, !!redraw)
  const canvasIn = () => box.current?.querySelector('canvas') as HTMLCanvasElement | null

  /**
   * The drawing's width in CSS pixels: what the print size is counted from.
   * A sheet's is its panels tiled as the file tiles them (lib/download.ts).
   */
  const drawnPx = (): number => {
    if (sheet) {
      const svgs = sheet.svgs()
      const n = Math.max(1, Math.min(sheet.cols, svgs.length))
      const cw = Math.max(1, ...svgs.map(v => v.viewBox.baseVal?.width || v.clientWidth || 400))
      return n * cw + (n + 1) * 12
    }
    const svg = svgIn()
    if (svg) return svg.viewBox.baseVal?.width || svg.clientWidth || 800
    const cv = canvasIn()
    // The on-screen canvas is drawn at 2x its CSS box, so the width is the
    // one the reader sees, not the backing store's.
    return extent?.w ?? (cv ? cv.clientWidth || cv.width / 2 : 800)
  }

  const save = async (kind: 'svg' | number) => {
    setOpen(false)
    const svg = svgIn()
    if (kind === 'svg') {
      if (sheet) svgSheetToFile(sheet.svgs(), slug(name), sheet.cols, 12, foot)
      else if (svg) svgToFile(svg, slug(name), foot)
      return
    }
    setBusy(true)
    try {
      // The same reading the menu printed: the file is that wide at this dpi.
      const shown = drawnPx()
      const s = scaleForDpi(shown, kind, printSize(shown).inches)
      if (sheet) return await svgSheetToPng(sheet.svgs(), `${slug(name)}_${kind}dpi`, sheet.cols, s, kind, foot)
      if (svg) return await svgToPng(svg, `${slug(name)}_${kind}dpi`, s, kind, foot)
      const cv = canvasIn()
      if (!cv) return
      if (!redraw) return canvasToPng(cv, slug(name))
      const out = document.createElement('canvas')
      out.width = Math.round(shown * s)
      out.height = Math.round((extent?.h ?? (cv.clientHeight || cv.height / 2)) * s)
      redraw(out, out.width, out.height)
      canvasToPng(canvasWithFoot(out, foot, s), `${slug(name)}_${kind}dpi`, kind)
    } finally {
      setBusy(false)
    }
  }

  const vector = !!sheet || !!svgIn()

  const actions = (
      <div className={compact ? 'fig-corner' : 'fig-actions'}>
        {right}
        <div className="relative">
          <button
            ref={trigger}
            className={compact ? 'btn-icon fig-corner-btn' : 'btn btn-quiet'}
            aria-label={compact ? `Save ${name}` : undefined}
            aria-haspopup="menu"
            aria-expanded={open}
            title={`Download ${name}`}
            disabled={busy}
            // A fixed width, so the label swapping to "…" while the PNG renders
            // does not shrink the trigger out from under the cursor.
            style={compact ? undefined : { minWidth: 64, textAlign: 'center' }}
            onClick={() => { if (!open) setSize(printSize(drawnPx())); setOpen(v => !v) }}
          >{busy ? '…' : compact ? <DownIcon /> : <><DownIcon />{label}</>}</button>
          <Popover open={open} anchor={trigger} align="right" role="menu"
            label={`Download ${name}`} width={212} onClose={() => setOpen(false)}>
            <div className="p-1.5 text-left">
              {vector && (
                <MenuItem onClick={() => void save('svg')}
                  title="SVG — vector" note="editable, no resampling" />
              )}
              <MenuItem onClick={() => void save(300)}
                title="PNG — 300 dpi" note="the usual journal minimum" />
              <MenuItem onClick={() => void save(600)}
                title="PNG — 600 dpi" note="line art and dense panels" />
              {/* The width every format is saved at, once: counted from the
                  drawing by the function that sizes the file (`printSize`),
                  with the column it fits and the size its type prints at. It
                  read "3.5 in wide" on every figure, whatever was drawn. */}
              {size && (
                <p className="menu-foot tx-micro">
                  Saved {size.inches} in wide ({size.mm} mm):{' '}
                  {size.fits === 'one' ? 'fits one column (3.5 in).'
                    : size.fits === 'two' ? 'fits two columns (7 in).'
                      : 'wider than two columns (7 in).'}
                  {' '}Type prints at {size.pt} pt and up.
                </p>
              )}
            </div>
          </Popover>
        </div>
      </div>
  )

  return (
    // A header row, not an overlay. The controls used to be positioned
    // `absolute right-0 top-0` over the figure, which meant every caller had to
    // guess how much top padding would keep the Save button off the plot — and
    // they guessed five different numbers (pt-5, pt-6, pt-7, mt-1, mt-6). A row
    // takes its own space, so nobody has to compensate for it.
    <div ref={box} className={compact ? `${className ?? ''} fig-compact` : className}>
      {/* Under a head line the controls sit at its right end (Stage.tsx); with
          no head above, in a row over the figure, where they always were. A
          panel of a small multiple keeps its own, in its corner. */}
      {compact ? actions : <InHead>{actions}</InHead>}
      {children}
    </div>
  )
}

function MenuItem({ onClick, title, note }: { onClick: () => void; title: string; note: string }) {
  return (
    <button role="menuitem" onClick={onClick}
      className="block w-full rounded-[--r-md] px-2.5 py-1.5 text-left hover:bg-[var(--sunk)]">
      <span className="block tx-small font-semibold">{title}</span>
      <span className="block tx-micro" style={{ color: 'var(--ink-3)' }}>{note}</span>
    </button>
  )
}

/** A download button for a table, kept visually identical to the figure one. */
export function CsvButton({ onClick, label = 'CSV' }: { onClick: () => void; label?: string }) {
  return <button className="btn btn-quiet" onClick={onClick}><DownIcon />{label}</button>
}

/**
 * "This leaves as a file": an arrow into a tray, drawn, in the label's ink.
 * It was the character U+2B73, which the system face does not carry, so it
 * came from whatever fallback font the machine had and read as three bars.
 */
export function DownIcon() {
  return (
    <svg className="ico" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.5v6.5M3.25 5.5 6 8.25 8.75 5.5M2 10.5h8" />
    </svg>
  )
}
