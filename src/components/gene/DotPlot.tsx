// Seurat's dot plot: expression by size and colour, gene by identity.

import { useMemo } from 'react'
import type { Identity } from '../../types.ts'
import { dendroLines, orderRows } from '../../lib/cluster.ts'
import { maxOfAll } from '../../lib/chart.ts'
import { axisTicks, widestW } from '../../lib/labels.ts'
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
export default function DotPlot(
  p: GeneProps & { ids: Identity[]; cluster?: boolean; flip?: boolean },
) {
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

  /**
   * One tree per QUANTITY, not per axis.
   *
   * They used to be called rowTree and colTree, which was true only while the
   * identities were always the rows. `flip` swaps which axis each is drawn
   * against, and a tree named for a side of the plate cannot survive that —
   * the identity tree describes identities wherever they end up.
   */
  const idTree = useMemo(
    () => (p.cluster ? orderRows(shown) : null), [p.cluster, shown])
  const geneTree = useMemo(() => {
    if (!p.cluster || genes0.length < 3) return null
    // Transposed: a column is a gene's profile across the identities.
    return orderRows(genes0.map((_g, gi) => rows0.map((_r, ri) => shown[ri][gi])))
  }, [p.cluster, shown, genes0, rows0])

  const ids = useMemo(
    () => (idTree ? idTree.order.map(i => rows0[i]) : rows0), [idTree, rows0])
  const genes = useMemo(
    () => (geneTree ? geneTree.order.map(i => genes0[i]) : genes0), [geneTree, genes0])

  const avg = ids.map(r => genes.map(g => p.src.mean(g, r.ti, p.groupBy === 'type' ? null : r.cond)))
  const cv = genes.map((_g, gi) => {
    const col = ids.map((_r, ri) => avg[ri][gi])
    if (!p.dotScale) return col
    const m = col.reduce((a, b) => a + b, 0) / col.length
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1
    return col.map(x => Math.max(-2.5, Math.min(2.5, (x - m) / sd)))
  })

  /**
   * Which quantity is on which axis.
   *
   * Seurat draws identities down the side and genes along the bottom, and that
   * is still the default. It is the wrong way round as soon as the panel is a
   * marker list: a hundred genes along the bottom is a figure a metre wide with
   * every name rotated, where a hundred genes down the side is a column you
   * scroll — which is how pheatmap, ComplexHeatmap and scanpy's dotplot draw
   * the same data. Nothing about the numbers changes; `at()` below is the only
   * place that knows which way round the plate is.
   */
  const flip = !!p.flip
  const nV = flip ? genes.length : ids.length
  const nH = flip ? ids.length : genes.length
  /** Plate cell (v, h) as (identity, gene) indices. */
  const at = (v: number, h: number): [number, number] => (flip ? [h, v] : [v, h])

  const vLabels = flip ? genes : ids.map(r => r.full)
  const hLabels = flip ? ids.map(r => r.full) : genes
  const vTree = flip ? geneTree : idTree
  const hTree = flip ? idTree : geneTree
  /** A gene symbol is set in italic; a cell type is not. */
  const vStyle = flip
    ? { fontSize: 11, fill: AXIS_INK, fontStyle: 'italic' as const }
    : { fontSize: 11.5, fill: AXIS_INK, fontWeight: 600 }
  const hStyle = flip
    ? { fontSize: 11, fill: AXIS_INK, fontWeight: 600 }
    : { fontSize: 11, fill: AXIS_INK, fontStyle: 'italic' as const }

  const cw = 42, rh = 26, PT = 14, PR = 26
  /**
   * The label gutter, measured, and never cut.
   *
   * It was min(250, …) with the labels cut to match, so a real annotation lost
   * its tail on every row — and two clusters sharing a prefix became the same
   * row label. The gutter grows instead; the figure is inside a scroller and W
   * below already accounts for it.
   */
  const gutter = Math.max(110, 22 + widestW(vLabels, flip ? 11 : 11.5, !flip))
  // The trees get a band each, and only when there is a tree to draw.
  const TREE = 34
  const treeT = hTree ? TREE : 0
  const treeL = vTree ? TREE : 0
  /**
   * The bottom axis, decided once rather than in four places.
   *
   * It used to be a fixed -45° with a margin guessed from the longest gene
   * NAME LENGTH times 4.6, capped at 96. Gene symbols are short enough that
   * nobody noticed; a cell type down there is "Cardiomyocyte/Working
   * cardiomyocyte EXCLUDED", which at 45° hangs 180 units below its anchor and
   * reaches as far again to the left of the first tick. axisTicks answers both
   * — see lib/labels.ts.
   */
  const tick = axisTicks(hLabels, {
    band: cw, leftAnchor: gutter + treeL + cw / 2, px: 11, deg: 45, startAt: 12, upright: 26,
  })
  // Grown by what the first tick reaches back past its own anchor, so a long
  // name rotates into room that exists rather than off the left of the plate.
  const PL = gutter + tick.left
  // The legend is part of the figure, in the figure. It used to be laid out in
  // HTML beside it, so every exported dot plot arrived in a manuscript with no
  // size key and no colour bar — the two things that make the marks mean
  // anything.
  // Wide enough for the legends, not just for the data — the two keys sit side
  // by side under the panel and the figure has to make room for them.
  const legendH = 74
  const BAR_W = 150
  const PLx = PL + treeL
  const W = Math.max(PLx + nH * cw + PR, PLx + 430)
  const plotT = PT + treeT
  const plotB = plotT + nV * rh
  const H = plotB + tick.bottom + legendH

  // Symmetric limits when scaled — SCpubr's enforce_symmetry. A diverging
  // scale means nothing unless its neutral sits on the neutral value, and
  // ±2.5 is where Seurat clips a z-scored dot plot anyway.
  const [lo, hi] = p.dotScale ? symmetricRange(-2.5, 2.5) : [0, Math.max(maxOfAll(avg), 0.01)]
  const ramp = p.dotScale ? p.rampDiv : p.rampKey
  const radius = (f: number) => +(1.4 + f * 9).toFixed(2)
  const X = (h: number) => PLx + cw * (h + 0.5)
  const Y = (v: number) => plotT + rh * (v + 0.5)

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
          {/* Left-aligned when the plate is narrower than the card.
              `width="100%" height={H}` with a viewBox letterboxes under the
              default xMidYMid, and transposed the plate genuinely IS narrow —
              a 72-gene panel is 540 units wide against a 1 120-unit card, so
              the figure sat in the middle of its own scroller with a 290-unit
              margin either side while every other figure on the page started
              at the left. */}
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
            preserveAspectRatio="xMinYMid meet"
            style={{ minWidth: W }} role="img"
            aria-label={`Dot plot of ${genes.join(', ')}`
              + ` — ${flip ? 'genes down the side' : 'genes along the bottom'}`}>
            {/* The trees, drawn against the axes they order. The horizontal one
                runs along x above the panel; the vertical one is the same shape
                turned a quarter turn, which is why dendroLines returns spans
                and depths rather than x and y — the caller decides which is
                which. */}
            {hTree && dendroLines(hTree, nH * cw, treeT - 6).map((l, i) => (
              <line key={`ht${i}`}
                x1={PLx + l.x1} x2={PLx + l.x2}
                y1={plotT - 4 - l.y1} y2={plotT - 4 - l.y2}
                stroke={AXIS_INK} strokeWidth={0.8} />
            ))}
            {vTree && dendroLines(vTree, nV * rh, treeL - 8).map((l, i) => (
              <line key={`vt${i}`}
                x1={PLx - 4 - l.y1} x2={PLx - 4 - l.y2}
                y1={plotT + l.x1} y2={plotT + l.x2}
                stroke={AXIS_INK} strokeWidth={0.8} />
            ))}
            {/* Grid first, so the marks sit on it rather than under it. Banded
                rows were doing this job and doing it badly: a stripe is a block
                of colour competing with the data for the reader's eye, where a
                hairline just carries it across a wide panel. */}
            {vLabels.map((lab, v) => (
              <line key={`h${lab}`} x1={PLx} x2={PLx + nH * cw}
                y1={Y(v)} y2={Y(v)} stroke={GRID_INK} strokeWidth={0.6} />
            ))}
            {hLabels.map((lab, h) => (
              <line key={`v${lab}`} x1={X(h)} x2={X(h)} y1={plotT} y2={plotB}
                stroke={GRID_INK} strokeWidth={0.6} />
            ))}

            {/* Axes and ticks in black — SCpubr sets axis.text and axis.ticks to
                black rather than the theme's grey, because a figure is judged on
                paper where grey-on-white reads as faint. */}
            <line x1={PLx} x2={PLx} y1={plotT} y2={plotB} stroke={AXIS_INK} strokeWidth={0.8} />
            <line x1={PLx} x2={PLx + nH * cw} y1={plotB} y2={plotB}
              stroke={AXIS_INK} strokeWidth={0.8} />

            {vLabels.map((lab, v) => (
              <g key={`vl${lab}`}>
                <line x1={PL - 3.5} x2={PLx} y1={Y(v)} y2={Y(v)} stroke={AXIS_INK} strokeWidth={0.8} />
                <text x={PL - 8} y={Y(v) + 4} textAnchor="end" style={vStyle}>
                  {lab}<title>{lab}</title>
                </text>
              </g>
            ))}

            {vLabels.map((_lab, v) => hLabels.map((_h, h) => {
              const [ri, gi] = at(v, h)
              const r = ids[ri], g = genes[gi]
              const pct = p.src.pct(g, r.ti, p.groupBy === 'type' ? null : r.cond)
              if (pct < 0.01) return null
              return (
                // shape 21 in SCpubr's terms: a filled mark with a black edge.
                // Without it a z-scored plot is mostly pale dots with no border,
                // and the reader cannot tell a small faint dot from the page.
                <circle key={`${r.full}-${g}`} cx={X(h)} cy={Y(v)} r={radius(pct)}
                  fill={rampColor((cv[gi][ri] - lo) / (hi - lo), ramp)}
                  stroke={MARK_EDGE} strokeWidth={0.7}>
                  <title>
                    {g} in {r.full} — {(pct * 100).toFixed(0)}% of cells,
                    mean {avg[ri][gi].toFixed(2)}
                  </title>
                </circle>
              )
            }))}

            {hLabels.map((lab, h) => {
              const yb = plotB + 12
              return (
                <g key={`hl${lab}`}>
                  <line x1={X(h)} x2={X(h)} y1={plotB} y2={plotB + 3.5}
                    stroke={AXIS_INK} strokeWidth={0.8} />
                  {tick.rotate ? (
                    <text transform={`rotate(${-tick.deg} ${X(h)} ${yb})`} x={X(h)} y={yb}
                      textAnchor="end" style={hStyle}>{lab}<title>{lab}</title></text>
                  ) : (
                    <text x={X(h)} y={yb + 2} textAnchor="middle" style={hStyle}>
                      {lab}<title>{lab}</title>
                    </text>
                  )}
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
