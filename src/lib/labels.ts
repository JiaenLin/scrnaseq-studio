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
 * EXCLUDED", groups like "group_a1b1", MSigDB names like
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
  /** Preferred angle; steepened when a shallower one will not fit. */
  deg?: number
  /** How far under the axis the text begins. */
  startAt?: number
  descend?: number
  gap?: number
  /** Bottom margin to use when the labels fit upright. */
  upright?: number
}): { rotate: boolean; deg: number; shown: string[]; bottom: number; left: number } {
  const {
    band, leftAnchor, px = 10.5, deg = 38, startAt = 12,
    descend = 6, gap = 4, upright = 26,
  } = o
  const full = [...labels]
  if (fitsUpright(labels, band, px, gap)) {
    return { rotate: false, deg: 0, shown: full, bottom: upright, left: 0 }
  }
  const rad = (d: number) => (d * Math.PI) / 180
  const lineH = px * 1.2
  const widest = widestW(labels, px)

  /**
   * The angle, chosen to satisfy two constraints and never to force a cut.
   *
   * Neighbours clear each other by `band·sin(a)`, so a steeper angle separates
   * them; and a label anchored at its end reaches `w·cos(a)` to the LEFT, so a
   * steeper angle also costs less horizontally — at 90° it costs nothing at
   * all, which is why vertical is the answer for a long name in a narrow band
   * rather than a shorter name.
   */
  let a = 90
  for (const cand of [deg, 55, 72, 90]) {
    a = cand
    const separated = band * Math.sin(rad(a)) >= lineH
    const reach = widest * Math.cos(rad(a))
    if (separated && reach <= leftAnchor - 2) break
  }
  return {
    rotate: true,
    deg: a,
    shown: full,
    // Uncapped. The margin is whatever the longest label needs, because the
    // alternative is cutting the label, and a cell type with its tail removed
    // is not a cell type. The caller grows its box to match.
    bottom: Math.ceil(startAt + widest * Math.sin(rad(a)) + descend),
    // What the first tick reaches past its own anchor, for the caller's PL.
    left: Math.max(0, Math.ceil(widest * Math.cos(rad(a)) - leftAnchor + 2)),
  }
}

/** Where a name may be taken onto a new line: after a space, or after the punctuation compound annotations use. */
const BREAK_AFTER = /(?<=[ /|,_-])/

/**
 * Wrap onto as many lines as the text needs, and never inside a word.
 *
 * Breaks on spaces, then on the punctuation compound annotations actually use
 * ("Cardiomyocyte/Working cardiomyocyte", "Immune|Myeloid"). It also broke
 * INSIDE a word when one token was longer than the line, and under a grouped
 * violin every cell type is one token in a narrow block: "Oligode / ndrocyt /
 * e", six names of nine at 1,280 px. A name cut inside a word is not that
 * name. A caller with a row of names in bands asks `bandNames`, which finds
 * room or turns the row; here, where the box cannot grow sideways (a panel's
 * title, a row label), a single token wider than the line keeps its first
 * letters and an ellipsis, and the element carries the whole name in its
 * `<title>`.
 */
export function wrapAll(s: string, width: number, px = 10.5, bold = false): string[] {
  const per = px * (bold ? EM_BOLD : EM_NORMAL)
  const room = Math.max(3, Math.floor(width / per + 1e-6))
  if (s.length <= room) return [s]
  // Split into pieces that may end a line, keeping the delimiter with the piece
  // before it so "Endothelial/" reads as a continuation rather than a name.
  const pieces = s.split(BREAK_AFTER)
  const out: string[] = []
  let line = ''
  const push = () => { if (line) { out.push(line.trimEnd()); line = '' } }
  for (const piece of pieces) {
    if (piece.trimEnd().length > room) {
      push()
      out.push(`${piece.slice(0, Math.max(1, room - 1))}…`)
      continue
    }
    if (line.length + piece.length > room) push()
    line += piece
  }
  push()
  return out.length ? out : [s]
}

/**
 * Wrap at break points only, onto lines no wider than `width`.
 *
 * Null when a single word is wider than the line: the caller finds room or
 * turns the label. It never cuts the word and never shortens it.
 */
export function wrapWords(s: string, width: number, px = 10.5, bold = false): string[] | null {
  const per = px * (bold ? EM_BOLD : EM_NORMAL)
  const room = Math.floor(width / per + 1e-6)
  if (s.length <= room) return [s]
  const out: string[] = []
  let line = ''
  for (const piece of s.split(BREAK_AFTER)) {
    if (piece.trimEnd().length > room) return null
    if (line && (line + piece).trimEnd().length > room) { out.push(line.trimEnd()); line = '' }
    line += piece
  }
  if (line) out.push(line.trimEnd())
  return out
}

/** How a row of names under bands is set: upright (one line or wrapped), or the whole row turned. */
export type BandNames =
  | { rotate: false; lines: string[][]; lineH: number; bottom: number; left: number }
  | { rotate: true; deg: number; lineH: number; bottom: number; left: number }

/**
 * A row of names under bands: the cell types under a grouped axis.
 *
 * In this order, and for the whole row at once, so a row is never half
 * upright and half turned: every name on one line; wrapped at a space or at
 * the punctuation of a compound name, on at most `maxLines` lines; the row
 * turned to one angle, each name ending under the middle of its band. Never
 * cut inside a word, never shortened. `bottom` is the depth the row needs and
 * `left` what the first turned name reaches past the plot's left edge.
 */
export function bandNames(names: readonly string[], o: {
  band: number
  /** x of the first band's middle: the room a turned name has to its left. */
  leftAnchor: number
  px?: number; bold?: boolean; maxLines?: number; deg?: number; gap?: number
}): BandNames {
  const { band, leftAnchor, px = 11, bold = true, maxLines = 3, deg = 42, gap = 4 } = o
  const lineH = Math.round(px * 1.18)
  const wrapped = names.map(n => wrapWords(n, band - gap, px, bold))
  if (wrapped.every(l => l !== null && l.length <= maxLines)) {
    const rows = Math.max(1, ...wrapped.map(l => l!.length))
    return { rotate: false, lines: wrapped as string[][], lineH, bottom: rows * lineH + 5, left: 0 }
  }
  const rad = (d: number) => (d * Math.PI) / 180
  const widest = widestW(names, px, bold)
  let a = 90
  for (const cand of [deg, 55, 72, 90]) {
    a = cand
    if (band * Math.sin(rad(a)) >= px * 1.2) break
  }
  return {
    rotate: true, deg: a, lineH,
    bottom: Math.ceil(px + widest * Math.sin(rad(a)) + 6),
    left: Math.max(0, Math.ceil(widest * Math.cos(rad(a)) - leftAnchor + 2)),
  }
}

/** The narrowest band in which every name sits upright on at most `maxLines` lines. */
export function bandNeed(
  names: readonly string[], px = 11, bold = true, maxLines = 2, gap = 4,
): number {
  const per = px * (bold ? EM_BOLD : EM_NORMAL)
  let need = 0
  for (const n of names) {
    let room = Math.max(1, ...n.split(BREAK_AFTER).map(p => p.trimEnd().length))
    while (room < n.length && (wrapWords(n, room * per, px, bold)?.length ?? Infinity) > maxLines) room++
    need = Math.max(need, Math.min(room, n.length) * per)
  }
  return Math.ceil(need + gap)
}

/** How many lines `wrapAll` needs, over several labels — for a margin. */
export const wrapLines = (
  labels: readonly string[], width: number, px = 10.5, bold = false,
): number => labels.reduce((n, s) => Math.max(n, wrapAll(s, width, px, bold).length), 1)

/**
 * Cut a label to a width, losing the TAIL.
 *
 * NOT for figures. Every axis, key and row label in this studio now grows its
 * margin instead of cutting, because a truncated cell type or pathway is not a
 * shorter name — it is a different string that looks like one, and a reader
 * cannot tell "Endothelial/Lymphatic…" from "Endothelial/Lymphoid…". This
 * survives for interface chrome where the container genuinely cannot grow, and
 * every such use pairs it with a title attribute holding the whole string.
 *
 * Never the head, for the same reason: a pathway is identified by how its name
 * begins and a cell type by its lineage.
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
