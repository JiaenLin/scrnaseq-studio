import { openAsBlob } from 'node:fs'
import { readCollectionIndex, readEntry } from '../src/lib/collection.ts'
import { parseBundle } from '../src/lib/bundle.ts'
const f = await openAsBlob(process.argv[2])
const t = Date.now()
const idx = await readCollectionIndex(f)
if (!idx) { console.log('NOT A COLLECTION'); process.exit(1) }
console.log(`index read in ${Date.now() - t} ms from a ${(f.size / 1e9).toFixed(2)} GB file`)
console.log(`  label   : ${idx.meta.label}`)
console.log(`  splitBy : ${idx.meta.splitBy}`)
console.log(`  cells   : ${idx.meta.nCells.toLocaleString()} · genes ${idx.meta.nGenes.toLocaleString()}`)
console.log(`  parts   : ${idx.meta.parts.length}`)
console.log(`  reason  : ${idx.meta.reason}`)
let cells = 0
for (const p of idx.meta.parts) cells += p.nCells
console.log(`  sum of part cells: ${cells.toLocaleString()} (must equal ${idx.meta.nCells.toLocaleString()})`)
// Pull one part out and parse it as a bundle — without reading the rest.
const name = idx.meta.parts[0].file
const t2 = Date.now()
const bytes = await readEntry(f, idx.entries.get(name))
const b = parseBundle(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
console.log(`  part "${idx.meta.parts[0].key}" pulled in ${Date.now() - t2} ms: ${b.meta.nCells} cells, ${b.genes.length} genes, ${b.meta.nnz.toLocaleString()} nnz`)
console.log(`  chunked? ${b.meta.chunkGenes ? 'yes, ' + b.meta.chunkGenes + ' genes/chunk' : 'NO — lazy reads impossible'}`)
