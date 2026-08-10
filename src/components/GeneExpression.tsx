import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, CellType, GroupBy, Identity, PlotKind } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import {
  clusterCentroids, density, embedExtent, identities, maxOf, maxOfAll, nonZeroPercentile,
  quantiles,
} from '../lib/chart.ts'
import { drawFeature, panelHeight } from '../lib/feature-plot.ts'
import { AXIS_INK, GRID_INK, MARK_EDGE } from '../lib/figure-ink.ts'
import { geneIndex, MAX_GENES, mergeGenes, parseGeneList, rankGenes, SEPS } from '../lib/genes.ts'
import { mix, pal, rampColor, rampCss, RAMPS, type PaletteKey, type RampKey } from '../lib/palette.ts'
import Figure from './Figure.tsx'
import { ColorBar, SizeKey } from './svg-parts.tsx'
import { Card, Chips, Seg } from './Ui.tsx'

export interface GeneProps {
  src: Source
  types: CellType[]
  ct: string
  ctrl: string
  cs: string
  genes: string[]
  /** Which of the object's embeddings the feature plot draws on. */
  emb: Embedding
  plot: PlotKind
  groupBy: GroupBy
  cols: number
  relative: boolean
  dotScale: boolean
  palKey: PaletteKey
  rampKey: RampKey
  /**
   * Cell types the reader has taken out of these figures, by index.
   *
   * Not a subset of the object: nothing is recomputed and no statistic changes.
   * It exists because a real annotation carries populations nobody wants in a
   * figure — an "Undefined" cluster of 15 931 cells on the test atlas, doublets,
   * a debris cluster — and they dominate a violin panel and a dot plot while
   * saying nothing. On the feature plot they stay as the grey outline rather
   * than vanishing, so the embedding keeps the shape the reader knows.
   */
  hidden: Set<number>
  /** Percentile of expressing cells mapped to the top of the colour ramp. */
  clip: number
  /** A ring around each cell on the feature plot. */
  borders: boolean
  onHidden: (h: Set<number>) => void
  onClip: (v: number) => void
  onBorders: (v: boolean) => void
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
  const names = p.src.names
  const [q, setQ] = useState('')
  const [missing, setMissing] = useState<string[]>([])
  // Ranked over both namings, so "Sox2" and "ENSMUSG00000074637" find the same
  // row — and the row still comes back under the one name the studio uses.
  const hits = useMemo(() => rankGenes(q, GENES, 8, names), [q, GENES, names])
  /**
   * The row's other name — always the accession, whichever way round the file
   * stored them: `other` is by construction the naming that is NOT displayed,
   * and the displayed one is the symbol in both layouts.
   */
  const idOf = (g: string): string | null => {
    if (!names.other) return null
    // The map is remembered per gene list, so this is a lookup and not a scan of
    // 31 053 names once per chip.
    const i = geneIndex(names.display).get(g)
    return i === undefined ? null : names.other[i] ?? null
  }

  const add = (text: string) => {
    const { found, missing: miss } = parseGeneList(text, GENES, names)
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

  // Hidden types leave the violin panel and the dot plot entirely — an identity
  // with no cells is a blank column, and a panel of blank columns is worse than
  // the population the reader was trying to get rid of.
  const ids = identities(p.src.d, p.types, p.groupBy, p.ct, p.palKey)
    .filter(i => !p.hidden.has(i.ti))
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
            placeholder={names.other ? 'symbol or accession…' : 'one gene, or paste a list…'}
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
              className="absolute left-0 top-full z-40 mt-1 w-[250px] overflow-hidden rounded-[10px]"
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
                >
                  {g}
                  {/* The accession under the symbol: a symbol is not a stable
                      identifier, and two rows can carry the same one. Skipped
                      when the name already carries it, which is exactly the
                      case of a symbol two rows share. */}
                  {idOf(g) && !g.includes(idOf(g)!) && (
                    <span className="block text-[10.5px] font-normal"
                      style={{ color: 'var(--ink-3)' }}>{idOf(g)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        Paste a list separated by commas, spaces or newlines — case does not matter.
        Up to {MAX_GENES} genes.
      </p>
      {names.renamed && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          This object&rsquo;s matrix is indexed by <b>{names.idKind ?? 'accession'}s</b>; the symbols
          shown come from <span className="mono">{names.aliasColumn ?? 'the object'}</span> and
          travel with the file — nothing is looked up. Search either.
          {names.duplicated > 0 && <> {names.duplicated} rows share a symbol with another row;
            those carry their accession in the name, because summing them would put two
            genes under one label.</>}
          {names.missing > 0 && <> {names.missing} rows have no symbol and keep their accession.</>}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.genes.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>No genes selected yet.</span>
        )}
        {p.genes.map(g => (
          <span
            key={g}
            className="inline-flex items-center gap-0.5 rounded-full py-[3px] pl-2.5 pr-[5px] text-xs font-semibold italic"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
            title={idOf(g) ? `${g} — ${idOf(g)}` : g}
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
            {/* The dot plot has always coloured from this ramp; the control for
                it was only ever shown on the feature plot, so the one figure
                most likely to go into a paper had no way to change its colours. */}
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
                <div className="gsep h-6" />
                {/* The ceiling of the colour scale. One cell at ten times the
                    next-highest value flattens every other cell onto the floor
                    colour and the gene reads as unexpressed; SCpubr exposes the
                    same control as max.cutoff. Values above the ceiling are
                    drawn at the ceiling, never dropped. */}
                <label className="flex items-center gap-1.5">
                  <span className="glabel" title="Expression mapped to the top of the colour scale">
                    Scale to
                  </span>
                  <select className="sel" value={p.clip}
                    onChange={e => p.onClip(Number(e.target.value))}>
                    <option value={0.9}>90th percentile</option>
                    <option value={0.95}>95th percentile</option>
                    <option value={0.99}>99th percentile</option>
                    <option value={1}>the maximum</option>
                  </select>
                </label>
                <button
                  className="chip" aria-pressed={p.borders}
                  title="A ring around each cell — clearer at print size, slower on a large object"
                  onClick={() => p.onBorders(!p.borders)}
                >Cell borders</button>
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

      <CellFilter p={p} />

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

/**
 * Which populations these figures draw.
 *
 * Collapsed to one line until it is used, because on an object with 133 cell
 * types a permanently-open list of 133 checkboxes is the tallest thing on the
 * page and almost nobody touches it. Open, it is the whole roster with counts,
 * because "which one is the junk cluster" is usually answered by its size.
 */
function CellFilter({ p }: { p: GeneProps }) {
  const [open, setOpen] = useState(false)
  const counts = useMemo(() => {
    const n = new Int32Array(p.types.length)
    for (const c of p.src.d.cells) if (c.t >= 0 && c.t < n.length) n[c.t]++
    return n
  }, [p.src, p.types.length])

  const total = p.types.length
  const shown = total - p.hidden.size
  const toggle = (ti: number) => {
    const next = new Set(p.hidden)
    if (!next.delete(ti)) next.add(ti)
    // Every population hidden would leave a figure with nothing in it and no
    // way back except this control, so the last one stays.
    if (next.size >= total) return
    p.onHidden(next)
  }

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button className="chip" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          {open ? '▾' : '▸'} Cell types in these plots
        </button>
        <span className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          {p.hidden.size === 0
            ? `all ${total}`
            : `${shown} of ${total} — hiding ${[...p.hidden].slice(0, 3)
              .map(ti => p.types[ti]?.name).filter(Boolean).join(', ')}${
              p.hidden.size > 3 ? ` and ${p.hidden.size - 3} more` : ''}`}
        </span>
        {p.hidden.size > 0 && (
          <button className="chip" onClick={() => p.onHidden(new Set())}>Show all</button>
        )}
      </div>
      {open && (
        <div className="mt-2 rounded-xl p-2" style={{ background: 'var(--sunk)' }}>
          <div className="grid gap-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>
            {p.types.map((t, ti) => {
              const on = !p.hidden.has(ti)
              return (
                <button key={t.key} onClick={() => toggle(ti)} aria-pressed={on}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-left"
                  style={{ opacity: on ? 1 : 0.45 }}>
                  <i className="sw flex-none" style={{ background: pal(ti, p.palKey) }} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{t.name}</span>
                  <span className="mono flex-none text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                    {counts[ti]?.toLocaleString() ?? 0}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 px-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Only what these figures draw. No statistic is recomputed, and the markers,
            differential expression and composition tabs are untouched — on the feature plot
            a hidden population stays as the grey outline so the embedding keeps its shape.
          </p>
        </div>
      )}
    </div>
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
  // Every sampled cell in the panel, which on the atlas is 133 clusters × 20
  // groups × 400 — a spread of that many arguments is the RangeError that
  // unmounts the tab, so the extent is taken by loop. See maxOf in chart.ts.
  const hi = maxOfAll(scaled) * 1.06 || 1
  const lo = 0
  const Y = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo))
  const bw = (W - PL - PR) / per

  const dl = p.groupBy === 'type' ? 0
    : Math.log2((p.src.mean(p.gene, p.types.findIndex(t => t.name === p.ct), p.cs) + 0.05)
      / (p.src.mean(p.gene, p.types.findIndex(t => t.name === p.ct), p.ctrl) + 0.05))
  const pcts = cats.map(c => p.src.pct(p.gene, c.ti, p.groupBy === 'type' ? null : c.cond))
  const maxPct = maxOf(pcts)

  return (
    <Figure name={`${p.gene}_violin`} className="pt-5">
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
          const col = c.dim !== undefined ? mix('#e2e8f0', c.color, 0.3 + c.dim * 0.7) : c.color
          return (
            <g key={c.full}>
              {/* A cluster can hold no cells at all in one group — cell type ×
                  group on the atlas is mostly empty — and there is no
                  distribution to draw for it. quantiles of nothing are NaN, and
                  SVG rejects a NaN attribute one at a time: 272 console errors
                  per render, which is enough to bury a real one. The slot keeps
                  its tick and stays blank. */}
              {v.length > 0 && (
                <Violin v={v} cx={cx} bw={bw} col={col} lo={lo} hi={hi} Y={Y}
                  pct={pcts[i]} gene={p.gene} yDet={H - PB + 3} />
              )}
              <text className="axis" transform={`rotate(-42 ${cx} ${H - PB + DET + 11})`}
                x={cx} y={H - PB + DET + 11} textAnchor="end"
                style={{ fontSize: per > 10 ? 9 : 10 }}>{c.label}</text>
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
    </Figure>
  )
}

/** One category's distribution: outline, box, median, and the detection bar. */
function Violin({ v, cx, bw, col, lo, hi, Y, pct, gene, yDet }: {
  v: number[]
  cx: number
  bw: number
  col: string
  lo: number
  hi: number
  Y: (value: number) => number
  pct: number
  gene: string
  yDet: number
}) {
  const q = quantiles(v)
  const dens = density(v, lo, hi)
  const half = bw * 0.36
  const pts = [
    ...dens.map((x, k) => `${(cx + x * half).toFixed(1)},${Y(lo + (hi - lo) * k / 26).toFixed(1)}`),
    ...dens.map((x, k) => `${(cx - x * half).toFixed(1)},${Y(lo + (hi - lo) * k / 26).toFixed(1)}`).reverse(),
  ].join(' ')
  const bwid = Math.max(1, bw * 0.62 * pct)
  return (
    <>
      <polygon points={pts} fill={col} opacity=".26" />
      <line x1={cx} x2={cx} y1={Y(q.q1)} y2={Y(q.q3)} stroke={col}
        strokeWidth={Math.max(2, Math.min(6, bw * 0.34))} opacity=".65" />
      <line x1={cx - Math.min(8, bw * 0.4)} x2={cx + Math.min(8, bw * 0.4)}
        y1={Y(q.med)} y2={Y(q.med)} stroke={col} strokeWidth={2} />
      {/* Detection bar. Without it a gene with heavy dropout is just a spike
          at zero, with no way to tell "absent here" from "absent everywhere". */}
      <rect x={cx - bwid / 2} y={yDet} width={bwid} height={3.5} rx={1.75}
        fill={col} opacity=".8">
        <title>{(pct * 100).toFixed(0)}% of cells detect {gene}</title>
      </rect>
    </>
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
  const cw = 42, rh = 26, PT = 14, PR = 26
  // The left margin follows the longest identity — "Oligodendrocyte · Reactivated"
  // is more than twice the width of "TAP", and a clipped row label is unreadable.
  const PL = Math.max(110, Math.min(250, 22 + maxOf(rows.map(r => r.full.length)) * 6.1))
  const labelH = Math.min(96, 24 + maxOf(genes.map(g => g.length)) * 4.6)
  // The legend is part of the figure, in the figure. It used to be laid out in
  // HTML beside it, so every exported dot plot arrived in a manuscript with no
  // size key and no colour bar — the two things that make the marks mean
  // anything.
  // Wide enough for the legends, not just for the data — the two keys sit side
  // by side under the panel and the figure has to make room for them.
  const legendH = 74
  const BAR_W = 150
  const W = Math.max(PL + genes.length * cw + PR, PL + 430)
  const plotB = PT + rows.length * rh
  const H = plotB + labelH + legendH

  const avg = rows.map(r => genes.map(g => p.src.mean(g, r.ti, p.groupBy === 'type' ? null : r.cond)))
  const cv = genes.map((_g, gi) => {
    const col = rows.map((_r, ri) => avg[ri][gi])
    if (!p.dotScale) return col
    const m = col.reduce((a, b) => a + b, 0) / col.length
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length) || 1
    return col.map(x => Math.max(-2.5, Math.min(2.5, (x - m) / sd)))
  })
  const lo = p.dotScale ? -2.5 : 0
  const hi = p.dotScale ? 2.5 : Math.max(maxOfAll(avg), 0.01)
  const radius = (f: number) => +(1.4 + f * 9).toFixed(2)
  const X = (gi: number) => PL + cw * (gi + 0.5)
  const Y = (ri: number) => PT + rh * (ri + 0.5)

  return (
    <>
      <Figure name="dotplot" className="pt-5">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
            aria-label={`Dot plot of ${genes.join(', ')}`}>
            {/* Grid first, so the marks sit on it rather than under it. Banded
                rows were doing this job and doing it badly: a stripe is a block
                of colour competing with the data for the reader's eye, where a
                hairline just carries it across a wide panel. */}
            {rows.map((r, ri) => (
              <line key={`h${r.full}`} x1={PL} x2={PL + genes.length * cw}
                y1={Y(ri)} y2={Y(ri)} stroke={GRID_INK} strokeWidth={0.6} />
            ))}
            {genes.map((g, gi) => (
              <line key={`v${g}`} x1={X(gi)} x2={X(gi)} y1={PT} y2={plotB}
                stroke={GRID_INK} strokeWidth={0.6} />
            ))}

            {/* Axes and ticks in black — SCpubr sets axis.text and axis.ticks to
                black rather than the theme's grey, because a figure is judged on
                paper where grey-on-white reads as faint. */}
            <line x1={PL} x2={PL} y1={PT} y2={plotB} stroke={AXIS_INK} strokeWidth={0.8} />
            <line x1={PL} x2={PL + genes.length * cw} y1={plotB} y2={plotB}
              stroke={AXIS_INK} strokeWidth={0.8} />

            {rows.map((r, ri) => (
              <g key={r.full}>
                <line x1={PL - 3.5} x2={PL} y1={Y(ri)} y2={Y(ri)} stroke={AXIS_INK} strokeWidth={0.8} />
                <text x={PL - 8} y={Y(ri) + 4} textAnchor="end"
                  style={{ fontSize: 11.5, fill: AXIS_INK, fontWeight: 600 }}>{r.full}</text>
              </g>
            ))}

            {rows.map((r, ri) => genes.map((g, gi) => {
              const pct = p.src.pct(g, r.ti, p.groupBy === 'type' ? null : r.cond)
              if (pct < 0.01) return null
              return (
                // shape 21 in SCpubr's terms: a filled mark with a black edge.
                // Without it a z-scored plot is mostly pale dots with no border,
                // and the reader cannot tell a small faint dot from the page.
                <circle key={`${r.full}-${g}`} cx={X(gi)} cy={Y(ri)} r={radius(pct)}
                  fill={rampColor((cv[gi][ri] - lo) / (hi - lo), p.rampKey)}
                  stroke={MARK_EDGE} strokeWidth={0.7}>
                  <title>
                    {g} in {r.full} — {(pct * 100).toFixed(0)}% of cells,
                    mean {avg[ri][gi].toFixed(2)}
                  </title>
                </circle>
              )
            }))}

            {genes.map((g, gi) => {
              const yb = plotB + 12
              return (
                <g key={g}>
                  <line x1={X(gi)} x2={X(gi)} y1={plotB} y2={plotB + 3.5}
                    stroke={AXIS_INK} strokeWidth={0.8} />
                  <text transform={`rotate(-45 ${X(gi)} ${yb})`} x={X(gi)} y={yb}
                    textAnchor="end"
                    style={{ fontStyle: 'italic', fontSize: 11, fill: AXIS_INK }}>{g}</text>
                </g>
              )
            })}

            {/* Both keys centred under the panel, SCpubr's legend.position =
                "bottom". The colour bar leads because it is the one a reader
                consults per mark; the size key is read once. */}
            <ColorBar
              cx={PL + (W - PL) * 0.32} y={H - legendH + 22} w={BAR_W} h={11}
              ramp={p.rampKey} lo={lo} hi={hi}
              breaks={p.dotScale ? [-2.5, -1.25, 0, 1.25, 2.5] : undefined}
              title={p.dotScale ? 'Avg. Exp. (z-scored)' : 'Avg. Exp.'}
              id="dotplot-bar"
            />
            <SizeKey cx={PL + (W - PL) * 0.78} y={H - legendH + 22}
              title="Percent Expressed" radius={radius} />
          </svg>
        </div>
      </Figure>

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
  const anyHidden = p.hidden.size > 0

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
        <span style={{ color: 'var(--ink-3)' }}>{p.clip === 1 ? 'max' : `${(p.clip * 100).toFixed(0)}th pct`}</span>
        <span style={{ color: 'var(--ink-3)' }}>
          · each gene on its own scale · positive cells drawn last
        </span>
        {(split || anyHidden) && (
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#E2E5EA' }} />
            {anyHidden && split ? 'hidden cells and other groups'
              : anyHidden ? 'hidden cells' : 'the other groups'} — kept as the outline
          </span>
        )}
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
    // Clipped at a percentile of the expressing cells, so one runaway cell
    // cannot flatten every other panel to the floor colour. SCpubr exposes this
    // as max.cutoff for the same reason, and like it, values above the ceiling
    // are drawn at the ceiling rather than dropped.
    return { vals: v, top: p.clip >= 1 ? maxOf(v) : nonZeroPercentile(v, p.clip) }
  }, [gene, p.src, p.clip])

  const names = p.src.names
  const accession = names.other?.[geneIndex(names.display).get(gene) ?? -1] ?? null

  return (
    <figure>
      {/* The gene, the group and the scale are drawn INSIDE the canvas now, so
          they travel with the exported file. What stays here is the one thing
          that is reference rather than figure: the accession, which belongs
          beside the plot on screen and in a methods line, not on the plot. */}
      {accession && (
        <figcaption className="mono mb-1 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
          {accession}
        </figcaption>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}>
        {panels.map(pan => (
          <div key={pan ?? 'all'}>
            <FeatureCanvas p={p} vals={vals} top={top} cond={pan} size={size} gene={gene}
              name={`${gene}${pan ? `_${pan}` : ''}_feature`} />
          </div>
        ))}
      </div>
    </figure>
  )
}

function FeatureCanvas({ p, vals, top, cond, size, name, gene }: {
  p: GeneProps; vals: Float32Array; top: number; cond: string | null; size: number
  name: string; gene: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  // Everything the drawing needs, assembled once. `redraw` below hands the same
  // object to an offscreen canvas at export size, which is what keeps the saved
  // figure identical to the one on screen.
  const spec = useMemo(() => {
    const xy = p.emb.xy
    const hidden = p.hidden
    const at = size >= 200 ? clusterCentroids(xy, p.src.d, p.types.length) : null
    return {
      xy,
      extent: embedExtent(xy),
      vals,
      cells: p.src.d.cells,
      cond,
      visible: (c: Cell) => !hidden.has(c.t),
      top,
      floor: 0,
      ramp: p.rampKey,
      labels: at
        ? p.types.map((t, ti) => ({ name: t.name, x: at[ti].x, y: at[ti].y }))
          .filter((_l, ti) => !hidden.has(ti))
        : null,
      borders: p.borders,
      silhouette: true,
      background: getComputedStyle(document.documentElement)
        .getPropertyValue('--surface').trim() || '#ffffff',
      title: gene,
      subtitle: cond,
    }
  }, [p.emb, p.src, p.types, p.hidden, p.rampKey, p.borders, vals, top, cond, size, gene])

  const dark = useMemo(
    () => document.documentElement.classList.contains('dark')
      || matchMedia('(prefers-color-scheme: dark)').matches, [])

  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (cv && ctx) drawFeature(ctx, cv.width, cv.height, spec, dark)
  }, [spec, dark])

  return (
    <Figure
      name={name}
      redraw={(out, w, h) => {
        const ctx = out.getContext('2d')
        // A figure going into a manuscript is printed on white, whatever theme
        // it was exported from, and the cluster labels have to be legible on it.
        if (ctx) drawFeature(ctx, w, h, { ...spec, background: '#ffffff' }, false)
      }}
    >
      <canvas
        ref={ref} width={Math.round(size * 2)} height={panelHeight(Math.round(size * 2))}
        style={{ width: '100%', maxWidth: Math.round(size), height: 'auto', borderRadius: 9 }}
      />
    </Figure>
  )
}
