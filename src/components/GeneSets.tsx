import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CellType, Dataset, GroupBy } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { axisRange, clusterCentroids, density, embedExtent, quantiles, minOf, maxOf } from '../lib/chart.ts'
import {
  aggregateColumns, finePartition, scoreColumns, zByRow, type Column,
} from '../lib/columns.ts'
import ColumnFilter from './ColumnFilter.tsx'
import { drawLabels } from '../lib/canvas-label.ts'
import { axisTicks, widestW } from '../lib/labels.ts'
import { dendroLines, orderRows } from '../lib/cluster.ts'
import { ColorBar } from './svg-parts.tsx'
import type { LibraryState } from '../lib/genesets.ts'
import type { Collection } from '../lib/msigdb.ts'
import type { Detection, Species } from '../lib/species.ts'
import GeneSetSources from './GeneSetSources.tsx'
import {
  averagesSpec, geneAveragesSync, resolve, SCORE_DEFAULTS, scoreInline, scorePlan, summarise,
} from '../lib/score.ts'
import { AXIS_INK, LABEL_INK } from '../lib/figure-ink.ts'
import { drawColorBar } from '../lib/feature-plot.ts'
import { rampColor, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { Card, Mono, Seg } from './Ui.tsx'
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

export default function GeneSets({
  src, types, emb, palKey, rampKey, rampDiv, onPickGene, onCorrelate,
  lib, species, sources, onSources, customSets, onCustomSets,
  detected, scoreRan, onScoreRan,
}: {
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

  return (
    <>
      <Card
        eyebrow="Gene sets" title="Module score, per cell"
        sub={<>Seurat&rsquo;s <Mono>AddModuleScore</Mono>: the set&rsquo;s mean, minus a control
          set matched on expression level.</>}
      >
        <GeneSetSources lib={lib} species={species} sources={sources} onSources={onSources}
          customSets={customSets} onCustomSets={onCustomSets}
          background={GENES} detected={detected} />

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="inp w-[380px]" value={find}
            placeholder={lib.loading ? 'loading MSigDB…'
              : `search ${allSets.length.toLocaleString()} sets — cell cycle, notch…`}
            aria-label="Search gene sets"
            disabled={lib.loading}
            role="combobox" aria-expanded={hits.length > 0} aria-controls="geneset-hits"
            aria-activedescendant={hits[cursor] ? `gs-${hits[cursor].id}` : undefined}
            autoComplete="off"
            onKeyDown={onSearchKey}
            onChange={e => setFind(e.target.value)}
          />
        </div>

        {/* The matches, as a list rather than a dropdown: at 20 454 sets the
            names are what the reader is choosing between, and a <select> shows
            one at a time. Capped at forty — narrowing the search is the way to
            find something, not scrolling. */}
        {!lib.loading && (
          <div ref={listRef} id="geneset-hits" role="listbox" aria-label="Matching gene sets"
            className="panel mt-2 max-h-[210px] overflow-y-auto">
            {hits.length === 0 ? (
              <p className="tx-small" style={{ color: 'var(--ink-3)' }}>
                Nothing matches “{find}”.
              </p>
            ) : hits.map((h, i) => (
              <button
                key={h.id} id={`gs-${h.id}`} role="option" data-at={i === cursor ? 1 : 0}
                className="type-toggle flex w-full items-baseline gap-2 rounded-[--r-md] px-2 py-1 text-left"
                aria-selected={h.id === chosen?.id}
                tabIndex={-1}
                style={{
                  background: h.id === chosen?.id ? 'var(--surface)' : 'transparent',
                  // The arrow cursor is drawn separately from the selection: one
                  // is where you are looking, the other is what you chose.
                  outline: i === cursor ? '2px solid var(--accent)' : 'none',
                  outlineOffset: -2,
                }}
                onClick={() => { setSetId(h.id); setCursor(i) }}
              >
                <span className="glabel flex-none" style={{ width: 92 }}>{h.source}</span>
                <span className="min-w-0 flex-1 truncate tx-small"
                  style={{ fontWeight: h.id === chosen?.id ? 600 : 400 }}>{h.name}</span>
                <span className="mono flex-none tx-micro" style={{ color: 'var(--ink-3)' }}>
                  {h.n}
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-2.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
          {`${used.length} of ${requested.length} genes found in this object`}
          {missing.length > 0 && (
            <> · <span style={{ color: 'var(--warn)' }}>not measured:{' '}
              <span className="mono">{missing.slice(0, 8).join(', ')}
                {missing.length > 8 ? ` +${missing.length - 8}` : ''}</span></span></>
          )}
          {' '}· {SCORE_DEFAULTS.ctrl} control genes per set gene, drawn from{' '}
          {SCORE_DEFAULTS.nbin} expression bins
        </p>

        {failed ? (
          <Failed error={failed} onRetry={retry} what="The module score" />
        ) : waiting ? (
          <Progress pass={pass ?? STARTING} title={`Scoring ${name} across every cell`} />
        ) : used.length === 0 ? (
          <div className="empty mt-4">
            {!chosen
              ? 'Pick a set above to score it. Your own sets appear here too — add them with '
                + '"Add your own…".'
              : 'None of these genes are measured in this object, so there is nothing to score.'}
          </div>
        ) : !armed ? (
          /* Chosen, not yet asked for. Browsing a list of 13 604 names is not
             consent to spend a pass per name, so the reader says when. */
          <div className="empty mt-4">
            <div className="card-title mb-1" style={{ color: 'var(--ink)', marginTop: 0 }}>
              {name}
            </div>
            {used.length} gene{used.length === 1 ? '' : 's'} measured here, scored against{' '}
            {SCORE_DEFAULTS.ctrl} controls each — one pass over every cell.
            <div className="mt-3.5">
              <button className="btn btn-primary" onClick={() => onScoreRan(key)}>
                Score this set
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-start gap-5">
              <figure>
                <figcaption className="mb-1.5 tx-small font-semibold" style={{ color: 'var(--ink)' }}>
                  {name} on the embedding
                </figcaption>
                <Figure name={`module_score_${slug(name)}`}>
                  <ScoreMap d={d} types={types} xy={emb.xy} scores={scoreOf} rampKey={rampKey} />
                </Figure>
              </figure>

              <div className="min-w-[260px] flex-1">
                <div className="eyebrow mb-2">Score by identity</div>
                <div className="scrollx" style={{ maxHeight: 330 }}>
                  <table className="t">
                    <thead><tr><th>Identity</th><th>Cells</th><th>Median</th><th>Mean</th></tr></thead>
                    <tbody>
                      {ids.map((id, k) => {
                        const s = stats[k]
                        return (
                          <tr key={id.full}>
                            <td>
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
                <div className="mt-2.5 flex items-center justify-end">
                  <CsvButton onClick={() => downloadCsv(
                    `module_score_${slug(name)}`,
                    ['identity', 'cells', 'median', 'mean', 'q1', 'q3'],
                    ids.map((id, k) => {
                      const st = stats[k]
                      return [id.full, st.n, st.med.toFixed(4), st.mean.toFixed(4),
                        st.q1.toFixed(4), st.q3.toFixed(4)]
                    }))} />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="eyebrow mb-2">Genes in this set</div>
              <div className="flex flex-wrap gap-1.5">
                {used.map(g => (
                  <button key={g} className="chip italic"
                    title={`Open ${g} in Gene expression`}
                    onClick={() => onPickGene(g)}>{g}</button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="tx-micro" style={{ color: 'var(--ink-3)' }}>
                  Click a gene to see whether it carries the score on its own.
                </p>
                <button className="btn btn-sm" onClick={() => onCorrelate(used)}
                  title="Find the genes that move with this signature, and against it">
                  Correlate with this set →
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="glabel">Group by</span>
              <Seg<GroupBy> value={groupBy} onChange={setGroupBy} options={modes} />
            </div>
            <Figure name={`module_score_by_identity_${slug(name)}`} className="mt-1">
              <ScoreViolins scores={scoreOf} ids={ids} perId={perId} groupBy={groupBy} />
            </Figure>
            <p className="sub mt-2.5">
              Zero is the reference: no higher than genes of comparable abundance.
            </p>

          </>
        )}
      </Card>

      {/*
        Its own card, not a strip under the violins.

        The score is one number per cell; this is what it was made of, and it
        answers a different question — a set can reach a high score because two
        of its fifty genes are large or because fifty genes moved together, and
        only the per-gene view separates those. A different question deserves its
        own heading, its own grouping and its own export, rather than inheriting
        the violin's and reading as a footnote to it.
      */}
      {armed && used.length > 0 && !waiting && (
        <Card
          eyebrow="Gene sets · per gene"
          title="Every gene of the set, across identities"
          sub={heatScale
            ? "Z-scored down each gene's own row, so a row says where that gene is highest — not how abundant it is."
            : 'Mean expression as the object holds it, on one scale for every gene — so a row says how abundant that gene is.'}
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="chip" aria-pressed={heat} onClick={() => setHeat(!heat)}>
              {heat ? 'Hide the heatmap' : 'Show the genes'}
            </button>
            {heat && (
              <>
                <div className="gsep" />
                {/* Its OWN grouping. It used to follow the violins', so asking
                    for the per-gene view across groups meant changing the figure
                    above it too. */}
                <span className="glabel">Group by</span>
                <Seg<GroupBy> value={heatBy} onChange={setHeatBy} options={modes} />
                <div className="gsep" />
                <button className="chip" aria-pressed={heatCluster}
                  onClick={() => setHeatCluster(!heatCluster)}
                  title="Order rows and columns by similarity, and draw the trees">
                  Cluster
                </button>
                <div className="gsep" />
                <button className="chip" aria-pressed={heatScale}
                  onClick={() => setHeatScale(!heatScale)}
                  title="z-score each gene across the identities shown — pheatmap scale = row"
                >Scale each gene</button>
                <button className="chip" aria-pressed={heatFlip}
                  onClick={() => setHeatFlip(!heatFlip)}
                  title="Swap the axes — identities down the side, genes along the bottom"
                >Transpose</button>
              </>
            )}
          </div>
          {heat && (
            <>
              <ColumnFilter types={types} conds={d.conds} groupBy={heatBy}
                hideT={hideT} hideC={hideC} onHideT={setHideT} onHideC={setHideC}
                palKey={palKey} label="Columns in this heatmap" />
              <Figure name={`set_genes_${slug(name)}`} className="mt-1">
                <SetHeatmap
                  src={src} genes={used} d={d} types={types} groupBy={heatBy} palKey={palKey}
                  keepT={heatKeepT} keepC={heatKeepC}
                  rampDiv={rampDiv} rampSeq={rampKey} scale={heatScale} flip={heatFlip}
                  cluster={heatCluster}
                />
              </Figure>
            </>
          )}
        </Card>
      )}
    </>
  )
}

function ScoreMap({ d, types, xy, scores, rampKey }: {
  d: Dataset; types: CellType[]; xy: Float32Array; scores: Float32Array; rampKey: RampKey
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = 420

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    g.fillRect(0, 0, cv.width, cv.height)
    const { x0, x1, y0, y1 } = embedExtent(xy)
    // The embedding keeps the square; the bar strip is added below it, never
    // taken out of it. Scaling the cells to the full canvas would stretch every
    // map vertically by the height of its own legend.
    const plotH = cv.width

    // Typed throughout. `Array.from(scores)` boxed 292 495 doubles into a JS
    // array before sorting them, and the copy cost more than the sort.
    const sorted = scores.slice().sort()
    const lo = sorted[Math.floor(sorted.length * 0.01)]
    const hi = sorted[Math.floor(sorted.length * 0.99)]
    const span = hi - lo || 1

    // Same ordering rule as the feature plot: high cells last, so a small
    // positive population is not buried under the negative majority.
    const idx = new Int32Array(d.nCells)
    for (let i = 0; i < idx.length; i++) idx[i] = i
    idx.sort((a, b) => scores[a] - scores[b])
    for (const i of idx) {
      g.fillStyle = rampColor((scores[i] - lo) / span, rampKey)
      g.beginPath()
      g.arc(((xy[2 * i] - x0) / (x1 - x0)) * cv.width,
        (1 - (xy[2 * i + 1] - y0) / (y1 - y0)) * plotH, 1.9, 0, 6.284)
      g.fill()
    }
    g.font = '600 17px system-ui'
    g.lineWidth = 3.5
    const at = clusterCentroids(xy, d, types.length)
    drawLabels(g, types.map((t, ti) => ({
      name: t.name,
      x: ((at[ti].x - x0) / (x1 - x0)) * cv.width,
      y: (1 - (at[ti].y - y0) / (y1 - y0)) * plotH,
    })), { fill: LABEL_INK, halo: 'rgba(255,255,255,.9)' })

    // The scale, on the figure. It was an HTML strip beside the canvas, so an
    // exported score map had colours and no way to read them — and this one is
    // worse than a feature plot, because a module score has no natural units
    // and the numbers at the ends are the only thing that anchors it.
    const unit = cv.width / 640
    const barW = Math.min(cv.width * 0.55, 170 * unit)
    drawColorBar(g, {
      x: (cv.width - barW) / 2, y: cv.height - BAR_U * unit + 16 * unit,
      w: barW, h: 9 * unit,
      ramp: rampKey, lo, hi, ink: AXIS_INK,
      label: 'Module score', unit,
    })
  }, [d, types, xy, scores, rampKey])

  return (
    <canvas
      role="img" aria-label="Module score on the embedding"
      ref={ref} width={size * 2} height={size * 2 + Math.round(BAR_U * (size * 2) / 640)}
      style={{ width: '100%', maxWidth: size, height: 'auto', borderRadius: 'var(--r-md)' }} />
  )
}

/** Height of the colour-bar strip, in the same 640-wide units as the drawing. */
const BAR_U = 46

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
  const PL = Math.max(80, widestW(vLabels, 10, false) + 14) + treeL
  const ax = axisTicks(hLabels, { band: cw, leftAnchor: PL + cw / 2, px: 9, startAt: 10, upright: 24 })

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
      <div className="empty mt-2">Every column is switched off — turn one back on above.</div>
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
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        style={{ maxWidth: '100%' }}
        role="img"
        aria-label={`Expression of ${genes.length} set genes across ${cols.length} populations`}>
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
              fill={rampColor((v[gi * cols.length + k] - lo) / span, ramp)}>
              <title>
                {genes[gi]} in {cols[k].full} — {scale ? 'z ' : 'mean '}
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
            style={{ fontSize: 10, fill: AXIS_INK, fontStyle: flip ? 'normal' : 'italic' }}>
            {lab}<title>{lab}</title>
          </text>
        ))}
        {hLabels.map((lab, hj) => {
          const cx = PL + cw * (hj + 0.5)
          const style = { fontSize: 9, fontStyle: flip ? ('italic' as const) : ('normal' as const) }
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
  const W = 860, PLOT = 168, PL = 46, PT = 14, PR = 10
  /**
   * 88 units when grouped by both, 68 otherwise — which asks how many labels
   * there are and never how long they are. Grouped by both, the label is
   * `id.full`: a cell-type name and a group name joined, the longest string
   * this figure ever draws, and always rotated. The same measurement every
   * other axis in the studio now uses, so it cannot disagree with them.
   */
  const LAB_PX = per > 12 ? 9 : 10
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
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560 }} role="img"
        aria-label="Module score by identity">
        {[0, 0.5, 1].map(f => {
          const t = y0 + (y1 - y0) * f
          return (
            <g key={f}>
              <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
              <text className="axis" x={PL - 5} y={Y(t) + 3.5} textAnchor="end">{t.toFixed(2)}</text>
            </g>
          )
        })}
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
