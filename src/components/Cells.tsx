import { useEffect, useMemo, useRef } from 'react'
import type { CellType, ColorBy, Dataset } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { clusterCentroids, embedExtent, fmt, hasSignal } from '../lib/chart.ts'
import { drawLabels } from '../lib/canvas-label.ts'
import { pal, rampColor, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { Card, Legend } from './Ui.tsx'

export default function Cells({ src, types, emb, colorBy, split, palKey, rampKey, onColorBy, onSplit }: {
  src: Source
  types: CellType[]
  /** Which of the object's embeddings to draw. Chosen once, in App, for every tab. */
  emb: Embedding
  colorBy: ColorBy
  split: boolean
  palKey: PaletteKey
  rampKey: RampKey
  onColorBy: (c: ColorBy) => void
  onSplit: (v: boolean) => void
}) {
  const d = src.d
  const panels = split && d.multi ? d.conds : [null]
  const wide = panels.length === 1
  const size = wide ? 700 : Math.max(240, 840 / panels.length)
  const height = wide ? 500 : 330

  /**
   * No expression here.
   *
   * This tab answers "what is where" — the annotation, the groups, the samples,
   * and one quality covariate. A single gene's expression is a different
   * question with a whole tab of its own, where it comes with a scale, a
   * percentile ceiling, a split, and the gene's name on the figure.
   *
   * Colouring by it here gave none of that: the button said "Expression" with no
   * indication of WHICH gene, and the gene was whatever the reader had last
   * picked on another tab. A map of an unnamed gene is not a worse feature
   * expression plot, it is a figure nobody can read.
   */
  // Offered only when the object measured it. A bundle always carries a QC
  // block, so an object with no mitochondrial genes annotated arrives with a
  // column of zeros — and colouring by that draws a uniform plane under a
  // low-to-high scale, which claims a gradient the reader cannot see because it
  // is not there.
  const mito = useMemo(() => hasSignal(d.cells, c => c.mito), [d.cells])
  const modes: [ColorBy, string][] = [
    ['type', 'Cell type'], ['cond', 'Group'], ['sample', 'Sample'],
    ...(mito ? [['mito', '% mito'] as [ColorBy, string]] : []),
  ]
  // An object without the covariate must not stay stuck on it — the selection
  // survives switching objects, and the control that would change it is gone.
  const shown: ColorBy = colorBy === 'mito' && !mito ? 'type' : colorBy

  const legend: [string, string][] =
    shown === 'type' ? types.map((t, i) => [pal(i, palKey), t.name])
    : shown === 'cond' ? d.conds.map((c, i) => [pal(i, palKey), c])
    : shown === 'sample' ? d.samples.map((s, i) => [pal(i, palKey), s.id])
    : []

  return (
    <Card
      eyebrow={`Embedding · ${emb.key} from your file`}
      title={`${fmt(d.nCells)} cells`}
      right={<>
        {modes.filter(([k]) => d.multi || k !== 'cond').map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={shown === k} onClick={() => onColorBy(k)}>
            {label}
          </button>
        ))}
        {d.multi && (
          <>
            <div className="gsep" />
            <button className="chip" aria-pressed={split} onClick={() => onSplit(!split)}>
              Split by group
            </button>
          </>
        )}
      </>}
    >
      <div className="flex gap-3.5 overflow-x-auto">
        {panels.map(p => (
          <figure key={p ?? 'all'} className="min-w-[210px] flex-1" style={{ flexBasis: size * 0.75 }}>
            {p && (
              <div className="mb-1.5 tx-small font-semibold">
                {p}{' '}
                <span className="mono font-normal" style={{ color: 'var(--ink-3)' }}>
                  n = {fmt(d.nPerCond[p])}
                </span>
              </div>
            )}
            <Scatter
              d={d} types={types} xy={emb.xy} cond={p} colorBy={shown}
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
          <span className="inline-block h-[9px] w-[120px] rounded-[--r-sm]" style={{ background: rampCss(rampKey) }} />
          <span style={{ color: 'var(--ink-3)' }}>high</span>
        </div>
      )}

      <figcaption className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        {panels.length > 1
          ? `One shared axis range across all ${panels.length} panels.`
          : `Coloured by ${shown}.`}
      </figcaption>
    </Card>
  )
}

function Scatter({ d, types, xy, cond, colorBy, palKey, rampKey, w, h, labels }: {
  d: Dataset
  types: CellType[]
  xy: Float32Array
  cond: string | null
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
    const { x0, x1, y0, y1 } = embedExtent(xy)
    /**
     * The top of the mito ramp, from the data rather than a literal 9.
     *
     * Both exporters convert mitochondrial content to a PERCENTAGE, so a fixed
     * ceiling of 9 gave every cell from 9% to 100% the identical colour: a
     * dying 40–60% cluster looked exactly like a healthy one at 9, and the
     * reader could not see where their own QC cutoff fell. The 99th percentile
     * rather than the maximum, so one extreme cell does not flatten the rest —
     * which is the same rule the feature plot's percentile ceiling uses.
     */
    const mitoTop = (() => {
      if (colorBy !== 'mito') return 0
      const vs = d.cells.map(c => c.mito).filter(v => v > 0).sort((a, b) => a - b)
      if (!vs.length) return 0
      return vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.99))] || 0
    })()
    const r = labels ? (cond ? 1.7 : 1.9) : 1.4

    // Expression is drawn low-to-high so a small positive population is not
    // buried under the negative majority — the same rule as the feature plot.
    const order = new Int32Array(d.cells.length)
    for (let i = 0; i < order.length; i++) order[i] = i
    for (const i of order) {
      const c = d.cells[i]
      if (cond && c.cond !== cond) continue
      g.fillStyle =
        colorBy === 'type' ? pal(c.t, palKey)
        : colorBy === 'cond' ? pal(d.conds.indexOf(c.cond), palKey)
        : colorBy === 'sample' ? pal(d.samples.findIndex(s => s.id === c.s), palKey)
        : rampColor(mitoTop > 0 ? Math.min(1, c.mito / mitoTop) : 0, rampKey)
      g.beginPath()
      g.arc(((xy[2 * i] - x0) / (x1 - x0)) * cv.width,
        (1 - (xy[2 * i + 1] - y0) / (y1 - y0)) * cv.height, r, 0, 6.284)
      g.fill()
    }

    if (labels) {
      g.font = '600 20px system-ui'
      g.lineWidth = 4
      const at = clusterCentroids(xy, d, types.length)
      drawLabels(g, types.map((t, ti) => ({
        name: t.name,
        x: ((at[ti].x - x0) / (x1 - x0)) * cv.width,
        y: (1 - (at[ti].y - y0) / (y1 - y0)) * cv.height,
      })), { fill: ink, halo: surface })
    }
  }, [d, types, xy, cond, colorBy, palKey, rampKey, labels])

  return (
    <canvas
      /* Every SVG figure here carries role="img" and a sentence; the three
         canvas figures carried nothing, so a screen reader was told there is a
         canvas. A scatter of 292 495 points has no accessible structure to
         expose, but it does have a description, and that is the difference
         between an unlabelled graphic and a figure. */
      role="img"
      aria-label={`${fmt(d.cells.length)} cells on the embedding`
        + `${cond ? `, ${cond} only` : ''}, coloured by ${colorBy}`
        + `${labels ? `, with ${types.length} cluster names` : ''}`}
      ref={ref} width={Math.round(w * 2)} height={Math.round(h * 2)}
      style={{ width: '100%', height: 'auto', borderRadius: 'var(--r-md)' }}
    />
  )
}

