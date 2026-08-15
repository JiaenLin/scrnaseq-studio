// The pieces a figure has to carry with it.
//
// SVG fragments rather than HTML, because of the defect that made every export
// useless: a legend laid out beside a figure is absent from the file that goes
// into the manuscript. A figure whose legend lives outside it is not a figure.
//
// The design is SCpubr's, taken from its defaults rather than from a photograph
// of one of its plots:
//
//   legend.position  = "bottom"    the keys sit under the panel, centred
//   legend.framecolor = "grey50"   the bar is framed, not floated on the page
//   legend.tickcolor  = "white"    breaks are cut INTO the bar, not hung below
//   legend.title      above, centred, bold
//
// The white ticks are the part most often missed and the part that does the
// most work. A framed gradient with numbers underneath makes the reader measure
// along the bar by eye; ticks cut into the gradient itself put the break where
// the colour actually changes, so "this dot is about a 2" is a comparison
// against a mark rather than an estimate.

import { AXIS_INK, FRAME_INK, MARK_EDGE, SUMMARY_INK, TICK_INK } from '../lib/figure-ink.ts'
import { breaksOf, fmtBreak } from '../lib/breaks.ts'
import { fit, textW, widestW } from '../lib/labels.ts'
import { mix as mixHex, rampColor, type RampKey } from '../lib/palette.ts'

/** How many stops the gradient is written with. Smooth enough at any size. */
const STOPS = 24

/**
 * A framed colour bar with its breaks cut into it, titled above and centred.
 *
 * `x` is the CENTRE of the legend, not its left edge: these sit under a panel
 * and are centred on it, and every caller getting the same arithmetic slightly
 * wrong is how a row of legends ends up not quite lined up.
 */
export function ColorBar({ cx, y, w, h, ramp, colors, lo, hi, title, id, breaks }: {
  cx: number; y: number; w: number; h: number
  lo: number; hi: number; title: string; id: string
  /** A named ramp… */
  ramp?: RampKey
  /**
   * …or two explicit ends, when the figure does not colour from a ramp.
   *
   * The markers plot shades each dot within its own cluster's colour, so no
   * single hue describes it. A mako bar under that figure would be a legend for
   * a scale it does not use, which is worse than no legend because it looks
   * authoritative.
   */
  colors?: [string, string]
  /** Override the automatic breaks — for a fixed scale like a z-score. */
  breaks?: number[]
}) {
  const x = cx - w / 2
  const at = (f: number) => (colors ? mixHex(colors[0], colors[1], f) : rampColor(f, ramp ?? 'blue'))
  const ticks = (breaks ?? breaksOf(lo, hi)).filter(v => v >= lo && v <= hi)
  const pos = (v: number) => x + (hi > lo ? (v - lo) / (hi - lo) : 0) * w

  return (
    <g>
      <text x={cx} y={y - 7} textAnchor="middle"
        style={{ fontSize: 11.5, fontWeight: 700, fill: AXIS_INK }}>{title}</text>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          {Array.from({ length: STOPS + 1 }, (_v, i) => (
            <stop key={i} offset={`${(i / STOPS) * 100}%`} stopColor={at(i / STOPS)} />
          ))}
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`} />
      {/* Breaks cut into the bar, in white — SCpubr's legend.tickcolor. Not
          drawn at the two ends, where a tick would read as part of the frame. */}
      {ticks.filter(v => v > lo && v < hi).map(v => (
        <line key={`t${v}`} x1={pos(v)} x2={pos(v)} y1={y} y2={y + h}
          stroke={TICK_INK} strokeWidth={1.1} />
      ))}
      <rect x={x} y={y} width={w} height={h} fill="none"
        stroke={FRAME_INK} strokeWidth={0.9} />
      {ticks.map(v => (
        <text key={`l${v}`} x={pos(v)} y={y + h + 12} textAnchor="middle"
          style={{ fontSize: 10.5, fill: AXIS_INK }}>{fmtBreak(v)}</text>
      ))}
    </g>
  )
}

/**
 * The dot-size key: filled marks with the number beside each, titled above.
 *
 * Filled, not hollow. The marks on the figure are filled, and a hollow key
 * beside a filled figure asks the reader to match an outline against a disc —
 * which is exactly the judgement the key exists to spare them.
 */
export function SizeKey({ cx, y, title, radius, steps = [0.25, 0.5, 0.75, 1], fill = SUMMARY_INK }: {
  cx: number; y: number; title: string
  radius: (f: number) => number
  steps?: number[]
  fill?: string
}) {
  // Laid out on measured widths rather than a fixed pitch, so the big marks do
  // not collide with their own labels at one end while the small ones swim at
  // the other.
  const gap = 10, labW = 22
  const spans = steps.map(v => radius(v) * 2 + 4 + labW)
  const total = spans.reduce((a, b) => a + b, 0) + gap * (steps.length - 1)
  let cursor = cx - total / 2
  const placed = steps.map((v, i) => {
    const r = radius(v)
    const dot = cursor + r
    const label = cursor + r * 2 + 4
    cursor += spans[i] + gap
    return { v, r, dot, label }
  })
  const maxR = radius(steps[steps.length - 1])

  return (
    <g>
      <text x={cx} y={y - 7} textAnchor="middle"
        style={{ fontSize: 11.5, fontWeight: 700, fill: AXIS_INK }}>{title}</text>
      {placed.map(p => (
        <g key={p.v}>
          <circle cx={p.dot} cy={y + maxR} r={p.r}
            fill={fill} stroke={MARK_EDGE} strokeWidth={0.6} />
          <text x={p.label} y={y + maxR + 4} textAnchor="start"
            style={{ fontSize: 10.5, fill: AXIS_INK }}>{Math.round(p.v * 100)}</text>
        </g>
      ))}
    </g>
  )
}

/**
 * A row of categorical swatches, centred — for a volcano's directions.
 *
 * Laid out on measured widths, for the reason SizeKey above is: a fixed pitch
 * is a bet that every label is about the same length, and the volcano's are
 * not. "up" and "not significant" differ by a factor of six as it is, and when
 * levels are pooled the key reads "up in young_chow + young_hfd + old_chow" —
 * 168 units of pitch against 210 of label, so the entry wrote 63 units into
 * its neighbour. Measuring costs nothing and cannot be wrong by a factor.
 */
export function KeyRow({ cx, y, items, width }: {
  cx: number; y: number; items: { color: string; label: string }[]
  /** Available width, if the caller knows it — labels are cut to fit inside. */
  width?: number
}) {
  const px = 11, dot = 9, dotGap = 6, gap = 20
  const span = (s: string) => dot + dotGap + textW(s, px)
  let labels = items.map(it => it.label)
  if (width) {
    const chrome = items.length * (dot + dotGap) + gap * (items.length - 1)
    const room = (width - chrome) / items.length
    // Cut only if the row genuinely will not fit; a short key keeps its words.
    if (widestW(labels, px) * items.length > width - chrome) {
      labels = labels.map(s => fit(s, Math.max(28, room), px))
    }
  }
  const total = labels.reduce((a, s) => a + span(s), 0) + gap * (items.length - 1)
  let cursor = cx - total / 2
  return (
    <g>
      {items.map((it, i) => {
        const x = cursor
        cursor += span(labels[i]) + gap
        return (
          <g key={it.label}>
            <circle cx={x + dot / 2} cy={y} r={4.5}
              fill={it.color} stroke={MARK_EDGE} strokeWidth={0.6} />
            <text x={x + dot + dotGap} y={y + 3.5}
              style={{ fontSize: px, fill: AXIS_INK }}>
              {labels[i]}{labels[i] !== it.label && <title>{it.label}</title>}
            </text>
          </g>
        )
      })}
    </g>
  )
}
