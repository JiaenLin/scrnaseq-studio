import { useMemo, useState } from 'react'
import type { DERow } from '../types.ts'
import { useSetIndex, type LibraryState } from '../lib/genesets.ts'
import { wrapAll } from '../lib/labels.ts'

/**
 * What a bar's length means.
 *
 * clusterProfiler draws Count on its barplot and GeneRatio on its dotplot, and
 * the difference matters: a raw count rewards big sets, so "Ribosome" at 63/84
 * outdraws a 5-gene pathway matched 5/5 even though the second is the stronger
 * statement about this list. Gene ratio is the default here for that reason.
 */
type BarMetric = 'count' | 'ratio' | 'fold'
import type { Collection } from '../lib/msigdb.ts'
import type { Detection, Species } from '../lib/species.ts'
import { oraIndexed, type ORAResult } from '../lib/ora.ts'
import GeneSetSources from './GeneSetSources.tsx'
import { maxOf, sci, minOf } from '../lib/chart.ts'
import {
  condLabel, combinedScore } from '../lib/stats.ts'
import { downloadCsv, slug } from '../lib/download.ts'
import { MARK_EDGE } from '../lib/figure-ink.ts'
import { ColorBar } from './svg-parts.tsx'
import { rampColor, type RampKey } from '../lib/palette.ts'
import { Card, Chips, Empty, Seg } from './Ui.tsx'
import Figure, { CsvButton } from './Figure.tsx'

type Direction = 'both' | 'up' | 'down'

export default function Enrichment({
  rows, threshold, ctrl, cs, label, rampKey, onPickGene, background,
  lib, species, sources, onSources, customSets, onCustomSets, detected,
}: {
  rows: DERow[]
  /** Every gene the object measures — the population the list was drawn from. */
  background: string[]
  threshold: { padj: number; lfc: number }
  ctrl: string[]
  cs: string[]
  label: string
  rampKey: RampKey
  onPickGene: (g: string) => void
  /** The MSigDB library, loading or loaded. */
  lib: LibraryState
  species: Species
  sources: string[]
  onSources: (next: string[]) => void
  customSets: readonly Collection[]
  onCustomSets: (next: Collection[]) => void
  detected: Detection | null
}) {
  const [dir, setDir] = useState<Direction>('both')
  const [top, setTop] = useState(15)
  const [minSize, setMinSize] = useState(10)
  const [maxSize, setMaxSize] = useState(500)
  const [rankBy, setRankBy] = useState<'padj' | 'count'>('padj')
  const [metric, setMetric] = useState<BarMetric>('ratio')
  const [termId, setTermId] = useState('')

  const query = useMemo(() => rows
    .filter(r => r.padj < threshold.padj && Math.abs(r.lfc) >= threshold.lfc)
    .filter(r => dir === 'both' || (dir === 'up' ? r.lfc > 0 : r.lfc < 0))
    .map(r => r.gene), [rows, threshold, dir])

  /**
   * The background is every gene the object MEASURES.
   *
   * It was `rows.map(r => r.gene)` — the rows deWilcox returns — on the
   * reasoning that a gene which never got a p-value was never in the population
   * the list was drawn from. That reasoning is right and the mapping was wrong,
   * because deWilcox does not return every gene it tested: src/lib/stats.ts
   * drops a gene before the test whenever |log2FC| < 0.25, which is Seurat's
   * `logfc.threshold`, a speed pre-filter and not a claim that the gene was
   * unmeasured.
   *
   * So the background WAS the genes that had already passed an effect-size
   * gate, and the query was the significant subset of those. On a real contrast
   * that is 324 significant genes inside a background of 328, n/N = 0.99, every
   * set's k/n matches its K/N, every fold enrichment is 1.00 and every p is 1.
   * The user who reported "324 DEGs and no enrichment at all" was looking at
   * arithmetic, not biology. On the cohort demo it is starker still: twelve rows
   * returned, all twelve significant, n/N exactly 1.
   *
   * rnaseq-studio's equivalent is `bundle.degByContrast[...]`, which is the
   * whole DESeq2 table — every gene tested, unfiltered by effect size — so it
   * never had this problem, and mapping one onto the other is what introduced
   * it here.
   */
  const index = useSetIndex(lib.collections, background)

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

  /**
   * How many sets the size filters actually left to test.
   *
   * Without this the empty state could only count GENES, and said "{n} genes
   * tested and nothing reached significance — a normal outcome, not an error".
   * If minSize and maxSize excluded every set, or the collection never loaded,
   * then zero sets were tested and the sentence was reassuring the reader about
   * a configuration problem. The two numbers are also worth showing when there
   * ARE results: the default 10–500 window drops 255 of the 844 KEGG sets,
   * because the MEDICUS modules are small by design.
   */
  const inRange = useMemo(() => {
    if (!index) return { n: 0, of: 0 }
    let n = 0
    for (const st of index.sets) if (st.K >= minSize && st.K <= maxSize) n++
    return { n, of: index.sets.length }
  }, [index, minSize, maxSize])

  const shown = results.slice(0, top)
  const nSig = results.filter(r => r.padj < 0.05).length
  // `|| shown[0]`, like rnaseq-studio: with the table gone the detail card is
  // how a reader reads a result, and an empty panel under a bar chart is a
  // page that looks like it has not finished loading.
  const selected = results.find(r => r.id === termId) ?? shown[0]

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
      // "N enriched sets" counted every set with an overlap, significant or
      // not — on a demo that was 272 sets of which none cleared correction. The
      // headline is the number that survived; the number tested is the sentence
      // below it, where it belongs.
      title={`${nSig.toLocaleString()} enriched set${nSig === 1 ? '' : 's'}`}
      sub={index
        ? `Hypergeometric on ${query.length} genes ${dirLabel}, against an annotated `
          + `background of ${index.N.toLocaleString()} of the ${background.length.toLocaleString()} `
          + `this object measures. ${results.length.toLocaleString()} sets overlapped the list; `
          + `${nSig.toLocaleString()} reach padj < 0.05 after BH across all of them.`
        : 'Loading the gene sets…'}
    >
      <GeneSetSources lib={lib} species={species} sources={sources} onSources={onSources} customSets={customSets} onCustomSets={onCustomSets}
        index={index} background={background} detected={detected} />

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
          <span className="glabel">Bar shows</span>
          <select className="sel" value={metric} aria-label="What the bar length shows"
            onChange={e => setMetric(e.target.value as BarMetric)}>
            <option value="ratio">gene ratio</option>
            <option value="count">overlap count</option>
            <option value="fold">fold enrichment</option>
          </select>
        </label>
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
          <span className="tx-micro tabular-nums" style={{ color: 'var(--ink-3)' }}
            title="Sets whose overlap with this object's measured genes falls in the window">
            {inRange.n.toLocaleString()} of {inRange.of.toLocaleString()} sets
          </span>
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <Empty title="No set is enriched in this list">
            {query.length === 0
              ? `No gene passes padj < ${threshold.padj} and |log₂FC| ≥ ${threshold.lfc}, so there is nothing to test. Loosen the cutoffs above, or press Reset to return to the default for this test.`
              : inRange.of === 0
                ? 'No collection is loaded, so there was nothing to test against. Switch one on under Gene set collections above.'
                : inRange.n === 0
                  ? `${query.length} genes, but none of the ${inRange.of.toLocaleString()} sets `
                    + `fall between ${minSize} and ${maxSize} genes — so nothing was tested. `
                    + 'Widen the set size window above.'
                  : `${query.length} genes against ${inRange.n.toLocaleString()} sets, and nothing `
                    + 'reached significance. With a list this size that is a normal outcome, not an error.'}
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
            <Bars results={shown} rampKey={rampKey} onPick={setTermId} selected={termId}
              metric={metric} nQuery={query.length} />
          </Figure>
          {/**
            * No results table.
            *
            * There was one, with a Genes column holding every overlapping gene.
            * Across eighteen hand-written sets an overlap was three or four
            * symbols; against real MSigDB it is routinely a hundred, and one
            * cell of a hundred italic gene names sets the column width for the
            * whole table — Set, Source, Overlap, Fold, p and p adjusted all
            * collapsed to nothing while the genes wrapped into a wall.
            *
            * rnaseq-studio never had this table: the bar chart IS the results
            * view, and one term at a time gets a card with its members and
            * their statistics. That is the shape here now. Nothing is lost —
            * the CSV still carries every set, every column and every gene.
            */}
          <p className="mono mt-2.5 tx-micro" style={{ color: 'var(--ink-3)' }}>
            Showing {shown.length} of {results.length} · fold = (k/n) ÷ (K/N) ·
            click a bar for its member genes · the CSV has every set
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

/**
 * The results, as a bar per set.
 *
 * The encoding is rnaseq-studio's, and it was worth going and reading rather
 * than deciding again. That app draws bar length = the number of DEGs in the
 * set and colour = −log₁₀ adjusted p on a continuous scale. This one had it the
 * other way round: length was −log₁₀ padj and colour was `pal(i, palKey)` — the
 * ROW INDEX in a categorical palette, which carries no information whatsoever.
 *
 * Both halves of that were wrong, and together they made the figure fail
 * exactly where a reader needs it most. Turn on a small collection where
 * nothing clears correction and every padj sits near 1, so every −log₁₀ padj
 * sits near 0, so every bar collapses to the one-pixel minimum — fifteen
 * hairlines in fifteen unrelated colours, over an axis running to 1.6. Nothing
 * about that says "nothing is significant here"; it just looks broken.
 *
 * Length is the overlap count now, which is a real quantity whatever the
 * p-values do, and colour is the significance, on the studio's own ramp with a
 * colour bar to read it by.
 */
function Bars({ results, rampKey, onPick, selected, metric, nQuery }: {
  results: ORAResult[]; rampKey: RampKey; onPick: (id: string) => void; selected: string
  /** What the bar length means — see `value` below. */
  metric: BarMetric
  /** How many genes were tested, for the gene ratio. */
  nQuery: number
}) {
  const gap = 5, PT = 8, PR = 74, AX = 44, BAR_H = 74
  const CHAR = 6.2

  /**
   * Names are WRAPPED, not cut.
   *
   * rnaseq-studio wraps at 40 characters and keeps the whole term; the label
   * gutter here was capped instead, and because the labels are drawn
   * `textAnchor="end"` a name past the cap ran off the LEFT edge and lost its
   * opening words — the part that identifies a pathway. Two lines hold 76
   * characters, which covers MSigDB; anything longer loses its tail, marked,
   * with the whole name in the tooltip and in the CSV.
   */
  /**
   * The gutter, and the names wrapped into it — never cut to it.
   *
   * A pathway is identified by its whole name: "Reference electron transfer in
   * complex i" and "…in complex iv" differ in their last two characters, and
   * the old wrap ended its second line with an ellipsis whenever the name did
   * not fit in two. Two rows of this figure could therefore carry the same
   * visible label for different terms. It runs onto as many lines as it needs
   * now, and the row grows with it.
   */
  const PL = Math.min(320, Math.max(180, maxOf(results.map(r => r.name.length * CHAR))))
  const perLine = Math.max(12, Math.floor((PL - 10) / CHAR))
  const wrap = (name: string): string[] => wrapAll(name, perLine * CHAR, 11.5)
  const wrapped = results.map(r => wrap(r.name))
  const lines = Math.max(1, maxOf(wrapped.map(w => w.length)))
  // The row is as tall as the tallest label needs, rather than stepping once
  // from one line to two — a four-line term must not write over its neighbour.
  const rowH = lines > 1 ? 14 + 13 * lines : 26

  const W = 900
  const H = PT + results.length * (rowH + gap) + AX + BAR_H
  // The axis is the overlap count. maxOf rather than a spread: a single NaN
  // poisons `Math.max(...)` and takes the whole figure's geometry with it, and
  // the argument limit is a second reason. See chart.ts.
  /**
   * What the bar LENGTH means, following clusterProfiler.
   *
   * Its barplot puts Count on x and its dotplot puts GeneRatio — k/n, the share
   * of the query that landed in the set — and the two answer different
   * questions. A raw count rewards large sets: "Ribosome" overlapping 63 genes
   * out of 84 and a 5-gene pathway overlapping all 5 are drawn as a long bar
   * and a stub, when the second is the stronger statement about the list.
   * GeneRatio is what makes them comparable, and fold enrichment is the same
   * quantity against what the background would give by chance.
   */
  const value = (r: ORAResult) =>
    metric === 'ratio' ? r.count / Math.max(1, nQuery)
      : metric === 'fold' ? r.foldEnrichment
      : r.count
  const maxV = Math.max(metric === 'count' ? 1 : 1e-9, maxOf(results.map(value)))
  const X = (v: number) => PL + ((W - PL - PR) * v) / maxV
  const fmtV = (r: ORAResult) =>
    metric === 'ratio' ? `${r.count}/${nQuery}`
      : metric === 'fold' ? `${r.foldEnrichment.toFixed(1)}\u00d7`
      : `${r.count}/${r.setSize}`
  const axisLabel =
    metric === 'ratio' ? 'gene ratio — genes of this list that are in the set'
      : metric === 'fold' ? 'fold enrichment over the background'
      : 'genes of the set in this list'
  // r.nlpAdj, not -log10(padj). They agree everywhere padj is representable and
  // differ exactly where it is not: a set whose adjusted p is below 1e-308 has
  // padj === 0, and the clamp that used to stand in for it pinned every such
  // bar to the same 300 — the flat top the volcano used to have, for the same
  // reason and with the same fix.
  const nlp = (r: ORAResult) => r.nlpAdj
  /**
   * The colour scale spans the terms ON SCREEN, not every term tested.
   *
   * It ran 0 → the maximum over ALL results, so one term at −log₁₀ padj = 63
   * pushed everything below about 12 into the pale end and the figure came out
   * as two dark bars and thirteen white ones. Reported, and it is the scale's
   * fault rather than the data's: those thirteen span padj 1e-12 to 1e-2, which
   * is four orders of magnitude of real difference rendered as one colour.
   *
   * clusterProfiler's answer is the one taken here — its scale_colour_gradient
   * is fitted to the terms it draws, not to the whole result table. The floor
   * still includes the 0.05 line, so a page where nothing is significant stays
   * pale rather than stretching a full ramp across noise.
   */
  const shownNlp = results.map(nlp)
  const CUT = -Math.log10(0.05)
  const hi = Math.max(CUT * 1.2, maxOf(shownNlp))
  const lo = Math.min(CUT, minOf(shownNlp))
  const at = (r: ORAResult) => (hi > lo ? (nlp(r) - lo) / (hi - lo) : 1)
  const ticks = niceTicks(maxV)

  return (
    <div className="mt-4 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img"
        aria-label="Enriched gene sets">
        {ticks.map(t => (
          <g key={t}>
            <line className="axgrid" x1={X(t)} x2={X(t)} y1={PT} y2={H - AX - BAR_H + 2} />
            <text className="axis" x={X(t)} y={H - AX - BAR_H + 16} textAnchor="middle">{t}</text>
          </g>
        ))}
        {results.map((r, i) => {
          const y = PT + i * (rowH + gap)
          const w = wrapped[i]
          const on = r.id === selected
          return (
            <g key={r.id} style={{ cursor: 'pointer' }}
              onClick={() => onPick(on ? '' : r.id)}>
              <text className="axis" x={PL - 10} textAnchor="end"
                y={y + rowH / 2 + 4 - (w.length - 1) * 6}
                style={{ fontSize: 11.5, fill: 'var(--ink)', fontWeight: on ? 700 : 400 }}>
                {w.map((ln, k) => (
                  <tspan key={k} x={PL - 10} dy={k ? 12 : 0}>{ln}</tspan>
                ))}
                <title>{r.name}</title>
              </text>
              <rect x={PL} y={y + 3} width={Math.max(1, X(value(r)) - PL)} height={rowH - 6} rx={3}
                stroke={MARK_EDGE} strokeWidth={on ? 1 : 0.4}
                fill={rampColor(Math.min(1, Math.max(0, at(r))), rampKey)}>
                <title>
                  {r.name} — {r.count} of this list in a set of {r.setSize},
                  {' '}{r.foldEnrichment.toFixed(2)}× enrichment,
                  {' '}adjusted p {r.padj > 0 ? r.padj.toExponential(1) : `<1e-308 (−log₁₀ ${nlp(r).toFixed(1)})`}
                </title>
              </rect>
              <text className="axis" x={X(value(r)) + 7} y={y + rowH / 2 + 4}
                style={{ fontSize: 11 }}>{fmtV(r)}</text>
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - AX - BAR_H + 2} y2={H - AX - BAR_H + 2} />
        <text className="axis" x={(PL + W - PR) / 2} y={H - AX - BAR_H + 34} textAnchor="middle">
          {axisLabel}
        </text>
        {/* The significance, as a scale rather than as bar length — so a page
            where nothing is significant reads as pale, not as broken. */}
        <ColorBar cx={(PL + W - PR) / 2} y={H - BAR_H + 16} w={220} h={11}
          ramp={rampKey} lo={lo} hi={hi} id="ora-scale"
          title="−log₁₀ adjusted p" />
        <text className="axis" x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle"
          style={{ fill: 'var(--ink-3)' }}>
          {lo <= CUT
            ? `0.05 is ${CUT.toFixed(1)} on this scale`
            : `every term drawn is past 0.05 — the scale starts at ${lo.toFixed(1)}`}
        </text>
      </svg>
    </div>
  )
}

/** Whole-number ticks for a count axis — a count of 7 has no 3.5. */
function niceTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 5))
  const out: number[] = []
  for (let v = 0; v <= max; v += step) out.push(v)
  return out
}
