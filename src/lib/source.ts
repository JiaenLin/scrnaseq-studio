// One interface over "where the numbers come from".
//
// Everything the views need reduces to: the cells, the gene list, and the
// per-cell values of one gene. Both the built-in demo objects and a real bundle
// can answer that, so every figure and every statistic runs the same code
// against either — which means the demo is not a separate rendering path that
// can quietly diverge from the real one.

import type { CellType, Dataset } from '../types.ts'
import { bundleDataset, type Bundle } from './bundle.ts'
import {
  buildDataset, cellExpr, DATASETS, GENES as DEMO_GENES, hash, makeTypes, meanExpr,
} from './demo.ts'

export interface SourceMeta {
  label: string
  /** Where it came from — a file name, or a note that this is synthetic. */
  source: string
  expression: string
  hasRawCounts: boolean
  embedding: string
  /** null values mean "not recorded in the object", and are shown as such. */
  provenance: Record<string, string | null>
  /** Decisions the exporter had to make, surfaced on Overview. */
  notes: string[]
  isDemo: boolean
}

export interface Source {
  meta: SourceMeta
  d: Dataset
  /** Cluster names, in bundle order. */
  clusters: string[]
  /**
   * The clusters as the views want them. A bundle carries only names, so the
   * geometry fields the demo generator uses are zeroed — nothing outside
   * buildDataset reads them, and keeping one shape means no component needs to
   * know which kind of object it is looking at.
   */
  types: CellType[]
  genes: string[]
  /** Dense per-cell values for one gene. Cached; do not mutate. */
  vector(gene: string): Float32Array
  /**
   * The non-zero entries of one gene.
   *
   * Everything statistical is O(non-zeros) rather than O(cells) if it is written
   * this way, and single-cell data is ~1% dense — the difference across 13k
   * genes is a two-second wait versus a two-minute one.
   */
  forEachNonZero(gene: string, cb: (cell: number, value: number) => void): void
  /** Indices of the cells in a cluster, optionally within one group. */
  group(ti: number, cond?: string | null): Int32Array
  mean(gene: string, ti: number, cond?: string | null): number
  /** Fraction of cells with a non-zero value. */
  pct(gene: string, ti: number, cond?: string | null): number
  /** Values for a violin, subsampled evenly when the group is large. */
  values(gene: string, ti: number, cond?: string | null, max?: number): number[]
  pseudobulk: Bundle['pseudobulk']
}

/** Small cache — enough for a gene panel, bounded so a long session cannot grow. */
function memo<T>(limit: number) {
  const m = new Map<string, T>()
  return (key: string, make: () => T): T => {
    const hit = m.get(key)
    if (hit !== undefined) return hit
    const val = make()
    if (m.size >= limit) m.delete(m.keys().next().value as string)
    m.set(key, val)
    return val
  }
}

function baseSource(
  d: Dataset, types: CellType[], genes: string[], meta: SourceMeta,
  vector: (gene: string) => Float32Array,
  nonZero: (gene: string, cb: (cell: number, value: number) => void) => void,
  pseudobulk: Bundle['pseudobulk'],
): Source {
  const vecCache = memo<Float32Array>(64)
  const grpCache = memo<Int32Array>(256)

  const src: Source = {
    meta, d, types, genes, pseudobulk,
    clusters: types.map(t => t.name),

    vector: (gene) => vecCache(gene, () => vector(gene)),

    forEachNonZero: (gene, cb) => nonZero(gene, cb),

    group: (ti, cond) => grpCache(`${ti}|${cond ?? '*'}`, () => {
      const out: number[] = []
      for (let i = 0; i < d.cells.length; i++) {
        const c = d.cells[i]
        if (c.t === ti && (!cond || c.cond === cond)) out.push(i)
      }
      return Int32Array.from(out)
    }),

    mean(gene, ti, cond) {
      const v = this.vector(gene)
      const idx = this.group(ti, cond)
      if (!idx.length) return 0
      let s = 0
      for (let k = 0; k < idx.length; k++) s += v[idx[k]]
      return s / idx.length
    },

    pct(gene, ti, cond) {
      const v = this.vector(gene)
      const idx = this.group(ti, cond)
      if (!idx.length) return 0
      let n = 0
      for (let k = 0; k < idx.length; k++) if (v[idx[k]] > 0) n++
      return n / idx.length
    },

    values(gene, ti, cond, max = 400) {
      const v = this.vector(gene)
      const idx = this.group(ti, cond)
      // An even stride rather than a random sample: the density has to be stable
      // across redraws or the violins shimmer when an unrelated control changes.
      const step = Math.max(1, Math.floor(idx.length / max))
      const out: number[] = []
      for (let k = 0; k < idx.length; k += step) out.push(v[idx[k]])
      return out
    },
  }
  return src
}

/* ---------------- the built-in demo objects ---------------- */

export function demoSource(key: string): Source {
  const types = makeTypes()
  const d = buildDataset(key, types)
  const spec = DATASETS[key] ?? DATASETS.cohort
  const vector = (gene: string): Float32Array => {
    const gh = hash(gene)
    const out = new Float32Array(d.cells.length)
    for (let i = 0; i < d.cells.length; i++) {
      const c = d.cells[i]
      out[i] = cellExpr(gh, i, meanExpr(gene, c.t, c.a))
    }
    return out
  }
  const nonZero = (gene: string, cb: (cell: number, value: number) => void) => {
    const v = vecOf(gene)
    for (let i = 0; i < v.length; i++) if (v[i] > 0) cb(i, v[i])
  }
  const cache = new Map<string, Float32Array>()
  function vecOf(gene: string): Float32Array {
    let v = cache.get(gene)
    if (!v) { v = vector(gene); cache.set(gene, v) }
    return v
  }
  return baseSource(d, types, DEMO_GENES, {
    label: spec.label,
    source: `${spec.file} — a built-in demo object, not a file you opened`,
    expression: 'log1p(CP10K)',
    hasRawCounts: true,
    embedding: 'X_umap',
    provenance: {
      normalization: 'log1p(CP10K)', clustering: 'leiden, resolution 1.0',
      integration: d.samples.length > 1 ? 'harmony' : null,
      doublets: null, ambient: null,
    },
    notes: [
      'This is a synthetic object generated in the browser so every view has '
      + 'something to draw. Open a bundle to work with real data.',
    ],
    isDemo: true,
  }, vecOf, nonZero, null)
}

/* ---------------- a real bundle ---------------- */

export function bundleSource(b: Bundle): Source {
  const d = bundleDataset(b)
  const index = new Map(b.genes.map((g, i) => [g.toUpperCase(), i]))
  const n = b.meta.nCells

  const vector = (gene: string): Float32Array => {
    const gi = index.get(gene.toUpperCase())
    const out = new Float32Array(n)
    if (gi === undefined) return out
    // One contiguous CSC slice — the reason the bundle is gene-major.
    for (let k = b.indptr[gi]; k < b.indptr[gi + 1]; k++) out[b.indices[k]] = b.data[k]
    return out
  }

  const nonZero = (gene: string, cb: (cell: number, value: number) => void) => {
    const gi = index.get(gene.toUpperCase())
    if (gi === undefined) return
    for (let k = b.indptr[gi]; k < b.indptr[gi + 1]; k++) cb(b.indices[k], b.data[k])
  }

  const types: CellType[] = b.meta.clusters.map(name => ({
    name, key: name, cx: 0, cy: 0, sd: 0, base: 0, resp: 0, mk: [],
  }))

  return baseSource(d, types, b.genes, {
    label: b.meta.label,
    source: b.meta.source,
    expression: b.meta.expression,
    hasRawCounts: b.meta.hasRawCounts,
    embedding: b.meta.embedding,
    provenance: b.meta.provenance ?? {},
    notes: b.meta.notes ?? [],
    isDemo: false,
  }, vector, nonZero, b.pseudobulk)
}
