import { useMemo, useState } from 'react'
import type { CellType, GroupBy, PlotKind } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { condLabel } from '../lib/stats.ts'
import { identities } from '../lib/chart.ts'
import { geneIndex, MAX_GENES, mergeGenes, parseGeneList, rankGenes, SEPS } from '../lib/genes.ts'
import {
  DIVERGING, pal, RAMPS, SEQUENTIAL, type PaletteKey, type RampKey,
} from '../lib/palette.ts'
import ViolinPanel from './gene/ViolinPanel.tsx'
import DotPlot from './gene/DotPlot.tsx'
import FeaturePlot from './gene/FeaturePlot.tsx'
import { Card, Chips, Seg } from './Ui.tsx'

export interface GeneProps {
  src: Source
  types: CellType[]
  /**
   * No shared cell type here.
   *
   * This tab keeps its own, beside the figures that use it — see the state
   * below. It used to take App's as well, and `describe()` read THAT one, so
   * the caption named the cluster selected on the DEG tab while the violins
   * drew the one selected here.
   */
  ctrl: string[]
  cs: string[]
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
  /**
   * The scale used when the dot plot z-scores each gene.
   *
   * Separate from `rampKey` because it describes a different quantity. A
   * z-score has a meaningful zero and raw expression does not, so the two want
   * different kinds of scale and the reader's choice of each should survive
   * toggling between them.
   */
  rampDiv: RampKey
  onRampDiv: (k: RampKey) => void
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

  /**
   * The cell type these figures are about, chosen here.
   *
   * It used to be the contrast bar's selection, shared with the DEG tabs. That
   * made this tab move when the reader changed a control that belongs to a
   * different question — and it put a "Control / Compare" pair above a figure
   * that is not a comparison. The type lives with the figures that use it.
   */
  const [ct, setCt] = useState(p.types[0]?.name ?? '')
  const ctName = p.types.some(t => t.name === ct) ? ct : (p.types[0]?.name ?? '')

  // Hidden types leave the violin panel and the dot plot entirely — an identity
  // with no cells is a blank column, and a panel of blank columns is worse than
  // the population the reader was trying to get rid of.
  const ids = identities(p.src.d, p.types, p.groupBy, ctName, p.palKey)
    .filter(i => !p.hidden.has(i.ti))
  const modes: { k: GroupBy; label: string }[] = [
    { k: 'type', label: 'Across cell types' },
    ...(p.src.d.multi
      ? [{ k: 'cond' as const, label: 'Across groups' }, { k: 'both' as const, label: 'Cell type × group' }]
      : []),
  ]

  return (
    <Card>
      {/* The field sits under the heading that names it, not opposite it. Across
          the card it was the furthest thing on the page from "Search any gene",
          and from the chips it fills — the eye had to cross the whole card and
          come back. */}
      <div>
        <div className="eyebrow">Gene expression</div>
        <h2 className="mt-1 tx-title font-semibold">Search any gene</h2>
        <div className="relative mt-2">
          <input
            className="inp mono w-full max-w-[320px]" value={q} autoComplete="off"
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
              className="menu-in absolute left-0 top-full z-40 mt-1 w-[320px] max-w-full overflow-hidden rounded-[--r-md]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line-2)',
                       boxShadow: 'var(--shadow-menu)' }}
            >
              {hits.map(g => (
                <button
                  key={g} type="button"
                  className={`mono block w-full px-[11px] py-1.5 text-left tx-small ${
                    g.toLowerCase() === q.trim().toLowerCase() ? 'font-bold' : ''}`}
                  style={g.toLowerCase() === q.trim().toLowerCase() ? { color: 'var(--ink)' } : undefined}
                  onClick={() => { p.onGenes(mergeGenes(p.genes, [g])); setMissing([]); setQ('') }}
                >
                  {g}
                  {/* The accession under the symbol: a symbol is not a stable
                      identifier, and two rows can carry the same one. Skipped
                      when the name already carries it, which is exactly the
                      case of a symbol two rows share. */}
                  {idOf(g) && !g.includes(idOf(g)!) && (
                    <span className="block tx-micro font-normal"
                      style={{ color: 'var(--ink-3)' }}>{idOf(g)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-1.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
        One gene, or paste up to {MAX_GENES}. Case and separator do not matter.
        {/* The naming story is a fact about THIS object, so it stays — but as
            one clause with the detail in the tooltip, not four sentences. */}
        {names.renamed && (
          <span title={`Symbols come from ${names.aliasColumn ?? 'the object'} in the same file`
            + `${names.duplicated > 0 ? `; ${names.duplicated} rows share a symbol and carry their accession` : ''}`
            + `${names.missing > 0 ? `; ${names.missing} rows have no symbol` : ''}`}>
            {' '}Indexed by <b>{names.idKind ?? 'accession'}s</b> — search either.
          </span>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.genes.length === 0 && (
          <span className="tx-small" style={{ color: 'var(--ink-3)' }}>No genes selected yet.</span>
        )}
        {p.genes.map(g => (
          <span
            key={g}
            className="inline-flex items-center gap-0.5 rounded-full py-[3px] pl-2.5 pr-[5px] tx-small font-semibold italic"
            style={{ background: 'var(--sunk)', color: 'var(--ink)', border: '1px solid var(--line-2)' }}
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
          <button className="btn btn-quiet" onClick={() => { p.onGenes([]); setMissing([]) }}>Clear all</button>
        )}
      </div>

      {missing.length > 0 && (
        <p className="mt-2 tx-small" style={{ color: 'var(--warn)' }}>
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
        {/* Only where it changes the answer: across cell types every type is on
            screen, so there is nothing to pick. */}
        {p.groupBy !== 'type' && (
          <>
            <div className="gsep h-6" />
            <label className="flex items-center gap-1.5">
              <span className="glabel">Cell type</span>
              <select className="sel" value={ctName} onChange={e => setCt(e.target.value)}>
                {p.types.filter((_t, i) => !p.hidden.has(i))
                  .map(t => <option key={t.key} value={t.name}>{t.name}</option>)}
              </select>
            </label>
          </>
        )}

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
            {/* Diverging scales while the values are z-scores, sequential ones
                while they are expression. Offering all of them in both modes
                lets a reader put raw expression — which starts at zero and has
                no negative side — on a scale whose whole point is the sign. */}
            <label className="flex items-center gap-1.5">
              <span className="glabel">Colour</span>
              <select className="sel" value={p.dotScale ? p.rampDiv : p.rampKey}
                onChange={e => (p.dotScale ? p.onRampDiv : p.onRamp)(e.target.value as RampKey)}>
                {(p.dotScale ? DIVERGING : SEQUENTIAL).map(k => (
                  <option key={k} value={k}>{RAMPS[k].label}</option>
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
                  Relative to {condLabel(p.ctrl)}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <CellFilter p={p} />

      <p className="sub mt-2.5">{describe(p, ctName)}</p>

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
        <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>
          {p.hidden.size === 0
            ? `all ${total}`
            : `${shown} of ${total} — hiding ${[...p.hidden].slice(0, 3)
              .map(ti => p.types[ti]?.name).filter(Boolean).join(', ')}${
              p.hidden.size > 3 ? ` and ${p.hidden.size - 3} more` : ''}`}
        </span>
        {p.hidden.size > 0 && (
          <button className="btn btn-quiet" onClick={() => p.onHidden(new Set())}>Show all</button>
        )}
      </div>
      {open && (
        <div className="panel mt-2">
          <div className="grid gap-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>
            {p.types.map((t, ti) => {
              const on = !p.hidden.has(ti)
              return (
                <button key={t.key} onClick={() => toggle(ti)} aria-pressed={on}
                  className="type-toggle flex items-center gap-1.5 rounded-[--r-md] px-2 py-1 text-left"
                  style={{ opacity: on ? 1 : 0.45 }}>
                  <i className="sw flex-none" style={{ background: pal(ti, p.palKey) }} />
                  <span className="min-w-0 flex-1 truncate tx-micro">{t.name}</span>
                  <span className="mono flex-none tx-micro" style={{ color: 'var(--ink-3)' }}>
                    {counts[ti]?.toLocaleString() ?? 0}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 px-1 tx-micro" style={{ color: 'var(--ink-3)' }}>
            These figures only. No statistic is recomputed and no other tab moves.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * One clause naming what the figure below is.
 *
 * These were five paragraphs of 24 to 44 words explaining why each plot is
 * drawn the way it is — the ordering rule, the shared scale, the independent y
 * axes. All of it is true, and all of it is now in Methods; here it sat between
 * the controls and the figure on every single visit.
 */
function describe(p: GeneProps, ctName: string) {
  if (p.plot === 'dot') return 'Dot size is the fraction detected; colour is the mean.'
  if (p.plot === 'feature')
    return `On the embedding, one panel per gene${
      p.groupBy !== 'type' && p.src.d.multi ? ", split by group on that gene's scale" : ''}.`
  if (p.groupBy === 'type') return 'One violin per cell type, each gene on its own y axis.'
  if (p.groupBy === 'cond') return `Groups in the object's own order, within ${ctName}.`
  return 'Every cell type split by group.'
}

