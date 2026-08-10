// Exporting figures and tables.
//
// The bulk studio gets PNG export free from Plotly. These figures are hand-drawn
// SVG and canvas, so export is ours to do — and the awkward part is that every
// colour in them is a CSS custom property. A serialized <svg> has no document to
// resolve `var(--ink)` against, so the export would come out black-on-black.
// Everything visual is therefore inlined from the computed style before writing.

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
  'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor',
] as const

function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src)
  const decl: string[] = []
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p)
    if (!v || v === 'none' || v === 'normal') continue
    decl.push(`${p}:${v}`)
    // The resolved value goes onto the presentation attribute as well as into
    // the style. Some of these elements carry fill="var(--sunk)" directly;
    // Chromium resolves that, and the inlined style would win in a browser
    // anyway — but the exported file is opened by Illustrator, Inkscape and a
    // journal's production tooling, none of which have a document defining
    // --sunk. Leaving the reference in place ships a figure whose colours
    // depend on where it is opened.
    if (dst.hasAttribute(p)) dst.setAttribute(p, v)
  }
  if (decl.length) dst.setAttribute('style', decl.join(';'))
  const s = src.children, t = dst.children
  for (let i = 0; i < s.length; i++) inlineStyles(s[i], t[i])
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * A figure's width in inches at print size, for the dpi arithmetic.
 *
 * A single-column journal figure is about 3.5 inches — 89 mm at Nature, 85 at
 * Cell. These panels are drawn a few hundred CSS pixels wide, so a 1:1 export
 * lands near 90 dpi, under a third of what any journal accepts. Stating the
 * target in dpi rather than as a bare multiplier is the difference between a
 * reader knowing the file is submittable and guessing.
 */
export const FIGURE_INCHES = 3.5

/** The multiplier that renders a figure `px` wide at `dpi`. */
export const scaleForDpi = (px: number, dpi: number): number =>
  Math.max(1, (FIGURE_INCHES * dpi) / Math.max(1, px))

/**
 * Read the figure as if the app were in light mode, whatever it is in.
 *
 * Everything below inlines COMPUTED colours and then puts the figure on a white
 * plate. Exported from dark mode that produced pale text and pale axes on
 * white — a blank-looking figure that had been silently broken for as long as
 * the app has had a dark theme, because nobody exports from the theme they are
 * not using.
 *
 * The class is stamped on the root and removed in a `finally`, and the caller
 * clones while it is on: getComputedStyle is synchronous, so no frame is
 * painted in between and the user never sees a flash.
 */
function forceLightFigures<T>(read: () => T): T {
  const root = document.documentElement
  const had = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  try {
    return read()
  } finally {
    if (had === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', had)
  }
}

/** Clone with every computed style inlined, on a white plate, ready to write. */
function portableSvg(svg: SVGSVGElement): { xml: string; w: number; h: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement
  forceLightFigures(() => inlineStyles(svg, clone))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const box = svg.viewBox.baseVal
  const w = box?.width || svg.clientWidth || 800
  const h = box?.height || svg.clientHeight || 400
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(box?.x ?? 0))
  bg.setAttribute('y', String(box?.y ?? 0))
  bg.setAttribute('width', String(w))
  bg.setAttribute('height', String(h))
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)
  return { xml: new XMLSerializer().serializeToString(clone), w, h }
}

/**
 * The figure as vector.
 *
 * The only export that survives a journal's production step without being
 * resampled, and the only one where a co-author can fix a label without coming
 * back for the data. Everything on screen is already SVG or points on a canvas,
 * so for most of these figures this is the honest format and the PNG is the
 * convenience.
 */
export function svgToFile(svg: SVGSVGElement, name: string): void {
  const blob = new Blob([portableSvg(svg).xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  triggerDownload(url, `${name}.svg`)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Rasterize an inline <svg> and save it. `scale` 2 gives a figure-quality PNG.
 *
 * Through the same portableSvg the vector export uses. It had its own copy of
 * the clone-inline-plate sequence, which is how the two exports of one figure
 * came to differ: the fix that forces light-mode ink landed in one of them.
 */
export async function svgToPng(svg: SVGSVGElement, name: string, scale = 2): Promise<void> {
  const { xml, w, h } = portableSvg(svg)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('svg render failed'))
      img.src = url
    })
    const cv = document.createElement('canvas')
    cv.width = Math.round(w * scale)
    cv.height = Math.round(h * scale)
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.drawImage(img, 0, 0, cv.width, cv.height)
    triggerDownload(cv.toDataURL('image/png'), `${name}.png`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function canvasToPng(cv: HTMLCanvasElement, name: string): void {
  triggerDownload(cv.toDataURL('image/png'), `${name}.png`)
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(name: string, header: string[], rows: unknown[][]): void {
  const lines = [header.join(','), ...rows.map(r => r.map(csvCell).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  triggerDownload(url, `${name}.csv`)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Filesystem-safe slug for an exported file name. */
export const slug = (s: string) =>
  s.trim().replace(/[^\w.+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'figure'
