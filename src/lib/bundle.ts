// Reading a bundle.
//
// The format is written by tools/export_h5ad.py and tools/export_seurat.R and
// documented in tools/BUNDLE.md. Everything here is validation: a bundle that
// half-loads is worse than one that refuses, because the app would then render
// figures from whatever survived.

import { unzipSync } from 'fflate'
import type { Cell, Dataset, SampleRow } from '../types.ts'

export const SCHEMA = 'scrnaseq-studio/bundle@1'

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
  /** Interleaved x,y per cell. */
  embed: Float32Array
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
    pseudobulk: files['pseudobulk.tsv']
      ? parsePseudobulk(new TextDecoder().decode(files['pseudobulk.tsv']), meta.nGenes)
      : null,
  }
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
  return {
    key: 'bundle', label: meta.label, file: meta.source,
    conds: meta.conditions, act, samples,
    cells, grid, prop, nPerCond,
    nCells: meta.nCells, multi: meta.conditions.length > 1,
  }
}
