// Reading a bundle.
//
// The format is written by tools/export_h5ad.py and tools/export_seurat.R and
// documented in tools/BUNDLE.md. Everything here is validation: a bundle that
// half-loads is worse than one that refuses, because the app would then render
// figures from whatever survived.

import { unzipSync } from 'fflate'
import type { Cell, Dataset, SampleRow } from '../types.ts'
import type { GeneIdKind } from './genes.ts'

export const SCHEMA = 'scrnaseq-studio/bundle@1'

/** One 2D embedding, interleaved x,y, two values per cell. */
export interface Embedding { key: string; xy: Float32Array }

/**
 * One further categorical column, one level index per cell.
 *
 * The bundle has always carried exactly three of these — cluster, sample,
 * condition — because those are the three every view is built on. This is the
 * rest of what the object knows about a cell: the dissection it came from as
 * well as its age, the Class above its Subclass. None of them is a role, so
 * none is renamed — `key` is the column's own name in the object, and that is
 * what the menus say.
 */
export interface ExtraColumn {
  key: string
  levels: string[]
  /** Level index per cell, aligned with cluster.u16. */
  codes: Uint16Array
}

/**
 * The columns of a Dataset that `Dataset` itself does not describe.
 *
 * A Dataset is built by three different producers — the demo generator, a
 * bundle, a collection — and only the last two can have any of this. So it is
 * attached where it exists and read through one accessor that answers "none"
 * for everything else, which is also what every bundle written before today
 * gets: the figures then behave exactly as they did.
 *
 * `cond` is the object's own name for the condition column. The studio calls it
 * "Group" because it has to call it something, but the object usually knows
 * better — on a developmental atlas the groups are Age — and a menu saying the
 * object's own word is a menu that needs no explaining. Cell type and sample
 * keep the studio's words: those two are its whole vocabulary, spoken in every
 * caption on the page.
 */
export interface CellColumns {
  cond: string | null
  extras: ExtraColumn[]
}

const NO_COLUMNS: CellColumns = { cond: null, extras: [] }

export function cellColumns(d: Dataset): CellColumns {
  return (d as Dataset & { columns?: CellColumns }).columns ?? NO_COLUMNS
}

export interface BundleMeta {
  schema: string
  label: string
  source: string
  nCells: number
  nGenes: number
  nnz: number
  clusters: string[]
  samples: { id: string; condition: string }[]
  conditions: string[]
  /**
   * Further categorical columns, each in its own `extra.<name>.u16` entry.
   *
   * Absent in bundles written before today, which reads the same as empty. The
   * entry names are written by the exporter and must be read from here, not
   * rebuilt from the key.
   */
  extras?: { key: string; file: string; levels: string[] }[]
  embedding: string
  expression: string
  hasRawCounts: boolean
  provenance: Record<string, string | null>
  notes: string[]
  /**
   * Genes per block in expr.chunk.bin, when the exporter wrote one.
   *
   * Absent in bundles written before chunked expression existed, and unused
   * when the whole matrix is loaded — a collection reads it, because a part
   * written with a different block size must still open.
   */
  chunkGenes?: number
  /**
   * Every 2D embedding the object carried, the default first.
   *
   * `embeddings[0].file` is always `embed.f32` and `embeddings[0].key` is always
   * `embedding`, so a reader that ignores this field still opens the bundle it
   * always opened. Absent in bundles written before more than one was carried —
   * then there is exactly one, `embed.f32`, named by `embedding`.
   *
   * The entry names are sanitised by the exporter and must be read from here,
   * not rebuilt from the key.
   */
  embeddings?: { key: string; file: string }[]
  /** What `genes.txt` holds. Absent ⇒ unknown, which is NOT the same as 'symbol'. */
  geneIdKind?: GeneIdKind
  /**
   * The other naming of the same genes, when the object carried one.
   *
   * `missing` rows had no alias and repeat `genes.txt`, so the file is always a
   * usable label. `duplicated` rows share an alias with another row and NOTHING
   * IS MERGED — see makeGeneNames in genes.ts for what is done with them.
   */
  geneAlias?: {
    kind: 'symbol' | 'accession'
    column: string
    file: string
    missing: number
    duplicated: number
  } | null
}

/** Summed raw counts, one column per sample × cluster. */
export interface Pseudobulk {
  genes: string[]
  /** Column headers, parsed from `sample||cluster||nCells`. */
  columns: { sample: string; cluster: string; nCells: number }[]
  /** counts[geneIndex][columnIndex]. */
  counts: Int32Array
}

export interface Bundle {
  meta: BundleMeta
  genes: string[]
  /** Gene-major CSC over cells. */
  indptr: Int32Array
  indices: Int32Array
  data: Float32Array
  cluster: Uint16Array
  sample: Uint16Array
  /** Interleaved x,y per cell — the default embedding, same array as embeds[0].xy. */
  embed: Float32Array
  /** Every embedding the object carried, the default first. Never empty. */
  embeds: Embedding[]
  /** Every categorical column beyond cluster, sample and condition. */
  extras: ExtraColumn[]
  /**
   * The other naming of each gene, aligned by index with `genes`.
   *
   * null when the object had one naming only. Never blank on any row: where the
   * object had no alias the exporter repeats the row's own name.
   */
  alias: string[] | null
  /** Interleaved counts, genes, mito% per cell. */
  qc: Float32Array
  pseudobulk: Pseudobulk | null
}

class BundleError extends Error {}
const fail = (msg: string): never => { throw new BundleError(msg) }

const need = (files: Record<string, Uint8Array>, name: string): Uint8Array =>
  files[name] ?? fail(`the bundle has no ${name} — was it made by tools/export_*?`)

/** A typed view that copies, because the unzip buffer is not aligned. */
const view = <T>(
  Ctor: new (buf: ArrayBuffer) => T, bytes: Uint8Array, per: number, name: string,
): T => {
  if (bytes.byteLength % per !== 0) {
    fail(`${name} is ${bytes.byteLength} bytes, not a multiple of ${per}`)
  }
  return new Ctor(bytes.slice().buffer)
}

export function parseBundle(buf: ArrayBuffer): Bundle {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buf))
  } catch {
    return fail('this file is not a zip — open a bundle made by tools/export_h5ad.py or tools/export_seurat.R, not the .h5ad or .rds itself')
  }

  const meta = JSON.parse(new TextDecoder().decode(need(files, 'meta.json'))) as BundleMeta
  if (meta.schema !== SCHEMA) {
    fail(`this bundle says schema ${meta.schema ?? '(none)'}; this app reads ${SCHEMA}`)
  }

  // The exporters write LF with no trailing newline, but a bundle edited by hand
  // or produced elsewhere may not — so tolerate CRLF and a trailing blank rather
  // than silently carrying a "\r" on every symbol, which makes every lookup miss.
  const genes = new TextDecoder().decode(need(files, 'genes.txt'))
    .split('\n').map(g => g.replace(/\r$/, '')).filter(g => g.length > 0)
  if (genes.length !== meta.nGenes) {
    fail(`genes.txt has ${genes.length} names but meta says ${meta.nGenes}`)
  }

  const indptr = view(Int32Array, need(files, 'expr.indptr.i32'), 4, 'expr.indptr.i32')
  const indices = view(Int32Array, need(files, 'expr.indices.i32'), 4, 'expr.indices.i32')
  const data = view(Float32Array, need(files, 'expr.data.f32'), 4, 'expr.data.f32')
  const cluster = view(Uint16Array, need(files, 'cluster.u16'), 2, 'cluster.u16')
  const sample = view(Uint16Array, need(files, 'sample.u16'), 2, 'sample.u16')
  const embed = view(Float32Array, need(files, 'embed.f32'), 4, 'embed.f32')
  const qc = view(Float32Array, need(files, 'qc.f32'), 4, 'qc.f32')

  const n = meta.nCells
  if (indptr.length !== meta.nGenes + 1) fail(`expr.indptr has ${indptr.length} entries, expected ${meta.nGenes + 1}`)
  if (indptr[indptr.length - 1] !== indices.length) fail('expr.indptr does not end at the number of stored values')
  if (indices.length !== data.length) fail('expr.indices and expr.data are different lengths')
  if (cluster.length !== n || sample.length !== n) fail('cluster/sample arrays do not match nCells')
  if (embed.length !== 2 * n) fail(`embed.f32 has ${embed.length} values, expected ${2 * n}`)
  if (qc.length !== 3 * n) fail(`qc.f32 has ${qc.length} values, expected ${3 * n}`)
  if (!meta.clusters?.length) fail('the bundle has no clusters')
  if (!meta.samples?.length) fail('the bundle has no samples')

  // A cell index outside the matrix would read another gene's values, which is
  // the kind of wrongness that renders instead of throwing.
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] < 0 || indices[i] >= n) fail('expr.indices contains a cell index outside the matrix')
  }
  const maxCluster = meta.clusters.length - 1
  for (let i = 0; i < n; i++) {
    if (cluster[i] > maxCluster) fail('cluster.u16 refers to a cluster that meta.json does not define')
    if (sample[i] >= meta.samples.length) fail('sample.u16 refers to a sample that meta.json does not define')
  }

  return {
    meta, genes, indptr, indices, data, cluster, sample, embed, qc,
    embeds: readEmbeddings(files, meta, embed, n),
    extras: readExtras(files, meta, n),
    alias: readAlias(files, meta, genes),
    pseudobulk: files['pseudobulk.tsv']
      ? parsePseudobulk(new TextDecoder().decode(files['pseudobulk.tsv']), meta.nGenes)
      : null,
  }
}

/**
 * The default embedding, then every other one the object carried.
 *
 * A missing or malformed alternative fails the open rather than quietly
 * offering a menu entry that draws the wrong points: the whole promise of the
 * switcher is that two views of the same cells are the same cells.
 */
function readEmbeddings(
  files: Record<string, Uint8Array>, meta: BundleMeta, embed: Float32Array, n: number,
): Embedding[] {
  const listed = meta.embeddings ?? []
  const out: Embedding[] = [{ key: listed[0]?.key ?? meta.embedding, xy: embed }]
  for (const e of listed.slice(1)) {
    // The exporter never points a second entry at embed.f32, but a hand-edited
    // meta.json could — and reading it twice would put one embedding on the menu
    // under two names.
    if (!e?.file || e.file === 'embed.f32') continue
    const bytes = files[e.file]
      ?? fail(`meta.json lists the embedding "${e.key}" in ${e.file}, which this bundle does not contain`)
    const xy = view(Float32Array, bytes, 4, e.file)
    if (xy.length !== 2 * n) {
      fail(`${e.file} has ${xy.length} values, expected ${2 * n} for ${n} cells`)
    }
    out.push({ key: e.key, xy })
  }
  return out
}

/**
 * The extra categorical columns, in the order the exporter wrote them.
 *
 * A malformed one fails the open rather than being dropped. A dropped column is
 * a menu entry that silently does not appear, and the reader is then left
 * wondering whether the object ever had a dissection at all — which is a worse
 * answer than a sentence naming the file that is wrong.
 */
function readExtras(
  files: Record<string, Uint8Array>, meta: BundleMeta, n: number,
): ExtraColumn[] {
  const out: ExtraColumn[] = []
  // Array.isArray, not ?? — an exporter that writes an empty object where a
  // list belongs would otherwise throw inside a for…of, which is a stack trace
  // rather than a sentence.
  for (const e of Array.isArray(meta.extras) ? meta.extras : []) {
    if (!e?.file || !e.key) fail('meta.json lists an extra column with no name or no file')
    const codes = view(Uint16Array, need(files, e.file), 2, e.file)
    if (codes.length !== n) {
      fail(`${e.file} has ${codes.length} values, expected one per cell for ${n} cells`)
    }
    const levels = e.levels ?? []
    if (!levels.length) fail(`the extra column "${e.key}" defines no levels`)
    for (let i = 0; i < n; i++) {
      if (codes[i] >= levels.length) {
        fail(`${e.file} refers to a level that meta.json does not define for "${e.key}"`)
      }
    }
    out.push({ key: e.key, levels, codes })
  }
  return out
}

/**
 * The alias column, one name per row, aligned with genes.txt.
 *
 * Blank lines are not filtered out the way genes.txt's are: a dropped line
 * would shift every following gene onto its neighbour's expression, which is the
 * kind of wrongness that renders. A blank falls back to the row's own name.
 */
function readAlias(
  files: Record<string, Uint8Array>, meta: BundleMeta, genes: string[],
): string[] | null {
  if (!meta.geneAlias) return null
  const name = meta.geneAlias.file || 'gene_alias.txt'
  const alias = new TextDecoder().decode(need(files, name))
    .split('\n').map(g => g.replace(/\r$/, ''))
  if (alias.length === meta.nGenes + 1 && alias[alias.length - 1] === '') alias.pop()
  if (alias.length !== meta.nGenes) {
    fail(`${name} has ${alias.length} names but meta says ${meta.nGenes} genes`)
  }
  return alias.map((a, i) => a || genes[i])
}

function parsePseudobulk(text: string, nGenes: number): Pseudobulk | null {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length < 2) return null
  const header = lines[0].split('\t').slice(1)
  const columns = header.map(h => {
    const [sample, cluster, nCells] = h.split('||')
    return { sample, cluster: cluster ?? '', nCells: Number(nCells) || 0 }
  })
  const genes: string[] = []
  const counts = new Int32Array((lines.length - 1) * columns.length)
  for (let r = 1; r < lines.length; r++) {
    const parts = lines[r].split('\t')
    genes.push(parts[0])
    for (let c = 0; c < columns.length; c++) counts[(r - 1) * columns.length + c] = +parts[c + 1] || 0
  }
  if (genes.length !== nGenes) return null
  return { genes, columns, counts }
}

/** The Dataset the views work with, built from a bundle. */
export function bundleDataset(b: Bundle): Dataset {
  const { meta } = b
  const samples: SampleRow[] = meta.samples.map(s => ({ id: s.id, cond: s.condition }))
  const condIndex = new Map(meta.conditions.map((c, i) => [c, i]))
  const act: Record<string, number> = {}
  meta.conditions.forEach((c, i) => {
    // Only used for ordering; real data carries no notion of "activation".
    act[c] = meta.conditions.length > 1 ? i / (meta.conditions.length - 1) : 0
  })

  const cells: Cell[] = new Array(meta.nCells)
  for (let i = 0; i < meta.nCells; i++) {
    const s = samples[b.sample[i]]
    cells[i] = {
      t: b.cluster[i], s: s.id, cond: s.cond, a: act[s.cond] ?? 0,
      x: b.embed[2 * i], y: b.embed[2 * i + 1],
      counts: b.qc[3 * i], genes: b.qc[3 * i + 1], mito: b.qc[3 * i + 2],
    }
  }

  const nT = meta.clusters.length
  const grid = Array.from({ length: nT }, () => new Array(samples.length).fill(0))
  for (let i = 0; i < meta.nCells; i++) grid[b.cluster[i]][b.sample[i]]++
  const prop = samples.map((_s, si) => {
    const tot = grid.reduce((a, row) => a + row[si], 0) || 1
    return grid.map(row => row[si] / tot)
  })
  const nPerCond: Record<string, number> = {}
  for (const c of meta.conditions) nPerCond[c] = 0
  for (const c of cells) nPerCond[c.cond] = (nPerCond[c.cond] ?? 0) + 1

  void condIndex
  const d: Dataset = {
    key: 'bundle', label: meta.label, file: meta.source,
    conds: meta.conditions, act, samples,
    cells, grid, prop, nPerCond,
    nCells: meta.nCells, multi: meta.conditions.length > 1,
  }
  // Attached, not returned beside it: everything downstream passes the Dataset
  // around and nothing would carry a second value with it. See cellColumns.
  return Object.assign(d, {
    columns: {
      cond: meta.provenance?.condition ?? null,
      extras: b.extras ?? [],
    } satisfies CellColumns,
  })
}
