import type { CellType, Dataset, DERow, Method } from '../types.ts'
import { fmt, sci } from '../lib/chart.ts'
import {
  deWilcox, dePseudobulk, designFor, isSig, LFC_GATE, MIN_CELLS, MIN_REPS_PB,
  PCT_GATE, runDE, sigCount, thresholdFor,
} from '../lib/stats.ts'
import { Card, Empty, Mono, Seg } from './Ui.tsx'

export interface StatsProps {
  d: Dataset
  t: CellType
  ti: number
  ctrl: string
  cs: string
  method: Method
  computed: boolean
  onMethod: (m: Method) => void
  onRun: () => void
  running: boolean
}

const label = (p: StatsProps) => `${p.cs} vs ${p.ctrl} · ${p.t.name}`

/** The test picker, above every contrast tab. */
function MethodBar(p: StatsProps) {
  const d = designFor(p.d, p.ti, p.ctrl, p.cs)
  const why = !d.pbOK && p.ctrl !== p.cs
    ? `Pseudobulk needs more than ${MIN_REPS_PB - 1} samples per group; ${p.t.name} has ${d.n0} and ${d.n1}.`
    : ''
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span className="glabel">Test</span>
          <Seg<Method>
            value={p.method}
            onChange={p.onMethod}
            disabled={k => k === 'pseudobulk' && !d.pbOK}
            options={[
              { k: 'wilcox', label: 'Wilcoxon · per cell' },
              { k: 'pseudobulk', label: 'Pseudobulk · DESeq2', title: why },
            ]}
          />
        </div>
        <span className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          {p.method === 'wilcox'
            ? `logfc.threshold ${LFC_GATE} · min.pct ${PCT_GATE} · Bonferroni`
            : `≥ ${MIN_CELLS} cells per sample · apeglm · Benjamini–Hochberg`}
        </span>
      </div>
      {why && (
        <p className="mb-3 mt-[-2px] text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          {why} Wilcoxon needs no replicates and is what Seurat and Scanpy run by default.
        </p>
      )}
    </>
  )
}

/**
 * Results, or the reason there are none — never a substitute number.
 * Returns `null` when there is something to show.
 */
function gate(p: StatsProps): React.ReactNode {
  if (p.ctrl === p.cs)
    return <Empty title="Pick two different groups">
      Control and comparison are both set to <b>{p.ctrl}</b>.
    </Empty>

  const d = designFor(p.d, p.ti, p.ctrl, p.cs)

  if (p.method === 'wilcox') {
    const { n0, n1 } = deWilcox(p.d, p.ti, p.ctrl, p.cs)
    if (!n0 || !n1)
      return <Empty title={`No ${p.t.name} cells in one of these groups`}>
        {n0} cells in {p.ctrl}, {n1} in {p.cs}.
      </Empty>
    return null
  }

  if (!d.pbOK)
    return (
      <Empty title={`Not enough samples in ${p.t.name} for pseudobulk`}>
        {d.n0} {p.ctrl} and {d.n1} {p.cs} samples clear the {MIN_CELLS}-cell floor.
        Pseudobulk needs more than {MIN_REPS_PB - 1} per group.
        <div className="mt-3.5">
          <button className="btn btn-primary" onClick={() => p.onMethod('wilcox')}>
            Use Wilcoxon instead
          </button>
        </div>
        <div className="scrollx mt-4 text-left">
          <table className="t">
            <thead>
              <tr><th>Sample</th><th>Group</th><th>Cells in {p.t.name}</th><th>Used</th></tr>
            </thead>
            <tbody>
              {d.used.map(s => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td>{s.cond}</td>
                  <td className="num">{s.n}</td>
                  <td>
                    <span className={`badge badge-${s.n >= MIN_CELLS ? 'here' : 'none'}`}>
                      {s.n >= MIN_CELLS ? 'yes' : 'too few cells'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Empty>
    )

  if (!p.computed)
    return (
      <Empty title={`No DESeq2 result for ${label(p)} yet`}>
        Raw counts will be summed within each sample to a pseudobulk profile
        ({d.n0} + {d.n1} columns), then tested with DESeq2 in webR. Nothing is shown until it runs.
        <div className="mt-4">
          <button className="btn btn-primary" disabled={p.running} onClick={p.onRun}>
            {p.running ? 'Running DESeq2 in webR…' : `Run DESeq2 for ${p.t.name}`}
          </button>
        </div>
        <div className="mono mt-2.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          {d.kept.map(s => `${s.id} (${s.n} cells)`).join(' · ')}
        </div>
      </Empty>
    )

  return null
}

export function DEGTable(p: StatsProps) {
  const blocked = gate(p)
  if (blocked) return <Card><MethodBar {...p} />{blocked}</Card>

  const { rows, n0, n1 } = runDE(p.d, p.ti, p.ctrl, p.cs, p.method)
  const wil = p.method === 'wilcox'
  const th = thresholdFor(p.method)
  const up = rows.filter(r => isSig(r, th) && r.lfc > 0).length
  const dn = rows.filter(r => isSig(r, th) && r.lfc < 0).length
  const design = designFor(p.d, p.ti, p.ctrl, p.cs)
  const other = design.pbOK
    ? (wil
        ? sigCount(dePseudobulk(p.d, p.ti, p.ctrl, p.cs).rows, thresholdFor('pseudobulk'))
        : sigCount(deWilcox(p.d, p.ti, p.ctrl, p.cs).rows, thresholdFor('wilcox')))
    : null

  return (
    <Card>
      <MethodBar {...p} />
      <div className="eyebrow">{label(p)}</div>
      <h2 className="mt-1 text-[14.5px] font-semibold">{up + dn} differentially expressed genes</h2>
      <p className="sub">
        {up} higher and {dn} lower in <b>{p.cs}</b>, at adjusted p &lt; 0.05 and
        |log₂ fold change| ≥ {th.lfc}.{' '}
        {wil
          ? <>Wilcoxon rank-sum over {fmt(n0)} and {fmt(n1)} cells. The effect-size cutoff is
             Seurat&rsquo;s <Mono>logfc.threshold</Mono>, not the bulk |log₂FC| &gt; 1 —
             log-normalized single-cell values are compressed and a cutoff of 1 discards most real
             differences.</>
          : <>DESeq2 over {n0} + {n1} pseudobulk profiles, which are summed raw counts and so take
             the bulk cutoff.</>}
      </p>

      {other !== null && (
        <div className="note mt-3">
          <b>The other test gives {other}.</b>{' '}
          {wil
            ? `Per-cell testing treats every cell as a replicate, so it reports ${up + dn} where pseudobulk — testing between animals — reports ${other}. Use the per-cell list to explore; use pseudobulk when the claim has to survive a new animal.`
            : `Pseudobulk reports ${up + dn} where the per-cell test reports ${other}, because it will not treat cells from one animal as independent observations.`}
        </div>
      )}

      <div className="scrollx mt-3.5" style={{ maxHeight: 480 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Gene</th>
              {wil ? <><th>pct.1</th><th>pct.2</th></> : <th>Base mean</th>}
              <th>log₂FC</th><th>p</th><th>p adjusted</th><th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 60).map(r => <Row key={r.gene} r={r} wil={wil} ctrl={p.ctrl} cs={p.cs} />)}
          </tbody>
        </table>
      </div>
      <p className="mono mt-2.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
        Showing {Math.min(60, rows.length)} of {rows.length} genes past the gates.
        Direction always names the group.
      </p>
    </Card>
  )
}

function Row({ r, wil, ctrl, cs }: { r: DERow; wil: boolean; ctrl: string; cs: string }) {
  return (
    <tr>
      <td className="mono font-semibold italic">{r.gene}</td>
      {wil ? (
        <>
          <td className="num" style={{ color: 'var(--ink-2)' }}>{r.pct1?.toFixed(2)}</td>
          <td className="num" style={{ color: 'var(--ink-2)' }}>{r.pct2?.toFixed(2)}</td>
        </>
      ) : (
        <td className="num" style={{ color: 'var(--ink-2)' }}>{r.mean?.toFixed(0)}</td>
      )}
      <td className="num font-semibold" style={{ color: r.lfc > 0 ? 'var(--bad)' : 'var(--lo)' }}>
        {r.lfc > 0 ? '+' : ''}{r.lfc.toFixed(2)}
      </td>
      <td className="num mono text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{sci(r.p)}</td>
      <td className="num mono text-[11.5px]">{sci(r.padj)}</td>
      <td>{r.lfc > 0 ? `higher in ${cs}` : `higher in ${ctrl}`}</td>
    </tr>
  )
}

export function Volcano(p: StatsProps) {
  const blocked = gate(p)
  if (blocked) return <Card><MethodBar {...p} />{blocked}</Card>

  const { rows } = runDE(p.d, p.ti, p.ctrl, p.cs, p.method)
  const th = thresholdFor(p.method)
  const W = 700, H = 420, PL = 56, PB = 42, PT = 14, PR = 14
  const maxX = Math.max(3, ...rows.map(r => Math.abs(r.lfc))) * 1.12
  const maxY = Math.max(6, ...rows.map(r => -Math.log10(Math.max(r.padj, 1e-300)))) * 1.08
  const X = (v: number) => PL + ((W - PL - PR) * (v + maxX)) / (2 * maxX)
  const Y = (v: number) => PT + (H - PT - PB) * (1 - v / maxY)
  const step = Math.max(1, Math.ceil(maxY / 5))
  const ticks: number[] = []
  for (let t = 0; t <= maxY; t += step) ticks.push(t)

  return (
    <Card>
      <MethodBar {...p} />
      <div className="eyebrow">{label(p)}</div>
      <h2 className="mb-2.5 mt-1 text-[14.5px] font-semibold">Volcano</h2>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Volcano plot for ${label(p)}`}>
        {[-2, -1, 0, 1, 2].map(f => {
          const v = (maxX * f) / 2
          return <text key={f} className="axis" x={X(v)} y={H - PB + 15} textAnchor="middle">{v.toFixed(1)}</text>
        })}
        {ticks.map(t => (
          <g key={t}>
            <line className="axline" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} opacity=".4" />
            <text className="axis" x={PL - 7} y={Y(t) + 3.5} textAnchor="end">{t}</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={Y(-Math.log10(0.05))} y2={Y(-Math.log10(0.05))}
          stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
        {[th.lfc, -th.lfc].map(v => (
          <line key={v} x1={X(v)} x2={X(v)} y1={PT} y2={H - PB}
            stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
        ))}
        {rows.map(r => {
          const sig = isSig(r, th)
          return (
            <circle key={r.gene} cx={+X(r.lfc).toFixed(1)}
              cy={+Y(-Math.log10(Math.max(r.padj, 1e-300))).toFixed(1)}
              r={sig ? 4 : 2.6}
              fill={sig ? (r.lfc > 0 ? '#ef4444' : '#3b82f6') : 'var(--ink-3)'}
              opacity={sig ? 0.9 : 0.45} />
          )
        })}
        {rows.slice(0, 12).map(r => (
          <text key={r.gene} className="axis" x={X(r.lfc) + (r.lfc > 0 ? 7 : -7)}
            y={Y(-Math.log10(Math.max(r.padj, 1e-300))) + 3.5}
            textAnchor={r.lfc > 0 ? 'start' : 'end'}
            style={{ fontStyle: 'italic', fontSize: 10.5, fill: 'var(--ink)' }}>{r.gene}</text>
        ))}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
        <text className="axis" x={(PL + W - PR) / 2} y={H - 6} textAnchor="middle">
          log₂ fold change · {p.cs} vs {p.ctrl}
        </text>
        <text className="axis" transform={`rotate(-90 15 ${(PT + H - PB) / 2})`} x={15}
          y={(PT + H - PB) / 2} textAnchor="middle">−log₁₀ adjusted p</text>
      </svg>
      <figcaption className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        Dashed lines: adjusted p = 0.05 and |log₂FC| = {th.lfc} — the cutoffs the Methods text
        reports.{' '}
        {p.method === 'wilcox'
          ? 'Note the y scale: per-cell tests reach exponents no bulk experiment ever produces, because n is the number of cells.'
          : 'Between-animal variance is in the model, so the y scale stays interpretable.'}
      </figcaption>
    </Card>
  )
}

export function Enrichment(p: StatsProps) {
  const blocked = gate(p)
  return (
    <Card>
      <MethodBar {...p} />
      {blocked ?? (
        <>
          <div className="eyebrow">{label(p)}</div>
          <h2 className="mt-1 text-[14.5px] font-semibold">Over-representation</h2>
          <p className="sub">
            Identical to rnaseq-studio, running on the DEG list from the test selected above:
            full pathway names never truncated, term count user-selectable.
          </p>
          <div className="empty mt-3.5">
            Same component as the bulk studio — not yet ported.
          </div>
        </>
      )}
    </Card>
  )
}
