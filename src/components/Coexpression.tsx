import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellType } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import {
  cellAxis, compositeOn, constraintOf, corrDense, corrPlan, groupAxis, poolAxis,
  profilesOn, pseudobulkOn, rankCorr, scopeMask, standardise, withinSet,
  type CorrMethod,
  type Axis, type CorrResult, type CorrRow, type SetShape, type Within,
} from '../lib/correlate.ts'
import { parseGeneList, rankGenes } from '../lib/genes.ts'
import { typesLabel } from '../lib/stats.ts'
import PickMany from './PickMany.tsx'
import { fmt, pctTxt } from '../lib/chart.ts'
import { AXIS_INK, DOWN_MARK, MARK_EDGE, UP_MARK } from '../lib/figure-ink.ts'
import { widestW } from '../lib/labels.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { useJob } from '../lib/compute.ts'
import { Card, Chips, Seg } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'
import Progress, { Failed } from './Progress.tsx'

/** The card between deciding to compute and the first word back from the worker. */
const STARTING = { phase: '', done: 0, total: 0, startedAt: 0 }

/**
 * How many genes a seed set may hold.
 *
 * Larger than the expression panel's cap, because this is not a panel of
 * figures — a signature is routinely two hundred genes and the cost here is two
 * streamed passes over those genes, not two hundred violins.
 */
const MAX_SEED = 500

type SeedKind = 'gene' | 'set'
/** Which axis the correlation is taken over. */
type Over = 'cell' | 'pool' | 'group' | 'bulk'

const OVER_LABEL: Record<Over, string> = {
  cell: 'Per cell',
  pool: 'Metacells',
  group: 'Cell type × group',
  bulk: 'Pseudobulk',
}

export interface CoexprProps {
  src: Source
  types: CellType[]
  /** The embedding the metacells are pooled on. */
  emb: Embedding
  onPickGene: (g: string) => void
  /** The seed, held in App so it survives a trip to another tab — and so the
   *  Gene sets card can hand a whole signature over. */
  seed: string[]
  onSeed: (genes: string[]) => void
  /** The reader's go-ahead for this question, for the same reason Markers has one. */
  ran: string | null
  onRan: (key: string | null) => void
}

export default function Coexpression(p: CoexprProps) {
  const { src, types, emb } = p
  const d = src.d
  const GENES = src.genes

  const [kind, setKind] = useState<SeedKind>('gene')
  const [q, setQ] = useState('')
  const [text, setText] = useState('')
  const [over, setOver] = useState<Over>('pool')
  const [pools, setPools] = useState(256)
  /**
   * Pearson or Spearman. See CorrMethod for why the choice is only offered on a
   * pooled axis — the per-cell one has nothing rankable in it.
   */
  const [method, setMethod] = useState<CorrMethod>('pearson')
  /** Which levels the aggregate columns are cut on. */
  const [by, setBy] = useState<'cond' | 'sample'>('cond')
  /**
   * What a metacell may not span — hdWGCNA's `group.by`.
   *
   * Cell type x sample by default, which is the constraint that method
   * applies and the one that removes a whole class of artefact: a pool
   * averaging two populations is a profile of neither, and one averaging two
   * animals has quietly pooled the replicates a later claim rests on.
   */
  const [within, setWithin] = useState<Within>('type-sample')
  /**
   * The scope: which cell types and which groups the correlation is computed
   * over. Empty means every one of them, which is the default.
   *
   * Lists, not single names. This is a SCOPE rather than a contrast — "the three
   * cardiomyocyte states, on the HFD arms" is an ordinary thing to ask, and with
   * a `<select>` each the only way to ask it was to run three correlations and
   * compare tables by eye, which is not the same as one correlation over the
   * pooled cells.
   */
  const [cts, setCts] = useState<string[]>([])
  const [conds, setConds] = useState<string[]>([])
  const [minPctPc, setMinPctPc] = useState(10)
  const [top, setTop] = useState(25)
  /** Seurat writes min.pct as a fraction; the control reads as a percentage. */
  const minPct = minPctPc / 100
  const [hideMembers, setHideMembers] = useState(false)

  const hits = useMemo(() => rankGenes(q, GENES, 8, src.names), [q, GENES, src.names])

  /** The seed's genes, resolved against this object. */
  const seedGenes = useMemo(() => {
    if (kind === 'gene') return p.seed.slice(0, 1)
    return p.seed.slice(0, MAX_SEED)
  }, [kind, p.seed])
  const seedSet = useMemo(() => new Set(seedGenes), [seedGenes])
  const isSet = kind === 'set' && seedGenes.length > 1

  /* ---------------- the scope, and the axis over it ---------------- */

  // In the object's own order, so the cache key below does not change when the
  // same scope is picked in a different sequence. null is every type; see
  // scopeMask on why that is not the same as the empty list.
  const tis = useMemo(
    () => (cts.length
      ? types.map((t, i) => (cts.includes(t.name) ? i : -1)).filter(i => i >= 0)
      : null),
    [cts, types])
  const scopeConds = useMemo(
    () => (conds.length ? d.conds.filter(c => conds.includes(c)) : null),
    [conds, d.conds])
  const hasBulk = src.pseudobulk !== null
  const mode: Over = over === 'bulk' && !hasBulk ? 'pool' : over
  // Per cell there is nothing to rank; the control says so and this makes it
  // true rather than trusting the control to have been disabled.
  const how: CorrMethod = mode === 'cell' ? 'pearson' : method

  const keep = useMemo(
    () => scopeMask(src, tis, scopeConds), [src, tis, scopeConds])
  const nScope = useMemo(() => {
    let n = 0
    for (let i = 0; i < keep.length; i++) n += keep[i]
    return n
  }, [keep])

  const axis: Axis | null = useMemo(() => {
    if (mode === 'bulk') return null
    if (mode === 'pool') {
      return poolAxis(emb.xy, keep, d.cells.length, pools,
        constraintOf(d.cells, d.samples, within))
    }
    if (mode === 'group') {
      return groupAxis(d.cells, keep,
        by === 'cond' ? d.conds : d.samples.map(x => x.id), by, types.length)
    }
    return cellAxis(keep, d.cells.length)
  }, [mode, emb, keep, d.cells, d.conds, d.samples, by, within, types.length, pools])

  /* ---------------- the pseudobulk axis, when that is what is asked ---------------- */

  /**
   * The pseudobulk matrix, log-normalised, restricted to the scope's columns.
   *
   * Per column rather than raw: a column is however many cells that sample
   * contributed to that cell type summed together, so raw counts correlate
   * through library size before they correlate through anything biological.
   */
  const bulk = useMemo(() => {
    if (!src.pseudobulk) return null
    return pseudobulkOn(src.pseudobulk, d.samples,
      tis === null ? null : tis.map(i => src.clusters[i]), scopeConds)
  }, [src, d.samples, tis, scopeConds])

  /* ---------------- the seed vector ---------------- */

  /**
   * The seed, and the question it was built for, in ONE piece of state.
   *
   * Not two. Held apart, there is a render between changing the axis and the
   * new seed arriving in which the OLD seed is still on hand and looks ready —
   * and the pass would start against it. That is not a slow frame, it is a
   * wrong answer: a 256-long metacell seed read against 34 367 cell buckets
   * runs off the end of the array, every sum becomes NaN, and the table
   * reported "no gene clears the detection floor" for a scope in which
   * seventy-one of seventy-two genes do. Found in the browser; the arithmetic
   * had been right all along.
   *
   * Keyed, the stale seed is simply not the seed for this question, and there
   * is no window in which it can be mistaken for one.
   */
  const [built, setBuilt] = useState<
    { key: string; vec: Float64Array | null; shape: SetShape | null } | null>(null)
  const [seedErr, setSeedErr] = useState<string | null>(null)
  const token = useRef(0)

  // What the seed depends on. Not the detection floor or the row count — those
  // filter an answer that is already in hand.
  const axisKey = mode === 'bulk'
    ? `bulk|${bulk?.cols.length ?? 0}|${tis?.join('+') ?? 'all'}`
      + `|${scopeConds?.join('+') ?? 'all'}`
    : `${mode}|${mode === 'pool' ? `${emb.key}|${pools}|${within}` : ''}`
      + `|${mode === 'group' ? by : ''}|${tis?.join('+') ?? 'all'}`
      + `|${scopeConds?.join('+') ?? 'all'}|${nScope}`
  const seedKey = `${seedGenes.join(',')}|${axisKey}`

  useEffect(() => {
    const mine = ++token.current
    setSeedErr(null)
    if (!seedGenes.length) { setBuilt({ key: seedKey, vec: null, shape: null }); return }
    const build = async (): Promise<{ vec: Float64Array | null; shape: SetShape | null }> => {
      if (mode === 'bulk') {
        if (!bulk?.values || !bulk.detected) return { vec: null, shape: null }
        const nCols = bulk.cols.length
        const profiles = seedGenes.map(g => {
          const gi = bulk.at.get(g)
          if (gi === undefined) return null
          const row = new Float64Array(nCols)
          for (let k = 0; k < nCols; k++) row[k] = bulk.values![gi * nCols + k]
          return standardise(row)
        })
        const sh = withinSet(profiles)
        return { vec: compose(profiles, sh), shape: sh }
      }
      const ax = axis!
      if (!ax.n) return { vec: null, shape: null }
      // Coherence is always judged on POOLS — see compositeOn. Judging it on
      // single cells would be judging it on shared zeros.
      const judgeOn = ax.pooled ? ax : poolAxis(emb.xy, keep, d.cells.length, pools)
      const profiles = await profilesOn(src, judgeOn, seedGenes)
      const sh = withinSet(profiles)
      if (ax === judgeOn) return { vec: compose(profiles, sh), shape: sh }
      return { vec: await compositeOn(src, ax, seedGenes, sh), shape: sh }
    }
    build().then(({ vec, shape: sh }) => {
      if (token.current !== mine) return
      setBuilt({ key: seedKey, vec, shape: sh })
    }, (e: unknown) => {
      if (token.current !== mine) return
      setSeedErr(e instanceof Error ? e.message : String(e))
    })
    // seedKey is the whole of what the seed depends on; that is its job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey])

  /* ---------------- the pass ---------------- */

  // Only the seed built for THIS question counts as a seed.
  const current = built?.key === seedKey ? built : null
  const seedVec = current?.vec ?? null
  const shape = current?.shape ?? null
  const building = seedGenes.length > 0 && current === null && seedErr === null

  const key = `${seedKey}|${minPct}|${how}`
  const armed = !src.lazy || p.ran === key
  const ready = seedVec !== null

  // No nScope: runInline reads the axis for it, because the denominator of a
  // detection rate is the cells that landed in a bucket rather than the cells
  // the scope selected. Passing it here as well was a second, unread copy that
  // read as though the inline path used a different one.
  const inline = useMemo(
    () => ({ src, axis, seedVec, minPct, how }), [src, axis, seedVec, minPct, how])
  const { value: scanned, pass, failed, retry } = useJob<'correlate'>(
    src, 'correlate', key, ready && armed && mode !== 'bulk',
    () => runInline(inline),
    () => ({
      kind: 'correlate',
      bucket: axis!.of.slice(), size: axis!.size.slice(), nBuckets: axis!.n,
      seed: seedVec!.slice(), nScope: axis!.nCells, minPct, nGenes: src.genes.length,
      pooled: axis!.pooled, method: how,
    }),
  )

  const bulkResult = useMemo(() => {
    if (mode !== 'bulk' || !ready || !bulk?.values || !bulk.detected) return null
    const pb = src.pseudobulk!
    return corrDense(bulk.values, pb.genes.length, bulk.cols.length, seedVec!,
      bulk.detected, minPct, how)
  }, [mode, ready, bulk, seedVec, minPct, src.pseudobulk, how])

  const result: CorrResult | null = mode === 'bulk' ? bulkResult : scanned
  const names = mode === 'bulk' ? (src.pseudobulk?.genes ?? GENES) : GENES

  const table = useMemo(
    () => (result ? rankCorr(result, names, { seedGenes: seedSet, hideMembers, top }) : null),
    [result, names, seedSet, hideMembers, top])

  const waiting = armed && ready && mode !== 'bulk' && src.remote !== null && scanned === null

  /* ---------------- the controls ---------------- */

  const add = (g: string) => { p.onSeed([g]); setQ('') }
  const applyList = () => {
    const { found } = parseGeneList(text, GENES, src.names)
    p.onSeed(found.slice(0, MAX_SEED))
  }

  const label = kind === 'gene'
    ? seedGenes[0] ?? ''
    : `${seedGenes.length} gene${seedGenes.length === 1 ? '' : 's'}`
  const scopeText = `${cts.length ? typesLabel(cts) : 'every cell type'}`
    + `${conds.length ? ` · ${conds.join(' + ')}` : ''}`
  /** What one observation on this axis is, for every sentence that names it. */
  const unit = mode === 'bulk' ? 'pseudobulk columns'
    : mode === 'group' ? `cell type × ${by === 'cond' ? 'group' : 'sample'} columns`
    : mode === 'pool' ? 'metacells' : 'cells'
  const nObs = mode === 'bulk' ? bulk?.cols.length ?? 0 : axis?.n ?? 0

  return (
    <>
      <Card
        eyebrow="Co-expression"
        title="Genes that move with a gene, or with a signature"
        sub={<>{how === 'spearman' ? 'Spearman' : 'Pearson'} r against every gene the object
          measures, over the axis chosen below. Ranked by r — see the note under the table for
          why there is no p-value.</>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Seg<SeedKind> value={kind} onChange={k => { setKind(k); p.onSeed([]) }}
            options={[{ k: 'gene', label: 'One gene' }, { k: 'set', label: 'A gene set' }]} />
          {kind === 'gene' ? (
            <div className="relative">
              <input
                className="inp mono w-[300px]" value={q} autoComplete="off"
                placeholder={seedGenes[0] ? seedGenes[0] : 'search a gene…'}
                aria-label="Seed gene"
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && hits[0]) { e.preventDefault(); add(hits[0]) }
                }}
              />
              {hits.length > 0 && (
                <div className="menu-in absolute left-0 top-full z-40 mt-1 w-[300px] overflow-hidden rounded-[--r-md]"
                  style={{ background: 'var(--surface)', border: '1px solid var(--line-2)',
                           boxShadow: 'var(--shadow-menu)' }}>
                  {hits.map(g => (
                    <button key={g} type="button"
                      className="mono block w-full px-[11px] py-1.5 text-left tx-small"
                      onClick={() => add(g)}>{g}</button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <input
                className="inp mono w-[380px]" value={text}
                placeholder="paste a signature — up to 500 genes"
                aria-label="Seed gene set"
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyList() } }}
              />
              <button className="btn btn-sm" onClick={applyList}>Use these genes</button>
            </>
          )}
          {seedGenes.length > 0 && (
            <span className="tx-small" style={{ color: 'var(--ink-3)' }}>
              seed: <b style={{ color: 'var(--ink)' }}>{label}</b>
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="glabel">Correlate over</span>
          <Seg<Over> value={mode} onChange={setOver}
            disabled={k => k === 'bulk' && !hasBulk}
            options={[
              { k: 'pool', label: OVER_LABEL.pool,
                title: 'Neighbouring cells averaged into equal-sized pools — the default, because it is what makes r mean what it looks like it means' },
              { k: 'cell', label: OVER_LABEL.cell,
                title: 'Every cell its own observation. Dominated by shared zeros on a sparse matrix' },
              { k: 'group', label: OVER_LABEL.group,
                title: 'One column per populated cell type × level, averaged from the cells — needs no counts table, so it works on any object' },
              { k: 'bulk', label: OVER_LABEL.bulk,
                title: hasBulk
                  ? 'Across the sample × cell type columns of the exporter\u2019s pseudobulk table — summed RAW counts, which Cell type × group is not'
                  : 'This object carries no pseudobulk table: either it was exported without raw counts, or it is a collection too large to hold one. Cell type × group answers the same question from the cells themselves' },
            ]} />
          {mode === 'pool' && (
            <>
              <div className="gsep h-6" />
              {/* Each label wraps with the control it names. Loose in the flex
                  they wrap independently, and at 1280 "never spanning" ended
                  one line while the buttons it labels began the next. */}
              <span className="flex items-center gap-2">
                <Chips label="Pools" value={pools} options={[128, 256, 512]} onChange={setPools} />
              </span>
              <span className="flex items-center gap-2">
                <span className="glabel" title="A metacell may not span these — hdWGCNA's group.by">
                  never spanning
                </span>
                <Seg<Within> value={within} onChange={setWithin}
                  options={[
                    { k: 'type-sample', label: 'type × sample',
                      title: 'No metacell averages two cell types or two samples' },
                    { k: 'type', label: 'cell type',
                      title: 'No metacell averages two cell types' },
                    { k: 'none', label: 'nothing',
                      title: 'Pool purely by position on the embedding' },
                  ]}
                  disabled={k => k === 'type-sample' && d.samples.length < 2} />
              </span>
            </>
          )}
          {mode === 'group' && (
            <>
              <div className="gsep h-6" />
              <Seg<'cond' | 'sample'> value={by} onChange={setBy}
                options={[
                  { k: 'cond', label: 'by group', title: 'One column per cell type × group' },
                  { k: 'sample', label: 'by sample',
                    title: 'One column per cell type × sample — more columns, and the closest this gets to replicates' },
                ]} />
            </>
          )}
          <div className="gsep h-6" />
          <label className="flex items-center gap-1.5">
            <span className="glabel">Rank by</span>
            <Seg<CorrMethod>
              value={how} onChange={setMethod}
              disabled={k => k === 'spearman' && mode === 'cell'}
              options={[
                { k: 'pearson', label: 'Pearson',
                  title: 'Linear co-variation — what WGCNA and hdWGCNA use' },
                { k: 'spearman', label: 'Spearman',
                  title: mode === 'cell'
                    ? 'Not offered per cell: most values are exactly zero, so the ranks are'
                      + ' one huge tie block and r would describe the dropout pattern'
                    : 'Pearson on the ranks — monotone rather than linear, so one extreme'
                      + ' pool cannot carry the correlation on its own' },
              ]} />
          </label>
          <div className="gsep h-6" />
          {/* The same picker the contrast bar uses, for the same reason: this is
              a choice of which populations, and a `<select>` can only hold one.
              Empty reads "every cell type", which is both the default and the
              truth — unlike the contrast pickers, an unset scope here is a
              complete question rather than a missing one. */}
          <PickMany label="Cell type" all={types.map(t => t.name)} value={cts}
            noun="cell types" empty="Every cell type" onChange={setCts} />
          {d.multi && (
            <PickMany label="Group" all={d.conds} value={conds}
              noun="groups" empty="Every group" onChange={setConds} />
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="glabel" title="Seurat's min.pct — a gene detected in fewer cells is not ranked">
            Detected in at least
          </span>
          <Seg<string> value={String(minPctPc)} onChange={v => setMinPctPc(Number(v))}
            options={[{ k: '5', label: '5%' }, { k: '10', label: '10%' }, { k: '25', label: '25%' }]} />
          {/*
            axis.nCells, not nScope. The floor is applied against the cells that
            landed in a bucket, and pooling drops any cell whose cell type x
            sample group is too small to build a metacell from — so on a narrow
            scope the two are far apart: 72 Pericytes in scope, 34 of them in a
            metacell, and this line was telling the reader the floor was 10% of
            72 while the code applied 10% of 34. The results paragraph below
            already reported the drop; the control that sets the floor did not.
          */}
          <span className="tx-micro" style={{ color: 'var(--ink-3)' }}
            title={axis && axis.nCells < nScope
              ? `${fmt(nScope - axis.nCells)} of the ${fmt(nScope)} cells in scope sit in a`
                + ' group too small to pool, so they are not in the correlation'
              : undefined}>
            of the {fmt(axis?.nCells ?? nScope)} cells
            {axis && axis.nCells < nScope ? ' that pool' : ' in scope'}
          </span>
          <div className="gsep h-6" />
          <Chips label="Rows each way" value={top} options={[25, 50, 100]} onChange={setTop} />
          {isSet && (
            <>
              <div className="gsep h-6" />
              <button className="chip" aria-pressed={hideMembers}
                onClick={() => setHideMembers(!hideMembers)}
                title="The set's own members come back at the top by construction; this takes them out">
                Hide the set&rsquo;s own genes
              </button>
            </>
          )}
        </div>

        {/* What a set does to itself, before it is used as a seed. */}
        {isSet && shape && <Coherence shape={shape} n={seedGenes.length} />}

        {seedErr ? (
          <div className="note note-warn mt-3">
            <b>The seed could not be read.</b>{' '}
            <span style={{ color: 'var(--ink-2)' }}>{seedErr}</span>
          </div>
        ) : failed ? (
          <Failed error={failed} onRetry={retry} what="The correlation" />
        ) : !seedGenes.length ? (
          <div className="empty mt-4">
            {kind === 'gene' ? 'Search a gene above to correlate against.'
              : 'Paste a signature above, or send one over from Gene sets.'}
          </div>
        ) : (mode === 'bulk' || mode === 'group') && nObs < 3 ? (
          <div className="empty mt-4">
            This scope leaves {nObs} {unit} — too few to correlate over. A correlation
            over two points is +1 or −1 whatever the data says.
            {mode === 'group' && by === 'cond' && d.samples.length > d.conds.length
              && ' Cutting the columns by sample instead would give more of them.'}
            {' '}Widening the scope, or correlating over metacells, also works.
          </div>
        ) : building ? (
          <div className="empty mt-4">Reading the seed…</div>
        ) : !seedVec ? (
          <div className="empty mt-4">
            {seedGenes.length === 1
              ? 'That gene does not vary over this scope, so nothing can correlate with it.'
              : 'None of these genes vary over this scope, so there is no signature to correlate with.'}
          </div>
        ) : !armed ? (
          <div className="empty mt-4">
            <div className="card-title mb-1" style={{ color: 'var(--ink)', marginTop: 0 }}>
              {label} against every gene
            </div>
            {axis && `${fmt(axis.n)} ${axis.pooled ? 'metacells' : 'cells'}`} in {scopeText} —
            one pass over every gene in the object.
            <div className="mt-3.5">
              <button className="btn btn-primary" onClick={() => p.onRan(key)}>Correlate</button>
            </div>
          </div>
        ) : waiting ? (
          <Progress pass={pass ?? STARTING} title={`Correlating ${label} against every gene`} />
        ) : !table ? (
          <div className="empty mt-4">Nothing to show yet.</div>
        ) : table.tested === 0 ? (
          <div className="empty mt-4">
            No gene clears the {pctTxt(minPct)} detection floor in this scope. Lower it, or
            widen the scope.
          </div>
        ) : (
          <>
            <p className="sub mt-3">
              {fmt(table.tested)} genes ranked by {how === 'spearman' ? 'Spearman' : 'Pearson'}
              {' '}r over <b>{fmt(nObs)} {unit}</b> in {scopeText}
              {(mode === 'group' || mode === 'pool') && axis
                ? `, averaged from ${fmt(axis.nCells)} cells`
                : ''}
              {mode === 'pool' && within !== 'none'
                ? `, none spanning two ${within === 'type-sample'
                  ? 'cell types or two samples' : 'cell types'}`
                : ''}.
              {mode === 'pool' && axis && axis.nCells < nScope && (
                <> {fmt(nScope - axis.nCells)} cells sat in a group too small to build a
                  metacell from and are not in the correlation.</>
              )}
            </p>
            <CorrBars up={table.up} down={table.down} />
            <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
              <Side title="Moves with the seed" rows={table.up} dir="up" onPick={p.onPickGene} />
              <Side title="Moves against it" rows={table.down} dir="down" onPick={p.onPickGene} />
            </div>
            <div className="mt-3 flex items-center justify-end">
              {/* The column names WHICH r, and so does the filename. A file
                  called coexpression_Ascl1.csv with a column called "r" is two
                  different analyses under one name once there are two methods,
                  and the one thing a saved file cannot do is ask which it was. */}
              <CsvButton onClick={() => downloadCsv(
                `coexpression_${slug(label)}_${how}`,
                ['gene', `${how}_r`, 'detected', 'is_seed_member'],
                [...table.up, ...table.down].map(row =>
                  [row.gene, row.r.toFixed(4), row.pct.toFixed(4), row.member ? 'yes' : 'no']))} />
            </div>
            <p className="mt-3 tx-micro" style={{ color: 'var(--ink-3)' }}>
              <b>No p-value, deliberately.</b> With {fmt(nObs)} observations a correlation of
              almost any size clears any threshold, and cells from one animal are not
              independent draws — the same reason the studio separates Wilcoxon from
              pseudobulk. Rank by r, and read the detection rate beside it.
              {mode === 'cell' && ' Per cell, two sparsely detected genes also agree wherever'
                + ' they are both absent; metacells are the answer to that.'}
              {mode === 'group' && ' These columns average values that are already'
                + ' log-normalised, which is a mean of logs — not the log of a mean that'
                + " summing raw counts would give. It answers the same question as the"
                + " exporter's pseudobulk table and is not the same quantity, which is why"
                + ' the two are separate modes. A column built from fewer than ten cells is'
                + ' dropped rather than drawn.'}
              {mode === 'pool' && ' Metacells are pooled on the '
                + `${emb.key} embedding, which is a 2-D projection — neighbours there are`
                + ' close to, but not the same as, neighbours in expression space.'
                + ' hdWGCNA builds its metacells the same way but in a reduced space with'
                + ' many more components, which a bundle does not carry; the constraint'
                + ' above is its group.by, and a metacell holds at least ten cells.'}
            </p>
          </>
        )}
      </Card>
    </>
  )
}

/** The composite, for profiles that are already in hand. */
function compose(profiles: (Float64Array | null)[], shape: SetShape): Float64Array | null {
  const first = profiles.find(v => v)
  if (!first) return null
  const out = new Float64Array(first.length)
  shape.used.forEach((mi, i) => {
    const v = profiles[mi]
    if (!v) return
    const w = shape.sign[i] * shape.weight[i]
    for (let k = 0; k < out.length; k++) out[k] += w * v[k]
  })
  return standardise(out)
}

/** The inline path, for an object whose values are already in memory. */
function runInline(o: {
  src: Source; axis: Axis | null; seedVec: Float64Array | null; minPct: number; how: CorrMethod
}): CorrResult {
  const { src, axis, seedVec } = o
  const empty = {
    r: new Float64Array(src.genes.length).fill(NaN),
    pct: new Float64Array(src.genes.length),
  }
  if (!axis || !seedVec || !axis.n) return empty
  const plan = corrPlan({
    bucket: axis.of, size: axis.size, nBuckets: axis.n, seed: seedVec,
    nScope: axis.nCells, minPct: o.minPct, nGenes: src.genes.length, pooled: axis.pooled,
    method: o.how,
  })
  if (!src.scanSync(plan.visit)) return empty
  return plan.done()
}

/**
 * What the set looks like to itself.
 *
 * Reported rather than hidden, because a combined score over an incoherent set
 * is a number a reader should not trust without being told. Two programmes
 * written down as one set is a common and legitimate thing to find — a pathway
 * with an arm that goes the other way — and the honest response is to say so
 * and let them split it, not to average it into silence.
 */
function Coherence({ shape, n }: { shape: SetShape; n: number }) {
  const dropped = n - shape.used.length
  const strong = shape.coherence >= 0.5
  return (
    <div className="panel mt-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="glabel">Within the set</span>
        <span className="tx-small">
          <b style={{ color: strong ? 'var(--good)' : 'var(--warn)' }}>
            {(shape.coherence * 100).toFixed(0)}%
          </b>{' '}
          <span style={{ color: 'var(--ink-3)' }}>of the members&rsquo; variance runs one way</span>
        </span>
        <span className="tx-small">
          <b>{shape.flipped}</b>{' '}
          <span style={{ color: 'var(--ink-3)' }}>
            of {shape.used.length} run against it, and were inverted
          </span>
        </span>
        <span className="tx-small" style={{ color: 'var(--ink-3)' }}>
          mean pairwise r after signing <b style={{ color: 'var(--ink)' }}>
            {shape.meanR.toFixed(2)}</b>
        </span>
        {dropped > 0 && (
          <span className="tx-small" style={{ color: 'var(--ink-3)' }}>
            {dropped} did not vary and were dropped
          </span>
        )}
      </div>
      <p className="mt-1.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
        Each member is standardised and turned the same way round before they are combined,
        so members that move in opposite directions add to the signature rather than
        cancelling in its mean. The combined score is the weighted mean of the members&rsquo;
        own correlations.
        {!strong && <b style={{ color: 'var(--warn)' }}>{' '}This set does not move as one
          programme — read the combined score as a summary of its dominant arm.</b>}
      </p>
    </div>
  )
}

/** One end of the ranking. */
function Side({ title, rows, dir, onPick }: {
  title: string; rows: CorrRow[]; dir: 'up' | 'down'; onPick: (g: string) => void
}) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{title}</div>
      <div className="scrollx" style={{ maxHeight: 420 }}>
        <table className="t">
          <thead><tr><th>Gene</th><th className="num">r</th><th className="num">Detected</th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.gene}>
                <td>
                  <button className="btn-ghost mono italic" title={`Open ${row.gene}`}
                    onClick={() => onPick(row.gene)}>{row.gene}</button>
                  {row.member && (
                    <span className="badge badge-none ml-1.5" title="a member of the seed set">
                      in set
                    </span>
                  )}
                </td>
                <td className="num font-semibold"
                  style={{ color: dir === 'up' ? 'var(--up)' : 'var(--down)' }}>
                  {row.r >= 0 ? '+' : ''}{row.r.toFixed(3)}
                </td>
                <td className="num" style={{ color: 'var(--ink-2)' }}>{pctTxt(row.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Both ends on one axis, so the asymmetry is visible.
 *
 * A table of the positive end and a table of the negative end are two lists; on
 * one shared axis they are one finding, and the thing a reader wants to see
 * first — whether the programme has a strong opposite arm at all — is the
 * length of the bars on the left against the right.
 */
function CorrBars({ up, down }: { up: CorrRow[]; down: CorrRow[] }) {
  const SHOW = 12
  const rows = [...up.slice(0, SHOW), ...down.slice(0, SHOW).reverse()]
  if (!rows.length) return null
  // PB holds two lines under the plate — the tick values and the axis's name.
  // At 26 it held one, and they were both written at H-4: "Pearson r" landed
  // on top of the 0.00 tick, which is the one tick a diverging axis needs.
  const rh = 15, PT = 16, PB = 40, PR = 44
  const PL = Math.max(70, widestW(rows.map(r => r.gene), 10, false) + 12)
  const W = Math.max(520, PL + 360 + PR)
  const H = PT + rows.length * rh + PB
  const span = Math.max(0.05, ...rows.map(r => Math.abs(r.r)))
  const mid = PL + (W - PL - PR) / 2
  const half = (W - PL - PR) / 2
  const X = (r: number) => mid + (r / span) * half

  return (
    <Figure name="coexpression" className="mt-3">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
          preserveAspectRatio="xMinYMid meet" style={{ minWidth: W }} role="img"
          aria-label={`Top correlated and anti-correlated genes`}>
          {[-span, -span / 2, 0, span / 2, span].map(v => (
            <g key={v}>
              <line className="axgrid" x1={X(v)} x2={X(v)} y1={PT - 4} y2={PT + rows.length * rh} />
              <text className="axis" x={X(v)} y={H - PB + 20} textAnchor="middle"
                style={{ fontSize: 10 }}>{v.toFixed(2)}</text>
            </g>
          ))}
          {rows.map((row, i) => {
            const y = PT + i * rh
            const x0 = Math.min(mid, X(row.r))
            const w = Math.abs(X(row.r) - mid)
            return (
              <g key={row.gene}>
                <text x={PL - 8} y={y + rh / 2 + 3.4} textAnchor="end"
                  style={{ fontSize: 10, fill: AXIS_INK, fontStyle: 'italic' }}>{row.gene}</text>
                <rect x={x0} y={y + 2.5} width={Math.max(1, w)} height={rh - 5} rx={1.5}
                  fill={row.r >= 0 ? UP_MARK : DOWN_MARK}
                  stroke={MARK_EDGE} strokeWidth={0.4}>
                  <title>{row.gene} — r {row.r.toFixed(3)}</title>
                </rect>
              </g>
            )
          })}
          <line x1={mid} x2={mid} y1={PT - 4} y2={PT + rows.length * rh}
            stroke={AXIS_INK} strokeWidth={0.9} />
          <text className="axis" x={mid} y={H - 5} textAnchor="middle"
            style={{ fontSize: 10, fontWeight: 600 }}>Pearson r</text>
        </svg>
      </div>
    </Figure>
  )
}
