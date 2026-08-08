// Build a collection out of one bundle, for testing the studio's reader.
//
// The lab does this for real, from an .h5ad it never holds in memory. Here the
// input is already a bundle, so the split is done the cheap way — but the OUTPUT
// is exactly what the lab writes: parts with unused levels dropped (so part A's
// cluster 0 and part B's cluster 0 are different cell types), a chunked
// expression entry stored uncompressed, and a collection.zip around them.
//
// That "unused levels dropped" is the point. A fixture that kept every part's
// level list identical would pass a broken reader.
//
//   node scripts/make-collection.mjs <bundle.zip> <parts> <out.zip>

import fs from 'node:fs'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { CHUNK_GENES, writeChunked } from '../src/lib/chunked.ts'
import { writeCollection } from '../src/lib/collection.ts'

const [inPath, nPartsArg, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: node scripts/make-collection.mjs <bundle.zip> <parts> <out.zip>')
  process.exit(2)
}
const nParts = Math.max(1, Number(nPartsArg) || 4)

const t0 = Date.now()
const files = unzipSync(new Uint8Array(fs.readFileSync(inPath)))
const meta = JSON.parse(strFromU8(files['meta.json']))
const geneTxt = files['genes.txt']
const i32 = (b) => new Int32Array(b.slice().buffer)
const u16 = (b) => new Uint16Array(b.slice().buffer)
const f32 = (b) => new Float32Array(b.slice().buffer)

const indptr = i32(files['expr.indptr.i32'])
const indices = i32(files['expr.indices.i32'])
const data = f32(files['expr.data.f32'])
const cluster = u16(files['cluster.u16'])
const sample = u16(files['sample.u16'])
const embed = f32(files['embed.f32'])
const qc = f32(files['qc.f32'])
const n = meta.nCells
const nGenes = meta.nGenes
console.log(`read ${inPath}: ${n} cells, ${nGenes} genes, ${indices.length} nonzeros (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

// Split by sample, round-robin, so every part holds whole samples and a
// different — overlapping but not identical — set of clusters. When the object
// has fewer samples than the parts asked for, fall back to contiguous blocks of
// cells: a part still ends up with only some of the levels, which is the
// property the reader has to survive.
const partOf = new Int32Array(n)
const usedSamples = new Set(sample).size
if (usedSamples >= nParts) {
  const partOfSample = new Int32Array(meta.samples.length)
  for (let s = 0; s < meta.samples.length; s++) partOfSample[s] = s % nParts
  for (let i = 0; i < n; i++) partOf[i] = partOfSample[sample[i]]
} else {
  const per = Math.ceil(n / nParts)
  for (let i = 0; i < n; i++) partOf[i] = Math.min(nParts - 1, Math.floor(i / per))
}

const cellsOf = Array.from({ length: nParts }, () => [])
for (let i = 0; i < n; i++) cellsOf[partOf[i]].push(i)

const pb = files['pseudobulk.tsv'] ? strFromU8(files['pseudobulk.tsv']).split('\n') : null
const pbHeader = pb ? pb[0].split('\t').slice(1) : []

const parts = []
for (let p = 0; p < nParts; p++) {
  const cells = Int32Array.from(cellsOf[p])
  if (!cells.length) continue
  const local = new Int32Array(n).fill(-1)
  cells.forEach((c, k) => { local[c] = k })

  // Drop unused levels, keeping the parent's order — build.ts does exactly this.
  const keepLevels = (codes, levels) => {
    const seen = new Uint8Array(levels.length)
    for (const c of cells) seen[codes[c]] = 1
    const map = new Int32Array(levels.length).fill(-1)
    const kept = []
    for (let i = 0; i < levels.length; i++) if (seen[i]) { map[i] = kept.length; kept.push(levels[i]) }
    return { map, kept }
  }
  const cl = keepLevels(cluster, meta.clusters)
  const sm = keepLevels(sample, meta.samples.map(s => s.id))
  const keptSamples = sm.kept.map(id => meta.samples.find(s => s.id === id))
  const conds = meta.conditions.filter(c => keptSamples.some(s => s.condition === c))

  const clusterOut = new Uint16Array(cells.length)
  const sampleOut = new Uint16Array(cells.length)
  const embedOut = new Float32Array(cells.length * 2)
  const qcOut = new Float32Array(cells.length * 3)
  cells.forEach((c, k) => {
    clusterOut[k] = cl.map[cluster[c]]
    sampleOut[k] = sm.map[sample[c]]
    embedOut[2 * k] = embed[2 * c]; embedOut[2 * k + 1] = embed[2 * c + 1]
    qcOut[3 * k] = qc[3 * c]; qcOut[3 * k + 1] = qc[3 * c + 1]; qcOut[3 * k + 2] = qc[3 * c + 2]
  })

  // Subset the gene-major matrix: one forward pass, so it stays O(nnz).
  const ptrOut = new Int32Array(nGenes + 1)
  let nnz = 0
  for (let g = 0; g < nGenes; g++) {
    for (let k = indptr[g]; k < indptr[g + 1]; k++) if (partOf[indices[k]] === p) nnz++
    ptrOut[g + 1] = nnz
  }
  const idxOut = new Int32Array(nnz)
  const datOut = new Float32Array(nnz)
  let w = 0
  for (let g = 0; g < nGenes; g++) {
    for (let k = indptr[g]; k < indptr[g + 1]; k++) {
      if (partOf[indices[k]] !== p) continue
      idxOut[w] = local[indices[k]]
      datOut[w] = data[k]
      w++
    }
  }

  const partMeta = {
    ...meta,
    label: `${meta.label} part${p + 1}`,
    nCells: cells.length,
    nnz,
    clusters: cl.kept,
    samples: keptSamples,
    conditions: conds,
    chunkGenes: CHUNK_GENES,
  }

  const out = {
    'meta.json': strToU8(JSON.stringify(partMeta)),
    'genes.txt': geneTxt,
    'cluster.u16': new Uint8Array(clusterOut.buffer),
    'sample.u16': new Uint8Array(sampleOut.buffer),
    'embed.f32': new Uint8Array(embedOut.buffer),
    'qc.f32': new Uint8Array(qcOut.buffer),
    'expr.indptr.i32': new Uint8Array(ptrOut.buffer),
    'expr.indices.i32': new Uint8Array(idxOut.buffer),
    'expr.data.f32': new Uint8Array(datOut.buffer),
  }

  // Only a split along whole samples keeps each pseudobulk column inside one
  // part. A block split cuts columns in half, and the summed counts cannot be
  // re-derived without the raw matrix — so leave them out rather than write a
  // table that says the wrong thing.
  if (pb && usedSamples >= nParts) {
    const keep = []
    pbHeader.forEach((h, ci) => {
      const [sid] = h.split('||')
      if (sm.map[meta.samples.findIndex(s => s.id === sid)] >= 0) keep.push(ci)
    })
    const lines = ['gene\t' + keep.map(ci => pbHeader[ci]).join('\t')]
    for (let r = 1; r < pb.length; r++) {
      if (!pb[r].trim()) continue
      const cols = pb[r].split('\t')
      lines.push(cols[0] + '\t' + keep.map(ci => cols[ci + 1]).join('\t'))
    }
    out['pseudobulk.tsv'] = strToU8(lines.join('\n'))
  }

  const { bin, ptr } = writeChunked(ptrOut, idxOut, datOut, CHUNK_GENES)
  out['expr.chunkptr.i32'] = new Uint8Array(ptr.buffer)

  // level 0 on the chunked entry: it is already a stack of deflate streams, and
  // deflating it again would destroy the byte ranges the format exists for.
  const zip = zipSync({ ...out, 'expr.chunk.bin': [bin, { level: 0 }] }, { level: 6 })
  parts.push({
    key: `part${p + 1}`, file: `parts/part${p + 1}.zip`, bytes: zip,
    nCells: cells.length, nnz,
  })
  console.log(`  part${p + 1}: ${cells.length} cells, ${cl.kept.length} clusters, `
    + `${keptSamples.length} samples, ${nnz} nonzeros, ${(zip.length / 1e6).toFixed(1)} MB`)
}

const cmeta = {
  schema: 'scrnaseq-studio/collection@1',
  label: meta.label,
  source: meta.source,
  splitBy: 'sample',
  reason: `${meta.nnz} stored values is more than one bundle can hold, so the object was `
    + `stored in ${parts.length} parts. The studio opens it as one dataset.`,
  nCells: n,
  nGenes,
  parts: parts.map(p => ({ key: p.key, file: p.file, nCells: p.nCells, nnz: p.nnz, bytes: p.bytes.length })),
  notes: meta.notes ?? [],
}

const blob = writeCollection(cmeta, parts.map(p => ({ file: p.file, bytes: p.bytes })))
fs.writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()))
console.log(`wrote ${outPath}: ${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB, `
  + `${parts.length} parts, ${n} cells (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
