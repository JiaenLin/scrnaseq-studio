// Which drawing a figure's Save writes.
//
// Save took the first <svg> inside the figure's box. Cells' box holds the axis
// glyph and a small multiple's box holds the drawn download icon, so Cells
// saved the glyph (four different states, one byte-identical file) and every
// corner Save saved its own icon. The rule is written down here, away from the
// component, so a check can hold it (scripts/test-export.mjs):
//
//   - a figure that brings its own painter (`redraw`) is a canvas figure and is
//     never saved from an SVG, whatever SVG sits beside its canvases;
//   - the SVG a figure saves is a drawing, so never one that is hidden from
//     the accessibility tree (an icon, a glyph) and never one inside a control.

/** The least of the DOM this needs, so the rule runs without a browser. */
export interface PickNode {
  getAttribute(name: string): string | null
  closest(selector: string): unknown
}
export interface PickRoot {
  querySelectorAll(selector: string): Iterable<PickNode> | ArrayLike<PickNode>
}

/** Everything that is chrome inside a figure's box, never the figure. */
export const NOT_FIGURE = 'button, [role="menu"], .fig-actions, .fig-corner'

export function isDrawing(svg: PickNode): boolean {
  const hidden = svg.getAttribute('aria-hidden')
  if (hidden !== null && hidden !== 'false') return false
  return !svg.closest(NOT_FIGURE)
}

/** The figure's own SVG, or null when the figure is not drawn as one. */
export function figureSvg<T extends PickNode>(
  box: { querySelectorAll(selector: string): Iterable<T> | ArrayLike<T> } | null | undefined,
  canvasFigure = false,
): T | null {
  if (!box || canvasFigure) return null
  for (const svg of Array.from(box.querySelectorAll('svg'))) if (isDrawing(svg)) return svg
  return null
}

/** Every drawing in a sheet of panels, in document order. */
export function sheetSvgs<T extends PickNode>(
  box: { querySelectorAll(selector: string): Iterable<T> | ArrayLike<T> } | null | undefined,
): T[] {
  if (!box) return []
  return Array.from(box.querySelectorAll('svg')).filter(isDrawing)
}
