import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellType, Dataset, GroupBy } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { axisRange, clusterCentroids, density, embedExtent, identities, quantiles, minOf, maxOf } from '../lib/chart.ts'
import { GENE_SETS } from '../lib/genesets.ts'
import { parseGeneList } from '../lib/genes.ts'
import {
  averagesSpec, geneAveragesSync, resolve, SCORE_DEFAULTS, scoreInline, scorePlan, summarise,
} from '../lib/score.ts'
import { drawColorBar } from '../lib/feature-plot.ts'
import { rampColor, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { Card, Mono, Seg } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'
import { useJob } from '../lib/compute.ts'
import Progress from './Progress.tsx'

/**
 * The card between deciding to compute and the first word back from the worker.
 *
 * A zero total is what Progress draws as "starting", so this needs no start
 * time — there is nothing yet to estimate from, and a guess would be the one
 * kind of progress this studio does not show.
 */
const STARTING = { phase: '', done: 0, total: 0, startedAt: 0 }

export default function GeneSets({ src, types, ct, emb, palKey, rampKey, onPickGene }: {
  src: Source
  types: CellType[]
  ct: string
  /** Which of the object's embeddings to draw the score on. */
  emb: Embedding
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
    if (!useCustom) return GENE_SETS.find(s => s.id === setId)?.genes ?? []
    // Parsed once. It was parsed twice — the whole gene list, per keystroke.
    // Either naming: on an accession-indexed object a pasted list of symbols
    // resolves, and so does a pasted list of accessions.
    const { found, missing } = parseGeneList(custom, GENES, src.names)
    return found.concat(missing)
  }, [useCustom, custom, setId, GENES, src.names])

  const { used, missing } = useMemo(() => resolve(src, requested), [src, requested])

  // A module score reads the object twice, and the two reads are different
  // questions: the expression bins belong to the OBJECT and are asked once ever,
  // the accumulation belongs to the SET. Splitting them is what makes the second
  // signature on an atlas cost one pass instead of two — the bins are already
  // remembered under a key that does not change.
  const { value: avg, pass: binPass } = useJob<'averages'>(
    src, 'averages', 'gene averages', used.length > 0,
    () => geneAveragesSync(src) ?? new Float64Array(src.genes.length),
    () => ({ kind: 'averages', ...averagesSpec(src) }),
  )

  // Which control genes, and what each gene contributes. Decided here, on the
  // page, for both paths: it is cheap (a sort of the gene list) next to a pass
  // over the matrix, and deciding it once is what stops the two paths drawing a
  // different control set and reporting different scores.
  const plan = useMemo(
    () => (avg && used.length ? scorePlan(src, used, avg, SCORE_DEFAULTS) : null),
    [src, used, avg])

  // Every cell × every weighted gene. Keyed on the genes themselves, so
  // switching back to a set already scored costs nothing, and switching away
  // mid-pass abandons it rather than letting it land on top of the new answer.
  const { value: scores, pass: scorePass } = useJob<'score'>(
    src, 'score', `score|${used.join(',')}`, plan !== null,
    () => scoreInline(src, plan!),
    // The engine takes the buffer, so it gets a copy — the plan outlives the job.
    () => ({
      kind: 'score', weight: plan!.weight.slice(),
      nCells: d.cells.length, nGenes: src.genes.length,
    }),
  )
  const pass = binPass ?? scorePass
  const empty = useMemo(() => new Float32Array(d.cells.length), [d.cells.length])
  const scoreOf = scores ?? empty

  // An object read off disk has no answer in its first frame, and drawing the
  // figures from an all-zero array for that frame would show a flat embedding
  // that is not a result. So the card waits from the moment it knows it must,
  // which is before the pass has reported anything.
  const waiting = src.remote !== null && used.length > 0 && scores === null

  const name = useCustom
    ? `Custom set (${used.length} gene${used.length === 1 ? '' : 's'})`
    : GENE_SETS.find(s => s.id === setId)?.name ?? ''

  const ids = useMemo(
    () => identities(d, types, groupBy, ct, palKey), [d, types, groupBy, ct, palKey])
  const perId = useCellsByIdentity(d, ids, types.length, groupBy)
  // Not while the pass is running: the table it feeds is not on screen, and
  // summarising 292 495 zeroes to draw nothing is work the user waits through.
  const stats = useMemo(
    () => (waiting ? [] : perId.map(idx => summarise(scoreOf, idx))), [waiting, perId, scoreOf])
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
          {`${used.length} of ${requested.length} genes found in this object`}
          {missing.length > 0 && (
            <> · <span style={{ color: 'var(--warn)' }}>not measured:{' '}
              <span className="mono">{missing.slice(0, 8).join(', ')}
                {missing.length > 8 ? ` +${missing.length - 8}` : ''}</span></span></>
          )}
          {' '}· {SCORE_DEFAULTS.ctrl} control genes per set gene, drawn from{' '}
          {SCORE_DEFAULTS.nbin} expression bins
        </p>

        {waiting ? (
          <Progress pass={pass ?? STARTING} title={useCustom
            ? `Scoring ${requested.length} gene${requested.length === 1 ? '' : 's'} across every cell`
            : `Scoring ${name} across every cell`} />
        ) : used.length === 0 ? (
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
                  <ScoreMap d={d} types={types} xy={emb.xy} scores={scoreOf} rampKey={rampKey} />
                </Figure>
              </figure>

              <div className="min-w-[260px] flex-1">
                <div className="eyebrow mb-2">Score by identity</div>
                <div className="scrollx" style={{ maxHeight: 330 }}>
                  <table className="t">
                    <thead><tr><th>Identity</th><th>Cells</th><th>Median</th><th>Mean</th></tr></thead>
                    <tbody>
                      {ids.map((id, k) => {
                        const s = stats[k]
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
                    ids.map((id, k) => {
                      const st = stats[k]
                      return [id.full, st.n, st.med.toFixed(4), st.mean.toFixed(4),
                        st.q1.toFixed(4), st.q3.toFixed(4)]
                    }))} />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="eyebrow mb-2">Genes in this set</div>
              <div className="flex flex-wrap gap-1.5">
                {used.map(g => (
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
              <ScoreViolins scores={scoreOf} ids={ids} perId={perId} groupBy={groupBy} />
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

/**
 * Which cells belong to each row of the identity axis, in ONE pass.
 *
 * The obvious way to write this is a filter of every cell per identity, and it
 * was written that way. On the atlas that is 133 identities × 292 495 cells =
 * 38.9 million property reads, twice per render, on the main thread — the
 * figures took seconds to appear after a score that had cost nothing extra to
 * compute. One pass with a lookup gives the same lists, in the same order, for
 * 292 495 reads.
 */
function useCellsByIdentity(
  d: Dataset, ids: ReturnType<typeof identities>, nTypes: number, groupBy: GroupBy,
): number[][] {
  return useMemo(() => {
    const nC = d.conds.length
    const condAt = new Map(d.conds.map((c, i) => [c, i]))
    // Across cell types the group is ignored, so the key is the cluster alone;
    // otherwise it is the (cluster, group) pair flattened into one number.
    const width = groupBy === 'type' ? 1 : nC
    const slot = new Int32Array(nTypes * width).fill(-1)
    ids.forEach((id, k) => {
      const s = id.ti * width + (groupBy === 'type' ? 0 : condAt.get(id.cond) ?? -1)
      if (id.ti >= 0 && id.ti < nTypes && s >= 0 && s < slot.length) slot[s] = k
    })
    const out: number[][] = ids.map(() => [])
    for (let i = 0; i < d.cells.length; i++) {
      const c = d.cells[i]
      if (c.t < 0 || c.t >= nTypes) continue
      const ci = groupBy === 'type' ? 0 : condAt.get(c.cond) ?? -1
      if (ci < 0) continue
      const k = slot[c.t * width + ci]
      if (k >= 0) out[k].push(i)
    }
    return out
  }, [d, ids, nTypes, groupBy])
}

function ScoreMap({ d, types, xy, scores, rampKey }: {
  d: Dataset; types: CellType[]; xy: Float32Array; scores: Float32Array; rampKey: RampKey
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
    const { x0, x1, y0, y1 } = embedExtent(xy)
    // The embedding keeps the square; the bar strip is added below it, never
    // taken out of it. Scaling the cells to the full canvas would stretch every
    // map vertically by the height of its own legend.
    const plotH = cv.width

    // Typed throughout. `Array.from(scores)` boxed 292 495 doubles into a JS
    // array before sorting them, and the copy cost more than the sort.
    const sorted = scores.slice().sort()
    const lo = sorted[Math.floor(sorted.length * 0.01)]
    const hi = sorted[Math.floor(sorted.length * 0.99)]
    const span = hi - lo || 1

    // Same ordering rule as the feature plot: high cells last, so a small
    // positive population is not buried under the negative majority.
    const idx = new Int32Array(d.nCells)
    for (let i = 0; i < idx.length; i++) idx[i] = i
    idx.sort((a, b) => scores[a] - scores[b])
    for (const i of idx) {
      g.fillStyle = rampColor((scores[i] - lo) / span, rampKey)
      g.beginPath()
      g.arc(((xy[2 * i] - x0) / (x1 - x0)) * cv.width,
        (1 - (xy[2 * i + 1] - y0) / (y1 - y0)) * plotH, 1.9, 0, 6.284)
      g.fill()
    }
    g.font = '600 17px system-ui'
    g.textAlign = 'center'
    g.lineWidth = 3.5
    g.strokeStyle = 'rgba(255,255,255,.9)'
    const at = clusterCentroids(xy, d, types.length)
    types.forEach((t, ti) => {
      const X = ((at[ti].x - x0) / (x1 - x0)) * cv.width
      const Y = (1 - (at[ti].y - y0) / (y1 - y0)) * plotH
      g.strokeText(t.name, X, Y)
      g.fillStyle = '#334155'
      g.fillText(t.name, X, Y)
    })

    // The scale, on the figure. It was an HTML strip beside the canvas, so an
    // exported score map had colours and no way to read them — and this one is
    // worse than a feature plot, because a module score has no natural units
    // and the numbers at the ends are the only thing that anchors it.
    const unit = cv.width / 640
    const barW = Math.min(cv.width * 0.55, 170 * unit)
    drawColorBar(g, {
      x: (cv.width - barW) / 2, y: cv.height - BAR_U * unit + 16 * unit,
      w: barW, h: 9 * unit,
      ramp: rampKey, lo, hi, ink: '#000000',
      label: 'Module score', unit,
    })
  }, [d, types, xy, scores, rampKey])

  return (
    <canvas ref={ref} width={size * 2} height={size * 2 + Math.round(BAR_U * (size * 2) / 640)}
      style={{ width: '100%', maxWidth: size, height: 'auto', borderRadius: 10 }} />
  )
}

/** Height of the colour-bar strip, in the same 640-wide units as the drawing. */
const BAR_U = 46

function ScoreViolins({ scores, ids, perId, groupBy }: {
  scores: Float32Array
  ids: ReturnType<typeof identities>
  perId: number[][]
  groupBy: GroupBy
}) {
  const per = ids.length
  const W = 860, H = 280, PL = 46, PT = 14, PR = 10
  const PB = groupBy === 'both' ? 88 : 68
  const values = perId.map(idx => {
    const out = idx.map(i => scores[i])
    // Violins do not need every cell; a stride keeps the density honest and fast.
    const stride = Math.max(1, Math.floor(out.length / 400))
    return out.filter((_v, k) => k % stride === 0)
  })
  const all = values.flat()
  // A signature every cell scores identically on is rare but not impossible,
  // and it must draw a flat line rather than NaN coordinates.
  const { y0, y1 } = axisRange(minOf(all), maxOf(all))
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
              <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
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
