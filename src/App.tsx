import { useMemo, useState } from 'react'
import type {
  CellType, ColorBy, Dataset, GroupBy, Method, PlotKind, TabId,
} from './types.ts'
import { buildDataset, makeTypes } from './lib/demo.ts'
import { designFor, minReplicates, pbKey } from './lib/stats.ts'
import type { PaletteKey, RampKey } from './lib/palette.ts'
import Landing from './components/Landing.tsx'
import Overview from './components/Overview.tsx'
import Cells from './components/Cells.tsx'
import Composition from './components/Composition.tsx'
import Markers from './components/Markers.tsx'
import { DEGTable, Enrichment, Volcano, type StatsProps } from './components/Stats.tsx'
import GeneExpression from './components/GeneExpression.tsx'
import Methods from './components/Methods.tsx'
import { Card, Empty } from './components/Ui.tsx'

const TABS: [TabId | 'div', string][] = [
  ['overview', 'Overview'], ['cells', 'Cells'], ['composition', 'Composition'], ['markers', 'Markers'],
  ['div', '|'],
  ['degs', 'DEG table'], ['volcano', 'Volcano'], ['enrich', 'Enrichment'],
  ['expr', 'Gene expression'], ['sets', 'Gene sets'], ['methods', 'Methods'],
]

/** Tabs that describe a comparison, and so cannot exist without two groups. */
const NEEDS_CONTRAST = new Set<TabId>(['degs', 'volcano', 'enrich'])

export default function App() {
  const [dsKey, setDsKey] = useState<string | null>(null)
  const [types, setTypes] = useState<CellType[]>(makeTypes)
  const [tab, setTab] = useState<TabId>('overview')
  const [ct, setCt] = useState('qNSC')
  const [ctrl, setCtrl] = useState('')
  const [cs, setCs] = useState('')
  const [method, setMethod] = useState<Method>('wilcox')
  const [computed, setComputed] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)

  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const [split, setSplit] = useState(true)
  const [plot, setPlot] = useState<PlotKind>('violin')
  const [groupBy, setGroupBy] = useState<GroupBy>('type')
  const [cols, setCols] = useState(2)
  const [relative, setRelative] = useState(false)
  const [dotScale, setDotScale] = useState(true)
  const [genes, setGenes] = useState<string[]>(['Ascl1', 'Gfap', 'Mki67', 'Dcx'])

  const [palKey, setPalKey] = useState<PaletteKey>('npg')
  const [rampKey, setRampKey] = useState<RampKey>('seurat')

  // Building the demo object is a few hundred ms of gaussians; never on a redraw.
  const d: Dataset | null = useMemo(
    () => (dsKey ? buildDataset(dsKey, types) : null),
    // `types` only changes on rename, which does not move a single cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dsKey],
  )

  function open(key: string) {
    const fresh = makeTypes()
    const built = buildDataset(key, fresh)
    setTypes(fresh)
    setDsKey(key)
    setCt(fresh[0].name)
    setCtrl(built.conds[0])
    setCs(built.conds[built.conds.length - 1])
    setMethod('wilcox')
    setGroupBy('type')
    setComputed(new Set())
    setTab('overview')
  }

  if (!d) return <Landing onOpen={open} />

  const ti = Math.max(0, types.findIndex(t => t.name === ct))
  const t = types[ti]
  const design = designFor(d, ti, ctrl, cs)
  const key = pbKey(t, ctrl, cs)
  const blocked = !d.multi && NEEDS_CONTRAST.has(tab)

  const statsProps: StatsProps = {
    d, t, ti, ctrl, cs, method, running,
    computed: computed.has(key),
    onMethod: setMethod,
    onRun: () => {
      setRunning(true)
      // Stands in for the webR round-trip until lib/deseq lands.
      setTimeout(() => {
        setComputed(prev => new Set(prev).add(key))
        setRunning(false)
      }, 900)
    },
  }

  const chip = (() => {
    if (!d.multi) return { cls: 'mute', text: `Single condition · ${d.samples.length} sample${d.samples.length > 1 ? 's' : ''}` }
    if (ctrl === cs) return { cls: 'bad', text: 'Pick two different groups' }
    if (method === 'wilcox') return { cls: 'ok', text: 'Wilcoxon · per cell · no replicates required' }
    if (!design.pbOK) return { cls: 'bad', text: `Pseudobulk needs > 3 per group — have ${design.n0} vs ${design.n1}` }
    if (!computed.has(key)) return { cls: 'bad', text: `Pseudobulk ready to run · ${design.n0} vs ${design.n1}` }
    return { cls: 'ok', text: `DESeq2 · pseudobulk · ${design.n0} vs ${design.n1}` }
  })()

  const chipStyle =
    chip.cls === 'ok'
      ? { background: 'var(--good-soft)', color: 'var(--good)', borderColor: 'color-mix(in srgb, var(--good) 25%, transparent)' }
      : chip.cls === 'bad'
        ? { background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'var(--warn-line)' }
        : { background: 'var(--surface)', color: 'var(--ink-3)', borderColor: 'var(--line-2)' }

  return (
    <>
      <header className="sticky top-0 z-30" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div className="wrap">
          <div className="flex items-center gap-3.5 pb-2.5 pt-3">
            <div
              className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] text-xs font-bold text-white"
              style={{ background: 'linear-gradient(150deg, var(--accent), #a855f7)' }}
            >sc</div>
            <div>
              <div className="text-[15px] font-semibold tracking-[-0.01em]">scRNA-seq Studio</div>
              <div className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                read-only explorer · nothing is re-processed
              </div>
            </div>
            {/* min-w-0 is what lets a long project name wrap instead of overflowing. */}
            <div className="min-w-0 flex-1 text-right">
              <div className="text-[13px] font-semibold" style={{ overflowWrap: 'anywhere' }}>{d.label}</div>
              <div className="mono text-[11px]" style={{ color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>{d.file}</div>
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
            <select className="sel" value={ct} onChange={e => setCt(e.target.value)}>
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
              <b>Markers</b> ranks the genes that define each cluster, and <b>Gene expression</b>{' '}
              searches any gene across every cell type.
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button className="btn" onClick={() => setTab('markers')}>Go to Markers</button>
                <button className="btn btn-primary" onClick={() => setTab('expr')}>Search a gene</button>
              </div>
            </Empty>
          ) : tab === 'overview' ? (
            <Overview d={d} types={types} palKey={palKey} rampKey={rampKey}
              onPal={setPalKey} onRamp={setRampKey} />
          ) : tab === 'cells' ? (
            <Cells d={d} types={types} gene={genes[genes.length - 1] ?? 'Ascl1'} colorBy={colorBy}
              split={split} palKey={palKey} rampKey={rampKey}
              onColorBy={setColorBy} onSplit={setSplit} />
          ) : tab === 'composition' ? (
            <Composition d={d} types={types} palKey={palKey} />
          ) : tab === 'markers' ? (
            <Markers types={types} palKey={palKey} onRename={(i, name) => {
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
            <Enrichment {...statsProps} />
          ) : tab === 'expr' ? (
            <GeneExpression
              d={d} types={types} ct={ct} ctrl={ctrl} cs={cs} genes={genes}
              plot={plot} groupBy={groupBy} cols={cols} relative={relative} dotScale={dotScale}
              palKey={palKey} rampKey={rampKey}
              onGenes={setGenes} onPlot={setPlot} onGroupBy={setGroupBy} onCols={setCols}
              onRelative={setRelative} onDotScale={setDotScale} onRamp={setRampKey} />
          ) : tab === 'sets' ? (
            <Card
              eyebrow={ct} title="Gene set module scores"
              sub={<>Score a signature per cell (<code className="mono">AddModuleScore</code> /{' '}
                <code className="mono">score_genes</code>) and paint it on the embedding, plus the
                per-group distribution. Works on a single-condition object too.</>}
            >
              <div className="empty mt-3.5">Same component as the bulk studio — not yet ported.</div>
            </Card>
          ) : (
            <Methods d={d} types={types} ti={ti} ctrl={ctrl} cs={cs}
              method={minReplicates(d) > 0 ? method : 'wilcox'} />
          )}
        </div>
      </main>
    </>
  )
}
