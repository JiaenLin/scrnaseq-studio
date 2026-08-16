// Seurat's dot plot: expression by size and colour, gene by identity.

import { useMemo } from 'react'
import type { Identity } from '../../types.ts'
import { dendroLines, orderRows } from '../../lib/cluster.ts'
import { maxOf, maxOfAll } from '../../lib/chart.ts'
import { widestW } from '../../lib/labels.ts'
import { AXIS_INK, GRID_INK, MARK_EDGE } from '../../lib/figure-ink.ts'
import { rampColor, symmetricRange } from '../../lib/palette.ts'
import Figure from '../Figure.tsx'
import { ColorBar, SizeKey } from '../svg-parts.tsx'
import type { GeneProps } from '../GeneExpression.tsx'

/* ---------------- Seurat dot plot ---------------- */

/**
 * Seurat's `scale = TRUE` default z-scores each gene *down its own column* and
 * clips to ±2.5, which makes the colour a claim about where a gene is highest,
 * not how much of it there is: a gene high everywhere comes out uniformly pale.
 * That is the most misread property of this figure, so the scaling is a visible
 * switch rather than a silent default.
 */
export default function DotPlot(p: GeneProps & { ids: Identity[]; cluster?: boolean }) {
  const rows0 = p.ids
  const genes0 = p.genes

  /**
   * Rows and columns ordered by how alike they are, with the tree drawn.
   *
   * Every published version of this figure — pheatmap, ComplexHeatmap, scanpy's
   * dotplot, Seurat's DoHeatmap — clusters both axes, because the ordering is
   * half of what the figure says. Drawn in the object's storage order it is a
   * table the reader has to sort by eye.
   *
   * Clustered on the MEAN expression matrix, not on the fraction detected: the
   * two are different questions and the colour is the mean, so the tree should
   * describe what the colour shows. Correlation distance, so populations
   * running the same programme at different depths sit together — see
   * lib/cluster.ts.
   */
  const meanOf = (r: Identity, g: string) =>
    p.src.mean(g, r.ti, p.groupBy === 'type' ? null : r.cond)
  const byRow = useMemo(
    () => rows0.map(r => genes0.map(g => meanOf(r, g))),
    // meanOf is a pure function of src and groupBy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows0, genes0, p.src, p.groupBy])

  /**
   * Clustered on what the COLOURS show.
   *
   * The trees were built from the raw means while the plate was z-scored per
   * gene whenever "Scale each gene" was on, so the dendrogram described one
   * matrix and the colours another. pheatmap and ComplexHeatmap cluster after
   * scaling for exactly this reason: the tree is a claim about the picture.
   *
   * Correlation distance is invariant to a per-gene affine scaling, so the ROW
   * order is often unchanged — but the column order is not, and neither is the
   * tree's shape, which is what a reader reads off the heights.
   */
  const shown = useMemo(() => {
    if (!p.dotScale) return byRow
    return byRow.map(row => row.slice())
      .map((_r, ri) => genes0.map((_g, gi) => {
        const col = rows0.map((_x, k) => byRow[k][gi])
        const m = col.reduce((a, b) => a + b, 0) / col.length
        const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1
        return Math.max(-2.5, Math.min(2.5, (byRow[ri][gi] - m) / sd))
      }))
  }, [byRow, genes0, rows0, p.dotScale])

  const rowTree = useMemo(
    () => (p.cluster ? orderRows(shown) : null), [p.cluster, shown])
  const colTree = useMemo(() => {
    if (!p.cluster || genes0.length < 3) return null
    // Transposed: a column is a gene's profile across the identities.
    return orderRows(genes0.map((_g, gi) => rows0.map((_r, ri) => shown[ri][gi])))
  }, [p.cluster, shown, genes0, rows0])

  const rows = useMemo(
    () => (rowTree ? rowTree.order.map(i => rows0[i]) : rows0), [rowTree, rows0])
  const genes = useMemo(
    () => (colTree ? colTree.order.map(i => genes0[i]) : genes0), [colTree, genes0])
  const cw = 42, rh = 26, PT = 14, PR = 26
  // The left margin follows the longest identity — "Oligodendrocyte · Reactivated"
  // is more than twice the width of "TAP", and a clipped row label is unreadable.
  /**
   * The row-label gutter, measured, and the labels cut to it.
   *
   * Two halves of one bug. The estimate was 6.1 units per character against the
   * 6.96 the browser draws at 11.5 px semibold — 12% short — and the cap at 250
   * was never enforced on the text, which is drawn as `r.full` with no fit at
   * all. So a real cell-type name did not merely crowd the gutter, it ran 53
   * units off the left of the box; `svg { overflow: visible }` painted it over
   * the card beside it, and the PNG export cropped it away entirely.
   */
  const labels = rows.map(r => r.full)
  // Uncapped. It was min(250, …) with the labels cut to match, so a real
  // annotation lost its tail on every row — and two clusters sharing a prefix
  // became the same row label. The gutter grows instead; the figure is inside a
  // scroller and W below already accounts for PL.
  const PL = Math.max(110, 22 + widestW(labels, 11.5, true))
  const shownRow = labels
  const labelH = Math.min(96, 24 + maxOf(genes.map(g => g.length)) * 4.6)
  // The legend is part of the figure, in the figure. It used to be laid out in
  // HTML beside it, so every exported dot plot arrived in a manuscript with no
  // size key and no colour bar — the two things that make the marks mean
  // anything.
  // Wide enough for the legends, not just for the data — the two keys sit side
  // by side under the panel and the figure has to make room for them.
  const legendH = 74
  const BAR_W = 150
  // The trees get a band each, and only when there is a tree to draw.
  const TREE = 34
  const treeT = colTree ? TREE : 0
  const treeL = rowTree ? TREE : 0
  const W = Math.max(PL + treeL + genes.length * cw + PR, PL + treeL + 430)
  const plotT = PT + treeT
  const plotB = plotT + rows.length * rh
  const H = plotB + labelH + legendH
  const PLx = PL + treeL

  const avg = rows.map(r => genes.map(g => p.src.mean(g, r.ti, p.groupBy === 'type' ? null : r.cond)))
  const cv = genes.map((_g, gi) => {
    const col = rows.map((_r, ri) => avg[ri][gi])
    if (!p.dotScale) return col
    const m = col.reduce((a, b) => a + b, 0) / col.length
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1
    return col.map(x => Math.max(-2.5, Math.min(2.5, (x - m) / sd)))
  })
  // Symmetric limits when scaled — SCpubr's enforce_symmetry. A diverging
  // scale means nothing unless its neutral sits on the neutral value, and
  // ±2.5 is where Seurat clips a z-scored dot plot anyway.
  const [lo, hi] = p.dotScale ? symmetricRange(-2.5, 2.5) : [0, Math.max(maxOfAll(avg), 0.01)]
  const ramp = p.dotScale ? p.rampDiv : p.rampKey
  const radius = (f: number) => +(1.4 + f * 9).toFixed(2)
  const X = (gi: number) => PLx + cw * (gi + 0.5)
  const Y = (ri: number) => plotT + rh * (ri + 0.5)

  return (
    <>
      <Figure name="dotplot" className="mt-2">
        <div className="overflow-x-auto">
          {/* Fills the card, never squashes below its natural size — the same
              rule the other scrolling figures use. A fixed `width={W}` made this
              and the marker dot plot the only two figures in the studio that
              ignored the width available to them: on a wide screen they sat in
              a corner of their card, and the scroller they live in already
              handles the case where W is the larger number. */}
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
            style={{ minWidth: W }} role="img"
            aria-label={`Dot plot of ${genes.join(', ')}`}>
            {/* The trees, drawn against the axes they order. The column tree
                runs along x above the panel; the row tree is the same shape
                turned a quarter turn, which is why dendroLines returns spans
                and depths rather than x and y — the caller decides which is
                which. */}
            {colTree && dendroLines(colTree, genes.length * cw, treeT - 6).map((l, i) => (
              <line key={`ct${i}`}
                x1={PLx + l.x1} x2={PLx + l.x2}
                y1={plotT - 4 - l.y1} y2={plotT - 4 - l.y2}
                stroke={AXIS_INK} strokeWidth={0.8} />
            ))}
            {rowTree && dendroLines(rowTree, rows.length * rh, treeL - 8).map((l, i) => (
              <line key={`rt${i}`}
                x1={PLx - 4 - l.y1} x2={PLx - 4 - l.y2}
                y1={plotT + l.x1} y2={plotT + l.x2}
                stroke={AXIS_INK} strokeWidth={0.8} />
            ))}
            {/* Grid first, so the marks sit on it rather than under it. Banded
                rows were doing this job and doing it badly: a stripe is a block
                of colour competing with the data for the reader's eye, where a
                hairline just carries it across a wide panel. */}
            {rows.map((r, ri) => (
              <line key={`h${r.full}`} x1={PLx} x2={PLx + genes.length * cw}
                y1={Y(ri)} y2={Y(ri)} stroke={GRID_INK} strokeWidth={0.6} />
            ))}
            {genes.map((g, gi) => (
              <line key={`v${g}`} x1={X(gi)} x2={X(gi)} y1={plotT} y2={plotB}
                stroke={GRID_INK} strokeWidth={0.6} />
            ))}

            {/* Axes and ticks in black — SCpubr sets axis.text and axis.ticks to
                black rather than the theme's grey, because a figure is judged on
                paper where grey-on-white reads as faint. */}
            <line x1={PLx} x2={PLx} y1={plotT} y2={plotB} stroke={AXIS_INK} strokeWidth={0.8} />
            <line x1={PLx} x2={PLx + genes.length * cw} y1={plotB} y2={plotB}
              stroke={AXIS_INK} strokeWidth={0.8} />

            {rows.map((r, ri) => (
              <g key={r.full}>
                <line x1={PL - 3.5} x2={PLx} y1={Y(ri)} y2={Y(ri)} stroke={AXIS_INK} strokeWidth={0.8} />
                <text x={PL - 8} y={Y(ri) + 4} textAnchor="end"
                  style={{ fontSize: 11.5, fill: AXIS_INK, fontWeight: 600 }}>
                  {shownRow[ri]}<title>{r.full}</title>
                </text>
              </g>
            ))}

            {rows.map((r, ri) => genes.map((g, gi) => {
              const pct = p.src.pct(g, r.ti, p.groupBy === 'type' ? null : r.cond)
              if (pct < 0.01) return null
              return (
                // shape 21 in SCpubr's terms: a filled mark with a black edge.
                // Without it a z-scored plot is mostly pale dots with no border,
                // and the reader cannot tell a small faint dot from the page.
                <circle key={`${r.full}-${g}`} cx={X(gi)} cy={Y(ri)} r={radius(pct)}
                  fill={rampColor((cv[gi][ri] - lo) / (hi - lo), ramp)}
                  stroke={MARK_EDGE} strokeWidth={0.7}>
                  <title>
                    {g} in {r.full} — {(pct * 100).toFixed(0)}% of cells,
                    mean {avg[ri][gi].toFixed(2)}
                  </title>
                </circle>
              )
            }))}

            {genes.map((g, gi) => {
              const yb = plotB + 12
              return (
                <g key={g}>
                  <line x1={X(gi)} x2={X(gi)} y1={plotB} y2={plotB + 3.5}
                    stroke={AXIS_INK} strokeWidth={0.8} />
                  <text transform={`rotate(-45 ${X(gi)} ${yb})`} x={X(gi)} y={yb}
                    textAnchor="end"
                    style={{ fontStyle: 'italic', fontSize: 11, fill: AXIS_INK }}>{g}</text>
                </g>
              )
            })}

            {/* Both keys centred under the panel, SCpubr's legend.position =
                "bottom". The colour bar leads because it is the one a reader
                consults per mark; the size key is read once. */}
            <ColorBar
              cx={PLx + (W - PLx) * 0.32} y={H - legendH + 22} w={BAR_W} h={11}
              ramp={ramp} lo={lo} hi={hi}
              breaks={p.dotScale ? [-2.5, -1.25, 0, 1.25, 2.5] : undefined}
              title={p.dotScale ? 'Avg. Exp. (z-scored)' : 'Avg. Exp.'}
              id="dotplot-bar"
            />
            <SizeKey cx={PLx + (W - PLx) * 0.78} y={H - legendH + 22}
              title="Percent Expressed" radius={radius} />
          </svg>
        </div>
      </Figure>

      {/* Which of the two things the colour means. It is the most misread
          property of this figure, so it is stated on the figure — but as the
          claim, not the argument, which is in Methods. */}
      <p className="sub mt-2.5">
        {p.dotScale
          ? <>Colour is <b>z-scored per gene</b> — where a gene is highest, not how much of it.</>
          : <>Colour is the raw mean, on one scale for every gene.</>}
      </p>
    </>
  )
}

