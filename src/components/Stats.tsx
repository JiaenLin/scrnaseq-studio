import { useMemo, useState } from 'react'
import type { CellType, DERow, DEView, Method } from '../types.ts'
import type { Source } from '../lib/source.ts'
import {
  condLabel, deWilcox, designFor, inConds, isSig, LFC_GATE, MIN_CELLS, MIN_CELLS_GROUP,
  DE_GATES, MIN_REPS_PB, PCT_GATE, pseudobulkColumns, sameOrOverlapping, SEURAT_GATES,
  wilcoxSpec,
  typesLabel,
  type DEResult, type Gates, type SigBasis,
} from '../lib/stats.ts'
import { useJob } from '../lib/compute.ts'
import Progress, { Failed } from './Progress.tsx'
import { downloadCsv, slug } from '../lib/download.ts'
import { fmt, maxOf } from '../lib/chart.ts'
import { condKey } from '../lib/source.ts'
import {
  AXIS_INK, DOWN_MARK, MARK_EDGE, NULL_MARK, PLATE, UP_MARK,
} from '../lib/figure-ink.ts'
import { textW } from '../lib/labels.ts'
import { KeyRow } from './svg-parts.tsx'
import { nlpTxt, pTxt } from '../lib/significance.ts'
import { Card, Empty, Mono, Seg } from './Ui.tsx'
import Figure from './Figure.tsx'
import DEGTableBody from './DEGTable.tsx'

export interface StatsProps {
  src: Source
  /**
   * The cell types the contrast runs over, and their indices.
   *
   * A LIST, because a contrast is often about a lineage rather than a cluster —
   * "all three cardiomyocyte states, HFD against chow". Running it once per
   * cluster and reading the tables side by side is not the same test: three
   * corrections, three underpowered passes, and no pooled estimate. The cells of
   * every selected type go on the same two sides; see `cellsOf`.
   *
   * May be EMPTY, which means nothing has been chosen and nothing is computed.
   */
  ts: CellType[]
  tis: number[]
  ctrl: string[]
  cs: string[]
  method: Method
  computed: boolean
  running: boolean
  /** Significance cutoffs, held at app level so every tab and Methods agree. */
  padjMax: number
  lfcMin: number
  /**
   * The gates a gene must clear to be TESTED — Seurat's min.pct and
   * logfc.threshold. Not a cutoff: these decide what the pass looks at, where
   * padjMax and lfcMin decide what a finished answer is called significant.
   */
  gates: Gates
  onGates: (g: Gates) => void
  /** Which correction the cutoff cuts on — Bonferroni saturates, so this is a choice. */
  sigBasis: SigBasis
  onSigBasis: (b: SigBasis) => void
  onMethod: (m: Method) => void
  onRun: () => void
  onPadj: (v: number) => void
  onLfc: (v: number) => void
  onPickGene: (g: string) => void
}

const tName = (p: StatsProps) => typesLabel(p.ts.map(t => t.name))
const contrastLabel = (p: StatsProps) =>
  `${condLabel(p.cs)} vs ${condLabel(p.ctrl)} · ${tName(p)}`

/**
 * The contrast, computed.
 *
 * The key is the comparison and nothing else — moving a threshold slider filters
 * rows that are already in hand, so on a collection it must not send the reader
 * back over the file. Switching between this tab, the volcano and enrichment
 * must not either, which is why the result is cached against the object.
 *
 * All three contrast tabs call this with the same key, which is what makes them
 * one computation rather than three: whichever is opened first starts the pass,
 * the other two find it already running (or already cached) and join it. In
 * particular Enrichment does not test any gene of its own — it reads the rows
 * this returns and runs the hypergeometric test over them.
 *
 * Changing the cell type or either side of the contrast changes the key, and a
 * different key in the SAME slot cancels the pass in flight — nobody wants the
 * old contrast once they have asked for a new one. The old answer cannot arrive
 * late and overwrite the new one because there is nothing left to deliver it to,
 * and it cannot be rendered under the new key because the value returned is only
 * ever the one stored under the key being asked for.
 *
 * The slot is 'de' and nothing else uses it, so leaving these tabs — for Markers
 * or anywhere else — cancels nothing. Come back and the contrast is either
 * already in hand or still running where it was left.
 */
function useDE(p: StatsProps) {
  const g = p.gates
  return useJob<'wilcox'>(
    // The gates are part of the QUESTION, not a filter over the answer: a gene
    // they exclude was never tested, so changing them is a different pass and
    // has to be a different key.
    // The types by KEY and in a stable order, so the key does not change when
    // the same selection is made in a different sequence — that would be a
    // second identical pass over the file.
    p.src, 'de',
    `de|${p.ts.map(t => t.key).join('+')}|${condKey(p.ctrl)}|${condKey(p.cs)}|${g.pct}|${g.lfc}`,
    // `computed` is the reader's go-ahead for THIS contrast. Without it every
    // click in the group pickers started a whole-transcriptome pass — and with
    // sets, choosing four levels a side is seven clicks and seven passes, six
    // of them cancelled a moment after they began.
    // A side with nothing on it is not a comparison, and neither is a contrast
    // with no cell type. Both are the starting state now that nothing is
    // pre-selected, so both have to hold the pass rather than run an empty one.
    p.method === 'wilcox' && p.tis.length > 0 && p.ctrl.length > 0 && p.cs.length > 0
      && !sameOrOverlapping(p.ctrl, p.cs) && p.computed,
    () => deWilcox(p.src, p.tis, p.ctrl, p.cs, g),
    // A fresh spec every time: the engine transfers these arrays rather than
    // copying them, so a reused one would arrive detached.
    () => ({ kind: 'wilcox', ...wilcoxSpec(p.src, p.tis, p.ctrl, p.cs, g) }),
  )
}

const testing = (p: StatsProps) =>
  `Testing every gene in ${tName(p)}: ${condLabel(p.cs)} against ${condLabel(p.ctrl)}`

/** The test picker, above every contrast tab. */
function MethodBar(p: StatsProps) {
  const d = designFor(p.src, p.tis, p.ctrl, p.cs)
  const why = p.tis.length > 1
    ? 'Pseudobulk exports one cell type at a time — the counts are summed per'
      + ' cluster and sample in the bundle, so pooling clusters would mean adding'
      + ' those columns together rather than choosing between them.'
    : !d.pbOK && p.ctrl !== p.cs
      ? `Pseudobulk needs more than ${MIN_REPS_PB - 1} samples per group; ${tName(p)} has ${d.n0} and ${d.n1}.`
      : ''
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span className="glabel">Test</span>
          <Seg<Method>
            value={p.method} onChange={p.onMethod}
            disabled={k => k === 'pseudobulk' && !d.pbOK}
            options={[
              { k: 'wilcox', label: 'Wilcoxon · per cell' },
              // NOT "Pseudobulk · DESeq2". The card behind this explains that the
              // matrix is here and the model is not — but a control is read
              // before the card it opens, and this one named a test the studio
              // cannot fit. What pressing it does is sum counts per sample and
              // hand you the matrix, so that is what it says.
              { k: 'pseudobulk', label: 'Pseudobulk · export counts', title: why },
            ]}
          />
        </div>
        <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>
          {p.method === 'wilcox'
            // The correction the CUTOFF uses, not a fixed word. Both columns are
            // always computed; naming Bonferroni while the reader cuts on FDR
            // describes a different table from the one on screen.
            ? `logfc.threshold ${p.gates.lfc} · min.pct ${p.gates.pct}`
              + ` · ${p.sigBasis === 'fdr' ? 'BH' : 'Bonferroni'}`
            : `≥ ${MIN_CELLS} cells per sample · summed raw counts · test them in DESeq2`}
        </span>
      </div>
      {why && (
        <p className="mb-3 mt-[-2px] tx-micro" style={{ color: 'var(--ink-3)' }}>{why}</p>
      )}
    </>
  )
}

/**
 * The significance cutoffs, adjustable and shared.
 *
 * Held at app level rather than per tab: the table, the volcano's dashed lines,
 * the enrichment input list and the Methods sentence all read the same two
 * numbers, so moving a slider here can never leave one of them describing a
 * different experiment.
 */
export function ThresholdBar(p: StatsProps & { nTested: number }) {
  // `nTested` is the Bonferroni DENOMINATOR — spec.nGenes, every gene the object
  // measures — and not the number of genes the rank sum ran on. finish() has
  // always multiplied by the former; the two are only equal when both gates are
  // at zero.
  const negLog = -Math.log10(Math.max(p.padjMax, 1e-300))
  const seurat = p.gates.pct === PCT_GATE && p.gates.lfc === LFC_GATE
  // The studio's own default: min.pct, and no effect-size gate. See DE_GATES —
  // the sort that gate was avoiding is 5x cheaper than it was, so every gene is
  // tested and the |log2FC| slider filters answers rather than deciding the
  // question.
  const wide = p.gates.pct === PCT_GATE && p.gates.lfc === 0
  const [openGates, setOpenGates] = useState(false)

  /**
   * Where Bonferroni stops being able to tell rows apart.
   *
   * padj is min(1, p x nTested), so every gene with p above 1/nTested is
   * pinned to exactly 1 and no cutoff above that admits a single extra row.
   * The slider still moves; the answer cannot. Saying so is the difference
   * between a control that looks broken and one whose limit is stated.
   */
  const ceiling = p.nTested > 0 ? 1 / p.nTested : 0
  const inert = p.sigBasis === 'padj' && p.padjMax > ceiling && p.nTested > 0

  return (
    <div className="panel mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      <label className="flex items-center gap-2 tx-small" style={{ color: 'var(--ink-2)' }}>
        <span className="glabel">{p.sigBasis === 'fdr' ? 'FDR ≤' : 'padj ≤'}</span>
        <input
          type="range" min={0} max={10} step={0.1} value={Math.min(negLog, 10)}
          aria-label="Adjusted p-value threshold"
          onChange={e => p.onPadj(Math.pow(10, -(+e.target.value)))}
        />
        <span className="mono w-[70px] tx-micro">
          {p.padjMax < 1e-3 ? p.padjMax.toExponential(1) : p.padjMax.toFixed(3)}
        </span>
      </label>
      <label className="flex items-center gap-2 tx-small" style={{ color: 'var(--ink-2)' }}>
        <span className="glabel">|log₂FC| ≥</span>
        <input
          type="range" min={0} max={3} step={0.05} value={Math.min(p.lfcMin, 3)}
          aria-label="Fold change threshold"
          onChange={e => p.onLfc(+e.target.value)}
        />
        <span className="mono w-8 tx-micro">{p.lfcMin.toFixed(2)}</span>
      </label>
      {/* Which column the cutoff is read off. Bonferroni saturates at 1/n, so
          on a modest gene list the slider above is inert over most of its
          travel; BH does not, and the table has carried the column all along. */}
      <label className="flex items-center gap-1.5">
        <span className="glabel">cut on</span>
        <Seg<SigBasis>
          value={p.sigBasis} onChange={p.onSigBasis}
          options={[
            { k: 'padj', label: 'Bonferroni', title: 'padj — severe, and pinned to 1 for every gene with p above 1/n' },
            { k: 'fdr', label: 'FDR', title: 'Benjamini–Hochberg — what the slider can actually move' },
          ]}
        />
      </label>
      <button
        className="btn btn-quiet ml-auto"
        title="Back to the defaults for the selected test"
        onClick={() => {
          p.onPadj(0.05)
          p.onLfc(p.method === 'wilcox' ? LFC_GATE : 1)
          p.onGates(DE_GATES)
          p.onSigBasis('padj')
        }}
      >Reset</button>

      {/**
        * The other inert control, and the one that was reported.
        *
        * The |log2FC| cutoff runs to 0, but a gene below the GATE was never
        * tested — it has no row to admit, at any cutoff. So dragging the slider
        * under Seurat's logfc.threshold does nothing at all, and the reason is
        * a number folded away in the panel below rather than the one the reader
        * is dragging. Both default to 0.25, so the whole travel below the
        * default is dead until somebody widens the gate.
        *
        * Stated where it happens, with the one click that fixes it. Not done
        * automatically: widening the gate re-runs the test, and a slider that
        * silently starts a four-minute pass is the complaint before this one.
        */}
      {p.method === 'wilcox' && p.lfcMin < p.gates.lfc && (
        <p className="basis-full flex flex-wrap items-center gap-2 tx-micro"
          style={{ color: 'var(--ink-3)' }}>
          <span>
            Genes under <b>{p.gates.lfc}</b> log₂ are in the table with their fold change
            and detection rates, and with no p — Seurat&rsquo;s{' '}
            <span className="mono">logfc.threshold</span> skips the rank sum for them, so
            this cutoff lists them but cannot call them significant.
          </span>
          <button className="btn btn-sm"
            title="Run the rank sum on them as well. This runs the test again."
            onClick={() => p.onGates({ ...p.gates, lfc: 0 })}
          >Test them too</button>
        </p>
      )}

      {inert && (
        <p className="basis-full tx-micro" style={{ color: 'var(--warn)' }}>
          Bonferroni over the {fmt(p.nTested)} genes this object measures pins every gene
          with p above{' '}
          {ceiling.toExponential(1)} to exactly 1, so no cutoff above that admits another
          row — moving the slider here cannot change the count. Cut on <b>FDR</b> for a
          threshold that does something, or read the −log₁₀ padj column, which still
          separates them.
        </p>
      )}

      {/**
        * The gates, folded away.
        *
        * They decide what is TESTED, so changing one is a new pass — and left
        * open beside two sliders that are free to drag, a stray click re-armed
        * Run on a four-minute computation. Reported as exactly that. Closed by
        * default, and the summary line says what is in force so this is never
        * hidden state: a reader who has widened them sees it without opening
        * anything.
        */}
      {p.method === 'wilcox' && (
        <div className="basis-full">
          <div className="flex flex-wrap items-center gap-2">
            <button className="chip" aria-expanded={openGates}
              onClick={() => setOpenGates(v => !v)}
              title="Seurat's own pre-test filters — a gene that fails either is never tested">
              {openGates ? '▾' : '▸'} What gets tested
            </button>
            <span className="tx-micro"
              style={{ color: wide || seurat ? 'var(--ink-3)' : 'var(--warn)' }}>
              {wide
                ? `min.pct ${p.gates.pct}, no logfc.threshold — every gene detected in`
                  + ' a tenth of either side is tested, so the slider above filters answers'
                : seurat
                  ? `Seurat's defaults — min.pct ${p.gates.pct}, logfc.threshold ${p.gates.lfc}`
                  : `min.pct ${p.gates.pct}, logfc.threshold ${p.gates.lfc}`
                    + ' — changing these re-runs the test'}
            </span>
          </div>
          {openGates && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-1.5 tx-small" style={{ color: 'var(--ink-2)' }}>
                <span className="mono tx-micro">min.pct</span>
                <input
                  className="inp w-16" type="number" min={0} max={1} step={0.05}
                  aria-label="Minimum detection rate to test a gene"
                  value={p.gates.pct}
                  onChange={e => p.onGates({ ...p.gates, pct: clamp01(+e.target.value) })} />
              </label>
              <label className="flex items-center gap-1.5 tx-small" style={{ color: 'var(--ink-2)' }}>
                <span className="mono tx-micro">logfc.threshold</span>
                <input
                  className="inp w-16" type="number" min={0} max={5} step={0.05}
                  aria-label="Minimum absolute log2 fold change to test a gene"
                  value={p.gates.lfc}
                  onChange={e => p.onGates({ ...p.gates, lfc: Math.max(0, +e.target.value || 0) })} />
              </label>
              <button
                className="chip"
                aria-pressed={p.gates.pct === 0 && p.gates.lfc === 0}
                title="Both gates to zero: every gene the object measures is tested"
                onClick={() => p.onGates(
                  p.gates.pct === 0 && p.gates.lfc === 0 ? DE_GATES : { pct: 0, lfc: 0 })}
              >Test every gene</button>
              <button
                className="chip"
                aria-pressed={seurat}
                title="Seurat's own pre-test filters, for a table that reproduces FindMarkers row for row"
                onClick={() => p.onGates(seurat ? DE_GATES : SEURAT_GATES)}
              >Seurat&rsquo;s defaults</button>
              <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>
                These decide what the test looks at, and changing one runs it again. A gene
                under <span className="mono">logfc.threshold</span> still gets a row, with
                its fold change and no p; one under <span className="mono">min.pct</span>
                {' '}gets none, because there is nothing to compare. Neither changes the
                correction: Bonferroni multiplies by every gene the object measures, and
                that is BH&rsquo;s <i>m</i> as well.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A detection rate is a fraction; a typed 5 is a typo, not a request. */
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))

/** Results, or the reason there are none — never a substitute number. */
function gate(p: StatsProps, de: DEResult | null): React.ReactNode {
  /**
   * Nothing chosen yet, and which of the three it is.
   *
   * This comes FIRST, and it is new because the starting state is new: the cell
   * type used to default to the first cluster and the two sides to the first and
   * last condition, so a contrast always existed and this branch was
   * unreachable. Those defaults were a guess drawn as a decision — "aged_HFD vs
   * young_chow" appears in the bar whether or not anybody asked for it, and the
   * only way to notice it is a guess is to notice it is the wrong one.
   *
   * Naming the missing piece rather than saying "make a selection": the picker
   * that needs attention is one of three in a row, and which one it is is the
   * whole of what the reader needs to know.
   */
  const missing = [
    p.tis.length ? '' : 'a cell type',
    p.ctrl.length ? '' : 'a control group',
    p.cs.length ? '' : 'a group to compare it with',
  ].filter(Boolean)
  if (missing.length)
    return <div className="note mt-3.5">
      <b>Pick {missing.length === 1 ? missing[0] : missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1]}.</b>{' '}
      The pickers are in the bar above. Nothing is chosen for you, because a
      contrast the studio guessed at looks exactly like one you asked for.
    </div>

  if (sameOrOverlapping(p.ctrl, p.cs))
    return <Empty title="Pick two groups with no level in common">
      A level on both sides puts the same cells in both groups.
    </Empty>

  // Not asked for yet. The action itself lives in the control bar, at the end of
  // the row that decides what it will run — so this says what would happen and
  // points at it rather than being a second, differently-placed button. Two
  // primary buttons for one action is a choice the reader has to make and
  // shouldn't have to.
  if (!p.computed)
    return <div className="note mt-3.5">
      <b>Not computed yet.</b> One pass over the object, testing every gene in {tName(p)}.
      Set the groups above, then press <b>Run</b>.
    </div>

  const d = designFor(p.src, p.tis, p.ctrl, p.cs)

  if (p.method === 'wilcox') {
    // Still running: the caller shows how far it has got.
    if (!de) return null
    const { n0, n1 } = de
    if (!n0 || !n1)
      return <Empty title={`No ${tName(p)} cells in one of these groups`}>
        {n0} cells in {condLabel(p.ctrl)}, {n1} in {condLabel(p.cs)}.
      </Empty>
    // Seurat's min.cells.group. A side of one or two cells does produce a table —
    // a long one, with small p-values — but every row of it describes those cells
    // rather than a difference between groups, and nothing on the page would say so.
    if (n0 < MIN_CELLS_GROUP || n1 < MIN_CELLS_GROUP)
      return <Empty title={`Too few ${tName(p)} cells to test one of these groups`}>
        {n0} cell{n0 === 1 ? '' : 's'} in {condLabel(p.ctrl)}, {n1} in {condLabel(p.cs)}.
        A rank-sum test needs at least {MIN_CELLS_GROUP} per group — Seurat&rsquo;s{' '}
        <Mono>min.cells.group</Mono>.
      </Empty>
    return null
  }

  if (!d.pbOK)
    return (
      <Empty title={`Not enough samples in ${tName(p)} for pseudobulk`}>
        {d.n0} {condLabel(p.ctrl)} and {d.n1} {condLabel(p.cs)} samples clear the {MIN_CELLS}-cell floor.
        Pseudobulk needs more than {MIN_REPS_PB - 1} per group.
        <div className="mt-3.5">
          <button className="btn btn-primary" onClick={() => p.onMethod('wilcox')}>
            Use Wilcoxon instead
          </button>
        </div>
        <div className="scrollx mt-4 text-left">
          <table className="t">
            <thead>
              <tr><th>Sample</th><th>Group</th><th>Cells in {tName(p)}</th><th>Used</th></tr>
            </thead>
            <tbody>
              {d.used.map(s => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td>{s.cond}</td>
                  <td className="num">{s.n}</td>
                  <td>
                    <span className={`badge badge-${s.n >= MIN_CELLS ? 'here' : 'none'}`}>
                      {s.n >= MIN_CELLS ? 'yes' : 'too few cells'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Empty>
    )

  // No pretend DESeq2. The bundle carries the summed counts; running the model
  // is R's job until webR is wired, and saying so is better than a number nobody
  // can trace back to a method.
  return null
}

/** The pseudobulk design and its export — shown in place of results. */
function PseudobulkPanel(p: StatsProps) {
  const cols = pseudobulkColumns(p.src, p.tis, p.ctrl, p.cs)
  const pb = p.src.pseudobulk
  const n0 = cols.filter(c => inConds(c.cond, p.ctrl)).length
  const n1 = cols.filter(c => inConds(c.cond, p.cs)).length

  if (!pb) {
    return (
      <Empty title="This object carries no raw counts">
        Pseudobulk needs them; Wilcoxon does not.
        <div className="mt-3.5">
          <button className="btn btn-primary" onClick={() => p.onMethod('wilcox')}>
            Use Wilcoxon instead
          </button>
        </div>
      </Empty>
    )
  }

  const save = () => {
    const keep = cols.map(c => pb.columns.findIndex(
      x => x.sample === c.sample && x.cluster === c.cluster))
    downloadCsv(
      `pseudobulk_${slug(`${condLabel(p.cs)}_vs_${condLabel(p.ctrl)}_${tName(p)}`)}`,
      ['gene', ...cols.map(c => `${c.sample}__${c.cond}`)],
      pb.genes.map((g, gi) => [g, ...keep.map(k => pb.counts[gi * pb.columns.length + k])]))
  }

  return (
    <>
      <div className="note mt-1">
        <b>The matrix is here; the model is not.</b> Counts are summed per sample within{' '}
        {tName(p)} — the whole of the pseudobulk step. DESeq2 itself is not in the browser, so
        take these to <code className="mono">DESeqDataSetFromMatrix</code>.
      </div>
      <div className="scrollx mt-3.5">
        <table className="t">
          <thead>
            <tr><th>Sample</th><th>Group</th><th>Cells in {tName(p)}</th><th>Used</th></tr>
          </thead>
          <tbody>
            {p.src.d.samples
              .filter(s => inConds(s.cond, p.ctrl) || inConds(s.cond, p.cs))
              .map(s => {
                const hit = cols.find(c => c.sample === s.id)
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.id}</td>
                    <td>{s.cond}</td>
                    <td className="num">{hit?.nCells ?? 0}</td>
                    <td>
                      <span className={`badge badge-${hit ? 'here' : 'none'}`}>
                        {hit ? 'yes' : `under ${MIN_CELLS} cells`}
                      </span>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button className="btn btn-primary" disabled={!cols.length} onClick={save}>
          ⭳ Pseudobulk counts ({cols.length} columns)
        </button>
        <button className="btn" onClick={() => p.onMethod('wilcox')}>Back to Wilcoxon</button>
        <span className="tx-small" style={{ color: 'var(--ink-3)' }}>
          {n0} {condLabel(p.ctrl)} · {n1} {condLabel(p.cs)}
          {(n0 < MIN_REPS_PB || n1 < MIN_REPS_PB)
            && ` — fewer than ${MIN_REPS_PB} per group, so a between-animal test is not defensible here either`}
        </span>
      </div>
    </>
  )
}


const VIEWS: { k: DEView; label: string }[] = [
  { k: 'table', label: 'Table' },
  { k: 'volcano', label: 'Volcano' },
  { k: 'enrich', label: 'Enrichment' },
]

/**
 * One contrast, three ways of looking at it.
 *
 * These were three sibling tabs, which said they were three questions. They are
 * not: all three call `useDE` with the same key and read the same rows, so the
 * table, the volcano and the enrichment are renderings of ONE pass. Presenting
 * them as peers of Overview cost the reader three identical Test strips, three
 * identical threshold strips, three chances to press Run for the same work, and
 * an Enrichment tab whose card was nested inside this one's.
 *
 * Everything above the view picker is decided once and applies to all three.
 */
export function Differential(p: StatsProps & {
  view: DEView
  onView: (v: DEView) => void
  /** Enrichment is wired in App — it needs the gene universe and the palette. */
  enrichment: (rows: DERow[]) => React.ReactNode
}) {
  const { value: de, pass, failed, retry } = useDE(p)
  const blocked = p.method === 'pseudobulk' ? <PseudobulkPanel {...p} /> : gate(p, de)
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Seg<DEView> value={p.view} onChange={p.onView} options={VIEWS} />
        <span className="eyebrow">{contrastLabel(p)}</span>
      </div>
      <MethodBar {...p} />
      {blocked ?? (failed ? <Failed error={failed} onRetry={retry} what="This contrast" />
        : pass ? <Progress pass={pass} title={testing(p)} /> : de && (
        <>
          {/* nGenes, not de.rows.length. `finish` multiplies by spec.nGenes —
              every gene the object measures, tested or not — so the ceiling the
              bar warns about is 1/nGenes, and reading the tested count here
              understated it by whatever the gates removed. */}
          <ThresholdBar {...p} nTested={p.src.genes.length} />
          {p.view === 'table' ? <DEGTable {...p} de={de} />
            : p.view === 'volcano' ? <Volcano {...p} de={de} />
            : p.enrichment(de.rows)}
        </>
      ))}
    </Card>
  )
}

function DEGTable(p: StatsProps & { de: DEResult }) {
  const { rows, n0, n1 } = p.de
  const wil = p.method === 'wilcox'
  const th = { padj: p.padjMax, lfc: p.lfcMin, basis: p.sigBasis }
  const up = rows.filter(r => isSig(r, th) && r.lfc > 0).length
  const dn = rows.filter(r => isSig(r, th) && r.lfc < 0).length

  return (
    <>
      <h2 className="tx-title">{up + dn} differentially expressed genes</h2>
      <p className="sub">
        {up} higher and {dn} lower in <b>{condLabel(p.cs)}</b>, at{' '}
        {p.sigBasis === 'fdr' ? 'FDR' : 'padj'} &lt; {p.padjMax} and
        |log₂FC| ≥ {p.lfcMin}.{' '}
        {/* Only one branch is reachable: the pseudobulk path returns the export
            card instead of a table, so nothing here was ever produced by
            DESeq2. The sentence claimed it anyway. */}
        <>Wilcoxon over {fmt(n0)} and {fmt(n1)} cells.</>
      </p>

      <DEGTableBody
        rows={rows} wilcox={wil} nGenes={p.src.genes.length} sigBasis={p.sigBasis}
        ctrl={condLabel(p.ctrl)} cs={condLabel(p.cs)} label={contrastLabel(p)}
        padjMax={p.padjMax} lfcMin={p.lfcMin} onPickGene={p.onPickGene}
      />
    </>
  )
}

function Volcano(p: StatsProps & { de: DEResult }) {
  const [hover, setHover] = useState<DERow | null>(null)
  /**
   * Genes the reader has clicked, named on the figure and kept there.
   *
   * Clicking used to leave the tab — it called onPickGene, which selects the
   * gene and navigates to Gene expression. That is a large, surprising action
   * for a click on a scatter plot: the reader loses the volcano they were
   * reading, along with every threshold and label they had set on it, and gets
   * a different tab about one gene. What a click on a point is actually asking
   * is "which gene is that?" — so it answers that, and the answer stays on the
   * figure and in the export.
   */
  const [pinned, setPinned] = useState<string[]>([])
  const [nLabels, setNLabels] = useState(12)
  const de = p.de
  /**
   * The tested genes only.
   *
   * A volcano's y IS the significance, so a gene the effect-size gate kept but
   * did not test has no position on it — its p is NaN, and one NaN coordinate
   * takes the axis extent, the path data and with it the whole figure. The
   * table is where those genes are read; here they are absent, and the count
   * under the figure says so.
   */
  const rows = useMemo(() => de.rows.filter(r => Number.isFinite(r.nlp)), [de])
  const untested = de.rows.length - rows.length

  // PB carries the x-axis title and, below it, the key. That key used to sit in
  // an HTML row underneath the figure, so an exported volcano arrived with three
  // colours of point and nothing to say which direction was which.
  const W = 760, H = 466, PL = 58, PB = 72, PT = 16, PR = 16
  // maxOf, not `Math.max(...)`: the spread passes one argument per DE gene and
  // V8 refuses past ~124 900 of them — measured on this machine. This atlas
  // reports 31 053, so the old form did not crash here and would have on any
  // larger gene list, taking the React tree down with it and leaving a white
  // page. Both extents are remembered too, because each was allocating and
  // walking a 31 053-element array on every render of the tab.
  const maxX = useMemo(
    () => Math.max(3, maxOf(rows.map(r => Math.abs(r.lfc)))) * 1.12, [rows])
  // r.nlp, not -log10(padj): on the atlas 11% of the rows have an adjusted p
  // below the smallest double, so that expression pinned every one of them to
  // the 1e-300 clamp and the top of the volcano was a flat line of 300s.
  const maxY = useMemo(() => Math.max(6, maxOf(rows.map(r => r.nlp))) * 1.08, [rows])
  const X = (v: number) => PL + ((W - PL - PR) * (v + maxX)) / (2 * maxX)
  const Y = (v: number) => PT + (H - PT - PB) * (1 - v / maxY)

  /** A label's box: beside its point, at full length. Never shortened. */
  const labelBox = (q: { x: number; y: number; r: DERow }): number[] => {
    const w = textW(q.r.gene, 10.5)
    const x0 = q.r.lfc > 0 ? q.x + 7 : q.x - 7 - w
    return [x0 - 1, q.y - 5, x0 + w + 1, q.y + 5]
  }
  /** Clear of every box kept so far, and inside the panel the PNG crops to. */
  const fits = (box: number[], kept: { box: number[] }[]): boolean =>
    box[0] >= PL - 2 && box[2] <= W - PR + 2
    && kept.every(k =>
      box[2] < k.box[0] || box[0] > k.box[2] || box[3] < k.box[1] || box[1] > k.box[3])

  const pts = useMemo(
    () => rows.map(r => ({
      r,
      x: X(r.lfc),
      y: Y(r.nlp),
      sig: isSig(r, { padj: p.padjMax, lfc: p.lfcMin, basis: p.sigBasis }),
    })),
    // X and Y are pure functions of maxX/maxY, which derive from rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, p.padjMax, p.lfcMin, maxX, maxY])

  /**
   * Which genes get a name, and where.
   *
   * "Labels: 12" is a budget, not a promise of the first twelve. Ranked points
   * cluster — the strongest hits sit together at the top of the plume — so
   * taking the first n by rank wrote Cdk1 over Pcna and Sox11 over Vim. A gene
   * name overlapping another gene name is worse than no name at all, because
   * the reader cannot tell which of the two they are looking at.
   *
   * So: walk the ranking, keep a label only if its box is clear of every box
   * already kept, and carry on down the list until the budget is filled. A
   * crowded plot then names twelve *readable* genes rather than the twelve
   * highest, which is the trade the control is really offering.
   */
  /**
   * Which genes are named, in two sets computed separately and deliberately so.
   *
   * The automatic labels come from the ranking with a fixed budget and no
   * reference at all to what the reader has clicked. The first version mixed
   * them: clicked genes were placed FIRST, taking boxes the automatic ones
   * would have had, and the budget was `nLabels + pinned.size`. Both made the
   * whole label set a function of the clicked set, so clicking one point
   * silently renamed points on the other side of the plot. Reported, and
   * correct — a figure must not rearrange itself because you asked what one
   * dot was.
   *
   * Greedy over the ranking, keeping a label only if its box is clear of those
   * already kept: ranked points cluster, so the first n by rank writes Cdk1
   * over Pcna, and the budget is better spent on n READABLE genes. Nothing is
   * ever shortened — a gene symbol with its tail cut off is not a gene symbol —
   * so a label that cannot be placed is simply not drawn.
   */
  const auto = useMemo(() => {
    if (!nLabels) return [] as { q: (typeof pts)[number]; box: number[] }[]
    const kept: { q: (typeof pts)[number]; box: number[] }[] = []
    for (const q of pts) {
      if (kept.length >= nLabels) break
      if (!q.sig) continue
      const box = labelBox(q)
      if (fits(box, kept)) kept.push({ q, box })
    }
    return kept
    // labelBox and fits are pure functions of constants defined above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, nLabels])

  /**
   * The genes the reader clicked, which are always named.
   *
   * They may land on an automatic label — they are bold, ringed and haloed, so
   * they are the one that reads. What they may not do is change WHICH automatic
   * labels were chosen, which is why `auto` above does not know they exist.
   */
  const picked = useMemo(() => {
    if (!pinned.length) return [] as (typeof pts)[number][]
    const want = new Set(pinned)
    const already = new Set(auto.map(k => k.q.r.gene))
    return pts.filter(q => want.has(q.r.gene) && !already.has(q.r.gene))
  }, [pts, pinned, auto])

  const labelled = useMemo(
    () => [...auto.map(k => k.q), ...picked], [auto, picked])

  const step = Math.max(1, Math.ceil(maxY / 5))
  const ticks: number[] = []
  for (let t = 0; t <= maxY; t += step) ticks.push(t)
  const up = pts.filter(q => q.sig && q.r.lfc > 0).length
  const dn = pts.filter(q => q.sig && q.r.lfc < 0).length

  /**
   * The point under the pointer — the one you can SEE there.
   *
   * This walked the array forwards and returned the first within twelve units,
   * which is a different question. Points are painted in array order, so the
   * one visible at a spot is the LAST drawn there; searching forwards returned
   * whichever came earliest in the DE table, and in a dense plume that is a
   * different gene from the one under the cursor. Reported as clicking one dot
   * and selecting another.
   *
   * Backwards, then: topmost first, and a hit means inside that point's own
   * radius rather than inside a fixed twelve units. Significant points are
   * drawn at r=4 and the rest at 2.6, so a click on the grey cloud no longer
   * reaches four units past it to a red one.
   */
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * H
    // A little slop so a click a pixel off a small point still takes it, but
    // far less than the twelve units that were reaching across neighbours.
    const SLOP = 2.5
    for (let i = pts.length - 1; i >= 0; i--) {
      const q = pts[i]
      const r = (q.sig ? 4 : 2.6) + SLOP
      if ((q.x - mx) ** 2 + (q.y - my) ** 2 <= r * r) return q
    }
    return null
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <span className="badge" style={{ background: 'color-mix(in srgb, var(--up) 14%, transparent)', color: 'var(--up)' }}>
          ▲ {up} up in {condLabel(p.cs)}
        </span>
        <span className="badge" style={{ background: 'color-mix(in srgb, var(--down) 14%, transparent)', color: 'var(--down)' }}>
          ▼ {dn} up in {condLabel(p.ctrl)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {pinned.length > 0 && (
            <>
              <button className="btn btn-quiet" onClick={() => setPinned([])}>
                Clear {pinned.length} clicked
              </button>
              <div className="gsep" />
            </>
          )}
          <span className="glabel">Labels</span>
          {[0, 12, 25].map(n => (
            <button key={n} className="chip" aria-pressed={nLabels === n} onClick={() => setNLabels(n)}>
              {n === 0 ? 'none' : n}
            </button>
          ))}
        </span>
      </div>

      <Figure name={`volcano_${contrastLabel(p)}`} className="mt-6">
        <svg
          viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
          aria-label={`Volcano plot for ${contrastLabel(p)}`}
          style={{ cursor: hover ? 'pointer' : 'default' }}
          onMouseMove={e => setHover(pick(e)?.r ?? null)}
          onMouseLeave={() => setHover(null)}
          onClick={e => {
            const q = pick(e)
            if (!q) return
            // Clicking a named gene again un-names it, so the figure can be
            // cleaned up with the same gesture that built it.
            setPinned(prev => prev.includes(q.r.gene)
              ? prev.filter(g => g !== q.r.gene)
              : [...prev, q.r.gene])
          }}
        >
          {/* The end ticks are anchored to the panel edge, not centred on it.
              Centred, "-3.4" hung half its width past x = PL and landed on the
              y-axis numbers beside it; the same at the right edge put ink
              outside the viewBox, which the PNG export then cropped. */}
          {[-2, -1, 0, 1, 2].map(f => {
            const v = (maxX * f) / 2
            return <text key={f} x={X(v)} y={H - PB + 15}
              textAnchor={f === -2 ? 'start' : f === 2 ? 'end' : 'middle'}
              style={{ fontSize: 10.5, fill: AXIS_INK }}>{v.toFixed(1)}</text>
          })}
          {ticks.map(t => (
            <g key={t}>
              <line className="axgrid" x1={PL} x2={W - PR} y1={Y(t)} y2={Y(t)} />
              <text x={PL - 7} y={Y(t) + 3.5} textAnchor="end"
                style={{ fontSize: 10.5, fill: AXIS_INK }}>{t}</text>
            </g>
          ))}
          <line x1={PL} x2={W - PR} y1={Y(-Math.log10(p.padjMax))} y2={Y(-Math.log10(p.padjMax))}
            stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
          {[p.lfcMin, -p.lfcMin].map(v => (
            <line key={v} x1={X(v)} x2={X(v)} y1={PT} y2={H - PB}
              stroke="var(--ink-3)" strokeDasharray="4 3" opacity=".7" />
          ))}
          {/* Significant points carry the black edge the key shows; the
              non-significant cloud does not, because outlining several thousand
              grey points turns the background into a solid mass and buries the
              genes the figure is about. The edge is for the marks a reader is
              meant to pick out one by one. */}
          {pts.map(q => (
            <circle key={q.r.gene} cx={+q.x.toFixed(1)} cy={+q.y.toFixed(1)}
              r={hover?.gene === q.r.gene ? 6 : q.sig ? 4 : 2.6}
              fill={q.sig ? (q.r.lfc > 0 ? UP_MARK : DOWN_MARK) : NULL_MARK}
              stroke={q.sig ? MARK_EDGE : 'none'} strokeWidth={q.sig ? 0.6 : 0}
              opacity={q.sig ? 0.92 : 0.45} />
          ))}
          {labelled.map(q => {
            const clicked = pinned.includes(q.r.gene)
            return (
              <g key={q.r.gene}>
                {clicked && (
                  <circle cx={q.x} cy={q.y} r={7} fill="none"
                    stroke={AXIS_INK} strokeWidth={1.6} opacity=".95" />
                )}
                {/* A clicked name is read against whatever is behind it, so it
                    carries a halo of the plate. Without one a bold label landing
                    on the plume is unreadable at exactly the moment the reader
                    asked for it — reported as not being able to see the name. */}
                <text className="axis" x={q.x + (q.r.lfc > 0 ? 7 : -7)} y={q.y + 3.5}
                  textAnchor={q.r.lfc > 0 ? 'start' : 'end'}
                  style={{
                    fontStyle: 'italic', fontSize: 10.5, fill: 'var(--ink)',
                    fontWeight: clicked ? 700 : 400,
                    paintOrder: 'stroke',
                    stroke: clicked ? PLATE : 'none',
                    strokeWidth: clicked ? 3.2 : 0,
                    strokeLinejoin: 'round',
                  }}>{q.r.gene}</text>
              </g>
            )
          })}
          <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
          <text x={(PL + W - PR) / 2} y={H - PB + 32} textAnchor="middle"
            style={{ fontSize: 11.5, fill: AXIS_INK }}>
            log₂ fold change · {condLabel(p.cs)} vs {condLabel(p.ctrl)}
          </text>
          <text transform={`rotate(-90 15 ${(PT + H - PB) / 2})`} x={15}
            y={(PT + H - PB) / 2} textAnchor="middle"
            style={{ fontSize: 11.5, fill: AXIS_INK }}>−log₁₀ adjusted p</text>

          {/* The key, in the figure and centred under the panel, in the same
              language as the marks it describes. */}
          {/* Size is an encoding too. Significant points are drawn at r=4 and the
              rest at 2.6, and until now only the colour was explained — in an
              exported PNG there is nobody left to ask what the small ones are.
              Drawn at the true radii so the key is a sample of the figure. */}
          <g>
            <circle cx={PL + 4} cy={H - 14} r={4} fill={NULL_MARK}
              stroke={MARK_EDGE} strokeWidth={0.6} opacity={0.92} />
            <circle cx={PL + 17} cy={H - 14} r={2.6} fill={NULL_MARK} opacity={0.45} />
            <text x={PL + 24} y={H - 10.5} style={{ fontSize: 10.5, fill: AXIS_INK }}>
              larger = past both cutoffs
            </text>
          </g>
          <KeyRow cx={(PL + W - PR) / 2 + 60} y={H - 14} width={W - PL - PR - 190} items={[
            { color: UP_MARK, label: `up in ${condLabel(p.cs)}` },
            { color: DOWN_MARK, label: `up in ${condLabel(p.ctrl)}` },
            { color: NULL_MARK, label: 'not significant' },
          ]} />
        </svg>
      </Figure>

      {/* Only the readout stays out here: it changes as the pointer moves and
          has no meaning in a saved file. The three colours are in the figure. */}
      <div className="legend mt-2">
        <span style={{ color: 'var(--ink-3)' }}>
          {/* The same two columns the table shows, written the same way — a point
              near the top of this axis has an adjusted p the double cannot hold,
              and `padj.toExponential(1)` printed the floor as though it were the
              reading. */}
          {hover
            ? `${hover.gene} · log₂FC ${hover.lfc.toFixed(2)}`
              + ` · −log₁₀ padj ${nlpTxt(hover.nlp)} · padj ${pTxt(hover.padj)}`
            : '· hover a point to read it, click to keep its name on the figure'}
        </span>
      </div>

      {/* The underflow argument that used to sit here is in Methods, where a
          reviewer looks for it. On the figure it was six lines of arithmetic
          under a plot whose dashed lines are the only thing needing a caption. */}
      <figcaption className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        Dashed lines are the cutoffs above.
        {untested > 0 && (
          <> {fmt(untested)} more genes are in the table with a fold change and no p —
            under the effect-size gate, so the rank sum was skipped and they have no
            height to be drawn at.</>
        )}
      </figcaption>
    </>
  )
}
