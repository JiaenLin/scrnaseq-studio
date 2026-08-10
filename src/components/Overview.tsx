import type { CellType, Dataset } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { axisRange, cellsBySample, fmt, quantiles, density, minOf, maxOf , hasSignal } from '../lib/chart.ts'
import { MIN_REPS_PB, minReplicates } from '../lib/stats.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import { Card, Stat } from './Ui.tsx'

type Kind = 'file' | 'here' | 'none'

/**
 * What the rows of the matrix are called, and where the names came from.
 *
 * Worth a line of its own because on an accession-indexed object the studio
 * SHOWS something other than what the file's gene index holds. That is the right
 * thing to show, and it is also exactly the kind of substitution a provenance
 * table exists to declare rather than perform quietly.
 */
function geneNaming(src: Source): string {
  const n = src.names
  if (!n.renamed) {
    return n.idKind
      ? `${n.idKind}s, as the object stores them`
      : 'as the object stores them'
  }
  const extra = [
    n.duplicated ? `${n.duplicated} rows share a symbol and carry their ${n.idKind ?? 'accession'} `
      + 'in the name, because they are separate genes and were not summed' : '',
    n.missing ? `${n.missing} rows have no symbol and keep their ${n.idKind ?? 'accession'}` : '',
  ].filter(Boolean)
  return `matrix indexed by ${n.idKind ?? 'accession'}s; symbols shown, taken from `
    + `${n.aliasColumn ?? 'the object'} in the same file — nothing is looked up`
    + (extra.length ? `. ${extra.join('; ')}` : '')
}

export default function Overview({ src, types, palKey }: {
  src: Source
  types: CellType[]
  palKey: PaletteKey
}) {
  const d = src.d
  const nRep = minReplicates(src)
  const prov = src.meta.provenance
  const rows: [string, Kind, React.ReactNode][] = [
    ['Normalization', prov.normalization ? 'file' : 'none', prov.normalization ?? 'not recorded'],
    ['Clustering', prov.clustering ? 'file' : 'none', prov.clustering ?? 'not recorded'],
    ['Batch integration', prov.integration ? 'file' : 'none', prov.integration ?? 'none recorded'],
    // Every embedding the object carried, not just the one it opens on — the
    // switcher only appears over a figure, so this is where a user finds out
    // there is more than one before going looking for it.
    ['Embedding', 'file', src.embeddings.length > 1
      ? `${src.embeddings.map(e => e.key).join(', ')} — ${src.embeddings[0].key} opens by default, `
        + 'and any of them can be chosen wherever cells are drawn'
      : src.meta.embedding],
    ['Gene identifiers', 'file', geneNaming(src)],
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
          className="mt-3 grid gap-px overflow-hidden rounded-[--r-md]"
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

        {/* Inside the card that states the design, not floating between two of
            them. A note is content, and content lives on a surface — three of
            these were the only things in the app rendered on the page ground. */}
        <div className={`note mt-4 ${nRep >= MIN_REPS_PB ? 'note-info' : ''}`}>
          {nRep >= MIN_REPS_PB ? (
            <><b>Both tests are available.</b> Wilcoxon across cells by default; with {nRep} samples
            a group, pseudobulk DESeq2 tests between animals instead.</>
          ) : d.multi ? (
            <><b>{nRep} sample per group, so Wilcoxon is the only test</b> — the normal case in
            single-cell. Its p-values describe variation between cells, not between animals.</>
          ) : (
            <><b>One condition, so there is no comparison to run.</b> Markers and gene search
            work normally.</>
          )}
        </div>
      </Card>

      <Card
        eyebrow="Provenance" title="Where every number comes from"
        sub="Read from the object. Anything computed here is labelled as such."
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
          sub="Recorded when the bundle was made.">
          <ul className="mt-3 list-disc pl-5 tx-small leading-relaxed"
            style={{ color: 'var(--ink-2)' }}>
            {src.meta.notes.map((nte, i) => <li key={i} className="mb-1">{nte}</li>)}
          </ul>
        </Card>
      )}

      {/* The "Figure style" card was here. Palette and expression ramp are
          global — they repaint every figure in the studio — so they now live in
          the control bar, under "Figure style", where they can be changed
          beside the figure they change rather than one tab away from it. */}

      <Card
        eyebrow="Quality control" title="Three covariates, read together, per sample"
        sub="Per sample, and after the filtering your pipeline applied."
      >
        <div className="mt-3.5 flex flex-wrap gap-3.5">
          <QcPanel d={d} palKey={palKey} title="Total counts" get={c => c.counts}
            tick={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)} />
          <QcPanel d={d} palKey={palKey} title="Genes detected" get={c => c.genes}
            tick={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)} />
          {/* Same rule as the Cells tab: the QC block is always written, so an
              object with no mitochondrial genes annotated would draw a flat
              violin at zero under a real-looking title. */}
          {hasSignal(d.cells, c => c.mito) && (
            <QcPanel d={d} palKey={palKey} title="Mitochondrial %" get={c => c.mito}
              tick={v => v.toFixed(1)} />
          )}
        </div>
        <p className="mono mt-2.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
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
  const per = cellsBySample(d).map(idx => idx.map(i => get(d.cells[i])))
  const all = per.flat()
  // None of these covariates can be negative, so the axis must not imply it can.
  const { y0, y1 } = axisRange(minOf(all), maxOf(all), { fromZero: true })
  const Y = (v: number) => PT + (H - PT - PB) * (1 - (v - y0) / (y1 - y0))
  const bw = (W - PL - PR) / d.samples.length

  return (
    <figure className="min-w-[280px] flex-1 basis-[300px]">
      <div className="mb-0.5 tx-small font-semibold">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${title} per sample`}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const t = y0 + (y1 - y0) * f
          return (
            <g key={f}>
              <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
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
