import { useDeferredValue, useMemo, useState } from 'react'
import type { CellType, GroupBy } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { scoreColumns, zByRow, type Column } from '../lib/columns.ts'
import { axisTicks, widestW } from '../lib/labels.ts'
import { AXIS_INK } from '../lib/figure-ink.ts'
import { rampColor, type PaletteKey } from '../lib/palette.ts'
import { ColorBar } from './svg-parts.tsx'
import type { LibraryState } from '../lib/genesets.ts'
import {
  averagesSpec, geneAveragesSync, resolve, SCORE_DEFAULTS, scoreManyInline, scoreManyPlan,
} from '../lib/score.ts'
import { downloadCsv } from '../lib/download.ts'
import { useJob } from '../lib/compute.ts'
import { Card, Seg } from './Ui.tsx'
import ColumnFilter from './ColumnFilter.tsx'
import Figure, { CsvButton } from './Figure.tsx'
import Progress, { Failed } from './Progress.tsx'

const STARTING = { phase: '', done: 0, total: 0, startedAt: 0 }

/**
 * How many signatures may be scored together.
 *
 * Not a performance limit on the PASS — that is one walk over the matrix
 * whatever the number. It bounds the two things that do grow: the scores, at
 * one Float32 per set per cell (thirty sets over the 292 495-cell atlas is
 * 35 MB), and the figure, which stops being readable long before that.
 */
const MAX_SETS = 30

/**
 * Several signatures, scored together and compared.
 *
 * The single-set card answers "how strongly does each cell express this
 * signature". The question people ask straight afterwards is which of several
 * signatures a population expresses, and answering it one set at a time made
 * the studio read the file once per set — on a collection that is minutes each,
 * so seven pasted pathways cost seven passes for an answer that is one walk
 * over the matrix.
 *
 * It is one pass now, and the numbers are unchanged: `scoreManyPlan` runs the
 * ordinary `scorePlan` per set, so every signature keeps its OWN control genes,
 * matched to its own expression levels. Sharing one control set across seven
 * would be faster still and would score every one of them against the wrong
 * baseline. scripts/test-sets.mjs holds the two paths to bit-for-bit equality.
 */
export default function ScoreMany({
  src, types, palKey, lib, ran, onRan,
}: {
  src: Source
  types: CellType[]
  palKey: PaletteKey
  lib: LibraryState
  /** The reader's go-ahead for this selection, joined. */
  ran: string | null
  onRan: (key: string | null) => void
}) {
  const d = src.d
  const [picked, setPicked] = useState<string[]>([])
  const [find, setFind] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [hideT, setHideT] = useState<Set<number>>(new Set())
  const [hideC, setHideC] = useState<Set<string>>(new Set())
  /**
   * z-score each signature across the columns shown.
   *
   * Off by default: the raw mean is the number AddModuleScore produces and its
   * zero means something. On, every row says where THAT signature is highest
   * rather than how large it is — which is the only way to compare a signature
   * of eight abundant genes against one of forty rare ones, and those are the
   * two rows a reader most wants to put side by side.
   */
  const [scale, setScale] = useState(false)
  const query = useDeferredValue(find)

  /** Every set on offer, names only — the members are read when one is chosen. */
  const allSets = useMemo(() => lib.collections.flatMap(
    (c, ci) => c.sets.map((s, si) => ({
      id: s.id, name: s.name, source: c.source, ci, si, n: s.genes.length,
      hay: `${s.name} ${s.id}`.toLowerCase(),
    }))), [lib.collections])
  const byId = useMemo(() => new Map(allSets.map(s => [s.id, s])), [allSets])

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    const words = q ? q.split(/\s+/) : []
    const out = []
    for (const s of allSets) {
      if (!words.length || words.every(w => s.hay.includes(w))) out.push(s)
      if (out.length >= 40) break
    }
    return out
  }, [allSets, query])

  const toggle = (id: string) => setPicked(p =>
    p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_SETS ? p : [...p, id])

  /**
   * The chosen sets, resolved against this object and dropped if empty here.
   *
   * The members are read HERE and nowhere earlier. `allSets` above deliberately
   * carries names and counts only: resolving every set's symbols to build the
   * picker is a million strings across the default library, for a list of forty
   * the reader scrolls past.
   */
  const chosen = useMemo(() => {
    const out: { id: string; name: string; source: string; used: string[] }[] = []
    for (const id of picked) {
      const s = byId.get(id)
      if (!s) continue
      const c = lib.collections[s.ci]
      const members = c?.sets[s.si]
      if (!members) continue
      const { used } = resolve(src, Array.from(members.genes, i => c.symbols[i]))
      if (used.length) out.push({ id, name: s.name, source: s.source, used })
    }
    return out
  }, [picked, byId, src, lib.collections])

  const key = chosen.map(c => `${c.id}:${c.used.length}`).join('|')
  const armed = !src.lazy || ran === key
  const enabled = chosen.length > 1 && armed

  const { value: avg, pass: binPass, failed: binFailed, retry: binRetry } = useJob<'averages'>(
    src, 'averages', 'gene averages', chosen.length > 1 && armed,
    () => geneAveragesSync(src) ?? new Float64Array(src.genes.length),
    () => ({ kind: 'averages', ...averagesSpec(src) }),
  )

  const spec = useMemo(
    () => (avg && chosen.length > 1
      ? scoreManyPlan(src, chosen.map(c => c.used), avg, SCORE_DEFAULTS)
      : null),
    [src, chosen, avg])

  const { value: out, pass: scorePass, failed: scoreFailed, retry: scoreRetry } = useJob<'scoreMany'>(
    src, 'scoreMany', `many|${key}`, spec !== null && enabled,
    () => ({ scores: scoreManyInline(src, spec!), nSets: spec!.nSets }),
    // The engine takes the buffers, so the job gets copies — the spec outlives it.
    () => ({
      kind: 'scoreMany',
      ptr: spec!.ptr.slice(), set: spec!.set.slice(), w: spec!.w.slice(),
      nSets: spec!.nSets, nCells: spec!.nCells, nGenes: spec!.nGenes,
    }),
  )
  const pass = binPass ?? scorePass
  const failed = binFailed ?? scoreFailed
  const retry = binFailed ? binRetry : scoreRetry
  const waiting = enabled && src.remote !== null && out === null

  /**
   * The columns, and the cells in each.
   *
   * `scoreColumns`, not `identities` — see lib/columns.ts. The difference is
   * the reported bug: with identities, "across groups" meant the groups WITHIN
   * whichever cell type was selected in the bar at the top of the page, so a
   * figure that reads as "this signature across the whole experiment" was one
   * cell type's cells and nothing said so. Here a column carries its own cells,
   * which is what lets a group pool every cell type.
   */
  // The filter records what is HIDDEN; the columns want what is KEPT. Null
  // rather than a full set when nothing is hidden, so the common case allocates
  // nothing and `scoreColumns` can skip the membership test entirely.
  const keepT = useMemo(
    () => (hideT.size ? new Set(types.map((_t, i) => i).filter(i => !hideT.has(i))) : null),
    [types, hideT])
  const keepC = useMemo(
    () => (hideC.size ? new Set(d.conds.filter(c => !hideC.has(c))) : null),
    [d.conds, hideC])
  const cols = useMemo(
    () => scoreColumns(d, types, groupBy, palKey, keepT, keepC),
    [d, types, groupBy, palKey, keepT, keepC])

  /** The mean score of each signature in each column, in one walk. */
  const grid = useMemo(() => {
    if (!out || !chosen.length || !cols.length) return null
    const n = d.cells.length
    const raw = new Float64Array(chosen.length * cols.length)
    cols.forEach((col, k) => {
      for (let s = 0; s < chosen.length; s++) {
        let sum = 0
        const base = s * n
        for (const i of col.cells) sum += out.scores[base + i]
        raw[s * cols.length + k] = sum / col.cells.length
      }
    })
    return scale ? zByRow(raw, chosen.length, cols.length) : raw
  }, [out, chosen, cols, d.cells.length, scale])

  const modes: { k: GroupBy; label: string }[] = [
    { k: 'type', label: 'Across cell types' },
    ...(d.multi
      ? [{ k: 'cond' as const, label: 'Across groups' }, { k: 'both' as const, label: 'Cell type × group' }]
      : []),
  ]

  return (
    <Card
      eyebrow="Gene sets · several at once"
      title="Which signature does each population express?"
      sub={<>One <b>AddModuleScore</b> per set, computed in a single pass over the matrix.
        Every set keeps its own control genes, so the numbers are the ones scoring them
        one at a time would give.</>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="inp w-[380px]" value={find}
          placeholder={lib.loading ? 'loading…' : `search ${allSets.length.toLocaleString()} sets to add…`}
          aria-label="Search sets to score together"
          disabled={lib.loading}
          onChange={e => setFind(e.target.value)}
        />
        {/* The case this exists for: a collection somebody pasted, scored whole. */}
        {lib.collections.filter(c => c.sets.length <= MAX_SETS).map(c => (
          <button key={c.source} className="btn btn-sm"
            onClick={() => setPicked(c.sets.slice(0, MAX_SETS).map(s => s.id))}
            title={`Score every set in ${c.source}`}>
            All {c.sets.length} in {c.source}
          </button>
        ))}
        {picked.length > 0 && (
          <button className="btn btn-quiet" onClick={() => setPicked([])}>Clear</button>
        )}
      </div>

      {!lib.loading && (
        <div className="panel mt-2 max-h-[170px] overflow-y-auto" role="listbox"
          aria-label="Sets to score together">
          {hits.map(h => (
            <button key={h.id} role="option" aria-selected={picked.includes(h.id)}
              className="type-toggle flex w-full items-baseline gap-2 rounded-[--r-md] px-2 py-1 text-left"
              style={{ background: picked.includes(h.id) ? 'var(--surface)' : 'transparent' }}
              onClick={() => toggle(h.id)}>
              <span className="glabel flex-none" style={{ width: 92 }}>{h.source}</span>
              <span className="min-w-0 flex-1 truncate tx-small"
                style={{ fontWeight: picked.includes(h.id) ? 600 : 400 }}>{h.name}</span>
              <span className="mono flex-none tx-micro" style={{ color: 'var(--ink-3)' }}>{h.n}</span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        {picked.length} chosen{picked.length >= MAX_SETS && ` — ${MAX_SETS} is the most`}
        {picked.length > chosen.length
          && `, ${picked.length - chosen.length} of them measure no gene in this object`}
      </p>

      {failed ? (
        <Failed error={failed} onRetry={retry} what="The module scores" />
      ) : chosen.length < 2 ? (
        <div className="empty mt-4">
          Choose at least two sets. One at a time is the card above, which also draws it on
          the embedding.
        </div>
      ) : !armed ? (
        <div className="empty mt-4">
          <div className="card-title mb-1" style={{ color: 'var(--ink)', marginTop: 0 }}>
            {chosen.length} signatures
          </div>
          One pass over every cell, whatever the number of sets.
          <div className="mt-3.5">
            <button className="btn btn-primary" onClick={() => onRan(key)}>Score them</button>
          </div>
        </div>
      ) : waiting ? (
        <Progress pass={pass ?? STARTING} title={`Scoring ${chosen.length} signatures`} />
      ) : grid ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="glabel">Group by</span>
            <Seg<GroupBy> value={groupBy} onChange={setGroupBy} options={modes} />
            <div className="gsep h-6" />
            <button className="chip" aria-pressed={scale} onClick={() => setScale(!scale)}
              title="z-score each signature across the columns shown, so a small signature and a large one can be compared">
              Scale each signature
            </button>
          </div>
          <ColumnFilter types={types} conds={d.conds} groupBy={groupBy}
            hideT={hideT} hideC={hideC} onHideT={setHideT} onHideC={setHideC}
            palKey={palKey} label="Columns in this figure" />
          <Figure name="module_scores" className="mt-1">
            {/* Always diverging, never the reader's sequential ramp: a module
                score is signed and its zero means something — a scale whose
                neutral sits anywhere else misreports which way a population
                went. */}
            <ScoreGrid rows={chosen.map(c => c.name)} cols={cols} mean={grid} scale={scale} />
          </Figure>
          <div className="mt-2 flex items-center justify-end">
            <CsvButton onClick={() => downloadCsv(
              scale ? 'module_scores_scaled' : 'module_scores',
              ['set', ...cols.map(c => c.full)],
              chosen.map((c, s) => [c.name,
                ...cols.map((_c, k) => grid[s * cols.length + k].toFixed(4))]))} />
          </div>
          <p className="sub mt-2">
            {scale
              ? <>Colour is <b>z-scored along each signature</b> — where that signature is
                  highest, not how large it is.</>
              : <>Colour is the mean score of that signature in that population. Zero is the
                  reference: no higher than genes of comparable abundance.</>}
          </p>
        </>
      ) : (
        <div className="empty mt-4">Nothing to show yet.</div>
      )}
    </Card>
  )
}

/** Signatures down the side, populations along the bottom. */
function ScoreGrid({ rows, cols, mean, scale }: {
  rows: string[]
  cols: Column[]
  mean: Float64Array
  scale: boolean
}) {
  const cw = 34, rh = 18, PT = 12, PR = 20, BAR_H = 58
  const PL = Math.max(90, widestW(rows, 10.5, false) + 14)
  const labels = cols.map(c => c.label)
  const ax = axisTicks(labels, { band: cw, leftAnchor: PL + cw / 2, px: 9, startAt: 10, upright: 24 })
  const W = PL + cols.length * cw + PR
  const plotB = PT + rows.length * rh
  const H = plotB + ax.bottom + BAR_H

  // Symmetric around zero, because a module score has a meaningful zero and a
  // diverging scale that is not centred on it is a scale that lies about sign.
  let m = 0
  for (const v of mean) m = Math.max(m, Math.abs(v))
  const lo = -(m || 1), hi = m || 1

  return (
    <div className="mt-2 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: '100%' }}
        role="img" aria-label={`Mean module score of ${rows.length} signatures across ${cols.length} populations`}>
        {rows.map((r, si) => cols.map((col, k) => (
          <rect key={`${si}-${k}`} x={PL + k * cw} y={PT + si * rh} width={cw} height={rh}
            fill={rampColor((mean[si * cols.length + k] - lo) / (hi - lo), 'rdbu')}>
            <title>
              {r} in {col.full} — {scale ? 'z ' : ''}{mean[si * cols.length + k].toFixed(3)}
              {' · '}{col.cells.length.toLocaleString()} cells
            </title>
          </rect>
        )))}
        {rows.map((r, si) => (
          <text key={r} x={PL - 6} y={PT + si * rh + rh / 2 + 3.6} textAnchor="end"
            style={{ fontSize: 10.5, fill: AXIS_INK }}>{r}<title>{r}</title></text>
        ))}
        {labels.map((lab, k) => {
          const cx = PL + cw * (k + 0.5)
          return ax.rotate ? (
            <text key={k} className="axis" transform={`rotate(${-ax.deg} ${cx} ${plotB + 10})`}
              x={cx} y={plotB + 10} textAnchor="end" style={{ fontSize: 9 }}>{lab}</text>
          ) : (
            <text key={k} className="axis" x={cx} y={plotB + 12} textAnchor="middle"
              style={{ fontSize: 9 }}>{lab}</text>
          )
        })}
        <ColorBar cx={W / 2} y={H - BAR_H + 22} w={170} h={10} ramp="rdbu"
          lo={lo} hi={hi} id="scoremany"
          title={scale ? 'z-score, along each signature' : 'mean module score'}
          breaks={scale ? [-2.5, 0, 2.5] : undefined} />
      </svg>
    </div>
  )
}
