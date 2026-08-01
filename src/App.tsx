import { useState } from 'react'
import type { CellType, ColorBy, GroupBy, Method, PlotKind, TabId } from './types.ts'
import { parseBundle } from './lib/bundle.ts'
import { bundleSource, demoSource, type Source } from './lib/source.ts'
import { designFor, thresholdFor } from './lib/stats.ts'
import { mergeGenes } from './lib/genes.ts'
import type { PaletteKey, RampKey } from './lib/palette.ts'
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
import { Empty } from './components/Ui.tsx'

const TABS: [TabId | 'div', string][] = [
  ['overview', 'Overview'], ['cells', 'Cells'], ['composition', 'Composition'], ['markers', 'Markers'],
  ['div', '|'],
  ['degs', 'DEG table'], ['volcano', 'Volcano'], ['enrich', 'Enrichment'],
  ['expr', 'Gene expression'], ['sets', 'Gene sets'], ['methods', 'Methods'],
]

/** Tabs that describe a comparison, and so cannot exist without two groups. */
const NEEDS_CONTRAST = new Set<TabId>(['degs', 'volcano', 'enrich'])

export default function App() {
  const [src, setSrc] = useState<Source | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Cluster names are held here, not in the Source, because renaming is a user
  // edit: the Source stays exactly what the file said.
  const [types, setTypes] = useState<CellType[]>([])
  const [tab, setTab] = useState<TabId>('overview')
  const [ct, setCt] = useState('')
  const [ctrl, setCtrl] = useState('')
  const [cs, setCs] = useState('')
  const [method, setMethod] = useState<Method>('wilcox')
  const [padjMax, setPadjMax] = useState(0.05)
  const [lfcMin, setLfcMin] = useState(thresholdFor('wilcox').lfc)

  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const [split, setSplit] = useState(true)
  const [plot, setPlot] = useState<PlotKind>('violin')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [cols, setCols] = useState(2)
  const [relative, setRelative] = useState(false)
  const [dotScale, setDotScale] = useState(true)
  const [genes, setGenes] = useState<string[]>([])

  const [palKey, setPalKey] = useState<PaletteKey>('npg')
  const [rampKey, setRampKey] = useState<RampKey>('seurat')

  function adopt(next: Source, defaultGenes: string[]) {
    setSrc(next)
    setTypes(next.types.map(t => ({ ...t })))
    setCt(next.types[0]?.name ?? '')
    setCtrl(next.d.conds[0])
    setCs(next.d.conds[next.d.conds.length - 1])
    setMethod('wilcox')
    setPadjMax(0.05)
    setLfcMin(thresholdFor('wilcox').lfc)
    setGroupBy('type')
    setPlot('violin')
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
    try {
      const next = bundleSource(parseBundle(await file.arrayBuffer()))
      // Pick starting genes that exist rather than a fixed list that may not.
      const wanted = ['CD3D', 'MS4A1', 'LYZ', 'GNLY', 'PPBP', 'Ascl1', 'Gfap']
      const found = wanted.filter(g => next.genes.includes(g))
      adopt(next, found.length ? found : next.genes.slice(0, 4))
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (!src) {
    return <Landing onDemo={openDemo} onFile={openFile} error={openError} busy={loading} />
  }

  const d = src.d
  const ti = Math.max(0, types.findIndex(t => t.name === ct))
  const t = types[ti] ?? src.types[0]
  const design = designFor(src, ti, ctrl, cs)
  const blocked = !d.multi && NEEDS_CONTRAST.has(tab)

  const pickGene = (g: string) => {
    setGenes(prev => mergeGenes(prev, [g]))
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
              <div className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                read-only explorer · nothing is re-processed
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

      <div className="sticky z-20" style={{ top: 96, background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}>
        <div className="wrap flex flex-wrap items-center gap-2.5 py-2.5">
          <label className="flex items-center gap-1.5">
            <span className="glabel">Cell type</span>
            <select className="sel max-w-[240px]" value={ct} onChange={e => setCt(e.target.value)}>
              {types.map(x => <option key={x.key}>{x.name}</option>)}
            </select>
          </label>
          {d.multi && (
            <>
              <div className="gsep" />
              <label className="flex items-center gap-1.5">
                <span className="glabel">Control</span>
                <select className="sel" value={ctrl} onChange={e => setCtrl(e.target.value)}>
                  {d.conds.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="glabel">Compare</span>
                <select className="sel" value={cs} onChange={e => setCs(e.target.value)}>
                  {d.conds.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
            </>
          )}
          <span
            className="ml-auto inline-flex items-center gap-[7px] rounded-full px-[11px] py-1 text-[11.5px] font-semibold"
            style={{ ...chipStyle, borderWidth: 1, borderStyle: 'solid' }}
          >
            <i className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
            {chip.text}
          </span>
        </div>
      </div>

      <main className="pb-16 pt-5">
        <div className="wrap">
          {blocked ? (
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
            <Cells src={src} types={types} gene={genes[genes.length - 1] ?? ''} colorBy={colorBy}
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
              src={src} types={types} ct={ct} ctrl={ctrl} cs={cs} genes={genes}
              plot={plot} groupBy={groupBy} cols={cols} relative={relative} dotScale={dotScale}
              palKey={palKey} rampKey={rampKey}
              onGenes={setGenes} onPlot={setPlot} onGroupBy={setGroupBy} onCols={setCols}
              onRelative={setRelative} onDotScale={setDotScale} onRamp={setRampKey} />
          ) : tab === 'sets' ? (
            <GeneSets src={src} types={types} ct={ct} palKey={palKey} rampKey={rampKey}
              onPickGene={pickGene} />
          ) : (
            <Methods src={src} types={types} ti={ti} ctrl={ctrl} cs={cs} method={method}
              padjMax={padjMax} lfcMin={lfcMin} />
          )}
        </div>
      </main>
    </>
  )
}
