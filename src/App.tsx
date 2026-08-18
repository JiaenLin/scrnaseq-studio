import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellType, ColorBy, DEView, GroupBy, Method, PlotKind, TabId } from './types.ts'
import { parseBundle } from './lib/bundle.ts'
import { readCollectionIndex } from './lib/collection.ts'
import { openCollection } from './lib/collection-source.ts'
import { bundleSource, condKey, demoSource, type Source } from './lib/source.ts'
import { condLabel, designFor, sameOrOverlapping, thresholdFor } from './lib/stats.ts'
import { mergeGenes } from './lib/genes.ts'
import { withCondOrder } from './lib/order.ts'
import type { PaletteKey, RampKey } from './lib/palette.ts'
import CondPicker from './components/CondPicker.tsx'
import Landing from './components/Landing.tsx'
import Overview from './components/Overview.tsx'
import Cells from './components/Cells.tsx'
import Composition from './components/Composition.tsx'
import Markers from './components/Markers.tsx'
import { Differential, type StatsProps } from './components/Stats.tsx'
import Enrichment from './components/Enrichment.tsx'
import GeneExpression from './components/GeneExpression.tsx'
import GeneSets from './components/GeneSets.tsx'
import Methods from './components/Methods.tsx'
import ViewBoundary from './components/Boundary.tsx'
import ViewMenu from './components/ViewMenu.tsx'
import GroupOrder from './components/GroupOrder.tsx'
import { detectSpecies, type Detection, type Species } from './lib/species.ts'
import { defaultSources, useGeneSets } from './lib/genesets.ts'
import type { Collection } from './lib/msigdb.ts'
import { Empty } from './components/Ui.tsx'

/**
 * The tabs, in two named groups.
 *
 * This was ten flat items separated by a `'div'` pseudo-tab that rendered as an
 * unlabelled hairline — one pixel carrying the whole information architecture,
 * and `aria-hidden`, so a screen reader got ten peers with no structure at all.
 *
 * The groups are the real distinction: the first three DESCRIBE the object as it
 * arrived, the rest COMPUTE on it. Methods sits outside both because it is the
 * document, not a view.
 */
const GROUPS: { name: string; tabs: [TabId, string][] }[] = [
  {
    name: 'Object',
    tabs: [['overview', 'Overview'], ['cells', 'Cells'], ['composition', 'Composition']],
  },
  {
    name: 'Analysis',
    tabs: [
      ['markers', 'Markers'], ['de', 'Differential expression'],
      ['expr', 'Gene expression'], ['sets', 'Gene sets'],
    ],
  },
  { name: '', tabs: [['methods', 'Methods']] },
]

const TABS: [TabId, string][] = GROUPS.flatMap(g => g.tabs)

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
const NEEDS_CONTRAST = new Set<TabId>(['de'])

/** Tests that do not go through the gated Wilcoxon pass, so have nothing to run. */
const NEEDS_RUN_HIDDEN = new Set<Method>(['pseudobulk'])

/** What a tab reads out of the shared selection above it. */
interface Needs {
  /** The Cell type select changes what this tab answers. */
  ct: boolean
  /** Control / Compare — and therefore the design badge — change what it answers. */
  contrast: boolean
  /**
   * This tab spends a pass, so the Run button belongs above it.
   *
   * Separate from `contrast` because Methods reads both sides — the paragraph
   * names them — and runs nothing. It was offering a Run button whose only
   * effect was on three tabs the reader could not see.
   */
  runs: boolean
  /**
   * This tab reads the gene-set library, so which organism's sets are loaded
   * changes its answer. A fact about the object, like the embedding, so the
   * control sits in this bar rather than on the card.
   */
  library: boolean
}

const NOTHING: Needs = { ct: false, contrast: false, runs: false, library: false }
const BOTH: Needs = { ct: true, contrast: true, runs: true, library: true }

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
 * - Differential expression takes both: `useDE` is keyed on `ti|ctrl|cs` and
 *   nothing else, and all three of its views read that one result.
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
function needsOf(tab: TabId): Needs {
  switch (tab) {
    case 'de': return BOTH
    // Both sides, because the paragraph names them — but no Run: this tab
    // reads what the others computed and never starts a pass of its own.
    case 'methods': return { ct: true, contrast: true, runs: false, library: true }
    // Nothing. Gene expression picks its own cell type beside the figures that
    // use it, and it is not a comparison — a Control / Compare pair over it read
    // as a claim that the panels below were showing that contrast.
    case 'expr': return NOTHING
    case 'sets': return { ct: true, contrast: false, runs: false, library: true }
    default: return NOTHING
  }
}

export default function App() {
  const [opened, setOpened] = useState<Source | null>(null)
  /**
   * The order the reader wants the groups drawn in, by name.
   *
   * Empty means the object's own order, which is what every figure has always
   * used and what it goes back to. Held here rather than in the Source for the
   * same reason cluster names are: the Source stays exactly what the file said,
   * and this is a user's view of it.
   */
  const [condOrder, setCondOrder] = useState<string[]>([])
  // One rewrite of `d.conds` — see lib/order.ts. Memoised so an unchanged order
  // hands back the identical Source and Dataset, which is what the caches keyed
  // on them require.
  const src = useMemo(
    () => (opened ? withCondOrder(opened, condOrder) : null), [opened, condOrder])
  const [openError, setOpenError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [openNote, setOpenNote] = useState<string | null>(null)

  // Cluster names are held here, not in the Source, because renaming is a user
  // edit: the Source stays exactly what the file said.
  const [types, setTypes] = useState<CellType[]>([])
  const [tab, setTab] = useState<TabId>('overview')
  // Which rendering of the contrast is on screen. In App so it survives a trip
  // to Markers, like every other view choice — and so the boundary key can name
  // it, which is what keeps a crash in the volcano from blanking the table.
  const [deView, setDeView] = useState<DEView>('table')
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
  // Which contrast the reader has actually asked for. Up here with the other
  // state rather than beside the props it feeds, because everything below the
  // "no object open" return is conditional and a hook cannot be.
  const [deRan, setDeRan] = useState<string | null>(null)
  // Markers' gate and its scope, for the same reason `deRan` is here: leaving
  // the tab and coming back used to reset them, so a reader who had already
  // spent four minutes was shown the gate again over an answer sitting in the
  // cache. The pass is keyed on the object, not the view.
  const [markersGo, setMarkersGo] = useState(false)
  const [markersWant, setMarkersWant] = useState<Set<number>>(new Set())
  // Which gene list the reader has asked to score, joined. Here rather than in
  // the tab so it survives a trip to Markers, like every other gate.
  const [scoreRan, setScoreRan] = useState<string | null>(null)

  /**
   * Which organism's gene sets to use, and which collections of them.
   *
   * Detected from the object when it opens, and overridable — MSigDB spells the
   * same gene GFAP for human and Gfap for mouse, so the wrong library does not
   * error, it silently returns nothing. `speciesWhy` carries the evidence the
   * guess was made on, because a reader who disagrees needs to see what it was
   * based on before they change it.
   */
  // null until an object is open and has been read. It used to start at
  // 'human', which meant every mouse object downloaded 2.2 MB of the human
  // library before `adopt` had a chance to say otherwise — the effect below
  // fires on the initial value, not on the eventual one.
  const [species, setSpecies] = useState<Species | null>(null)
  const changeSpecies = (next: Species) => { setSpecies(next); setSrcs([]) }
  const [detected, setDetected] = useState<Detection | null>(null)
  const [srcs, setSrcs] = useState<string[]>([])

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
  // A gene read that fails on an OPEN object needs its own surface. It used to
  // write `openError`, which only Landing renders — so the request simply
  // stopped, the bar cleared, and the reader was told nothing at all.
  const [geneError, setGeneError] = useState<string | null>(null)
  // Only the newest gene request may land: clicking through a marker table
  // faster than the file can answer must not leave an older panel on screen.
  const geneToken = useRef(0)

  // Above the "no object open" return, because a hook cannot be conditional.
  // Costs one small manifest fetch on load; the collections themselves are only
  // fetched once a species has some enabled.
  /**
   * Gene sets the reader loaded from their own GMT files.
   *
   * Held here rather than in either tab, for the reason every other library
   * choice is: Enrichment and Gene sets must be looking at the same library, or
   * a term scored on one tab cannot be tested on the other. Not persisted —
   * this studio keeps nothing between sessions, and a set library silently
   * restored from storage is a claim about provenance it cannot support.
   */
  const [customSets, setCustomSets] = useState<Collection[]>([])
  const lib = useGeneSets(species, srcs, customSets)

  // The species' own defaults, once the manifest says what it has. Written only
  // when nothing is chosen, so this cannot fight a reader who has just turned a
  // collection off.
  useEffect(() => {
    if (!lib.manifest || !species || srcs.length) return
    const d = defaultSources(lib.manifest, species)
    if (d.length) setSrcs(d)
  }, [lib.manifest, species, srcs.length])

  function adopt(next: Source) {
    setOpened(next)
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
    // Nothing chosen. Which gene to look at is the reader's question, and a
    // tab that opens on four of them has answered it for them — wrongly,
    // whenever the object is not the one the list was written for.
    setGenes([])
    setTab('overview')
    setOpenError(null)
    setGeneError(null)
    // `deKey` is a cell-type INDEX and a set of level names — it carries no
    // object identity. Two collections that share those (the same panel
    // exported twice, a re-run of one experiment) would otherwise arrive
    // already armed, and the contrast tabs would start a two-minute pass
    // nobody pressed Run for.
    setDeRan(null)
    // An object held in memory answers in milliseconds, so asking permission
    // for it would be a dialog in front of an instant result. A collection is
    // minutes, and opening a tab is not consent to spend them.
    setMarkersGo(!next.lazy)
    setMarkersWant(new Set())
    setScoreRan(null)
    const det = detectSpecies(next.names.display, next.names.other)
    setSpecies(det.species)
    setDetected(det)
    // Cleared rather than defaulted here: the manifest may not have arrived,
    // and the effect below fills them in for whichever species this turns out
    // to be. Carrying the previous object's choice across would be worse — the
    // collections differ by species and mouse has no KEGG.
    setSrcs([])
    // The next object's levels are its own; an order named for the last one's
    // would place whichever of them happen to share a name and leave the rest.
    setCondOrder([])
  }

  const openDemo = (key: string) => {
    setLoading(true)
    // A frame, so the button's press state paints before the generator runs.
    setTimeout(() => {
      // The demos start empty too. Their four genes were genuinely apt — Ascl1,
      // Gfap, Mki67, Dcx for a neurogenesis time course — but a tab that
      // sometimes opens with genes chosen and sometimes does not is a worse
      // rule than one that never chooses.
      adopt(demoSource(key))
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
      /**
       * No genes are chosen for the reader.
       *
       * This used to open every object on four genes from a fixed list —
       * CD3D, MS4A1, LYZ, GNLY, PPBP, Ascl1, Gfap — whichever of them the
       * object happened to contain. They were a PBMC panel and a mouse
       * neurogenesis pair, so on anything else they were four genes nobody
       * asked about, presented as though the studio had chosen them for this
       * object. On a heart atlas that is Cd3d, Ms4a1, Ppbp and Ascl1: a figure
       * that looks like a result and is not one.
       *
       * The Gene expression tab already says "Search for a gene above", which
       * is the honest state for a tab whose whole question is which gene.
       */
      adopt(next)
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
    setGeneError(null)
    src.ensure(next).then(() => {
      if (geneToken.current !== token) return
      setGenes(next)
      setGeneBusy(false)
    }, (e: unknown) => {
      if (geneToken.current !== token) return
      setGeneBusy(false)
      setGeneError(e instanceof Error ? e.message : String(e))
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

  // Which contrast the reader has actually asked for. Held here rather than in
  // a tab because the DEG table, the volcano and enrichment are three views of
  // ONE pass — pressing run on any of them has to satisfy the other two, and
  // changing a group has to un-ask all three at once.
  //
  // An object in memory answers instantly, so it is always armed: a Run button
  // in front of a result that is already there is a button that does nothing
  // visible, and readers learn to press it without reading it.
  const deKey = `${ti}|${condKey(ctrl)}|${condKey(cs)}`
  const armed = !src.lazy || deRan === deKey

  const statsProps: StatsProps = {
    src, t, ti, ctrl, cs, method, padjMax, lfcMin,
    running: false, computed: armed,
    onMethod: changeMethod,
    onRun: () => setDeRan(deKey),
    onPadj: setPadjMax,
    onLfc: setLfcMin,
    onPickGene: pickGene,
  }

  // Short enough to sit on one line beside everything else in the bar. The
  // sentence each one used to be is in the tooltip, and the argument behind it
  // is in Methods.
  const chip: { cls: string; text: string; title: string } = !d.multi
    ? { cls: 'mute', text: `1 condition · ${d.samples.length} sample${d.samples.length > 1 ? 's' : ''}`,
      title: 'This object has one condition, so there is no contrast to run' }
    // Two arrays are never `===`, so this branch used to be unreachable and the
    // overlapping-groups case reached the tab body before anything said why.
    : sameOrOverlapping(ctrl, cs)
      ? { cls: 'bad', text: 'Groups overlap', title: 'A level on both sides puts the same cells in both groups' }
    : method === 'wilcox'
      ? { cls: 'ok', text: 'Wilcoxon · per cell', title: 'Rank-sum across cells, as in Seurat FindMarkers — no replicates required' }
    : design.pbOK
      ? { cls: 'ok', text: `Pseudobulk · ${design.n0} v ${design.n1}`, title: `${design.n0} and ${design.n1} samples clear the cell floor` }
    : { cls: 'bad', text: `Pseudobulk · ${design.n0} v ${design.n1}`,
      title: `Pseudobulk needs more than 3 samples per group — this has ${design.n0} and ${design.n1}` }

  // A blocked tab shows an explanation, not a view, so nothing above it is a
  // parameter of anything.
  const needs = blocked ? NOTHING : needsOf(tab)
  /**
   * The gene-set library, only where a gene set is on screen.
   *
   * Differential expression is three views of one pass and only the third
   * tests against the library, so on the table and the volcano this select
   * changed nothing — while costing 161px of a row that was truncating the
   * group names to "aged_c…" to make room for it. The CHOICE still lives in
   * App, so switching to Enrichment finds whatever was set on the Gene sets
   * tab; only the control comes and goes.
   */
  const showLib = needs.library && (tab !== 'de' || deView === 'enrich')

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
          {/**
            * One identity line.
            *
            * This was two stacked columns — product name over a strapline on
            * the left, object name over a mono source line on the right — and
            * on a real object it fell apart. `developing_mouse_nervous_system`
            * is thirty-one unbroken characters and its source line repeats the
            * name twice more in ~100 characters of monospace, so at the width
            * people actually work at the right column outgrew the left and the
            * two competed for the same job: saying what you are looking at.
            *
            * So: the mark that closes the object, the product name once and
            * quietly, then the object — which is the fact on this screen and
            * gets the weight. The source detail is provenance and Overview has
            * a whole table of it, so here it is the tooltip.
            */}
          <div className="flex items-center gap-2.5 py-2">
            <button
              // Ink ground, surface text — the pair inverts together, so the
              // mark stays legible in either theme. `text-white` on --ink was
              // white on near-white once the page went dark.
              className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[--r-sm] border-0 tx-micro font-bold"
              style={{ background: 'var(--ink)', color: 'var(--surface)' }}
              title="Close this object and open another"
              onClick={() => setOpened(null)}
            >sc</button>
            <span className="flex-none tx-small" style={{ color: 'var(--ink-3)' }}>
              scRNA-seq Studio
            </span>
            <span aria-hidden className="flex-none" style={{ color: 'var(--ink-3)' }}>/</span>
            <span className="min-w-0 truncate tx-body font-semibold" title={src.meta.source}>
              {src.meta.label}
            </span>
            {src.meta.isDemo && <span className="badge badge-none flex-none">demo</span>}
          </div>
          <div className="flex items-end gap-6 overflow-x-auto" role="tablist"
            aria-label="Views of this object">
            {GROUPS.map(g => (
              // The group name is not drawn. Two uppercase words sitting above
              // the tabs read as two more tabs — a row of labels competing with
              // the row it labels — and the gap between groups already says the
              // same thing without spending a line on it. The name stays as the
              // group's accessible name, so the structure survives for a reader
              // who cannot see the spacing.
              <div key={g.name || 'doc'} role="group" aria-label={g.name || 'Document'}
                className="flex flex-none">
                <div className="flex gap-0.5">
                  {g.tabs.map(([id, label]) => {
                    const off = !d.multi && NEEDS_CONTRAST.has(id)
                    return (
                      <button
                        key={id} role="tab" aria-selected={tab === id}
                        aria-controls={`panel-${id}`} id={`tab-${id}`}
                        // Dimmed-and-clickable was an invitation to a dead end:
                        // the object cannot answer this, so the control says no
                        // rather than taking you somewhere that explains it did.
                        disabled={off}
                        title={off
                          ? 'This object has one condition, so there is nothing to contrast'
                          : undefined}
                        className="whitespace-nowrap border-0 bg-transparent px-[11px] py-1.5 tx-body font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                          color: tab === id ? 'var(--ink)' : 'var(--ink-3)',
                          borderBottom: `2px solid ${tab === id ? 'var(--sel)' : 'transparent'}`,
                          transition: 'color var(--d-press) ease',
                        }}
                        onClick={() => setTab(id)}
                      >{label}</button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/**
          * The control bar, INSIDE the sticky header rather than a second
          * sticky layer under it.
          *
          * It used to be its own `sticky` element pinned at a hard-coded
          * `top: 96` that had to match the header's measured height, and it
          * appeared and disappeared with the tab — so the page jumped 54px
          * vertically on most navigations and the two layers could overlap
          * whenever a long project name wrapped. One sticky block cannot
          * misalign with itself, and one that is always there cannot jump.
          *
          * A fixed height, and one order that never changes: what is being
          * looked at, then what it is being compared with, then the action
          * that completes them. Controls a tab does not use are left out —
          * a Control/Compare pair over an unfiltered view is not clutter, it
          * is a claim that the figure below is showing that contrast.
          */}
        <div style={{ background: 'var(--sunk)', borderTop: '1px solid var(--line)' }}>
          <div className="wrap flex items-center gap-2.5" style={{ height: 42 }}>
            {/**
              * The scroller is this inner group ONLY.
              *
              * `overflow-x-auto` sat on the whole bar, and an overflow on one
              * axis makes the other a clipping context too — so the Figure
              * style popover, anchored inside it, lost 187px of itself to a
              * 46px-tall strip. The controls still scroll when they have to;
              * the things that open menus are outside the box that clips.
              */}
            {/**
              * The controls SHRINK; they do not scroll away.
              *
              * They were `flex-none` inside a scroller, which on a real object
              * meant they never gave way: a cell type called "Cardiomyocyte/
              * Working cardiomyocyte EXCLUDED" plus two long group names simply
              * overflowed, and the first thing pushed out of sight was Run —
              * the button the whole row exists to reach. A select truncates its
              * own text with an ellipsis and every one of these carries a title,
              * so shrinking costs a few characters and scrolling cost the
              * action.
              *
              * The scroller stays as the last resort for a genuinely narrow
              * window, after everything has already given what it can.
              */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto py-2">
            {needs.ct && (
              // `flex-1`, and a floor. Sized to its own content this claimed
              // 146px of a squeezed row while the group pickers sat on their
              // minimum — the widest appetite winning is not the same as the
              // most important control winning. The three controls that hold a
              // NAME now share what is left, and none of them goes below a
              // width a name can be read at.
              <label className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="glabel flex-none">Cell type</span>
                <select className="sel min-w-0 flex-1" style={{ minWidth: 120, maxWidth: 260 }}
                  title={ct}
                  value={ct} onChange={e => setCt(e.target.value)}>
                  {types.map(x => <option key={x.key}>{x.name}</option>)}
                </select>
              </label>
            )}
            {showEmb && (
              <>
                {needs.ct && <div className="gsep" />}
                <label className="flex min-w-0 items-center gap-1.5">
                  <span className="glabel flex-none">Embedding</span>
                  <select className="sel min-w-0 flex-1" style={{ maxWidth: 170 }} value={emb.key}
                    onChange={e => setEmbKey(e.target.value)}>
                    {src.embeddings.map(x => <option key={x.key}>{x.key}</option>)}
                  </select>
                </label>
              </>
            )}
            {showLib && (
              <>
                {(needs.ct || showEmb) && <div className="gsep" />}
                <label className="flex flex-none items-center gap-1.5">
                  <span className="glabel">Gene sets</span>
                  <select
                    className="sel flex-none" value={species ?? ''}
                    aria-label="Species for the gene set library"
                    title={detected ? `Detected: ${detected.why}` : undefined}
                    onChange={e => changeSpecies(e.target.value as Species)}
                  >
                    {Object.entries(lib.manifest?.species ?? {}).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                    {/* Before the manifest lands there is one option, so the
                        select shows the detected species rather than blank. */}
                    {!lib.manifest && species && <option value={species}>{species}</option>}
                  </select>
                </label>
              </>
            )}
            {needs.contrast && d.multi && (
              <>
                {(needs.ct || showEmb || showLib) && <div className="gsep" />}
                {/* One contrast, drawn as one: CONTROL [a] VS [b]. Two
                    uppercase nouns read as two unrelated pickers and cost 63px
                    that the names themselves needed. */}
                <CondPicker label="Control" all={d.conds} value={ctrl} other={cs}
                  onChange={setCtrl} />
                <CondPicker label="Compare" lead="vs" all={d.conds} value={cs} other={ctrl}
                  onChange={setCs} />
                {/* The action belongs at the end of the decision it completes:
                    cell type, control, compare, run. */}
                {needs.runs && !armed && !NEEDS_RUN_HIDDEN.has(method) && (
                  <button className="btn btn-primary btn-sm flex-none"
                    onClick={() => setDeRan(deKey)}>Run</button>
                )}
              </>
            )}

            </div>

            <span className="flex flex-none items-center gap-2.5">
              {geneBusy && (
                <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>reading gene…</span>
              )}
              {!geneBusy && geneError && (
                <span role="alert" className="truncate tx-micro font-semibold"
                  style={{ color: 'var(--warn)', maxWidth: 340 }} title={geneError}>
                  Could not read that gene — {geneError}
                </span>
              )}
              {/* The badge reads the contrast, so it travels with it — over
                  Cells or Composition it would describe a test nothing ran. */}
              {needs.contrast && (
                <span
                  className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] py-1 tx-micro font-semibold"
                  style={{ ...chipStyle, borderWidth: 1, borderStyle: 'solid' }}
                  title={chip.title}
                >
                  <i className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
                  {chip.text}
                </span>
              )}
              {/* Only where there is an order to change: one group has no
                  arrangement, and a menu that cannot do anything is worse than
                  no menu. */}
              {d.conds.length > 1 && (
                <GroupOrder conds={d.conds} custom={condOrder.length > 0} palKey={palKey}
                  onChange={setCondOrder} onReset={() => setCondOrder([])} />
              )}
              <ViewMenu palKey={palKey} rampKey={rampKey} onPal={setPalKey} onRamp={setRampKey} />
            </span>
          </div>
        </div>
      </header>

      <main className="pb-16 pt-5" id={`panel-${tab}`} role="tabpanel"
        aria-labelledby={`tab-${tab}`} tabIndex={-1}>
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
            // The inner view is part of the key, so a fault in the volcano
            // costs the volcano and not the table beside it.
            key={`${tab}:${tab === 'de' ? deView : ''}#${attempt}`}
            what={`${LABEL.get(tab) ?? tab} view`}
            escape={{ label: `Go to ${LABEL.get(escapeTo)}`, go: () => setTab(escapeTo) }}
            onRetry={() => setAttempt(a => a + 1)}
            note={<>
              Nothing else moved. <b>{src.meta.label}</b> is still open, and a pass still
              running is still running.
            </>}
          >
            {crashTab() === tab ? <CrashOnRender tab={tab} /> : blocked ? (
              <Empty title="One condition, so there is nothing to contrast">
                Markers and gene search work on any object.
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button className="btn" onClick={() => setTab('markers')}>Go to Markers</button>
                  <button className="btn btn-primary" onClick={() => setTab('expr')}>Search a gene</button>
                </div>
              </Empty>
            ) : tab === 'overview' ? (
              <Overview src={src} types={types} palKey={palKey} />
            ) : tab === 'cells' ? (
              <Cells src={src} types={types} emb={emb}
                colorBy={colorBy}
                split={split} palKey={palKey} rampKey={rampKey}
                onColorBy={setColorBy} onSplit={setSplit} />
            ) : tab === 'composition' ? (
              <Composition d={d} types={types} palKey={palKey} />
            ) : tab === 'markers' ? (
              <Markers src={src} types={types} palKey={palKey} onPickGene={pickGene}
                go={markersGo} want={markersWant}
                onGo={setMarkersGo} onWant={setMarkersWant}
                onRename={(i, name) => {
                  setTypes(prev => {
                    const next = [...prev]
                    const was = next[i].name
                    next[i] = { ...next[i], name: name.trim() || next[i].key }
                    if (ct === was) setCt(next[i].name)
                    return next
                  })
                }} />
            ) : tab === 'de' ? (
              <Differential {...statsProps} view={deView} onView={setDeView}
                enrichment={rows => (
                  <Enrichment rows={rows} threshold={{ padj: padjMax, lfc: lfcMin }}
                    ctrl={ctrl} cs={cs} background={src.genes}
                    lib={lib} species={species ?? 'human'} sources={srcs} onSources={setSrcs}
                    customSets={customSets} onCustomSets={setCustomSets}
                    // condLabel, not the raw arrays — those join on a comma, so
                    // a pooled side read "6h,12h vs 0h" here and "6h + 12h vs
                    // 0h" on every other figure in the same session.
                    label={`${condLabel(cs)} vs ${condLabel(ctrl)} · ${ct}`}
                    detected={detected} onPickGene={pickGene} />
                )} />
            ) : tab === 'expr' ? (
              <GeneExpression
                src={src} types={types} ctrl={ctrl} cs={cs} genes={genes} emb={emb}
                plot={plot} groupBy={groupBy} cols={cols} relative={relative} dotScale={dotScale}
                palKey={palKey} rampKey={rampKey}
                hidden={hiddenTypes} clip={featureClip} borders={cellBorders}
                rampDiv={rampDiv} onRampDiv={setRampDiv}
                onGenes={applyGenes} onPlot={setPlot} onGroupBy={setGroupBy} onCols={setCols}
                onRelative={setRelative} onDotScale={setDotScale} onRamp={setRampKey}
                onHidden={setHiddenTypes} onClip={setFeatureClip} onBorders={setCellBorders} />
            ) : tab === 'sets' ? (
              <GeneSets src={src} types={types} ct={ct} emb={emb} palKey={palKey} rampKey={rampKey}
                onPickGene={pickGene}
                lib={lib} species={species ?? 'human'} sources={srcs} onSources={setSrcs}
                    customSets={customSets} onCustomSets={setCustomSets}
                detected={detected}
                scoreRan={scoreRan} onScoreRan={setScoreRan} />
            ) : (
              <Methods src={src} types={types} ti={ti} ctrl={ctrl} cs={cs} method={method}
                padjMax={padjMax} lfcMin={lfcMin}
                lib={species && lib.manifest?.species[species]
                  ? { release: lib.manifest.species[species].release,
                    taxon: lib.manifest.species[species].taxon }
                  : null} />
            )}
          </ViewBoundary>
        </div>
      </main>
    </>
  )
}
