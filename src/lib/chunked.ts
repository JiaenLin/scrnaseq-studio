// Reading one gene out of a bundle without holding the matrix.
//
// A bundle stores expression gene-major (CSC over cells), so one gene is a
// contiguous run of `expr.indices` / `expr.data`. That is exactly the shape a
// gene search wants — except the zip entry holding it is deflated, and a
// deflate stream can only be read from its start. To plot one gene you would
// have to inflate all 736 M values of it. Storing the entry raw instead would
// nearly double the file: 5.9 GB for the developing-mouse atlas.
//
// So do what HDF5 and Zarr do: cut the genes into blocks, deflate each block on
// its own, and index where each one landed. One extra entry, STORED, so chunk k
// is a contiguous byte range of the container and the studio can slice it out
// of a Blob without reading anything else.
//
//   expr.chunk.bin      concatenated per-chunk raw deflate streams
//   expr.chunkptr.i32   nChunks+1 byte offsets into it
//   meta.json           gains chunkGenes
//
// These are added ALONGSIDE expr.indices.i32 / expr.data.f32, never instead:
// bundles written before this existed, and studio code that still reads the
// whole matrix, must keep working.
//
// Written by the lab, read by the studio. Both copies of this file must agree.

import { deflateSync, inflateSync } from 'fflate'

/**
 * Genes per chunk.
 *
 * Measured, not chosen: scripts/measure-chunked.mjs on a real shard of the
 * developing-mouse atlas (17 277 cells, 31 053 genes, 33.4 M nonzeros). The
 * fear was that cutting the stream into blocks would cost size. It does not:
 * every size from 16 to 512 genes lands within 0.7 % of every other, because a
 * chunk is already tens of kilobytes, far more than deflate's 32 KB window has
 * any use for. All of them come out at half the flat deflated entry
 * (33 MB against 65.6 MB), which is the gap encoding below, not the chunking.
 *
 * So the choice is made at the other end, by what one gene costs to read:
 *
 *     genes/chunk    mean chunk    largest    inflate one
 *             16         17 KB     119 KB         0.3 ms
 *             64         68 KB     414 KB         0.7 ms
 *            256        271 KB     1.0 MB         3.1 ms
 *            512        541 KB     1.9 MB         7.1 ms
 *
 * 64 reads one gene in about a millisecond while the index stays trivial
 * (486 chunks for 31 053 genes — 2 KB of pointers). Smaller chunks are barely
 * faster and multiply the pointer array; larger ones make a gene lookup
 * noticeable for no saving at all.
 */
export const CHUNK_GENES = 64

export interface Chunked {
  /** Concatenated deflate streams, to be stored (method 0) in the zip. */
  bin: Uint8Array
  /** nChunks+1 byte offsets into `bin`; chunk k is [ptr[k], ptr[k+1]). */
  ptr: Int32Array
}

export interface GeneVector {
  /** Index into the gene list, as asked for. */
  gene: number
  /** Cell indices holding a nonzero, in the order the bundle stored them —
   * ascending, for every exporter that writes it, but not enforced here. */
  cells: Int32Array
  /** Their values, parallel to `cells`. */
  values: Float32Array
}

/** Where the bytes come from: a Blob slice in the studio, an array in a test. */
export type GetBytes = (from: number, to: number) => Promise<Uint8Array>

export class ChunkError extends Error {}
const fail = (msg: string): never => { throw new ChunkError(msg) }

/** How many chunks `nGenes` genes make. */
export const chunkCount = (nGenes: number, chunkGenes: number): number =>
  Math.ceil(nGenes / chunkGenes)

/** Which chunk a gene lives in. */
export const chunkOf = (gene: number, chunkGenes: number): number =>
  Math.floor(gene / chunkGenes)

// A zip entry, and this Int32Array of offsets, both top out at 4 GB / 2 GB. A
// part that big cannot be opened by the studio anyway (it holds the matrix), so
// refusing here is honest; silently wrapping to a negative offset would produce
// a bundle that reads back as garbage.
const MAX_BIN = 2 ** 31 - 1

/**
 * Cut a gene-major matrix into deflated blocks.
 *
 * A chunk's payload is nnz gaps between cell ids as int32, then nnz values as
 * float32 — two runs, not interleaved, because ascending ids and expression
 * values each compress well next to their own kind and badly when shuffled
 * together.
 *
 * The gaps are what make this affordable. The chunked entry is added alongside
 * the flat expr.indices/expr.data, so the bundle pays for the matrix twice;
 * storing differences between consecutive cell ids instead of the ids
 * themselves halves that second copy (65.7 MB -> 33.1 MB on the measured
 * shard — half the flat entry it duplicates), because a gap fits in one or two
 * bytes where an id needs three.
 * Nothing depends on the ids being sorted — a prefix sum reconstructs whatever
 * order they were written in — sorted input just compresses better.
 */
export function writeChunked(
  indptr: Int32Array, indices: Int32Array, data: Float32Array,
  chunkGenes: number = CHUNK_GENES,
): Chunked {
  if (!Number.isInteger(chunkGenes) || chunkGenes < 1) {
    fail(`chunkGenes must be a positive integer, got ${chunkGenes}`)
  }
  if (indptr.length < 1) fail('expr.indptr is empty')
  if (indices.length !== data.length) {
    fail(`expr.indices has ${indices.length} entries and expr.data has ${data.length}`)
  }
  const nGenes = indptr.length - 1
  if (indptr[nGenes] !== indices.length) {
    fail(`expr.indptr ends at ${indptr[nGenes]} but there are ${indices.length} stored values`)
  }

  const n = chunkCount(nGenes, chunkGenes)
  const ptr = new Int32Array(n + 1)
  const blocks: Uint8Array[] = []
  let at = 0
  for (let k = 0; k < n; k++) {
    const lo = k * chunkGenes
    const hi = Math.min(nGenes, lo + chunkGenes)
    const from = indptr[lo]
    const to = indptr[hi]
    const nnz = to - from
    if (nnz < 0) fail('expr.indptr is not ascending')

    const payload = new Uint8Array(nnz * 8)
    const gaps = new Int32Array(payload.buffer, 0, nnz)
    for (let g = lo; g < hi; g++) {
      let prev = 0
      for (let i = indptr[g]; i < indptr[g + 1]; i++) {
        gaps[i - from] = indices[i] - prev
        prev = indices[i]
      }
    }
    new Float32Array(payload.buffer, nnz * 4, nnz).set(data.subarray(from, to))
    // Level 6, the same the bundle's other entries are written at, so the two
    // copies of the matrix stay comparable.
    const z = deflateSync(payload, { level: 6 })

    at += z.length
    if (at > MAX_BIN) fail('this matrix is too large to chunk into one entry — split it further')
    blocks.push(z)
    ptr[k + 1] = at
  }

  const bin = new Uint8Array(at)
  let w = 0
  for (const b of blocks) { bin.set(b, w); w += b.length }
  return { bin, ptr }
}

// ---------------------------------------------------------------------------
// Reading.

/**
 * Inflated chunks, most recently used last.
 *
 * Asking for 40 genes of one pathway usually means one chunk, or two; without
 * this the studio would inflate the same megabyte 40 times. Bounded by bytes
 * rather than by count because a chunk's size depends on the matrix.
 */
export interface ChunkCache {
  get(k: number): Uint8Array | undefined
  put(k: number, payload: Uint8Array): void
  /** Chunks inflated since this cache was made — the test asserts on it. */
  readonly inflations: number
  readonly bytes: number
}

export function makeChunkCache(maxBytes = 64 * 1024 * 1024): ChunkCache {
  const map = new Map<number, Uint8Array>()
  let bytes = 0
  let inflations = 0
  return {
    get(k) {
      const v = map.get(k)
      if (v === undefined) return undefined
      map.delete(k)   // reinsert at the end: a Map iterates in insertion order,
      map.set(k, v)   // which is all an LRU needs.
      return v
    },
    put(k, payload) {
      inflations++
      if (map.has(k)) { bytes -= map.get(k)!.length; map.delete(k) }
      map.set(k, payload)
      bytes += payload.length
      for (const [key, v] of map) {
        if (bytes <= maxBytes || map.size <= 1) break
        map.delete(key)
        bytes -= v.length
      }
    },
    get inflations() { return inflations },
    get bytes() { return bytes },
  }
}

/** Views onto a chunk payload, without copying it. `gaps` are still encoded. */
function split(payload: Uint8Array, nnz: number): { gaps: Int32Array; values: Float32Array } {
  // A typed-array view needs 4-byte alignment, which an inflate output happens
  // to have but is not promised.
  const p = payload.byteOffset % 4 === 0 ? payload : payload.slice()
  return {
    gaps: new Int32Array(p.buffer, p.byteOffset, nnz),
    values: new Float32Array(p.buffer, p.byteOffset + nnz * 4, nnz),
  }
}

/**
 * Read whole genes, touching only the chunks they live in.
 *
 * `geneIdxs` may repeat and need not be sorted; the result is parallel to it.
 * Distinct chunks are fetched once each, in ascending order, so a caller
 * reading a gene set walks the file forwards instead of seeking about.
 */
export async function readGenes(
  getBytes: GetBytes, chunkptr: Int32Array, indptr: Int32Array,
  chunkGenes: number, geneIdxs: ArrayLike<number>,
  cache: ChunkCache = makeChunkCache(),
): Promise<GeneVector[]> {
  if (!Number.isInteger(chunkGenes) || chunkGenes < 1) {
    fail(`chunkGenes must be a positive integer, got ${chunkGenes}`)
  }
  const nGenes = indptr.length - 1
  const nChunks = chunkptr.length - 1
  if (nChunks < 1) fail('expr.chunkptr is empty')
  if (nChunks !== chunkCount(nGenes, chunkGenes)) {
    fail(`expr.chunkptr describes ${nChunks} chunks but ${nGenes} genes at ${chunkGenes} per chunk make ${chunkCount(nGenes, chunkGenes)}`)
  }

  const want: number[] = []
  const byChunk = new Set<number>()
  for (let i = 0; i < geneIdxs.length; i++) {
    const g = geneIdxs[i]
    if (!Number.isInteger(g) || g < 0 || g >= nGenes) {
      fail(`gene ${g} is outside this bundle's ${nGenes} genes`)
    }
    want.push(g)
    byChunk.add(chunkOf(g, chunkGenes))
  }

  const chunks = new Map<number, Uint8Array>()
  for (const k of [...byChunk].sort((a, b) => a - b)) {
    let payload = cache.get(k)
    if (payload === undefined) {
      payload = await loadChunk(getBytes, chunkptr, indptr, chunkGenes, k)
      cache.put(k, payload)
    }
    chunks.set(k, payload)
  }

  return want.map(g => {
    const k = chunkOf(g, chunkGenes)
    const lo = k * chunkGenes
    const base = indptr[lo]
    const nnz = indptr[Math.min(nGenes, lo + chunkGenes)] - base
    const { gaps, values } = split(chunks.get(k)!, nnz)
    const s = indptr[g] - base
    const e = indptr[g + 1] - base
    // slice, not subarray: the caller gets arrays it owns, and the cached chunk
    // cannot be mutated under the next reader. The gaps are undone in that copy,
    // so only the genes actually asked for are decoded.
    const cells = gaps.slice(s, e)
    let acc = 0
    for (let i = 0; i < cells.length; i++) { acc += cells[i]; cells[i] = acc }
    return { gene: g, cells, values: values.slice(s, e) }
  })
}

/** Fetch and inflate one chunk, refusing anything that is not exactly it. */
async function loadChunk(
  getBytes: GetBytes, chunkptr: Int32Array, indptr: Int32Array,
  chunkGenes: number, k: number,
): Promise<Uint8Array> {
  const from = chunkptr[k]
  const to = chunkptr[k + 1]
  if (!(from >= 0 && to >= from)) fail(`expr.chunkptr is not ascending at chunk ${k}`)

  const raw = await getBytes(from, to)
  if (raw.length !== to - from) {
    fail(`chunk ${k} is ${raw.length} bytes but the index says ${to - from} — this bundle is truncated`)
  }

  const nGenes = indptr.length - 1
  const lo = k * chunkGenes
  const nnz = indptr[Math.min(nGenes, lo + chunkGenes)] - indptr[lo]
  const expect = nnz * 8

  let payload: Uint8Array
  try {
    payload = inflateSync(raw)
  } catch (e) {
    // A half-inflated chunk would render as expression values, which is the
    // kind of wrongness that never announces itself.
    fail(`chunk ${k} of this bundle is corrupt (${(e as Error).message})`)
  }
  if (payload!.length !== expect) {
    fail(`chunk ${k} holds ${payload!.length} bytes, expected ${expect} for its ${nnz} values — this bundle is damaged`)
  }
  return payload!
}
