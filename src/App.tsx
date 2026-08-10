import { useRef, useState } from 'react'
import type { CellType, ColorBy, GroupBy, Method, PlotKind, TabId } from './types.ts'
import { parseBundle } from './lib/bundle.ts'
import { readCollectionIndex } from './lib/collection.ts'
import { openCollection } from './lib/collection-source.ts'
import { bundleSource, demoSource, type Source } from './lib/source.ts'
import { designFor, thresholdFor } from './lib/stats.ts'
import { mergeGenes } from './lib/genes.ts'
import type { PaletteKey, RampKey } from './lib/palette.ts'
import CondPicker from './components/CondPicker.tsx'
import Landing from './components/Landing.tsx'
import Overview from './components/Overview.tsx'
import Cells from './components/Cells.tsx'
import Composition from './components/Composition.tsx'
import Markers from './components/Markers.tsx'
import { ContrastFrame, DEGTable, Volcano, type StatsProps } from './components/Stats.tsx'
import Enrichment from './components/Enrichment.tsx'
import GeneExpression from './components/GeneExpression.tsx'
import GeneSets from './components/GeneSets.tsx'
import Methods from './components/Methods.tsx'
import ViewBoundary from './components/Boundary.tsx'
import { Empty } from './components/Ui.tsx'

const TABS: [TabId | 'div', string][] = [
  ['overview', 'Overview'], ['cells', 'Cells'], ['composition', 'Composition'], ['markers', 'Markers'],
  ['div', '|'],
  ['degs', 'DEG table'], ['volcano', 'Volcano'], ['enrich', 'Enrichment'],
  ['expr', 'Gene expression'], ['sets', 'Gene sets'], ['methods', 'Methods'],
]

/** A tab's own word for itself, so the boundary names what broke as the user does. */
const LABEL = new Map(TABS.map(([id, label]) => [id, label]))

/**
 * Make one tab throw during render, on purpose: `?crash=markers`.
 *
 * The boundary in Boundary.tsx is the one piece of this app whose entire value
 * is what it does when something else is broken, and there is no way to watch it
 * work without breaking something. So the app carries its own fault injector and
 * `scripts/probe-boundary.mjs` drives it in Chromium.
 *
 * Read on every render rather than once at load, and that is the whole point:
 * the interesting claim is that a pass in flight OUTLIVES the crash, and a
 * reload to arm the fault would close the object and prove nothing. The probe
 * starts a real four-minute pass, arms this with history.replaceState, watches
 * the view die, and then finds the same pass still counting. Nothing else in the
 * app reads the URL, so this is not a pattern to copy — it is one line of
 * impurity bought for the one test that cannot be written any other way.
 *
 * Not gated on `import.meta.env.DEV`, deliberately: the white page the verifier
 * hit was in a production build, and a proof that only runs against the dev
 * server says nothing about the artifact people are actually given.
 */
const crashTab = () => new URLSearchParams(window.location.search).get('crash')

function CrashOnRender({ tab }: { tab: TabId }): never {
  throw new Error(`Deliberate fault in the ${LABEL.get(tab) ?? tab} view `
    + `(?crash=${tab} is in the URL). Nothing is actually wrong with this object.`)
}

/** Tabs that describe a comparison, and so cannot exist without two groups. */
const NEEDS_CONTRAST = new Set<TabId>(['degs', 'volcano', 'enrich'])

/** What a tab reads out of the shared selection above it. */
interface Needs {
  /** The Cell type select changes what this tab answers. */
  ct: boolean
  /** Control / Compare — and therefore the design badge — change what it answers. */
  contrast: boolean
}

const NOTHING: Needs = { ct: false, contrast: false }
const BOTH: Needs = { ct: true, contrast: true }

/**
 * Which shared controls belong above a given tab.
 *
 * These selectors used to sit above every tab, which made them noise on the
 * six that ignore them and, worse, a claim: a contrast bar over an unfiltered
 * view reads as "this is showing you {cs} vs {ctrl}" when it is showing you
 * every cell. So each control is offered only where the answer below it moves
 * when the control moves. The selection itself lives in App either way, so a
 * control that disappears on one tab still holds what you set on another.
 *
 * Derived by reading each component's props and what it does with them:
 *
 * - Overview, Cells, Composition, Markers take neither. They describe the whole
 *   object — Markers in particular tests *every* cluster one-vs-rest, so a
 *   single cell type is not a parameter of it.
 * - DEG table, Volcano, Enrichment take both: `useDE` is keyed on
 *   `ti|ctrl|cs` and nothing else.
 * - Methods takes both: the paragraph names the cell type and both sides.
 * - Gene expression takes both, but only once Group by leaves "Across cell
 *   types" — that is when `identities()` starts filtering to `ct` and the
 *   per-facet Δlog₂ label starts reading `ctrl`/`cs`.
 * - Gene sets takes the cell type: its own Group by can summarise the module
 *   score within one type. That switch is local to the card, so the select is
 *   offered whenever the tab is open rather than blinking in and out of a
 *   sticky bar as the user toggles something further down the page. No
 *   contrast — a module score is not a comparison.
 */
function needsOf(tab: TabId, groupBy: GroupBy): Needs {
  switch (tab) {
    case 'degs': case 'volcano': case 'enrich': case 'methods': return BOTH
    case 'expr': return groupBy === 'type' ? NOTHING : BOTH
    case 'sets': return { ct: true, contrast: false }
    default: return NOTHING
  }
}

export default function App() {
  const [src, setSrc] = useState<Source | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [openNote, setOpenNote] = useState<string | null>(null)

  // Cluster names are held here, not in the Source, because renaming is a user
  // edit: the Source stays exactly what the file said.
  const [types, setTypes] = useState<CellType[]>([])
  const [tab, setTab] = useState<TabId>('overview')
  const [ct, setCt] = useState('')
  // Each side of a comparison is a SET of conditions. One level on each is the
  // ordinary case and behaves exactly as it did; several pools them, which is
  // how a time course gets read as early versus late without the object being
  // re-exported under a coarser grouping.
  const [ctrl, setCtrl] = useState<string[]>([])
  const [cs, setCs] = useState<string[]>([])
  const [method, setMethod] = useState<Method>('wilcox')
  const [padjMax, setPadjMax] = useState(0.05)
  const [lfcMin, setLfcMin] = useState(thresholdFor('wilcox').lfc)

  // Which 2D embedding every view draws on. ONE choice for the whole studio: a
  // per-tab setting would let Cells show a UMAP while the feature plot beside it
  // shows a t-SNE, and the two would be read as one figure.
  const [embKey, setEmbKey] = useState('')

  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const [split, setSplit] = useState(true)
  const [plot, setPlot] = useState<PlotKind>('violin')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [cols, setCols] = useState(2)
  const [relative, setRelative] = useState(false)
  const [dotScale, setDotScale] = useState(true)
  const [genes, setGenes] = useState<string[]>([])

  // Bumped by the error boundary's Try again, and part of its key, so that one
  // click both rebuilds the view from current state and gives it a boundary that
  // has not caught anything yet. Nothing else reads it; it exists to be changed.
  const [attempt, setAttempt] = useState(0)

  const [palKey, setPalKey] = useState<PaletteKey>('npg')
  // Two-colour by default. A scale a reader can name in one clause — pale to
  // blue — is one they can read without going back to the bar for every mark,
  // and a dot plot asks them to judge dozens at a glance. mako, SCpubr's own
  // default, is one menu click away for anyone who wants a perceptual map.
  const [rampKey, setRampKey] = useState<RampKey>('blue')
  // The diverging choice is remembered separately from the sequential one.
  // They describe different quantities — a z-score has a meaningful zero and
  // raw expression does not — so a reader who picks blue-white-red for the
  // scaled dot plot should not find raw expression drawn on it, or lose their
  // diverging choice every time they toggle scaling off and back.
  const [rampDiv, setRampDiv] = useState<RampKey>('rdbu')
  // Figure options for the gene tab. Here rather than inside it so a trip to
  // Markers and back does not quietly restore a population the reader took out
  // and then keep drawing it.
  const [hiddenTypes, setHiddenTypes] = useState<Set<number>>(new Set())
  const [featureClip, setFeatureClip] = useState(0.99)
  const [cellBorders, setCellBorders] = useState(false)
  const [geneBusy, setGeneBusy] = useState(false)
  // Only the newest gene request may land: clicking through a marker table
  // faster than the file can answer must not leave an older panel on screen.
  const geneToken = useRef(0)

  function adopt(next: Source, defaultGenes: string[]) {
    setSrc(next)
    setTypes(next.types.map(t => ({ ...t })))
    setCt(next.types[0]?.name ?? '')
    setCtrl([next.d.conds[0]])
    setCs([next.d.conds[next.d.conds.length - 1]])
    setMethod('wilcox')
    setPadjMax(0.05)
    setLfcMin(thresholdFor('wilcox').lfc)
    setGroupBy('type')
    setPlot('violin')
    // Cell types are held by index, so carrying them across objects would hide
    // whichever populations happen to sit at those positions in the next one —
    // silently, since the figure would simply be missing cells nobody asked to
    // remove.
    setHiddenTypes(new Set())
    // The object's own default — what the lab chose when it was converted.
    setEmbKey(next.embeddings[0]?.key ?? '')
    setGenes(defaultGenes.filter(g => next.genes.includes(g)).slice(0, 4))
    setTab('overview')
    setOpenError(null)
  }

  const openDemo = (key: string) => {
    setLoading(true)
    // A frame, so the button's press state paints before the generator runs.
    setTimeout(() => {
      adopt(demoSource(key), ['Ascl1', 'Gfap', 'Mki67', 'Dcx'])
      setLoading(false)
    }, 0)
  }

  const openFile = async (file: File) => {
    setLoading(true)
    setOpenError(null)
    setOpenNote(null)
    try {
      // A collection is a zip whose index sits in its tail, so this costs one
      // small read and tells us which kind of file we have. Anything else is a
      // plain bundle and takes the path it always took.
      const index = await readCollectionIndex(file)
      const next = index
        ? await openCollection(file, index, (phase, done, total) =>
          setOpenNote(`${phase} — ${done} of ${total}`))
        : bundleSource(parseBundle(await file.arrayBuffer()))
      // Pick starting genes that exist rather than a fixed list that may not.
      // Through the object's naming, so these symbols still land on an object
      // whose matrix is indexed by accessions.
      const wanted = ['CD3D', 'MS4A1', 'LYZ', 'GNLY', 'PPBP', 'Ascl1', 'Gfap']
      const found = wanted.flatMap(g => next.names.match(g))
      const start = (found.length ? found : next.genes.slice(0, 4)).slice(0, 4)
      // Load them before the first render, so no view ever draws a gene the
      // object has not handed over yet.
      await next.ensure(start)
      adopt(next, start)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpenNote(null)
      setLoading(false)
    }
  }

  if (!src) {
    return <Landing onDemo={openDemo} onFile={openFile} error={openError} busy={loading}
      note={openNote} />
  }

  const d = src.d
  const ti = Math.max(0, types.findIndex(t => t.name === ct))
  const t = types[ti] ?? src.types[0]
  const design = designFor(src, ti, ctrl, cs)
  const blocked = !d.multi && NEEDS_CONTRAST.has(tab)

  /**
   * Choose the genes on screen.
   *
   * For a collection the values are still in the file, so they are fetched
   * before the selection is committed — the panel switches when it has
   * something to draw rather than flashing an empty violin. State therefore
   * never holds a gene the object cannot answer for.
   */
  const applyGenes = (next: string[]) => {
    if (!src.lazy) { setGenes(next); return }
    const token = ++geneToken.current
    setGeneBusy(true)
    src.ensure(next).then(() => {
      if (geneToken.current !== token) return
      setGenes(next)
      setGeneBusy(false)
    }, (e: unknown) => {
      if (geneToken.current !== token) return
      setGeneBusy(false)
      setOpenError(e instanceof Error ? e.message : String(e))
    })
  }

  const pickGene = (g: string) => {
    applyGenes(mergeGenes(genes, [g]))
    setTab('expr')
  }
  /** Switching test switches the scale, so the default cutoff has to follow. */
  const changeMethod = (m: Method) => {
    setMethod(m)
    setPadjMax(0.05)
    setLfcMin(thresholdFor(m).lfc)
  }

  const statsProps: StatsProps = {
    src, t, ti, ctrl, cs, method, padjMax, lfcMin,
    running: false, computed: true,
    onMethod: changeMethod,
    onRun: () => {},
    onPadj: setPadjMax,
    onLfc: setLfcMin,
    onPickGene: pickGene,
  }

  const chip = !d.multi
    ? { cls: 'mute', text: `Single condition · ${d.samples.length} sample${d.samples.length > 1 ? 's' : ''}` }
    : ctrl === cs ? { cls: 'bad', text: 'Pick two different groups' }
    : method === 'wilcox' ? { cls: 'ok', text: 'Wilcoxon · per cell · no replicates required' }
    : design.pbOK ? { cls: 'ok', text: `Pseudobulk matrix · ${design.n0} vs ${design.n1}` }
    : { cls: 'bad', text: `Pseudobulk needs > 3 per group — have ${design.n0} vs ${design.n1}` }

  // A blocked tab shows an explanation, not a view, so nothing above it is a
  // parameter of anything.
  const needs = blocked ? NOTHING : needsOf(tab, groupBy)

  // The embedding selector belongs where cells are actually drawn on it, and
  // nowhere else — over a violin panel or a DEG table it would be a control with
  // no visible effect. The CHOICE still lives here, so it survives the trip
  // through those tabs; only the select comes and goes.
  const drawsCells = !blocked
    && (tab === 'cells' || tab === 'sets' || (tab === 'expr' && plot === 'feature'))
  // One entry is not a choice, so an object with a single embedding shows no
  // control at all rather than a menu that cannot change anything.
  const showEmb = drawsCells && src.embeddings.length > 1
  const emb = src.embeddings.find(e => e.key === embKey) ?? src.embeddings[0]

  // The gene readout is progress on a request already in flight, so it outlives
  // the controls: keep the bar for it even where no selector belongs.
  const showBar = needs.ct || needs.contrast || geneBusy || showEmb

  // Where a broken view offers to send you. Overview describes the object and
  // reads no part of the selection, so it cannot be broken by whatever broke the
  // view you are leaving — and it needs no contrast, so it is never the blocked
  // tab either. From Overview itself, Cells, on the same reasoning.
  const escapeTo: TabId = tab === 'overview' ? 'cells' : 'overview'

  const chipStyle = chip.cls === 'ok'
    ? { background: 'var(--good-soft)', color: 'var(--good)', borderColor: 'color-mix(in srgb, var(--good) 25%, transparent)' }
    : chip.cls === 'bad'
      ? { background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'var(--warn-line)' }
      : { background: 'var(--surface)', color: 'var(--ink-3)', borderColor: 'var(--line-2)' }

  return (
    <>
      <header className="sticky top-0 z-30" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div className="wrap">
          <div className="flex items-center gap-3.5 pb-2.5 pt-3">
            <button
              className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] border-0 text-xs font-bold text-white"
              style={{ background: 'linear-gradient(150deg, var(--accent), #a855f7)' }}
              title="Close this object and open another"
              onClick={() => setSrc(null)}
            >sc</button>
            <div>
              <div className="text-[15px] font-semibold tracking-[-0.01em]">scRNA-seq Studio</div>
              {/* Not "read-only explorer" any more: markers, differential
                  expression, enrichment and module scores are all computed
                  here. What it still does not do is re-run the pipeline —
                  no clustering, no integration, no normalisation. */}
              <div className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                computes on a prepared object · your pipeline is not re-run
              </div>
            </div>
            {/* min-w-0 is what lets a long project name wrap instead of overflowing. */}
            <div className="min-w-0 flex-1 text-right">
              <div className="text-[13px] font-semibold" style={{ overflowWrap: 'anywhere' }}>
                {src.meta.label}
                {src.meta.isDemo && <span className="badge badge-none ml-2">demo</span>}
              </div>
              <div className="mono text-[11px]" style={{ color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
                {src.meta.source}
              </div>
            </div>
          </div>
          <div className="flex gap-0.5 overflow-x-auto" role="tablist">
            {TABS.map(([id, label]) =>
              id === 'div' ? (
                <div key="div" aria-hidden className="mx-1.5 my-2 w-px flex-none" style={{ background: 'var(--line-2)' }} />
              ) : (
                <button
                  key={id} role="tab" aria-selected={tab === id}
                  className="whitespace-nowrap rounded-t-lg border-0 bg-transparent px-[11px] py-2 text-[13px] font-medium"
                  style={{
                    color: tab === id ? 'var(--accent-ink)' : 'var(--ink-3)',
                    borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
                    opacity: !d.multi && NEEDS_CONTRAST.has(id) ? 0.45 : 1,
                    transition: 'color 160ms ease',
                  }}
                  onClick={() => setTab(id)}
                >{label}</button>
              ))}
          </div>
        </div>
      </header>

      {showBar && (
        <div className="sticky z-20" style={{ top: 96, background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}>
          <div className="wrap flex flex-wrap items-center gap-2.5 py-2.5">
            {needs.ct && (
              <label className="flex items-center gap-1.5">
                <span className="glabel">Cell type</span>
                <select className="sel max-w-[240px]" value={ct} onChange={e => setCt(e.target.value)}>
                  {types.map(x => <option key={x.key}>{x.name}</option>)}
                </select>
              </label>
            )}
            {showEmb && (
              <>
                {needs.ct && <div className="gsep" />}
                <label className="flex items-center gap-1.5">
                  <span className="glabel">Embedding</span>
                  <select className="sel max-w-[200px]" value={emb.key}
                    onChange={e => setEmbKey(e.target.value)}>
                    {src.embeddings.map(x => <option key={x.key}>{x.key}</option>)}
                  </select>
                </label>
              </>
            )}
            {needs.contrast && d.multi && (
              <>
                {(needs.ct || showEmb) && <div className="gsep" />}
                <CondPicker label="Control" all={d.conds} value={ctrl} other={cs}
                  onChange={setCtrl} />
                <CondPicker label="Compare" all={d.conds} value={cs} other={ctrl}
                  onChange={setCs} />
              </>
            )}
            {geneBusy && (
              <span className="ml-auto text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                reading gene…
              </span>
            )}
            {/* The badge reads the contrast, so it travels with it — over Cells
                or Composition it would describe a test nothing on screen ran. */}
            {needs.contrast && (
              <span
                className={`${geneBusy ? '' : 'ml-auto '}inline-flex items-center gap-[7px] rounded-full px-[11px] py-1 text-[11.5px] font-semibold`}
                style={{ ...chipStyle, borderWidth: 1, borderStyle: 'solid' }}
              >
                <i className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
                {chip.text}
              </span>
            )}
          </div>
        </div>
      )}

      <main className="pb-16 pt-5">
        <div className="wrap">
          {/*
            One tab's work, and the only thing a bad render is allowed to take
            with it. Boundary.tsx carries the argument for why it sits HERE and
            not around <App/>: the cache and the running passes are keyed by
            `src`, which this component holds, so unmounting a view costs the
            view and unmounting App costs the four minutes.

            The key is the reset, and it has two parts. `tab` means navigating
            builds a fresh boundary, so a caught error cannot outlive the view it
            came from — you leave a broken tab and come back to one that tries
            again. `attempt` is Try again: the click bumps it, App re-renders, the
            children below are derived afresh from whatever the state says NOW,
            and they get a boundary with no error on it. Changing a selector in
            the bar above deliberately does not reset anything, so a broken view
            does not flicker back and forth while you are reaching for the tab bar.
          */}
          <ViewBoundary
            key={`${tab}#${attempt}`}
            what={`${LABEL.get(tab) ?? tab} view`}
            escape={{ label: `Go to ${LABEL.get(escapeTo)}`, go: () => setTab(escapeTo) }}
            onRetry={() => setAttempt(a => a + 1)}
            note={<>
              Nothing else has moved. <b>{src.meta.label}</b> is still open, everything
              already computed is still in hand, and a pass still running is still
              running — leaving a view has never ended one. Every other tab above
              works; this one has a bug.
            </>}
          >
            {crashTab() === tab ? <CrashOnRender tab={tab} /> : blocked ? (
              <Empty title="This object has one condition, so there is nothing to contrast">
                Differential expression between groups needs at least two. What is still available:{' '}
                <b>Markers</b> tests every cluster against the rest, and <b>Gene expression</b>{' '}
                searches any gene across every cell type.
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button className="btn" onClick={() => setTab('markers')}>Go to Markers</button>
                  <button className="btn btn-primary" onClick={() => setTab('expr')}>Search a gene</button>
                </div>
              </Empty>
            ) : tab === 'overview' ? (
              <Overview src={src} types={types} palKey={palKey} rampKey={rampKey}
                onPal={setPalKey} onRamp={setRampKey} />
            ) : tab === 'cells' ? (
              <Cells src={src} types={types} gene={genes[genes.length - 1] ?? ''} emb={emb}
                colorBy={colorBy}
                split={split} palKey={palKey} rampKey={rampKey}
                onColorBy={setColorBy} onSplit={setSplit} />
            ) : tab === 'composition' ? (
              <Composition d={d} types={types} palKey={palKey} />
            ) : tab === 'markers' ? (
              <Markers src={src} types={types} palKey={palKey} onPickGene={pickGene}
                onRename={(i, name) => {
                  setTypes(prev => {
                    const next = [...prev]
                    const was = next[i].name
                    next[i] = { ...next[i], name: name.trim() || next[i].key }
                    if (ct === was) setCt(next[i].name)
                    return next
                  })
                }} />
            ) : tab === 'degs' ? (
              <DEGTable {...statsProps} />
            ) : tab === 'volcano' ? (
              <Volcano {...statsProps} />
            ) : tab === 'enrich' ? (
              <ContrastFrame {...statsProps}>
                {rows => (
                  <Enrichment rows={rows} threshold={{ padj: padjMax, lfc: lfcMin }}
                    genes={src.genes} ctrl={ctrl} cs={cs}
                    label={`${cs} vs ${ctrl} · ${ct}`}
                    palKey={palKey} onPickGene={pickGene} />
                )}
              </ContrastFrame>
            ) : tab === 'expr' ? (
              <GeneExpression
                src={src} types={types} ct={ct} ctrl={ctrl} cs={cs} genes={genes} emb={emb}
                plot={plot} groupBy={groupBy} cols={cols} relative={relative} dotScale={dotScale}
                palKey={palKey} rampKey={rampKey}
                hidden={hiddenTypes} clip={featureClip} borders={cellBorders}
                rampDiv={rampDiv} onRampDiv={setRampDiv}
                onGenes={applyGenes} onPlot={setPlot} onGroupBy={setGroupBy} onCols={setCols}
                onRelative={setRelative} onDotScale={setDotScale} onRamp={setRampKey}
                onHidden={setHiddenTypes} onClip={setFeatureClip} onBorders={setCellBorders} />
            ) : tab === 'sets' ? (
              <GeneSets src={src} types={types} ct={ct} emb={emb} palKey={palKey} rampKey={rampKey}
                onPickGene={pickGene} />
            ) : (
              <Methods src={src} types={types} ti={ti} ctrl={ctrl} cs={cs} method={method}
                padjMax={padjMax} lfcMin={lfcMin} />
            )}
          </ViewBoundary>
        </div>
      </main>
    </>
  )
}
