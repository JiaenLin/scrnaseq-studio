// Painting the Cells tab's embedding onto a 2-D canvas.
//
// Moved out of the component so that what is drawn — which colour each cell
// gets, in which order, and which names are written on the plate — can be
// checked in a test against a recording context, rather than only looked at.
// The component keeps the part that is about the page: the canvas element, its
// size, and the theme colours read off the document.

import type { CellType, ColorBy, Dataset } from '../types.ts'
import { drawLabels } from './canvas-label.ts'
import { clusterCentroids, embedExtent } from './chart.ts'
import { pal, rampColor, type PaletteKey, type RampKey } from './palette.ts'
import { SENTINEL_GREY, sentinelMask } from './sentinels.ts'

export interface EmbedPaint {
  d: Dataset
  types: CellType[]
  /** Interleaved x,y per cell — whichever of the object's embeddings is chosen. */
  xy: Float32Array
  /** One group's cells only, or null for all of them. */
  cond: string | null
  colorBy: ColorBy
  palKey: PaletteKey
  rampKey: RampKey
  /** Write the cluster names on the plate. */
  labels: boolean
  /** Theme colours: label text, its halo, and the plate. */
  ink: string
  surface: string
  sunk: string
  /** Point radius in canvas pixels. Left out, the size the painter always used. */
  radius?: number
  /** Label size in canvas pixels (20 when left out). */
  labelPx?: number
  /** Clear margin inside the canvas, in canvas pixels, so no point is cut by the edge. */
  pad?: number
  /**
   * Isolate: cells this keeps are drawn as usual, on top; the rest go under
   * them in `mute`. Left out, every cell is drawn as usual.
   */
  keep?: (cell: number) => boolean
  mute?: string
}

/**
 * The order cells are painted in: the order the object holds them, except that
 * a sentinel's cells go first when the colour is the cell type.
 *
 * First means underneath. A grey cell painted over a typed one would hide a
 * population behind cells that belong to none, and on a dense embedding that
 * is most of the cells near a boundary. null when nothing needs reordering,
 * which is every object without sentinels.
 */
export function paintOrder(d: Dataset, types: readonly CellType[], colorBy: ColorBy): Int32Array | null {
  const sent = colorBy === 'type' ? sentinelMask(types) : null
  if (!sent) return null
  const out = new Int32Array(d.cells.length)
  let k = 0
  for (let i = 0; i < d.cells.length; i++) if (sent[d.cells[i].t]) out[k++] = i
  for (let i = 0; i < d.cells.length; i++) if (!sent[d.cells[i].t]) out[k++] = i
  return out
}

export function paintEmbedding(g: CanvasRenderingContext2D, o: EmbedPaint): void {
  const { d, types, xy, cond, colorBy, palKey, rampKey, labels } = o
  const W = g.canvas.width
  const H = g.canvas.height
  g.fillStyle = o.sunk
  g.fillRect(0, 0, W, H)
  const { x0, x1, y0, y1 } = embedExtent(xy)
  /**
   * The top of the mito ramp, from the data rather than a literal 9.
   *
   * Both exporters convert mitochondrial content to a PERCENTAGE, so a fixed
   * ceiling of 9 gave every cell from 9% to 100% the identical colour: a
   * dying 40–60% cluster looked exactly like a healthy one at 9, and the
   * reader could not see where their own QC cutoff fell. The 99th percentile
   * rather than the maximum, so one extreme cell does not flatten the rest —
   * which is the same rule the feature plot's percentile ceiling uses.
   */
  const mitoTop = (() => {
    if (colorBy !== 'mito') return 0
    const vs = d.cells.map(c => c.mito).filter(v => v > 0).sort((a, b) => a - b)
    if (!vs.length) return 0
    return vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.99))] || 0
  })()
  const r = o.radius ?? (labels ? (cond ? 1.7 : 1.9) : 1.4)
  const pad = o.pad ?? 0
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad)
  const sy = (v: number) => pad + (1 - (v - y0) / (y1 - y0)) * (H - 2 * pad)
  // Grey for the cells the annotator did not call, when the colour is the cell
  // type; every type keeps its own palette colour, by its own index.
  const sent = colorBy === 'type' ? sentinelMask(types) : null

  const order = paintOrder(d, types, colorBy)
  const n = d.cells.length
  // Isolated: one pass for the cells set aside, underneath, then the kept.
  for (const pass of o.keep ? [0, 1] : [1]) {
    for (let k = 0; k < n; k++) {
      const i = order ? order[k] : k
      const c = d.cells[i]
      if (cond && c.cond !== cond) continue
      if (o.keep && o.keep(i) !== (pass === 1)) continue
      g.fillStyle = pass === 0 ? (o.mute ?? SENTINEL_GREY)
        : colorBy === 'type' ? (sent && sent[c.t] ? SENTINEL_GREY : pal(c.t, palKey))
        : colorBy === 'cond' ? pal(d.conds.indexOf(c.cond), palKey)
        : colorBy === 'sample' ? pal(d.samples.findIndex(s => s.id === c.s), palKey)
        : rampColor(mitoTop > 0 ? Math.min(1, c.mito / mitoTop) : 0, rampKey)
      g.beginPath()
      g.arc(sx(xy[2 * i]), sy(xy[2 * i + 1]), r, 0, 6.284)
      g.fill()
    }
  }

  if (labels) {
    const px = o.labelPx ?? 20
    g.font = `600 ${px}px system-ui`
    // A halo a little over a quarter of the type's height, with round joins
    // so no letter grows a spike.
    g.lineWidth = o.labelPx ? Math.max(4, Math.round(px * 0.28)) : 4
    g.lineJoin = 'round'
    const at = clusterCentroids(xy, d, types.length)
    // No name for a sentinel: its cells are wherever the annotator gave up, and
    // a label at their median would mark a place that is not a population.
    drawLabels(g, types.flatMap((t, ti) => (t.sentinel ? [] : [{
      name: t.name,
      x: sx(at[ti].x),
      y: sy(at[ti].y),
    }])), { fill: o.ink, halo: o.surface })
  }
}
