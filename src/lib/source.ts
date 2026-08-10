// One interface over "where the numbers come from".
//
// Everything the views need reduces to: the cells, the gene list, and the
// per-cell values of one gene. Both the built-in demo objects and a real bundle
// can answer that, so every figure and every statistic runs the same code
// against either — which means the demo is not a separate rendering path that
// can quietly diverge from the real one.

import type { CellType, Dataset } from '../types.ts'
import { bundleDataset, type Bundle, type Embedding } from './bundle.ts'
import { makeGeneNames, type GeneNames } from './genes.ts'
import type { MatrixPlan } from './part-scan.ts'
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

/** Walks one gene's non-zero entries. Valid only for the duration of the call. */
export type NonZeroWalk = (cb: (cell: number, value: number) => void) => void

/**
 * Called once per gene by a scan, with a walker over that gene's values.
 *
 * The gene arrives as its index into `genes`, not as its name. A scan is the
 * hot loop of every whole-transcriptome view, and an index is what both a
 * result row and a worker message want to carry; `src.genes[i]` is there for
 * the one caller that needs the string.
 */
export type GeneVisit = (gene: number, each: NonZeroWalk) => void

/**
 * Which groups a figure or a test is asking about.
 *
 * A single level, several unioned, or null for every cell of the cell type. The
 * several-unioned case is what lets a time course be read as early versus late
 * without re-exporting the object under a coarser grouping — the levels the lab
 * wrote stay as they are, and the reader decides which of them go together.
 */
export type Conds = string | readonly string[] | null | undefined

/**
 * Cache key for a condition selection, order-independent for a set.
 *
 * JSON rather than a joined string: a separator is a bet that no condition name
 * contains it, and ["a","b|c"] and ["a|b","c"] joining to one key would hand a
 * group's cells to another group. A single condition keys to itself — the key
 * this cache has always used — so nothing that existed before gets a new entry.
 */
export const condKey = (cond: Conds): string =>
  (cond == null ? '*' : typeof cond === 'string' ? cond : JSON.stringify([...cond].sort()))

export interface Source {
  meta: SourceMeta
  d: Dataset
  /**
   * True when gene values live in the file rather than in memory, so they must
   * be awaited (`ensure`, `scan`) before the synchronous accessors can answer.
   */
  lazy: boolean
  /** How many bundles the object is stored in. 1 unless it is a collection. */
  nParts: number
  /**
   * The file, and where every gene lives in it — everything a second thread
   * would need to answer a whole-transcriptome question without this Source.
   *
   * null when the values are already in memory, which is exactly the case where
   * handing the work to a worker would cost more than doing it. So this being
   * non-null IS the condition for using the compute engine; there is no separate
   * flag to keep in step with it.
   */
  remote: { file: Blob; plan: MatrixPlan } | null
  /** Cluster names, in bundle order. */
  clusters: string[]
  /**
   * The clusters as the views want them. A bundle carries only names, so the
   * geometry fields the demo generator uses are zeroed — nothing outside
   * buildDataset reads them, and keeping one shape means no component needs to
   * know which kind of object it is looking at.
   */
  types: CellType[]
  /**
   * What every gene is called, in row order.
   *
   * The DISPLAY name, which on an accession-indexed object with symbols in it
   * is the symbol — see genes.ts. Every accessor below is keyed by these, so
   * there is one vocabulary in the studio and no view has to know which kind of
   * object it is looking at.
   */
  genes: string[]
  /** Both namings of every row, for searching and for showing the accession. */
  names: GeneNames
  /**
   * Every 2D embedding the object carried, the default first. Never empty.
   *
   * embeddings[0].xy is the same geometry as `d.cells[i].x/.y`; the others are
   * the same cells in the same order, so switching is a change of coordinates
   * and nothing else — no index, no cache and no computed result depends on it.
   */
  embeddings: Embedding[]
  /** Dense per-cell values for one gene. Cached; do not mutate. */
  vector(gene: string): Float32Array
  /**
   * Whether the accessors above can answer for this gene right now.
   *
   * Always true for an object held in memory, and true for a gene the object
   * does not carry — zero is that gene's whole answer and nothing has to be
   * read for it. It is false only for a gene of a collection that is not in
   * memory, and that case is why this exists: without it an evicted gene and a
   * gene nobody expresses are the same all-zero vector, and a dot plot draws
   * the difference as fact.
   */
  resident(gene: string): boolean
  /**
   * The non-zero entries of one gene.
   *
   * Everything statistical is O(non-zeros) rather than O(cells) if it is written
   * this way, and single-cell data is ~1% dense — the difference across 13k
   * genes is a two-second wait versus a two-minute one.
   */
  forEachNonZero(gene: string, cb: (cell: number, value: number) => void): void
  /** Indices of the cells in a cluster, optionally within one group. */
  group(ti: number, cond?: Conds): Int32Array
  mean(gene: string, ti: number, cond?: Conds): number
  /** Fraction of cells with a non-zero value. */
  pct(gene: string, ti: number, cond?: Conds): number
  /** Values for a violin, subsampled evenly when the group is large. */
  values(gene: string, ti: number, cond?: Conds, max?: number): number[]
  pseudobulk: Bundle['pseudobulk']
  /**
   * Make these genes answerable by the synchronous accessors above.
   *
   * A no-op for an object held in memory. For a collection it reads each gene's
   * chunk out of the file — so a view that draws a gene awaits this first, and
   * then behaves exactly as it does for a small object.
   *
   * All of them or none of them. A collection holds a bounded number of gene
   * vectors, and a request past that throws rather than resolving with some of
   * the genes silently reading as zero — a partial answer is indistinguishable
   * from a gene nobody expresses, which is the one failure a figure cannot
   * show. Ask for a panel here; ask for a marker plot's hundreds through
   * `withGenes`, which does not have to hold them at once.
   */
  ensure(genes: readonly string[]): Promise<void>
  /**
   * Read a gene set larger than the object will hold, one window at a time.
   *
   * `visit` is called once per window, and every gene in that window is
   * resident for exactly the duration of that call — so it must not await.
   * Every gene the object can answer for appears in exactly one window, but the
   * windows are chosen for how the file is laid out rather than for the order
   * asked in: `at[k]` is where `window[k]` sat in `genes`.
   *
   * This is the shape a dot plot wants. A grid is an accumulation, so it never
   * needs every column resident at once, and the window a pass has finished
   * with is released before the next is read — which also keeps a marker plot
   * from evicting the panel another tab is drawing.
   */
  withGenes(
    genes: readonly string[],
    visit: (window: readonly string[], at: Int32Array) => void,
  ): Promise<void>
  /**
   * Walk every gene, once, in whatever order is cheapest for this source.
   *
   * This is what the whole-transcriptome views run on. Nothing is retained
   * between genes, so a 43-part atlas costs one forward pass over the file
   * rather than the matrix in memory.
   */
  scan(
    visit: GeneVisit,
    onProgress?: (done: number, total: number) => void,
    cancelled?: () => boolean,
  ): Promise<void>
  /**
   * The same walk, synchronously — false when this source cannot do it.
   *
   * Kept so that an in-memory object computes inside one render, exactly as it
   * did before collections existed: no spinner, no frame where the figure is
   * missing.
   */
  scanSync(visit: GeneVisit): boolean
}

/**
 * Small cache — enough for a gene panel, bounded so a long session cannot grow.
 *
 * Bounded two ways, because the two things that run away are different sizes. A
 * demo object's vector is a few kilobytes and only the count matters; one
 * vector of the 292 495-cell atlas is 1.2 MB, so sixty-four of them are 75 MB
 * parked to speed up a cache that a dot plot rotates completely on every pass.
 */
function memo<T>(limit: number, bytesOf?: (v: T) => number, maxBytes = Infinity) {
  const m = new Map<string, T>()
  let bytes = 0
  return (key: string, make: () => T): T => {
    const hit = m.get(key)
    if (hit !== undefined) return hit
    const val = make()
    m.set(key, val)
    bytes += bytesOf?.(val) ?? 0
    for (const [k, v] of m) {
      if ((m.size <= limit && bytes <= maxBytes) || m.size <= 1) break
      m.delete(k)
      bytes -= bytesOf?.(v) ?? 0
    }
    return val
  }
}

/** Dense per-cell vectors kept for the panel. One atlas vector is 1.2 MB. */
const VEC_BUDGET = 24 << 20

/**
 * The half of a Source that is the same however the values are stored.
 *
 * Exported so a collection can build on it and then replace exactly the things
 * that differ — `ensure`, `withGenes`, `scan`, `scanSync`, and the residency
 * the accessors turn on — rather than reimplement grouping, means and violin
 * sampling and slowly disagree with this file.
 */
export function baseSource(
  d: Dataset, types: CellType[], names: GeneNames, meta: SourceMeta,
  vector: (gene: string) => Float32Array,
  nonZero: (gene: string, cb: (cell: number, value: number) => void) => void,
  pseudobulk: Bundle['pseudobulk'],
  embeddings: Embedding[],
  resident: (gene: string) => boolean = () => true,
): Source {
  const vecCache = memo<Float32Array>(64, v => v.byteLength, VEC_BUDGET)
  const grpCache = memo<Int32Array>(256)
  const genes = names.display

  const src: Source = {
    meta, d, types, genes, names, embeddings, pseudobulk,
    lazy: false, nParts: 1, remote: null,
    clusters: types.map(t => t.name),

    resident,

    // A gene that is not resident still answers, because a render must not
    // throw — but that answer is zeros meaning "not read", so it is never kept:
    // cached once, the gene would stay empty for the rest of the session even
    // after it is back.
    vector: (gene) => (resident(gene) ? vecCache(gene, () => vector(gene)) : vector(gene)),

    forEachNonZero: (gene, cb) => nonZero(gene, cb),

    ensure: () => Promise.resolve(),

    withGenes(list, visit) {
      visit(list, Int32Array.from(list, (_g, i) => i))
      return Promise.resolve()
    },

    scanSync(visit) {
      for (let i = 0; i < genes.length; i++) visit(i, cb => nonZero(genes[i], cb))
      return true
    },

    async scan(visit, onProgress, cancelled) {
      // Chunked only so that progress can paint and Escape can be honoured; the
      // values are already here, so the batch size is about the event loop, not
      // about memory.
      const STEP = 512
      for (let i = 0; i < genes.length; i += STEP) {
        if (cancelled?.()) return
        const end = Math.min(genes.length, i + STEP)
        for (let g = i; g < end; g++) visit(g, cb => nonZero(genes[g], cb))
        onProgress?.(end, genes.length)
        await new Promise(r => setTimeout(r, 0))
      }
    },

    // One condition, or several unioned. The union is taken inside this scan
    // rather than by concatenating two results, deliberately: cells come out in
    // ascending index order either way, which is what everything downstream
    // assumes and what keeps a float sum reproducible. A single condition takes
    // the identical branch under the identical cache key it always did, so
    // every comparison that existed before this is bit-for-bit what it was.
    group: (ti, cond) => grpCache(`${ti}|${condKey(cond)}`, () => {
      const set = cond != null && typeof cond !== 'string' ? new Set(cond) : null
      const out: number[] = []
      for (let i = 0; i < d.cells.length; i++) {
        const c = d.cells[i]
        const here = set ? set.has(c.cond) : !cond || c.cond === cond
        if (c.t === ti && here) out.push(i)
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
  // The generator places cells directly, so the embedding has to be read back
  // out of them — this is the one Source whose coordinates were never a file.
  const xy = new Float32Array(d.cells.length * 2)
  d.cells.forEach((c, i) => { xy[2 * i] = c.x; xy[2 * i + 1] = c.y })

  return baseSource(d, types, makeGeneNames(DEMO_GENES, null), {
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
  }, vecOf, nonZero, null, [{ key: 'X_umap', xy }])
}

/* ---------------- a real bundle ---------------- */

export function bundleSource(b: Bundle): Source {
  const d = bundleDataset(b)
  const names = makeGeneNames(b.genes, b.alias, {
    idKind: b.meta.geneIdKind,
    aliasKind: b.meta.geneAlias?.kind,
    aliasColumn: b.meta.geneAlias?.column,
    missing: b.meta.geneAlias?.missing,
  })
  // Keyed by the DISPLAY name, so a row that is shown as Sox2 is also fetched as
  // Sox2 and there is no second vocabulary anywhere below this line.
  const index = new Map(names.display.map((g, i) => [g.toUpperCase(), i]))
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

  return baseSource(d, types, names, {
    label: b.meta.label,
    source: b.meta.source,
    expression: b.meta.expression,
    hasRawCounts: b.meta.hasRawCounts,
    embedding: b.meta.embedding,
    provenance: b.meta.provenance ?? {},
    notes: b.meta.notes ?? [],
    isDemo: false,
    // Row-aligned with genes.txt, so it takes the display name too — an exported
    // pseudobulk matrix must not be the one table still in accessions.
  }, vector, nonZero, b.pseudobulk && { ...b.pseudobulk, genes: names.display }, b.embeds)
}
