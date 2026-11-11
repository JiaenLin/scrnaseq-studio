import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { DERow } from '../types.ts'
import {
  combinedScore, condLabel, isSig, type SigBasis } from '../lib/stats.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { fmt } from '../lib/chart.ts'
import { nlpCsv, nlpTxt, pCsv, pTxt } from '../lib/significance.ts'
import { CsvButton } from './Figure.tsx'
import { InHead } from './Stage.tsx'

type SortKey = 'gene' | 'mean' | 'pct1' | 'pct2' | 'lfc' | 'combined' | 'p' | 'padj' | 'fdr' | 'nlp'

/** Rows past a first render; anything more and the browser, not the science, is the limit. */
/**
 * How many rows are put in the DOM at once, and how many more a press adds.
 *
 * It was a hard cap: a contrast with three thousand significant genes could be
 * read to row 500 and no further, and since sorting changes WHICH 500 those
 * are, the cap behaved like a filter the reader had not asked for. It is a page
 * size now. The DOM still stays bounded — thirty thousand <tr> elements is a
 * tab that stops responding, which is what the cap was really protecting
 * against — but the rest of the table is one press away instead of unreachable.
 */
const PAGE = 500

/** A number the row does not have. See `cellVal`. */
const no = (x: number | null | undefined) =>
  (x === null || x === undefined || !Number.isFinite(x) ? null : x)

/**
 * A p-value cell, or an em dash where the gene has no p.
 *
 * Deliberately not "1" or "n.s.": an untested gene is not a gene the test
 * failed to call, and a table that prints a number there is telling the reader
 * something nobody measured.
 */
const num = (x: number | null | undefined, fmt1: (v: number) => string) =>
  (x === null || x === undefined || !Number.isFinite(x)
    ? <span title="Not tested — under the effect-size gate below.">—</span>
    : fmt1(x))

const cellVal = (r: DERow, k: SortKey): number | string | null => {
  switch (k) {
    case 'gene': return r.gene
    case 'combined': return no(combinedScore(r.lfc, r.nlp))
    case 'mean': return r.mean ?? null
    case 'pct1': return r.pct1 ?? null
    case 'pct2': return r.pct2 ?? null
    case 'nlp': return no(r.nlp)
    // Ascending −nlp is ascending p, and ascending adjusted p, exactly — they
    // are the same monotone function of the same z. The difference is that it
    // still separates the rows whose p has underflowed to one shared floor,
    // which on this object is most of the ones anybody looks at. Sorting on the
    // columns themselves gives the right answer today only because the rows
    // arrive ranked and Array#sort is stable, and that is a fact about two
    // other files.
    // r.p and r.padj, not -r.nlp. The proxy was chosen because ascending
    // -nlp is ascending p — which is true only ABOVE the clamp: finish() pins
    // nlp to 0 for every row with padj >= 1, so the key went flat over that
    // block and the sort fell through to arrival order, which is |log2FC|
    // descending. A reader sorting to find the WEAKEST hits was handed the
    // smallest fold changes instead. nlp stays as the tiebreak, where it does
    // separate rows whose p has bottomed out at the double's floor.
    // NaN rather than a number on every one of these, for a gene the
    // effect-size gate left untested: it has a fold change and detection rates
    // and no p at all. Returned as null so the comparator below parks it at the
    // end of every sort instead of wherever NaN happens to fall — a sort on p
    // must not interleave rows that have one with rows that do not.
    case 'p': return no(r.p)
    case 'padj': return no(r.padj)
    case 'fdr': return r.fdr === undefined ? 1 : no(r.fdr)
    default: return r[k]
  }
}

export default function DEGTable({
  rows, wilcox, nGenes, ctrl, cs, label, padjMax, lfcMin, sigBasis, onPickGene,
}: {
  rows: DERow[]
  wilcox: boolean
  /** Genes the object measures, so the table can say how many were tested. */
  nGenes: number
  ctrl: string
  cs: string
  label: string
  padjMax: number
  lfcMin: number
  /** Which correction "significant" is read off. */
  sigBasis: SigBasis
  onPickGene: (g: string) => void
}) {
  const [q, setQ] = useState('')
  // Tested, as against listed. Since the effect-size gate started keeping the
  // genes it skips rather than dropping them, `rows.length` is what the object
  // measures above min.pct and this is what the rank sum actually ran on — the
  // Bonferroni denominator's sibling, and what the footer means by "tested".
  const nRan = useMemo(() => rows.reduce((n, r) => n + (Number.isFinite(r.p) ? 1 : 0), 0), [rows])
  const [sigOnly, setSigOnly] = useState(false)
  // Descending −log₁₀ padj, which is the same order ascending padj gave — the
  // same monotone function of the same z — but the arrow now sits over the
  // column that is actually deciding the order rather than over one whose top
  // rows are all the same number.
  const [sort, setSort] = useState<SortKey>('nlp')
  const [asc, setAsc] = useState(false)

  const [limit, setLimit] = useState(PAGE)
  // Back to one page whenever the rows underneath change. Without this, a
  // reader who pressed "show all" on one contrast would silently be rendering
  // every row of the next one — including on an object where that is 31 053.
  useEffect(() => { setLimit(PAGE) }, [rows, q, sigOnly])
  const view = useMemo(() => {
    const query = q.trim().toUpperCase()
    let out = rows
    if (query) out = out.filter(r => r.gene.toUpperCase().includes(query))
    if (sigOnly) out = out.filter(r => isSig(r, { padj: padjMax, lfc: lfcMin, basis: sigBasis }))
    const dir = asc ? 1 : -1
    return [...out].sort((a, b) => {
      const av = cellVal(a, sort), bv = cellVal(b, sort)
      // Last either way, rather than dir * something: ascending p is "weakest
      // first", and an untested gene is not the weakest, it is unmeasured.
      if (av === null) return bv === null ? 0 : 1
      if (bv === null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      return dir * ((av as number) - (bv as number))
    })
  }, [rows, q, sigOnly, sort, asc, padjMax, lfcMin, sigBasis])

  /**
   * The rows by keyboard. The pane is one tab stop: arrows, Page Up and Down,
   * Home and End move a cursor through the rows and scroll with it, Enter
   * opens the gene. It was a scroll region that could not take focus at all,
   * so a keyboard could neither scroll the answer nor open a row of it.
   */
  const pane = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(-1)
  useEffect(() => { setCur(-1) }, [q, sigOnly, sort, asc, rows])
  const shownN = Math.min(limit, view.length)
  const onRowKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !shownN) return
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1
      : e.key === 'PageDown' ? 10 : e.key === 'PageUp' ? -10 : 0
    let next: number
    if (step) next = Math.max(0, Math.min(shownN - 1, cur < 0 ? 0 : cur + step))
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = shownN - 1
    else if (e.key === 'Enter' && cur >= 0 && view[cur]) { e.preventDefault(); onPickGene(view[cur].gene); return }
    else return
    e.preventDefault()
    setCur(next)
    pane.current?.querySelector(`tbody tr:nth-child(${next + 1})`)?.scrollIntoView({ block: 'nearest' })
  }

  const clickSort = (k: SortKey) => {
    if (k === sort) setAsc(!asc)
    // Ascending is the useful default for p-values and names, descending for effects.
    else { setSort(k); setAsc(k === 'gene' || k === 'p' || k === 'padj') }
  }

  // The CSV carries the same two columns under the same two rules as the table.
  // Exporting the floored constant while the screen showed resolution would
  // hand the one reader most likely to fit something to it the one number that
  // is not a measurement.
  const save = () => downloadCsv(
    `deg_${slug(label)}${sigOnly ? '_sig' : ''}`,
    ['gene', ...(wilcox ? ['pct.1', 'pct.2'] : ['baseMean']), 'log2FC', 'combined',
      'p', 'padj', 'fdr_BH', 'neg_log10_padj', 'direction'],
    view.map(r => [
      r.gene,
      ...(wilcox ? [r.pct1?.toFixed(4), r.pct2?.toFixed(4)] : [r.mean?.toFixed(2)]),
      r.lfc.toFixed(4),
      combinedScore(r.lfc, r.nlp)?.toFixed(3),
      pCsv(r.p),
      pCsv(r.padj),
      r.fdr === undefined ? '' : pCsv(r.fdr),
      nlpCsv(r.nlp),
      r.lfc > 0 ? `higher in ${condLabel(cs)}` : `higher in ${condLabel(ctrl)}`,
    ]))

  const cols: [SortKey, string, boolean][] = [
    ['gene', 'Gene', false],
    ...(wilcox
      ? ([['pct1', 'pct.1', true], ['pct2', 'pct.2', true]] as [SortKey, string, boolean][])
      : ([['mean', 'Base mean', true]] as [SortKey, string, boolean][])),
    ['lfc', 'log₂FC', true],
    ['combined', 'Combined', true],
    ['p', 'p', true],
    // Both adjustments, named by their method rather than both called
    // "adjusted". Seurat reports Bonferroni as p_val_adj and people reach for
    // the FDR as well; showing one and calling it "p adjusted" left the reader
    // to guess which of the two they were reading.
    ['padj', 'padj · Bonferroni', true],
    ['fdr', 'FDR · BH', true],
    ['nlp', '−log₁₀ padj', true],
  ]

  return (
    <>
      {/* One 24 px row directly over the table: find, narrow, how many. The
          CSV is an action on the table, so it is at the head line's right end. */}
      <div className="ttools">
        <input
          className="inp inp-sm w-56" placeholder="Filter genes…" value={q} aria-label="Filter genes"
          onChange={e => setQ(e.target.value)}
        />
        {/* A chip like every other boolean in the studio. This was the app's
            only raw checkbox, which made one toggle look unlike the forty
            others that do the same thing. */}
        <button className="chip" aria-pressed={sigOnly} onClick={() => setSigOnly(!sigOnly)}
          title={`padj < ${padjMax}, |log₂FC| ≥ ${lfcMin}`}>
          Significant only
        </button>
        <span className="num tx-small" style={{ color: 'var(--ink-2)' }}>
          {view.length.toLocaleString()} gene{view.length === 1 ? '' : 's'}
        </span>
        <InHead><CsvButton onClick={save} /></InHead>
      </div>

      {/* To the stage's bottom edge, the head sticky: the rows are the answer. */}
      <div ref={pane} className="tpane-body edge rows-kbd" tabIndex={0} role="region"
        aria-label="Results. Arrow keys move through the rows, Enter opens the gene."
        onKeyDown={onRowKey}>
        <table className="t">
          <thead>
            <tr>
              {cols.map(([k, lab, num]) => (
                // A header sorts, so it is a button: reachable and pressable by key.
                <th key={k} className={num ? 'num' : undefined}
                  aria-sort={sort === k ? (asc ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="th-sort" onClick={() => clickSort(k)}>
                    {lab}{sort === k ? (asc ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {view.slice(0, limit).map((r, ri) => (
              <tr
                key={r.gene} className="cursor-pointer" title={`Open ${r.gene} in Gene expression`}
                data-cur={ri === cur ? '' : undefined} aria-current={ri === cur ? 'true' : undefined}
                onClick={() => onPickGene(r.gene)}
              >
                <td className="mono font-semibold italic">{r.gene}</td>
                {wilcox ? (
                  <>
                    <td className="num" style={{ color: 'var(--ink-2)' }}>{r.pct1?.toFixed(2)}</td>
                    <td className="num" style={{ color: 'var(--ink-2)' }}>{r.pct2?.toFixed(2)}</td>
                  </>
                ) : (
                  <td className="num" style={{ color: 'var(--ink-2)' }}>{r.mean?.toFixed(0)}</td>
                )}
                <td className="num font-semibold" style={{ color: r.lfc > 0 ? 'var(--up)' : 'var(--down)' }}>
                  {r.lfc > 0 ? '+' : ''}{r.lfc.toFixed(2)}
                </td>
                <td className="num">{num(combinedScore(r.lfc, r.nlp), v => v.toFixed(1))}</td>
                <td className="num" style={{ color: 'var(--ink-3)' }}>{num(r.p, pTxt)}</td>
                <td className="num" style={{ color: 'var(--ink-3)' }}>{num(r.padj, pTxt)}</td>
                <td className="num" style={{ color: 'var(--ink-3)' }}>
                  {num(r.fdr, pTxt)}
                </td>
                <td className="num">{num(r.nlp, nlpTxt)}</td>
                <td className="whitespace-nowrap">{r.lfc > 0 ? `higher in ${condLabel(cs)}` : `higher in ${condLabel(ctrl)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>

      {/* The underflow and Combined arguments are in Methods, under "How to
          read these numbers". They were 106 words under a table the reader had
          already sorted and read. What is left is the one thing the table
          itself does not show: that a row is clickable, and that the CSV is
          not truncated. */}
      {view.length > limit && (
        <div className="tmore">
          <button className="btn btn-quiet" onClick={() => setLimit(l => l + PAGE)}>
            Show {Math.min(PAGE, view.length - limit).toLocaleString()} more
          </button>
          <button className="btn btn-quiet" onClick={() => setLimit(view.length)}>
            Show all {fmt(view.length)}
          </button>
        </div>
      )}
      {wilcox && nGenes > nRan && (
        <p className="tnote">
          <b>{fmt(nRan)} of {fmt(nGenes)} genes were tested.</b> Seurat's own gates run
          before the rank sum. A gene detected in under 10% of the cells on both sides
          (<span className="mono">min.pct</span>) is dropped: with almost no cells
          expressing it on either side there is nothing to compare.{' '}
          {rows.length > nRan ? (
            <>
              A gene changing by less than the effect-size gate
              (<span className="mono">logfc.threshold</span>) is <b>kept but not tested</b> —
              the {fmt(rows.length - nRan)} rows showing “—” are those. Their fold change
              and detection rates are real and were computed either way; only the rank sum,
              which is the slow half, was skipped. Lower the gate under{' '}
              <i>What gets tested</i> to give them p-values too.
            </>
          ) : (
            <>The effect-size gate (<span className="mono">logfc.threshold</span>) is at 0,
              so every gene that cleared <span className="mono">min.pct</span> was tested.</>
          )}
        </p>
      )}
      </div>

      <footer className="stage-foot">
        <span className="truncate">
          {view.length > limit
            && <>Showing {fmt(limit)} of {fmt(view.length)}; the CSV has every row. </>}
          Click a row, or press Enter on it, to open that gene; a header sorts.
        </span>
      </footer>
    </>
  )
}
