// What crosses between the page and the compute worker.
//
// Both sides import this file, so the protocol is written down once. Everything
// here is structured-cloneable by construction: typed arrays and numbers, no
// closures, no Source, no gene names. That is not a style preference — a job
// that cannot be described this way is a job the worker cannot be trusted to
// answer the same way the page would.
//
// Results come back in COLUMNS rather than as row objects. A FindAllMarkers run
// on the atlas produces a few hundred thousand rows; as objects that is a
// structured clone of a few hundred thousand allocations, and as six typed
// arrays it is a transfer of nothing at all. The columns are Float64 throughout
// so a round trip changes no digit of any number.

import type { MatrixPlan } from './part-scan.ts'
import type { AveragesSpec, ScoreSpec } from './score.ts'
import type { DEResult, MarkersSpec, RawResult, WilcoxSpec } from './stats.ts'

/** A question for the worker. The engine takes ownership of the typed arrays. */
export type Job =
  | ({ kind: 'markers' } & MarkersSpec)
  | ({ kind: 'wilcox' } & WilcoxSpec)
  | ({ kind: 'averages' } & AveragesSpec)
  | ({ kind: 'score' } & ScoreSpec)

/** A DE table, column by column. Parallel arrays, in final ranked order. */
export interface Table {
  gene: Int32Array
  lfc: Float64Array
  p: Float64Array
  padj: Float64Array
  /** -log10 of the adjusted p. Carried because `padj` underflows; see types.ts. */
  nlp: Float64Array
  pct1: Float64Array
  pct2: Float64Array
  n0: number
  n1: number
}

/**
 * One table per cluster for markers, one table for a contrast.
 *
 * The two per-cell jobs need no encoder: their answer already IS one typed
 * array, so it transfers as it stands.
 */
export type JobResult =
  | { kind: 'markers'; tables: Table[] }
  | { kind: 'wilcox'; table: Table }
  | { kind: 'averages'; avg: Float64Array }
  | { kind: 'score'; scores: Float32Array }

/** What a view gets back, per job kind. */
export interface ResultOf {
  markers: DEResult[]
  wilcox: DEResult
  /** Mean expression per gene, by gene index. */
  averages: Float64Array
  /** Module score per cell, in dataset order. */
  score: Float32Array
}

export function encodeTable(r: RawResult): Table {
  const n = r.rows.length
  const t: Table = {
    gene: new Int32Array(n),
    lfc: new Float64Array(n),
    p: new Float64Array(n),
    padj: new Float64Array(n),
    nlp: new Float64Array(n),
    pct1: new Float64Array(n),
    pct2: new Float64Array(n),
    n0: r.n0,
    n1: r.n1,
  }
  for (let i = 0; i < n; i++) {
    const row = r.rows[i]
    t.gene[i] = row.gene
    t.lfc[i] = row.lfc
    t.p[i] = row.p
    t.padj[i] = row.padj
    t.nlp[i] = row.nlp
    t.pct1[i] = row.pct1
    t.pct2[i] = row.pct2
  }
  return t
}

export function decodeTable(genes: readonly string[], t: Table): DEResult {
  const rows = new Array<DEResult['rows'][number]>(t.gene.length)
  for (let i = 0; i < t.gene.length; i++) {
    rows[i] = {
      gene: genes[t.gene[i]],
      lfc: t.lfc[i], p: t.p[i], padj: t.padj[i], nlp: t.nlp[i],
      pct1: t.pct1[i], pct2: t.pct2[i],
    }
  }
  return { rows, n0: t.n0, n1: t.n1 }
}

/** Every buffer in a table, so the whole result moves rather than copies. */
export const tableBuffers = (t: Table): ArrayBufferLike[] =>
  [t.gene, t.lfc, t.p, t.padj, t.nlp, t.pct1, t.pct2].map(a => a.buffer)

/* ---------------- messages ---------------- */

export interface MountMsg { cmd: 'mount'; file: Blob; plan: MatrixPlan }
export interface RunMsg { cmd: 'run'; id: number; job: Job }
export interface CancelMsg { cmd: 'cancel'; id: number }
export type ToWorker = MountMsg | RunMsg | CancelMsg

export type FromWorker =
  | { id: number; event: 'progress'; phase: string; done: number; total: number }
  | { id: number; event: 'done'; result: JobResult }
  | { id: number; event: 'error'; message: string }
