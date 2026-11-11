// Reading a bundle.
//
// The format is written by tools/export_h5ad.py and tools/export_seurat.R and
// documented in tools/BUNDLE.md. Everything here is validation: a bundle that
// half-loads is worse than one that refuses, because the app would then render
// figures from whatever survived.

import { unzipSync } from 'fflate'
import type { Cell, Dataset, SampleRow } from '../types.ts'
import type { GeneIdKind } from './genes.ts'
import { declaredSentinels, maskOfNames, proportions } from './sentinels.ts'

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
  /**
   * Cluster levels that are an annotator's sentinels — its labels for cells it
   * did not call — rather than cell types. Written by the lab's command-line
   * converter (an empty list is "none"); absent in bundles from the in-browser
   * lab and from before the field existed, which read the same as empty. The
   * cells stay in `clusters` and are drawn; see lib/sentinels.ts.
   */
  sentinels?: string[]
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
  /**
   * The run that produced the object, as the lab's converter copied it out of
   * the object's uns: `{ searched, records: [{ path, record }], leftOut? }`.
   *
   * Absent in bundles from this repository's exporters, from the lab before it
   * read run records, and from an .rds. Carried exactly as it came, untyped:
   * only lib/run.ts reads it, and that file names a section it cannot read
   * rather than trusting its shape.
   */
  run?: unknown
}

/** One summed column: a sample within a cluster, and how many cells went into it. */
export interface PseudobulkColumn { sample: string; cluster: string; nCells: number }

/** Summed raw counts, one column per sample × cluster. */
export interface Pseudobulk {
  genes: string[]
  /** Column headers, `sample||cluster||nCells`, as readPseudobulkHeader reads them. */
  columns: PseudobulkColumn[]
  /** counts[geneIndex][columnIndex]. */
  counts: Int32Array
}

/**
 * One pseudobulk column header, read against the levels the bundle declares.
 *
 * Every writer — the lab, tools/export_h5ad.py, tools/export_seurat.R — writes
 * `sample||cluster||nCells` with the ids as they are. An id can hold '|'. A
 * sample whose cells sit in two conditions is split into `sample|condition`,
 * so an empty level gives `s1|`, a level `|x` gives `s2||x` and a level `a||b`
 * gives `s3|a||b`; cluster names come from the object unchanged. Split on '||',
 * those headers named samples that do not exist, every one of their columns was
 * orphaned, and a count that read as 0 summed several of them into one.
 *
 * So the count is read from the right: it is digits, and holds no '|'. The
 * boundary between sample and cluster is then the one '||' whose left side is a
 * sample the part declares and whose right side is a cluster it declares. The
 * writer takes both from the same levels it writes into meta.json, so the
 * reading it meant is always one of them.
 *
 * Null when two declared pairs both read out of one header — samples `a` and
 * `a|` with clusters `|b` and `b` both give `a|||b||3`. Whose counts those are
 * is not in the file, and choosing would put one sample's counts under the
 * other's name. A header no declared pair reads (a table from some other
 * writer) is split as it always was, so a bundle whose ids hold no '|' reads
 * exactly as it did.
 */
export function readPseudobulkHeader(
  h: string, samples: ReadonlySet<string>, clusters: ReadonlySet<string>,
): PseudobulkColumn | null {
  const cut = h.lastIndexOf('||')
  if (cut >= 0 && /^\d+$/.test(h.slice(cut + 2))) {
    const body = h.slice(0, cut)
    const nCells = Number(h.slice(cut + 2))
    let found: PseudobulkColumn | null = null
    let readings = 0
    // Every '||', overlapping ones included: in `s1|||A` the boundary is the
    // second of the two.
    for (let at = body.indexOf('||'); at >= 0; at = body.indexOf('||', at + 1)) {
      const sample = body.slice(0, at)
      const cluster = body.slice(at + 2)
      if (samples.has(sample) && clusters.has(cluster)) {
        readings++
        found = { sample, cluster, nCells }
      }
    }
    if (readings > 1) return null
    if (found) return found
  }
  const [sample, cluster, nCells] = h.split('||')
  return { sample, cluster: cluster ?? '', nCells: Number(nCells) || 0 }
}

/**
 * What a column is merged by: the pair itself. A joined string is a bet that no
 * id holds the separator, and `a` in `|b` and `a|` in `b` both join to `a|||b`.
 */
export const pseudobulkKey = (c: { sample: string; cluster: string }): string =>
  JSON.stringify([c.sample, c.cluster])

/** The note for headers that read as more than one declared pair. */
export function ambiguousNote(headers: readonly string[]): string {
  const shown = headers.slice(0, 3).map(h => `"${h}"`).join(', ')
  const more = headers.length > 3 ? ` and ${headers.length - 3} more` : ''
  const one = headers.length === 1
  return `the summed raw counts are not offered: the pseudobulk column header${one ? '' : 's'} ${shown}${more} `
    + `can${one ? '' : ' each'} be read as more than one sample × cluster pair this object declares, so which sample's `
    + `counts ${one ? 'it holds' : 'they hold'} is not in the file`
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
/**
 * The annotation is on the VARIABLE, not just the return type.
 *
 * TypeScript narrows control flow past a never-returning call only when the
 * thing being called is declared with an explicit type — with the `: never`
 * on the arrow alone, `if (!x) fail(...)` does not narrow `x` afterwards, and
 * every caller was reaching for a `!` to get past it. That is how a parser
 * that already checks its input ended up full of assertions.
 */
const fail: (msg: string) => never = (msg) => { throw new BundleError(msg) }

const need = (files: Record<string, Uint8Array>, name: string): Uint8Array =>
  files[name] ?? fail(`the bundle has no ${name}: was it made by tools/export_*?`)

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
    return fail('this file is not a zip: open a bundle made by tools/export_h5ad.py or tools/export_seurat.R, not the .h5ad or .rds itself')
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
  // Checked here so a malformed list refuses the open, like every other field
  // above, rather than counting some uncalled cells as a cell type.
  try { declaredSentinels(meta.sentinels, meta.clusters) } catch (e) { fail((e as Error).message) }

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

  let pseudobulk: Pseudobulk | null = null
  let read = meta
  if (files['pseudobulk.tsv']) {
    const pb = parsePseudobulk(new TextDecoder().decode(files['pseudobulk.tsv']), meta.nGenes,
      new Set(meta.samples.map(s => s?.id)), new Set(meta.clusters))
    pseudobulk = pb.table
    if (pb.ambiguous.length) {
      // Said where the conversion's decisions are said, and "raw counts:
      // present" withdrawn — which is what a collection whose table does not
      // survive its merge already reads as.
      read = { ...meta, hasRawCounts: false, notes: [...(meta.notes ?? []), ambiguousNote(pb.ambiguous)] }
    }
  }

  return {
    meta: read, genes, indptr, indices, data, cluster, sample, embed, qc,
    embeds: readEmbeddings(files, meta, embed, n),
    extras: readExtras(files, meta, n),
    alias: readAlias(files, meta, genes),
    pseudobulk,
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

/**
 * The summed counts, or null when there are none to offer — and, apart, the
 * headers that read as more than one declared pair, which refuse the table.
 */
function parsePseudobulk(
  text: string, nGenes: number, samples: ReadonlySet<string>, clusters: ReadonlySet<string>,
): { table: Pseudobulk | null; ambiguous: string[] } {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length < 2) return { table: null, ambiguous: [] }
  const header = lines[0].split('\t').slice(1)
  const read = header.map(h => readPseudobulkHeader(h, samples, clusters))
  const ambiguous = header.filter((_h, i) => read[i] === null)
  if (ambiguous.length) return { table: null, ambiguous }
  const columns = read as PseudobulkColumn[]
  const genes: string[] = []
  const counts = new Int32Array((lines.length - 1) * columns.length)
  for (let r = 1; r < lines.length; r++) {
    const parts = lines[r].split('\t')
    genes.push(parts[0])
    for (let c = 0; c < columns.length; c++) counts[(r - 1) * columns.length + c] = +parts[c + 1] || 0
  }
  if (genes.length !== nGenes) return { table: null, ambiguous: [] }
  return { table: { genes, columns, counts }, ambiguous: [] }
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
  // The grid counts every cell, sentinels included — they are cells. The
  // proportions are of each sample's typed cells: see proportions().
  const prop = proportions(grid, samples.length,
    maskOfNames(meta.clusters, declaredSentinels(meta.sentinels, meta.clusters)))
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
