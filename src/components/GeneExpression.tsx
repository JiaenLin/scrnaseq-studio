import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellType, GroupBy, Identity, PlotKind } from '../types.ts'
import type { Source } from '../lib/source.ts'
import {
  clusterCentroids, density, embedExtent, identities, nonZeroPercentile, quantiles,
} from '../lib/chart.ts'
import { MAX_GENES, mergeGenes, parseGeneList, rankGenes, SEPS } from '../lib/genes.ts'
import { mix, rampColor, rampCss, RAMPS, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { Card, Chips, Seg } from './Ui.tsx'

export interface GeneProps {
  src: Source
  types: CellType[]
  ct: string
  ctrl: string
  cs: string
  genes: string[]
  plot: PlotKind
  groupBy: GroupBy
  cols: number
  relative: boolean
  dotScale: boolean
  palKey: PaletteKey
  rampKey: RampKey
  onGenes: (g: string[]) => void
  onPlot: (p: PlotKind) => void
  onGroupBy: (g: GroupBy) => void
  onCols: (n: number) => void
  onRelative: (v: boolean) => void
  onDotScale: (v: boolean) => void
  onRamp: (k: RampKey) => void
}

export default function GeneExpression(p: GeneProps) {
  const GENES = p.src.genes
  const [q, setQ] = useState('')
  const [missing, setMissing] = useState<string[]>([])
  const hits = useMemo(() => rankGenes(q, GENES), [q, GENES])

  const add = (text: string) => {
    const { found, missing: miss } = parseGeneList(text, GENES)
    if (found.length) p.onGenes(mergeGenes(p.genes, found))
    setMissing(miss)
    setQ('')
  }
  const submit = () => {
    const t = q.trim()
    if (!t) return
    if (SEPS.test(t)) return add(t)
    const hit = hits[0]
    if (hit) { p.onGenes(mergeGenes(p.genes, [hit])); setMissing([]); setQ('') }
    else setMissing([t])
  }

  const ids = identities(p.src.d, p.types, p.groupBy, p.ct, p.palKey)
  const modes: { k: GroupBy; label: string }[] = [
    { k: 'type', label: 'Across cell types' },
    ...(p.src.d.multi
      ? [{ k: 'cond' as const, label: 'Across groups' }, { k: 'both' as const, label: 'Cell type × group' }]
      : []),
  ]

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Gene expression</div>
          <h2 className="mt-1 text-[14.5px] font-semibold">Search any gene</h2>
        </div>
        <div className="relative">
          <input
            className="inp mono w-[210px]" value={q} autoComplete="off"
            placeholder="one gene, or paste a list…"
            aria-label="Search a gene or paste a gene list"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            onPaste={e => {
              const txt = e.clipboardData.getData('text')
              if (SEPS.test(txt)) { e.preventDefault(); add(txt) }
            }}
          />
          {hits.length > 0 && (
            <div
              className="absolute left-0 top-full z-40 mt-1 w-[210px] overflow-hidden rounded-[10px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line-2)',
                       boxShadow: '0 8px 24px rgba(15,23,42,.14)' }}
            >
              {hits.map(g => (
                <button
                  key={g} type="button"
                  className={`mono block w-full px-[11px] py-1.5 text-left text-[12.5px] ${
                    g.toLowerCase() === q.trim().toLowerCase() ? 'font-bold' : ''}`}
                  style={g.toLowerCase() === q.trim().toLowerCase() ? { color: 'var(--accent-ink)' } : undefined}
                  onClick={() => { p.onGenes(mergeGenes(p.genes, [g])); setMissing([]); setQ('') }}
                >{g}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        Paste a list separated by commas, spaces or newlines — case does not matter.
        Up to {MAX_GENES} genes.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.genes.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>No genes selected yet.</span>
        )}
        {p.genes.map(g => (
          <span
            key={g}
            className="inline-flex items-center gap-0.5 rounded-full py-[3px] pl-2.5 pr-[5px] text-xs font-semibold italic"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
          >
            {g}
            <button
              className="border-0 bg-transparent px-1 not-italic opacity-60 hover:opacity-100"
              aria-label={`Remove ${g}`}
              onClick={() => p.onGenes(p.genes.filter(x => x !== g))}
            >×</button>
          </span>
        ))}
        {p.genes.length > 1 && (
          <button className="chip" onClick={() => { p.onGenes([]); setMissing([]) }}>Clear all</button>
        )}
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>
          <b>Not in this object:</b> <span className="mono">{missing.join(', ')}</span> — check the
          species and capitalisation (mouse <span className="mono">Ascl1</span> vs human{' '}
          <span className="mono">ASCL1</span>).
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <span className="glabel">Plot</span>
        <Seg<PlotKind>
          value={p.plot} onChange={p.onPlot}
          options={[
            { k: 'violin', label: 'Violin panel' },
            { k: 'dot', label: 'Dot plot' },
            { k: 'feature', label: 'Feature plot' },
          ]}
        />
        <div className="gsep h-6" />
        <span className="glabel">Group by</span>
        <Seg<GroupBy> value={p.groupBy} onChange={p.onGroupBy} options={modes} />

        {p.plot === 'dot' ? (
          <>
            <div className="gsep h-6" />
            <button
              className="chip" aria-pressed={p.dotScale}
              title="Seurat scale = TRUE — z-score each gene across identities"
              onClick={() => p.onDotScale(!p.dotScale)}
            >Scale each gene</button>
          </>
        ) : (
          <>
            <div className="gsep h-6" />
            <Chips label="Columns" value={p.cols} options={[1, 2, 3, 4]} onChange={p.onCols} />
            {p.plot === 'feature' && (
              <>
                <div className="gsep h-6" />
                <label className="flex items-center gap-1.5">
                  <span className="glabel">Colour</span>
                  <select className="sel" value={p.rampKey}
                    onChange={e => p.onRamp(e.target.value as RampKey)}>
                    {Object.entries(RAMPS).map(([k, r]) => (
                      <option key={k} value={k}>{r.label}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {p.plot === 'violin' && p.src.d.multi && p.groupBy === 'cond' && (
              <>
                <div className="gsep h-6" />
                <button className="chip" aria-pressed={p.relative} onClick={() => p.onRelative(!p.relative)}>
                  Relative to {p.ctrl}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <p className="sub mt-2.5">{describe(p)}</p>

      <div className="mt-3.5">
        {p.genes.length === 0
          ? <div className="empty">Search for a gene above.</div>
          : p.plot === 'dot' ? <DotPlot {...p} ids={ids} />
          : p.plot === 'feature' ? <FeaturePlot {...p} />
          : <ViolinPanel {...p} ids={ids} />}
      </div>
    </Card>
  )
}

function describe(p: GeneProps) {
  if (p.plot === 'dot')
    return 'Every gene against every identity at once — the standard way to read a panel of markers. Dot size is the fraction of cells expressing the gene; colour is the average expression.'
  if (p.plot === 'feature')
    return `Expression on the embedding, one panel per gene${
      p.groupBy !== 'type' && p.src.d.multi ? ", split by group and sharing that gene's scale" : ''
    }. Cells with no detected transcript sit at the bottom of the colour scale, and positive cells are drawn last so they cannot be hidden underneath the negative majority.`
  if (p.groupBy === 'type')
    return 'One violin per cell type, every type on screen at once — this is the view that works on an object with no comparison at all. Each gene keeps its own y axis.'
  if (p.groupBy === 'cond')
    return `Groups in the object's own order, within ${p.ct} — for a time course that means 0 h first and 72 h last, never alphabetical.`
  return 'Every cell type split by group. Dense on purpose: it is the fastest way to see whether a change is confined to one population.'
}

/* ---------------- violin panel ---------------- */

function ViolinPanel(p: GeneProps & { ids: Identity[] }) {
  const cols = p.groupBy === 'both' ? Math.min(p.cols, 2) : p.cols
  return (
    <>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {p.genes.map(g => <Facet key={g} {...p} gene={g} cols={cols} />)}
      </div>
      <div className="legend mt-3">
        <span>violin + box = per-cell distribution</span>
        <span>bar under the axis = fraction of cells detecting the gene</span>
      </div>
    </>
  )
}

function Facet(p: GeneProps & { ids: Identity[]; gene: string }) {
  const both = p.groupBy === 'both'
  const cats = p.ids
  const per = cats.length
  const W = p.cols <= 2 ? 620 : 400
  const PL = 40, PT = 20, PR = 8
  const DET = 9 // strip for the detection bars
  const PB = (both ? 56 : per > 5 ? 46 : 30) + DET
  const H = (p.cols <= 2 ? 210 : 190) + (both ? 30 : 0) + DET

  const series = cats.map(c => p.src.values(p.gene, c.ti, p.groupBy === 'type' ? null : c.cond))
  let base = 1
  if (p.relative && p.groupBy === 'cond') {
    const ref = Math.max(0, cats.findIndex(c => c.cond === p.ctrl))
    const v = series[ref]
    base = v.reduce((a, b) => a + b, 0) / v.length || 1
  }
  const scaled = series.map(v => v.map(x => x / base))
  const hi = Math.max(...scaled.flat()) * 1.06 || 1
  const lo = 0
  const Y = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo))
  const bw = (W - PL - PR) / per

  const dl = p.groupBy === 'type' ? 0
    : Math.log2((p.src.mean(p.gene, p.types.findIndex(t => t.name === p.ct), p.cs) + 0.05)
      / (p.src.mean(p.gene, p.types.findIndex(t => t.name === p.ct), p.ctrl) + 0.05))
  const pcts = cats.map(c => p.src.pct(p.gene, c.ti, p.groupBy === 'type' ? null : c.cond))
  const maxPct = Math.max(...pcts)

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${p.gene} expression`}>
        <text x={PL} y={11} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--ink)', fontStyle: 'italic' }}>
          {p.gene}
        </text>
        {maxPct < 0.12 && (
          <text className="axis" x={PL + 6 + p.gene.length * 5.5} y={11} style={{ fontSize: 9.5 }}>
            barely detected here — max {(maxPct * 100).toFixed(0)}%
          </text>
        )}
        {p.groupBy !== 'type' && Math.abs(dl) >= 0.15 && (
          <text className="axis" x={W - PR} y={11} textAnchor="end"
            style={{ fill: dl > 0 ? '#ef4444' : '#3b82f6', fontWeight: 600 }}>
            {dl > 0 ? '+' : ''}{dl.toFixed(1)}
          </text>
        )}
        {[0, 0.5, 1].map(f => {
          const t = lo + (hi - lo) * f
          return (
            <g key={f}>
              <line className="axline" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} opacity=".4" />
              <text className="axis" x={PL - 5} y={Y(t) + 3.5} textAnchor="end">{t.toFixed(1)}</text>
            </g>
          )
        })}
        {p.relative && p.groupBy === 'cond' && (
          <line x1={PL} x2={W - PR} y1={Y(1)} y2={Y(1)} stroke="var(--ink-3)" strokeDasharray="3 3" opacity=".8" />
        )}
        {cats.map((c, i) => {
          const v = scaled[i]
          const cx = PL + bw * (i + 0.5)
          const q = quantiles(v)
          const dens = density(v, lo, hi)
          const half = bw * 0.36
          const pts = [
            ...dens.map((x, k) => `${(cx + x * half).toFixed(1)},${Y(lo + (hi - lo) * k / 26).toFixed(1)}`),
            ...dens.map((x, k) => `${(cx - x * half).toFixed(1)},${Y(lo + (hi - lo) * k / 26).toFixed(1)}`).reverse(),
          ].join(' ')
          const col = c.dim !== undefined ? mix('#e2e8f0', c.color, 0.3 + c.dim * 0.7) : c.color
          const bwid = Math.max(1, bw * 0.62 * pcts[i])
          return (
            <g key={c.full}>
              <polygon points={pts} fill={col} opacity=".26" />
              <line x1={cx} x2={cx} y1={Y(q.q1)} y2={Y(q.q3)} stroke={col}
                strokeWidth={Math.max(2, Math.min(6, bw * 0.34))} opacity=".65" />
              <line x1={cx - Math.min(8, bw * 0.4)} x2={cx + Math.min(8, bw * 0.4)}
                y1={Y(q.med)} y2={Y(q.med)} stroke={col} strokeWidth={2} />
              <text className="axis" transform={`rotate(-42 ${cx} ${H - PB + DET + 11})`}
                x={cx} y={H - PB + DET + 11} textAnchor="end"
                style={{ fontSize: per > 10 ? 9 : 10 }}>{c.label}</text>
              {/* Detection bar. Without it a gene with heavy dropout is just a spike
                  at zero, with no way to tell "absent here" from "absent everywhere". */}
              <rect x={cx - bwid / 2} y={H - PB + 3} width={bwid} height={3.5} rx={1.75}
                fill={col} opacity=".8">
                <title>{(pcts[i] * 100).toFixed(0)}% of cells detect {p.gene}</title>
              </rect>
            </g>
          )
        })}
        {both && p.types.map((t, ti) => {
          const block = bw * p.src.d.conds.length
          const maxCh = Math.max(3, Math.floor(block / 5.2))
          const x0 = PL + bw * ti * p.src.d.conds.length
          const label = t.name.length > maxCh ? `${t.name.slice(0, maxCh - 1)}…` : t.name
          return (
            <g key={t.key}>
              {ti > 0 && <line className="axline" x1={x0} x2={x0} y1={PT} y2={H - PB + DET + 2} opacity=".5" />}
              <text className="axis" x={x0 + block / 2} y={H - 5} textAnchor="middle"
                style={{ fontSize: 9.5, fill: 'var(--ink)', fontWeight: 600 }}>
                {label}<title>{t.name}</title>
              </text>
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </figure>
  )
}

/* ---------------- Seurat dot plot ---------------- */

/**
 * Seurat's `scale = TRUE` default z-scores each gene *down its own column* and
 * clips to ±2.5, which makes the colour a claim about where a gene is highest,
 * not how much of it there is: a gene high everywhere comes out uniformly pale.
 * That is the most misread property of this figure, so the scaling is a visible
 * switch rather than a silent default.
 */
function DotPlot(p: GeneProps & { ids: Identity[] }) {
  const rows = p.ids
  const genes = p.genes
  const cw = 42, rh = 26, PT = 12, PR = 24
  // The left margin follows the longest identity — "Oligodendrocyte · Reactivated"
  // is more than twice the width of "TAP", and a clipped row label is unreadable.
  const PL = Math.max(110, Math.min(250, 22 + Math.max(...rows.map(r => r.full.length)) * 6.1))
  const labelH = Math.min(96, 22 + Math.max(...genes.map(g => g.length)) * 4.6)
  const W = PL + genes.length * cw + PR
  const H = PT + rows.length * rh + labelH

  const avg = rows.map(r => genes.map(g => p.src.mean(g, r.ti, p.groupBy === 'type' ? null : r.cond)))
  const cv = genes.map((_g, gi) => {
    const col = rows.map((_r, ri) => avg[ri][gi])
    if (!p.dotScale) return col
    const m = col.reduce((a, b) => a + b, 0) / col.length
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1
    return col.map(x => Math.max(-2.5, Math.min(2.5, (x - m) / sd)))
  })
  const lo = p.dotScale ? -2.5 : 0
  const hi = p.dotScale ? 2.5 : Math.max(...avg.flat(), 0.01)

  return (
    <>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
          aria-label={`Dot plot of ${genes.join(', ')}`}>
          {rows.map((r, ri) => {
            const y = PT + rh * (ri + 0.5)
            return (
              <g key={r.full}>
                {ri % 2 === 0 && (
                  <rect x={PL - 6} y={PT + rh * ri} width={genes.length * cw + 12} height={rh}
                    fill="var(--sunk)" opacity=".55" />
                )}
                <text className="axis" x={PL - 12} y={y + 4} textAnchor="end"
                  style={{ fontSize: 11.5, fill: 'var(--ink)', fontWeight: 550 }}>{r.full}</text>
                {genes.map((g, gi) => {
                  const pct = p.src.pct(g, r.ti, p.groupBy === 'type' ? null : r.cond)
                  if (pct < 0.01) return null
                  return (
                    <circle key={g} cx={PL + cw * (gi + 0.5)} cy={y} r={+(1.4 + pct * 9).toFixed(2)}
                      fill={rampColor((cv[gi][ri] - lo) / (hi - lo), p.rampKey)}
                      stroke="var(--line-2)" strokeWidth={0.5}>
                      <title>
                        {g} in {r.full} — {(pct * 100).toFixed(0)}% of cells,
                        mean {avg[ri][gi].toFixed(2)}
                      </title>
                    </circle>
                  )
                })}
              </g>
            )
          })}
          {genes.map((g, gi) => {
            const x = PL + cw * (gi + 0.5)
            const yb = PT + rows.length * rh + 10
            return (
              <text key={g} className="axis" transform={`rotate(-45 ${x} ${yb})`} x={x} y={yb}
                textAnchor="end" style={{ fontStyle: 'italic', fontSize: 11, fill: 'var(--ink)' }}>{g}</text>
            )
          })}
        </svg>
      </div>

      <div className="mt-3.5 flex flex-wrap items-end gap-8">
        <div>
          <div className="text-[10px] font-semibold" style={{ color: 'var(--ink)' }}>Percent expressed</div>
          <svg viewBox="0 0 190 44" width={190} height={44} role="img" aria-label="Dot size legend">
            {[0.25, 0.5, 0.75, 1].map((v, i) => (
              <g key={v}>
                <circle cx={18 + i * 44} cy={18} r={+(1.4 + v * 9).toFixed(2)} fill="none"
                  stroke="var(--ink-3)" strokeWidth={1.2} />
                <text className="axis" x={18 + i * 44} y={40} textAnchor="middle">{v * 100}%</text>
              </g>
            ))}
          </svg>
        </div>
        <div>
          <div className="text-[10px] font-semibold" style={{ color: 'var(--ink)' }}>
            Average expression{p.dotScale ? ' (scaled)' : ''}
          </div>
          <div className="mt-1.5 h-2.5 w-[150px] rounded-[3px]" style={{ background: rampCss(p.rampKey) }} />
          <div className="legend mt-1 justify-between" style={{ width: 150 }}>
            <span>{p.dotScale ? '−2.5' : '0'}</span>
            <span>{p.dotScale ? '+2.5' : hi.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <p className="sub mt-2.5">
        {p.dotScale
          ? <>Colour is <b>z-scored down each gene&rsquo;s column</b>, as in Seurat&rsquo;s{' '}
             <code className="mono">scale = TRUE</code> default — it shows <em>where</em> a gene is
             highest, not how abundant it is. A gene expressed evenly everywhere comes out
             uniformly pale. Turn scaling off to compare absolute levels.</>
          : <>Colour is the raw mean normalized expression, on one scale for every gene. Genes of
             very different abundance are now comparable, but a gene&rsquo;s own pattern across
             identities is harder to see than with scaling on.</>}
      </p>
    </>
  )
}

/* ---------------- Seurat feature plot ---------------- */

function FeaturePlot(p: GeneProps) {
  const split = p.groupBy !== 'type' && p.src.d.multi
  const panels: (string | null)[] = split ? p.src.d.conds : [null]
  const cols = split ? 1 : Math.max(1, Math.min(p.cols, 4))
  const size = split ? Math.max(150, 760 / panels.length) : Math.min(320, Math.max(170, 700 / cols))

  return (
    <>
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {p.genes.map(g => (
          <FeatureRow key={g} p={p} gene={g} panels={panels} size={size} />
        ))}
      </div>
      <div className="legend mt-3.5">
        <span style={{ color: 'var(--ink-3)' }}>0 · not detected</span>
        <span className="inline-block h-2.5 w-[140px] rounded-[3px]" style={{ background: rampCss(p.rampKey) }} />
        <span style={{ color: 'var(--ink-3)' }}>max</span>
        <span style={{ color: 'var(--ink-3)' }}>
          · each gene on its own scale, clipped at its 99th percentile · positive cells drawn last
        </span>
      </div>
    </>
  )
}

function FeatureRow({ p, gene, panels, size }: {
  p: GeneProps; gene: string; panels: (string | null)[]; size: number
}) {
  // The whole-dataset values are needed for the shared clip, so compute once here.
  const { vals, top } = useMemo(() => {
    const v = p.src.vector(gene)
    // Clipped at the gene's own 99th percentile, so one runaway cell cannot
    // flatten every other panel to the floor colour.
    return { vals: v, top: nonZeroPercentile(v, 0.99) }
  }, [gene, p.src])

  return (
    <figure>
      <figcaption className="mb-1.5 text-[12.5px] font-semibold italic" style={{ color: 'var(--ink)' }}>
        {gene}
        <span className="mono ml-1.5 font-normal not-italic" style={{ color: 'var(--ink-3)' }}>
          0 – {top.toFixed(1)}
        </span>
      </figcaption>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}>
        {panels.map(pan => (
          <div key={pan ?? 'all'}>
            {pan && <div className="axis mb-1 text-[10.5px]">{pan}</div>}
            <FeatureCanvas p={p} vals={vals} top={top} cond={pan} size={size} />
          </div>
        ))}
      </div>
    </figure>
  )
}

function FeatureCanvas({ p, vals, top, cond, size }: {
  p: GeneProps; vals: Float32Array; top: number; cond: string | null; size: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    ctx.fillStyle = surface
    ctx.fillRect(0, 0, cv.width, cv.height)
    const { x0, x1, y0, y1 } = embedExtent(p.src.d)

    // Typed, and counted before it is filled: a JS array of 292 495 boxed
    // indices per panel was a measurable part of every redraw of a split view.
    const cells = p.src.d.cells
    let n = 0
    for (let i = 0; i < cells.length; i++) if (!cond || cells[i].cond === cond) n++
    const idx = new Int32Array(n)
    let k = 0
    for (let i = 0; i < cells.length; i++) if (!cond || cells[i].cond === cond) idx[k++] = i
    // Seurat's `order = TRUE`: positive cells land on top instead of being buried
    // under the negative majority, which can otherwise erase a real signal.
    idx.sort((a, b) => vals[a] - vals[b])
    const r = idx.length > 12000 ? 1.5 : 2.1

    for (const i of idx) {
      const c = p.src.d.cells[i]
      // Zero takes the ramp's own low colour rather than a neutral grey. With a
      // dark-low ramp like viridis a grey would be *lighter* than the lowest real
      // value, so the scale would run backwards at its own floor.
      ctx.fillStyle = rampColor(Math.min(1, vals[i] / top), p.rampKey)
      ctx.beginPath()
      ctx.arc(((c.x - x0) / (x1 - x0)) * cv.width, (1 - (c.y - y0) / (y1 - y0)) * cv.height, r, 0, 6.284)
      ctx.fill()
    }

    // Cluster labels, so a feature plot can be read without a DimPlot beside it.
    if (size >= 200) {
      ctx.font = '600 17px system-ui'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3.5
      ctx.strokeStyle = 'rgba(255,255,255,.9)'
      const at = clusterCentroids(p.src.d, p.types.length)
      p.types.forEach((t, ti) => {
        const X = ((at[ti].x - x0) / (x1 - x0)) * cv.width
        const Y = (1 - (at[ti].y - y0) / (y1 - y0)) * cv.height
        ctx.strokeText(t.name, X, Y)
        ctx.fillStyle = '#334155'
        ctx.fillText(t.name, X, Y)
      })
    }
  }, [p, vals, top, cond, size])

  return (
    <canvas
      ref={ref} width={Math.round(size * 2)} height={Math.round(size * 2)}
      style={{ width: '100%', maxWidth: Math.round(size), height: 'auto', borderRadius: 9 }}
    />
  )
}
