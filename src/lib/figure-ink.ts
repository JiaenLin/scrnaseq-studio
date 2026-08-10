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
