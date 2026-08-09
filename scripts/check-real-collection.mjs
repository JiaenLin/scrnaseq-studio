// The real thing, end to end: a collection read back and checked against itself,
// and — when the unsplit bundle it was made from is also given — cell for cell
// against that bundle.
//
// The fixture test proves the logic; this proves it on a real object, through a
// real Blob, at whatever size the object actually is.
//
//   node scripts/check-real-collection.mjs <collection.zip>
//   node scripts/check-real-collection.mjs <bundle.zip> <collection.zip>

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { parseBundle } from '../src/lib/bundle.ts'
import { bundleSource } from '../src/lib/source.ts'

const args = process.argv.slice(2)
// One argument is a collection on its own; two are the unsplit bundle and the
// collection made from it.
const bundlePath = args.length > 1 ? args[0] : null
const collectionPath = args.length > 1 ? args[1] : args[0]
if (!collectionPath) {
  console.error('usage: check-real-collection.mjs [bundle.zip] <collection.zip>')
  process.exit(2)
}

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

/**
 * A Blob over a file handle.
 *
 * Not a convenience: node's fs.openAsBlob reports size modulo 2^32, so the
 * 5 834 834 225-byte atlas comes back claiming 1 539 866 929 bytes and the
 * reader cannot even find the zip's central directory — readCollectionIndex
 * returns null and this check exits before it has tested anything. It did that
 * silently for every object over 4 GB, which is every object this check was
 * written for. Browsers have no such limit, so this exists only so that node can
 * run the same reader the app runs.
 */
async function fileBlob(path) {
  const fh = await fsp.open(path, 'r')
  const { size } = await fh.stat()
  const make = (from, to) => ({
    size: to - from,
    slice(a = 0, b = to - from) {
      const span = to - from
      const s = from + Math.max(0, a < 0 ? span + a : a)
      const e = from + Math.min(span, b < 0 ? span + b : b)
      return make(s, Math.max(s, e))
    },
    async arrayBuffer() {
      const n = to - from
      const buf = Buffer.allocUnsafe(n)
      let off = 0
      while (off < n) {
        const { bytesRead } = await fh.read(buf, off, n - off, from + off)
        if (!bytesRead) break
        off += bytesRead
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + off)
    },
  })
  const root = make(0, size)
  root.close = () => fh.close()
  return root
}

let flat = null
if (bundlePath) {
  console.log('reading the unsplit bundle…')
  flat = bundleSource(parseBundle(new Uint8Array(fs.readFileSync(bundlePath)).buffer))
} else {
  console.log('no bundle given — checking the collection against itself only')
}

console.log('opening the collection…')
const t0 = Date.now()
const blob = await fileBlob(collectionPath)
check('the Blob reports the file\'s real size', blob.size, fs.statSync(collectionPath).size)
const index = await readCollectionIndex(blob)
if (!index) throw new Error('not recognised as a collection')
const src = await openCollection(blob, index)
console.log(`opened ${(blob.size / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

console.log('\nSHAPE')
console.log(`       ${src.d.nCells} cells, ${src.genes.length} genes, `
  + `${src.types.length} clusters, ${src.nParts} parts, lazy=${src.lazy}`)
const used = (cells, pick) => [...new Set(cells.map(pick))].sort()
check('every part is accounted for', src.nParts, index.meta.parts.length)
check('the parts\' cell counts add up to the object',
  index.meta.parts.reduce((a, p) => a + p.nCells, 0), src.d.nCells)
if (flat) {
  check('same number of cells', src.d.nCells, flat.d.nCells)
  check('same genes', src.genes.length, flat.genes.length)
  check('same gene list', src.genes.every((g, i) => g === flat.genes[i]), true)
  // Compared over the levels the cells actually use. A part is written with its
  // unused levels dropped, and bundles made before the lab did that carry level
  // names no cell of theirs belongs to.
  check('same clusters, as a set',
    used(src.d.cells, c => src.clusters[c.t]), used(flat.d.cells, c => flat.clusters[c.t]))
  check('same samples, as a set',
    used(src.d.cells, c => c.s), used(flat.d.cells, c => c.s))
  check('same groups, as a set',
    used(src.d.cells, c => c.cond), used(flat.d.cells, c => c.cond))
}

let map = null
if (flat) {
  // A split reorders cells, so line the two up by their embedding coordinates —
  // which the split carries through untouched.
  console.log('\nMATCHING THE CELLS UP')
  const keyOf = (c) => `${c.x},${c.y},${c.counts}`
  const flatAt = new Map()
  flat.d.cells.forEach((c, i) => { flatAt.set(keyOf(c), i) })
  map = new Int32Array(src.d.nCells).fill(-1)
  let unmatched = 0
  src.d.cells.forEach((c, i) => {
    const j = flatAt.get(keyOf(c))
    if (j === undefined) unmatched++
    else map[i] = j
  })
  check('every cell in the collection is a cell of the bundle', unmatched, 0)

  console.log('\nEVERY CELL KEPT ITS LABEL')
  let wrongCluster = 0
  let wrongSample = 0
  let wrongCond = 0
  src.d.cells.forEach((c, i) => {
    const f = flat.d.cells[map[i]]
    if (src.clusters[c.t] !== flat.clusters[f.t]) wrongCluster++
    if (c.s !== f.s) wrongSample++
    if (c.cond !== f.cond) wrongCond++
  })
  check(`cluster names across ${src.d.nCells} cells`, wrongCluster, 0)
  check('sample ids', wrongSample, 0)
  check('groups', wrongCond, 0)
}

console.log('\nGENE VALUES COME BACK WHOLE')
// A spread of genes: the densest, some in the middle, the sparsest, and the
// last one in the file (which lives in the short final chunk).
const picks = [0, 1, 7, 64, 65, 1000, 12345, 30000, src.genes.length - 1]
  .filter(i => i < src.genes.length)
  .map(i => src.genes[i])
await src.ensure(picks)
// Part boundaries: cells are laid out part by part, in index order.
const bounds = []
{
  let acc = 0
  for (const p of index.meta.parts) { acc += p.nCells; bounds.push(acc) }
}
const partOf = (i) => bounds.findIndex(b2 => i < b2)
let crossed = 0
for (const g of picks) {
  const a = src.vector(g)
  let bad = 0
  let nz = 0
  const partSeen = new Set()
  // The dense accessor and the sparse one read the same stored values through
  // different code; where they disagree, one of them has assembled the parts
  // wrongly.
  const sparse = new Float64Array(a.length)
  src.forEachNonZero(g, (cell, v) => { sparse[cell] = v })
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 0) { nz++; partSeen.add(partOf(i)) }
    if (sparse[i] !== a[i]) bad++
    if (flat && a[i] !== flat.vector(g)[map[i]]) bad++
  }
  if (partSeen.size > 1) crossed++
  check(`${g}: ${nz} nonzero cells, spread over ${partSeen.size} part(s)`, bad, 0)
}
check('at least one gene proved to span parts', crossed > 0, true)

console.log('\nTHE STREAM SEES THE WHOLE OBJECT')
{
  const t = Date.now()
  let genes = 0
  let nonzeros = 0
  let storedZeros = 0
  let sum = 0
  let outOfRange = 0
  await src.scan((_gi, each) => {
    genes++
    each((cell, value) => {
      nonzeros++
      if (value === 0) storedZeros++
      sum += value
      if (cell < 0 || cell >= src.d.nCells) outOfRange++
    })
  }, (done, total) => {
    if (done % 6400 === 0) {
      process.stdout.write(`\r       ${done}/${total} genes  `)
    }
  })
  const secs = (Date.now() - t) / 1000
  console.log(`\r       one pass: ${secs.toFixed(1)}s, ${(nonzeros / secs / 1e6).toFixed(1)} M values/s   `)
  check('every gene was visited', genes, src.genes.length)
  check('no cell index outside the object', outOfRange, 0)
  check('the pass found every stored value', nonzeros,
    index.meta.parts.reduce((a, p) => a + p.nnz, 0))
  // Not a failure. The rank-sum treats a stored zero as a zero, which is only
  // interesting to know about; printed because an object that has them is the
  // one where that decision is visible.
  console.log(`       ${storedZeros} of the ${nonzeros} stored values are explicit zeros`)
  if (flat) {
    // The same total, computed from the unsplit matrix.
    let flatSum = 0
    for (const g of flat.genes) flat.forEachNonZero(g, (_c, v) => { flatSum += v })
    check(`total expression matches the unsplit object (${sum.toFixed(0)})`,
      Math.abs(sum - flatSum) / flatSum < 1e-6, true)
  } else {
    console.log(`       total expression ${sum.toFixed(0)}`)
  }
}

console.log('\nPSEUDOBULK')
{
  const a = src.pseudobulk
  const b = flat?.pseudobulk
  if (!a || !b) {
    // Not a failure on its own: a fixture split into blocks of cells cannot
    // carry pseudobulk, because a column would be cut between parts.
    console.log(`       collection: ${a ? a.columns.length + ' columns' : 'none'}, `
      + `bundle: ${flat ? (b ? b.columns.length + ' columns' : 'none') : 'not given'}`
      + ` — nothing to compare`)
  } else {
    check('same number of columns', a.columns.length, b.columns.length)
    const key = c => `${c.sample}||${c.cluster}`
    const bAt = new Map(b.columns.map((c, i) => [key(c), i]))
    let bad = 0
    let cells = 0
    a.columns.forEach((c, i) => {
      const j = bAt.get(key(c))
      if (j === undefined) { bad++; return }
      if (c.nCells !== b.columns[j].nCells) cells++
      for (let g = 0; g < 200; g++) {
        if (a.counts[g * a.columns.length + i] !== b.counts[g * b.columns.length + j]) bad++
      }
    })
    check('every column matches the unsplit table', bad, 0)
    check('and its cell count', cells, 0)
  }
}

await blob.close?.()
console.log(failed ? `\n${failed} check(s) failed\n` : '\nThe collection reads back whole.\n')
process.exit(failed ? 1 : 0)
