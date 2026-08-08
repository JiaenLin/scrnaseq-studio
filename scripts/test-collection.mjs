// Container-format regressions.
//
// The lab writes this and the studio reads it, in different repositories. The
// only thing keeping them in agreement is that both copies of collection.ts are
// identical and that this file passes — so it checks the bytes, not just the
// round trip: a zip that only this reader can open would be a trap for anyone
// who tries to unzip a collection by hand.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import {
  COLLECTION_SCHEMA, INDEX_NAME, crc32, readCollectionIndex, readEntry, writeCollection,
} from '../src/lib/collection.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

/** A real bundle zip, so the parts inside are the genuine article. */
const bundle = (label, nCells) => zipSync({
  'meta.json': strToU8(JSON.stringify({
    schema: 'scrnaseq-studio/bundle@1', label, nCells, nGenes: 2, nnz: 2,
    clusters: ['A'], samples: [{ id: 's', condition: 'c' }], conditions: ['c'],
  })),
  'genes.txt': strToU8('G1\nG2'),
}, { level: 6 })

const META = {
  schema: COLLECTION_SCHEMA,
  label: 'atlas', source: 'atlas.h5ad (AnnData, converted in scRNA-seq Lab)',
  splitBy: 'donor_id', reason: '736 M stored values is more than one bundle can hold',
  nCells: 30, nGenes: 2,
  parts: [
    { key: 'd1', file: 'parts/d1.zip', nCells: 10, nnz: 20, bytes: 0 },
    { key: 'd2', file: 'parts/d2.zip', nCells: 20, nnz: 40, bytes: 0 },
  ],
  notes: ['a note from the conversion'],
}

console.log('\nCRC-32 MATCHES THE STANDARD')
// The check value every CRC-32 implementation is tested against.
check('crc32("123456789")', crc32(strToU8('123456789')), 0xcbf43926)
check('crc32 of nothing', crc32(new Uint8Array(0)), 0)

console.log('\nA COLLECTION ROUND-TRIPS')
const p1 = bundle('part one', 10)
const p2 = bundle('part two', 20)
const blob = writeCollection(META, [
  { file: 'parts/d1.zip', bytes: p1 },
  { file: 'parts/d2.zip', bytes: p2 },
])
{
  const idx = await readCollectionIndex(blob)
  check('the index is found', idx !== null, true)
  check('schema', idx.meta.schema, COLLECTION_SCHEMA)
  check('what it was split along', idx.meta.splitBy, 'donor_id')
  check('every part is indexed', [...idx.entries.keys()].sort(),
    [INDEX_NAME, 'parts/d1.zip', 'parts/d2.zip'])

  // The point of the whole format: a part comes back byte-identical without
  // the rest of the container being read.
  const got1 = await readEntry(blob, idx.entries.get('parts/d1.zip'))
  const got2 = await readEntry(blob, idx.entries.get('parts/d2.zip'))
  check('part one survives exactly', Array.from(got1), Array.from(p1))
  check('part two survives exactly', Array.from(got2), Array.from(p2))

  // And what comes out is a bundle, still openable on its own.
  const inner = unzipSync(got2)
  check('a part is a whole bundle', JSON.parse(strFromU8(inner['meta.json'])).label, 'part two')
}

console.log('\nANY UNZIP TOOL CAN OPEN IT')
// If only our own reader could open a collection, unzipping one by hand would
// fail and nobody would know why.
{
  const whole = new Uint8Array(await blob.arrayBuffer())
  const files = unzipSync(whole)
  check('a general reader sees the same entries', Object.keys(files).sort(),
    [INDEX_NAME, 'parts/d1.zip', 'parts/d2.zip'])
  check('and the payloads agree', Array.from(files['parts/d1.zip']), Array.from(p1))
  check('the index parses', JSON.parse(strFromU8(files[INDEX_NAME])).label, 'atlas')
}

console.log('\nENTRIES ARE STORED, NOT DEFLATED')
// Deflating an already-compressed bundle costs minutes and saves nothing, and
// it would break the byte-range reads this format exists for.
{
  const whole = new Uint8Array(await blob.arrayBuffer())
  const dv = new DataView(whole.buffer)
  check('local header method is 0', dv.getUint16(8, true), 0)
  check('the container is no larger than its parts plus overhead',
    whole.length < p1.length + p2.length + 4096, true)
}

console.log('\nWHAT IS NOT A COLLECTION IS REFUSED, NOT MISREAD')
{
  check('a plain bundle is not a collection', await readCollectionIndex(new Blob([p1])), null)
  check('random bytes are not a collection',
    await readCollectionIndex(new Blob([new Uint8Array([1, 2, 3, 4, 5])])), null)
  const wrong = writeCollection({ ...META, schema: 'something/else@9' }, [
    { file: 'parts/d1.zip', bytes: p1 },
  ])
  check('a container with a schema we do not read is refused',
    await readCollectionIndex(wrong), null)
}

console.log('\nONE PART IS STILL A COLLECTION')
// An object that did not need splitting still comes back as one file, so the
// studio only ever has to understand one shape.
{
  const single = writeCollection(
    { ...META, splitBy: null, reason: null, parts: [{ key: 'all cells', file: 'parts/all.zip', nCells: 30, nnz: 60, bytes: 0 }] },
    [{ file: 'parts/all.zip', bytes: p1 }])
  const idx = await readCollectionIndex(single)
  check('it reads', idx.meta.parts.length, 1)
  check('and says it was not split', idx.meta.splitBy, null)
}

console.log('\nLARGE OFFSETS ARE HANDLED')
// Parts are megabytes each; the second part's offset must be read as unsigned.
{
  const big = new Uint8Array(3_000_000)
  for (let i = 0; i < big.length; i += 7919) big[i] = i & 255
  const many = writeCollection(META, [
    { file: 'parts/d1.zip', bytes: big },
    { file: 'parts/d2.zip', bytes: p2 },
  ])
  const idx = await readCollectionIndex(many)
  const back = await readEntry(many, idx.entries.get('parts/d2.zip'))
  check('a part after a 3 MB one is still found', Array.from(back), Array.from(p2))
  const first = await readEntry(many, idx.entries.get('parts/d1.zip'))
  check('and the big one is intact', first.length === big.length && first[7919] === big[7919], true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll collection tests passed\n')
process.exit(failed ? 1 : 0)
