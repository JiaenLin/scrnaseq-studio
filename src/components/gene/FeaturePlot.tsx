// Expression on the embedding, one panel per gene and optionally per group.

import { useEffect, useMemo, useRef, useState } from 'react'
import { drawFeature, GHOST_DARK, panelHeight, type FeatureDraw } from '../../lib/feature-plot.ts'
import { clusterCentroids, embedExtent, maxOf, nonZeroPercentile } from '../../lib/chart.ts'
import { GHOST_INK, PRINT_PLATE } from '../../lib/figure-ink.ts'
import Figure from '../Figure.tsx'
import { nNote } from '../../lib/figure-foot.ts'
import { geneIndex } from '../../lib/genes.ts'
import { rampCss } from '../../lib/palette.ts'
import { useDark } from '../../lib/theme.ts'
import { useWidth } from '../../lib/use-width.ts'
import type { Cell } from '../../types.ts'
import type { GeneProps } from '../GeneExpression.tsx'

/* ---------------- Seurat feature plot ---------------- */

/** A gene's values and the top of its scale: one per gene, shared by its panels. */
const scaleOf = (src: GeneProps['src'], clip: number, gene: string) => {
  const v = src.vector(gene)
  return { vals: v, top: clip >= 1 ? maxOf(v) : nonZeroPercentile(v, clip) }
}

/** The inputs a panel is drawn from, named, so a memo can list exactly them. */
type PanelOf = Pick<GeneProps, 'emb' | 'src' | 'types' | 'hidden' | 'rampKey' | 'borders'>

/** What one panel draws: the same for the screen, a panel's own Save and the sheet. */
function specOf(
  p: PanelOf, gene: string, cond: string | null, size: number,
  vals: Float32Array, top: number, background: string,
): FeatureDraw {
  const xy = p.emb.xy
  const hidden = p.hidden
  // Names only where a panel is wide enough to carry them.
  const at = size >= 200 ? clusterCentroids(xy, p.src.d, p.types.length) : null
  // The unit is the object's own record of its scale, as on the violin's axis.
  const recorded = p.src.meta.expression
  return {
    xy,
    extent: embedExtent(xy),
    vals,
    cells: p.src.d.cells,
    cond,
    visible: (c: Cell) => !hidden.has(c.t),
    top,
    floor: 0,
    ramp: p.rampKey,
    labels: at
      ? p.types.map((t, ti) => ({ name: t.name, x: at[ti].x, y: at[ti].y }))
        .filter((_l, ti) => !hidden.has(ti) && !p.types[ti].sentinel)
      : null,
    borders: p.borders,
    silhouette: true,
    background,
    title: gene,
    subtitle: cond,
    barLabel: recorded ? `Expression · ${recorded}` : 'Expression',
  }
}

export default function FeaturePlot(p: GeneProps) {
  const split = p.groupBy !== 'type' && p.src.d.multi
  const panels: (string | null)[] = split ? p.src.d.conds : [null]
  const cols = split ? 1 : Math.max(1, Math.min(p.cols, 4))
  // A few groups share the width; twenty of them cannot. Dividing by the count
  // gave 38 px panels on the atlas — every group present and none of them
  // legible. Past four, each panel takes a readable width and the row scrolls,
  // which is the only honest way to show twenty maps of the same embedding.
  // Fitted to the stage: a panel takes the width its column has, up to the
  // drawing's own size (640), so the names on it are read at 1,280 and are not
  // enlarged at 2,560. The width is measured before paint; until it is known
  // the old fixed budget stands in, on the server too.
  const [fitRef, fitW] = useWidth()
  const OWN = 640
  const size = split
    ? (panels.length <= 4
      ? (fitW ? Math.min(OWN, Math.max(180, Math.floor((fitW - 8 * (panels.length - 1)) / panels.length)))
        : Math.max(180, 760 / panels.length))
      : 230)
    : fitW ? Math.min(OWN, Math.max(170, Math.floor((fitW - 18 * (cols - 1)) / cols)))
      : Math.min(320, Math.max(170, 700 / cols))
  const scrolls = split && panels.length > 4
  const anyHidden = p.hidden.size > 0
  const dark = useDark()

  /**
   * The whole sheet as one file, from the head line: every panel repainted in
   * print ink on white at the size the dpi asks for. The feature plots had no
   * Save but each panel's corner glyph, and that one wrote its own icon.
   */
  const perRow = split ? panels.length : Math.min(cols, Math.max(1, p.genes.length))
  const tiles = p.genes.flatMap(g => panels.map(cond => ({ gene: g, cond })))
  const GAP = split ? 8 : 18
  const tileH = panelHeight(size, 1)
  const sheetRows = Math.ceil(tiles.length / perRow)
  const extent = { w: perRow * size + (perRow - 1) * GAP, h: sheetRows * tileH + (sheetRows - 1) * 18 }
  const sheet = (out: HTMLCanvasElement, W: number) => {
    const g = out.getContext('2d')
    if (!g) return
    const s = W / extent.w
    g.fillStyle = PRINT_PLATE
    g.fillRect(0, 0, out.width, out.height)
    const scales = new Map<string, ReturnType<typeof scaleOf>>()
    tiles.forEach((t, k) => {
      const sc = scales.get(t.gene) ?? scaleOf(p.src, p.clip, t.gene)
      scales.set(t.gene, sc)
      const cv = document.createElement('canvas')
      cv.width = Math.round(size * s)
      cv.height = Math.round(tileH * s)
      const cg = cv.getContext('2d')
      if (!cg) return
      drawFeature(cg, cv.width, cv.height,
        { ...specOf(p, t.gene, t.cond, size, sc.vals, sc.top, PRINT_PLATE), px: s }, false)
      g.drawImage(cv, Math.round((k % perRow) * (size + GAP) * s),
        Math.round(Math.floor(k / perRow) * (tileH + 18) * s))
    })
  }

  // n, for the file: every cell of the object is on each map (a group's own
  // cells in colour when split, the rest as the outline).
  const nText = split
    ? nNote(p.src.d.conds.map(c => ({ label: c, n: p.src.d.cells.reduce((n, x) => n + (x.cond === c ? 1 : 0), 0) })))
    : `n = ${p.src.d.nCells.toLocaleString('en-US')} cells`

  return (
    <Figure name={tiles.length > 1 ? 'feature_plots' : `${p.genes[0] ?? 'gene'}_feature`}
      redraw={sheet} extent={extent}
      foot={{ notes: [`${nText}. Embedding ${p.emb.key}. Each gene on its own scale; cells that do not detect it are grey.`] }}
      label={tiles.length > 1 ? 'Save all panels' : 'Save'}>
      <div ref={fitRef} className="grid gap-[18px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${split ? '1fr' : `${size}px`}))` }}>
        {p.genes.map(g => (
          <FeatureRow key={g} p={p} gene={g} panels={panels} size={size} scrolls={scrolls} />
        ))}
      </div>
      <div className="legend mt-3.5">
        <span style={{ color: 'var(--ink-3)' }}>0 · not detected</span>
        <span className="inline-block h-2.5 w-[140px] rounded-[--r-sm]" style={{ background: rampCss(p.rampKey, dark ? 'dark' : 'light') }} />
        <span style={{ color: 'var(--ink-3)' }}>{p.clip === 1 ? 'max' : `${(p.clip * 100).toFixed(0)}th pct`}</span>
        <span style={{ color: 'var(--ink-3)' }}>
          · each gene on its own scale · positive cells drawn last · {nText}
        </span>
        {(split || anyHidden) && (
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
            <i className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: dark ? GHOST_DARK : GHOST_INK, boxShadow: '0 0 0 1px var(--line-2)' }} />
            {anyHidden && split ? 'hidden cells and other groups'
              : anyHidden ? 'hidden cells' : 'the other groups'} , kept as the outline
          </span>
        )}
      </div>
    </Figure>
  )
}

function FeatureRow({ p, gene, panels, size, scrolls }: {
  p: GeneProps; gene: string; panels: (string | null)[]; size: number; scrolls: boolean
}) {
  /**
   * How many panels have painted.
   *
   * Twenty panels over 292 495 cells is close to six million arcs, and every one
   * of them is on the main thread — the row appears blank, then fills, with
   * nothing to say which of those two states the reader is looking at. This is a
   * count of finished panels rather than an indeterminate bar because here the
   * remaining work IS known: the panels are the same size and there are twenty
   * of them, so "8 of 20" is a fact rather than a guess.
   */
  const [drawn, setDrawn] = useState(0)
  useEffect(() => { setDrawn(0) }, [gene, panels.length, size])
  // The whole-dataset values are needed for the shared clip, so compute once here.
  const { src, clip } = p
  const { vals, top } = useMemo(() => scaleOf(src, clip, gene), [gene, src, clip])

  const names = p.src.names
  const accession = names.other?.[geneIndex(names.display).get(gene) ?? -1] ?? null

  return (
    <figure>
      {/* The gene, the group and the scale are drawn INSIDE the canvas now, so
          they travel with the exported file. What stays here is the one thing
          that is reference rather than figure: the accession, which belongs
          beside the plot on screen and in a methods line, not on the plot. */}
      {accession && (
        <figcaption className="mono mb-1 tx-micro" style={{ color: 'var(--ink-3)' }}>
          {accession}
        </figcaption>
      )}
      {panels.length > 1 && drawn < panels.length && (
        <div role="status" className="mb-1.5">
          <div className="flex items-baseline justify-between tx-micro"
            style={{ color: 'var(--ink-3)' }}>
            <span>drawing {panels.length} panels…</span>
            <span className="mono">{drawn} of {panels.length}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--line)' }}>
            <div className="h-full rounded-full"
              style={{ background: 'var(--accent)', width: `${(drawn / panels.length) * 100}%`,
                       transition: 'width 120ms linear' }} />
          </div>
        </div>
      )}
      <div className={scrolls ? 'overflow-x-auto pb-1' : ''}>
      <div className="grid gap-2" style={{
        gridTemplateColumns: `repeat(${panels.length}, ${scrolls ? `${size}px` : 'minmax(0, 1fr)'})`,
      }}>
        {panels.map(pan => (
          <div key={pan ?? 'all'}>
            <FeatureCanvas p={p} vals={vals} top={top} cond={pan} size={size} gene={gene}
              name={`${gene}${pan ? `_${pan}` : ''}_feature`}
              onDrawn={() => setDrawn(n => n + 1)} />
          </div>
        ))}
      </div>
      </div>
    </figure>
  )
}

function FeatureCanvas({ p, vals, top, cond, size, name, gene, onDrawn }: {
  p: GeneProps; vals: Float32Array; top: number; cond: string | null; size: number
  name: string; gene: string
  onDrawn?: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  // Everything the drawing needs, assembled once. `redraw` below hands the same
  // object to an offscreen canvas at export size, which is what keeps the saved
  // figure identical to the one on screen.
  // The theme is an input of the painting: the ground the panel sits on and
  // the end of the scale that recedes both follow it, and a switch repaints.
  const dark = useDark()
  const { emb, src, types, hidden, rampKey, borders } = p
  const spec = useMemo(
    () => specOf({ emb, src, types, hidden, rampKey, borders }, gene, cond, size, vals, top, PRINT_PLATE),
    [emb, src, types, hidden, rampKey, borders, vals, top, cond, size, gene])

  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    // One frame before drawing, so the panel before this one is on screen
    // first. Twenty panels drawn back to back in a single task paint all at
    // once at the end — the row stays blank for the whole time and the progress
    // bar, having no frame to render in, never moves. Yielding costs a frame
    // per panel and buys a row that fills in front of the reader.
    let live = true
    const id = requestAnimationFrame(() => {
      if (!live) return
      // The ground is read as it is now, at the moment of painting.
      const background = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || PRINT_PLATE
      drawFeature(ctx, cv.width, cv.height,
        { ...spec, background, px: cv.width / Math.max(1, cv.clientWidth || size) }, dark)
      onDrawn?.()
    })
    return () => { live = false; cancelAnimationFrame(id) }
    // onDrawn is a fresh closure every render and is not a reason to redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, dark])

  return (
        <Figure
      name={name} compact
      foot={{
        notes: [`${gene}${cond ? `, ${cond}` : ''}: n = ${(cond
          ? p.src.d.cells.reduce((n, x) => n + (x.cond === cond ? 1 : 0), 0)
          : p.src.d.nCells).toLocaleString('en-US')} cells${cond ? ' in colour, the other groups as the outline' : ''}. Embedding ${p.emb.key}.`],
      }}
      redraw={(out, w, h) => {
        const ctx = out.getContext('2d')
        // A figure going into a manuscript is printed on white, whatever theme
        // it was exported from, and the cluster labels have to be legible on it.
        if (ctx) {
          drawFeature(ctx, w, h,
            { ...spec, background: PRINT_PLATE, px: w / Math.max(1, ref.current?.clientWidth || size) }, false)
        }
      }}
    >
      <canvas
        role="img"
        aria-label={`${gene} expression on the embedding`
          + `${cond ? `, ${cond} only` : ''}`}
        ref={ref} width={Math.round(size * 2)} height={panelHeight(Math.round(size * 2), 2)}
        style={{ width: '100%', maxWidth: Math.round(size), height: 'auto' }}
      />
    </Figure>
  )
}

