// Exporting figures and tables.
//
// The bulk studio gets PNG export free from Plotly. These figures are hand-drawn
// SVG and canvas, so export is ours to do — and the awkward part is that every
// colour in them is a CSS custom property. A serialized <svg> has no document to
// resolve `var(--ink)` against, so the export would come out black-on-black.
// Everything visual is therefore inlined from the computed style before writing.

import { FIG_TYPE } from './figure-ink.ts'
import { footSvg, layFoot, paintFoot, type Foot } from './figure-foot.ts'

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
  'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor',
  // paint-order, or a haloed label is ERASED by its own halo.
  //
  // The volcano's clicked gene names use `paint-order: stroke` to put a 3.2-unit
  // plate-coloured outline BEHIND the glyph. Without the property the stroke and
  // its width still inline, and SVG's default order paints fill first then
  // stroke — so the halo is drawn over the letters and the label disappears.
  // Measured by an adversarial review: 0 dark pixels in the export against
  // 2 453 on screen. Correct on screen, gone in the file, which is the worst
  // place for a defect to live.
  'paint-order', 'stroke-linejoin',
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
  // A gradient stop's colour is its own property, and only a stop has one
  // worth writing: a themed stop (`.gstop`) has it from the stylesheet alone.
  if (src.tagName.toLowerCase() === 'stop') {
    const v = cs.getPropertyValue('stop-color')
    if (v) { decl.push(`stop-color:${v}`); dst.setAttribute('stop-color', v) }
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

/** A figure of several panels is set across two columns: 183 mm at Nature. */
export const SHEET_INCHES = 7

/**
 * The multiplier that renders a figure `px` wide at `dpi`, `inches` wide in print.
 *
 * Exactly that, with no floor. It was `max(1, ...)`, so a drawing wider than
 * the pixels its stated width holds was written one to one: Markers' "3.5 in"
 * file was 3.80 in at a 1,440 px window and a one-panel Cells figure 3.69.
 */
export const scaleForDpi = (px: number, dpi: number, inches: number = FIGURE_INCHES): number =>
  (inches * dpi) / Math.max(1, px)

/**
 * The print scale: this many CSS pixels of a drawing to one inch of page.
 *
 * One scale for every saved figure, so its type lands where a journal asks
 * for it whatever the window was: 0.6 pt to the pixel, which sets the
 * figures' 10.5 px ticks at 6.3 pt and their 11.5 px labels at 6.9. A 420 px
 * drawing is one column (3.5 in) and an 840 px one is two (7 in). Every
 * figure was "3.5 in wide" whatever its drawn width, which printed Markers'
 * type at 2.3 pt and one Composition panel's at 12.6.
 */
export const PRINT_PX_PER_IN = 120

/** The smallest type a saved figure may print: the floor journals set. */
export const MIN_PRINT_PT = 5

export interface PrintSize {
  /** The file's width on the page, a multiple of 0.1 in. */
  inches: number
  mm: number
  /** What the figures' smallest type (`FIG_TYPE.tick`) prints at, at that width. */
  pt: number
  fits: 'one' | 'two' | 'wider'
}

/**
 * The width a drawing `px` wide is saved at, and what its type prints at.
 *
 * Its own width at the print scale, to 0.1 in. Past two columns it is set at
 * two columns while its smallest type stays at 5 pt or more; wider than
 * that, it keeps 5 pt and is wider than the page, and the menu says so. The
 * menu's words and the file's size are both read from here, so they cannot
 * disagree at any window.
 */
export function printSize(px: number): PrintSize {
  const w = Math.max(1, px)
  const own = w / PRINT_PX_PER_IN
  const inches = own <= SHEET_INCHES + 0.05
    ? Math.max(0.5, Math.round(own * 10) / 10)
    : Math.max(SHEET_INCHES, Math.ceil(((w * MIN_PRINT_PT) / (FIG_TYPE.tick * 72)) * 10 - 1e-9) / 10)
  return {
    inches: +inches.toFixed(1),
    mm: Math.round(inches * 25.4),
    pt: Math.round(((FIG_TYPE.tick * 72 * inches) / w) * 10) / 10,
    fits: inches <= FIGURE_INCHES ? 'one' : inches <= SHEET_INCHES ? 'two' : 'wider',
  }
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Write the resolution into a PNG (a pHYs chunk after the header).
 *
 * A canvas writes none, so a file named "300dpi" opened at 72 in every
 * program that reads the field, and a journal's preflight reads the field,
 * not the name.
 */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const IHDR_END = 8 + 4 + 4 + 13 + 4
  if (png.length < IHDR_END || png[12] !== 0x49 || png[13] !== 0x48) return png
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const v = new DataView(chunk.buffer)
  v.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // pHYs
  v.setUint32(8, ppm)
  v.setUint32(12, ppm)
  chunk[16] = 1 // the unit is the metre
  v.setUint32(17, crc32(chunk.subarray(4, 17)))
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, IHDR_END), 0)
  out.set(chunk, IHDR_END)
  out.set(png.subarray(IHDR_END), IHDR_END + chunk.length)
  return out
}

function savePng(cv: HTMLCanvasElement, filename: string, dpi?: number): void {
  const b64 = cv.toDataURL('image/png').split(',')[1]
  const raw = atob(b64)
  let bytes: Uint8Array = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  if (dpi) bytes = pngWithDpi(bytes, dpi)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  triggerDownload(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

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
  // Transitions off first. A computed colour that is in transition reads as
  // the value it is leaving: under reduced motion every element carried a
  // 120 ms transition on every property, so the stamp reached the root and
  // every mark still read the dark theme's ink (measured: --fig-ink #000 on
  // the root, fill rgb(231, 233, 236) on each tick label). The exported
  // figure had white text on a white page.
  root.setAttribute('data-exporting', '')
  root.setAttribute('data-theme', 'light')
  try {
    return read()
  } finally {
    if (had === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', had)
    // Settle back to the reader's theme while transitions are still off, so
    // the figure on screen does not fade from print ink to its own.
    void getComputedStyle(root).color
    root.removeAttribute('data-exporting')
  }
}

/** A colour as print writes it: a custom property is read while the light theme is stamped. */
const printColor = (c: string): string => {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim())
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#000000' : c
}

/** The interface's own face, so a foot is set in the figure's type. */
const figureFamily = (): string => getComputedStyle(document.body).fontFamily

/**
 * Clone with every computed style inlined, on a white plate, ready to write;
 * with the figure's foot under it (lib/figure-foot.ts) when it declares one.
 */
function portableSvg(svg: SVGSVGElement, given?: Foot): { xml: string; w: number; h: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement
  // A drawing that knows its own n says so on itself (`data-foot`, JSON): a
  // heat map counts its columns where the figure around it cannot.
  let foot = given
  const own = svg.getAttribute('data-foot')
  if (own) {
    try {
      const o = JSON.parse(own) as Foot
      foot = { title: given?.title ?? o.title, key: given?.key ?? o.key, notes: [...(given?.notes ?? []), ...(o.notes ?? [])] }
    } catch { /* not a foot: the figure's own stands */ }
    clone.removeAttribute('data-foot')
  }
  const box = svg.viewBox.baseVal
  const w = box?.width || svg.clientWidth || 800
  const h0 = box?.height || svg.clientHeight || 400
  const x0 = box?.x ?? 0, y0 = box?.y ?? 0
  const under = forceLightFigures(() => {
    inlineStyles(svg, clone)
    return footSvg(foot, w, y0 + h0, figureFamily(), printColor)
  })
  const h = h0 + under.h
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`)
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(x0))
  bg.setAttribute('y', String(y0))
  bg.setAttribute('width', String(w))
  bg.setAttribute('height', String(h))
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)
  const xml = new XMLSerializer().serializeToString(clone)
  // The foot is written as text, after the drawing: the last thing in the root.
  return { xml: under.h ? xml.replace(/<\/svg>\s*$/, `${x0 ? `<g transform="translate(${x0} 0)">${under.xml}</g>` : under.xml}</svg>`) : xml, w, h }
}

/**
 * A painted figure with its foot under it: the same strip a vector figure
 * gets, at the canvas's scale (`k` backing pixels to a CSS pixel).
 */
export function canvasWithFoot(cv: HTMLCanvasElement, foot: Foot | undefined, k: number): HTMLCanvasElement {
  const width = cv.width / k
  const { h } = layFoot(foot, width)
  if (!h) return cv
  const out = document.createElement('canvas')
  out.width = cv.width
  out.height = cv.height + Math.round(h * k)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(cv, 0, 0)
  forceLightFigures(() => paintFoot(ctx, foot, width, cv.height / k, k, figureFamily(), printColor))
  return out
}

/**
 * Several panels, tiled into one figure.
 *
 * A small multiple is one figure that happens to be drawn as nine SVGs, and
 * saving it meant nine clicks and nine files to reassemble in Illustrator. This
 * lays the panels out on a grid at their own sizes, on one white plate, so what
 * comes out is the sheet as it reads on screen.
 *
 * Each panel goes in as a nested <svg> with explicit x/y/width/height, which is
 * the one construction that keeps every panel's own viewBox and coordinate
 * system intact — re-parenting their children into a shared space would need
 * every coordinate rewritten, and any one that was missed would silently move.
 */
export function sheetXml(
  svgs: SVGSVGElement[], cols = 3, gap = 12, foot?: Foot,
): { xml: string; w: number; h: number } | null {
  if (!svgs.length) return null
  const parts = svgs.map(v => portableSvg(v))
  const n = Math.min(cols, parts.length)
  const rows = Math.ceil(parts.length / n)
  // A uniform cell, so panels of slightly different heights still line up in a
  // grid rather than drifting down the page.
  const cw = Math.max(...parts.map(p => p.w))
  const ch = Math.max(...parts.map(p => p.h))
  const W = n * cw + (n + 1) * gap
  const H0 = rows * ch + (rows + 1) * gap
  // One foot for the sheet, under every panel: its key and n are the sheet's.
  const under = forceLightFigures(() => footSvg(foot, W, H0 - gap + 2, figureFamily(), printColor))
  const H = H0 + (under.h ? under.h - gap + 2 : 0)

  const inner = parts.map((p, i) => {
    const x = gap + (i % n) * (cw + gap)
    const y = gap + Math.floor(i / n) * (ch + gap)
    // The panel's own root, re-attributed to sit in its cell. Its width/height
    // were set by portableSvg and its viewBox is untouched, so it scales into
    // the cell exactly as the browser scales it into its card.
    return p.xml
      .replace(/^<svg /, `<svg x="${x}" y="${y}" `)
      .replace(/\swidth="[^"]*"/, ` width="${p.w}"`)
      .replace(/\sheight="[^"]*"/, ` height="${p.h}"`)
  }).join('')

  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" `
    + `viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#ffffff"/>${inner}${under.xml}</svg>`
  return { xml, w: W, h: H }
}

/**
 * The vector file at its print size: the root's width and height in inches.
 *
 * They were bare numbers, which a browser reads as CSS pixels (96 to the
 * inch) and Illustrator as points (72), so the same file was two sizes and
 * neither was the width the menu named. The viewBox is untouched: the
 * drawing is the same, placed on the page at the stated width.
 */
export function atPrintSize(file: { xml: string; w: number; h: number }): string {
  const { inches } = printSize(file.w)
  const high = +((inches * file.h) / Math.max(1, file.w)).toFixed(3)
  return file.xml.replace(/^<svg\b[^>]*>/, tag => tag
    .replace(/\swidth="[^"]*"/, ` width="${inches}in"`)
    .replace(/\sheight="[^"]*"/, ` height="${high}in"`))
}

export function svgSheetToFile(
  svgs: SVGSVGElement[], name: string, cols = 3, gap = 12, foot?: Foot,
): void {
  const sheet = sheetXml(svgs, cols, gap, foot)
  if (!sheet) return
  const blob = new Blob([atPrintSize(sheet)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  triggerDownload(url, `${name}_sheet.svg`)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The same sheet as a PNG at `scale`, with its resolution written in. */
export async function svgSheetToPng(
  svgs: SVGSVGElement[], name: string, cols: number, scale: number, dpi?: number, foot?: Foot,
): Promise<void> {
  const sheet = sheetXml(svgs, cols, 12, foot)
  if (sheet) await xmlToPng(sheet, `${name}_sheet`, scale, dpi)
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
export function svgToFile(svg: SVGSVGElement, name: string, foot?: Foot): void {
  const blob = new Blob([atPrintSize(portableSvg(svg, foot))], { type: 'image/svg+xml;charset=utf-8' })
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
export async function svgToPng(
  svg: SVGSVGElement, name: string, scale = 2, dpi?: number, foot?: Foot,
): Promise<void> {
  await xmlToPng(portableSvg(svg, foot), name, scale, dpi)
}

async function xmlToPng(
  { xml, w, h }: { xml: string; w: number; h: number }, name: string, scale: number, dpi?: number,
): Promise<void> {
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
    savePng(cv, `${name}.png`, dpi)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function canvasToPng(cv: HTMLCanvasElement, name: string, dpi?: number): void {
  savePng(cv, `${name}.png`, dpi)
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
