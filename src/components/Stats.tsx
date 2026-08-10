import { useMemo, useState } from 'react'
import type { CellType, DERow, Method } from '../types.ts'
import type { Source } from '../lib/source.ts'
import {
  condLabel, deWilcox, designFor, inConds, isSig, LFC_GATE, MIN_CELLS, MIN_CELLS_GROUP,
  MIN_REPS_PB, PCT_GATE, pseudobulkColumns, sameOrOverlapping, wilcoxSpec, type DEResult,
} from '../lib/stats.ts'
import { useJob } from '../lib/compute.ts'
import Progress from './Progress.tsx'
import { downloadCsv, slug } from '../lib/download.ts'
import { fmt, maxOf } from '../lib/chart.ts'
import { condKey } from '../lib/source.ts'
import { AXIS_INK, MARK_EDGE } from '../lib/figure-ink.ts'
import { KeyRow } from './svg-parts.tsx'
import { nlpTxt, pTxt } from '../lib/significance.ts'
import { Card, Empty, Mono, Seg } from './Ui.tsx'
import Figure from './Figure.tsx'
import DEGTableBody from './DEGTable.tsx'

export interface StatsProps {
  src: Source
  t: CellType
  ti: number
  ctrl: string[]
  cs: string[]
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

const contrastLabel = (p: StatsProps) =>
  `${condLabel(p.cs)} vs ${condLabel(p.ctrl)} · ${p.t.name}`

/**
 * The contrast, computed.
 *
 * The key is the comparison and nothing else — moving a threshold slider filters
 * rows that are already in hand, so on a collection it must not send the reader
 * back over the file. Switching between this tab, the volcano and enrichment
 * must not either, which is why the result is cached against the object.
 *
 * All three contrast tabs call this with the same key, which is what makes them
 * one computation rather than three: whichever is opened first starts the pass,
 * the other two find it already running (or already cached) and join it. In
 * particular Enrichment does not test any gene of its own — it reads the rows
 * this returns and runs the hypergeometric test over them.
 *
 * Changing the cell type or either side of the contrast changes the key, and a
 * different key in the SAME slot cancels the pass in flight — nobody wants the
 * old contrast once they have asked for a new one. The old answer cannot arrive
 * late and overwrite the new one because there is nothing left to deliver it to,
 * and it cannot be rendered under the new key because the value returned is only
 * ever the one stored under the key being asked for.
 *
 * The slot is 'de' and nothing else uses it, so leaving these tabs — for Markers
 * or anywhere else — cancels nothing. Come back and the contrast is either
 * already in hand or still running where it was left.
 */
function useDE(p: StatsProps) {
  return useJob<'wilcox'>(
    p.src, 'de', `de|${p.ti}|${condKey(p.ctrl)}|${condKey(p.cs)}`,
    // `computed` is the reader's go-ahead for THIS contrast. Without it every
    // click in the group pickers started a whole-transcriptome pass — and with
    // sets, choosing four levels a side is seven clicks and seven passes, six
    // of them cancelled a moment after they began.
    p.method === 'wilcox' && !sameOrOverlapping(p.ctrl, p.cs) && p.computed,
    () => deWilcox(p.src, p.ti, p.ctrl, p.cs),
    // A fresh spec every time: the engine transfers these arrays rather than
    // copying them, so a reused one would arrive detached.
    () => ({ kind: 'wilcox', ...wilcoxSpec(p.src, p.ti, p.ctrl, p.cs) }),
  )
}

const testing = (p: StatsProps) =>
  `Testing every gene in ${p.t.name}: ${condLabel(p.cs)} against ${condLabel(p.ctrl)}`

/** The test picker, above every contrast tab. */
function MethodBar(p: StatsProps) {
  const d = designFor(p.src, p.ti, p.ctrl, p.cs)
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
function gate(p: StatsProps, de: DEResult | null): React.ReactNode {
  if (sameOrOverlapping(p.ctrl, p.cs))
    return <Empty title="Pick two groups with no level in common">
      Control is <b>{condLabel(p.ctrl)}</b> and compare is <b>{condLabel(p.cs)}</b>. A level on
      both sides would put the same cells in both groups, which is not a comparison.
    </Empty>

  // Not asked for yet. Every gene against every cell of two groups reads the
  // whole object, and picking a group is not a request to spend that.
  if (!p.computed)
    return <Empty title="Not computed yet">
      <div className="mx-auto max-w-[520px]">
        Every gene is tested in <b>{p.t.name}</b>: <b>{condLabel(p.cs)}</b> against{' '}
        <b>{condLabel(p.ctrl)}</b>. That reads the whole object once, so it waits until you
        ask — change the groups above as often as you like first, nothing runs until you
        press this.
      </div>
      <button className="btn btn-primary mt-3.5" onClick={p.onRun}>Run this comparison</button>
    </Empty>

  const d = designFor(p.src, p.ti, p.ctrl, p.cs)

  if (p.method === 'wilcox') {
    // Still running: the caller shows how far it has got.
    if (!de) return null
    const { n0, n1 } = de
    if (!n0 || !n1)
      return <Empty title={`No ${p.t.name} cells in one of these groups`}>
        {n0} cells in {condLabel(p.ctrl)}, {n1} in {condLabel(p.cs)}.
      </Empty>
    // Seurat's min.cells.group. A side of one or two cells does produce a table —
    // a long one, with small p-values — but every row of it describes those cells
    // rather than a difference between groups, and nothing on the page would say so.
    if (n0 < MIN_CELLS_GROUP || n1 < MIN_CELLS_GROUP)
      return <Empty title={`Too few ${p.t.name} cells to test one of these groups`}>
        {n0} cell{n0 === 1 ? '' : 's'} in {condLabel(p.ctrl)}, {n1} in {condLabel(p.cs)}. A rank-sum test needs
        at least {MIN_CELLS_GROUP} per group — Seurat&rsquo;s <Mono>min.cells.group</Mono> —
        and below that the table it returns is a description of the {Math.min(n0, n1)} cell
        {Math.min(n0, n1) === 1 ? '' : 's'} on the smaller side, at whatever p the
        separation happens to give.
      </Empty>
    return null
  }

  if (!d.pbOK)
    return (
      <Empty title={`Not enough samples in ${p.t.name} for pseudobulk`}>
        {d.n0} {condLabel(p.ctrl)} and {d.n1} {condLabel(p.cs)} samples clear the {MIN_CELLS}-cell floor.
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

  // No pretend DESeq2. The bundle carries the summed counts; running the model
  // is R's job until webR is wired, and saying so is better than a number nobody
  // can trace back to a method.
  return null
}

/** The pseudobulk design and its export — shown in place of results. */
function PseudobulkPanel(p: StatsProps) {
  const cols = pseudobulkColumns(p.src, p.ti, p.ctrl, p.cs)
  const pb = p.src.pseudobulk
  const n0 = cols.filter(c => inConds(c.cond, p.ctrl)).length
  const n1 = cols.filter(c => inConds(c.cond, p.cs)).length

  if (!pb) {
    return (
      <Empty title="This object carries no raw counts">
        Pseudobulk sums raw counts per sample, and the bundle was built without
        them — the exporter says so on the Overview tab. Wilcoxon does not need
        them and is running.
        <div className="mt-3.5">
          <button className="btn btn-primary" onClick={() => p.onMethod('wilcox')}>
            Use Wilcoxon instead
          </button>
        </div>
      </Empty>
    )
  }

  const save = () => {
    const keep = cols.map(c => pb.columns.findIndex(
      x => x.sample === c.sample && x.cluster === c.cluster))
    downloadCsv(
      `pseudobulk_${slug(`${condLabel(p.cs)}_vs_${condLabel(p.ctrl)}_${p.t.name}`)}`,
      ['gene', ...cols.map(c => `${c.sample}__${c.cond}`)],
      pb.genes.map((g, gi) => [g, ...keep.map(k => pb.counts[gi * pb.columns.length + k])]))
  }

  return (
    <>
      <div className="note mt-1">
        <b>The matrix is here; the model is not.</b> Raw counts have been summed
        per sample within {p.t.name}, which is the whole of the pseudobulk step.
        Fitting DESeq2 is not yet wired into the browser, so rather than show a
        number from some other test under a DESeq2 label, the counts are offered
        as they are — feed them straight to <code className="mono">DESeqDataSetFromMatrix</code>.
      </div>
      <div className="scrollx mt-3.5">
        <table className="t">
          <thead>
            <tr><th>Sample</th><th>Group</th><th>Cells in {p.t.name}</th><th>Used</th></tr>
          </thead>
          <tbody>
            {p.src.d.samples
              .filter(s => inConds(s.cond, p.ctrl) || inConds(s.cond, p.cs))
              .map(s => {
                const hit = cols.find(c => c.sample === s.id)
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.id}</td>
                    <td>{s.cond}</td>
                    <td className="num">{hit?.nCells ?? 0}</td>
                    <td>
                      <span className={`badge badge-${hit ? 'here' : 'none'}`}>
                        {hit ? 'yes' : `under ${MIN_CELLS} cells`}
                      </span>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button className="btn btn-primary" disabled={!cols.length} onClick={save}>
          ⭳ Pseudobulk counts ({cols.length} columns)
        </button>
        <button className="btn" onClick={() => p.onMethod('wilcox')}>Back to Wilcoxon</button>
        <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
          {n0} {condLabel(p.ctrl)} · {n1} {condLabel(p.cs)}
          {(n0 < MIN_REPS_PB || n1 < MIN_REPS_PB)
            && ` — fewer than ${MIN_REPS_PB} per group, so a between-animal test is not defensible here either`}
        </span>
      </div>
    </>
  )
}


/** The gate and the rows, for a contrast tab that renders its own body. */
export function ContrastFrame(
  p: StatsProps & { children: (rows: DERow[]) => React.ReactNode },
) {
  const { value: de, pass } = useDE(p)
  const blocked = p.method === 'pseudobulk' ? <PseudobulkPanel {...p} /> : gate(p, de)
  return (
    <Card>
      <MethodBar {...p} />
      {blocked ?? (pass ? <Progress pass={pass} title={testing(p)} /> : de && (
        <>
          <ThresholdBar {...p} />
          <div className="eyebrow">{contrastLabel(p)}</div>
          {p.children(de.rows)}
        </>
      ))}
    </Card>
  )
}

export function DEGTable(p: StatsProps) {
  const { value: de, pass } = useDE(p)
  if (p.method === 'pseudobulk') {
    return <Card><MethodBar {...p} /><PseudobulkPanel {...p} /></Card>
  }
  const blocked = gate(p, de)
  if (blocked) return <Card><MethodBar {...p} />{blocked}</Card>
  if (pass) return <Card><MethodBar {...p} /><Progress pass={pass} title={testing(p)} /></Card>
  if (!de) return <Card><MethodBar {...p} /></Card>

  const { rows, n0, n1 } = de
  const wil = p.method === 'wilcox'
  const th = { padj: p.padjMax, lfc: p.lfcMin }
  const up = rows.filter(r => isSig(r, th) && r.lfc > 0).length
  const dn = rows.filter(r => isSig(r, th) && r.lfc < 0).length

  return (
    <Card>
      <MethodBar {...p} />
      <ThresholdBar {...p} />
      <div className="eyebrow">{contrastLabel(p)}</div>
      <h2 className="mt-1 text-[14.5px] font-semibold">{up + dn} differentially expressed genes</h2>
      <p className="sub">
        {up} higher and {dn} lower in <b>{condLabel(p.cs)}</b>, at adjusted p &lt; {p.padjMax} and
        |log₂ fold change| ≥ {p.lfcMin}.{' '}
        {wil
          ? <>Wilcoxon rank-sum over {fmt(n0)} and {fmt(n1)} cells. The default cutoff is
             Seurat&rsquo;s <Mono>logfc.threshold</Mono>, not the bulk |log₂FC| &gt; 1 —
             log-normalized single-cell values are compressed and a cutoff of 1 discards most real
             differences.</>
          : <>DESeq2 over {n0} + {n1} pseudobulk profiles, which are summed raw counts and so take
             the bulk cutoff.</>}
      </p>


      <DEGTableBody
        rows={rows} wilcox={wil} ctrl={condLabel(p.ctrl)} cs={condLabel(p.cs)} label={contrastLabel(p)}
        padjMax={p.padjMax} lfcMin={p.lfcMin} onPickGene={p.onPickGene}
      />
    </Card>
  )
}

export function Volcano(p: StatsProps) {
  const [hover, setHover] = useState<DERow | null>(null)
  const [nLabels, setNLabels] = useState(12)
  const { value: de, pass } = useDE(p)
  const rows = useMemo(() => de?.rows ?? [], [de])

  // PB carries the x-axis title and, below it, the key. That key used to sit in
  // an HTML row underneath the figure, so an exported volcano arrived with three
  // colours of point and nothing to say which direction was which.
  const W = 760, H = 466, PL = 58, PB = 72, PT = 16, PR = 16
  // maxOf, not `Math.max(...)`: the spread passes one argument per DE gene and
  // V8 refuses past ~124 900 of them — measured on this machine. This atlas
  // reports 31 053, so the old form did not crash here and would have on any
  // larger gene list, taking the React tree down with it and leaving a white
  // page. Both extents are remembered too, because each was allocating and
  // walking a 31 053-element array on every render of the tab.
  const maxX = useMemo(
    () => Math.max(3, maxOf(rows.map(r => Math.abs(r.lfc)))) * 1.12, [rows])
  // r.nlp, not -log10(padj): on the atlas 11% of the rows have an adjusted p
  // below the smallest double, so that expression pinned every one of them to
  // the 1e-300 clamp and the top of the volcano was a flat line of 300s.
  const maxY = useMemo(() => Math.max(6, maxOf(rows.map(r => r.nlp))) * 1.08, [rows])
  const X = (v: number) => PL + ((W - PL - PR) * (v + maxX)) / (2 * maxX)
  const Y = (v: number) => PT + (H - PT - PB) * (1 - v / maxY)

  const pts = useMemo(
    () => rows.map(r => ({
      r,
      x: X(r.lfc),
      y: Y(r.nlp),
      sig: isSig(r, { padj: p.padjMax, lfc: p.lfcMin }),
    })),
    // X and Y are pure functions of maxX/maxY, which derive from rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, p.padjMax, p.lfcMin, maxX, maxY])

  const blocked = p.method === 'pseudobulk' ? <PseudobulkPanel {...p} /> : gate(p, de)
  if (blocked) return <Card><MethodBar {...p} />{blocked}</Card>
  if (pass) return <Card><MethodBar {...p} /><Progress pass={pass} title={testing(p)} /></Card>
  if (!de) return <Card><MethodBar {...p} /></Card>

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
          ▲ {up} up in {condLabel(p.cs)}
        </span>
        <span className="badge" style={{ background: 'rgba(59,130,246,.14)', color: '#1d4ed8' }}>
          ▼ {dn} up in {condLabel(p.ctrl)}
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
            return <text key={f} x={X(v)} y={H - PB + 15} textAnchor="middle"
              style={{ fontSize: 10.5, fill: AXIS_INK }}>{v.toFixed(1)}</text>
          })}
          {ticks.map(t => (
            <g key={t}>
              <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
              <text x={PL - 7} y={Y(t) + 3.5} textAnchor="end"
                style={{ fontSize: 10.5, fill: AXIS_INK }}>{t}</text>
            </g>
          ))}
          <line x1={PL} x2={W - PR} y1={Y(-Math.log10(p.padjMax))} y2={Y(-Math.log10(p.padjMax))}
            stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
          {[p.lfcMin, -p.lfcMin].map(v => (
            <line key={v} x1={X(v)} x2={X(v)} y1={PT} y2={H - PB}
              stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
          ))}
          {/* Significant points carry the black edge the key shows; the
              non-significant cloud does not, because outlining several thousand
              grey points turns the background into a solid mass and buries the
              genes the figure is about. The edge is for the marks a reader is
              meant to pick out one by one. */}
          {pts.map(q => (
            <circle key={q.r.gene} cx={+q.x.toFixed(1)} cy={+q.y.toFixed(1)}
              r={hover?.gene === q.r.gene ? 6 : q.sig ? 4 : 2.6}
              fill={q.sig ? (q.r.lfc > 0 ? '#ef4444' : '#3b82f6') : '#9AA3AF'}
              stroke={q.sig ? MARK_EDGE : 'none'} strokeWidth={q.sig ? 0.6 : 0}
              opacity={q.sig ? 0.92 : 0.45} />
          ))}
          {pts.filter(q => q.sig).slice(0, nLabels).map(q => (
            <text key={q.r.gene} className="axis" x={q.x + (q.r.lfc > 0 ? 7 : -7)} y={q.y + 3.5}
              textAnchor={q.r.lfc > 0 ? 'start' : 'end'}
              style={{ fontStyle: 'italic', fontSize: 10.5, fill: 'var(--ink)' }}>{q.r.gene}</text>
          ))}
          <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
          <text x={(PL + W - PR) / 2} y={H - PB + 32} textAnchor="middle"
            style={{ fontSize: 11.5, fill: AXIS_INK }}>
            log₂ fold change · {condLabel(p.cs)} vs {condLabel(p.ctrl)}
          </text>
          <text transform={`rotate(-90 15 ${(PT + H - PB) / 2})`} x={15}
            y={(PT + H - PB) / 2} textAnchor="middle"
            style={{ fontSize: 11.5, fill: AXIS_INK }}>−log₁₀ adjusted p</text>

          {/* The key, in the figure and centred under the panel, in the same
              language as the marks it describes. */}
          <KeyRow cx={(PL + W - PR) / 2} y={H - 14} items={[
            { color: '#ef4444', label: `up in ${condLabel(p.cs)}` },
            { color: '#3b82f6', label: `up in ${condLabel(p.ctrl)}` },
            { color: '#9AA3AF', label: 'not significant' },
          ]} />
        </svg>
      </Figure>

      {/* Only the readout stays out here: it changes as the pointer moves and
          has no meaning in a saved file. The three colours are in the figure. */}
      <div className="legend mt-2">
        <span style={{ color: 'var(--ink-3)' }}>
          {/* The same two columns the table shows, written the same way — a point
              near the top of this axis has an adjusted p the double cannot hold,
              and `padj.toExponential(1)` printed the floor as though it were the
              reading. */}
          {hover
            ? `${hover.gene} · log₂FC ${hover.lfc.toFixed(2)}`
              + ` · −log₁₀ padj ${nlpTxt(hover.nlp)} · padj ${pTxt(hover.padj)}`
            : '· hover a point to read it, click to open it in Gene expression'}
        </span>
      </div>

      <figcaption className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        Dashed lines are the cutoffs above, which the Methods text also reports. The y axis is
        the table&rsquo;s <b>−log₁₀ padj</b> column, formed in log space rather than as −log₁₀ of
        the adjusted p: past z ≈ 38.6 the adjusted p underflows the double, and taking its
        logarithm flattened the whole top of this cloud onto one line.{' '}
        {p.method === 'wilcox'
          ? 'Note the y scale: per-cell tests reach exponents no bulk experiment ever produces, because n is the number of cells.'
          : 'Between-animal variance is in the model, so the y scale stays interpretable.'}
      </figcaption>
    </Card>
  )
}
