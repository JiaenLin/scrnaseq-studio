import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CellType, Dataset, GroupBy } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { axisRange, clusterCentroids, density, embedExtent, quantiles, minOf, maxOf } from '../lib/chart.ts'
import {
  aggregateColumns, finePartition, scoreColumns, zByRow, type Column,
} from '../lib/columns.ts'
import ColumnFilter from './ColumnFilter.tsx'
import { axisTicks, widestW } from '../lib/labels.ts'
import { dendroLines, orderRows } from '../lib/cluster.ts'
import { ColorBar } from './svg-parts.tsx'
import { breaksOf, fmtBreak } from '../lib/breaks.ts'
import type { LibraryState } from '../lib/genesets.ts'
import type { Collection } from '../lib/msigdb.ts'
import type { Detection, Species } from '../lib/species.ts'
import GeneSetSources from './GeneSetSources.tsx'
import {
  averagesSpec, geneAveragesSync, resolve, SCORE_DEFAULTS, scoreInline, scorePlan, summarise,
} from '../lib/score.ts'
import { onGround, AXIS_INK, FIG_TYPE, PRINT_PLATE } from '../lib/figure-ink.ts'
import { nNote, pairName } from '../lib/figure-foot.ts'
import { drawFeature, panelHeight, type FeatureDraw } from '../lib/feature-plot.ts'
import { useDark } from '../lib/theme.ts'
import { useWidth } from '../lib/use-width.ts'
import { rampColor, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { Empty, Mono, Seg } from './Ui.tsx'
import { InRail, Opts, RailGroup, Toggle } from './Rail.tsx'
import { InHead, Section, Stage } from './Stage.tsx'
import Figure, { CsvButton } from './Figure.tsx'
import { useJob } from '../lib/compute.ts'
import Progress, { Failed } from './Progress.tsx'

/**
 * The card between deciding to compute and the first word back from the worker.
 *
 * A zero total is what Progress draws as "starting", so this needs no start
 * time — there is nothing yet to estimate from, and a guess would be the one
 * kind of progress this studio does not show.
 */
const STARTING = { phase: '', done: 0, total: 0, startedAt: 0 }

export type SetsView = 'one' | 'many'

export default function GeneSets({
  src, types, emb, palKey, rampKey, rampDiv, onPickGene, onCorrelate,
  lib, species, sources, onSources, customSets, onCustomSets,
  detected, scoreRan, onScoreRan, view, onView, many,
}: {
  /** One set on the embedding, or several sets side by side. */
  view: SetsView
  onView: (v: SetsView) => void
  /** The several-sets view, which is given the switch to put in its head line. */
  many: (switcher: React.ReactNode) => React.ReactNode
  src: Source
  types: CellType[]
  /** Which of the object's embeddings to draw the score on. */
  emb: Embedding
  palKey: PaletteKey
  rampKey: RampKey
  /** The reader's scale for signed quantities — here, the per-gene z-scores. */
  rampDiv: RampKey
  onPickGene: (g: string) => void
  /**
   * Send this set's genes to Co-expression as a seed.
   *
   * The bridge exists so the MSigDB picker does not have to be built twice. A
   * module score says how strongly each CELL expresses a signature; a
   * correlation says which OTHER genes move with it, which is the question
   * people ask immediately afterwards and had nowhere to ask.
   */
  onCorrelate: (genes: string[]) => void
  lib: LibraryState
  species: Species
  sources: string[]
  onSources: (next: string[]) => void
  customSets: readonly Collection[]
  onCustomSets: (next: Collection[]) => void
  detected: Detection | null
  /** The gene list the reader has actually asked to score, joined. */
  scoreRan: string | null
  onScoreRan: (key: string | null) => void
}) {
  const d = src.d
  const GENES = src.genes
  const [setId, setSetId] = useState('')
  const [find, setFind] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [heat, setHeat] = useState(false)
  const [heatCluster, setHeatCluster] = useState(true)
  /**
   * Whether the per-gene heatmap z-scores each row.
   *
   * On is Seurat's DoHeatmap and pheatmap's `scale = "row"`, and it is still
   * the default: it makes every row say where THAT gene is highest, which is
   * the comparison the rows are for. Off is the other honest question — how
   * much of each gene there actually is — and until now the figure could not
   * answer it. A set of ribosomal genes z-scores into a picture of noise; the
   * raw means say plainly that all of them are large everywhere.
   */
  const [heatScale, setHeatScale] = useState(true)
  /** Which way round the plate is drawn — see the same switch on the dot plot. */
  const [heatFlip, setHeatFlip] = useState(false)
  /** The heatmap's own grouping, independent of the violins above it. */
  const [heatBy, setHeatBy] = useState<GroupBy>('type')
  /**
   * Columns the reader has taken out of the heatmap.
   *
   * By cluster index and by group NAME, not by position in the identity list —
   * so a group switched off stays off when the grouping changes from cell type
   * to cell type × group, which is exactly when a reader wants to keep it off.
   */
  const [hideT, setHideT] = useState<Set<number>>(new Set())
  const [hideC, setHideC] = useState<Set<string>>(new Set())

  /**
   * Every set in the enabled collections — names only.
   *
   * The old picker was a <select> over eighteen hand-written sets. MSigDB has
   * 35 361 for human, which no dropdown can hold, so the control below is a
   * search field over this list and the select is gone.
   *
   * What this deliberately does NOT do is resolve the members. It used to build
   * `genes: Array.from(s.genes, i => c.symbols[i])` for every set here, which
   * on the default collections is 960 067 strings allocated to render a list of
   * forty — and 4.1 million with every collection switched on. The members of
   * one set are wanted only once somebody picks it, so they are read there.
   */
  const allSets = useMemo(() => lib.collections.flatMap(
    (c, ci) => c.sets.map((s, si) => ({
      // n is the member COUNT, which the picker shows. Reading .length off the
      // index array costs nothing; building the array of symbols to count it is
      // what this whole memo exists to avoid.
      //
      // `hay` is the search key, lower-cased ONCE here rather than rebuilt per
      // candidate per keystroke — 35 361 concatenations and lower-casings for
      // every character typed, which is what the search used to cost.
      id: s.id, name: s.name, source: c.source, ci, si, n: s.genes.length,
      hay: `${s.name} ${s.id}`.toLowerCase(),
    }))), [lib.collections])

  /** id -> set, so the chosen one is not found by walking 35 361 entries. */
  const byId = useMemo(() => new Map(allSets.map(s => [s.id, s])), [allSets])

  /**
   * The search text, one beat behind the field.
   *
   * Typing "mitotic cell cycle" is eighteen scans of the library; the reader
   * only wants the last one. The field itself stays uncontrolled-fast — what is
   * deferred is the work, not the keystroke.
   */
  const query = useDeferredValue(find)

  /** The members of one set, resolved on demand. */
  const membersOf = useMemo(() => (ci: number, si: number): string[] => {
    const c = lib.collections[ci]
    const s = c?.sets[si]
    return s ? Array.from(s.genes, i => c.symbols[i]) : []
  }, [lib.collections])

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allSets.slice(0, 40)
    const words = q.split(/\s+/)
    const out = []
    for (const s of allSets) {
      if (words.every(w => s.hay.includes(w))) out.push(s)
      if (out.length >= 40) break
    }
    return out
  }, [allSets, query])

  /**
   * Nothing is chosen until somebody chooses it.
   *
   * This used to fall back to `allSets[0]`, which meant opening the tab began
   * scoring whichever set MSigDB happens to sort first — "Adipogenesis" — over
   * every cell in the object. On a streamed atlas that is a minute of work for
   * a term nobody asked about, started by navigation.
   */
  const chosen = useMemo(() => byId.get(setId) ?? null, [byId, setId])

  /**
   * Which row the arrow keys are on.
   *
   * The picker was a flat list of buttons: to reach the fourth match you tabbed
   * past three, and choosing among 35 361 sets is exactly where that fails.
   * CondPicker in this same app already does listbox-with-arrows properly, so
   * this is the established pattern rather than a new one — the search field
   * keeps focus and owns the list through aria-activedescendant, which is what
   * lets you keep typing while you move.
   */
  const [cursor, setCursor] = useState(0)
  useEffect(() => { setCursor(0) }, [query])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-at="1"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (!hits.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => (c + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const h = hits[cursor]
      if (h) setSetId(h.id)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setCursor(e.key === 'Home' ? 0 : hits.length - 1)
    }
  }

  /**
   * The chosen set's members, resolved here and only here — the picker carries
   * names, not members.
   *
   * There used to be a second mode beside this one, "My own genes", a textarea
   * that scored a pasted list without it ever becoming a collection. It is gone
   * because "Add your own…" replaced the thing it was working around: a pasted
   * list is a collection now, it appears in this picker beside MSigDB's, it can
   * be enabled and disabled, and it is testable in Enrichment as well as
   * scorable here. Two ways in for the same gene list, one of which produced
   * something the rest of the studio could not see, was a fork with nothing on
   * the other side of it.
   */
  const requested = useMemo(
    () => (chosen ? membersOf(chosen.ci, chosen.si) : []),
    [chosen, membersOf])

  const { used, missing } = useMemo(() => resolve(src, requested), [src, requested])

  /**
   * The reader's go-ahead for THIS set.
   *
   * The same rule Markers and the contrast tabs use: an object held in memory
   * answers in milliseconds, so a button in front of a result that is already
   * there is a button people learn to press without reading. A streamed object
   * is a pass over every cell, and selecting a name in a list of 13 604 is not
   * consent to spend one — the reader is browsing the list, and every term they
   * pass through would start and abandon a pass.
   */
  const key = used.join(',')
  const armed = !src.lazy || scoreRan === key

  // A module score reads the object twice, and the two reads are different
  // questions: the expression bins belong to the OBJECT and are asked once ever,
  // the accumulation belongs to the SET. Splitting them is what makes the second
  // signature on an atlas cost one pass instead of two — the bins are already
  // remembered under a key that does not change.
  const { value: avg, pass: binPass, failed: binFailed, retry: binRetry } = useJob<'averages'>(
    src, 'averages', 'gene averages', used.length > 0 && armed,
    () => geneAveragesSync(src) ?? new Float64Array(src.genes.length),
    () => ({ kind: 'averages', ...averagesSpec(src) }),
  )

  // Which control genes, and what each gene contributes. Decided here, on the
  // page, for both paths: it is cheap (a sort of the gene list) next to a pass
  // over the matrix, and deciding it once is what stops the two paths drawing a
  // different control set and reporting different scores.
  const plan = useMemo(
    () => (avg && used.length ? scorePlan(src, used, avg, SCORE_DEFAULTS) : null),
    [src, used, avg])

  // Every cell × every weighted gene. Keyed on the genes themselves, so
  // switching back to a set already scored costs nothing, and switching away
  // mid-pass abandons it rather than letting it land on top of the new answer.
  const { value: scores, pass: scorePass, failed: scoreFailed, retry: scoreRetry } = useJob<'score'>(
    src, 'score', `score|${key}`, plan !== null && armed,
    () => scoreInline(src, plan!),
    // The engine takes the buffer, so it gets a copy — the plan outlives the job.
    () => ({
      kind: 'score', weight: plan!.weight.slice(),
      nCells: d.cells.length, nGenes: src.genes.length,
    }),
  )
  const pass = binPass ?? scorePass
  const failed = binFailed ?? scoreFailed
  const retry = binFailed ? binRetry : scoreRetry
  const empty = useMemo(() => new Float32Array(d.cells.length), [d.cells.length])
  const scoreOf = scores ?? empty

  // An object read off disk has no answer in its first frame, and drawing the
  // figures from an all-zero array for that frame would show a flat embedding
  // that is not a result. So the card waits from the moment it knows it must,
  // which is before the pass has reported anything.
  const waiting = armed && src.remote !== null && used.length > 0 && scores === null

  const name = chosen?.name ?? ''

  /**
   * The populations the score is broken down by.
   *
   * `scoreColumns`, not `identities` — see lib/columns.ts. With identities,
   * "Across groups" meant the groups WITHIN whichever cell type was selected in
   * the bar at the top of the page: a violin panel that reads as this
   * signature's response across the experiment was one cell type's cells, and
   * nothing on the figure said so. A module score across groups is a question
   * about the object, and the cell type is not a parameter of it.
   */
  const ids = useMemo(
    () => scoreColumns(d, types, groupBy, palKey, null, null), [d, types, groupBy, palKey])
  const perId = useMemo(() => ids.map(c => c.cells), [ids])
  // The filter records what is HIDDEN; the columns want what is KEPT.
  const heatKeepT = useMemo(
    () => (hideT.size ? new Set(types.map((_t, i) => i).filter(i => !hideT.has(i))) : null),
    [types, hideT])
  const heatKeepC = useMemo(
    () => (hideC.size ? new Set(d.conds.filter(c => !hideC.has(c))) : null),
    [d.conds, hideC])
  // Not while the pass is running: the table it feeds is not on screen, and
  // summarising 292 495 zeroes to draw nothing is work the user waits through.
  const stats = useMemo(
    () => (waiting ? [] : perId.map(idx => summarise(scoreOf, idx))), [waiting, perId, scoreOf])
  const modes: { k: GroupBy; label: string }[] = [
    { k: 'type', label: 'Across cell types' },
    ...(d.multi
      ? [{ k: 'cond' as const, label: 'Across groups' }, { k: 'both' as const, label: 'Cell type × group' }]
      : []),
  ]

  const sourcesEl = (
    <GeneSetSources lib={lib} species={species} sources={sources} onSources={onSources}
      customSets={customSets} onCustomSets={onCustomSets}
      background={GENES} detected={detected} />
  )
  const switcher = (
    <Seg<SetsView> value={view} onChange={onView}
      options={[{ k: 'one', label: 'One set' }, { k: 'many', label: 'Several sets' }]} />
  )
  // The library and the switch are this view's; the several-sets stage is its own.
  if (view === 'many') return <>{sourcesEl}{many(switcher)}</>

  const result = armed && used.length > 0 && !waiting && !failed

  return (
    <>
      {result && (
        <InRail>
          <RailGroup label="Score per cell">
            <Opts<GroupBy> value={groupBy} onChange={setGroupBy} options={modes} />
          </RailGroup>
          <RailGroup label="Set genes">
            <Toggle on={heat} onChange={setHeat}>Show the genes</Toggle>
            {heat && (
              <>
                {/* Its OWN grouping. It used to follow the violins', so asking
                    for the per-gene view across groups meant changing the figure
                    above it too. */}
                <Opts<GroupBy> value={heatBy} onChange={setHeatBy} options={modes} />
                <Toggle on={heatCluster} onChange={setHeatCluster}
                  title="Order rows and columns by similarity, and draw the trees">Cluster</Toggle>
                <Toggle on={heatScale} onChange={setHeatScale}
                  title="z-score each gene across the columns shown (pheatmap scale = row)">
                  Scale each gene</Toggle>
                <Toggle on={heatFlip} onChange={setHeatFlip}
                  title="Swap the axes: cell types down the side, genes along the bottom">
                  Transpose</Toggle>
                <ColumnFilter types={types} conds={d.conds} groupBy={heatBy}
                  hideT={hideT} hideC={hideC} onHideT={setHideT} onHideC={setHideC}
                  palKey={palKey} label="Columns shown" />
              </>
            )}
          </RailGroup>
        </InRail>
      )}
      <Stage fit head={<>
        {switcher}
        <span className="stage-title">Module score, per cell</span>
        <span className="stage-meta">Seurat&rsquo;s <Mono>AddModuleScore</Mono>: the set&rsquo;s
          mean, minus a control set matched on expression level.</span>
      </>}>
        <div className="split split-list">
          {/* The sets, as a list that is always there rather than a dropdown:
              at 20 454 sets the names are what the reader is choosing between,
              and a <select> shows one at a time. Capped at forty — narrowing
              the search is the way to find something, not scrolling. */}
          <div className="tpane">
            <div className="tpane-tools">
              <input
                className="inp w-full" value={find}
                placeholder={lib.loading ? 'loading MSigDB…'
                  : `search ${allSets.length.toLocaleString()} sets: cell cycle, notch…`}
                aria-label="Search gene sets"
                disabled={lib.loading}
                role="combobox" aria-expanded={hits.length > 0} aria-controls="geneset-hits"
                aria-activedescendant={hits[cursor] ? `gs-${hits[cursor].id}` : undefined}
                autoComplete="off"
                onKeyDown={onSearchKey}
                onChange={e => setFind(e.target.value)}
              />
            </div>
            <div ref={listRef} id="geneset-hits" role="listbox" aria-label="Matching gene sets"
              className="tpane-body">
              {lib.loading ? null : hits.length === 0 ? (
                <p className="tx-small p-3" style={{ color: 'var(--ink-3)' }}>
                  Nothing matches “{find}”.
                </p>
              ) : hits.map((h, i) => (
                <button
                  key={h.id} id={`gs-${h.id}`} role="option" data-at={i === cursor ? 1 : 0}
                  className="set-row" title={h.name}
                  aria-selected={h.id === chosen?.id}
                  tabIndex={-1}
                  // The arrow cursor is drawn separately from the selection: one
                  // is where you are looking, the other is what you chose.
                  onClick={() => { setSetId(h.id); setCursor(i) }}
                >
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <span className="set-src">{h.source}</span>
                  <span className="num set-n">{h.n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="read" tabIndex={0} role="region" aria-label="The set's score">
            {sourcesEl}
            {failed ? (
              <Failed error={failed} onRetry={retry} what="The module score" />
            ) : waiting ? (
              <Progress pass={pass ?? STARTING} title={`Scoring ${name} across every cell`} />
            ) : used.length === 0 ? (
              !chosen ? (
                <Empty title="Choose a set in the list to score it.">
                  Your own sets appear there too: add them with &ldquo;Paste or upload&rdquo;
                  on the left.
                </Empty>
              ) : (
                <div className="empty">
                  None of these genes are measured in this object, so there is nothing to score.
                </div>
              )
            ) : !armed ? (
              /* Chosen, not yet asked for. Browsing a list of 13 604 names is not
                 consent to spend a pass per name, so the reader says when. */
              <div className="empty">
                <div className="card-title mb-1" style={{ color: 'var(--ink)', marginTop: 0 }}>
                  {name}
                </div>
                {used.length} gene{used.length === 1 ? '' : 's'} measured here, scored against{' '}
                {SCORE_DEFAULTS.ctrl} controls each: one pass over every cell.
                <div className="mt-3.5">
                  <button className="btn btn-primary" onClick={() => onScoreRan(key)}>
                    Score this set
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="sect-pair">
                  <Section title={`${name} on the embedding`}>
                    <ScoreMap d={d} types={types} xy={emb.xy} scores={scoreOf} rampKey={rampKey} name={name} />
                  </Section>

                  <Section title="Score by cell type or group">
                    <div className="scrollx" style={{ maxHeight: 420 }}>
                      <table className="t">
                        <thead><tr><th>Cells of</th><th className="num">Cells</th><th className="num">Median</th><th className="num">Mean</th></tr></thead>
                        <tbody>
                          {ids.map((id, k) => {
                            const s = stats[k]
                            return (
                              <tr key={id.full}>
                                <td className="whitespace-nowrap">
                                  <i className="sw mr-1.5" style={{ background: id.color }} />
                                  {id.full}
                                </td>
                                <td className="num" style={{ color: 'var(--ink-2)' }}>{s.n}</td>
                                <td className="num font-semibold"
                                  style={{ color: s.med > 0 ? 'var(--up)' : 'var(--down)' }}>
                                  {s.med >= 0 ? '+' : ''}{s.med.toFixed(2)}
                                </td>
                                <td className="num" style={{ color: 'var(--ink-2)' }}>
                                  {s.mean >= 0 ? '+' : ''}{s.mean.toFixed(2)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <InHead>
                      <CsvButton onClick={() => downloadCsv(
                        `module_score_${slug(name)}`,
                        ['identity', 'cells', 'median', 'mean', 'q1', 'q3'],
                        ids.map((id, k) => {
                          const st = stats[k]
                          return [id.full, st.n, st.med.toFixed(4), st.mean.toFixed(4),
                            st.q1.toFixed(4), st.q3.toFixed(4)]
                        }))} />
                    </InHead>
                  </Section>
                </div>

                <Section title="Genes in this set"
                  meta={`${used.length} of ${requested.length} genes found in this object`}>
                  <div className="flex flex-wrap gap-1.5">
                    {used.map(g => (
                      <button key={g} className="chip italic"
                        title={`Open ${g} in Gene expression`}
                        onClick={() => onPickGene(g)}>{g}</button>
                    ))}
                  </div>
                  <p className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
                    Select a gene to see whether it carries the score on its own.
                    {' '}{SCORE_DEFAULTS.ctrl} control genes per set gene, drawn from{' '}
                    {SCORE_DEFAULTS.nbin} expression bins.
                    {missing.length > 0 && (
                      <> Not measured:{' '}
                        <span className="mono">{missing.slice(0, 8).join(', ')}
                          {missing.length > 8 ? ` +${missing.length - 8}` : ''}</span>.</>
                    )}
                  </p>
                  <InHead>
                    <button className="btn btn-quiet" onClick={() => onCorrelate(used)}
                      title="Find the genes that move with this set, and against it">
                      Correlate this set
                    </button>
                  </InHead>
                </Section>

                <Section title="Score per cell"
                  meta={modes.find(m => m.k === groupBy)?.label}>
                  <Figure name={`module_score_by_identity_${slug(name)}`} foot={{
                    title: `Module score per cell · ${name}`,
                    notes: [
                      nNote(ids.map((c, i) => ({ label: groupBy === 'both' ? pairName(c.full) : c.label, n: perId[i].length }))),
                      'Violin: the per-cell distribution. Bar: quartiles; tick: median. Dashed line: zero, the reference.',
                    ],
                  }}>
                    <ScoreViolins scores={scoreOf} ids={ids} perId={perId} groupBy={groupBy} />
                  </Figure>
                  <p className="sub mt-2.5">
                    Zero is the reference: no higher than genes of comparable abundance.
                  </p>
                </Section>

                {/*
                  Its own section, not a strip under the violins.

                  The score is one number per cell; this is what it was made of, and it
                  answers a different question — a set can reach a high score because two
                  of its fifty genes are large or because fifty genes moved together, and
                  only the per-gene view separates those. A different question deserves its
                  own heading, its own grouping and its own export, rather than inheriting
                  the violin's and reading as a footnote to it.
                */}
                {heat && (
                  <Section title="Every gene of the set, across cell types"
                    meta={modes.find(m => m.k === heatBy)?.label}>
                    <p className="sub mb-2 mt-0">
                      {heatScale
                        ? "Z-scored down each gene's own row, so a row says where that gene is highest, not how abundant it is."
                        : 'Mean expression as the object holds it, on one scale for every gene, so a row says how abundant that gene is.'}
                    </p>
                    <Figure name={`set_genes_${slug(name)}`}
                      foot={{ title: `${name}: its genes, ${heatScale ? 'z-scored along each gene' : 'mean expression'}` }}>
                      <SetHeatmap
                        src={src} genes={used} d={d} types={types} groupBy={heatBy} palKey={palKey}
                        keepT={heatKeepT} keepC={heatKeepC}
                        rampDiv={rampDiv} rampSeq={rampKey} scale={heatScale} flip={heatFlip}
                        cluster={heatCluster}
                      />
                    </Figure>
                  </Section>
                )}
              </>
            )}
          </div>
        </div>
      </Stage>
    </>
  )
}

function ScoreMap({ d, types, xy, scores, rampKey, name }: {
  d: Dataset; types: CellType[]; xy: Float32Array; scores: Float32Array; rampKey: RampKey; name: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Fitted to its column, between a size its names can be read at and the
  // drawing's own. It was 420 px squeezed to whatever a shared row left it:
  // 268 px at 1,440 with names about 4 px tall, 188 px at 1,280.
  const [boxRef, boxW] = useWidth()
  const size = boxW ? Math.max(280, Math.min(560, boxW)) : 420
  const dark = useDark()

  // The feature plot's painter: the same marks, the same order (high cells
  // last, so a small positive population is not buried), the same names and
  // the scale on the figure, where an exported file still carries it. A module
  // score has no natural units, so the numbers at the ends are its anchor.
  const spec = useMemo((): FeatureDraw => {
    // Typed throughout: boxing 292,495 doubles to sort them cost more than the sort.
    const sorted = scores.slice().sort()
    const lo = sorted[Math.floor(sorted.length * 0.01)]
    const hi = sorted[Math.floor(sorted.length * 0.99)]
    const at = clusterCentroids(xy, d, types.length)
    return {
      xy, extent: embedExtent(xy), vals: scores, cells: d.cells, cond: null,
      visible: () => true, top: hi, floor: lo, ramp: rampKey,
      // Cell types only: a name at a sentinel's median would mark a population that is not there.
      labels: types.flatMap((t, ti) => (t.sentinel ? [] : [{ name: t.name, x: at[ti].x, y: at[ti].y }])),
      borders: false, silhouette: false, background: PRINT_PLATE,
      title: name, subtitle: null, plainTitle: true, barLabel: 'Module score',
    }
  }, [d, types, xy, scores, rampKey, name])

  useEffect(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    const background = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || PRINT_PLATE
    // On screen the section's head line names the set; the file carries the name itself.
    drawFeature(g, cv.width, cv.height, { ...spec, title: '', background, px: 2 }, dark)
  }, [spec, dark, size])

  return (
    // Saved repainted in print ink on white at the dpi asked for, from either theme.
    <Figure name={`module_score_${slug(name)}`}
      foot={{ notes: [`n = ${scores.length.toLocaleString('en-US')} cells. Module score per cell.`] }}
      redraw={(out, w, h) => {
      const g = out.getContext('2d')
      if (g) drawFeature(g, w, h, { ...spec, px: w / Math.max(1, ref.current?.clientWidth || size) }, false)
    }}>
      <div ref={boxRef}>
        <canvas
          role="img" aria-label="Module score on the embedding"
          ref={ref} width={size * 2} height={panelHeight(size * 2, 2)}
          style={{ display: 'block', width: size, maxWidth: '100%', height: 'auto' }} />
      </div>
    </Figure>
  )
}

function SetHeatmap({
  src, genes, d, types, groupBy, palKey, keepT, keepC, rampDiv, rampSeq, scale, flip, cluster,
}: {
  src: Source
  genes: string[]
  d: Dataset
  types: CellType[]
  groupBy: GroupBy
  palKey: PaletteKey
  /** The reader's filters, or null for everything. */
  keepT: ReadonlySet<number> | null
  keepC: ReadonlySet<string> | null
  /** The diverging scale, for z-scores. */
  rampDiv: RampKey
  /** The sequential scale, for raw means — a quantity with no second direction. */
  rampSeq: RampKey
  /** Whether each gene is z-scored down its own row. */
  scale: boolean
  /** Genes along the bottom rather than down the side. */
  flip: boolean
  cluster: boolean
}) {
  const cw = 34, rh = 15, PT = 12, PR = 20, BAR_H = 58

  /**
   * The finest partition, and the matrix read against it.
   *
   * Read at cell type x group and NEVER at the grouping on screen. Every column
   * this figure can draw is a union of those parts, so regrouping and filtering
   * are arithmetic on numbers already in hand rather than another pass over the
   * file — which on a streamed object is a pass per window of genes, and used to
   * happen every time somebody switched from "across cell types" to "across
   * groups".
   *
   * It is also what makes "across groups" mean what it says. The old read asked
   * `src.mean(gene, ti, cond)`, which needs a cell type to ask about, so a group
   * column was one cluster's cells with nothing saying so. A sum over parts has
   * no such requirement: the group column is every part with that group in it.
   */
  const fine = useMemo(() => finePartition(d, types.length), [d, types.length])
  const [sums, setSums] = useState<Float64Array[] | null>(null)
  const [readErr, setReadErr] = useState<string | null>(null)
  const [read, setRead] = useState(0)

  useEffect(() => {
    let live = true
    setSums(null)
    setReadErr(null)
    setRead(0)
    if (!genes.length || !fine.n) { setSums([]); return }

    const out = genes.map(() => new Float64Array(fine.n))
    const fill = (g: string, gi: number) => {
      const acc = out[gi]
      // Sums, not means — a mean is not additive, and every column above is a
      // union. See lib/columns.ts.
      src.forEachNonZero(g, (cell, value) => {
        const p = fine.of[cell]
        if (p >= 0) acc[p] += value
      })
    }
    // An object held in memory answers immediately; there is nothing to stream
    // and nothing to show a bar for.
    if (!src.lazy) {
      genes.forEach(fill)
      setSums(out)
      return
    }
    let done = 0
    src.withGenes(genes, (win, at) => {
      for (let k = 0; k < win.length; k++) fill(win[k], at[k])
      done += win.length
      if (live) setRead(done)
    }).then(
      () => { if (live) setSums(out) },
      (e: unknown) => {
        if (live) setReadErr(e instanceof Error ? e.message : String(e))
      },
    )
    return () => { live = false }
  }, [src, genes, fine])

  const cols = useMemo(
    () => aggregateColumns(d, types, groupBy, palKey, keepT, keepC, fine),
    [d, types, groupBy, palKey, keepT, keepC, fine])

  /**
   * What each square is worth: a z-score, or the mean as the object holds it.
   *
   * Row-scaled over the KEPT columns only. Scaling before filtering would be the
   * wrong order: a z-score says where a gene is highest AMONG THE COLUMNS SHOWN,
   * so dropping a cell type has to change the scale. Otherwise a reader who
   * removes the one population a gene is high in still sees that gene's
   * remaining columns pushed to the blue end by a mean that includes a column no
   * longer on screen.
   *
   * Unscaled the rows are the means, kept on ONE scale across the whole plate:
   * per-row would be the scaling again under another name, and the question this
   * mode exists to answer is which genes are abundant.
   */
  const v = useMemo(() => {
    if (!sums || !cols.length) return null
    const raw = new Float64Array(genes.length * cols.length)
    for (let gi = 0; gi < genes.length; gi++) {
      const acc = sums[gi]
      if (!acc) continue
      for (let k = 0; k < cols.length; k++) {
        let s = 0
        for (const p of cols[k].parts) s += acc[p]
        raw[gi * cols.length + k] = cols[k].size ? s / cols[k].size : 0
      }
    }
    return scale ? zByRow(raw, genes.length, cols.length) : raw
  }, [sums, cols, genes.length, scale])

  /** The ends of the colour scale, and which scale it is. */
  const [lo, hi] = scale ? [-2.5, 2.5] : [0, Math.max(v ? maxOf(v) : 0, 0.01)]
  const span = hi - lo
  const ramp = scale ? rampDiv : rampSeq

  // Both trees are functions of `v`, and `v` is a function of which columns
  // survive and of whether the rows are scaled — so removing a cell type or
  // turning the scaling off re-clusters, rather than leaving a dendrogram that
  // describes an arrangement no longer on screen.
  const rows2 = useMemo(
    () => (v ? genes.map((_g, gi) => Array.from(
      { length: cols.length }, (_c, k) => v[gi * cols.length + k])) : []),
    [v, genes, cols.length])
  const geneTree = useMemo(() => (cluster ? orderRows(rows2) : null), [cluster, rows2])
  const idTree = useMemo(() => {
    if (!cluster || cols.length < 3) return null
    // Transposed: a column is one population's profile across the set's genes.
    return orderRows(Array.from({ length: cols.length }, (_c, k) => rows2.map(r => r[k])))
  }, [cluster, rows2, cols.length])

  const geneAt = geneTree ? geneTree.order : genes.map((_g, i) => i)
  const idAt = idTree ? idTree.order : cols.map((_c, i) => i)

  /**
   * Which quantity is on which axis.
   *
   * Genes down the side is the default, as DoHeatmap and pheatmap draw it. A
   * hundred-gene set is a hundred rows you scroll; a hundred columns is a plate
   * wider than any page, which is why the other orientation is offered rather
   * than assumed.
   */
  const vAt = flip ? idAt : geneAt
  const hAt = flip ? geneAt : idAt
  const vLabels = vAt.map(i => (flip ? cols[i].label : genes[i]))
  const hLabels = hAt.map(i => (flip ? genes[i] : cols[i].label))
  /** The plate square at (row, column), as (gene, column) indices. */
  const cellAt = (vi: number, hj: number): [number, number] =>
    (flip ? [hAt[hj], vAt[vi]] : [vAt[vi], hAt[hj]])

  const TREE = 30
  const vTree = flip ? idTree : geneTree
  const hTree = flip ? geneTree : idTree
  const treeT = hTree ? TREE : 0
  const treeL = vTree ? TREE : 0
  // Names at the figure's own sizes: the columns' were 9 px and the rows' 10.
  const PL = Math.max(80, widestW(vLabels, FIG_TYPE.tick, false) + 14) + treeL
  const ax = axisTicks(hLabels, { band: cw, leftAnchor: PL + cw / 2, px: FIG_TYPE.name, startAt: 10, upright: 24 })

  const W = PL + hAt.length * cw + PR
  const plotT = PT + treeT
  const plotB = plotT + vAt.length * rh
  const H = plotB + ax.bottom + BAR_H

  if (readErr) {
    return (
      <div className="note note-warn mt-2">
        <b>The set&rsquo;s genes could not be read.</b>{' '}
        <span style={{ color: 'var(--ink-2)' }}>{readErr}</span>
      </div>
    )
  }
  if (!sums) {
    // A determinate bar, because withGenes reports every window it finishes and
    // the total is known — the one thing worse than a wait is a wait with no
    // idea how long. This is why the figure looked broken rather than busy.
    return (
      <div className="panel mt-2">
        <div className="tx-small" style={{ color: 'var(--ink-2)' }}>
          Reading {genes.length} genes of this set from the file
        </div>
        <div className="mt-2 h-[6px] w-full overflow-hidden rounded-full"
          style={{ background: 'var(--sunk)' }}>
          <div className="bar-fill h-full rounded-full"
            style={{
              background: 'var(--sel)',
              transform: `scaleX(${Math.max(0.02, read / Math.max(1, genes.length))})`,
              transformOrigin: 'left',
            }} />
        </div>
        <div className="mt-1.5 tabular-nums tx-micro" style={{ color: 'var(--ink-3)' }}>
          {read} of {genes.length}
        </div>
      </div>
    )
  }

  if (!cols.length || !v) {
    return (
      <div className="empty mt-2">Every column is switched off: turn one back on, on the left.</div>
    )
  }

  return (
    <div className="mt-2 overflow-x-auto">
      {/*
        Drawn at its natural size, not stretched to the card. `width="100%"`
        scales the viewBox to whatever width is available, so a heatmap of four
        columns was blown up until each cell was a hundred pixels across and the
        gene names were larger than the card's own heading — the figure got LESS
        readable as it got simpler, which is backwards. The scroller handles the
        other end: a hundred columns is wider than the card and scrolls, at the
        same cell size as four.
      */}
      <svg viewBox={`0 0 ${W} ${H}`} data-foot={JSON.stringify({ notes: [nNote(cols.map(c => ({ label: c.label, n: c.size })))] })} width={W} height={H}
        style={{ maxWidth: '100%' }}
        role="img"
        aria-label={`Expression of ${genes.length} set genes across ${cols.length} cell types`}>
        {hTree && dendroLines(hTree, hAt.length * cw, treeT - 5).map((l, i) => (
          <line key={`c${i}`} x1={PL + l.x1} x2={PL + l.x2}
            y1={plotT - 3 - l.y1} y2={plotT - 3 - l.y2}
            stroke={AXIS_INK} strokeWidth={0.7} />
        ))}
        {vTree && dendroLines(vTree, vAt.length * rh, treeL - 7).map((l, i) => (
          <line key={`r${i}`} x1={PL - treeL + 3 + (treeL - 7 - l.y1)} x2={PL - treeL + 3 + (treeL - 7 - l.y2)}
            y1={plotT + l.x1} y2={plotT + l.x2}
            stroke={AXIS_INK} strokeWidth={0.7} />
        ))}

        {vAt.map((_a, vi) => hAt.map((_b, hj) => {
          const [gi, k] = cellAt(vi, hj)
          return (
            <rect key={`${gi}-${k}`} x={PL + hj * cw} y={plotT + vi * rh}
              width={cw} height={rh}
              className="gfill" style={onGround(rampColor((v[gi * cols.length + k] - lo) / span, ramp), rampColor((v[gi * cols.length + k] - lo) / span, ramp, 'dark'))}>
              <title>
                {genes[gi]} in {cols[k].full}: {scale ? 'z ' : 'mean '}
                {v[gi * cols.length + k].toFixed(2)}
                {' · '}{cols[k].size.toLocaleString()} cells
              </title>
            </rect>
          )
        }))}

        {/* Gene names in full, italic as a gene symbol is set in print; cell
            types upright, as a name is. */}
        {vLabels.map((lab, vi) => (
          <text key={`v${vi}`} x={PL - treeL - 6} y={plotT + vi * rh + rh / 2 + 3.4} textAnchor="end"
            style={{ fontSize: FIG_TYPE.tick, fill: AXIS_INK, fontStyle: flip ? 'normal' : 'italic' }}>
            {lab}<title>{lab}</title>
          </text>
        ))}
        {hLabels.map((lab, hj) => {
          const cx = PL + cw * (hj + 0.5)
          const style = { fontSize: FIG_TYPE.name, fontStyle: flip ? ('italic' as const) : ('normal' as const) }
          return ax.rotate ? (
            <text key={`h${hj}`} className="axis"
              transform={`rotate(${-ax.deg} ${cx} ${plotB + 10})`}
              x={cx} y={plotB + 10} textAnchor="end" style={style}>
              {lab}<title>{lab}</title>
            </text>
          ) : (
            <text key={`h${hj}`} className="axis" x={cx} y={plotB + 12} textAnchor="middle"
              style={style}>{lab}<title>{lab}</title></text>
          )
        })}
        <ColorBar cx={W / 2} y={H - BAR_H + 22} w={170} h={10}
          ramp={ramp} lo={lo} hi={hi} id="setheat"
          title={scale ? 'z-score, down each gene' : `mean ${src.meta.expression}`}
          breaks={scale ? [-2.5, 0, 2.5] : undefined} />
      </svg>
    </div>
  )
}

function ScoreViolins({ scores, ids, perId, groupBy }: {
  scores: Float32Array
  ids: Column[]
  perId: number[][]
  groupBy: GroupBy
}) {
  const per = ids.length
  // Drawn one to one at the width its column has, like the expression
  // violins. It was an 860 px drawing scaled into the column: 7.7 px type at
  // a 1,280 px window, 9.5 at 1,440 and 15 at 1,920.
  const [box, boxW] = useWidth()
  const W = boxW ? Math.max(320, boxW) : 860
  const PLOT = 168, PL = 50, PT = 14, PR = 10
  /**
   * 88 units when grouped by both, 68 otherwise — which asks how many labels
   * there are and never how long they are. Grouped by both, the label is
   * `id.full`: a cell-type name and a group name joined, the longest string
   * this figure ever draws, and always rotated. The same measurement every
   * other axis in the studio now uses, so it cannot disagree with them.
   */
  const LAB_PX = FIG_TYPE.name
  const bw = (W - PL - PR) / per
  const tick = axisTicks(ids.map(id => (groupBy === 'both' ? id.full : id.label)), {
    band: bw, leftAnchor: PL + bw / 2, px: LAB_PX, startAt: 12, upright: 30,
  })
  const PB = tick.bottom
  const H = PT + PLOT + PB
  const values = perId.map(idx => {
    const out = idx.map(i => scores[i])
    // Violins do not need every cell; a stride keeps the density honest and fast.
    const stride = Math.max(1, Math.floor(out.length / 400))
    return out.filter((_v, k) => k % stride === 0)
  })
  const all = values.flat()
  // A signature every cell scores identically on is rare but not impossible,
  // and it must draw a flat line rather than NaN coordinates.
  const { y0, y1 } = axisRange(minOf(all), maxOf(all))
  const Y = (v: number) => PT + PLOT * (1 - (v - y0) / (y1 - y0))

  return (
    <div ref={box} className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img"
        aria-label="Module score by cell type or group">
        {/* The axis says what it measures; it had no title. */}
        <text className="axis" transform={`rotate(-90 11 ${PT + PLOT / 2})`} x={11} y={PT + PLOT / 2}
          textAnchor="middle">Module score</text>
        {/* Round numbers inside the range: the ticks were the range's ends
            and its middle ("1.06, -1.22, -3.50"). */}
        {breaksOf(y0, y1, 5).filter(t => t >= y0 && t <= y1).map(t => (
          <g key={t}>
            <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
            <text className="axis" x={PL - 5} y={Y(t) + 3.5} textAnchor="end">{fmtBreak(t)}</text>
          </g>
        ))}
        {y0 < 0 && y1 > 0 && (
          <line x1={PL} x2={W - PR} y1={Y(0)} y2={Y(0)} stroke="var(--ink-3)"
            strokeDasharray="3 3" opacity=".85" />
        )}
        {ids.map((id, i) => {
          const v = values[i]
          if (!v.length) return null
          const cx = PL + bw * (i + 0.5)
          const q = quantiles(v)
          const dens = density(v, y0, y1)
          const half = bw * 0.36
          const pts = [
            ...dens.map((x, k) => `${(cx + x * half).toFixed(1)},${Y(y0 + (y1 - y0) * k / 26).toFixed(1)}`),
            ...dens.map((x, k) => `${(cx - x * half).toFixed(1)},${Y(y0 + (y1 - y0) * k / 26).toFixed(1)}`).reverse(),
          ].join(' ')
          return (
            <g key={id.full}>
              <polygon points={pts} fill={id.color} opacity=".26" />
              <line x1={cx} x2={cx} y1={Y(q.q1)} y2={Y(q.q3)} stroke={id.color}
                strokeWidth={Math.max(2, Math.min(6, bw * 0.3))} opacity=".7" />
              <line x1={cx - Math.min(9, bw * 0.4)} x2={cx + Math.min(9, bw * 0.4)}
                y1={Y(q.med)} y2={Y(q.med)} stroke={id.color} strokeWidth={2} />
              {tick.rotate ? (
                <text className="axis" transform={`rotate(${-tick.deg} ${cx} ${H - PB + 12})`}
                  x={cx} y={H - PB + 12} textAnchor="end" style={{ fontSize: LAB_PX }}>
                  {tick.shown[i]}<title>{id.full}</title>
                </text>
              ) : (
                <text className="axis" x={cx} y={H - PB + 14} textAnchor="middle"
                  style={{ fontSize: LAB_PX }}>
                  {tick.shown[i]}<title>{id.full}</title>
                </text>
              )}
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </div>
  )
}
