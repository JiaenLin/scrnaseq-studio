import { useRef, type ReactNode } from 'react'
import { canvasToPng, slug, svgToPng } from '../lib/download.ts'

/**
 * Any figure, with a PNG export.
 *
 * Wraps its children and exports whichever it finds first inside — an <svg> or a
 * <canvas> — so a component does not have to know how it happens to be drawn.
 */
export default function Figure({ name, children, className, right }: {
  name: string
  children: ReactNode
  className?: string
  /** Extra controls to sit beside the download button. */
  right?: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)

  const save = async () => {
    const el = box.current
    if (!el) return
    const svg = el.querySelector('svg')
    if (svg) return svgToPng(svg as SVGSVGElement, slug(name))
    const cv = el.querySelector('canvas')
    if (cv) canvasToPng(cv as HTMLCanvasElement, slug(name))
  }

  return (
    <div ref={box} className={`relative ${className ?? ''}`}>
      <div className="absolute right-0 top-0 z-10 flex items-center gap-1.5">
        {right}
        <button
          className="chip"
          title={`Download ${name} as PNG`}
          onClick={save}
        >⭳ PNG</button>
      </div>
      {children}
    </div>
  )
}

/** A download button for a table, kept visually identical to the figure one. */
export function CsvButton({ onClick, label = '⭳ CSV' }: { onClick: () => void; label?: string }) {
  return <button className="chip" onClick={onClick}>{label}</button>
}
