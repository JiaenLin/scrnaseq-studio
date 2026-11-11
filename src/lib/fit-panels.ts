// How the panels of a figure share the stage (docs/DESIGN.md, "Explorer").

// Clear space inside a panel's cell, in CSS pixels: around the canvas, and
// above it for the panel's name when there is more than one panel.
export const EDGE = 12
export const NAME = 28

/**
 * How n panels share a box: the columns × rows that give each panel the
 * largest drawing at the embedding's own aspect (equal units on both axes).
 *
 * The figure used to be sized by width alone, so two panels on a wide, short
 * stage were each half the width and a third of the window stayed empty.
 * Every column count is tried. Fewer rows win unless another layout draws
 * the panels more than 15% larger, because panels that are compared are read
 * side by side: stacking two to gain a few pixels is not worth the eye's trip.
 */
export function fitPanels(n: number, W: number, H: number, aspect: number) {
  const top = n > 1 ? NAME : EDGE
  const tries: { cols: number; rows: number; w: number; h: number }[] = []
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (W - (cols - 1)) / cols, ch = (H - (rows - 1)) / rows
    // Never negative: a box with no room yet (a narrow window's first frame)
    // still has to come back with a layout.
    const w = Math.max(0, Math.floor(Math.min(cw - 2 * EDGE, (ch - top - EDGE) / aspect)))
    tries.push({ cols, rows, w, h: Math.floor(w * aspect) })
  }
  const largest = Math.max(...tries.map(t => t.w))
  // Among the layouts within 15% of the largest: the fewest rows, then the largest.
  return tries.filter(t => t.w * 1.15 >= largest)
    .sort((a, b) => a.rows - b.rows || b.w - a.w)[0]
}
