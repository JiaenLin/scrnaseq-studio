// A saved figure's foot: what a reader of the file alone still needs.
//
// On screen a figure sits among its words: the head line names it, a key
// beside it names its colours, the status line gives n. The file took none
// of that with it. Composition's nine colours were saved with no key, the
// co-expression bars without the gene they are correlations with, and the
// violins, dot plots and feature plots without an n anywhere. A figure
// declares its foot once (`<Figure foot>`), and every Save writes it under
// the drawing, in print ink, at the figure's own width: what is plotted, the
// key with n, and what a mark means. The same words are on screen wherever
// the layout has room for them; the file has them always.
//
// Laid out here as plain positions, then written twice: as SVG for a vector
// figure and painted for a canvas one, so the two cannot drift.

import { FIG_TYPE, MARK_EDGE, PRINT_INK, PRINT_LABEL } from './figure-ink.ts'
import { textW } from './labels.ts'
import type { Dataset, GroupBy, Identity } from '../types.ts'

/** Cells of one type in one group, or in every group when `cond` is null: the object's own table. */
export function cellsOf(d: Pick<Dataset, 'grid' | 'samples'>, ti: number, cond: string | null): number {
  const row = d.grid[ti]
  if (!row) return 0
  let n = 0
  for (let si = 0; si < row.length; si++) if (cond === null || d.samples[si]?.cond === cond) n += row[si]
  return n
}

/**
 * A type-and-group identity as a foot names it: "qNSC / Quiescent". The axis
 * writes it "qNSC · Quiescent", and a foot separates its entries with that
 * same dot, so the pair read as two entries.
 */
export const pairName = (full: string): string => full.replace(' · ', ' / ')

/** n for each identity an axis draws, named as the axis names it. */
export const idCounts = (
  d: Pick<Dataset, 'grid' | 'samples'>, ids: readonly Identity[], groupBy: GroupBy,
): { label: string; n: number }[] => ids.map(id => ({
  label: groupBy === 'both' ? pairName(id.full) : id.label,
  n: cellsOf(d, id.ti, groupBy === 'type' ? null : id.cond),
}))

export interface FootKey {
  /** A literal colour, or a custom property (`var(--fig-g1)`) that Save resolves in print ink. */
  color: string
  label: string
  /** How many (cells, samples, genes) this entry stands for. */
  n?: number
  /** A filled square (a colour), a dot (a point), a ring (one sample), a rule (a range or a line). */
  mark?: 'square' | 'dot' | 'ring' | 'rule'
}

export interface Foot {
  /** What is plotted, in one line. */
  title?: string
  /** The key: one entry per colour or mark. */
  key?: FootKey[]
    /** n, and what a mark means: one sentence each. */
  notes?: (string | false | null | undefined)[]
  /**
   * What one panel of this sheet carries when it is saved alone from its
   * corner: the panel has its own name and axis, and is a column wide or
   * less, so the sheet's title and what is true only of the sheet are left
   * out (the whole sheet's legend was as tall as a 1.8 in panel's plot).
   */
  panel?: Foot
}

export type FootItem =
  | { kind: 'text'; x: number; y: number; text: string; px: number; bold: boolean; ink: string }
  | { kind: 'mark'; x: number; y: number; color: string; mark: NonNullable<FootKey['mark']> }

const PAD = 8, TOP = 10, ROW = 15, SW = 8

const fmtN = (n: number): string => n.toLocaleString('en-US')

/** A key entry as it reads in the file: its name, and n when it has one. */
export const footLabel = (k: FootKey): string => (k.n === undefined ? k.label : `${k.label} (n = ${fmtN(k.n)})`)

/**
 * "n = 34,367 cells: qNSC 6,065 · aNSC 3,258 · …".
 *
 * Every group by name while that is a line or two; past `cap` groups, their
 * count and range, because a list of 133 clusters is not a caption.
 */
export function nNote(per: readonly { label: string; n: number }[], unit = 'cells', cap = 24): string {
  const total = per.reduce((a, g) => a + g.n, 0)
  if (per.length <= 1) return `n = ${fmtN(total)} ${unit}`
  if (per.length > cap) {
    const ns = per.map(g => g.n)
    return `n = ${fmtN(total)} ${unit} in ${per.length} groups (${fmtN(Math.min(...ns))} to ${fmtN(Math.max(...ns))} per group)`
  }
  return `n = ${fmtN(total)} ${unit}: ${per.map(g => `${g.label} ${fmtN(g.n)}`).join(' · ')}`
}

/** Where every piece of a foot goes in a strip `width` wide, and how tall the strip is. */
export function layFoot(foot: Foot | undefined, width: number): { h: number; items: FootItem[] } {
  const items: FootItem[] = []
  if (!foot) return { h: 0, items }
  const room = Math.max(60, width - 2 * PAD)
  let y = TOP
  const line = (text: string, px: number, bold: boolean, ink: string) => {
    for (const l of wrapSpaces(text, room, px, bold)) {
      y += ROW
      items.push({ kind: 'text', x: PAD, y: y - 4, text: l, px, bold, ink })
    }
  }
  if (foot.title) line(foot.title, FIG_TYPE.label, true, PRINT_INK)
  if (foot.key?.length) {
    let x = PAD
    y += ROW
    for (const k of foot.key) {
      const label = footLabel(k)
      const w = SW + 5 + textW(label, FIG_TYPE.tick) + 14
      if (x > PAD && x + w - 14 > PAD + room) { x = PAD; y += ROW }
      items.push({ kind: 'mark', x, y: y - 8, color: k.color, mark: k.mark ?? 'square' })
      items.push({ kind: 'text', x: x + SW + 5, y: y - 4, text: label, px: FIG_TYPE.tick, bold: false, ink: PRINT_INK })
      x += w
    }
  }
  for (const n of foot.notes ?? []) if (n) line(n, FIG_TYPE.tick, false, PRINT_LABEL)
  return items.length ? { h: y + PAD, items } : { h: 0, items }
}

/**
 * Wrap a sentence at spaces only: "4,598" is one word, and a name's slash is
 * not a line end here. A list of entries ("qNSC / Quiescent 3,573 · …") is
 * wrapped between entries, so a name is never parted from its count; only an
 * entry wider than the whole line is wrapped at its own spaces.
 */
export function wrapSpaces(s: string, width: number, px: number, bold: boolean): string[] {
  const out: string[] = []
  let line = ''
  const units = s.includes(' \u00b7 ') ? s.split(/(?<= \u00b7 )|(?<=: )/).map(u => u.trimEnd()) : s.split(' ')
  for (const unit of units) {
    const next = line ? `${line} ${unit}` : unit
    if (!line || textW(next, px, bold) <= width) { line = next; continue }
    out.push(line)
    line = unit
    if (textW(unit, px, bold) > width && unit.includes(' ')) {
      const inner = unit.split(' ')
      line = ''
      for (const word of inner) {
        const n2 = line ? `${line} ${word}` : word
                // The dot that ends an entry stays with it.
        if (line && word !== '\u00b7' && textW(n2, px, bold) > width) { out.push(line); line = word } else line = n2
      }
    }
  }
  if (line) out.push(line)
  return out
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The foot as SVG, to sit under a drawing `width` wide whose bottom is `y0`.
 * `color` turns a custom property into the print value (Save reads it while
 * the light theme is stamped).
 */
export function footSvg(
  foot: Foot | undefined, width: number, y0: number, family: string,
  color: (c: string) => string = c => c,
): { xml: string; h: number } {
  const { h, items } = layFoot(foot, width)
  if (!h) return { xml: '', h: 0 }
  const font = esc(family.replace(/"/g, "'"))
  const xml = items.map(it => {
    if (it.kind === 'text') {
      return `<text x="${it.x}" y="${y0 + it.y}" font-family="${font}" font-size="${it.px}"`
        + ` font-weight="${it.bold ? 600 : 400}" fill="${it.ink}">${esc(it.text)}</text>`
    }
    const c = color(it.color), y = y0 + it.y
    if (it.mark === 'dot') return `<circle cx="${it.x + SW / 2}" cy="${y + SW / 2}" r="${SW / 2}" fill="${c}" stroke="${MARK_EDGE}" stroke-width="0.6"/>`
    if (it.mark === 'ring') return `<circle cx="${it.x + SW / 2}" cy="${y + SW / 2}" r="${SW / 2 - 1}" fill="#FFFFFF" stroke="${c}" stroke-width="1.4"/>`
    if (it.mark === 'rule') return `<line x1="${it.x}" x2="${it.x + SW}" y1="${y + SW / 2}" y2="${y + SW / 2}" stroke="${c}" stroke-width="1.4"/>`
    return `<rect x="${it.x}" y="${y}" width="${SW}" height="${SW}" rx="1.5" fill="${c}"/>`
  }).join('')
  return { xml: `<g data-foot="">${xml}</g>`, h }
}

/** The same foot painted on a canvas whose drawing is `width` CSS px wide at scale `k`; returns its height in CSS px. */
export function paintFoot(
  ctx: CanvasRenderingContext2D, foot: Foot | undefined, width: number, y0: number, k: number, family: string,
  color: (c: string) => string = c => c,
): number {
  const { h, items } = layFoot(foot, width)
  for (const it of items) {
    if (it.kind === 'text') {
      ctx.font = `${it.bold ? 600 : 400} ${it.px * k}px ${family}`
      ctx.fillStyle = it.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(it.text, it.x * k, (y0 + it.y) * k)
      continue
    }
    const c = color(it.color), x = it.x * k, y = (y0 + it.y) * k, s = SW * k
    ctx.lineWidth = 1.4 * k
    if (it.mark === 'rule') {
      ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x, y + s / 2); ctx.lineTo(x + s, y + s / 2); ctx.stroke()
    } else if (it.mark === 'square') {
      ctx.fillStyle = c; ctx.fillRect(x, y, s, s)
    } else {
      ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2 - (it.mark === 'ring' ? k : 0), 0, Math.PI * 2)
      ctx.fillStyle = it.mark === 'ring' ? '#FFFFFF' : c; ctx.fill()
      ctx.strokeStyle = it.mark === 'ring' ? c : MARK_EDGE
      if (it.mark === 'dot') ctx.lineWidth = 0.6 * k
      ctx.stroke()
    }
  }
  return h
}
