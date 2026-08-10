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
