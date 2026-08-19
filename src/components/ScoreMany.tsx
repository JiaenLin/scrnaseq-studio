import { useDeferredValue, useMemo, useState } from 'react'
import type { CellType, GroupBy } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { identities } from '../lib/chart.ts'
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
  src, types, ct, palKey, lib, ran, onRan,
}: {
  src: Source
  types: CellType[]
  ct: string
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

  const ids = useMemo(
    () => identities(d, types, groupBy, ct, palKey), [d, types, groupBy, ct, palKey])

  /**
   * The mean score of each set in each identity.
   *
   * One walk over the cells per set, rather than a filter per identity per set:
   * on the atlas the second is 133 identities x 292 495 cells x however many
   * sets, which is the figure taking seconds to appear after a pass that cost
   * nothing extra.
   */
  const grid = useMemo(() => {
    if (!out || !chosen.length) return null
    const nC = d.conds.length
    const condAt = new Map(d.conds.map((c, i) => [c, i]))
    const width = groupBy === 'type' ? 1 : nC
    const slot = new Int32Array(types.length * width).fill(-1)
    ids.forEach((id, k) => {
      const s = id.ti * width + (groupBy === 'type' ? 0 : condAt.get(id.cond) ?? -1)
      if (id.ti >= 0 && id.ti < types.length && s >= 0 && s < slot.length) slot[s] = k
    })
    const n = d.cells.length
    const sum = new Float64Array(chosen.length * ids.length)
    const size = new Int32Array(ids.length)
    for (let i = 0; i < n; i++) {
      const c = d.cells[i]
      if (c.t < 0 || c.t >= types.length) continue
      const ci = groupBy === 'type' ? 0 : condAt.get(c.cond) ?? -1
      if (ci < 0) continue
      const k = slot[c.t * width + ci]
      if (k < 0) continue
      size[k]++
      for (let s = 0; s < chosen.length; s++) sum[s * ids.length + k] += out.scores[s * n + i]
    }
    const mean = new Float64Array(chosen.length * ids.length)
    for (let s = 0; s < chosen.length; s++) {
      for (let k = 0; k < ids.length; k++) {
        mean[s * ids.length + k] = size[k] ? sum[s * ids.length + k] / size[k] : 0
      }
    }
    return { mean, size }
  }, [out, chosen, ids, d, types.length, groupBy])

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
          </div>
          <Figure name="module_scores" className="mt-1">
            {/* Always diverging, never the reader's sequential ramp: a module
                score is signed and its zero means something — a scale whose
                neutral sits anywhere else misreports which way a population
                went. */}
            <ScoreGrid rows={chosen.map(c => c.name)} ids={ids} mean={grid.mean}
              groupBy={groupBy} />
          </Figure>
          <div className="mt-2 flex items-center justify-end">
            <CsvButton onClick={() => downloadCsv(
              'module_scores',
              ['set', ...ids.map(i => i.full)],
              chosen.map((c, s) => [c.name,
                ...ids.map((_i, k) => grid.mean[s * ids.length + k].toFixed(4))]))} />
          </div>
          <p className="sub mt-2">
            Colour is the mean score of that signature in that population. Zero is the
            reference: no higher than genes of comparable abundance.
          </p>
        </>
      ) : (
        <div className="empty mt-4">Nothing to show yet.</div>
      )}
    </Card>
  )
}

/** Signatures down the side, populations along the bottom. */
function ScoreGrid({ rows, ids, mean, groupBy }: {
  rows: string[]
  ids: ReturnType<typeof identities>
  mean: Float64Array
  groupBy: GroupBy
}) {
  const cw = 34, rh = 18, PT = 12, PR = 20, BAR_H = 58
  const PL = Math.max(90, widestW(rows, 10.5, false) + 14)
  const labels = ids.map(i => (groupBy === 'both' ? i.full : i.label))
  const ax = axisTicks(labels, { band: cw, leftAnchor: PL + cw / 2, px: 9, startAt: 10, upright: 24 })
  const W = PL + ids.length * cw + PR
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
        role="img" aria-label={`Mean module score of ${rows.length} signatures across ${ids.length} populations`}>
        {rows.map((r, si) => ids.map((id, k) => (
          <rect key={`${si}-${k}`} x={PL + k * cw} y={PT + si * rh} width={cw} height={rh}
            fill={rampColor((mean[si * ids.length + k] - lo) / (hi - lo), 'rdbu')}>
            <title>{r} in {id.full} — {mean[si * ids.length + k].toFixed(3)}</title>
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
          lo={lo} hi={hi} id="scoremany" title="mean module score" />
      </svg>
    </div>
  )
}
