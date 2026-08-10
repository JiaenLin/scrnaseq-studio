import { useEffect, useMemo, useState } from 'react'
import type { CellType, DERow } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { deMarkersAll, isSig, markersSpec, thresholdFor } from '../lib/stats.ts'
import { dotAt, dotGrid, type DotGrid } from '../lib/dots.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { maxOf } from '../lib/chart.ts'
import { AXIS_INK, GRID_INK, MARK_EDGE } from '../lib/figure-ink.ts'
import { mix, pal, type PaletteKey } from '../lib/palette.ts'
import { ColorBar, SizeKey } from './svg-parts.tsx'
import { nlpCsv, nlpTxt, pCsv, pTxt } from '../lib/significance.ts'
import { Card, Chips, Empty, Mono } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'
import { useJob } from '../lib/compute.ts'
import Progress from './Progress.tsx'

/**
 * The same grid `dotGrid` builds, filled one window of genes at a time.
 *
 * Each window is copied in whole — a window's block of the grid is contiguous,
 * because the grid is gene-major — so every value is the number dotGrid would
 * have produced with all of the genes resident, not an equivalent of it.
 */
async function streamDots(src: Source, genes: string[], nT: number): Promise<DotGrid> {
  const mean = new Float64Array(genes.length * nT)
  const pct = new Float64Array(genes.length * nT)
  await src.withGenes(genes, (win, at) => {
    const part = dotGrid(src, win, nT)
    for (let k = 0; k < win.length; k++) {
      mean.set(part.mean.subarray(k * nT, (k + 1) * nT), at[k] * nT)
      pct.set(part.pct.subarray(k * nT, (k + 1) * nT), at[k] * nT)
    }
  })
  return { mean, pct, nT }
}

export default function Markers({ src, types, palKey, onRename, onPickGene }: {
  src: Source
  types: CellType[]
  palKey: PaletteKey
  onRename: (index: number, name: string) => void
  onPickGene: (g: string) => void
}) {
  const [topN, setTopN] = useState(5)
  const [open, setOpen] = useState<number | null>(null)

  /**
   * Whether the pass may start.
   *
   * An object held in memory answers in milliseconds, so asking permission for
   * it would be a dialog in front of an instant result. A collection is minutes,
   * and opening a tab is not consent to spend them — arriving here used to
   * commit the reader to a four-minute pass before they had read the heading.
   *
   * Restricting the pass to ONE cell type would not help, and the shape of the
   * computation is why: markersPlan sorts each gene's values once and then
   * answers every cluster from that one ordering. The sort is 76% of the work
   * and is shared, so one cluster costs very nearly what 133 cost. The saving
   * is in not starting, not in narrowing — narrowing is for reading.
   */
  const [go, setGo] = useState(!src.lazy)

  // One Wilcoxon per cluster against every other cell, all clusters in one pass
  // over the genes. Keyed on the object alone: renaming a cluster must not throw
  // the results away, and no threshold here feeds the test.
  //
  // Its own slot, so the contrast tabs cannot cancel it. The key never changes,
  // so it is computed at most once per object no matter how the user moves.
  //
  // Two lines, and neither of them knows where the work happens. A demo object
  // computes in the useMemo; the atlas computes in the worker and reports back.
  const { value: results, pass } = useJob<'markers'>(
    src, 'markers', 'markers', go,
    () => deMarkersAll(src),
    () => ({ kind: 'markers', ...markersSpec(src, null) }),
  )

  const th = thresholdFor('wilcox')
  const perCluster = results ? results.map(r => r.rows) : types.map(() => [] as DERow[])
  const tops = perCluster.map(rows =>
    rows.filter(r => isSig(r, th) && r.lfc > 0).slice(0, topN))
  const genes = [...new Set(tops.flat().map(r => r.gene))]

  // Every dot's mean and detection rate, computed once for the whole grid. See
  // dots.ts for why this is not `src.mean(g, ti)` inside the render.
  //
  // The values are still in the file for a collection, and at twelve genes a
  // cluster there are more of them than it will hold — 818 columns is 215 MB of
  // atlas. So the grid is accumulated a window at a time: the Source makes a
  // window answerable, this adds those columns, and the window is released
  // before the next is read. A grid is a sum, so it never needed every column
  // at once. An object already in memory is one window and is built inside the
  // render, exactly as it was.
  const wanted = genes.join(',')
  const inline = useMemo(
    () => (src.lazy ? null : dotGrid(src, wanted ? wanted.split(',') : [], types.length)),
    [src, wanted, types.length])
  // The grid is stored with the gene list it was built for, and read back only
  // when the two still agree. A render always precedes the effect that would
  // clear a stale grid, so between the pass finishing and that effect running
  // there is one frame where `genes` is the new 505 and the grid is the old
  // one — built when `genes` was empty, and therefore zero-length. A
  // zero-length grid is an object, so a null check waves it through, and the
  // render then reads past the end of `mean` and calls `toFixed` on undefined.
  // With no error boundary in the tree that took the whole app to a white page.
  const [streamed, setStreamed] = useState<{ key: string; grid: DotGrid } | null>(null)
  const [dotError, setDotError] = useState<string | null>(null)
  useEffect(() => {
    if (!src.lazy) return
    let dead = false
    setStreamed(null)
    setDotError(null)
    void streamDots(src, wanted ? wanted.split(',') : [], types.length).then(
      g => { if (!dead) setStreamed({ key: wanted, grid: g }) },
      (e: unknown) => { if (!dead) setDotError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { dead = true }
  }, [src, wanted, types.length])
  const grid = inline ?? (streamed?.key === wanted ? streamed.grid : null)

  if (pass) {
    return (
      <Card eyebrow="Markers · one vs rest" title="Testing every gene in every cluster">
        <Progress pass={pass} title="One Wilcoxon per cluster, against every other cell" />
      </Card>
    )
  }
  // Not started. Stated as a cost the reader agrees to, with the number that
  // decides it — every gene against every cluster is the same amount of work
  // whichever cell type they are actually interested in.
  if (!go) {
    return (
      <Card eyebrow="Markers · one vs rest" title="Markers are not computed yet">
        <p className="sub mt-1">
          Every gene is tested in every cluster, in one pass over the file —{' '}
          {src.genes.length.toLocaleString('en-US')} genes across{' '}
          {types.length} cell types. On an object this size that takes a couple of minutes,
          so it is not started until you ask. It runs off the page and the tab stays usable,
          and the answer is kept for as long as this object is open.
        </p>
        <button className="btn btn-primary mt-3.5" onClick={() => setGo(true)}>
          Find markers
        </button>
      </Card>
    )
  }
  if (!results) {
    return <Card><Empty title="No markers to show">This object has no clusters to compare.</Empty></Card>
  }

  const cw = 21, rh = 34, PL = 150, PT = 84
  // The key travels with the figure. It used to sit in a legend row underneath,
  // which meant an exported marker plot — the figure most likely to reach a
  // reviewer — arrived with nothing saying what a dot's size or colour meant.
  const legendH = 74
  // The gene labels lean up and to the RIGHT from the last column, so the right
  // margin has to clear the longest of them and not just the last dot. At 24 px
  // the final label was cut off — on a marker plot, where that column is the one
  // a reader is most likely to be looking for.
  const lean = Math.ceil(Math.cos(52 * Math.PI / 180) * maxOf(genes.map(g => g.length)) * 5.4)
  const W = Math.max(PL + genes.length * cw + 24 + lean, PL + 430)
  const plotB = PT + types.length * rh
  const H = plotB + 16 + legendH
  const dotR = (f: number) => +(2 + f * 7.5).toFixed(2)

  // Same columns and same two rules as the table above it: the adjusted p as a
  // bound once it has underflowed, and the log-space significance beside it so
  // the export carries the resolution the screen shows.
  const saveCsv = () => downloadCsv(
    'cluster_markers',
    ['cluster', 'gene', 'log2FC', 'pct.1', 'pct.2', 'p', 'padj', 'neg_log10_padj'],
    perCluster.flatMap((rows, ti) => rows
      .filter(r => isSig(r, th) && r.lfc > 0)
      .map(r => [types[ti].name, r.gene, r.lfc.toFixed(4),
        r.pct1?.toFixed(4), r.pct2?.toFixed(4),
        pCsv(r.p), pCsv(r.padj), nlpCsv(r.nlp)])))

  return (
    <>
      <div className="note note-info mb-4">
        <b>A real test, and still a circular one.</b> Each cluster is compared against every
        other cell with the same Wilcoxon rank-sum that Seurat&rsquo;s <Mono>FindAllMarkers</Mono>{' '}
        runs. But the clusters were defined using the expression these p-values then score, so
        they cannot be read as evidence that the clusters exist — they rank genes within a
        grouping already assumed. The effect size and the detection rates are the honest columns.
      </div>

      <Card
        eyebrow="Markers · one vs rest"
        title={`${genes.length} genes across ${types.length} clusters`}
        sub="Top genes per cluster by −log₁₀ adjusted p — the adjusted p itself underflows the double on an object this size, so the ranking is read in log space. Shown as mean expression × fraction detected. Rename any cluster here — the name propagates to every tab and into Methods."
      >
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Chips label="Top per cluster" value={topN} options={[3, 5, 8, 12]} onChange={setTopN} />
          <div className="ml-auto"><CsvButton onClick={saveCsv} /></div>
        </div>

        {/* Reading the values is a second pass, after the statistics. On the
            atlas it streams 505 genes a window at a time and takes about 52 s,
            through all of which every axis label is drawn and no dot is — a
            figure that reads as finished and empty rather than as unfinished.
            That is the same lie as the "No markers to show" flash, and it has
            already fooled one reviewer into reporting the plot as broken. So it
            is said here, against the figure, and not only in the legend below it.

            role=status deliberately: a pass IS still running, and anything that
            treats Progress.tsx's status node as "still working" should see this
            one too rather than call the tab finished while it is still reading. */}
        {!grid && !dotError && (
          <div role="status" className="note mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span>Reading {genes.length} genes from the file — the dots arrive when it finishes.</span>
              <span style={{ color: 'var(--ink-3)' }}>the table below is already final</span>
            </div>
            {/* Indeterminate on purpose. The read is windowed by BYTES, not by
                gene, so the fraction of genes done is not the fraction of work
                done and a percentage here would be a number the app invented. A
                moving bar says "still going" without claiming to know how far. */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--line)' }}>
              <div className="h-full w-1/3 rounded-full"
                style={{ background: 'var(--accent)', animation: 'slide 1.4s ease-in-out infinite' }} />
            </div>
          </div>
        )}
        <Figure name="cluster_markers" className="mt-4 pt-6">
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
              aria-label="Marker gene dot plot">
              {/* Grid behind, axes in black. Same reasoning as the gene tab's
                  dot plot: on paper the interface's greys read as faint. */}
              {types.map((t, ti) => (
                <line key={`h${t.key}`} x1={PL} x2={PL + genes.length * cw}
                  y1={PT + rh * (ti + 0.5)} y2={PT + rh * (ti + 0.5)}
                  stroke={GRID_INK} strokeWidth={0.6} />
              ))}
              <line x1={PL} x2={PL} y1={PT} y2={plotB} stroke={AXIS_INK} strokeWidth={0.8} />
              <line x1={PL} x2={PL + genes.length * cw} y1={plotB} y2={plotB}
                stroke={AXIS_INK} strokeWidth={0.8} />
              {genes.map((g, gi) => {
                const x = PL + cw * (gi + 0.5)
                return (
                  <text key={g} transform={`rotate(-52 ${x} ${PT - 8})`}
                    x={x} y={PT - 8} textAnchor="start"
                    style={{ fontStyle: 'italic', fontSize: 10.5, fill: AXIS_INK }}>{g}</text>
                )
              })}
              {types.map((t, ti) => {
                const y = PT + rh * (ti + 0.5)
                const own = new Set(tops[ti].map(r => r.gene))
                return (
                  <g key={t.key}>
                    <line x1={PL - 3.5} x2={PL} y1={y} y2={y} stroke={AXIS_INK} strokeWidth={0.8} />
                    <text x={PL - 8} y={y + 4} textAnchor="end"
                      style={{ fontSize: 11.5, fill: AXIS_INK, fontWeight: 600 }}>{t.name}</text>
                    {grid && genes.map((g, gi) => {
                      const m = grid.mean[dotAt(grid, gi, ti)]
                      const pct = grid.pct[dotAt(grid, gi, ti)]
                      if (pct < 0.02) return null
                      // Every mark gets the black edge; a cluster's own top genes
                      // keep their heavier ring on top of it, which is what that
                      // ring is for and why it must stay distinguishable.
                      return (
                        <circle key={g} cx={PL + cw * (gi + 0.5)} cy={y}
                          r={dotR(pct)}
                          fill={mix('#e2e8f0', pal(ti, palKey), Math.min(1, m / 2.5))}
                          stroke={own.has(g) ? pal(ti, palKey) : MARK_EDGE}
                          strokeWidth={own.has(g) ? 1.4 : 0.6}>
                          <title>{g} in {t.name} — {(pct * 100).toFixed(0)}% of cells, mean {m.toFixed(2)}</title>
                        </circle>
                      )
                    })}
                  </g>
                )
              })}
              <ColorBar
                cx={PL + (W - PL) * 0.32} y={H - legendH + 22} w={150} h={11}
                colors={['#e2e8f0', '#334155']} lo={0} hi={2.5}
                title="Avg. Exp. · depth of cluster colour"
                id="markers-bar"
              />
              <SizeKey cx={PL + (W - PL) * 0.78} y={H - legendH + 22}
                title="Percent Expressed" radius={dotR} />
            </svg>
          </div>
        </Figure>
        {/* The size and colour keys are inside the figure now. What is left here
            is state, not key: whether the values are still being read, and what
            the heavier ring means — which needs a coloured swatch to show and
            costs nothing to lose from an exported file. */}
        <div className="legend mt-2.5">
          {!grid && !dotError && <span style={{ color: 'var(--ink-3)' }}>reading these genes…</span>}
          {dotError && <span style={{ color: 'var(--bad)' }}>{dotError}</span>}
          <span>a heavier ring marks one of that cluster&rsquo;s own top genes</span>
        </div>

        <div className="mt-5">
          <div className="eyebrow mb-2">Per cluster</div>
          {/* 300, not 260: at 260 the open table was wider than its card, and the
              column clipped was the last one — which is the significance. It was
              already clipped before this column existed (padj wrapped onto two
              lines and still ran off the edge), and a number a reader has to
              scroll sideways to finish reading is not a number that has been
              shown to them. */}
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
            {types.map((t, ti) => (
              <div key={t.key} className="rounded-xl px-3 py-2.5"
                style={{ background: 'var(--sunk)' }}>
                <div className="flex items-center gap-1.5">
                  <i className="sw" style={{ background: pal(ti, palKey) }} />
                  <input
                    className="inp flex-1 text-[12.5px]" defaultValue={t.name}
                    aria-label={`Rename cluster ${t.key}`}
                    onBlur={e => onRename(ti, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  />
                  <button className="chip" onClick={() => setOpen(open === ti ? null : ti)}>
                    {perCluster[ti].filter(r => isSig(r, th) && r.lfc > 0).length}
                  </button>
                </div>
                <div className="mono mt-1.5 text-[11.5px] italic" style={{ color: 'var(--ink-2)' }}>
                  {tops[ti].map(r => r.gene).join(', ') || 'no gene passes the cutoffs'}
                </div>
                {/* Four columns: a fifth does not fit even the widened card, and
                    the one that would fall off the edge is the significance. So
                    padj is replaced here rather than joined — under the floor it
                    has nothing to say that this column does not say better, it
                    is on the cell's tooltip for the rows where it is still a
                    number, and the CSV carries both. The DEG table has the width
                    and shows both there. */}
                {open === ti && (
                  <div className="scrollx mt-2" style={{ maxHeight: 260 }}>
                    <table className="t">
                      <thead>
                        <tr>
                          <th>Gene</th><th>log₂FC</th><th>pct.1</th><th>−log₁₀ padj</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perCluster[ti].filter(r => isSig(r, th) && r.lfc > 0).slice(0, 40)
                          .map((r: DERow) => (
                            <tr key={r.gene} className="cursor-pointer"
                              title={`Open ${r.gene} in Gene expression`}
                              onClick={() => onPickGene(r.gene)}>
                              <td className="mono font-semibold italic">{r.gene}</td>
                              <td className="num" style={{ color: 'var(--bad)' }}>+{r.lfc.toFixed(2)}</td>
                              <td className="num" style={{ color: 'var(--ink-2)' }}>{r.pct1?.toFixed(2)}</td>
                              <td className="num mono text-[11.5px] font-semibold"
                                title={`adjusted p ${pTxt(r.padj)}`}>{nlpTxt(r.nlp)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
            The count on each chip is every gene passing padj &lt; {th.padj} — that is
            −log₁₀ padj &gt; {(-Math.log10(th.padj)).toFixed(2)} — and log₂FC ≥ {th.lfc};
            click it for the list. There the rows are ordered by <b>−log₁₀ padj</b>, which is
            −log₁₀ of the adjusted p formed in log space. The adjusted p itself underflows the
            double past z ≈ 38.6, where it stops being a measurement and becomes one shared
            constant for every row alike, so it is not printed here — hover a value for it, and
            the CSV carries it beside this column, written{' '}
            <Mono>&lt;1e-308</Mono> from that floor down. Renaming keeps results attached to the
            original cluster, so a rename never detaches work already done. File names use the
            slug{' '}
            <Mono>{slug('cluster_markers')}</Mono>.
          </p>
        </div>
      </Card>
    </>
  )
}
