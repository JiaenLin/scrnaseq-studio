// One gene, one panel per gene: the distribution across identities.
//
// Split out of GeneExpression.tsx, which held five unrelated figures in 993
// lines — you went there for the violins, the dot plot, the feature plot, the
// gene picker or the cell filter, and read past four of them to reach the one
// you wanted. The seams were already drawn in that file as comment banners;
// this is those banners made real.

import { useMemo, useState } from 'react'
import type { Identity } from '../../types.ts'
import { density, maxOf, maxOfAll, quantiles } from '../../lib/chart.ts'
import { axisTicks } from '../../lib/labels.ts'
import {
  DOWN_MARK, GHOST_INK, MARK_EDGE, SUMMARY_INK, TICK_INK, UP_MARK,
} from '../../lib/figure-ink.ts'
import { inConds } from '../../lib/stats.ts'
import { mix } from '../../lib/palette.ts'
import Figure from '../Figure.tsx'
import type { GeneProps } from '../GeneExpression.tsx'

/* ---------------- violin panel ---------------- */

export default function ViolinPanel(p: GeneProps & { ids: Identity[] }) {
  const cols = p.groupBy === 'both' ? Math.min(p.cols, 2) : p.cols
  /**
   * Seurat's `pt.size`, as a switch rather than a default.
   *
   * A violin is a smoothed estimate, and on a cluster of forty cells it draws a
   * confident curve over very little evidence — the one case where the outline
   * is least trustworthy and looks most authoritative. The cells themselves
   * settle it. Off by default because on a cluster of forty thousand the points
   * are a solid block that hides the box, which is why Seurat's own default is
   * 0 for large objects.
   */
  const [points, setPoints] = useState(false)
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <button className="chip" aria-pressed={points} onClick={() => setPoints(!points)}
          title="Draw the cells themselves over each violin, sampled">
          Show cells
        </button>
      </div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {p.genes.map(g => <Facet key={g} {...p} gene={g} cols={cols} points={points} />)}
      </div>
      <div className="legend mt-3">
        <span>violin + box = per-cell distribution</span>
        {points && <span>each dot is one cell, up to 300 per group</span>}
        <span>bar under the axis = fraction of cells detecting the gene</span>
      </div>
    </>
  )
}

function Facet(p: GeneProps & { ids: Identity[]; gene: string; points?: boolean }) {
  const both = p.groupBy === 'both'
  const cats = p.ids
  const per = cats.length
  const W = p.cols <= 2 ? 620 : 400
  const PL = 40, PT = 20, PR = 8
  const DET = 9 // strip for the detection bars
  const PLOT = (p.cols <= 2 ? 210 : 190) - 39

  /**
   * The bottom margin is measured from the labels, not stepped on their count.
   *
   * It was `both ? 56 : per > 5 ? 46 : 30`, which asks how MANY categories
   * there are and never how long their names are. A real annotation calls a
   * cluster "Cardiomyocyte/Working cardiomyocyte": thirty-five characters,
   * rotated 42 degrees, hanging 108 units below its anchor into a margin that
   * had reserved 46. `svg { overflow: visible }` means it does not clip, it
   * paints — over the caption, and over the next panel down.
   */
  const LAB_PX = per > 10 ? 9 : 10
  const bw = (W - PL - PR) / per
  const labels = cats.map(c => c.label)
  // leftAnchor is where the FIRST tick sits: the one that reaches back past the
  // y axis when the names are long. It was 62 units off the left edge of the
  // box on a real annotation, and the margin below was 47 short as well —
  // because reserving a capped margin is not the same as fitting the label to
  // it. axisTicks does both, and picks the angle that keeps neighbours apart.
  const tick = axisTicks(labels, {
    band: bw, leftAnchor: PL + bw / 2, px: LAB_PX, deg: 42, startAt: 11, maxBottom: 88,
  })
  const PB = DET + (both ? 26 : 0) + tick.bottom
  const H = PT + PLOT + PB

  const series = cats.map(c => p.src.values(p.gene, c.ti, p.groupBy === 'type' ? null : c.cond))
  let base = 1
  if (p.relative && p.groupBy === 'cond') {
    // The first facet on the control side. With several levels pooled the
    // baseline is the first of them that this panel actually draws.
    const ref = Math.max(0, cats.findIndex(c => c.cond != null && inConds(c.cond, p.ctrl)))
    const v = series[ref]
    base = v.reduce((a, b) => a + b, 0) / v.length || 1
  }
  const scaled = series.map(v => v.map(x => x / base))
  // Every sampled cell in the panel, which on the atlas is 133 clusters × 20
  // groups × 400 — a spread of that many arguments is the RangeError that
  // unmounts the tab, so the extent is taken by loop. See maxOf in chart.ts.
  const hi = maxOfAll(scaled) * 1.06 || 1
  const lo = 0
  const Y = (v: number) => PT + PLOT * (1 - (v - lo) / (hi - lo))

  // Last group against first, in the object's own order — which for a time
  // course is the change over the course. It used to read the contrast bar's
  // Control and Compare, controls this tab no longer shows.
  const first = cats[0], last = cats[cats.length - 1]
  const dl = p.groupBy === 'type' || cats.length < 2 || !first || !last ? 0
    : Math.log2((p.src.mean(p.gene, last.ti, last.cond) + 0.05)
      / (p.src.mean(p.gene, first.ti, first.cond) + 0.05))
  const pcts = cats.map(c => p.src.pct(p.gene, c.ti, p.groupBy === 'type' ? null : c.cond))
  const maxPct = maxOf(pcts)

  return (
    <Figure name={`${p.gene}_violin`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${p.gene} expression`}>
        <text x={PL} y={11} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--ink)', fontStyle: 'italic' }}>
          {p.gene}
        </text>
        {maxPct < 0.12 && (
          <text className="axis" x={PL + 6 + p.gene.length * 5.5} y={11} style={{ fontSize: 9.5 }}>
            barely detected here — max {(maxPct * 100).toFixed(0)}%
          </text>
        )}
        {p.groupBy !== 'type' && Math.abs(dl) >= 0.15 && (
          <text className="axis" x={W - PR} y={11} textAnchor="end"
            style={{ fill: dl > 0 ? UP_MARK : DOWN_MARK, fontWeight: 600 }}>
            {dl > 0 ? '+' : ''}{dl.toFixed(1)}
          </text>
        )}
        {[0, 0.5, 1].map(f => {
          const t = lo + (hi - lo) * f
          return (
            <g key={f}>
              <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
              <text className="axis" x={PL - 5} y={Y(t) + 3.5} textAnchor="end">{t.toFixed(1)}</text>
            </g>
          )
        })}
        {p.relative && p.groupBy === 'cond' && (
          <line x1={PL} x2={W - PR} y1={Y(1)} y2={Y(1)} stroke="var(--ink-3)" strokeDasharray="3 3" opacity=".8" />
        )}
        {cats.map((c, i) => {
          const v = scaled[i]
          const cx = PL + bw * (i + 0.5)
          const col = c.dim !== undefined ? mix(GHOST_INK, c.color, 0.3 + c.dim * 0.7) : c.color
          return (
            <g key={c.full}>
              {/* A cluster can hold no cells at all in one group — cell type ×
                  group on the atlas is mostly empty — and there is no
                  distribution to draw for it. quantiles of nothing are NaN, and
                  SVG rejects a NaN attribute one at a time: 272 console errors
                  per render, which is enough to bury a real one. The slot keeps
                  its tick and stays blank. */}
              {v.length > 0 && (
                <Violin v={v} cx={cx} bw={bw} col={col} lo={lo} hi={hi} Y={Y}
                  pct={pcts[i]} gene={p.gene} yDet={H - PB + 3} points={p.points} />
              )}
              {tick.rotate ? (
                <text className="axis" transform={`rotate(${-tick.deg} ${cx} ${H - PB + DET + 11})`}
                  x={cx} y={H - PB + DET + 11} textAnchor="end"
                  style={{ fontSize: LAB_PX }}>{tick.shown[i]}<title>{c.full}</title></text>
              ) : (
                <text className="axis" x={cx} y={H - PB + DET + 13} textAnchor="middle"
                  style={{ fontSize: LAB_PX }}>{tick.shown[i]}<title>{c.full}</title></text>
              )}
            </g>
          )
        })}
        {both && p.types.map((t, ti) => {
          const block = bw * p.src.d.conds.length
          const maxCh = Math.max(3, Math.floor(block / 5.2))
          const x0 = PL + bw * ti * p.src.d.conds.length
          const label = t.name.length > maxCh ? `${t.name.slice(0, maxCh - 1)}…` : t.name
          return (
            <g key={t.key}>
              {ti > 0 && <line className="axgrid" x1={x0} x2={x0} y1={PT} y2={H - PB + DET + 2} />}
              <text className="axis" x={x0 + block / 2} y={H - 5} textAnchor="middle"
                style={{ fontSize: 9.5, fill: 'var(--ink)', fontWeight: 600 }}>
                {label}<title>{t.name}</title>
              </text>
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </Figure>
  )
}

/** One category's distribution: outline, box, median, and the detection bar. */
function Violin({ v, cx, bw, col, lo, hi, Y, pct, gene, yDet, points }: {
  v: number[]
  cx: number
  bw: number
  col: string
  lo: number
  hi: number
  Y: (value: number) => number
  pct: number
  gene: string
  yDet: number
  /** Draw the cells themselves over the outline — Seurat's `pt.size`. */
  points?: boolean
}) {
  const q = quantiles(v)
  const dens = density(v, lo, hi)

  /**
   * The cells, jittered, at most 300 of them.
   *
   * The jitter is deterministic — a hash of the index rather than Math.random —
   * so a figure does not rearrange itself between renders or between the screen
   * and the export. Sampled by stride rather than randomly for the same reason,
   * and because a stride over an unsorted per-cell array is already a fair
   * sample of it.
   */
  const dots = useMemo(() => {
    if (!points || !v.length) return []
    const stride = Math.max(1, Math.ceil(v.length / 300))
    const out: [number, number][] = []
    for (let i = 0; i < v.length; i += stride) {
      // A cheap deterministic hash in [-1, 1].
      const h = Math.sin((i + 1) * 12.9898) * 43758.5453
      out.push([(h - Math.floor(h)) * 2 - 1, v[i]])
    }
    return out
  }, [points, v])
  const half = bw * 0.36
  const pts = [
    ...dens.map((x, k) => `${(cx + x * half).toFixed(1)},${Y(lo + (hi - lo) * k / 26).toFixed(1)}`),
    ...dens.map((x, k) => `${(cx - x * half).toFixed(1)},${Y(lo + (hi - lo) * k / 26).toFixed(1)}`).reverse(),
  ].join(' ')
  const bwid = Math.max(1, bw * 0.62 * pct)
  return (
    <>
      {/* Outlined, as SCpubr outlines every mark. A 26%-opacity fill with no
          edge has no boundary against the page, so two adjacent violins of
          similar shape merge into one silhouette — which is exactly the
          comparison the figure exists to support. The fill stays translucent
          so the box still reads through it. */}
      <polygon points={pts} fill={col} fillOpacity={0.32}
        stroke={MARK_EDGE} strokeWidth={0.6} />
      {/* Under the box, over the outline: the box is the summary and has to stay
          readable through them. */}
      {dots.map(([j, value], k) => (
        <circle key={k} cx={cx + j * half * 0.72} cy={Y(value)} r={Math.min(1.5, bw * 0.045)}
          fill={SUMMARY_INK} fillOpacity={0.42} />
      ))}
      {/* The box drawn dark rather than in the category colour: it summarises
          the distribution rather than being another instance of it, and in the
          same hue at 65% it read as a denser part of the violin. */}
      <line x1={cx} x2={cx} y1={Y(q.q1)} y2={Y(q.q3)} stroke={SUMMARY_INK}
        strokeWidth={Math.max(2, Math.min(6, bw * 0.34))} />
      <line x1={cx - Math.min(8, bw * 0.4)} x2={cx + Math.min(8, bw * 0.4)}
        y1={Y(q.med)} y2={Y(q.med)} stroke={TICK_INK} strokeWidth={1.8} />
      {/* Detection bar. Without it a gene with heavy dropout is just a spike
          at zero, with no way to tell "absent here" from "absent everywhere". */}
      <rect x={cx - bwid / 2} y={yDet} width={bwid} height={3.5} rx={1.75}
        fill={col} stroke={MARK_EDGE} strokeWidth={0.4}>
        <title>{(pct * 100).toFixed(0)}% of cells detect {gene}</title>
      </rect>
    </>
  )
}

