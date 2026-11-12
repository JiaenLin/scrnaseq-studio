import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CellType, ColorBy, Dataset } from '../types.ts'
import type { Embedding } from '../lib/bundle.ts'
import type { Source } from '../lib/source.ts'
import { embeddingHead, notCalledHint, undrawnOf } from '../lib/facts.ts'
import { embedExtent, fmt, hasSignal } from '../lib/chart.ts'
import { EDGE, NAME, fitPanels } from '../lib/fit-panels.ts'
import Figure from './Figure.tsx'
import { useDark } from '../lib/theme.ts'
import { ActionSlot } from '../lib/action-slot.ts'
import { mitoTopOf, paintEmbedding } from '../lib/embed-paint.ts'
import { pal, rampColor, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import { NOT_CALLED, SENTINEL_GREY, countText, populations, sentinelCount } from '../lib/sentinels.ts'

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

// Before paint in a browser, so the first frame is already the fitted size and
// nothing jumps; on the server (the tests' render) there is no layout to read.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** The figure area's size, read from the page: width AND height. */
function useStageBox() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useBeforePaint(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const read = () => setBox(b => {
      const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight)
      return b.w === w && b.h === h ? b : { w, h }
    })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

const KEY_NAME: Record<ColorBy, string> = { type: 'Cell type', cond: 'Group', sample: 'Sample', mito: '% mito' }

export default function Cells({ src, types, emb, colorBy, split, palKey, rampKey, inspector = true }: {
  src: Source
  types: CellType[]
  /** Which of the object's embeddings to draw. Chosen once, in App, for every tab. */
  emb: Embedding
  colorBy: ColorBy
  split: boolean
  palKey: PaletteKey
  rampKey: RampKey
  /** The key beside the figure. Closed, the key moves into the figure's head. */
  inspector?: boolean
  onColorBy?: (c: ColorBy) => void
  onSplit?: (v: boolean) => void
}) {
  const d = src.d
  const { mito } = useModes(d)
  const shown = shownOf(colorBy, mito)
  const panels = split && d.multi ? d.conds : [null]

  /**
   * Fitted to the stage, in both directions and for any number of panels.
   * The backing store stays at twice the CSS size; marks and names are sized
   * from the panel, so they read the same at 1,280 and at 2,560 px.
   */
  const [boxRef, box] = useStageBox()
  const ext = embedExtent(emb.xy)
  const aspect = (ext.y1 - ext.y0) / (ext.x1 - ext.x0) || 5 / 7
  const fit = box.w
    ? fitPanels(panels.length, box.w, box.h, aspect)
    : { cols: panels.length, rows: 1, w: panels.length === 1 ? 700 : Math.max(240, 840 / panels.length), h: 0 }
  const pw = Math.max(120, fit.w)
  const ph = fit.h || pw * aspect

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
  const legendName = KEY_NAME[shown]

  /**
   * Isolate one entry of the key: its cells stay in colour and on top, the
   * rest go grey underneath. Pressing the entry again, Escape, or "Show all"
   * undoes it, and so does changing what the colours mean.
   */
  const [only, setOnly] = useState<string | null>(null)
  const isolated = only !== null && legend.some(([, name]) => name === only) ? only : null
  useEffect(() => {
    if (isolated === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOnly(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isolated])
  const keep = useMemo(() => {
    if (isolated === null) return undefined
    const cells = d.cells
    return shown === 'type' ? (i: number) => types[cells[i].t]?.name === isolated
      : shown === 'cond' ? (i: number) => cells[i].cond === isolated
      : (i: number) => cells[i].s === isolated
  }, [d.cells, types, shown, isolated])

  // The key is one stop in the tab order; the arrows move along it.
  const stop = isolated ?? legend[0]?.[1]
  const alongKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button.lg-row')]
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    rows[(at + step + rows.length) % rows.length].focus()
  }
  const entry = (color: string, label: string, withCount: boolean) => (
    <button key={label} type="button" aria-pressed={isolated === label} tabIndex={label === stop ? 0 : -1}
      className={`lg-row${withCount ? '' : ' lg-inline'}${isolated !== null && isolated !== label ? ' lg-dim' : ''}`}
      title={isolated === label ? 'Show every cell again' : `Show only ${label}`}
      onClick={() => setOnly(isolated === label ? null : label)}>
      <span><i className="sw" style={{ background: color }} />{label}</span>
      {withCount && <span className="num">{fmt(counts.get(label) ?? 0)}</span>}
    </button>
  )
  const dark = useDark()
  // The scale's two ends as values: it read "low" and "high". The top is the
  // 99th percentile the painter clips at, so it is "that or more".
  const mitoTop = useMemo(() => mitoTopOf(d.cells), [d.cells])
  const mitoHigh = `\u2265 ${mitoTop.toFixed(1)}%`
  const ramp = (
    <div className="legend">
      <span style={{ color: 'var(--ink-2)' }}>0%</span>
      <span className="inline-block h-[8px] w-[120px] rounded-[2px]" style={{ background: rampCss(rampKey, dark ? 'dark' : 'light') }} />
      <span style={{ color: 'var(--ink-2)' }}>{mitoHigh}</span>
    </div>
  )
  /**
   * The figure as a file: every panel with its name and n, and the key beside
   * them, on white in print ink, whatever theme it is saved from. Painted
   * again at the size the dpi asks for (the same painter as the screen), so a
   * saved figure is the figure and not an enlarged screenshot.
   */
  const KEY_W = 196
  const cellW = pw + 2 * EDGE, cellH = ph + NAME + EDGE
  const extent = { w: fit.cols * cellW + KEY_W, h: Math.max(fit.rows * cellH, 2 * EDGE + 20 + legend.length * 18
    + (shown === 'type' && uncalled.total > 0 ? 18 + uncalled.by.length * 15 : 0)) }
  const redraw = (out: HTMLCanvasElement, W: number) => {
    const g = out.getContext('2d')
    if (!g) return
    const s = W / extent.w
    const INK = '#000000', INK2 = '#474e5a'
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, out.width, out.height)
    g.textBaseline = 'alphabetic'
    panels.forEach((p, k) => {
      const x = ((k % fit.cols) * cellW + EDGE) * s, y = (Math.floor(k / fit.cols) * cellH + NAME) * s
      const cv = document.createElement('canvas')
      cv.width = Math.round(pw * s); cv.height = Math.round(ph * s)
      const pg = cv.getContext('2d')
      if (!pg) return
      paintEmbedding(pg, {
        d, types, xy: emb.xy, cond: p, colorBy: shown, palKey, rampKey, labels: pw >= 280,
        ink: '#15181d', surface: '#ffffff', sunk: '#ffffff',
        radius: s * markRadius(d, p, pw), pad: s * EDGE, labelPx: s * labelSize(pw),
        keep, mute: '#cfd4da',
      })
      g.drawImage(cv, x, y)
      if (p) {
        g.font = `600 ${12 * s}px system-ui, sans-serif`
        g.fillStyle = INK
        g.fillText(p, x + EDGE * s, y - 6 * s)
        const used = g.measureText(p).width
        g.font = `400 ${12 * s}px system-ui, sans-serif`
        g.fillStyle = INK2
        g.fillText(`n = ${fmt(d.nPerCond[p])}`, x + EDGE * s + used + 8 * s, y - 6 * s)
      }
      // The axis glyph, once, where the screen has it: the file names its
      // two dimensions too.
      if (k === axisAt) {
        const ax = x + 4.5 * s, ay = y + (ph - 4.5) * s
        g.strokeStyle = INK2
        g.lineWidth = s
        g.beginPath()
        g.moveTo(ax, ay - 39.5 * s); g.lineTo(ax, ay); g.lineTo(ax + 39.5 * s, ay)
        g.moveTo(ax - 3 * s, ay - 35.5 * s); g.lineTo(ax, ay - 40.5 * s); g.lineTo(ax + 3 * s, ay - 35.5 * s)
        g.moveTo(ax + 35.5 * s, ay - 3 * s); g.lineTo(ax + 40.5 * s, ay); g.lineTo(ax + 35.5 * s, ay + 3 * s)
        g.stroke()
        g.font = `400 ${11 * s}px system-ui, sans-serif`
        g.fillStyle = INK2
        g.fillText(`${emb.key} 2`, ax + 6.5 * s, ay - 32.5 * s)
        g.fillText(`${emb.key} 1`, ax + 45.5 * s, ay + 3.5 * s)
      }
    })
    // The key: what the colours mean, with n, as on the screen.
    const kx = (fit.cols * cellW + EDGE) * s
    let ky = (EDGE + 12) * s
    g.font = `600 ${12 * s}px system-ui, sans-serif`
    g.fillStyle = INK
    g.fillText(legendName, kx, ky)
    ky += 20 * s
    if (legend.length) {
      for (const [color, label] of legend) {
        // An isolated entry: the others are set aside in the key as on the plot.
        const aside = isolated !== null && label !== isolated
        g.fillStyle = aside ? '#cfd4da' : color
        g.fillRect(kx, ky - 8 * s, 8 * s, 8 * s)
        g.font = `400 ${11 * s}px system-ui, sans-serif`
        g.fillStyle = aside ? INK2 : INK
        g.textAlign = 'left'
        g.fillText(label, kx + 14 * s, ky)
        g.fillStyle = INK2
        g.textAlign = 'right'
        g.fillText(fmt(counts.get(label) ?? 0), kx + (KEY_W - 2 * EDGE) * s, ky)
                g.textAlign = 'left'
        ky += 18 * s
      }
      // The cells the annotator did not call: a row of the key with its count,
      // then the annotator's own labels, so the file's key sums to its panels' n.
      if (shown === 'type' && uncalled.total > 0) {
        g.fillStyle = SENTINEL_GREY
        g.fillRect(kx, ky - 8 * s, 8 * s, 8 * s)
        g.font = `400 ${11 * s}px system-ui, sans-serif`
        g.fillStyle = INK
        g.fillText(NOT_CALLED, kx + 14 * s, ky)
        g.fillStyle = INK2
        g.textAlign = 'right'
        g.fillText(fmt(uncalled.total), kx + (KEY_W - 2 * EDGE) * s, ky)
        g.textAlign = 'left'
        g.font = `400 ${10.5 * s}px system-ui, sans-serif`
        for (const b of uncalled.by) {
          ky += 15 * s
          g.fillText(`${b.name} ${fmt(b.n)}`, kx + 14 * s, ky)
        }
        ky += 18 * s
      }
    } else {
      const bw = 120 * s
      for (let i = 0; i < bw; i++) { g.fillStyle = rampColor(i / bw, rampKey); g.fillRect(kx + i, ky - 8 * s, 1.5, 8 * s) }
      g.font = `400 ${11 * s}px system-ui, sans-serif`
      g.fillStyle = INK2
      g.fillText('0%', kx, ky + 14 * s)
      g.textAlign = 'right'
      g.fillText(mitoHigh, kx + bw, ky + 14 * s)
      g.textAlign = 'left'
    }
  }
  // The head line owns the actions on the figure (Save), at its right end.
  const [actions, setActions] = useState<HTMLElement | null>(null)

  // The axis glyph once per figure: on the bottom-left panel.
  const axisAt = Math.min(panels.length - 1, (fit.rows - 1) * fit.cols)
  const blanks = fit.cols * fit.rows - panels.length

  return (
    <ActionSlot.Provider value={actions}>
    <div className="explorer" data-inspector={inspector ? undefined : 'closed'}>
      <section className="pane" aria-label="Embedding">
        <header className="stage-head">
          <h2 className="stage-title num">{`${fmt(d.nCells)} cells`}</h2>
          <span className="stage-meta">{embeddingHead(src.meta, emb.key)}</span>
          <div ref={setActions} className="stage-actions" />
          {/* Colour is never left without its key: with the inspector closed it sits here. */}
          {!inspector && (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-1" role="group" aria-label={legendName}
              onKeyDown={alongKey}>
              <span className="stage-meta mr-1">{legendName}</span>
              {legend.length > 0 ? legend.map(([color, label]) => entry(color, label, false)) : ramp}
            </div>
          )}
        </header>

        <Figure name={`cells_${emb.key}_by_${shown}${panels.length > 1 ? '_split' : ''}`}
          className="contents" redraw={redraw} extent={extent}>
        <div ref={boxRef} className="plots" data-panels={panels.length > 1 ? 'many' : undefined}
          style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${fit.rows}, minmax(0, 1fr))` }}>
          {panels.map((p, k) => (
            <figure key={p ?? 'all'} className="plot">
              {/* A panel's name sits on its own plot, not in the corner of the cell. */}
              {p && (
                <figcaption className="plot-name" style={{ width: pw, height: NAME - EDGE }}>
                  {p}<span className="num">n = {fmt(d.nPerCond[p])}</span>
                </figcaption>
              )}
              <Scatter
                d={d} types={types} xy={emb.xy} cond={p} colorBy={shown}
                palKey={palKey} rampKey={rampKey} axis={k === axisAt ? emb.key : null} mito={mito}
                w={pw} h={ph} labels={pw >= 280} keep={keep}
              />
            </figure>
          ))}
          {Array.from({ length: blanks }, (_, k) => <div key={`blank-${k}`} className="plot" aria-hidden />)}
        </div>
        </Figure>

        <footer className="stage-foot">
          <p className="m-0 truncate">
            {panels.length > 1
              ? `One shared axis range across all ${panels.length} panels.`
              // In the interface's own words (Cell type, Group, % mito), not the field's key.
              : `Coloured by ${legendName.charAt(0).toLowerCase()}${legendName.slice(1)}.`}
          </p>
          {isolated !== null && (
            <span className="flex items-center gap-2">
              <span className="num">
                Only {isolated}: {fmt(counts.get(isolated) ?? 0)} of {fmt(d.nCells)} cells
              </span>
              <button type="button" className="btn btn-quiet" onClick={() => setOnly(null)}>
                Show all
              </button>
            </span>
          )}
        </footer>
      </section>

      {inspector && (
        <aside className="inspector" aria-label="What the colours mean">
          <section className="ins-section">
            <div className="lg-row">
              <span className="rail-label">{legendName}</span>
              {legend.length > 0 && <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>cells</span>}
            </div>
            {legend.length > 0 ? (
              <div className="legend flex-col items-stretch" style={{ gap: 0, color: 'var(--ink)' }} onKeyDown={alongKey}>
                {legend.map(([color, label]) => entry(color, label, true))}
              </div>
            ) : ramp}
          </section>

          {shown === 'type' && uncalled.total > 0 && (
            <section className="ins-section">
                            {/* A row of the key, with its count, so the key sums to the cells drawn
                  (224 + 16 = 240); not a button, because it is not a cell type to isolate. */}
              <div className="lg-row" data-not-called="">
                                {/* `sw sw-off`: not the markup of a cell type's entry, which the
                    sentinel tests read the legend by (a cell not called is not one). */}
                <span><i className="sw sw-off" style={{ background: SENTINEL_GREY }} />{NOT_CALLED}</span>
                <span className="num">{fmt(uncalled.total)}</span>
              </div>
              <p className="hint m-0" data-fact="not_called">
                {notCalledHint(countText(uncalled), uncalled.total, undrawnOf(emb.xy, d.cells, types))}
              </p>
            </section>
          )}
        </aside>
      )}
    </div>
    </ActionSlot.Provider>
  )
}

/** The cell under the pointer: a grid over this panel's cells in CSS pixels. */
function useNearest(d: Dataset, xy: Float32Array, cond: string | null, w: number, h: number) {
  return useMemo(() => {
    let grid: Map<number, number[]> | null = null
    const S = 8
    const { x0, x1, y0, y1 } = embedExtent(xy)
    const px = (i: number) => EDGE + ((xy[2 * i] - x0) / (x1 - x0)) * (w - 2 * EDGE)
    const py = (i: number) => EDGE + (1 - (xy[2 * i + 1] - y0) / (y1 - y0)) * (h - 2 * EDGE)
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

/**
 * A mark's radius in CSS pixels, from the panel and from how many cells share
 * it: the same ink density at any window size, larger points when there are few.
 */
function markRadius(d: Dataset, cond: string | null, w: number): number {
  let shownCells = d.cells.length
  if (cond) { shownCells = 0; for (const c of d.cells) if (c.cond === cond) shownCells++ }
  const k = Math.max(0.8, Math.min(3.4, (30_000 / Math.max(1, shownCells)) ** 0.25))
  return Math.max(0.7, Math.min(3, (w / 760) * k))
}
const labelSize = (w: number) => Math.max(11, Math.min(14, Math.round(w / 52)))

function Scatter({ d, types, xy, cond, colorBy, palKey, rampKey, w, h, labels, axis, mito, keep }: {
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
  /** The embedding's key, on the one panel that carries the axis glyph. */
  axis: string | null
  mito: boolean
  keep?: (cell: number) => boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null)
  const nearest = useNearest(d, xy, cond, w, h)
  // The painter reads the theme's tokens, so the theme is one of its inputs:
  // a canvas painted in light stayed white on the dark stage after a switch.
  const dark = useDark()

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const css = getComputedStyle(document.documentElement)
    const surface = css.getPropertyValue('--surface').trim()
    const radius = 2 * markRadius(d, cond, w)
    // What is drawn is in lib/embed-paint.ts, where a test can watch it.
    paintEmbedding(g, {
      d, types, xy, cond, colorBy, palKey, rampKey, labels,
      ink: css.getPropertyValue('--ink').trim(),
      surface,
      // The plot's ground is the paper it sits on, never a fill of its own.
      sunk: surface,
      radius, pad: 2 * EDGE,
      labelPx: 2 * labelSize(w),
      keep, mute: css.getPropertyValue('--line-2').trim(),
      ground: dark ? 'dark' : 'light',
    })
  }, [d, types, xy, cond, colorBy, palKey, rampKey, labels, w, h, keep, dark])

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
          + `${labels ? `, with ${populations(types).length} cell type names` : ''}`}
        ref={ref} width={Math.round(w * 2)} height={Math.round(h * 2)}
        style={{ width: w, height: h }}
      />
      {/* The axes are the embedding's own two dimensions, named by its key. */}
      {axis && (
        <svg aria-hidden className="pointer-events-none absolute bottom-0 left-0" width="120" height="48">
          <path d="M4.5 4 V43.5 H44" fill="none" stroke="var(--ink-2)" strokeWidth="1" />
          <path d="M1.5 8 L4.5 3 L7.5 8 M40 40.5 L45 43.5 L40 46.5" fill="none" stroke="var(--ink-2)" strokeWidth="1" />
          <text x="11" y="11" fontSize="11" fill="var(--ink-2)">{axis} 2</text>
          <text x="50" y="47" fontSize="11" fill="var(--ink-2)">{axis} 1</text>
        </svg>
      )}
      {c && tip && (
        <div className="tip" role="status"
          style={{ left: tip.x + 14, top: tip.y + 14, transform: tip.x > w - 200 ? 'translateX(calc(-100% - 28px))' : undefined }}>
          <div className="font-semibold">{types[c.t]?.name ?? c.t}</div>
          <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 num" style={{ color: 'var(--ink-2)' }}>
            {d.multi && <><dt>Group</dt><dd className="m-0" style={{ color: 'var(--ink)' }}>{c.cond}</dd></>}
            <dt>Sample</dt><dd className="m-0" style={{ color: 'var(--ink)' }}>{c.s}</dd>
            {mito && <><dt>% mito</dt><dd className="m-0" style={{ color: 'var(--ink)' }}>{c.mito.toFixed(2)}</dd></>}
          </dl>
        </div>
      )}
    </div>
  )
}
