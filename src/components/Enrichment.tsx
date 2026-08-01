import { useMemo, useState } from 'react'
import type { DERow } from '../types.ts'
import { GENE_SETS, SET_SOURCES } from '../lib/genesets.ts'
import { runORA, type ORAResult } from '../lib/ora.ts'
import { GENES } from '../lib/demo.ts'
import { sci } from '../lib/chart.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import { Card, Chips, Empty, Seg } from './Ui.tsx'

type Direction = 'both' | 'up' | 'down'

export default function Enrichment({ rows, threshold, ctrl, cs, palKey }: {
  rows: DERow[]
  threshold: { padj: number; lfc: number }
  ctrl: string
  cs: string
  palKey: PaletteKey
}) {
  const [dir, setDir] = useState<Direction>('both')
  const [top, setTop] = useState(15)
  const [sources, setSources] = useState<Set<string>>(new Set(SET_SOURCES))

  const query = useMemo(() => rows
    .filter(r => r.padj < threshold.padj && Math.abs(r.lfc) >= threshold.lfc)
    .filter(r => dir === 'both' || (dir === 'up' ? r.lfc > 0 : r.lfc < 0))
    .map(r => r.gene), [rows, threshold, dir])

  const results = useMemo(
    () => runORA(query, GENE_SETS, GENES, { minSize: 3, maxSize: 500, sources }),
    [query, sources])

  const shown = results.slice(0, top)
  const dirLabel = dir === 'up' ? `higher in ${cs}` : dir === 'down' ? `higher in ${ctrl}` : 'changed in either direction'

  return (
    <Card
      eyebrow="Over-representation"
      title={`${results.length} enriched set${results.length === 1 ? '' : 's'}`}
      sub={<>Hypergeometric test on the {query.length} genes {dirLabel}, against the{' '}
        {GENES.length} genes this object measured — never the whole genome, because testing
        against genes the assay could not detect inflates every enrichment.
        Benjamini–Hochberg across the {results.length} sets tested.</>}
    >
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <span className="glabel">Direction</span>
        <Seg<Direction>
          value={dir} onChange={setDir}
          options={[
            { k: 'both', label: 'Both' },
            { k: 'up', label: `Up in ${cs}` },
            { k: 'down', label: `Up in ${ctrl}` },
          ]}
        />
        <div className="gsep h-6" />
        {/* User-selectable term count — the bulk studio shipped a hardcoded 15. */}
        <Chips label="Show" value={top} options={[10, 15, 20, 30]} onChange={setTop} />
        <div className="gsep h-6" />
        <span className="glabel">Collections</span>
        {SET_SOURCES.map(s => (
          <button
            key={s} className="chip" aria-pressed={sources.has(s)}
            onClick={() => setSources(prev => {
              const next = new Set(prev)
              if (next.has(s) && next.size > 1) next.delete(s)
              else next.add(s)
              return next
            })}
          >{s}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <Empty title="No set is enriched in this list">
            {query.length === 0
              ? 'No gene passes the cutoffs for this contrast, so there is nothing to test.'
              : `${query.length} genes tested and nothing reached significance. With a list this size that is a normal outcome, not an error.`}
          </Empty>
        </div>
      ) : (
        <>
          <Bars results={shown} palKey={palKey} />
          <div className="scrollx mt-4" style={{ maxHeight: 420 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Set</th><th>Source</th><th>Overlap</th><th>Fold</th>
                  <th>p</th><th>p adjusted</th><th>Genes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td>{r.name}<div className="mono text-[10.5px]" style={{ color: 'var(--ink-3)' }}>{r.id}</div></td>
                    <td className="whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>{r.source}</td>
                    <td className="num whitespace-nowrap">{r.count} / {r.setSize}</td>
                    <td className="num">{r.foldEnrichment.toFixed(1)}×</td>
                    <td className="num mono text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{sci(r.pvalue)}</td>
                    <td className="num mono text-[11.5px]">{sci(r.padj)}</td>
                    <td className="mono text-[11.5px] italic" style={{ color: 'var(--ink-2)' }}>
                      {r.overlap.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mono mt-2.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Showing {shown.length} of {results.length} · fold = (k/n) ÷ (K/N)
          </p>
        </>
      )}
    </Card>
  )
}

function Bars({ results, palKey }: { results: ORAResult[]; palKey: PaletteKey }) {
  const rowH = 26, gap = 5, PT = 8, PR = 60, AX = 44
  // Full set names, never truncated — the bulk studio clipped them and it was
  // the first thing reported. The label column sizes to the longest name.
  const PL = Math.min(430, Math.max(180, ...results.map(r => r.name.length * 6.2)))
  const W = 900
  const H = PT + results.length * (rowH + gap) + AX
  const maxV = Math.max(...results.map(r => -Math.log10(Math.max(r.padj, 1e-300))), 1.5) * 1.05
  const X = (v: number) => PL + ((W - PL - PR) * v) / maxV
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => maxV * f)

  return (
    <div className="mt-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img"
        aria-label="Enriched gene sets">
        {ticks.map(t => (
          <g key={t}>
            <line className="axline" x1={X(t)} x2={X(t)} y1={PT} y2={H - AX + 2} opacity=".5" />
            <text className="axis" x={X(t)} y={H - AX + 16} textAnchor="middle">{t.toFixed(1)}</text>
          </g>
        ))}
        <line x1={X(-Math.log10(0.05))} x2={X(-Math.log10(0.05))} y1={PT} y2={H - AX + 2}
          stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".8" />
        {results.map((r, i) => {
          const y = PT + i * (rowH + gap)
          const v = -Math.log10(Math.max(r.padj, 1e-300))
          return (
            <g key={r.id}>
              <text className="axis" x={PL - 10} y={y + rowH / 2 + 4} textAnchor="end"
                style={{ fontSize: 11.5, fill: 'var(--ink)' }}>{r.name}</text>
              <rect x={PL} y={y + 3} width={Math.max(1, X(v) - PL)} height={rowH - 6} rx={3}
                fill={pal(i, palKey)} opacity=".85">
                <title>{r.name} — {r.count}/{r.setSize} genes, adjusted p {r.padj.toExponential(1)}</title>
              </rect>
              <text className="axis" x={X(v) + 7} y={y + rowH / 2 + 4}
                style={{ fontSize: 11 }}>{r.count}/{r.setSize}</text>
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - AX + 2} y2={H - AX + 2} />
        <text className="axis" x={(PL + W - PR) / 2} y={H - 6} textAnchor="middle">
          −log₁₀ adjusted p · dashed line = 0.05
        </text>
      </svg>
    </div>
  )
}
