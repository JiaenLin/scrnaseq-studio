import { useEffect, useState } from 'react'
import type { CellType, DERow } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { deMarkersAll, deMarkersAllAsync, isSig, thresholdFor, type DEResult } from '../lib/stats.ts'
import { sci } from '../lib/chart.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { mix, pal, type PaletteKey } from '../lib/palette.ts'
import { Card, Chips, Empty, Mono } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'
import { useCompute } from '../lib/compute.ts'
import Progress from './Progress.tsx'

export default function Markers({ src, types, palKey, onRename, onPickGene }: {
  src: Source
  types: CellType[]
  palKey: PaletteKey
  onRename: (index: number, name: string) => void
  onPickGene: (g: string) => void
}) {
  const [topN, setTopN] = useState(5)
  const [open, setOpen] = useState<number | null>(null)

  // One Wilcoxon per cluster against every other cell, all clusters in one pass
  // over the genes. Keyed on the object alone: renaming a cluster must not throw
  // the results away, and no threshold here feeds the test.
  const { value: results, pass } = useCompute<DEResult[]>(
    src, 'markers', true,
    () => deMarkersAll(src),
    (report, cancelled) => deMarkersAllAsync(src, null, (d, t) => report('', d, t), cancelled),
  )

  const th = thresholdFor('wilcox')
  const perCluster = results ? results.map(r => r.rows) : types.map(() => [] as DERow[])
  const tops = perCluster.map(rows =>
    rows.filter(r => isSig(r, th) && r.lfc > 0).slice(0, topN))
  const genes = [...new Set(tops.flat().map(r => r.gene))]

  // The dot plot needs the winning genes' actual values, which for a collection
  // are still in the file. One more read, of the few dozen genes on screen.
  const wanted = genes.join(',')
  const [dots, setDots] = useState(!src.lazy)
  useEffect(() => {
    if (!src.lazy) { setDots(true); return }
    let dead = false
    setDots(false)
    void src.ensure(wanted ? wanted.split(',') : []).then(() => { if (!dead) setDots(true) })
    return () => { dead = true }
  }, [src, wanted])

  if (pass) {
    return (
      <Card eyebrow="Markers · one vs rest" title="Testing every gene in every cluster">
        <Progress pass={pass} title="One Wilcoxon per cluster, against every other cell" />
      </Card>
    )
  }
  if (!results) {
    return <Card><Empty title="No markers to show">This object has no clusters to compare.</Empty></Card>
  }

  const cw = 21, rh = 34, PL = 150, PT = 84
  const W = PL + genes.length * cw + 24
  const H = PT + types.length * rh + 16

  const saveCsv = () => downloadCsv(
    'cluster_markers',
    ['cluster', 'gene', 'log2FC', 'pct.1', 'pct.2', 'p', 'padj'],
    perCluster.flatMap((rows, ti) => rows
      .filter(r => isSig(r, th) && r.lfc > 0)
      .map(r => [types[ti].name, r.gene, r.lfc.toFixed(4),
        r.pct1?.toFixed(4), r.pct2?.toFixed(4),
        r.p.toExponential(4), r.padj.toExponential(4)])))

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
        sub="Top genes per cluster by adjusted p, shown as mean expression × fraction detected. Rename any cluster here — the name propagates to every tab and into Methods."
      >
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Chips label="Top per cluster" value={topN} options={[3, 5, 8, 12]} onChange={setTopN} />
          <div className="ml-auto"><CsvButton onClick={saveCsv} /></div>
        </div>

        <Figure name="cluster_markers" className="mt-4 pt-6">
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
              aria-label="Marker gene dot plot">
              {genes.map((g, gi) => {
                const x = PL + cw * (gi + 0.5)
                return (
                  <text key={g} className="axis" transform={`rotate(-52 ${x} ${PT - 8})`}
                    x={x} y={PT - 8} textAnchor="start"
                    style={{ fontStyle: 'italic', fontSize: 10.5 }}>{g}</text>
                )
              })}
              {types.map((t, ti) => {
                const y = PT + rh * (ti + 0.5)
                const own = new Set(tops[ti].map(r => r.gene))
                return (
                  <g key={t.key}>
                    <text className="axis" x={PL - 12} y={y + 4} textAnchor="end"
                      style={{ fontSize: 11.5, fill: 'var(--ink)', fontWeight: 550 }}>{t.name}</text>
                    {dots && genes.map((g, gi) => {
                      const m = src.mean(g, ti)
                      const pct = src.pct(g, ti)
                      if (pct < 0.02) return null
                      return (
                        <circle key={g} cx={PL + cw * (gi + 0.5)} cy={y}
                          r={+(2 + pct * 7.5).toFixed(1)}
                          fill={mix('#e2e8f0', pal(ti, palKey), Math.min(1, m / 2.5))}
                          stroke={own.has(g) ? pal(ti, palKey) : 'none'}
                          strokeWidth={own.has(g) ? 0.8 : 0} opacity=".95">
                          <title>{g} in {t.name} — {(pct * 100).toFixed(0)}% of cells, mean {m.toFixed(2)}</title>
                        </circle>
                      )
                    })}
                  </g>
                )
              })}
            </svg>
          </div>
        </Figure>
        <div className="legend mt-2.5">
          {!dots && <span style={{ color: 'var(--ink-3)' }}>reading these genes…</span>}
          <span>dot size = % of cells detecting the gene</span>
          <span>colour = mean expression within the cluster</span>
          <span>ring = one of this cluster&rsquo;s own top genes</span>
        </div>

        <div className="mt-5">
          <div className="eyebrow mb-2">Per cluster</div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
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
                {open === ti && (
                  <div className="scrollx mt-2" style={{ maxHeight: 260 }}>
                    <table className="t">
                      <thead><tr><th>Gene</th><th>log₂FC</th><th>pct.1</th><th>padj</th></tr></thead>
                      <tbody>
                        {perCluster[ti].filter(r => isSig(r, th) && r.lfc > 0).slice(0, 40)
                          .map((r: DERow) => (
                            <tr key={r.gene} className="cursor-pointer"
                              title={`Open ${r.gene} in Gene expression`}
                              onClick={() => onPickGene(r.gene)}>
                              <td className="mono font-semibold italic">{r.gene}</td>
                              <td className="num" style={{ color: 'var(--bad)' }}>+{r.lfc.toFixed(2)}</td>
                              <td className="num" style={{ color: 'var(--ink-2)' }}>{r.pct1?.toFixed(2)}</td>
                              <td className="num mono text-[11.5px]">{sci(r.padj)}</td>
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
            The count on each chip is every gene passing padj &lt; {th.padj} and log₂FC ≥ {th.lfc};
            click it for the list. Renaming keeps results attached to the original cluster, so a
            rename never detaches work already done. File names use the slug{' '}
            <Mono>{slug('cluster_markers')}</Mono>.
          </p>
        </div>
      </Card>
    </>
  )
}
