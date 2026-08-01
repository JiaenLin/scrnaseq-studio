import { useMemo, useState } from 'react'
import type { CellType, Dataset, DERow, Method } from '../types.ts'
import {
  deWilcox, dePseudobulk, designFor, isSig, LFC_GATE, MIN_CELLS, MIN_REPS_PB,
  PCT_GATE, runDE, sigCount,
} from '../lib/stats.ts'
import { fmt } from '../lib/chart.ts'
import { Card, Empty, Mono, Seg } from './Ui.tsx'
import Figure from './Figure.tsx'
import DEGTableBody from './DEGTable.tsx'

export interface StatsProps {
  d: Dataset
  t: CellType
  ti: number
  ctrl: string
  cs: string
  method: Method
  computed: boolean
  running: boolean
  /** Significance cutoffs, held at app level so every tab and Methods agree. */
  padjMax: number
  lfcMin: number
  onMethod: (m: Method) => void
  onRun: () => void
  onPadj: (v: number) => void
  onLfc: (v: number) => void
  onPickGene: (g: string) => void
}

const contrastLabel = (p: StatsProps) => `${p.cs} vs ${p.ctrl} · ${p.t.name}`

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
            value={p.method} onChange={p.onMethod}
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
 * The significance cutoffs, adjustable and shared.
 *
 * Held at app level rather than per tab: the table, the volcano's dashed lines,
 * the enrichment input list and the Methods sentence all read the same two
 * numbers, so moving a slider here can never leave one of them describing a
 * different experiment.
 */
export function ThresholdBar(p: StatsProps) {
  const negLog = -Math.log10(Math.max(p.padjMax, 1e-300))
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-3 py-2"
      style={{ background: 'var(--sunk)' }}>
      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
        <span className="glabel">padj ≤</span>
        <input
          type="range" min={0} max={10} step={0.1} value={Math.min(negLog, 10)}
          aria-label="Adjusted p-value threshold"
          onChange={e => p.onPadj(Math.pow(10, -(+e.target.value)))}
        />
        <span className="mono w-[70px] text-[11.5px]">
          {p.padjMax < 1e-3 ? p.padjMax.toExponential(1) : p.padjMax.toFixed(3)}
        </span>
      </label>
      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
        <span className="glabel">|log₂FC| ≥</span>
        <input
          type="range" min={0} max={3} step={0.05} value={Math.min(p.lfcMin, 3)}
          aria-label="Fold change threshold"
          onChange={e => p.onLfc(+e.target.value)}
        />
        <span className="mono w-8 text-[11.5px]">{p.lfcMin.toFixed(2)}</span>
      </label>
      <button
        className="chip ml-auto"
        title="Back to the default for the selected test"
        onClick={() => {
          p.onPadj(0.05)
          p.onLfc(p.method === 'wilcox' ? LFC_GATE : 1)
        }}
      >Reset</button>
    </div>
  )
}

/** Results, or the reason there are none — never a substitute number. */
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
      <Empty title={`No DESeq2 result for ${contrastLabel(p)} yet`}>
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

/** The gate and the rows, for a contrast tab that renders its own body. */
export function ContrastFrame(
  p: StatsProps & { children: (rows: DERow[]) => React.ReactNode },
) {
  const blocked = gate(p)
  return (
    <Card>
      <MethodBar {...p} />
      {blocked ?? (
        <>
          <ThresholdBar {...p} />
          <div className="eyebrow">{contrastLabel(p)}</div>
          {p.children(runDE(p.d, p.ti, p.ctrl, p.cs, p.method).rows)}
        </>
      )}
    </Card>
  )
}

export function DEGTable(p: StatsProps) {
  const blocked = gate(p)
  if (blocked) return <Card><MethodBar {...p} />{blocked}</Card>

  const { rows, n0, n1 } = runDE(p.d, p.ti, p.ctrl, p.cs, p.method)
  const wil = p.method === 'wilcox'
  const th = { padj: p.padjMax, lfc: p.lfcMin }
  const up = rows.filter(r => isSig(r, th) && r.lfc > 0).length
  const dn = rows.filter(r => isSig(r, th) && r.lfc < 0).length
  const design = designFor(p.d, p.ti, p.ctrl, p.cs)
  const other = design.pbOK
    ? (wil
        ? sigCount(dePseudobulk(p.d, p.ti, p.ctrl, p.cs).rows, { padj: p.padjMax, lfc: 1 })
        : sigCount(deWilcox(p.d, p.ti, p.ctrl, p.cs).rows, { padj: p.padjMax, lfc: LFC_GATE }))
    : null

  return (
    <Card>
      <MethodBar {...p} />
      <ThresholdBar {...p} />
      <div className="eyebrow">{contrastLabel(p)}</div>
      <h2 className="mt-1 text-[14.5px] font-semibold">{up + dn} differentially expressed genes</h2>
      <p className="sub">
        {up} higher and {dn} lower in <b>{p.cs}</b>, at adjusted p &lt; {p.padjMax} and
        |log₂ fold change| ≥ {p.lfcMin}.{' '}
        {wil
          ? <>Wilcoxon rank-sum over {fmt(n0)} and {fmt(n1)} cells. The default cutoff is
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

      <DEGTableBody
        rows={rows} wilcox={wil} ctrl={p.ctrl} cs={p.cs} label={contrastLabel(p)}
        padjMax={p.padjMax} lfcMin={p.lfcMin} onPickGene={p.onPickGene}
      />
    </Card>
  )
}

export function Volcano(p: StatsProps) {
  const [hover, setHover] = useState<DERow | null>(null)
  const [nLabels, setNLabels] = useState(12)
  const { rows } = runDE(p.d, p.ti, p.ctrl, p.cs, p.method)

  const W = 760, H = 440, PL = 58, PB = 46, PT = 16, PR = 16
  const maxX = Math.max(3, ...rows.map(r => Math.abs(r.lfc))) * 1.12
  const maxY = Math.max(6, ...rows.map(r => -Math.log10(Math.max(r.padj, 1e-300)))) * 1.08
  const X = (v: number) => PL + ((W - PL - PR) * (v + maxX)) / (2 * maxX)
  const Y = (v: number) => PT + (H - PT - PB) * (1 - v / maxY)

  const pts = useMemo(
    () => rows.map(r => ({
      r,
      x: X(r.lfc),
      y: Y(-Math.log10(Math.max(r.padj, 1e-300))),
      sig: isSig(r, { padj: p.padjMax, lfc: p.lfcMin }),
    })),
    // X and Y are pure functions of maxX/maxY, which derive from rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, p.padjMax, p.lfcMin, maxX, maxY])

  const blocked = gate(p)
  if (blocked) return <Card><MethodBar {...p} />{blocked}</Card>

  const step = Math.max(1, Math.ceil(maxY / 5))
  const ticks: number[] = []
  for (let t = 0; t <= maxY; t += step) ticks.push(t)
  const up = pts.filter(q => q.sig && q.r.lfc > 0).length
  const dn = pts.filter(q => q.sig && q.r.lfc < 0).length

  // Nearest point in viewBox units, so a click lands on the gene it looks like.
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * H
    let best: (typeof pts)[number] | null = null
    let bestD = 144
    for (const q of pts) {
      const d2 = (q.x - mx) ** 2 + (q.y - my) ** 2
      if (d2 < bestD) { bestD = d2; best = q }
    }
    return best
  }

  return (
    <Card>
      <MethodBar {...p} />
      <ThresholdBar {...p} />
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <div className="eyebrow">{contrastLabel(p)}</div>
        <span className="badge" style={{ background: 'rgba(239,68,68,.14)', color: '#b91c1c' }}>
          ▲ {up} up in {p.cs}
        </span>
        <span className="badge" style={{ background: 'rgba(59,130,246,.14)', color: '#1d4ed8' }}>
          ▼ {dn} up in {p.ctrl}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="glabel">Labels</span>
          {[0, 12, 25].map(n => (
            <button key={n} className="chip" aria-pressed={nLabels === n} onClick={() => setNLabels(n)}>
              {n === 0 ? 'none' : n}
            </button>
          ))}
        </span>
      </div>

      <Figure name={`volcano_${contrastLabel(p)}`} className="mt-6">
        <svg
          viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
          aria-label={`Volcano plot for ${contrastLabel(p)}`}
          style={{ cursor: hover ? 'pointer' : 'default' }}
          onMouseMove={e => setHover(pick(e)?.r ?? null)}
          onMouseLeave={() => setHover(null)}
          onClick={e => { const q = pick(e); if (q) p.onPickGene(q.r.gene) }}
        >
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
          <line x1={PL} x2={W - PR} y1={Y(-Math.log10(p.padjMax))} y2={Y(-Math.log10(p.padjMax))}
            stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
          {[p.lfcMin, -p.lfcMin].map(v => (
            <line key={v} x1={X(v)} x2={X(v)} y1={PT} y2={H - PB}
              stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
          ))}
          {pts.map(q => (
            <circle key={q.r.gene} cx={+q.x.toFixed(1)} cy={+q.y.toFixed(1)}
              r={hover?.gene === q.r.gene ? 6 : q.sig ? 4 : 2.6}
              fill={q.sig ? (q.r.lfc > 0 ? '#ef4444' : '#3b82f6') : 'var(--ink-3)'}
              opacity={q.sig ? 0.9 : 0.45} />
          ))}
          {pts.filter(q => q.sig).slice(0, nLabels).map(q => (
            <text key={q.r.gene} className="axis" x={q.x + (q.r.lfc > 0 ? 7 : -7)} y={q.y + 3.5}
              textAnchor={q.r.lfc > 0 ? 'start' : 'end'}
              style={{ fontStyle: 'italic', fontSize: 10.5, fill: 'var(--ink)' }}>{q.r.gene}</text>
          ))}
          <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
          <text className="axis" x={(PL + W - PR) / 2} y={H - 6} textAnchor="middle">
            log₂ fold change · {p.cs} vs {p.ctrl}
          </text>
          <text className="axis" transform={`rotate(-90 15 ${(PT + H - PB) / 2})`} x={15}
            y={(PT + H - PB) / 2} textAnchor="middle">−log₁₀ adjusted p</text>
        </svg>
      </Figure>

      <div className="legend mt-2">
        <span><i className="sw" style={{ background: '#ef4444' }} />up in {p.cs}</span>
        <span><i className="sw" style={{ background: '#3b82f6' }} />up in {p.ctrl}</span>
        <span><i className="sw" style={{ background: 'var(--ink-3)' }} />not significant</span>
        <span style={{ color: 'var(--ink-3)' }}>
          {hover
            ? `${hover.gene} · log₂FC ${hover.lfc.toFixed(2)} · padj ${hover.padj.toExponential(1)}`
            : '· hover a point to read it, click to open it in Gene expression'}
        </span>
      </div>

      <figcaption className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        Dashed lines are the cutoffs above, which the Methods text also reports.{' '}
        {p.method === 'wilcox'
          ? 'Note the y scale: per-cell tests reach exponents no bulk experiment ever produces, because n is the number of cells.'
          : 'Between-animal variance is in the model, so the y scale stays interpretable.'}
      </figcaption>
    </Card>
  )
}
