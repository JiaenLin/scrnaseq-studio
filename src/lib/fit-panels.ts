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
 * Every column count is tried; a tie goes to fewer rows, because panels that
 * are compared are read side by side.
 */
export function fitPanels(n: number, W: number, H: number, aspect: number) {
  let best = { cols: 1, rows: n, w: 0, h: 0 }
  const top = n > 1 ? NAME : EDGE
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (W - (cols - 1)) / cols, ch = (H - (rows - 1)) / rows
    const w = Math.floor(Math.min(cw - 2 * EDGE, (ch - top - EDGE) / aspect))
    if (w > best.w) best = { cols, rows, w, h: Math.floor(w * aspect) }
  }
  return best
}
