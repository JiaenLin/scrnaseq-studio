// Chunked-expression regressions.
//
// The lab writes expr.chunk.bin and the studio reads it, in different
// repositories, so the two copies of src/lib/chunked.ts must stay identical and
// this must pass in both. It checks more than a round trip: the whole reason
// the format exists is that reading one gene touches one chunk's byte range and
// nothing else, so that is asserted directly, on the arguments getBytes was
// called with.

import { deflateSync } from 'fflate'
import {
  CHUNK_GENES, chunkCount, chunkOf, makeChunkCache, readGenes, writeChunked,
} from '../src/lib/chunked.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const throws = async (name, fn, fragment) => {
  let msg = null
  try { await fn() } catch (e) { msg = e.message }
  const ok = msg !== null && msg.includes(fragment)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${msg === null ? 'no error' : msg}\n        want an error mentioning "${fragment}"`}`)
}

// A deterministic pseudo-random matrix: reproducible failures matter more than
// entropy here.
let seed = 12345
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

/** Gene-major CSC with the awkward cases built in. */
function makeMatrix(nGenes, nCells, density) {
  const indptr = new Int32Array(nGenes + 1)
  const cells = []
  const values = []
  for (let g = 0; g < nGenes; g++) {
    // Every 7th gene is empty — a gene detected in no cell is ordinary in a
    // shard, and an off-by-one there would go unnoticed by a dense test.
    const want = g % 7 === 0 ? 0 : Math.max(1, Math.round(density * nCells * (0.2 + rnd() * 1.8)))
    const picked = new Set()
    while (picked.size < Math.min(want, nCells)) picked.add(Math.floor(rnd() * nCells))
    for (const c of [...picked].sort((a, b) => a - b)) {
      cells.push(c)
      // log1p(CP10K)-shaped: a few large values, many small ones.
      values.push(Math.round(Math.log1p(rnd() * 4000) * 1000) / 1000)
    }
    indptr[g + 1] = cells.length
  }
  return {
    indptr, indices: Int32Array.from(cells), data: Float32Array.from(values),
    nGenes, nCells,
  }
}

/** getBytes over an array, recording every range it was asked for. */
function reader(bin) {
  const asked = []
  const get = async (from, to) => { asked.push([from, to]); return bin.subarray(from, to) }
  return { get, asked }
}

const gene = (m, g) => ({
  cells: Array.from(m.indices.subarray(m.indptr[g], m.indptr[g + 1])),
  values: Array.from(m.data.subarray(m.indptr[g], m.indptr[g + 1])),
})

console.log('\nEVERY GENE ROUND-TRIPS')
{
  const m = makeMatrix(200, 3000, 0.02)
  const cg = 32
  const { bin, ptr } = writeChunked(m.indptr, m.indices, m.data, cg)
  check('one pointer per chunk plus one', ptr.length, chunkCount(m.nGenes, cg) + 1)
  check('the pointers span the whole entry', [ptr[0], ptr[ptr.length - 1]], [0, bin.length])

  const { get } = reader(bin)
  const all = await readGenes(get, ptr, m.indptr, cg, [...Array(m.nGenes).keys()])
  let bad = null
  for (let g = 0; g < m.nGenes && bad === null; g++) {
    const want = gene(m, g)
    const got = { cells: Array.from(all[g].cells), values: Array.from(all[g].values) }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad = g
  }
  check('all 200 genes come back exactly', bad, null)
  check('the first gene', Array.from(all[0].cells), gene(m, 0).cells)
  check('the last gene', Array.from(all[199].values), gene(m, 199).values)
  check('an empty gene is empty, not missing',
    [all[7].cells.length, all[7].values.length, gene(m, 7).cells.length], [0, 0, 0])
  check('a gene at a chunk boundary', Array.from(all[cg].cells), gene(m, cg).cells)
  check('the gene index comes back with it', all[41].gene, 41)
}

console.log('\nREADING ONE GENE TOUCHES ONE CHUNK')
// The entire point of the format. If this ever regresses, the studio is
// inflating the whole matrix to draw one feature plot and nobody would see it
// except as slowness.
{
  const m = makeMatrix(320, 2000, 0.03)
  const cg = 64
  const { bin, ptr } = writeChunked(m.indptr, m.indices, m.data, cg)
  const { get, asked } = reader(bin)
  const g = 137
  await readGenes(get, ptr, m.indptr, cg, [g])
  const k = chunkOf(g, cg)
  check('exactly one range was read', asked.length, 1)
  check('and it is that gene\'s chunk', asked[0], [ptr[k], ptr[k + 1]])
  check('which is a fraction of the entry', asked[0][1] - asked[0][0] < bin.length / 3, true)

  const { get: g2, asked: a2 } = reader(bin)
  await readGenes(g2, ptr, m.indptr, cg, [3, 300])
  check('two genes in different chunks read two ranges', a2.length, 2)
  check('in ascending file order', a2[0][0] < a2[1][0], true)
}

console.log('\nA CHUNK IS INFLATED ONCE')
{
  const m = makeMatrix(320, 2000, 0.03)
  const cg = 64
  const { bin, ptr } = writeChunked(m.indptr, m.indices, m.data, cg)
  const { get, asked } = reader(bin)
  const cache = makeChunkCache()
  const forty = Array.from({ length: 40 }, (_, i) => 64 + i)   // all in chunk 1
  const got = await readGenes(get, ptr, m.indptr, cg, forty, cache)
  check('40 genes of one chunk read the file once', asked.length, 1)
  check('and inflate it once', cache.inflations, 1)
  check('every one of them is right',
    got.every((v, i) => JSON.stringify(Array.from(v.cells)) === JSON.stringify(gene(m, 64 + i).cells)), true)

  // And across calls, which is how the studio actually uses it.
  await readGenes(get, ptr, m.indptr, cg, [70], cache)
  check('a later call reuses the cached chunk', [asked.length, cache.inflations], [1, 1])
  await readGenes(get, ptr, m.indptr, cg, [200], cache)
  check('a different chunk is fetched', [asked.length, cache.inflations], [2, 2])

  // A cache too small to hold two chunks must still be correct, just colder.
  const tiny = makeChunkCache(1)
  const t1 = reader(bin)
  await readGenes(t1.get, ptr, m.indptr, cg, [10], tiny)
  await readGenes(t1.get, ptr, m.indptr, cg, [200], tiny)
  const back = await readGenes(t1.get, ptr, m.indptr, cg, [10], tiny)
  check('an evicting cache still returns the right values',
    Array.from(back[0].values), gene(m, 10).values)
  check('and re-inflated rather than guessed', tiny.inflations, 3)
}

console.log('\nCHUNK BOUNDARIES')
{
  // 100 genes at 32 per chunk: the last chunk holds 4. An off-by-one in the
  // tail chunk would only ever show up on the last few genes of a bundle.
  const m = makeMatrix(100, 500, 0.05)
  const cg = 32
  const { bin, ptr } = writeChunked(m.indptr, m.indices, m.data, cg)
  check('four chunks for 100 genes at 32', ptr.length - 1, 4)
  const { get } = reader(bin)
  const tail = await readGenes(get, ptr, m.indptr, cg, [96, 97, 98, 99])
  check('the short last chunk reads',
    tail.map(v => Array.from(v.cells)), [96, 97, 98, 99].map(g => gene(m, g).cells))

  // One gene, one chunk, and a chunk size larger than the matrix.
  const one = makeMatrix(1, 50, 0.2)
  const c1 = writeChunked(one.indptr, one.indices, one.data, 64)
  check('a one-gene matrix makes one chunk', c1.ptr.length - 1, 1)
  const r1 = await readGenes(reader(c1.bin).get, c1.ptr, one.indptr, 64, [0])
  check('and reads back', Array.from(r1[0].values), gene(one, 0).values)

  // A matrix with no stored values at all.
  const empty = { indptr: new Int32Array(9), indices: new Int32Array(0), data: new Float32Array(0) }
  const c0 = writeChunked(empty.indptr, empty.indices, empty.data, 4)
  const r0 = await readGenes(reader(c0.bin).get, c0.ptr, empty.indptr, 4, [0, 7])
  check('an all-empty matrix round-trips', r0.map(v => v.cells.length), [0, 0])
}

console.log('\nCELL IDS SURVIVE WHATEVER ORDER THEY ARRIVE IN')
// The payload stores gaps between cell ids because that halves the entry, and a
// prefix sum undoes it. Nothing may depend on the ids being sorted: an exporter
// that writes them unsorted must still read back exactly, just larger.
{
  const indptr = Int32Array.from([0, 4, 4, 9])
  const indices = Int32Array.from([900, 3, 500, 3, 0, 1, 999999, 2, 999998])
  const data = Float32Array.from([1.5, 2.5, 3.5, 4.5, 5, 6, 7, 8, 9])
  const { bin, ptr } = writeChunked(indptr, indices, data, 2)
  const got = await readGenes(reader(bin).get, ptr, indptr, 2, [0, 1, 2])
  check('unsorted ids come back in the order they were written',
    Array.from(got[0].cells), [900, 3, 500, 3])
  check('a gene with no values between two that have some', got[1].cells.length, 0)
  check('ids far apart, in the tail chunk', Array.from(got[2].cells), [0, 1, 999999, 2, 999998])
  check('and their values', Array.from(got[2].values), [5, 6, 7, 8, 9])
}

console.log('\nDAMAGE IS REFUSED, NOT HALF-READ')
{
  const m = makeMatrix(128, 1000, 0.04)
  const cg = 32
  const { bin, ptr } = writeChunked(m.indptr, m.indices, m.data, cg)

  await throws('a short read is caught before inflating',
    () => readGenes(async (from, to) => bin.subarray(from, to - 5), ptr, m.indptr, cg, [40]),
    'truncated')

  await throws('a truncated deflate stream is refused', () => {
    const cut = bin.slice()
    const k = chunkOf(40, cg)
    const p = Int32Array.from(ptr)
    p[k + 1] = p[k] + Math.floor((p[k + 1] - p[k]) / 2)
    return readGenes(async (from, to) => cut.subarray(from, to), p, m.indptr, cg, [40])
  }, 'chunk 1')

  await throws('flipped bytes inside a chunk are refused', () => {
    const hurt = bin.slice()
    const k = chunkOf(40, cg)
    for (let i = ptr[k] + 8; i < ptr[k] + 40; i++) hurt[i] ^= 0xff
    return readGenes(async (from, to) => hurt.subarray(from, to), ptr, m.indptr, cg, [40])
  }, 'chunk 1')

  await throws('a chunk holding the wrong number of values is refused', () => {
    // Right deflate stream, wrong indptr: the length check is what catches a
    // chunkptr and an indptr that came from different builds.
    const wrong = Int32Array.from(m.indptr)
    for (let i = 64; i < wrong.length; i++) wrong[i] += 3
    return readGenes(reader(bin).get, ptr, wrong, cg, [32])
  }, 'damaged')

  await throws('a gene outside the bundle is refused',
    () => readGenes(reader(bin).get, ptr, m.indptr, cg, [128]), 'outside')
  await throws('a chunkptr that does not match the gene count is refused',
    () => readGenes(reader(bin).get, ptr.subarray(0, 3), m.indptr, cg, [0]), 'chunks but')
  check('writeChunked refuses a chunk size of 0', (() => {
    try { writeChunked(m.indptr, m.indices, m.data, 0); return 'no error' } catch (e) { return e.message.startsWith('chunkGenes must be a positive integer') ? 'refused' : e.message }
  })(), 'refused')
  check('writeChunked refuses mismatched indices and data', (() => {
    try { writeChunked(m.indptr, m.indices, m.data.subarray(0, 5), cg); return 'no error' } catch { return 'refused' }
  })(), 'refused')
}

console.log('\nWHAT IT COSTS')
// Shaped like a shard the studio would actually open — a few thousand genes
// over twenty thousand cells. The numbers on the real atlas are in
// scripts/measure-chunked.mjs; random values compress worse than expression
// does, so this is the pessimistic end.
{
  const m = makeMatrix(4000, 20000, 0.03)
  const nnz = m.data.length
  const flat = deflateSync(new Uint8Array(m.indices.buffer, 0, nnz * 4), { level: 6 }).length +
    deflateSync(new Uint8Array(m.data.buffer, 0, nnz * 4), { level: 6 }).length
  const { bin, ptr } = writeChunked(m.indptr, m.indices, m.data, CHUNK_GENES)
  const over = (bin.length / flat - 1) * 100
  console.log(`  ${m.nGenes} genes x ${m.nCells} cells, ${nnz.toLocaleString()} values` +
    ` (${(nnz * 8 / 1e6).toFixed(1)} MB raw)`)
  console.log(`  flat deflated:   ${(flat / 1e6).toFixed(2)} MB`)
  console.log(`  chunked at ${CHUNK_GENES}:  ${(bin.length / 1e6).toFixed(2)} MB  (${over >= 0 ? '+' : ''}${over.toFixed(1)}%),` +
    ` ${ptr.length - 1} chunks of ~${((bin.length / (ptr.length - 1)) / 1e3).toFixed(0)} KB`)
  check('chunking costs no more than a fifth over the flat entry', over < 20, true)

  const { get } = reader(bin)
  const cache = makeChunkCache()
  const t0 = performance.now()
  await readGenes(get, ptr, m.indptr, CHUNK_GENES, [1999], cache)
  const cold = performance.now() - t0
  const t1 = performance.now()
  await readGenes(get, ptr, m.indptr, CHUNK_GENES, [1999], cache)
  const warm = performance.now() - t1
  console.log(`  one gene: ${cold.toFixed(1)} ms cold, ${warm.toFixed(3)} ms warm`)
  check('a cold gene read is well under a second', cold < 1000, true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll chunked tests passed\n')
process.exit(failed ? 1 : 0)
