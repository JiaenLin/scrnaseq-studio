import { useMemo, useState } from 'react'
import { COLUMN_NOUN } from '../lib/columns.ts'
import type { CellType, GroupBy, PlotKind } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { condLabel } from '../lib/stats.ts'
import { identities } from '../lib/chart.ts'
import { populations } from '../lib/sentinels.ts'
import { geneIndex, MAX_GENES, mergeGenes, parseGeneList, rankGenes, SEPS } from '../lib/genes.ts'
import {
  DIVERGING, pal, RAMPS, SEQUENTIAL, type PaletteKey, type RampKey,
} from '../lib/palette.ts'
import ViolinPanel from './gene/ViolinPanel.tsx'
import DotPlot from './gene/DotPlot.tsx'
import FeaturePlot from './gene/FeaturePlot.tsx'
import { Field, InRail, Opts, RailGroup, Steps, Toggle } from './Rail.tsx'
import { Stage } from './Stage.tsx'

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
  /**
   * Order the dot plot by similarity rather than by storage order.
   *
   * Off by default: the object's own cluster order is often deliberate — a
   * developmental series, a numbered Leiden partition — and silently
   * rearranging it would hide that. On, it is what pheatmap and scanpy draw,
   * and it is how you see which populations resemble each other.
   */
  const [cluster, setCluster] = useState(false)
  /**
   * Which way round the dot plate is drawn.
   *
   * Seurat's orientation — identities down the side, genes along the bottom —
   * is the default and is right for the handful of genes this tab used to
   * hold. It is the wrong one for a marker panel: fifty genes along the bottom
   * is a figure wider than any page with every name rotated, where fifty genes
   * down the side is a column you scroll. pheatmap, ComplexHeatmap and scanpy's
   * dotplot all draw it that way round, so this is the other convention rather
   * than a new one. Nothing about the numbers changes.
   */
  const [flipDot, setFlipDot] = useState(false)
  // A sentinel is not a cell type to look inside, so it is never the default
  // and never offered — see identities(), which leaves it out of every axis.
  const firstType = p.types.find(t => !t.sentinel)?.name ?? ''
  const [ct, setCt] = useState(firstType)
  const ctName = p.types.some(t => t.name === ct && !t.sentinel) ? ct : firstType

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
    <div>
      {/* The question on the left (which genes, which plot, how it is drawn),
          the answer on the stage. The controls were five rows of pills between
          the title and the figure, so the figure began below the fold. */}
      <InRail>
        <RailGroup label="Search any gene">
          <div className="relative">
            <input
              className="inp mono w-full" value={q} autoComplete="off"
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
                className="menu-in absolute left-0 top-full z-40 mt-1 w-full overflow-hidden rounded-[--r-lg]"
                style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-menu)' }}
              >
                {hits.map(g => (
                  <button
                    key={g} type="button"
                    className={`mono block w-full px-2 py-1.5 text-left tx-small ${
                      g.toLowerCase() === q.trim().toLowerCase() ? 'font-semibold' : ''}`}
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
          <p className="hint m-0">
            One gene, or paste up to {MAX_GENES}. Case and separator do not matter.
            {/* The naming story is a fact about THIS object, so it stays — but as
                one clause with the detail in the tooltip, not four sentences. */}
            {names.renamed && (
              <span title={`Symbols come from ${names.aliasColumn ?? 'the object'} in the same file`
                + `${names.duplicated > 0 ? `; ${names.duplicated} rows share a symbol and carry their accession` : ''}`
                + `${names.missing > 0 ? `; ${names.missing} rows have no symbol` : ''}`}>
                {' '}Indexed by <b>{names.idKind ?? 'accession'}s</b> : search either.
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {p.genes.length === 0 && (
              <span className="tx-small" style={{ color: 'var(--ink-3)' }}>No genes selected yet.</span>
            )}
            {p.genes.map(g => (
              <span
                key={g}
                className="inline-flex h-[--h-sm] items-center rounded-[--r-md] pl-2 pr-0.5 tx-small font-medium italic"
                style={{ background: 'var(--press)', color: 'var(--ink)' }}
                title={idOf(g) ? `${g} (${idOf(g)})` : g}
              >
                {g}
                <button
                  className="border-0 bg-transparent px-1.5 not-italic opacity-60 hover:opacity-100"
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
            <p className="m-0 tx-small" style={{ color: 'var(--warn)' }}>
              <b>Not in this object:</b> <span className="mono">{missing.join(', ')}</span>. Check the
              species and capitalization (mouse <span className="mono">Ascl1</span> vs human{' '}
              <span className="mono">ASCL1</span>).
            </p>
          )}
        </RailGroup>

        <RailGroup label="Plot">
          <Opts<PlotKind>
            value={p.plot} onChange={p.onPlot}
            options={[
              { k: 'violin', label: 'Violin panel' },
              { k: 'dot', label: 'Dot plot' },
              { k: 'feature', label: 'Feature plot' },
            ]}
          />
        </RailGroup>

        <RailGroup label="Group by">
          <Opts<GroupBy> value={p.groupBy} onChange={p.onGroupBy} options={modes} />
          {/* Only where it changes the answer: across cell types every type is on
              screen, so there is nothing to pick. */}
          {p.groupBy !== 'type' && (
            <Field label="Cell type">
              <select className="sel" value={ctName} onChange={e => setCt(e.target.value)}>
                {p.types.filter((t, i) => !t.sentinel && !p.hidden.has(i))
                  .map(t => <option key={t.key} value={t.name}>{t.name}</option>)}
              </select>
            </Field>
          )}
        </RailGroup>

        <RailGroup label="Figure">
          {p.plot === 'dot' ? (
            <>
              <Toggle on={p.dotScale} onChange={p.onDotScale}
                title="Seurat scale = TRUE: z-score each gene across the columns">Scale each gene</Toggle>
              {/* Diverging scales while the values are z-scores, sequential ones
                  while they are expression: raw expression starts at zero and has
                  no negative side, so it never goes on a scale whose point is the sign. */}
              <Field label="Colour">
                <select className="sel" value={p.dotScale ? p.rampDiv : p.rampKey}
                  onChange={e => (p.dotScale ? p.onRampDiv : p.onRamp)(e.target.value as RampKey)}>
                  {(p.dotScale ? DIVERGING : SEQUENTIAL).map(k => (
                    <option key={k} value={k}>{RAMPS[k].label}</option>
                  ))}
                </select>
              </Field>
              <Toggle on={cluster} onChange={setCluster}
                title="Order rows and columns by similarity, and draw the trees">Cluster rows &amp; genes</Toggle>
              <Toggle on={flipDot} onChange={setFlipDot}
                title={`Swap the axes: genes down the side, ${COLUMN_NOUN[p.groupBy].many} along the bottom`}>Transpose</Toggle>
              <p className="hint m-0">{flipDot ? 'genes down the side' : 'genes along the bottom'}</p>
            </>
          ) : (
            <>
              <Field label="Columns">
                <Steps value={p.cols} options={[1, 2, 3, 4]} onChange={p.onCols} />
              </Field>
              {p.plot === 'feature' && (
                <>
                  <Field label="Colour">
                    <select className="sel" value={p.rampKey}
                      onChange={e => p.onRamp(e.target.value as RampKey)}>
                      {Object.entries(RAMPS).map(([k, r]) => (
                        <option key={k} value={k}>{r.label}</option>
                      ))}
                    </select>
                  </Field>
                  {/* The ceiling of the colour scale. One cell at ten times the
                      next-highest value flattens every other cell onto the floor
                      colour; SCpubr exposes the same control as max.cutoff. Values
                      above the ceiling are drawn at the ceiling, never dropped. */}
                  <Field label="Scale to" title="Expression mapped to the top of the colour scale">
                    <select className="sel" value={p.clip}
                      onChange={e => p.onClip(Number(e.target.value))}>
                      <option value={0.9}>90th percentile</option>
                      <option value={0.95}>95th percentile</option>
                      <option value={0.99}>99th percentile</option>
                      <option value={1}>the maximum</option>
                    </select>
                  </Field>
                  <Toggle on={p.borders} onChange={p.onBorders}
                    title="A ring around each cell: clearer in print, slower on a large object">Cell borders</Toggle>
                </>
              )}
              {p.plot === 'violin' && p.src.d.multi && p.groupBy === 'cond' && (
                <Toggle on={p.relative} onChange={p.onRelative}>Relative to {condLabel(p.ctrl)}</Toggle>
              )}
            </>
          )}
        </RailGroup>

        <CellFilter p={p} />
      </InRail>

      <Stage head={<>
        <h2 className="stage-title">Gene expression</h2>
        <span className="stage-meta">{describe(p, ctName)}</span>
      </>}>
        {p.genes.length === 0
          ? <div className="empty">Search a gene on the left.</div>
          : p.plot === 'dot' ? <DotPlot {...p} ids={ids} cluster={cluster} flip={flipDot} />
          : p.plot === 'feature' ? <FeaturePlot {...p} />
          : <ViolinPanel {...p} ids={ids} />}
      </Stage>
    </div>
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

  // Populations only: a sentinel is in no figure here, so it is not a toggle.
  const total = populations(p.types).length
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
    <RailGroup label="Cell types shown">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          {open ? '▾' : '▸'} {open ? 'Hide the list' : 'Choose'}
        </button>
        <span className="hint">
          {p.hidden.size === 0
            ? `all ${total}`
            : `${shown} of ${total}, hiding ${[...p.hidden].slice(0, 3)
              .map(ti => p.types[ti]?.name).filter(Boolean).join(', ')}${
              p.hidden.size > 3 ? ` and ${p.hidden.size - 3} more` : ''}`}
        </span>
        {p.hidden.size > 0 && (
          <button className="btn btn-quiet" onClick={() => p.onHidden(new Set())}>Show all</button>
        )}
      </div>
      {open && (
        <>
          <div className="flex flex-col">
            {p.types.map((t, ti) => {
              if (t.sentinel) return null
              const on = !p.hidden.has(ti)
              return (
                <button key={t.key} onClick={() => toggle(ti)} aria-pressed={on}
                  className="type-toggle flex h-[--h-sm] items-center gap-2 rounded-[--r-sm] border-0 bg-transparent px-2 text-left"
                  style={{ opacity: on ? 1 : 0.45 }}>
                  <i className="sw flex-none" style={{ background: pal(ti, p.palKey) }} />
                  <span className="min-w-0 flex-1 truncate tx-small">{t.name}</span>
                  <span className="num flex-none tx-small" style={{ color: 'var(--ink-2)' }}>
                    {counts[ti]?.toLocaleString() ?? 0}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="hint m-0">
            These figures only. No statistic is recomputed and no other tab moves.
          </p>
        </>
      )}
    </RailGroup>
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
  // "colour is the mean" was printed whatever the scaling, so with Scale each
  // gene on this line and the caption under the same figure said two different
  // things — one of them wrong. Reported as the dot plot and the violins
  // disagreeing, which they were also doing for a second and better reason: the
  // violin's box is the median and quartiles, and this is the mean.
  if (p.plot === 'dot') {
    return p.dotScale
      ? 'Dot size is the fraction detected; colour is the mean, z-scored down each gene.'
      : 'Dot size is the fraction detected; colour is the mean.'
  }
  if (p.plot === 'feature')
    return `On the embedding, one panel per gene${
      p.groupBy !== 'type' && p.src.d.multi ? ", split by group on that gene's scale" : ''}.`
  if (p.groupBy === 'type') return 'One violin per cell type, each gene on its own y axis.'
  if (p.groupBy === 'cond') return `Groups in the object's own order, within ${ctName}.`
  return 'Every cell type split by group.'
}

