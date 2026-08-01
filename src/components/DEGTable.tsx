import { useMemo, useState } from 'react'
import type { DERow } from '../types.ts'
import { combinedScore } from '../lib/stats.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { fmt, sci } from '../lib/chart.ts'
import { CsvButton } from './Figure.tsx'

type SortKey = 'gene' | 'mean' | 'pct1' | 'pct2' | 'lfc' | 'combined' | 'p' | 'padj'

/** Rows past a first render; anything more and the browser, not the science, is the limit. */
const MAX_ROWS = 500

const cellVal = (r: DERow, k: SortKey): number | string | null => {
  switch (k) {
    case 'gene': return r.gene
    case 'combined': return combinedScore(r.lfc, r.p)
    case 'mean': return r.mean ?? null
    case 'pct1': return r.pct1 ?? null
    case 'pct2': return r.pct2 ?? null
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
  const [sort, setSort] = useState<SortKey>('padj')
  const [asc, setAsc] = useState(true)

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

  const save = () => downloadCsv(
    `deg_${slug(label)}${sigOnly ? '_sig' : ''}`,
    ['gene', ...(wilcox ? ['pct.1', 'pct.2'] : ['baseMean']), 'log2FC', 'combined', 'p', 'padj', 'direction'],
    view.map(r => [
      r.gene,
      ...(wilcox ? [r.pct1?.toFixed(4), r.pct2?.toFixed(4)] : [r.mean?.toFixed(2)]),
      r.lfc.toFixed(4),
      combinedScore(r.lfc, r.p)?.toFixed(3),
      r.p.toExponential(4),
      r.padj.toExponential(4),
      r.lfc > 0 ? `higher in ${cs}` : `higher in ${ctrl}`,
    ]))

  const cols: [SortKey, string, boolean][] = [
    ['gene', 'Gene', false],
    ...(wilcox
      ? ([['pct1', 'pct.1', true], ['pct2', 'pct.2', true]] as [SortKey, string, boolean][])
      : ([['mean', 'Base mean', true]] as [SortKey, string, boolean][])),
    ['lfc', 'log₂FC', true],
    ['combined', 'Combined', true],
    ['p', 'p', true],
    ['padj', 'p adjusted', true],
  ]

  return (
    <>
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <input
          className="inp w-56" placeholder="Filter genes…" value={q} aria-label="Filter genes"
          onChange={e => setQ(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
          <input type="checkbox" checked={sigOnly} onChange={e => setSigOnly(e.target.checked)} />
          significant only (padj &lt; {padjMax}, |log₂FC| ≥ {lfcMin})
        </label>
        <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
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
            {view.slice(0, MAX_ROWS).map(r => (
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
                <td className="num font-semibold" style={{ color: r.lfc > 0 ? 'var(--bad)' : 'var(--lo)' }}>
                  {r.lfc > 0 ? '+' : ''}{r.lfc.toFixed(2)}
                </td>
                <td className="num mono text-[11.5px]">{combinedScore(r.lfc, r.p)?.toFixed(1) ?? '—'}</td>
                <td className="num mono text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{sci(r.p)}</td>
                <td className="num mono text-[11.5px]">{sci(r.padj)}</td>
                <td className="whitespace-nowrap">{r.lfc > 0 ? `higher in ${cs}` : `higher in ${ctrl}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.length > MAX_ROWS && (
        <p className="mt-2 text-center text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          Showing the first {MAX_ROWS} of {fmt(view.length)} — narrow the filter, or download the
          full list, which is never truncated.
        </p>
      )}
      <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        <b>Combined</b> = −log₁₀(p) × log₂FC, a signed ranking metric: large positive is strongly up
        and significant, large negative strongly down. Click a header to sort, again to reverse.
        Click any row to open that gene in <b>Gene expression</b>.
      </p>
    </>
  )
}
