import type { CellType, Dataset } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { fmt, quantiles, density } from '../lib/chart.ts'
import { MIN_REPS_PB, minReplicates } from '../lib/stats.ts'
import { pal, PALETTES, RAMPS, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { Card, Mono, Stat } from './Ui.tsx'

type Kind = 'file' | 'here' | 'none'

export default function Overview({ src, types, palKey, rampKey, onPal, onRamp }: {
  src: Source
  types: CellType[]
  palKey: PaletteKey
  rampKey: RampKey
  onPal: (k: PaletteKey) => void
  onRamp: (k: RampKey) => void
}) {
  const d = src.d
  const nRep = minReplicates(src)
  const prov = src.meta.provenance
  const rows: [string, Kind, React.ReactNode][] = [
    ['Normalization', prov.normalization ? 'file' : 'none', prov.normalization ?? 'not recorded'],
    ['Clustering', prov.clustering ? 'file' : 'none', prov.clustering ?? 'not recorded'],
    ['Batch integration', prov.integration ? 'file' : 'none', prov.integration ?? 'none recorded'],
    ['Embedding', 'file', src.meta.embedding],
    ['Expression', 'file', src.meta.expression],
    ['Raw counts', src.meta.hasRawCounts ? 'file' : 'none',
      src.meta.hasRawCounts ? 'present — pseudobulk columns are in the bundle' : 'absent'],
    ['Doublet calls', prov.doublets ? 'file' : 'none', prov.doublets ?? 'no doublet column found'],
    ['Ambient RNA', prov.ambient ? 'file' : 'none', prov.ambient ?? 'no SoupX / CellBender / DecontX record'],
    ['Differential expression', 'here',
      'Wilcoxon rank-sum across cells, computed in this browser'],
  ]
  // A fact about how the file is stored, not something to act on. The object
  // described above is the whole object either way — same cells, same genes,
  // same every tab.
  if (src.nParts > 1) {
    rows.push(['Storage', 'file',
      `larger than one bundle, so it is held in ${src.nParts} parts inside this file; `
      + 'gene values are read out of it as each view asks for them'])
  }

  return (
    <>
      <Card eyebrow="Dataset" title="What is in this object">
        <div
          className="mt-3 grid gap-px overflow-hidden rounded-xl"
          style={{ background: 'var(--line)', border: '1px solid var(--line)',
                   gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}
        >
          <Stat value={fmt(d.nCells)} label="cells" />
          <Stat value={fmt(src.genes.length)} label="genes" />
          <Stat value={d.samples.length} label="samples" />
          <Stat value={d.conds.length} label={d.conds.length > 1 ? 'groups' : 'group'} />
          <Stat value={types.length} label="clusters" />
          <Stat value={nRep} label="min replicates" />
        </div>
      </Card>

      <div className={`note mb-4 ${nRep >= MIN_REPS_PB ? 'note-info' : ''}`}>
        {nRep >= MIN_REPS_PB ? (
          <><b>Both tests are available for this object.</b> The default is a Wilcoxon rank-sum
          test across cells, as in Seurat&rsquo;s <Mono>FindMarkers</Mono>. With {nRep} samples per
          group you can also run pseudobulk DESeq2, which tests between animals instead of between
          cells — far fewer genes, but each survives the between-animal variance.</>
        ) : d.multi ? (
          <><b>{nRep} sample per group, so Wilcoxon is the only test available — and nothing is
          blocked.</b> That is the normal situation in single-cell work. Bear in mind the p-values
          describe variation between <em>cells</em>, not between animals, so they are not evidence
          that the effect would repeat in a new mouse.</>
        ) : (
          <><b>One condition, so there is no differential expression to run.</b> Cluster markers and
          gene search work normally; the contrast tabs stay empty rather than inventing a comparison.</>
        )}
      </div>

      <Card
        eyebrow="Provenance" title="Where every number comes from"
        sub="Read from the object, not assumed. Anything this studio computes is labelled as such."
      >
        <div className="scrollx mt-3">
          <table className="t">
            <tbody>
              {rows.map(([k, kind, body]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap font-semibold">{k}</td>
                  <td style={{ width: '1%' }}>
                    <span className={`badge badge-${kind}`}>
                      {kind === 'file' ? 'from your file' : kind === 'here' ? 'computed here' : 'not found'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {src.meta.notes.length > 0 && (
        <Card eyebrow="From the conversion" title="What the exporter had to decide"
          sub="Recorded when the bundle was made, so the person reading the figures sees what the person who converted the object saw.">
          <ul className="mt-3 list-disc pl-5 text-[12.5px] leading-relaxed"
            style={{ color: 'var(--ink-2)' }}>
            {src.meta.notes.map((nte, i) => <li key={i} className="mb-1">{nte}</li>)}
          </ul>
        </Card>
      )}

      <Card
        eyebrow="Figure style" title="Match the journal you are submitting to"
        sub="Applies to every figure in the studio at once, so an exported panel already matches the rest of the manuscript instead of being recoloured by hand afterwards."
      >
        <div className="mt-3.5 flex flex-wrap items-center gap-[18px]">
          <label className="flex items-center gap-1.5">
            <span className="glabel">Clusters</span>
            <select
              className="sel" value={palKey} aria-label="Cluster palette"
              onChange={e => onPal(e.target.value as PaletteKey)}
            >
              {Object.entries(PALETTES).map(([k, p]) =>
                <option key={k} value={k}>{p.label}</option>)}
            </select>
            <span className="ml-1 inline-flex gap-0.5">
              {PALETTES[palKey].cols.map(c => (
                <i key={c} className="sw" style={{ background: c, width: 13, height: 13, borderRadius: 3 }} />
              ))}
            </span>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="glabel">Expression</span>
            <select
              className="sel" value={rampKey} aria-label="Expression ramp"
              onChange={e => onRamp(e.target.value as RampKey)}
            >
              {Object.entries(RAMPS).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
            <span
              className="ml-1 inline-block h-[13px] w-[104px] rounded-[3px]"
              style={{ background: rampCss(rampKey) }}
            />
          </label>
        </div>
        <p className="mt-[11px] text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          <b>viridis</b> and <b>magma</b> are perceptually uniform and safe for colour-vision
          deficiency, which is why they have largely replaced rainbow scales in the journals.
          The categorical sets are the ones the journals&rsquo; own figures use.
        </p>
      </Card>

      <Card
        eyebrow="Quality control" title="Three covariates, read together, per sample"
        sub={<>Thresholds vary substantially between samples, so QC is shown per sample rather than
          pooled. These distributions are what remains <em>after</em> the filtering your pipeline
          applied.</>}
      >
        <div className="mt-3.5 flex flex-wrap gap-3.5">
          <QcPanel d={d} palKey={palKey} title="Total counts" get={c => c.counts}
            tick={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)} />
          <QcPanel d={d} palKey={palKey} title="Genes detected" get={c => c.genes}
            tick={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)} />
          <QcPanel d={d} palKey={palKey} title="Mitochondrial %" get={c => c.mito}
            tick={v => v.toFixed(1)} />
        </div>
        <p className="mono mt-2.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          box = median and IQR · violin = density · n = {fmt(d.nCells)} cells
        </p>
      </Card>
    </>
  )
}

function QcPanel({ d, title, get, tick, palKey }: {
  d: Dataset
  title: string
  get: (c: Dataset['cells'][number]) => number
  tick: (v: number) => string
  palKey: PaletteKey
}) {
  const W = 330, H = 190, PL = 46, PB = 30, PT = 16, PR = 8
  const per = d.samples.map(s => d.cells.filter(c => c.s === s.id).map(get))
  const all = per.flat()
  const lo = Math.min(...all), hi = Math.max(...all)
  const pad = (hi - lo) * 0.04
  // None of these covariates can be negative, so the axis must not imply it can.
  const y0 = Math.max(0, lo - pad), y1 = hi + pad
  const Y = (v: number) => PT + (H - PT - PB) * (1 - (v - y0) / (y1 - y0))
  const bw = (W - PL - PR) / d.samples.length

  return (
    <figure className="min-w-[280px] flex-1 basis-[300px]">
      <div className="mb-0.5 text-xs font-semibold">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${title} per sample`}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const t = y0 + (y1 - y0) * f
          return (
            <g key={f}>
              <line className="axline" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} opacity=".45" />
              <text className="axis" x={PL - 6} y={Y(t) + 3.5} textAnchor="end">{tick(t)}</text>
            </g>
          )
        })}
        {per.map((vals, i) => {
          const cx = PL + bw * (i + 0.5)
          const q = quantiles(vals)
          const dens = density(vals, y0, y1)
          const half = bw * 0.4
          const pts = [
            ...dens.map((v, k) => `${(cx + v * half).toFixed(1)},${Y(y0 + (y1 - y0) * k / 26).toFixed(1)}`),
            ...dens.map((v, k) => `${(cx - v * half).toFixed(1)},${Y(y0 + (y1 - y0) * k / 26).toFixed(1)}`).reverse(),
          ].join(' ')
          const col = pal(d.conds.indexOf(d.samples[i].cond), palKey)
          return (
            <g key={d.samples[i].id}>
              <polygon points={pts} fill={col} opacity=".22" />
              <line x1={cx} x2={cx} y1={Y(q.min)} y2={Y(q.max)} stroke={col} opacity=".55" />
              <rect x={cx - 4.5} y={Y(q.q3)} width={9} height={Math.max(1, Y(q.q1) - Y(q.q3))}
                fill={col} opacity=".85" rx={1.5} />
              <line x1={cx - 5.5} x2={cx + 5.5} y1={Y(q.med)} y2={Y(q.med)}
                stroke="var(--surface)" strokeWidth={1.6} />
              <text className="axis" x={cx} y={H - PB + 13} textAnchor="middle">
                {d.samples[i].id.replace(/^(SVZ|TC)_/, '')}
              </text>
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </figure>
  )
}
