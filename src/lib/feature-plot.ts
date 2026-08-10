// Expression on the embedding, drawn once and used at two sizes.
//
// It lives here rather than inside the component for one reason: a figure going
// into a manuscript needs more pixels than a figure on screen. A 320 px panel
// exported as-is is about 90 dpi at print size, which is a rejection from most
// journals — so export re-runs this against an offscreen canvas several times
// larger. Two copies of the drawing would drift, and the exported figure would
// stop being the figure the reader approved.
//
// Everything that depends on size is therefore expressed as a fraction of the
// width, not in pixels.

import type { Cell } from '../types.ts'
import { rampColor, type RampKey } from './palette.ts'

export interface FeatureDraw {
  /** Interleaved x,y per cell. */
  xy: Float32Array
  extent: { x0: number; x1: number; y0: number; y1: number }
  vals: Float32Array
  cells: Cell[]
  /** The group this panel is for, or null for the whole object. */
  cond: string | null
  /** Which cells the reader chose to keep. Others become the silhouette. */
  visible: (cell: Cell) => boolean
  /** Value mapped to the top of the ramp; anything above is clipped to it. */
  top: number
  /** Value mapped to the bottom. Non-zero when the reader raises the floor. */
  floor: number
  ramp: RampKey
  /** Cluster names at their centroids, or null to leave them off. */
  labels: { name: string; x: number; y: number }[] | null
  /** A ring around each cell, the way SCpubr draws them. */
  borders: boolean
  /**
   * Cells excluded from this panel, drawn in grey underneath.
   *
   * SCpubr's argument for this is the one that matters: a split panel showing
   * only its own cells has a different silhouette in every panel, so the reader
   * compares shapes that were never comparable. Keeping the whole embedding as
   * a ghost means every panel is the same map with different things lit on it.
   */
  silhouette: boolean
  /** Page background, so the plate matches the surrounding card. */
  background: string
}

/** Grey for cells that are present but not part of this panel. */
const GHOST = '#E2E5EA'
const GHOST_DARK = '#2A2F3A'

export function drawFeature(
  ctx: CanvasRenderingContext2D, W: number, H: number, o: FeatureDraw, dark = false,
): void {
  ctx.fillStyle = o.background
  ctx.fillRect(0, 0, W, H)

  const { x0, x1, y0, y1 } = o.extent
  const sx = x1 > x0 ? W / (x1 - x0) : 1
  const sy = y1 > y0 ? H / (y1 - y0) : 1
  const X = (i: number) => (o.xy[2 * i] - x0) * sx
  const Y = (i: number) => H - (o.xy[2 * i + 1] - y0) * sy

  const cells = o.cells
  const inPanel = new Uint8Array(cells.length)
  let n = 0
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if ((!o.cond || c.cond === o.cond) && o.visible(c)) { inPanel[i] = 1; n++ }
  }

  // Radius as a fraction of the panel, so an export at four times the size is
  // the same picture rather than the same picture with tiny dots.
  const unit = W / 640
  const r = (n > 120000 ? 1.2 : n > 12000 ? 1.5 : 2.1) * unit

  if (o.silhouette) {
    ctx.fillStyle = dark ? GHOST_DARK : GHOST
    for (let i = 0; i < cells.length; i++) {
      if (inPanel[i]) continue
      ctx.beginPath()
      ctx.arc(X(i), Y(i), r, 0, 6.283185)
      ctx.fill()
    }
  }

  // Ascending, so the positive cells land on top. Seurat calls this order=TRUE
  // and it is the difference between seeing a rare population and not: a few
  // hundred bright cells are invisible under a quarter of a million dim ones.
  const idx = new Int32Array(n)
  let k = 0
  for (let i = 0; i < cells.length; i++) if (inPanel[i]) idx[k++] = i
  idx.sort((a, b) => o.vals[a] - o.vals[b])

  const span = o.top > o.floor ? o.top - o.floor : 1
  const ring = o.borders && n <= 60000
  for (const i of idx) {
    const px = X(i), py = Y(i)
    if (ring) {
      ctx.fillStyle = dark ? 'rgba(0,0,0,.55)' : 'rgba(70,78,92,.55)'
      ctx.beginPath()
      ctx.arc(px, py, r + 0.55 * unit, 0, 6.283185)
      ctx.fill()
    }
    ctx.fillStyle = rampColor(Math.min(1, Math.max(0, (o.vals[i] - o.floor) / span)), o.ramp)
    ctx.beginPath()
    ctx.arc(px, py, r, 0, 6.283185)
    ctx.fill()
  }

  if (o.labels) {
    ctx.font = `600 ${Math.round(17 * unit)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.lineWidth = 3.5 * unit
    ctx.strokeStyle = dark ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.9)'
    for (const l of o.labels) {
      const px = (l.x - x0) * sx
      const py = H - (l.y - y0) * sy
      ctx.strokeText(l.name, px, py)
      ctx.fillStyle = dark ? '#E6EAF2' : '#334155'
      ctx.fillText(l.name, px, py)
    }
  }
}
