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
    if (v && v !== 'none' && v !== 'normal') decl.push(`${p}:${v}`)
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

/** Rasterize an inline <svg> and save it. `scale` 2 gives a figure-quality PNG. */
export async function svgToPng(svg: SVGSVGElement, name: string, scale = 2): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineStyles(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const box = svg.viewBox.baseVal
  const w = box?.width || svg.clientWidth || 800
  const h = box?.height || svg.clientHeight || 400
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))

  // A white plate, so the PNG is usable in a manuscript regardless of the theme
  // the figure was exported from.
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(box?.x ?? 0))
  bg.setAttribute('y', String(box?.y ?? 0))
  bg.setAttribute('width', String(w))
  bg.setAttribute('height', String(h))
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: 'image/svg+xml;charset=utf-8',
  })
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
