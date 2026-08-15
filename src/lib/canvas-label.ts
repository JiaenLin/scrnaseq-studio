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

export type CanvasLabel = { name: string; x: number; y: number }

/** Cut to a pixel width using the context's own metrics, losing the tail. */
function cut(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxW) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? `${s.slice(0, lo)}…` : ''
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
  let n = 0
  for (const l of labels) {
    const text = cut(ctx, l.name, maxW)
    if (!text) continue
    const w = ctx.measureText(text).width
    // Keep it on the plate. A centroid near the edge is common — the outlying
    // clusters are exactly the ones a reader wants named.
    const x = Math.min(CW - pad - w / 2, Math.max(pad + w / 2, l.x))
    const y = Math.min(CH - pad - px * 0.3, Math.max(pad + px * 0.8, l.y))
    const box = [x - w / 2 - 2, y - px * 0.78, x + w / 2 + 2, y + px * 0.3]
    if (!placed.every(b =>
      box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])) continue
    placed.push(box)
    ctx.strokeText(text, x, y)
    ctx.fillStyle = fill
    ctx.fillText(text, x, y)
    n++
  }
  return n
}
