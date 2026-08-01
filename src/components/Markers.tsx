import type { CellType } from '../types.ts'
import { MARKER_OF, meanExpr, pctFromMean } from '../lib/demo.ts'
import { mix, pal, type PaletteKey } from '../lib/palette.ts'
import { Card, Mono } from './Ui.tsx'

export default function Markers({ types, palKey, onRename }: {
  types: CellType[]
  palKey: PaletteKey
  onRename: (index: number, name: string) => void
}) {
  const genes = types.flatMap(t => t.mk)
  const cw = 21, rh = 34, PL = 132, PT = 76
  const W = PL + genes.length * cw + 20
  const H = PT + types.length * rh + 16

  return (
    <>
      <div className="note note-info mb-4">
        <b>A ranking, not a hypothesis test.</b> These come from a one-vs-rest Wilcoxon test —
        Seurat&rsquo;s <Mono>FindAllMarkers</Mono>, Scanpy&rsquo;s <Mono>rank_genes_groups</Mono>.
        The clusters were defined using the same expression the test then scores, so the p-values
        are circular and are shown for ordering only. Read the effect size and the detection rates.
      </div>

      <Card
        eyebrow="Markers · one vs rest"
        title="Mean expression × fraction of cells detected"
        sub="Top 5 genes per cluster. Rename any cluster here — the name propagates to every tab and into Methods."
      >
        <div className="mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Marker gene dot plot">
            {genes.map((g, gi) => {
              const x = PL + cw * (gi + 0.5)
              return (
                <text key={`${g}-${gi}`} className="axis" transform={`rotate(-52 ${x} ${PT - 8})`}
                  x={x} y={PT - 8} textAnchor="start"
                  style={{ fontStyle: 'italic', fontSize: 10.5 }}>{g}</text>
              )
            })}
            {types.map((t, ti) => {
              const y = PT + rh * (ti + 0.5)
              return (
                <g key={t.key}>
                  <text className="axis" x={PL - 12} y={y + 4} textAnchor="end"
                    style={{ fontSize: 11.5, fill: 'var(--ink)', fontWeight: 550 }}>{t.name}</text>
                  {genes.map((g, gi) => {
                    const own = MARKER_OF[g]?.[0] === ti
                    const m = meanExpr(g, ti, 0)
                    const pct = pctFromMean(m)
                    if (pct < 0.04) return null
                    return (
                      <circle key={`${g}-${gi}`} cx={PL + cw * (gi + 0.5)} cy={y}
                        r={+(2 + pct * 7.5).toFixed(1)}
                        fill={mix('#e2e8f0', pal(ti, palKey), Math.min(1, m / 2.9))}
                        stroke={own ? pal(ti, palKey) : 'none'} strokeWidth={own ? 0.8 : 0}
                        opacity=".95">
                        <title>{g} in {t.name} — {(pct * 100).toFixed(0)}% of cells</title>
                      </circle>
                    )
                  })}
                </g>
              )
            })}
          </svg>
          <div className="legend mt-2.5">
            <span>dot size = % of cells detecting the gene</span>
            <span>colour = mean expression within the cluster</span>
          </div>
        </div>

        <div className="mt-[18px] pt-3.5" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="eyebrow mb-2.5">Cluster names</div>
          <div className="flex flex-wrap gap-2">
            {types.map((t, i) => (
              <label key={t.key} className="flex items-center gap-1.5">
                <i className="sw" style={{ background: pal(i, palKey) }} />
                <input
                  className="inp w-[132px] text-[12.5px]" defaultValue={t.name}
                  aria-label={`Rename cluster ${t.key}`}
                  onBlur={e => onRename(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
            Results stay attached to the original cluster, so renaming never detaches a run you
            have already done.
          </p>
        </div>
      </Card>
    </>
  )
}
