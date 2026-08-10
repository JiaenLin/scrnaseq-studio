// The pieces a figure has to carry with it.
//
// These are SVG fragments rather than HTML because of one thing that made every
// exported dot plot useless: the legend was laid out in HTML beside the figure,
// so the exported file — the thing that goes into the manuscript — had no size
// key and no colour bar. A figure whose legend lives outside it is not a figure.
//
// The styling follows SCpubr, which is a set of deliberate choices rather than a
// theme: black-outlined marks (`geom_point(color = "black", shape = 21)`), black
// axis text and ticks, a light grid behind the data, and a colour bar with a
// visible frame and tick marks (`legend.framecolor`, `legend.tickcolor`) instead
// of a bare gradient strip. The outline is the one that matters most — a pale
// dot on white has no edge without it, and pale is exactly what a z-scored dot
// plot is full of.

import { AXIS_INK, MARK_EDGE } from '../lib/figure-ink.ts'
import { mix as mixHex, rampColor, type RampKey } from '../lib/palette.ts'

/** How many stops the gradient is written with. Smooth enough at any size. */
const STOPS = 12

/**
 * A framed, ticked colour bar.
 *
 * The frame is not decoration. A gradient strip that runs to white at one end
 * has no boundary against the page, so the reader cannot see where the scale
 * starts — which is the end that usually means "not detected".
 */
export function ColorBar({ x, y, w, h, ramp, colors, lo, hi, title, id }: {
  x: number; y: number; w: number; h: number
  lo: number; hi: number; title: string; id: string
  /** A named ramp… */
  ramp?: RampKey
  /**
   * …or two explicit ends, when the figure does not colour from a ramp.
   *
   * The markers plot shades each dot within its own cluster's colour, so no
   * single hue describes it. A viridis bar under that figure would be a legend
   * for a scale it does not use — which is worse than no legend, because it
   * looks authoritative.
   */
  colors?: [string, string]
}) {
  const mid = (lo + hi) / 2
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))
  const at = (f: number) => (colors ? mixHex(colors[0], colors[1], f) : rampColor(f, ramp ?? 'seurat'))
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          {Array.from({ length: STOPS + 1 }, (_v, i) => (
            <stop key={i} offset={`${(i / STOPS) * 100}%`} stopColor={at(i / STOPS)} />
          ))}
        </linearGradient>
      </defs>
      <text x={x} y={y - 5} style={{ fontSize: 10, fontWeight: 600, fill: AXIS_INK }}>{title}</text>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`}
        stroke={AXIS_INK} strokeWidth={0.7} />
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={x + f * w} x2={x + f * w} y1={y + h} y2={y + h + 3}
          stroke={AXIS_INK} strokeWidth={0.7} />
      ))}
      {[[0, lo], [0.5, mid], [1, hi]].map(([f, v]) => (
        <text key={f} x={x + f * w} y={y + h + 12} textAnchor="middle"
          style={{ fontSize: 9.5, fill: AXIS_INK }}>{fmt(v)}</text>
      ))}
    </g>
  )
}

/**
 * The dot-size key, drawn with the same outline the data marks carry.
 *
 * The unit is in the title rather than trailing the last number: a lone "%"
 * after the row of circles reads as another tick with no circle above it.
 */
export function SizeKey({ x, y, title, radius, steps = [0.25, 0.5, 0.75, 1] }: {
  x: number; y: number; title: string
  radius: (f: number) => number
  steps?: number[]
}) {
  const gap = 34
  return (
    <g>
      <text x={x} y={y - 5} style={{ fontSize: 10, fontWeight: 600, fill: AXIS_INK }}>{title}</text>
      {steps.map((v, i) => (
        <g key={v}>
          <circle cx={x + 9 + i * gap} cy={y + 9} r={radius(v)}
            fill="#ffffff" stroke={MARK_EDGE} strokeWidth={0.7} />
          <text x={x + 9 + i * gap} y={y + 26} textAnchor="middle"
            style={{ fontSize: 9.5, fill: AXIS_INK }}>{Math.round(v * 100)}</text>
        </g>
      ))}
    </g>
  )
}
