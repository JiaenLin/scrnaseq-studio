// The ink a figure is drawn in, as opposed to the ink the app is drawn in.
//
// These are black and a light grey, deliberately, and not the theme's --ink and
// --line. A figure leaves here for a white page: SCpubr sets axis.text and
// axis.ticks to black for the same reason, and the grey-on-white the interface
// uses to stay quiet reads as faint or missing once printed.
//
// In a .ts file rather than beside the components that use them, because a
// module that exports both components and constants breaks fast refresh.

/** Axis lines, ticks, tick labels, mark outlines. */
export const AXIS_INK = '#000000'

/** The grid behind the data. Present, and never competing with it. */
export const GRID_INK = '#DCDFE4'

/**
 * The outline every data mark carries.
 *
 * SCpubr draws its points as `geom_point(color = "black", shape = 21)` — filled
 * with an edge. It matters most exactly where a figure is weakest: a pale dot
 * on white has no boundary without it, and a z-scored dot plot is mostly pale.
 */
export const MARK_EDGE = '#000000'

/**
 * The frame around a colour bar — SCpubr's `legend.framecolor`, grey50.
 *
 * Grey and not black, deliberately: the frame's job is to give the pale end of
 * the scale a boundary against the page, and a black rule around a pale
 * gradient becomes the loudest thing in the legend.
 */
export const FRAME_INK = '#7F7F7F'

/**
 * Breaks cut into a colour bar — SCpubr's `legend.tickcolor`, white.
 *
 * Inside the gradient rather than hung underneath it, so a break sits where the
 * colour actually changes.
 */
export const TICK_INK = '#FFFFFF'

/**
 * Direction of change, as a MARK.
 *
 * These two were four hex literals typed into three components: the volcano's
 * points, the volcano's key, and the violin panel's Δlog₂ label. Two of them
 * then disagreed with the interface's own red and blue in the DEG table, so one
 * study had four colours for two ideas and no file said which was canonical.
 *
 * Deliberately more saturated than the interface's `--up` / `--down`: a 4px dot
 * among thousands on a white plate needs more colour than a column of numbers a
 * reader is already looking straight at. Same idea, two media, one place to
 * change either.
 */
export const UP_MARK = '#EF4444'
export const DOWN_MARK = '#3B82F6'

/** A mark that carries no signal — the non-significant cloud. */
export const NULL_MARK = '#9AA3AF'

/**
 * The dark used for a summary drawn ON a mark rather than beside it.
 *
 * A violin's box, the dot plot's legend disc — things that describe a
 * distribution instead of being another instance of one. Deliberately not
 * AXIS_INK: pure black against a translucent category fill reads as a hole
 * punched through it, where this near-black slate sits on the fill.
 */
export const SUMMARY_INK = '#1F2430'

/** The plate. Every figure leaves on white, whatever theme it was saved from. */
export const PLATE = '#FFFFFF'

/**
 * Cells present but not part of this panel, and the empty end of a bar.
 *
 * SCpubr's argument for keeping them: a split panel showing only its own cells
 * has a different silhouette in every panel, so the reader compares shapes that
 * were never comparable.
 */
export const GHOST_INK = '#E2E5EA'

/** A row label on a figure — darker than interface ink, lighter than the axis. */
export const LABEL_INK = '#334155'

/**
 * Figure type sizes.
 *
 * A separate scale from the interface's --t-* tokens, deliberately: a figure
 * leaves this app for a white page and is sized in the reader's terms, not the
 * chrome's. But it was not a scale at all — 9, 9.5, 10, 10.5, 11, 11.5 and 12
 * were typed at the point of use across six files, which is the same drift the
 * interface tokens were introduced to end.
 *
 * It matters more here than it looks, because labels.ts reserves margins from a
 * size passed in by the caller. A label drawn at 11.5 and measured at 10.5 is a
 * margin 9% short, and `svg { overflow: visible }` means that does not clip, it
 * paints. Naming the sizes is what lets the drawing and the measuring quote the
 * same number.
 */
export const FIG_TYPE = {
  /** Dense tick labels, where a panel holds more than ten of them. */
  dense: 9,
  /** Axis ticks and most in-figure text. Matches the .axis class in index.css. */
  tick: 10.5,
  /** A panel title, a row label, a key entry. */
  label: 11.5,
  /** An axis title, or a legend heading. */
  title: 11.5,
} as const
