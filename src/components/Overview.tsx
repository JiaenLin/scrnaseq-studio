import type { CellType, Dataset } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { useMemo } from 'react'
import { cellColumns } from '../lib/bundle.ts'
import { groupOptions, typeOptions } from '../lib/roles.ts'
import { axisRange, cellsBySample, fmt, quantiles, density, minOf, maxOf , hasSignal } from '../lib/chart.ts'
import { axisTicks } from '../lib/labels.ts'
import { MIN_REPS_PB, minReplicates } from '../lib/stats.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import { countText, populations, sentinelCount } from '../lib/sentinels.ts'
import {
  OWN_BADGE, countsRow, embeddingRow, factRow, geneRow, integrationRow, notCalledRow, pseudobulkNote, qcWords,
  undrawnOf, type FactRow,
} from '../lib/facts.ts'
import RunCard from './RunCard.tsx'
import { Card, Parts, Stat } from './Ui.tsx'

export default function Overview({ src, types, palKey, roles, onRoles }: {
  src: Source
  types: CellType[]
  palKey: PaletteKey
  /** Which carried column is standing in for each role. -1 is the object's own. */
  roles: { t: number; g: number }
  onRoles: (next: { t: number; g: number }) => void
}) {
  const d = src.d
  const meta = src.meta
  const nRep = minReplicates(src)
  // The annotator's uncalled cells, when the file lists any: counted, and the
  // count of clusters is of cell types only.
  const uncalled = sentinelCount(d.cells, types)
  const keys = src.embeddings.map(e => e.key)
  // Every line is built in lib/facts.ts, in the words of its source kind: what
  // the bundle gives a place for is badged as read from the file, and nothing else is.
  // Every embedding is listed, not just the one it opens on: the switcher only
  // appears over a figure, so this is where a reader finds out there are more.
  const rows = [
    factRow('normalization', meta),
    factRow('cell_type_column', meta),
    uncalled.total > 0
      ? notCalledRow(meta, countText(uncalled), uncalled.total, undrawnOf(src.embeddings[0]?.xy, d.cells, types), keys[0] ?? meta.embedding)
      : null,
    integrationRow(meta, keys),
    embeddingRow(meta, keys),
    geneRow(meta, src.names),
    factRow('expression', meta),
    countsRow(meta, src.pseudobulk ? src.pseudobulk.columns.length : null),
    factRow('doublets', meta),
    factRow('ambient', meta),
    { key: 'de', kind: 'here', label: 'Differential expression', badge: OWN_BADGE.here, cls: 'here',
      body: ['Wilcoxon rank-sum across cells, computed in this browser'] },
    // A fact about how the file is stored, not something to act on. The object
    // described above is the whole object either way: same cells, same genes,
    // same every tab.
    src.nParts > 1
      ? { key: 'storage', kind: 'held', label: 'Storage', badge: OWN_BADGE.held, cls: 'here',
          body: [`larger than one bundle, so it is held in ${src.nParts} parts inside this file; `
            + 'gene values are read out of it as each view asks for them'] }
      : null,
  ].filter((r): r is FactRow => r !== null)
  const pb = pseudobulkNote(meta, nRep, src.pseudobulk !== null)
  const hasMito = hasSignal(d.cells, c => c.mito)
  const qc = qcWords(meta, hasMito)

  return (
    <>
      <Card eyebrow="Object" title="What is in this object">
        <div
          // A hairline grid, not a box: a rule above and below, hairlines between.
          className="stats mt-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}
        >
          <Stat value={fmt(d.nCells)} label="cells" />
          <Stat value={fmt(src.genes.length)} label="genes" />
          <Stat value={d.samples.length} label={d.samples.length === 1 ? 'sample' : 'samples'} />
          <Stat value={d.conds.length} label={d.conds.length > 1 ? 'groups' : 'group'} />
          <Stat value={populations(types).length} label={populations(types).length === 1 ? 'cell type' : 'cell types'} />
          <Stat value={nRep} label="fewest samples per group" />
        </div>

        {/* Inside the card that states the design, not floating between two of
            them. A note is content, and content lives on a surface — three of
            these were the only things in the app rendered on the page ground. */}
        <div className={`note mt-4 ${nRep >= MIN_REPS_PB ? 'note-info' : ''}`} data-fact="pseudobulk">
          {nRep >= MIN_REPS_PB ? (
            // Not "both tests": the pseudobulk path sums counts and hands them
            // over, and the test is run wherever they are taken. And only where
            // there are counts to sum: lib/facts.ts says which sentence is true.
            <><b>{pb.head}</b> {pb.rest}</>
          ) : d.multi ? (
            <><b>{nRep} sample per group, so Wilcoxon is the only test</b>, the normal case in
            single-cell. Its p-values describe variation between cells, not between samples.</>
          ) : (
            <><b>One group, so there is no comparison to run.</b> Markers and gene search
            work normally.</>
          )}
        </div>
      </Card>

      <RoleCard src={src} roles={roles} onRoles={onRoles} />

      <Card
        eyebrow="Provenance" title="Where every number comes from"
        sub="Each line says where it comes from: the object, the conversion, this app, or no stated source."
      >
        <div className="scrollx mt-3">
          <table className="t">
            <tbody>
              {rows.map(r => (
                <tr key={r.key} data-fact={r.key} data-fact-kind={r.kind}>
                  <td className="whitespace-nowrap font-semibold">{r.label}</td>
                  <td style={{ width: '1%' }}>
                    <span className={`badge badge-${r.cls}`}>{r.badge}</span>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}><Parts of={r.body} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RunCard src={src} />

      {src.meta.notes.length > 0 && (
        <Card eyebrow="From the conversion" title="What the exporter had to decide"
          sub="Written when the bundle was made.">
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
          <QcPanel d={d} palKey={palKey} title={qc.total} get={c => c.counts}
            tick={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)} />
          <QcPanel d={d} palKey={palKey} title={qc.genes} get={c => c.genes}
            tick={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)} />
          {/* Same rule as the Cells tab: the QC block is always written, so an
              object with no mitochondrial genes annotated would draw a flat
              violin at zero under a real-looking title. */}
          {hasMito && (
            <QcPanel d={d} palKey={palKey} title={qc.mito} get={c => c.mito}
              tick={v => v.toFixed(1)} />
          )}
        </div>
        {/* What each panel was read from, in the words of its source kind: a
            total is "counts" only when the bundle says it was summed from counts. */}
        <p className="mono mt-2.5 tx-micro" style={{ color: 'var(--ink-3)' }} data-fact="qc">
          <Parts of={qc.line} />
        </p>
        <p className="mono mt-1 tx-micro" style={{ color: 'var(--ink-3)' }}>
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
  const W = 330, PLOT = 144, PL = 46, PT = 16, PR = 8
  const per = cellsBySample(d).map(idx => idx.map(i => get(d.cells[i])))
  const all = per.flat()
  // None of these covariates can be negative, so the axis must not imply it can.
  const { y0, y1 } = axisRange(minOf(all), maxOf(all), { fromZero: true })
  const bw = (W - PL - PR) / d.samples.length

  /**
   * Sample ids, laid out on what they measure rather than on a fixed 30 units.
   *
   * The demo objects carry ids like "1" and "2" and four of them, so upright
   * and centred was right and stayed unquestioned. A real GEO series carries
   * "GSM4116579_P7_rep1" and twelve of them: at twelve samples each label gets
   * 23 units of band and needs 110, which is not a near miss — it is every
   * label written over both of its neighbours, 54 overlapping pairs per panel.
   */
  const labels = d.samples.map(s => s.id.replace(/^(SVZ|TC)_/, ''))
  const ax = axisTicks(labels, {
    band: bw, leftAnchor: PL + bw / 2, gap: 3, upright: 30,
  })
  // The box grows to the labels; the labels are never cut to the box. A GEO
  // series carries ids like "GSM4116579_P7_rep1" and a panel that shows
  // "GSM4116579_P7…" has told the reader nothing they can act on.
  const PB = ax.bottom
  const H = PT + PLOT + PB
  const Y = (v: number) => PT + PLOT * (1 - (v - y0) / (y1 - y0))

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
              {ax.rotate ? (
                <text className="axis" transform={`rotate(${-ax.deg} ${cx} ${H - PB + 12})`}
                  x={cx} y={H - PB + 12} textAnchor="end">
                  {ax.shown[i]}<title>{d.samples[i].id}</title>
                </text>
              ) : (
                <text className="axis" x={cx} y={H - PB + 13} textAnchor="middle">
                  {ax.shown[i]}<title>{d.samples[i].id}</title>
                </text>
              )}
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </figure>
  )
}

/**
 * Which carried column counts as the cell type, and which as the group.
 *
 * Here and nowhere else. It reads as a structural fact about the object rather
 * than a per-figure control, and a copy of it over every tab would invite
 * changing it mid-analysis — which resets the contrast, the ordering and any
 * renaming, because those are all said in the vocabulary being replaced.
 *
 * Only shown when the object actually carries an alternative. A bundle written
 * without extra columns has one answer to each question, and a menu with one
 * option is furniture.
 */
function RoleCard({ src, roles, onRoles }: {
  src: Source
  roles: { t: number; g: number }
  onRoles: (next: { t: number; g: number }) => void
}) {
  const d = src.d
  const cols = cellColumns(d)
  // groupable() is a pass over every cell per column, so it is asked once for
  // the whole card rather than once per render of a menu.
  const tOpts = useMemo(() => typeOptions(d, 'cell type from the file'), [d])
  const gOpts = useMemo(() => groupOptions(d, cols.cond ?? 'group from the file'), [d, cols.cond])
  const excluded = cols.extras.length - (gOpts.length - 1)

  if (!src.rebind || cols.extras.length === 0) return null

  return (
    <Card
      eyebrow="Columns" title="The cell type and group columns"
      sub="Every column you ticked in the lab is in the bundle, so these can be re-pointed without converting again."
    >
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="glabel">Cell type</span>
          <select className="sel" style={{ minWidth: 200 }} value={roles.t}
            onChange={e => onRoles({ ...roles, t: Number(e.target.value) })}>
            {tOpts.map(o => (
              <option key={o.at} value={o.at}>
                {o.key}{o.levels ? `: ${o.levels} levels` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="glabel">Group</span>
          <select className="sel" style={{ minWidth: 200 }} value={roles.g}
            onChange={e => onRoles({ ...roles, g: Number(e.target.value) })}>
            {gOpts.map(o => (
              <option key={o.at} value={o.at}>{o.key}: {o.levels} levels</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 tx-micro" style={{ color: 'var(--ink-3)' }}>
        Changing either clears the contrast, the group order and any renaming.
        {excluded > 0 && (
          <> {excluded} other column{excluded === 1 ? ' is' : 's are'} not offered as a group:
            {' '}a group must be the same for every cell of a sample.</>
        )}
        {roles.t >= 0 && src.pseudobulk !== null && (
          <> Pseudobulk counts follow the lab&rsquo;s cell types and are not offered under another column.</>
        )}
      </p>
    </Card>
  )
}
