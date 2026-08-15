import { useMemo, useState } from 'react'
import type { DERow } from '../types.ts'
import { useSetIndex, type LibraryState } from '../lib/genesets.ts'
import type { Species } from '../lib/species.ts'
import { oraIndexed, type ORAResult } from '../lib/ora.ts'
import GeneSetSources from './GeneSetSources.tsx'
import { maxOf, sci } from '../lib/chart.ts'
import {
  condLabel, combinedScore } from '../lib/stats.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { MARK_EDGE } from '../lib/figure-ink.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import { Card, Chips, Empty, Seg } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'

type Direction = 'both' | 'up' | 'down'

export default function Enrichment({
  rows, threshold, ctrl, cs, label, palKey, onPickGene,
  lib, species, sources, onSources,
}: {
  rows: DERow[]
  threshold: { padj: number; lfc: number }
  ctrl: string[]
  cs: string[]
  label: string
  palKey: PaletteKey
  onPickGene: (g: string) => void
  /** The MSigDB library, loading or loaded. */
  lib: LibraryState
  species: Species
  sources: string[]
  onSources: (next: string[]) => void
}) {
  const [dir, setDir] = useState<Direction>('both')
  const [top, setTop] = useState(15)
  const [minSize, setMinSize] = useState(10)
  const [maxSize, setMaxSize] = useState(500)
  const [rankBy, setRankBy] = useState<'padj' | 'count'>('padj')
  const [termId, setTermId] = useState('')

  const query = useMemo(() => rows
    .filter(r => r.padj < threshold.padj && Math.abs(r.lfc) >= threshold.lfc)
    .filter(r => dir === 'both' || (dir === 'up' ? r.lfc > 0 : r.lfc < 0))
    .map(r => r.gene), [rows, threshold, dir])

  // The background is the genes THIS contrast tested, not every gene in the
  // object: a gene that never got a p-value could never have been called
  // significant, so it was never in the population the list was drawn from.
  const tested = useMemo(() => rows.map(r => r.gene), [rows])
  const index = useSetIndex(lib.collections, tested)

  // oraIndexed, not runORA: the library is up to 20 454 sets and this re-runs
  // on every drag of a threshold slider. The fold against the background
  // happened once, above; what happens here is a walk over the query.
  const results = useMemo(() => {
    if (!index) return []
    const out = oraIndexed(query, index, { minSize, maxSize })
    return rankBy === 'count'
      ? [...out].sort((a, b) => b.count - a.count || a.padj - b.padj)
      : out
  }, [query, index, minSize, maxSize, rankBy])

  const shown = results.slice(0, top)
  const selected = results.find(r => r.id === termId)

  // Per-gene statistics for a selected term, ranked among every tested gene, so
  // that a set can be enriched while all its members sit low in the list and you
  // can see that rather than infer it.
  const ranked = useMemo(() => {
    const scored = rows
      .map(r => ({ gene: r.gene, comb: combinedScore(r.lfc, r.nlp) ?? 0, r }))
      .sort((a, b) => Math.abs(b.comb) - Math.abs(a.comb))
    return new Map(scored.map((x, i) => [x.gene, { ...x, rank: i + 1 }]))
  }, [rows])

  const saveCsv = () => downloadCsv(
    `enrichment_${slug(label)}_${dir}`,
    ['set', 'id', 'source', 'overlap', 'setSize', 'foldEnrichment', 'p', 'padj', 'genes'],
    results.map(r => [r.name, r.id, r.source, r.count, r.setSize,
      r.foldEnrichment.toFixed(3), r.pvalue.toExponential(4), r.padj.toExponential(4),
      r.overlap.join(' ')]))
  const dirLabel = dir === 'up' ? `higher in ${condLabel(cs)}` : dir === 'down' ? `higher in ${condLabel(ctrl)}` : 'changed in either direction'

  return (
    <Card
      eyebrow="Over-representation"
      title={`${results.length} enriched set${results.length === 1 ? '' : 's'}`}
      sub={index
        ? `Hypergeometric on ${query.length} genes ${dirLabel}, against an annotated `
          + `background of ${index.N.toLocaleString()} of the ${tested.length.toLocaleString()} `
          + `tested. BH across ${results.length.toLocaleString()} sets.`
        : 'Loading the gene sets…'}
    >
      <GeneSetSources lib={lib} species={species} sources={sources} onSources={onSources}
        index={index} background={tested} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="glabel">Direction</span>
        <Seg<Direction>
          value={dir} onChange={setDir}
          options={[
            { k: 'both', label: 'Both' },
            { k: 'up', label: `Up in ${condLabel(cs)}` },
            { k: 'down', label: `Up in ${condLabel(ctrl)}` },
          ]}
        />
        <div className="gsep h-6" />
        {/* User-selectable term count — the bulk studio shipped a hardcoded 15. */}
        <Chips label="Show" value={top} options={[10, 15, 20, 30]} onChange={setTop} />
        <div className="gsep h-6" />
        <label className="flex items-center gap-1.5">
          <span className="glabel">Rank by</span>
          <select className="sel" value={rankBy} aria-label="Rank terms by"
            onChange={e => setRankBy(e.target.value as 'padj' | 'count')}>
            <option value="padj">adjusted p</option>
            <option value="count">overlap size</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="glabel">Set size</span>
          <input className="inp w-16" type="number" min={1} value={minSize}
            aria-label="Minimum set size"
            onChange={e => setMinSize(Math.max(1, +e.target.value || 1))} />
          <span style={{ color: 'var(--ink-3)' }}>&ndash;</span>
          <input className="inp w-20" type="number" min={1} value={maxSize}
            aria-label="Maximum set size"
            onChange={e => setMaxSize(Math.max(1, +e.target.value || 1))} />
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <Empty title="No set is enriched in this list">
            {query.length === 0
              ? `No gene passes padj < ${threshold.padj} and |log2FC| >= ${threshold.lfc}, so there is nothing to test. Loosen the cutoffs above, or press Reset to return to the default for this test.`
              : `${query.length} genes tested and nothing reached significance. With a list this size that is a normal outcome, not an error.`}
          </Empty>
        </div>
      ) : (
        <>
          {/* Both buttons live in the Figure's own control slot. Floating a
              separate row behind it put the PNG button on top of the CSV one and
              silently swallowed the click. */}
          <Figure
            name={`enrichment_${label}`} className="mt-4"
            right={<CsvButton onClick={saveCsv} />}
          >
            <Bars results={shown} palKey={palKey} onPick={setTermId} selected={termId} />
          </Figure>
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
                  <tr key={r.id} className="cursor-pointer"
                    style={r.id === termId ? { background: 'var(--accent-soft)' } : undefined}
                    onClick={() => setTermId(r.id === termId ? '' : r.id)}>
                    <td>{r.name}<div className="mono tx-micro" style={{ color: 'var(--ink-3)' }}>{r.id}</div></td>
                    <td className="whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>{r.source}</td>
                    <td className="num whitespace-nowrap">{r.count} / {r.setSize}</td>
                    <td className="num">{r.foldEnrichment.toFixed(1)}×</td>
                    <td className="num mono tx-micro" style={{ color: 'var(--ink-3)' }}>{sci(r.pvalue)}</td>
                    <td className="num mono tx-micro">{sci(r.padj)}</td>
                    <td className="mono tx-micro italic" style={{ color: 'var(--ink-2)' }}>
                      {r.overlap.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mono mt-2.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
            Showing {shown.length} of {results.length} · fold = (k/n) ÷ (K/N) ·
            click a bar or a row for its member genes
          </p>
          {selected && (
            <TermDetail
              selected={selected} ranked={ranked} ctrl={condLabel(ctrl)} cs={condLabel(cs)}
              onClose={() => setTermId('')} onPickGene={onPickGene}
            />
          )}
        </>
      )}
    </Card>
  )
}

interface RankedGene { gene: string; comb: number; rank: number; r: DERow }

function TermDetail({ selected, ranked, ctrl, cs, onClose, onPickGene }: {
  selected: ORAResult
  ranked: Map<string, RankedGene>
  /** Already-joined labels: this card only names the sides. */
  ctrl: string
  cs: string
  onClose: () => void
  onPickGene: (g: string) => void
}) {
  const members = selected.overlap
    .map(g => ranked.get(g))
    .filter((x): x is RankedGene => !!x)
    .sort((a, b) => Math.abs(b.comb) - Math.abs(a.comb))
  return (
    <div className="mt-4 rounded-[--r-md] p-3.5" style={{ background: 'var(--sunk)' }}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="tx-body font-semibold">
          {selected.name}
          <span className="mono ml-2 tx-micro font-normal" style={{ color: 'var(--ink-3)' }}>
            {selected.id} &middot; {selected.source}
          </span>
        </h3>
        <span className="tx-small" style={{ color: 'var(--ink-2)' }}>
          {selected.count}/{selected.setSize} genes &middot; fold {selected.foldEnrichment.toFixed(1)}&times;
          {' '}&middot; padj {sci(selected.padj)}
          <button className="btn btn-quiet ml-2.5" onClick={onClose}>Close</button>
        </span>
      </div>
      <div className="scrollx" style={{ maxHeight: 320 }}>
        <table className="t">
          <thead>
            <tr><th>Gene</th><th>log&#8322;FC</th><th>Combined</th>
              <th>Rank of {ranked.size}</th><th>p adjusted</th><th>Direction</th></tr>
          </thead>
          <tbody>
            {members.map(({ gene, comb, rank, r }) => (
              <tr key={gene} className="cursor-pointer" title={`Open ${gene} in Gene expression`}
                onClick={() => onPickGene(gene)}>
                <td className="mono font-semibold italic">{gene}</td>
                <td className="num font-semibold" style={{ color: r.lfc > 0 ? 'var(--up)' : 'var(--down)' }}>
                  {r.lfc > 0 ? '+' : ''}{r.lfc.toFixed(2)}
                </td>
                <td className="num mono tx-micro">{comb.toFixed(1)}</td>
                <td className="num" style={{ color: 'var(--ink-2)' }}>{rank}</td>
                <td className="num mono tx-micro">{sci(r.padj)}</td>
                <td className="whitespace-nowrap">
                  {r.lfc > 0 ? `higher in ${condLabel(cs)}` : `higher in ${condLabel(ctrl)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        <b>Rank</b> is the position among all {ranked.size} genes tested for this contrast.
      </p>
    </div>
  )
}

function Bars({ results, palKey, onPick, selected }: {
  results: ORAResult[]; palKey: PaletteKey; onPick: (id: string) => void; selected: string
}) {
  const rowH = 26, gap = 5, PT = 8, PR = 60, AX = 44
  // Full set names, never truncated — the bulk studio clipped them and it was
  // the first thing reported. The label column sizes to the longest name.
  //
  // Both extents go through maxOf rather than a spread, for two reasons that are
  // easy to confuse. The one everyone names is the argument limit: `Math.max(...xs)`
  // throws past ~124 900 arguments on this machine, and the only thing standing
  // between this line and that number is `top`, a Chips constant declared eighty
  // lines up — a bound that lives nowhere near the code depending on it is a bound
  // waiting for someone to raise it. The one that would have bitten first is
  // narrower: a single NaN padj poisons a spread, `Math.max(NaN, 1.5)` is NaN, and
  // every x below becomes NaN, so the whole figure renders with no bars and no
  // axis and nothing says why. maxOf skips what it cannot compare and falls back,
  // so one bad row costs one bar. See chart.ts.
  const PL = Math.min(430, Math.max(180, maxOf(results.map(r => r.name.length * 6.2))))
  const W = 900
  const H = PT + results.length * (rowH + gap) + AX
  const maxV = Math.max(1.5, maxOf(results.map(r => -Math.log10(Math.max(r.padj, 1e-300))))) * 1.05
  const X = (v: number) => PL + ((W - PL - PR) * v) / maxV
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => maxV * f)

  return (
    <div className="mt-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img"
        aria-label="Enriched gene sets">
        {ticks.map(t => (
          <g key={t}>
            <line className="axgrid" x1={X(t)} x2={X(t)} y1={PT} y2={H - AX + 2} />
            <text className="axis" x={X(t)} y={H - AX + 16} textAnchor="middle">{t.toFixed(1)}</text>
          </g>
        ))}
        <line x1={X(-Math.log10(0.05))} x2={X(-Math.log10(0.05))} y1={PT} y2={H - AX + 2}
          stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".8" />
        {results.map((r, i) => {
          const y = PT + i * (rowH + gap)
          const v = -Math.log10(Math.max(r.padj, 1e-300))
          return (
            <g key={r.id} style={{ cursor: 'pointer' }}
              onClick={() => onPick(r.id === selected ? '' : r.id)}>
              <text className="axis" x={PL - 10} y={y + rowH / 2 + 4} textAnchor="end"
                style={{ fontSize: 11.5, fill: 'var(--ink)',
                         fontWeight: r.id === selected ? 700 : 400 }}>{r.name}</text>
              <rect x={PL} y={y + 3} width={Math.max(1, X(v) - PL)} height={rowH - 6} rx={3}
                stroke={MARK_EDGE} strokeWidth={0.4}
                fill={pal(i, palKey)} opacity={r.id === selected ? 1 : 0.85}>
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
