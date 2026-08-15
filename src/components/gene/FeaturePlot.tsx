// Expression on the embedding, one panel per gene and optionally per group.

import { useEffect, useMemo, useRef, useState } from 'react'
import { drawFeature, panelHeight } from '../../lib/feature-plot.ts'
import { clusterCentroids, embedExtent, maxOf, nonZeroPercentile } from '../../lib/chart.ts'
import { GHOST_INK, PLATE } from '../../lib/figure-ink.ts'
import Figure from '../Figure.tsx'
import { geneIndex } from '../../lib/genes.ts'
import { rampCss } from '../../lib/palette.ts'
import type { Cell } from '../../types.ts'
import type { GeneProps } from '../GeneExpression.tsx'

/* ---------------- Seurat feature plot ---------------- */

export default function FeaturePlot(p: GeneProps) {
  const split = p.groupBy !== 'type' && p.src.d.multi
  const panels: (string | null)[] = split ? p.src.d.conds : [null]
  const cols = split ? 1 : Math.max(1, Math.min(p.cols, 4))
  // A few groups share the width; twenty of them cannot. Dividing by the count
  // gave 38 px panels on the atlas — every group present and none of them
  // legible. Past four, each panel takes a readable width and the row scrolls,
  // which is the only honest way to show twenty maps of the same embedding.
  const size = split
    ? (panels.length <= 4 ? Math.max(180, 760 / panels.length) : 230)
    : Math.min(320, Math.max(170, 700 / cols))
  const scrolls = split && panels.length > 4
  const anyHidden = p.hidden.size > 0

  return (
    <>
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {p.genes.map(g => (
          <FeatureRow key={g} p={p} gene={g} panels={panels} size={size} scrolls={scrolls} />
        ))}
      </div>
      <div className="legend mt-3.5">
        <span style={{ color: 'var(--ink-3)' }}>0 · not detected</span>
        <span className="inline-block h-2.5 w-[140px] rounded-[--r-sm]" style={{ background: rampCss(p.rampKey) }} />
        <span style={{ color: 'var(--ink-3)' }}>{p.clip === 1 ? 'max' : `${(p.clip * 100).toFixed(0)}th pct`}</span>
        <span style={{ color: 'var(--ink-3)' }}>
          · each gene on its own scale · positive cells drawn last
        </span>
        {(split || anyHidden) && (
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: GHOST_INK }} />
            {anyHidden && split ? 'hidden cells and other groups'
              : anyHidden ? 'hidden cells' : 'the other groups'} — kept as the outline
          </span>
        )}
      </div>
    </>
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
  const { vals, top } = useMemo(() => {
    const v = p.src.vector(gene)
    // Clipped at a percentile of the expressing cells, so one runaway cell
    // cannot flatten every other panel to the floor colour. SCpubr exposes this
    // as max.cutoff for the same reason, and like it, values above the ceiling
    // are drawn at the ceiling rather than dropped.
    return { vals: v, top: p.clip >= 1 ? maxOf(v) : nonZeroPercentile(v, p.clip) }
  }, [gene, p.src, p.clip])

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
  const spec = useMemo(() => {
    const xy = p.emb.xy
    const hidden = p.hidden
    const at = size >= 200 ? clusterCentroids(xy, p.src.d, p.types.length) : null
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
          .filter((_l, ti) => !hidden.has(ti))
        : null,
      borders: p.borders,
      silhouette: true,
      background: getComputedStyle(document.documentElement)
        .getPropertyValue('--surface').trim() || PLATE,
      title: gene,
      subtitle: cond,
    }
  }, [p.emb, p.src, p.types, p.hidden, p.rampKey, p.borders, vals, top, cond, size, gene])

  const dark = useMemo(
    () => document.documentElement.classList.contains('dark')
      || matchMedia('(prefers-color-scheme: dark)').matches, [])

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
      drawFeature(ctx, cv.width, cv.height, spec, dark)
      onDrawn?.()
    })
    return () => { live = false; cancelAnimationFrame(id) }
    // onDrawn is a fresh closure every render and is not a reason to redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, dark])

  return (
    <Figure
      name={name}
      redraw={(out, w, h) => {
        const ctx = out.getContext('2d')
        // A figure going into a manuscript is printed on white, whatever theme
        // it was exported from, and the cluster labels have to be legible on it.
        if (ctx) drawFeature(ctx, w, h, { ...spec, background: PLATE }, false)
      }}
    >
      <canvas
        role="img"
        aria-label={`${gene} expression on the embedding`
          + `${cond ? `, ${cond} only` : ''}`}
        ref={ref} width={Math.round(size * 2)} height={panelHeight(Math.round(size * 2))}
        style={{ width: '100%', maxWidth: Math.round(size), height: 'auto', borderRadius: 'var(--r-md)' }}
      />
    </Figure>
  )
}

