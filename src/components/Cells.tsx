import { useEffect, useRef } from 'react'
import type { CellType, ColorBy, Dataset } from '../types.ts'
import type { Source } from '../lib/source.ts'
import { clusterCentroids, embedExtent, fmt } from '../lib/chart.ts'
import { pal, rampColor, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { Card, Legend } from './Ui.tsx'

export default function Cells({ src, types, gene, colorBy, split, palKey, rampKey, onColorBy, onSplit }: {
  src: Source
  types: CellType[]
  gene: string
  colorBy: ColorBy
  split: boolean
  palKey: PaletteKey
  rampKey: RampKey
  onColorBy: (c: ColorBy) => void
  onSplit: (v: boolean) => void
}) {
  const d = src.d
  const values = colorBy === 'gene' && gene ? src.vector(gene) : null
  const vmax = values ? percentile(values, 0.99) : 1
  const panels = split && d.multi ? d.conds : [null]
  const wide = panels.length === 1
  const size = wide ? 700 : Math.max(240, 840 / panels.length)
  const height = wide ? 500 : 330

  const modes: [ColorBy, string][] = [
    ['type', 'Cell type'], ['cond', 'Group'], ['sample', 'Sample'],
    ['mito', '% mito'], ['gene', `Gene: ${gene}`],
  ]

  const legend: [string, string][] =
    colorBy === 'type' ? types.map((t, i) => [pal(i, palKey), t.name])
    : colorBy === 'cond' ? d.conds.map((c, i) => [pal(i, palKey), c])
    : colorBy === 'sample' ? d.samples.map((s, i) => [pal(i, palKey), s.id])
    : []

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Embedding · UMAP from your file</div>
          <h2 className="mt-1 text-[14.5px] font-semibold">{fmt(d.nCells)} cells</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {modes.filter(([k]) => d.multi || k !== 'cond').map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={colorBy === k} onClick={() => onColorBy(k)}>
              {label}
            </button>
          ))}
          {d.multi && (
            <>
              <div className="gsep h-[26px]" />
              <button className="chip" aria-pressed={split} onClick={() => onSplit(!split)}>
                Split by group
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3.5 overflow-x-auto">
        {panels.map(p => (
          <figure key={p ?? 'all'} className="min-w-[210px] flex-1" style={{ flexBasis: size * 0.75 }}>
            {p && (
              <div className="mb-1.5 text-[12.5px] font-semibold">
                {p}{' '}
                <span className="mono font-normal" style={{ color: 'var(--ink-3)' }}>
                  n = {fmt(d.nPerCond[p])}
                </span>
              </div>
            )}
            <Scatter
              d={d} types={types} cond={p} values={values} vmax={vmax} colorBy={colorBy}
              palKey={palKey} rampKey={rampKey}
              w={size} h={height} labels={panels.length <= 2}
            />
          </figure>
        ))}
      </div>

      {legend.length > 0 ? (
        <Legend items={legend} />
      ) : (
        <div className="legend mt-3">
          <span style={{ color: 'var(--ink-3)' }}>low</span>
          <span className="inline-block h-[9px] w-[120px] rounded-[3px]" style={{ background: rampCss(rampKey) }} />
          <span style={{ color: 'var(--ink-3)' }}>high</span>
          {colorBy === 'gene' && <span className="font-semibold italic">{gene}</span>}
        </div>
      )}

      <figcaption className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        {panels.length > 1
          ? `All ${panels.length} panels share one axis range, so the shift between groups is real and not a rescaling.`
          : `Coloured by ${colorBy === 'gene' ? gene : colorBy}.`}
      </figcaption>
    </Card>
  )
}

function Scatter({ d, types, cond, values, vmax, colorBy, palKey, rampKey, w, h, labels }: {
  d: Dataset
  types: CellType[]
  cond: string | null
  values: Float32Array | null
  vmax: number
  colorBy: ColorBy
  palKey: PaletteKey
  rampKey: RampKey
  w: number
  h: number
  labels: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    const sunk = getComputedStyle(document.documentElement).getPropertyValue('--sunk').trim()

    g.fillStyle = sunk
    g.fillRect(0, 0, cv.width, cv.height)
    const { x0, x1, y0, y1 } = embedExtent(d)
    const r = labels ? (cond ? 1.7 : 1.9) : 1.4

    // Expression is drawn low-to-high so a small positive population is not
    // buried under the negative majority — the same rule as the feature plot.
    const order = values
      ? Array.from(d.cells.keys()).sort((a, b) => values[a] - values[b])
      : Array.from(d.cells.keys())
    for (const i of order) {
      const c = d.cells[i]
      if (cond && c.cond !== cond) continue
      g.fillStyle =
        colorBy === 'type' ? pal(c.t, palKey)
        : colorBy === 'cond' ? pal(d.conds.indexOf(c.cond), palKey)
        : colorBy === 'sample' ? pal(d.samples.findIndex(s => s.id === c.s), palKey)
        : colorBy === 'mito' ? rampColor(Math.min(1, c.mito / 9), rampKey)
        : rampColor(values ? Math.min(1, values[i] / (vmax || 1)) : 0, rampKey)
      g.beginPath()
      g.arc(((c.x - x0) / (x1 - x0)) * cv.width, (1 - (c.y - y0) / (y1 - y0)) * cv.height, r, 0, 6.284)
      g.fill()
    }

    if (labels) {
      g.font = '600 20px system-ui'
      g.textAlign = 'center'
      g.strokeStyle = surface
      g.lineWidth = 4
      const at = clusterCentroids(d, types.length)
      types.forEach((t, ti) => {
        const X = ((at[ti].x - x0) / (x1 - x0)) * cv.width
        const Y = (1 - (at[ti].y - y0) / (y1 - y0)) * cv.height
        g.strokeText(t.name, X, Y)
        g.fillStyle = ink
        g.fillText(t.name, X, Y)
      })
    }
  }, [d, types, cond, values, vmax, colorBy, palKey, rampKey, labels])

  return (
    <canvas
      ref={ref} width={Math.round(w * 2)} height={Math.round(h * 2)}
      style={{ width: '100%', height: 'auto', borderRadius: 10 }}
    />
  )
}

/** Upper percentile of a vector, for a colour ceiling one outlier cannot set. */
function percentile(v: Float32Array, q: number): number {
  const nz = Array.from(v).filter(x => x > 0).sort((a, b) => a - b)
  return nz.length ? nz[Math.floor(nz.length * q)] : 1
}
