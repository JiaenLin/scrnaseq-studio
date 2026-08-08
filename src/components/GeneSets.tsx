import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellType, Dataset, GroupBy } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { clusterCentroids, density, embedExtent, identities, quantiles, minOf, maxOf } from '../lib/chart.ts'
import { GENE_SETS } from '../lib/genesets.ts'
import { parseGeneList } from '../lib/genes.ts'
import { moduleScore, SCORE_DEFAULTS, summarise } from '../lib/score.ts'
import { rampColor, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { Card, Mono, Seg } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'

export default function GeneSets({ src, types, ct, palKey, rampKey, onPickGene }: {
  src: Source
  types: CellType[]
  ct: string
  palKey: PaletteKey
  rampKey: RampKey
  onPickGene: (g: string) => void
}) {
  const d = src.d
  const GENES = src.genes
  const [setId, setSetId] = useState(GENE_SETS[0].id)
  const [custom, setCustom] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('type')

  const requested = useMemo(() => {
    if (useCustom) return parseGeneList(custom, GENES).found.concat(parseGeneList(custom, GENES).missing)
    return GENE_SETS.find(s => s.id === setId)?.genes ?? []
  }, [useCustom, custom, setId, GENES])

  // Every cell × every set gene — recompute only when the set or object changes.
  const score = useMemo(
    () => moduleScore(src, requested),
    [src, requested])

  const name = useCustom
    ? `Custom set (${score.used.length} gene${score.used.length === 1 ? '' : 's'})`
    : GENE_SETS.find(s => s.id === setId)?.name ?? ''

  const ids = identities(d, types, groupBy, ct, palKey)
  const modes: { k: GroupBy; label: string }[] = [
    { k: 'type', label: 'Across cell types' },
    ...(d.multi
      ? [{ k: 'cond' as const, label: 'Across groups' }, { k: 'both' as const, label: 'Cell type × group' }]
      : []),
  ]

  return (
    <>
      <Card
        eyebrow="Gene sets" title="Module score, per cell"
        sub={<>Seurat&rsquo;s <Mono>AddModuleScore</Mono> / Scanpy&rsquo;s <Mono>score_genes</Mono>:
          the mean of the set minus the mean of a control set matched on expression level. The
          subtraction is what makes zero meaningful — a raw mean would just rank signatures by how
          abundant their genes happen to be.</>}
      >
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Seg<'lib' | 'own'>
            value={useCustom ? 'own' : 'lib'}
            onChange={k => setUseCustom(k === 'own')}
            options={[{ k: 'lib', label: 'Built-in set' }, { k: 'own', label: 'My own genes' }]}
          />
          {!useCustom ? (
            <select className="sel max-w-[420px]" value={setId} onChange={e => setSetId(e.target.value)}
              aria-label="Gene set">
              {GENE_SETS.map(s => (
                <option key={s.id} value={s.id}>{s.source} · {s.name}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                className="inp mono w-[380px]" value={custom} placeholder="Ascl1, Egfr, Mki67, Ccnd2…"
                aria-label="Custom gene set"
                onChange={e => setCustom(e.target.value)}
              />
              <button className="chip"
                onClick={() => setCustom(GENE_SETS[1].genes.join(', '))}>Load example</button>
              <button className="chip" onClick={() => setCustom('')}>Clear</button>
            </>
          )}
        </div>

        <p className="mt-2.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          {score.used.length} of {requested.length} genes found in this object
          {score.missing.length > 0 && (
            <> · <span style={{ color: 'var(--warn)' }}>not measured:{' '}
              <span className="mono">{score.missing.slice(0, 8).join(', ')}
                {score.missing.length > 8 ? ` +${score.missing.length - 8}` : ''}</span></span></>
          )}
          {' '}· {SCORE_DEFAULTS.ctrl} control genes per set gene, drawn from{' '}
          {SCORE_DEFAULTS.nbin} expression bins
        </p>

        {score.used.length === 0 ? (
          <div className="empty mt-4">
            {useCustom && !custom.trim()
              ? 'Paste a gene list to score.'
              : 'None of these genes are measured in this object, so there is nothing to score.'}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-start gap-5">
              <figure>
                <figcaption className="mb-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {name} on the embedding
                </figcaption>
                <Figure name={`module_score_${slug(name)}`}>
                  <ScoreMap d={d} types={types} scores={score.scores} rampKey={rampKey} />
                </Figure>
                <div className="legend mt-2">
                  <span style={{ color: 'var(--ink-3)' }}>low</span>
                  <span className="inline-block h-2.5 w-[130px] rounded-[3px]" style={{ background: rampCss(rampKey) }} />
                  <span style={{ color: 'var(--ink-3)' }}>high</span>
                  <span style={{ color: 'var(--ink-3)' }}>· clipped at the 1st and 99th percentiles</span>
                </div>
              </figure>

              <div className="min-w-[260px] flex-1">
                <div className="eyebrow mb-2">Score by identity</div>
                <div className="scrollx" style={{ maxHeight: 330 }}>
                  <table className="t">
                    <thead><tr><th>Identity</th><th>Cells</th><th>Median</th><th>Mean</th></tr></thead>
                    <tbody>
                      {ids.map(id => {
                        const idx: number[] = []
                        d.cells.forEach((c, i) => {
                          if (c.t === id.ti && (groupBy === 'type' || c.cond === id.cond)) idx.push(i)
                        })
                        const s = summarise(score.scores, idx)
                        return (
                          <tr key={id.full}>
                            <td>
                              <i className="sw mr-1.5" style={{ background: id.color }} />
                              {id.full}
                            </td>
                            <td className="num" style={{ color: 'var(--ink-2)' }}>{s.n}</td>
                            <td className="num font-semibold"
                              style={{ color: s.med > 0 ? 'var(--bad)' : 'var(--lo)' }}>
                              {s.med >= 0 ? '+' : ''}{s.med.toFixed(2)}
                            </td>
                            <td className="num" style={{ color: 'var(--ink-2)' }}>
                              {s.mean >= 0 ? '+' : ''}{s.mean.toFixed(2)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2.5 flex items-center justify-end">
                  <CsvButton onClick={() => downloadCsv(
                    `module_score_${slug(name)}`,
                    ['identity', 'cells', 'median', 'mean', 'q1', 'q3'],
                    ids.map(id => {
                      const idx: number[] = []
                      d.cells.forEach((c, i) => {
                        if (c.t === id.ti && (groupBy === 'type' || c.cond === id.cond)) idx.push(i)
                      })
                      const st = summarise(score.scores, idx)
                      return [id.full, st.n, st.med.toFixed(4), st.mean.toFixed(4),
                        st.q1.toFixed(4), st.q3.toFixed(4)]
                    }))} />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="eyebrow mb-2">Genes in this set</div>
              <div className="flex flex-wrap gap-1.5">
                {score.used.map(g => (
                  <button key={g} className="chip italic"
                    title={`Open ${g} in Gene expression`}
                    onClick={() => onPickGene(g)}>{g}</button>
                ))}
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                Click any gene to open it in <b>Gene expression</b> and see whether the score is
                carried by the whole set or by one or two members.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="glabel">Group by</span>
              <Seg<GroupBy> value={groupBy} onChange={setGroupBy} options={modes} />
            </div>
            <Figure name={`module_score_by_identity_${slug(name)}`} className="mt-1">
              <ScoreViolins d={d} scores={score.scores} ids={ids} groupBy={groupBy} />
            </Figure>
            <p className="sub mt-2.5">
              A score near zero means the set is no higher than genes of comparable abundance in
              that cell — which is why the dashed line at zero, not the lowest value, is the
              reference.
            </p>
          </>
        )}
      </Card>
    </>
  )
}

function ScoreMap({ d, types, scores, rampKey }: {
  d: Dataset; types: CellType[]; scores: Float32Array; rampKey: RampKey
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = 420

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    g.fillRect(0, 0, cv.width, cv.height)
    const { x0, x1, y0, y1 } = embedExtent(d)

    const sorted = Array.from(scores).sort((a, b) => a - b)
    const lo = sorted[Math.floor(sorted.length * 0.01)]
    const hi = sorted[Math.floor(sorted.length * 0.99)]
    const span = hi - lo || 1

    // Same ordering rule as the feature plot: high cells last, so a small
    // positive population is not buried under the negative majority.
    const idx = Array.from({ length: d.nCells }, (_, i) => i)
      .sort((a, b) => scores[a] - scores[b])
    for (const i of idx) {
      const c = d.cells[i]
      g.fillStyle = rampColor((scores[i] - lo) / span, rampKey)
      g.beginPath()
      g.arc(((c.x - x0) / (x1 - x0)) * cv.width, (1 - (c.y - y0) / (y1 - y0)) * cv.height, 1.9, 0, 6.284)
      g.fill()
    }
    g.font = '600 17px system-ui'
    g.textAlign = 'center'
    g.lineWidth = 3.5
    g.strokeStyle = 'rgba(255,255,255,.9)'
    const at = clusterCentroids(d, types.length)
    types.forEach((t, ti) => {
      const X = ((at[ti].x - x0) / (x1 - x0)) * cv.width
      const Y = (1 - (at[ti].y - y0) / (y1 - y0)) * cv.height
      g.strokeText(t.name, X, Y)
      g.fillStyle = '#334155'
      g.fillText(t.name, X, Y)
    })
  }, [d, types, scores, rampKey])

  return (
    <canvas ref={ref} width={size * 2} height={size * 2}
      style={{ width: '100%', maxWidth: size, height: 'auto', borderRadius: 10 }} />
  )
}

function ScoreViolins({ d, scores, ids, groupBy }: {
  d: Dataset
  scores: Float32Array
  ids: ReturnType<typeof identities>
  groupBy: GroupBy
}) {
  const per = ids.length
  const W = 860, H = 280, PL = 46, PT = 14, PR = 10
  const PB = groupBy === 'both' ? 88 : 68
  const values = ids.map(id => {
    const out: number[] = []
    d.cells.forEach((c, i) => {
      if (c.t === id.ti && (groupBy === 'type' || c.cond === id.cond)) out.push(scores[i])
    })
    // Violins do not need every cell; a stride keeps the density honest and fast.
    const stride = Math.max(1, Math.floor(out.length / 400))
    return out.filter((_v, k) => k % stride === 0)
  })
  const all = values.flat()
  const lo = minOf(all), hi = maxOf(all)
  const pad = (hi - lo) * 0.06
  const y0 = lo - pad, y1 = hi + pad
  const Y = (v: number) => PT + (H - PT - PB) * (1 - (v - y0) / (y1 - y0))
  const bw = (W - PL - PR) / per

  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560 }} role="img"
        aria-label="Module score by identity">
        {[0, 0.5, 1].map(f => {
          const t = y0 + (y1 - y0) * f
          return (
            <g key={f}>
              <line className="axline" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} opacity=".4" />
              <text className="axis" x={PL - 5} y={Y(t) + 3.5} textAnchor="end">{t.toFixed(2)}</text>
            </g>
          )
        })}
        {y0 < 0 && y1 > 0 && (
          <line x1={PL} x2={W - PR} y1={Y(0)} y2={Y(0)} stroke="var(--ink-3)"
            strokeDasharray="3 3" opacity=".85" />
        )}
        {ids.map((id, i) => {
          const v = values[i]
          if (!v.length) return null
          const cx = PL + bw * (i + 0.5)
          const q = quantiles(v)
          const dens = density(v, y0, y1)
          const half = bw * 0.36
          const pts = [
            ...dens.map((x, k) => `${(cx + x * half).toFixed(1)},${Y(y0 + (y1 - y0) * k / 26).toFixed(1)}`),
            ...dens.map((x, k) => `${(cx - x * half).toFixed(1)},${Y(y0 + (y1 - y0) * k / 26).toFixed(1)}`).reverse(),
          ].join(' ')
          return (
            <g key={id.full}>
              <polygon points={pts} fill={id.color} opacity=".26" />
              <line x1={cx} x2={cx} y1={Y(q.q1)} y2={Y(q.q3)} stroke={id.color}
                strokeWidth={Math.max(2, Math.min(6, bw * 0.3))} opacity=".7" />
              <line x1={cx - Math.min(9, bw * 0.4)} x2={cx + Math.min(9, bw * 0.4)}
                y1={Y(q.med)} y2={Y(q.med)} stroke={id.color} strokeWidth={2} />
              <text className="axis" transform={`rotate(-38 ${cx} ${H - PB + 12})`}
                x={cx} y={H - PB + 12} textAnchor="end"
                style={{ fontSize: per > 12 ? 9 : 10 }}>
                {groupBy === 'both' ? id.full : id.label}
              </text>
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </div>
  )
}
