import { useEffect, useMemo, useState } from 'react'
import type { CellType, Dataset } from '../types.ts'
import { maxOf, maxOfAll, minOf, niceStep, pctTxt } from '../lib/chart.ts'
import {
  compFields, compHeader, compName, compTable, defaultRowAxis, fieldLabel, levelsOf,
  refuses, rowAxes,
  type CompField, type CompTable,
} from '../lib/composition.ts'
import { downloadCsv } from '../lib/download.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import { MIN_CELLS_GROUP } from '../lib/stats.ts'
import { Card, Empty, Legend } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'

/**
 * How many rows are drawn at once.
 *
 * Cell type × sample is 12 369 combinations on the atlas and several thousand
 * of them hold cells; drawing them all is a page nobody can read and a tab that
 * stops responding. The cap never bites on the default pairing, whatever the
 * object — an object with 400 samples still gets all 400 rows — it only bites
 * on the product axes the user has to ask for, and the CSV still has everything.
 */
const ROW_CAP = 300

interface Choice {
  parts: CompField
  /** RowAxis key. */
  rows: string
  /** Level index of the outer row field to restrict to, or -1 for all. */
  only: number
}

/**
 * The pairing survives leaving the tab.
 *
 * Composition unmounts whenever another tab is open, so a plain useState would
 * silently reset a control the user set. Remembered per object, outside React's
 * tree, so the choice is kept without every ancestor having to know about it.
 */
const REMEMBERED = new WeakMap<Dataset, Choice>()

/**
 * Cell types, one row per animal — the figure this tab has always opened on.
 *
 * The row axis is not named here. It is asked for, by the same rule the bars
 * menu uses, so the arrival state and every later change agree about what is
 * drawable; see defaultRowAxis.
 */
const arrival = (d: Dataset, types: CellType[]): Choice =>
  ({ parts: 'type', rows: defaultRowAxis(d, types, 'type').key, only: -1 })

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Demo sample ids carry a group prefix the group tick already shows. */
const shortSample = (s: string) => s.replace(/^(SVZ|TC)_/, '')

export default function Composition({ d, types, palKey }: {
  d: Dataset
  types: CellType[]
  palKey: PaletteKey
}) {
  const [choice, setChoice] = useState<Choice>(() => REMEMBERED.get(d) ?? arrival(d, types))
  useEffect(() => { REMEMBERED.set(d, choice) }, [d, choice])

  const fields = compFields(d)
  const parts: CompField = fields.includes(choice.parts) ? choice.parts : 'type'
  const axes = rowAxes(d, parts)
  const axis = axes.find(a => a.key === choice.rows) ?? axes[0]
  const rowFields = axis.fields

  const table = compTable(d, types, parts, rowFields)
  const outer = rowFields.length > 1 ? rowFields[0] : null
  const innerField = rowFields[rowFields.length - 1]

  // Memoized because each call builds a fresh array of up to 133 names, and
  // these feed the row list below.
  const partNames = useMemo(() => levelsOf(d, types, parts), [d, types, parts])
  const outerNames = useMemo(() => (outer ? levelsOf(d, types, outer) : []), [d, types, outer])
  const innerNames = useMemo(() => levelsOf(d, types, innerField), [d, types, innerField])

  // Which outer levels the table actually holds — offering a cell type that no
  // sample contains would filter the figure down to nothing.
  const outerLevels = useMemo(() => {
    if (!outer) return []
    const seen = new Set<number>()
    for (const r of table.rows) seen.add(r.keys[0])
    return [...seen].sort((a, b) => a - b)
  }, [table, outer])

  const only = outer && outerLevels.includes(choice.only) ? choice.only : -1
  const set = (patch: Partial<Choice>) => setChoice({ parts, rows: axis.key, only, ...patch })

  const condAt = useMemo(
    () => new Map(d.conds.map((c, i) => [c, i])), [d.conds])

  /** Every row the user asked for, before the drawing cap. */
  const chosen = useMemo(() => {
    const out: { i: number; label: string; group: string | null; color: string }[] = []
    table.rows.forEach((r, i) => {
      if (only >= 0 && r.keys[0] !== only) return
      const innerKey = r.keys[r.keys.length - 1]
      const label = innerField === 'sample'
        ? shortSample(innerNames[innerKey] ?? '')
        : innerNames[innerKey] ?? ''
      // With no outer field the tick still carries something: for the classic
      // one-row-per-sample view that is the sample's group, which is what this
      // figure has always shown beside the row name.
      const color = outer
        ? pal(r.keys[0], palKey)
        : innerField === 'sample'
          ? pal(condAt.get(d.samples[innerKey]?.cond ?? '') ?? 0, palKey)
          : pal(innerKey, palKey)
      out.push({ i, label, group: outer ? outerNames[r.keys[0]] ?? '' : null, color })
    })
    return out
  }, [table, only, outer, innerField, innerNames, outerNames, palKey, condAt, d.samples])

  const drawn = chosen.slice(0, Math.max(ROW_CAP, d.samples.length))
  const hidden = chosen.length - drawn.length

  // The rule this figure is built on: a bar may not merge the cells of several
  // samples unless the samples are what the bar is divided into.
  const violates = refuses(table)

  /**
   * The one-click fix, resolved rather than assumed: the samples nested inside
   * the rows that were asked for.
   *
   * It exists whenever the figure refuses — a refusal means neither the rows nor
   * the bars are the samples, so `sample` is still free to nest — and it can
   * never itself pool, because a row ending in a sample is inside one animal by
   * construction. That is why the card offers it as the answer rather than as a
   * fallback. Looked up all the same, so that an object which somehow breaks the
   * argument gets no button instead of a button that changes the figure to
   * something else.
   */
  const fixAxis = violates ? axes.find(a => a.key === `${rowFields[0]}+sample`) : undefined
  // The rows hold two fields, so nesting the samples costs the second one.
  const dropped = fixAxis && rowFields.length > 1 ? rowFields[1] : null

  /**
   * How much of the product this object actually has, and how much of that is
   * too small to read.
   *
   * 11 dissections and 20 ages multiply to 220 combinations, and 133 cell types
   * against either is well past a thousand — but an embryo is dissected at one
   * age, so most of that grid is a combination that was never collected. Drawn
   * without saying so it reads as rows missing rather than as rows that do not
   * exist, and the rows that do exist are then a mix of ten thousand cells and
   * two. The floor is the one the DE tab refuses a contrast at, because a row
   * that cannot support a test cannot support a percentage either.
   */
  const thin = useMemo(
    () => table.rows.reduce((n, r) => n + (r.n < MIN_CELLS_GROUP ? 1 : 0), 0),
    [table])
  const sparse = rowFields.length > 1 && table.rows.length * 2 < table.possible

  const partsLabel = fieldLabel(d, parts)
  // Both download names, in the object's own words — see compName. The screen
  // has always called a carried column what the object called it; a file called
  // composition_type_by_extra0.csv told its reader a list position instead.
  const name = compName(d, parts, rowFields)

  const saveCsv = () => {
    const header = compHeader(d, parts, rowFields)
    const names = rowFields.map(f => levelsOf(d, types, f))
    const body: unknown[][] = []
    for (const row of chosen) {
      const r = table.rows[row.i]
      const base = r.keys.map((k, j) => names[j][k])
      for (let p = 0; p < table.nParts; p++) {
        const c = table.counts[row.i * table.nParts + p]
        if (!c) continue
        // `samples` is not decoration. This button sits above the refusal card
        // as well as above a figure, so a pairing the tab will not draw can
        // still be exported — and `fraction` is then exactly the pooled
        // percentage the figure refused. Withholding the counts would be worse
        // than exporting them; leaving the file unable to say which rows are
        // several animals averaged together is what makes it dishonest.
        body.push([...base, partNames[p], c, r.n, r.nSamples, (c / r.n).toFixed(6)])
      }
    }
    downloadCsv(name, header, body)
  }

  return (
    <>
      <Card
        eyebrow="Composition"
        title={`${partsLabel} proportions, one row per ${axis.label.toLowerCase()}`}
        sub={<>Horizontal, because the quantity being read is a percentage and percentages are read
          along a shared axis. {d.samples.length > 1
            ? 'Never pooled across samples — cells from one animal are not independent observations, so a bar that would merge several animals is refused rather than drawn.'
            : 'This object contains one sample, so this is a description of it and not a comparison.'}</>}
      >
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-1.5">
            <span className="glabel">Bars show</span>
            <select
              className="sel" value={parts}
              onChange={e => {
                const next = e.target.value as CompField
                setChoice({ parts: next, rows: defaultRowAxis(d, types, next).key, only: -1 })
              }}
            >
              {fields.map(f => <option key={f} value={f}>{fieldLabel(d, f)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="glabel">One row per</span>
            <select
              className="sel max-w-[240px]" value={axis.key}
              onChange={e => set({ rows: e.target.value, only: -1 })}
            >
              {axes.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          {outer && (
            <label className="flex items-center gap-1.5">
              <span className="glabel">Limit to</span>
              <select
                className="sel max-w-[220px]" value={only}
                onChange={e => set({ only: Number(e.target.value) })}
              >
                <option value={-1}>every {fieldLabel(d, outer).toLowerCase()}</option>
                {outerLevels.map(k => <option key={k} value={k}>{outerNames[k]}</option>)}
              </select>
            </label>
          )}
          <div className="ml-auto"><CsvButton onClick={saveCsv} /></div>
        </div>

        {violates ? (
          <Empty title={`One row per ${axis.label.toLowerCase()} would pool cells across samples`}>
            {/* Said with this object's numbers and this object's words. A rule that
                cannot state how much it is refusing, or why this particular object
                forces it, reads as the app being fussy — and the reader's next move
                is to look for the setting that turns it off. */}
            <div className="mx-auto max-w-[560px]">
              {table.pooledRows === table.rows.length
                ? <>Every one of these {table.rows.length.toLocaleString('en-US')} rows</>
                : <>{table.pooledRows.toLocaleString('en-US')} of
                  these {table.rows.length.toLocaleString('en-US')} rows</>} would merge whole
              samples into one bar{table.worstPool > 1 && <>, up
              to {table.worstPool.toLocaleString('en-US')} animals in a single row</>}.{' '}
              {/* Which of the three sentences is the true one is a fact about how the
                  object was collected, and it is the sentence that decides whether the
                  reader believes the rule or goes looking for the switch that turns it
                  off. "Only 93 of 93" was the version that read as a bug. */}
              {table.spanningSamples === 0 ? (
                <>Not one of this object&rsquo;s {d.samples.length.toLocaleString('en-US')} samples
                reaches more than one <b>{axis.label}</b> — each was collected inside a single
                one — so nothing about these two fields can separate the animals, and naming
                them is the only thing that will. That is how the experiment was collected,
                not something this tab declines to do.</>
              ) : table.spanningSamples === d.samples.length ? (
                <>Every one of this object&rsquo;s {d.samples.length.toLocaleString('en-US')}{' '}
                samples reaches more than one <b>{axis.label}</b>, so each of these rows draws
                on many animals at once.</>
              ) : (
                <>Only {table.spanningSamples.toLocaleString('en-US')} of this
                object&rsquo;s {d.samples.length.toLocaleString('en-US')} samples reach more than
                one <b>{axis.label}</b>, so most of these rows are whole animals averaged
                together.</>
              )}
            </div>
            <div className="mx-auto mt-2 max-w-[560px]">
              Cells from one animal are not independent observations, so those percentages would
              look far more precise than the experiment supports — a single large sample would
              set the whole bar.
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {fixAxis && (
                <button
                  className="btn btn-primary"
                  onClick={() => set({ rows: fixAxis.key, only: -1 })}
                >Break it down by sample as well</button>
              )}
              {parts === 'type' && (
                <button className="btn" onClick={() => set({ rows: 'sample', only: -1 })}>
                  One row per sample
                </button>
              )}
            </div>
            {fixAxis && (
              <div className="mx-auto mt-3 max-w-[560px] text-[12px]" style={{ color: 'var(--ink-3)' }}>
                That draws one row per <b>{fixAxis.label}</b> — the same{' '}
                {partsLabel.toLowerCase()} proportions over the same cells, with every animal on
                its own row instead of averaged into its neighbours. It is the comparison you
                asked for with the pooling undone, not a smaller question: the spread the merged
                bar would have hidden is what you get back.
                {dropped && <> The rows hold two fields, so <b>{fieldLabel(d, dropped)}</b> comes
                off them to make room for the samples; it is still on the “bars show” menu
                above.</>}
              </div>
            )}
            {parts === 'type' && rowFields[0] === 'cond' && (
              <div className="mx-auto mt-3 max-w-[560px] text-[12px]" style={{ color: 'var(--ink-3)' }}>
                The panels below answer the same question honestly too: a bar per group with the
                individual samples drawn on top, so the spread between animals stays visible.
              </div>
            )}
          </Empty>
        ) : (
          <>
            {table.degenerate && (
              <div className="note mt-4">
                <b>Every row falls in a single {partsLabel.toLowerCase()}.</b> A sample belongs to
                exactly one group, so with these two fields each bar is one solid block. Pick a
                different field for the bars.
              </div>
            )}
            {hidden > 0 && (
              <div className="note mt-4">
                <b>Showing {drawn.length} of {chosen.length} rows.</b> Narrow it with the{' '}
                {outer ? `“limit to” menu` : 'menus'} above — the CSV export still contains every
                non-empty combination.
              </div>
            )}
            {(sparse || thin > 0) && (
              <div className="note mt-4">
                {sparse && <>
                  <b>{axis.label} makes {table.possible.toLocaleString('en-US')} combinations,
                  and {table.rows.length.toLocaleString('en-US')} of them hold any
                  cells.</b>{' '}These two were not crossed in the experiment — the rest are
                  combinations that were never collected, not rows that went missing.{' '}
                </>}
                {thin > 0 && <>
                  {thin.toLocaleString('en-US')} of the {table.rows.length.toLocaleString('en-US')}
                  {' '}rows hold fewer than {MIN_CELLS_GROUP} cells. A bar drawn from two cells is
                  0% or 100% and nothing else; the DE tab refuses a contrast at the same floor.
                </>}
              </div>
            )}
            <Figure name={name} className="mt-4 pt-6">
              <StackedRows
                rows={drawn} table={table} partNames={partNames} palKey={palKey}
                hasGroup={!!outer && only < 0}
                label={`${partsLabel} proportions, one row per ${axis.label.toLowerCase()}`}
              />
            </Figure>
            <Legend
              items={partNames.map((n, i) => [pal(i, palKey), n])}
              note={`${drawn.length} row${drawn.length === 1 ? '' : 's'} · ${table.nCells.toLocaleString('en-US')} cells`}
            />
          </>
        )}
      </Card>

      {d.multi && (
        <Card
          eyebrow="Per cell type" title="Proportion by group"
          sub={<>One panel per cell type, each with its own y axis — a shared axis would flatten
            every population except the largest. {d.samples.length > d.conds.length
              ? 'Dots are the individual animals; if they overlap between groups, the difference in the bars is not evidence.'
              : 'One sample per group, so each bar is a single measurement with no spread to show.'}</>}
        >
          <div className="mt-3.5 flex justify-end">
            <CsvButton
              onClick={() => downloadCsv(
                'composition_type_by_group_per_sample',
                ['type', 'sample', 'cond', 'fraction'],
                types.flatMap((t, ti) => d.samples.map((s, si) =>
                  [t.name, s.id, s.cond, d.prop[si][ti].toFixed(6)])),
              )}
            />
          </div>
          <div
            className="mt-3 grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))' }}
          >
            {types.map((t, ti) => <TypeFacet key={t.key} d={d} t={t} ti={ti} palKey={palKey} />)}
          </div>
          <Legend
            items={d.conds.map((c, i) => [pal(i, palKey), c])}
            note={d.samples.length > d.conds.length ? '· bar = mean · dots = individual samples' : undefined}
          />
        </Card>
      )}
    </>
  )
}

interface DrawRow { i: number; label: string; group: string | null; color: string }

/** Horizontal 100% stacked bars — one row per chosen combination, shared axis. */
function StackedRows({ rows, table, partNames, palKey, hasGroup, label }: {
  rows: DrawRow[]
  table: CompTable
  partNames: string[]
  palKey: PaletteKey
  hasGroup: boolean
  label: string
}) {
  const rowH = 24, gap = 7, PR = 16, PT = 6, AX = 26

  // Runs of consecutive rows sharing an outer level, so the group is written
  // once beside the block rather than repeated on every row.
  const blocks: { label: string; color: string; from: number; to: number }[] = []
  if (hasGroup) {
    for (let i = 0; i < rows.length; i++) {
      const last = blocks[blocks.length - 1]
      if (last && last.label === rows[i].group) last.to = i
      else blocks.push({ label: rows[i].group ?? '', color: rows[i].color, from: i, to: i })
    }
  }

  /**
   * The gutter is measured, not fixed.
   *
   * Row names used to be sample ids and 96px always held them. A cell type is
   * "Anteromedial cerebral pole", and at a fixed width it renders at a negative
   * x — on screen the browser draws it anyway, but the PNG export rasterizes
   * the viewBox, so the axis would simply be missing from the exported figure.
   */
  // Per-character widths deliberately generous: the cost of overestimating is
  // some white space, the cost of underestimating is a missing axis in the PNG.
  // 6.3 was measured on sample ids and came up 11 px short on
  // "Neuromesodermal progenitors" — wide glyphs, semibold, at 11.5px.
  const INNER_MAX = 22, GROUP_MAX = 24
  const longest = (rs: string[], max: number) =>
    rs.reduce((m, r) => Math.max(m, Math.min(r.length, max)), 0)
  const innerW = longest(rows.map(r => r.label), INNER_MAX) * 7.6 + 22
  const groupW = hasGroup
    ? Math.max(48, longest(blocks.map(b => b.label), GROUP_MAX) * 7.2 + 14)
    : 0
  // Floored at the width this figure has always used, so the default pairing
  // comes out pixel for pixel as it did before the axes became choosable.
  const PL = Math.min(420, Math.max(96, groupW + innerW))
  const W = PL + 648 + PR
  const H = PT + Math.max(1, rows.length) * (rowH + gap) + AX
  const X = (p: number) => PL + (W - PL - PR) * p

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
      <defs>
        {rows.map((_r, si) => (
          <clipPath key={si} id={`cRow${si}`}>
            <rect x={PL} y={PT + si * (rowH + gap)} width={W - PL - PR} height={rowH} rx={5} />
          </clipPath>
        ))}
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <g key={f}>
          <line className="axline" x1={X(f)} x2={X(f)} y1={PT} y2={H - AX + 2} opacity=".55" />
          <text className="axis" x={X(f)} y={H - 8} textAnchor="middle">{f * 100}%</text>
        </g>
      ))}
      {blocks.map(b => {
        const y0 = PT + b.from * (rowH + gap)
        const y1 = PT + b.to * (rowH + gap) + rowH
        return (
          <g key={`${b.label}|${b.from}`}>
            <text className="axis" x={4} y={(y0 + y1) / 2 + 4} textAnchor="start"
              style={{ fontSize: 11, fill: 'var(--ink-2)', fontWeight: 650 }}>
              {clip(b.label, GROUP_MAX)}
              <title>{b.label}</title>
            </text>
            <rect x={PL - 9} y={y0} width={4} height={y1 - y0} rx={2} fill={b.color}>
              <title>{b.label}</title>
            </rect>
          </g>
        )
      })}
      {rows.map((row, si) => {
        const y = PT + si * (rowH + gap)
        const r = table.rows[row.i]
        const off = row.i * table.nParts
        let acc = 0
        return (
          <g key={row.i}>
            <text className="axis" x={PL - 16} y={y + rowH / 2 + 4} textAnchor="end"
              style={{ fontSize: 11.5, fill: 'var(--ink)', fontWeight: 550 }}>
              {clip(row.label, INNER_MAX)}
              <title>{row.label} — {r.n.toLocaleString('en-US')} cells</title>
            </text>
            {!hasGroup && (
              <rect x={PL - 9} y={y + 3} width={4} height={rowH - 6} rx={2} fill={row.color}>
                <title>{row.label}</title>
              </rect>
            )}
            <g clipPath={`url(#cRow${si})`}>
              {partNames.map((pn, pi) => {
                const c = table.counts[off + pi]
                // Skipping the empty parts is what keeps a product axis drawable:
                // one sample holds a handful of the 133 clusters, not all of them.
                if (!c) return null
                const p = c / r.n
                const xa = X(acc), xb = X(acc + p)
                acc += p
                return (
                  <g key={pi}>
                    <rect x={xa} y={y} width={Math.max(0, xb - xa)} height={rowH} fill={pal(pi, palKey)}>
                      <title>{pn} — {(p * 100).toFixed(1)}% ({c.toLocaleString('en-US')} cells)</title>
                    </rect>
                    {/* A number only where it fits; a clipped "1%" is worse than none. */}
                    {xb - xa > 30 && (
                      <text x={(xa + xb) / 2} y={y + rowH / 2 + 3.5} textAnchor="middle"
                        style={{ fontSize: 10, fill: '#fff', fontWeight: 650 }}>
                        {(p * 100).toFixed(0)}%
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </g>
        )
      })}
    </svg>
  )
}

/** One cell type: a bar per group, its own y axis, samples drawn on top. */
function TypeFacet({ d, t, ti, palKey }: { d: Dataset; t: CellType; ti: number; palKey: PaletteKey }) {
  const W = 210, H = 152, PL = 42, PB = 36, PT = 16, PR = 8
  const per = d.conds.map(c =>
    d.samples.map((s, si) => (s.cond === c ? d.prop[si][ti] : null))
      .filter((v): v is number => v !== null))
  const step = niceStep(Math.max(maxOfAll(per), 1e-4) / 2)
  const maxV = step * 2
  const Y = (v: number) => PT + (H - PT - PB) * (1 - v / maxV)
  const bw = (W - PL - PR) / d.conds.length

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${t.name} proportion by group`}>
        <text className="axis" x={PL} y={11} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--ink)' }}>
          <tspan fill={pal(ti, palKey)}>■ </tspan>{t.name}
        </text>
        {[0, 1, 2].map(k => (
          <g key={k}>
            <line className="axline" x1={PL} x2={W - PR} y1={Y(step * k)} y2={Y(step * k)} opacity=".4" />
            <text className="axis" x={PL - 5} y={Y(step * k) + 3.5} textAnchor="end">{pctTxt(step * k)}</text>
          </g>
        ))}
        {per.map((vals, ci) => {
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length
          const cx = PL + bw * (ci + 0.5)
          const col = pal(ci, palKey)
          const w = Math.min(46, bw * 0.56)
          const lab = d.conds[ci]
          const rotate = lab.length * 5.4 > bw
          return (
            <g key={lab}>
              <rect x={cx - w / 2} y={Y(mean)} width={w} height={Math.max(0, H - PB - Y(mean))}
                fill={col} opacity=".78" rx={2}>
                <title>{t.name} · {lab} — {pctTxt(mean)}</title>
              </rect>
              {vals.length > 1 && (
                <>
                  <line x1={cx} x2={cx} y1={Y(minOf(vals))} y2={Y(maxOf(vals))}
                    stroke={col} strokeWidth={1.4} opacity=".85" />
                  {vals.map((v, k) => (
                    <circle key={k} cx={cx + (k - (vals.length - 1) / 2) * 4.6} cy={Y(v)} r={2.6}
                      fill="var(--surface)" stroke={col} strokeWidth={1.4} />
                  ))}
                </>
              )}
              {rotate ? (
                <text className="axis" transform={`rotate(-38 ${cx} ${H - PB + 12})`}
                  x={cx} y={H - PB + 12} textAnchor="end">{lab}</text>
              ) : (
                <text className="axis" x={cx} y={H - PB + 13} textAnchor="middle">{lab}</text>
              )}
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </figure>
  )
}
