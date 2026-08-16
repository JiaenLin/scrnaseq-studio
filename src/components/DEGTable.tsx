import { useEffect, useMemo, useState } from 'react'
import type { DERow } from '../types.ts'
import {
  condLabel, combinedScore } from '../lib/stats.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { fmt } from '../lib/chart.ts'
import { nlpCsv, nlpTxt, pCsv, pTxt } from '../lib/significance.ts'
import { CsvButton } from './Figure.tsx'

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

const cellVal = (r: DERow, k: SortKey): number | string | null => {
  switch (k) {
    case 'gene': return r.gene
    case 'combined': return combinedScore(r.lfc, r.nlp)
    case 'mean': return r.mean ?? null
    case 'pct1': return r.pct1 ?? null
    case 'pct2': return r.pct2 ?? null
    case 'nlp': return r.nlp
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
    case 'p': return r.p
    case 'padj': return r.padj
    case 'fdr': return r.fdr ?? 1
    default: return r[k]
  }
}

export default function DEGTable({ rows, wilcox, ctrl, cs, label, padjMax, lfcMin, onPickGene }: {
  rows: DERow[]
  wilcox: boolean
  ctrl: string
  cs: string
  label: string
  padjMax: number
  lfcMin: number
  onPickGene: (g: string) => void
}) {
  const [q, setQ] = useState('')
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
    if (sigOnly) out = out.filter(r => r.padj < padjMax && Math.abs(r.lfc) >= lfcMin)
    const dir = asc ? 1 : -1
    return [...out].sort((a, b) => {
      const av = cellVal(a, sort), bv = cellVal(b, sort)
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      return dir * ((av as number) - (bv as number))
    })
  }, [rows, q, sigOnly, sort, asc, padjMax, lfcMin])

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
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <input
          className="inp w-56" placeholder="Filter genes…" value={q} aria-label="Filter genes"
          onChange={e => setQ(e.target.value)}
        />
        {/* A chip like every other boolean in the studio. This was the app's
            only raw checkbox, which made one toggle look unlike the forty
            others that do the same thing. */}
        <button className="chip" aria-pressed={sigOnly} onClick={() => setSigOnly(!sigOnly)}
          title={`padj < ${padjMax}, |log₂FC| ≥ ${lfcMin}`}>
          Significant only
        </button>
        <span className="tx-small" style={{ color: 'var(--ink-3)' }}>
          {view.length.toLocaleString()} gene{view.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto"><CsvButton onClick={save} /></div>
      </div>

      <div className="scrollx mt-3" style={{ maxHeight: 520 }}>
        <table className="t">
          <thead>
            <tr>
              {cols.map(([k, lab, num]) => (
                <th
                  key={k} className={`cursor-pointer select-none ${num ? 'text-right' : ''}`}
                  aria-sort={sort === k ? (asc ? 'ascending' : 'descending') : 'none'}
                  onClick={() => clickSort(k)}
                >{lab}{sort === k ? (asc ? ' ▲' : ' ▼') : ''}</th>
              ))}
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {view.slice(0, limit).map(r => (
              <tr
                key={r.gene} className="cursor-pointer" title={`Open ${r.gene} in Gene expression`}
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
                <td className="num mono tx-micro">{combinedScore(r.lfc, r.nlp)?.toFixed(1) ?? '—'}</td>
                <td className="num mono tx-micro" style={{ color: 'var(--ink-3)' }}>{pTxt(r.p)}</td>
                <td className="num mono tx-micro" style={{ color: 'var(--ink-3)' }}>{pTxt(r.padj)}</td>
                <td className="num mono tx-micro" style={{ color: 'var(--ink-3)' }}>
                  {r.fdr === undefined ? '—' : pTxt(r.fdr)}
                </td>
                <td className="num mono tx-micro font-semibold">{nlpTxt(r.nlp)}</td>
                <td className="whitespace-nowrap">{r.lfc > 0 ? `higher in ${condLabel(cs)}` : `higher in ${condLabel(ctrl)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The underflow and Combined arguments are in Methods, under "How to
          read these numbers". They were 106 words under a table the reader had
          already sorted and read. What is left is the one thing the table
          itself does not show: that a row is clickable, and that the CSV is
          not truncated. */}
      {view.length > limit && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <button className="btn btn-quiet" onClick={() => setLimit(l => l + PAGE)}>
            Show {Math.min(PAGE, view.length - limit).toLocaleString()} more
          </button>
          <button className="btn btn-quiet" onClick={() => setLimit(view.length)}>
            Show all {fmt(view.length)}
          </button>
        </div>
      )}

      <p className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        {view.length > limit
          && <>Showing {fmt(limit)} of {fmt(view.length)}; the CSV has every row. </>}
        Click a row to open that gene, a header to sort.
      </p>
    </>
  )
}
