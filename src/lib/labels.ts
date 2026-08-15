// How much room a label needs, in one place.
//
// Every chart in the studio reserved its own margin with its own constant, and
// each of them was right for the object it was written against and wrong for a
// real one. `svg { overflow: visible }` is set globally, so a chart that
// underestimates does not clip — it PAINTS, over the panel beside it or the
// caption beneath it. That is one bug reported four times.
//
// The estimates are deliberately crude and deliberately shared. A crude number
// used by both the "does this fit?" test and the "how much room shall I leave?"
// calculation cannot disagree with itself, which is the failure that actually
// happened: Composition asked whether a label fitted using 5.4 units per
// character and then reserved a fixed 36 units regardless of the answer.

/**
 * Em per character, MEASURED rather than guessed.
 *
 * Rendered in the browser at 9, 10.5 and 11.5 px over the strings this app
 * actually draws — cell types like "Cardiomyocyte/Working cardiomyocyte
 * EXCLUDED", groups like "young_chow", MSigDB names like
 * "GOBP_REGULATION_OF_CELL_POPULATION_PROLIFERATION" — and read back with
 * getBBox. The ratio is flat across those sizes: 0.559 at weight 400 and 0.589
 * at 600 and above.
 *
 * Rounded up, because every number here becomes a margin and a margin that is
 * a little too big costs whitespace while one that is a little too small paints
 * over the neighbouring panel. The first version of this file guessed 0.515 for
 * everything, which under-reserved by 8% on body text and 14% on the semibold
 * labels — enough that the markers dot plot still ran 30 units off its own left
 * edge after the margin had supposedly been fixed.
 */
const EM_NORMAL = 0.575
const EM_BOLD = 0.605

/** Width of a string at a given font size, in the same units the viewBox uses. */
export const textW = (s: string, px = 10.5, bold = false): number =>
  s.length * px * (bold ? EM_BOLD : EM_NORMAL)

/** The widest of several labels. */
export const widestW = (labels: readonly string[], px = 10.5, bold = false): number =>
  labels.reduce((w, s) => Math.max(w, textW(s, px, bold)), 0)

/**
 * Do these labels fit upright, side by side, in a band this wide?
 *
 * `gap` is the breathing room between neighbours; two labels that touch are
 * as unreadable as two that overlap.
 */
export const fitsUpright = (
  labels: readonly string[], band: number, px = 10.5, gap = 4, bold = false,
): boolean => widestW(labels, px, bold) + gap <= band

/**
 * The bottom margin rotated tick labels need.
 *
 * A label anchored at its end and rotated by `deg` below horizontal hangs
 * `width * sin(deg)` below its anchor. `startAt` is how far under the axis the
 * anchor sits, and `descend` is room for the lowest glyph's descender.
 *
 * Capped, because one pathological label should cost a tall axis and not the
 * whole panel; past the cap the caller should be shortening the label instead.
 */
export function rotatedBottom(
  labels: readonly string[],
  { deg = 38, startAt = 12, px = 10.5, descend = 6, max = 96, bold = false } = {},
): number {
  const drop = widestW(labels, px, bold) * Math.sin((deg * Math.PI) / 180)
  return Math.min(max, Math.ceil(startAt + drop + descend))
}

/**
 * The whole bottom-axis decision: upright or rotated, at what angle, cut to
 * what width, over how deep a margin.
 *
 * These four answers have to agree, and split across four call sites they did
 * not. `rotatedBottom` alone caps the margin at 96 units — which decides how
 * far a 253-unit label hangs PAST the box, not whether it hangs past at all,
 * and a measured 47 units of the violin panel's group names were landing on
 * the caption below. A cap on the margin is only half a decision; the other
 * half is cutting the label to the margin that was actually reserved.
 *
 * Three constraints, all of them geometry:
 *
 *   bottom  a label of width w at angle a hangs `w·sin(a)` below its anchor
 *   left    anchored at its end, it also reaches `w·cos(a)` to the LEFT — so
 *           the first tick on the axis is the one that runs off the plate
 *   pitch   two neighbours `band` apart clear each other by `band·sin(a)`,
 *           which is why 40 categories in 352 units overlapped at 42° no
 *           matter how much bottom margin was reserved
 *
 * The angle steepens to satisfy the third, then the width is cut to satisfy
 * the first two at that angle.
 */
export function axisTicks(labels: readonly string[], o: {
  /** Horizontal pitch between neighbouring ticks. */
  band: number
  /** x of the first tick's anchor — how much room it has to reach left into. */
  leftAnchor: number
  px?: number
  /** Preferred angle; steepened only if neighbours would collide. */
  deg?: number
  /** How far under the axis the text begins. */
  startAt?: number
  descend?: number
  /** The deepest bottom margin worth spending before cutting labels instead. */
  maxBottom?: number
  gap?: number
  /** Bottom margin to use when the labels fit upright. */
  upright?: number
}): { rotate: boolean; deg: number; shown: string[]; bottom: number } {
  const {
    band, leftAnchor, px = 10.5, deg = 38, startAt = 12,
    descend = 6, maxBottom = 96, gap = 4, upright = 26,
  } = o
  if (fitsUpright(labels, band, px, gap)) {
    return { rotate: false, deg: 0, shown: [...labels], bottom: upright }
  }
  const rad = (d: number) => (d * Math.PI) / 180
  const lineH = px * 1.2
  let a = 90
  for (const cand of [deg, 55, 72, 90]) {
    a = cand
    if (band * Math.sin(rad(a)) >= lineH) break
  }
  // At 90° the text stands straight up from its anchor and reaches left by its
  // line height, not its length, so only the bottom binds.
  const room = Math.min(
    (maxBottom - startAt - descend) / Math.sin(rad(a)),
    a >= 89 ? Infinity : (leftAnchor - 2) / Math.cos(rad(a)),
  )
  const shown = labels.map(s => fit(s, Math.max(18, room), px))
  return {
    rotate: true,
    deg: a,
    shown,
    bottom: rotatedBottom(shown, { deg: a, startAt, px, descend, max: maxBottom }),
  }
}

/**
 * Cut a label to a width, losing the TAIL.
 *
 * Never the head. A pathway is identified by how its name begins, and a cell
 * type by its lineage — "…/Working cardiomyocyte" and "…c ribosomal proteins"
 * are both worse than useless, because they look like a name.
 */
export function fit(s: string, width: number, px = 10.5, bold = false): string {
  const room = Math.floor(width / (px * (bold ? EM_BOLD : EM_NORMAL)))
  return s.length > room ? `${s.slice(0, Math.max(1, room - 1))}…` : s
}

/**
 * Wrap onto at most `lines` lines, cutting the tail of the last one.
 *
 * Preferred over `fit` wherever there is vertical room: it keeps the whole
 * name. Breaks on spaces, and falls back to a hard cut for a single word
 * longer than the line.
 */
export function wrap(s: string, width: number, lines = 2, px = 10.5): string[] {
  const room = Math.max(4, Math.floor(width / (px * EM_NORMAL)))
  if (s.length <= room) return [s]
  const out: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= room) line += ` ${word}`
    else {
      out.push(line)
      line = word
      if (out.length === lines - 1) break
    }
  }
  if (out.length < lines && line) out.push(line)
  const kept = out.join(' ').length
  if (kept < s.length) {
    const last = out.length - 1
    out[last] = `${out[last].slice(0, Math.max(1, room - 1))}…`
  }
  return out.slice(0, lines)
}
