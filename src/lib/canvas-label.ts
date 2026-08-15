// Cluster names on an embedding, drawn so they can be read.
//
// Three canvases draw them — the Cells scatter, the feature-plot panels, the
// gene-set score map — and all three drew `fillText(name, x, y)` centred on the
// cluster's centroid with nothing else: no measurement, no bound, no notice of
// the label already sitting there. On the demo objects, whose clusters are
// called "qNSC" and "aNSC", that is fine. On a real annotation it is not:
// "Cardiomyocyte/Working cardiomyocyte" measures 341 px against a 640 px
// canvas, and clusters that are adjacent in the embedding — which is what
// makes them worth labelling together — have adjacent centroids. Measured on
// one real object: 11 label-on-label collisions, the worst 160 px deep, and one
// name running off the plate.
//
// The policy is the volcano's, because it is the same problem: a name written
// over another name is worse than no name, since the reader cannot tell which
// of the two they are reading. So cut to a share of the plate, keep it on the
// plate, and drop any label that cannot be placed clear. Every cluster keeps
// its colour and its legend entry either way — the label is the redundant
// encoding, and it is the one that should yield.
//
// What is never done is CUTTING a name. A cluster called
// "Endothelial/Lymphatic" and one called "Endothelial/Lymphoid" differ in their
// last four characters; an ellipsis makes them the same label. Too wide means
// smaller type, and past a floor it means no label at all.

export type CanvasLabel = { name: string; x: number; y: number }

/**
 * The font size at which a label fits a width, never the label cut to fit it.
 *
 * A cluster name is an identifier: "Endothelial/Lymphatic" and
 * "Endothelial/Lymphoid" differ in their last four characters, so cutting the
 * tail turns two distinguishable populations into the same string. Shrinking
 * the type keeps every character and costs only legibility, which the reader
 * can fix by making the panel bigger. Floored, because below about nine pixels
 * nothing is gained; past that the label is dropped rather than shortened, and
 * the cluster keeps its colour and its legend entry.
 */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number): number {
  if (ctx.measureText(text).width <= maxW) return px
  const base = ctx.font
  for (let size = px - 1; size >= 9; size--) {
    ctx.font = base.replace(/\d+(\.\d+)?px/, `${size}px`)
    if (ctx.measureText(text).width <= maxW) return size
  }
  ctx.font = base
  return 0
}

/**
 * Draw cluster labels, halo first, and return how many were placed.
 *
 * `ctx.font`, `textAlign` and `lineWidth` are read as set by the caller — the
 * three canvases size their type differently and that is theirs to decide.
 */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly CanvasLabel[],
  o: { fill: string; halo: string; maxFrac?: number; pad?: number },
): number {
  const { fill, halo, maxFrac = 0.34, pad = 3 } = o
  const CW = ctx.canvas.width, CH = ctx.canvas.height
  const px = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '16')
  const maxW = CW * maxFrac
  const placed: number[][] = []

  ctx.textAlign = 'center'
  ctx.strokeStyle = halo
  const font = ctx.font
  let n = 0
  for (const l of labels) {
    const text = l.name
    ctx.font = font
    const size = fitFont(ctx, text, maxW, px)
    if (!size) continue
    if (size !== px) ctx.font = font.replace(/\d+(\.\d+)?px/, `${size}px`)
    const w = ctx.measureText(text).width
    // Keep it on the plate. A centroid near the edge is common — the outlying
    // clusters are exactly the ones a reader wants named.
    const x = Math.min(CW - pad - w / 2, Math.max(pad + w / 2, l.x))
    const y = Math.min(CH - pad - size * 0.3, Math.max(pad + size * 0.8, l.y))
    const box = [x - w / 2 - 2, y - size * 0.78, x + w / 2 + 2, y + size * 0.3]
    if (!placed.every(b =>
      box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])) continue
    placed.push(box)
    ctx.strokeText(text, x, y)
    ctx.fillStyle = fill
    ctx.fillText(text, x, y)
    n++
  }
  ctx.font = font
  return n
}
