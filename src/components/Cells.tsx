import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CellType, ColorBy, Dataset } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { embedExtent, fmt, hasSignal } from '../lib/chart.ts'
import { paintEmbedding } from '../lib/embed-paint.ts'
import { pal, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { SENTINEL_GREY, countText, populations, sentinelCount } from '../lib/sentinels.ts'
import { Card } from './Ui.tsx'

/**
 * The explorer (docs/DESIGN.md, "Layout"): the embedding owns the stage, what
 * it is coloured by is chosen in the rail (CellsControls, placed there by App),
 * and what the colours mean, with their counts, sits in the inspector.
 *
 * No expression here.
 *
 * This tab answers "what is where" — the annotation, the groups, the samples,
 * and one quality covariate. A single gene's expression is a different
 * question with a whole tab of its own, where it comes with a scale, a
 * percentile ceiling, a split, and the gene's name on the figure. Colouring by
 * it here gave none of that: a map of an unnamed gene is not a worse feature
 * expression plot, it is a figure nobody can read.
 */
function useModes(d: Dataset) {
  // Offered only when the object measured it. A bundle always carries a QC
  // block, so an object with no mitochondrial genes annotated arrives with a
  // column of zeros — and colouring by that draws a uniform plane under a
  // low-to-high scale, which claims a gradient the reader cannot see.
  const mito = useMemo(() => hasSignal(d.cells, c => c.mito), [d.cells])
  const modes: [ColorBy, string][] = [
    ['type', 'Cell type'], ['cond', 'Group'], ['sample', 'Sample'],
    ...(mito ? [['mito', '% mito'] as [ColorBy, string]] : []),
  ]
  return { mito, modes }
}

// An object without the covariate must not stay stuck on it — the selection
// survives switching objects, and the control that would change it is gone.
const shownOf = (colorBy: ColorBy, mito: boolean): ColorBy => (colorBy === 'mito' && !mito ? 'type' : colorBy)

/** The explorer's own controls, for the rail: what colours the cells, and how many panels. */
export function CellsControls({ d, colorBy, split, onColorBy, onSplit }: {
  d: Dataset
  colorBy: ColorBy
  split: boolean
  onColorBy: (c: ColorBy) => void
  onSplit: (v: boolean) => void
}) {
  const { mito, modes } = useModes(d)
  const shown = shownOf(colorBy, mito)
  return (
    <>
      <div className="rail-group" role="group" aria-labelledby="rail-colour">
        <div className="rail-label" id="rail-colour">Colour by</div>
        <div className="opts">
          {modes.filter(([k]) => d.multi || k !== 'cond').map(([k, label]) => (
            <button key={k} className="opt" aria-pressed={shown === k} onClick={() => onColorBy(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {d.multi && (
        <div className="rail-group" role="group" aria-labelledby="rail-panels">
          <div className="rail-label" id="rail-panels">Panels</div>
          <div className="opts">
            <button className="opt opt-toggle" aria-pressed={split} onClick={() => onSplit(!split)}>
              Split by group
              <span className="switch" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** The stage's size, read from the page, so the figure fills it at the embedding's own aspect. */
// Before paint in a browser, so the first frame is already the fitted size and
// nothing jumps; on the server (the tests' render) there is no layout to read.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect

function useStageBox() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, vh: 0 })
  useBeforePaint(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const read = () => setBox({ w: Math.floor(el.clientWidth), vh: window.innerHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    window.addEventListener('resize', read)
    return () => { ro.disconnect(); window.removeEventListener('resize', read) }
  }, [])
  return [ref, box] as const
}

const GAP = 16

export default function Cells({ src, types, emb, colorBy, split, palKey, rampKey }: {
  src: Source
  types: CellType[]
  /** Which of the object's embeddings to draw. Chosen once, in App, for every tab. */
  emb: Embedding
  colorBy: ColorBy
  split: boolean
  palKey: PaletteKey
  rampKey: RampKey
  onColorBy?: (c: ColorBy) => void
  onSplit?: (v: boolean) => void
}) {
  const d = src.d
  const { mito } = useModes(d)
  const shown = shownOf(colorBy, mito)
  const panels = split && d.multi ? d.conds : [null]

  /**
   * Fitted, not fixed. The figure was a 700 × 500 box whatever the window, so
   * at 1920 px the plot took a third of the screen. Now each panel takes its
   * share of the stage, at the embedding's own aspect (equal units on both
   * axes), and no taller than the window leaves room for. The backing store
   * stays at twice the CSS size, as before, so the painter's point radius and
   * label size read exactly as they did.
   */
  const [boxRef, box] = useStageBox()
  const ext = embedExtent(emb.xy)
  const aspect = (ext.y1 - ext.y0) / (ext.x1 - ext.x0) || 5 / 7
  let pw = box.w
    ? (box.w - GAP * (panels.length - 1)) / panels.length
    : panels.length === 1 ? 700 : Math.max(240, 840 / panels.length)
  let ph = pw * aspect
  const maxH = box.vh ? Math.max(320, box.vh - 236 - (panels.length > 1 ? 28 : 0)) : 500
  if (ph > maxH) { ph = maxH; pw = ph / aspect }

  // A sentinel is not a cell type, so it is not a legend entry; its cells are
  // drawn grey and said in one line under the legend instead.
  const legend: [string, string][] =
    shown === 'type' ? types.flatMap((t, i) => (t.sentinel ? [] : [[pal(i, palKey), t.name] as [string, string]]))
    : shown === 'cond' ? d.conds.map((c, i) => [pal(i, palKey), c])
    : shown === 'sample' ? d.samples.map((s, i) => [pal(i, palKey), s.id])
    : []
  // How many cells each entry colours: counted from the object's own labels.
  const counts = useMemo(() => {
    const by = new Map<string, number>()
    if (shown === 'mito') return by
    for (const c of d.cells) {
      const k = shown === 'type' ? types[c.t]?.name : shown === 'cond' ? c.cond : c.s
      if (k !== undefined) by.set(k, (by.get(k) ?? 0) + 1)
    }
    return by
  }, [d.cells, types, shown])
  const uncalled = useMemo(() => sentinelCount(d.cells, types), [d.cells, types])
  const legendName = shown === 'type' ? 'Cell type' : shown === 'cond' ? 'Group' : shown === 'sample' ? 'Sample' : '% mito'

  return (
    <div className="explorer">
      <Card eyebrow={`Embedding · ${emb.key} from your file`} title={`${fmt(d.nCells)} cells`}>
        <div ref={boxRef} className="flex justify-center" style={{ gap: GAP }}>
          {panels.map(p => (
            <figure key={p ?? 'all'} className="min-w-0" style={{ width: pw }}>
              {p && (
                <div className="mb-1.5 tx-small font-semibold">
                  {p}{' '}
                  <span className="num font-normal" style={{ color: 'var(--ink-2)' }}>
                    n = {fmt(d.nPerCond[p])}
                  </span>
                </div>
              )}
              <Scatter
                d={d} types={types} xy={emb.xy} cond={p} colorBy={shown}
                palKey={palKey} rampKey={rampKey} axis={emb.key} mito={mito}
                w={pw} h={ph} labels={panels.length <= 2}
              />
            </figure>
          ))}
        </div>
        <figcaption className="mt-3 tx-small" style={{ color: 'var(--ink-2)' }}>
          {panels.length > 1
            ? `One shared axis range across all ${panels.length} panels.`
            : `Coloured by ${shown}.`}
        </figcaption>
      </Card>

      <aside className="inspector" aria-label="What the colours mean">
        <section className="ins-section">
          <div className="lg-row">
            <span className="rail-label">{legendName}</span>
            {legend.length > 0 && <span className="tx-small" style={{ color: 'var(--ink-2)' }}>cells</span>}
          </div>
          {legend.length > 0 ? (
            <div className="legend flex-col items-stretch" style={{ gap: 0 }}>
              {legend.map(([color, label]) => (
                <div key={label} className="lg-row">
                  <span><i className="sw" style={{ background: color }} />{label}</span>
                  <span className="num">{fmt(counts.get(label) ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="legend">
              <span style={{ color: 'var(--ink-2)' }}>low</span>
              <span className="inline-block h-[10px] w-[140px] rounded-[--r-sm]" style={{ background: rampCss(rampKey) }} />
              <span style={{ color: 'var(--ink-2)' }}>high</span>
            </div>
          )}
        </section>

        {shown === 'type' && uncalled.total > 0 && (
          <section className="ins-section">
            <p className="flex items-start gap-2 tx-small" style={{ color: 'var(--ink-2)' }}>
              <i className="sw mt-[5px] flex-none" style={{ background: SENTINEL_GREY }} />
              <span>
                Grey: {fmt(uncalled.total)} cells the annotator did not call ({countText(uncalled)}).
                They are drawn where they are, and are not a cell type.
              </span>
            </p>
          </section>
        )}
      </aside>
    </div>
  )
}

/** The cell under the pointer: a grid over this panel's cells in CSS pixels. */
function useNearest(d: Dataset, xy: Float32Array, cond: string | null, w: number, h: number) {
  return useMemo(() => {
    let grid: Map<number, number[]> | null = null
    const S = 8
    const { x0, x1, y0, y1 } = embedExtent(xy)
    const px = (i: number) => ((xy[2 * i] - x0) / (x1 - x0)) * w
    const py = (i: number) => (1 - (xy[2 * i + 1] - y0) / (y1 - y0)) * h
    const key = (gx: number, gy: number) => gy * 100_000 + gx
    return (mx: number, my: number): number => {
      if (!grid) {
        grid = new Map()
        for (let i = 0; i < d.cells.length; i++) {
          if (cond && d.cells[i].cond !== cond) continue
          const k = key(Math.floor(px(i) / S), Math.floor(py(i) / S))
          const b = grid.get(k)
          if (b) b.push(i); else grid.set(k, [i])
        }
      }
      const gx = Math.floor(mx / S), gy = Math.floor(my / S)
      let best = -1, bd = 36 // within 6 px
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const i of grid.get(key(gx + dx, gy + dy)) ?? []) {
          const dd = (px(i) - mx) ** 2 + (py(i) - my) ** 2
          if (dd <= bd) { bd = dd; best = i }
        }
      }
      return best
    }
  }, [d, xy, cond, w, h])
}

function Scatter({ d, types, xy, cond, colorBy, palKey, rampKey, w, h, labels, axis, mito }: {
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
  axis: string
  mito: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null)
  const nearest = useNearest(d, xy, cond, w, h)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const css = getComputedStyle(document.documentElement)
    // What is drawn is in lib/embed-paint.ts, where a test can watch it.
    paintEmbedding(g, {
      d, types, xy, cond, colorBy, palKey, rampKey, labels,
      ink: css.getPropertyValue('--ink').trim(),
      surface: css.getPropertyValue('--surface').trim(),
      sunk: css.getPropertyValue('--sunk').trim(),
    })
  }, [d, types, xy, cond, colorBy, palKey, rampKey, labels, w, h])

  const c = tip ? d.cells[tip.i] : null
  return (
    <div className="relative" style={{ width: w, height: h }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - r.left, y = e.clientY - r.top
        const i = nearest(x, y)
        setTip(i < 0 ? null : { x, y, i })
      }}
      onMouseLeave={() => setTip(null)}>
      <canvas
        /* Every SVG figure here carries role="img" and a sentence; a scatter of
           292 495 points has no accessible structure to expose, but it does have
           a description, and that is the difference between an unlabelled
           graphic and a figure. */
        role="img"
        aria-label={`${fmt(d.cells.length)} cells on the embedding`
          + `${cond ? `, ${cond} only` : ''}, coloured by ${colorBy}`
          + `${labels ? `, with ${populations(types).length} cluster names` : ''}`}
        ref={ref} width={Math.round(w * 2)} height={Math.round(h * 2)}
        style={{ width: w, height: h, borderRadius: 'var(--r-md)' }}
      />
      {/* The axes are the embedding's own two dimensions, named by its key. */}
      <svg aria-hidden className="pointer-events-none absolute bottom-2 left-2" width="96" height="58">
        <path d="M6 4 V52 H54" fill="none" stroke="var(--ink-2)" strokeWidth="1" />
        <path d="M3 9 L6 4 L9 9 M49 49 L54 52 L49 55" fill="none" stroke="var(--ink-2)" strokeWidth="1" />
        <text x="12" y="10" fontSize="10" fill="var(--ink-2)">{axis} 2</text>
        <text x="58" y="55" fontSize="10" fill="var(--ink-2)">{axis} 1</text>
      </svg>
      {c && tip && (
        <div className="tip" role="status"
          style={{ left: tip.x + 14, top: tip.y + 14, transform: tip.x > w - 200 ? 'translateX(calc(-100% - 28px))' : undefined }}>
          <div className="font-semibold">{types[c.t]?.name ?? c.t}</div>
          <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 num" style={{ color: 'var(--ink-2)' }}>
            {d.multi && <><dt>Group</dt><dd className="m-0" style={{ color: 'var(--ink)' }}>{c.cond}</dd></>}
            <dt>Sample</dt><dd className="m-0" style={{ color: 'var(--ink)' }}>{c.s}</dd>
            {mito && <><dt>% mito</dt><dd className="m-0" style={{ color: 'var(--ink)' }}>{Number(c.mito.toPrecision(7))}</dd></>}
          </dl>
        </div>
      )}
    </div>
  )
}
