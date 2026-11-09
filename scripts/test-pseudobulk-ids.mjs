// Pseudobulk column headers whose ids hold '|'.
//
// The lab and both exporters write each summed column as
// `sample||cluster||nCells`, with the ids unescaped. A sample whose cells sit in
// more than one condition is split into one sample per condition, named
// `sample|condition` (scrnaseq-lab's converter; tools/export_h5ad.py and
// tools/export_seurat.R), and a name another sample already has gets `#2`. So
// an id can hold '|': a condition level that is empty gives `s1|`, one that
// starts with '|' gives `s2||x`, one that holds '||' gives `s3|a||b`. Cluster
// names come from the object as they are, so they can hold it too.
//
// Split on '||', those headers hand a sample's counts to a sample that does not
// exist — or, with a count that reads as 0, sum several of its columns into one.
// The figures still draw: the export table says "under 10 cells" for a sample
// that has thirty, and the matrix a user takes to DESeq2 is short a replicate.
//
// Every object here is built in memory in the shape the lab writes, and read
// through the studio's own bundle and collection readers.

import { strToU8, zipSync } from 'fflate'
import { parseBundle } from '../src/lib/bundle.ts'
import { writeChunked } from '../src/lib/chunked.ts'
import { readCollectionIndex, writeCollection } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { bundleSource } from '../src/lib/source.ts'
import { sentinelBundle, sentinelCollection } from './fixture-sentinels.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
/** A check whose setup may throw: a throw fails this check, not the file. */
const attempt = async (name, fn, want) => {
  try {
    check(name, await fn(), want)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}\n        threw ${e?.message ?? e}`)
  }
}

const GENES = ['G1', 'G2', 'G3']
const u8 = (typed) => new Uint8Array(typed.buffer)
/** A gene's raw count in one cell: distinct enough that a column read as another's shows. */
const countOf = (g, cell) => (cell + 1) * (g + 1) + (cell % 3)

/**
 * One bundle over `cells` ({ s, cond, t }, with a global `id`), written the way
 * the lab writes one: levels in order of first appearance, unused ones dropped,
 * and a pseudobulk column per sample × cluster that has cells, sample-major.
 */
function bundleFiles(cells, { chunked = false, hasRawCounts = true } = {}) {
  const samples = [...new Set(cells.map(c => c.s))]
  const clusters = [...new Set(cells.map(c => c.t))]
  const condOf = new Map(cells.map(c => [c.s, c.cond]))
  const n = cells.length
  const indptr = new Int32Array(GENES.length + 1)
  const idx = []
  const dat = []
  GENES.forEach((_g, g) => {
    cells.forEach((c, k) => { idx.push(k); dat.push(countOf(g, c.id)) })
    indptr[g + 1] = idx.length
  })
  const indices = Int32Array.from(idx)
  const data = Float32Array.from(dat)
  const head = []
  const sums = []
  for (const s of samples) {
    for (const t of clusters) {
      const sel = cells.filter(c => c.s === s && c.t === t)
      if (!sel.length) continue
      head.push(`${s}||${t}||${sel.length}`)
      sums.push(GENES.map((_g, g) => sel.reduce((a, c) => a + countOf(g, c.id), 0)))
    }
  }
  const tsv = [`gene\t${head.join('\t')}`,
    ...GENES.map((gene, g) => [gene, ...sums.map(col => col[g])].join('\t'))].join('\n')
  const meta = {
    schema: 'scrnaseq-studio/bundle@1',
    label: 'ids fixture', source: 'built in the test',
    nCells: n, nGenes: GENES.length, nnz: indices.length,
    clusters,
    samples: samples.map(id => ({ id, condition: condOf.get(id) })),
    conditions: [...new Set(cells.map(c => c.cond))],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts,
    provenance: { clustering: 'cell_type', condition: 'cond', sample: 'sample' },
    notes: ['a fixture'],
    ...(chunked ? { chunkGenes: 2 } : {}),
  }
  const files = {
    'meta.json': strToU8(JSON.stringify(meta)),
    'genes.txt': strToU8(GENES.join('\n')),
    'expr.indptr.i32': u8(indptr),
    'expr.indices.i32': u8(indices),
    'expr.data.f32': u8(data),
    'cluster.u16': u8(Uint16Array.from(cells, c => clusters.indexOf(c.t))),
    'sample.u16': u8(Uint16Array.from(cells, c => samples.indexOf(c.s))),
    'embed.f32': u8(Float32Array.from({ length: 2 * n }, (_x, k) => k)),
    'qc.f32': u8(Float32Array.from({ length: 3 * n }, (_x, k) => 100 + k)),
    'pseudobulk.tsv': strToU8(tsv),
  }
  if (chunked) {
    const { bin, ptr } = writeChunked(indptr, indices, data, 2)
    files['expr.chunkptr.i32'] = u8(ptr)
    files['expr.chunk.bin'] = [bin, { level: 0 }]
  }
  return files
}

/** Cells from [sample, condition, cluster, how many] rows, numbered globally. */
function cellsOf(rows) {
  const out = []
  for (const [s, cond, t, k] of rows) for (let i = 0; i < k; i++) out.push({ s, cond, t, id: out.length })
  return out
}

const openBundle = (cells, opts) => bundleSource(parseBundle(zipSync(bundleFiles(cells, opts)).buffer))

/** A collection whose parts hold the given cells, each part written as the lab writes one. */
async function openParts(partCells) {
  const parts = partCells.map((cells, k) => ({
    key: `p${k + 1}`, file: `parts/p${k + 1}.zip`, nCells: cells.length,
    bytes: zipSync(bundleFiles(cells, { chunked: true })),
  }))
  const blob = writeCollection({
    schema: 'scrnaseq-studio/collection@1', label: 'ids fixture', source: 'built in the test',
    splitBy: 'sample', reason: 'split for the test', nCells: partCells.flat().length, nGenes: GENES.length,
    parts: parts.map(p => ({ key: p.key, file: p.file, nCells: p.nCells, nnz: 0, bytes: p.bytes.length })),
    notes: [],
  }, parts.map(p => ({ file: p.file, bytes: p.bytes })))
  return openCollection(blob, await readCollectionIndex(blob))
}

/** The columns a correct reader must find: sample × cluster, summed over all cells. */
function truth(cells) {
  const out = new Map()
  for (const c of cells) {
    const k = JSON.stringify([c.s, c.t])
    if (!out.has(k)) out.set(k, { sample: c.s, cluster: c.t, nCells: 0, counts: GENES.map(() => 0) })
    const col = out.get(k)
    col.nCells++
    GENES.forEach((_g, g) => { col.counts[g] += countOf(g, c.id) })
  }
  return [...out.values()]
}

/** What the reader found, in the same shape, ordered as `want` is. */
function found(src, want) {
  const pb = src.pseudobulk
  if (!pb) return null
  const cols = pb.columns.map((c, j) => ({
    sample: c.sample, cluster: c.cluster, nCells: c.nCells,
    counts: GENES.map((_g, g) => pb.counts[g * pb.columns.length + j]),
  }))
  const rank = new Map(want.map((w, i) => [JSON.stringify([w.sample, w.cluster]), i]))
  return cols.sort((a, b) => (rank.get(JSON.stringify([a.sample, a.cluster])) ?? 1e9)
    - (rank.get(JSON.stringify([b.sample, b.cluster])) ?? 1e9))
}

/** Columns whose sample or cluster this object does not have. */
const orphans = (src) => {
  const ids = new Set(src.d.samples.map(s => s.id))
  const types = new Set(src.clusters)
  return (src.pseudobulk?.columns ?? []).filter(c => !ids.has(c.sample) || !types.has(c.cluster))
    .map(c => `${c.sample} / ${c.cluster}`)
}

/** Each sample's cells against the cells its columns say they sum. */
function attached(src) {
  const cells = new Map()
  for (const c of src.d.cells) cells.set(c.s, (cells.get(c.s) ?? 0) + 1)
  const pb = new Map()
  for (const c of src.pseudobulk?.columns ?? []) pb.set(c.sample, (pb.get(c.sample) ?? 0) + c.nCells)
  return [...cells].filter(([s, n]) => pb.get(s) !== n).map(([s, n]) => `${s}: ${pb.get(s) ?? 0} of ${n}`)
}

// The split ids the lab writes for a condition level that is empty, starts
// with '|', holds '||', or collides; cluster names that hold '|' at either end
// and in the middle. No two declared pairs join to the same header.
const ODD = cellsOf([
  ['s1|ok', 'ok', 'TypeA', 3], ['s1|ok', 'ok', 'trail|', 2],
  ['s1|', '', 'TypeA', 2], ['s1|', '', '|lead', 3],
  ['s2||x', '|x', 'T||NK', 4], ['s2||x', '|x', 'trail|', 1],
  ['s3|a||b', 'a||b', 'TypeA', 2], ['s3|a||b', 'a||b', '|lead', 2], ['s3|a||b', 'a||b', 'T||NK', 1],
  ['s4|c#2', 'c', 'T||NK', 3],
  ['s5', 'ok', 'TypeA', 2], ['s5', 'ok', '|lead', 1],
])

console.log("\nA BUNDLE: EVERY HEADER IS READ AS THE PAIR IT WAS WRITTEN FOR")
{
  const src = openBundle(ODD)
  const want = truth(ODD)
  check('every column attaches to its own sample and cluster, with its own count and counts',
    found(src, want), want)
  check('no column names a sample or cluster this object does not have', orphans(src), [])
  check("every sample's columns sum to its cells", attached(src), [])
  check('raw counts still read as present (guard)', src.meta.hasRawCounts, true)
}

console.log('\nA COLLECTION: THE SAME, PART BY PART, AND SUMMED ACROSS PARTS')
{
  // s2||x and s3|a||b sit in both parts, in the same clusters, so their
  // columns are written twice and must be added back together.
  const a = ODD.filter(c => c.id % 2 === 0)
  const b = ODD.filter(c => c.id % 2 === 1)
  await attempt('every column attaches to its own pair, summed across the parts', async () => {
    const src = await openParts([a, b])
    return found(src, truth(ODD))
  }, truth(ODD))
  await attempt('no orphaned column, and every sample attached', async () => {
    const src = await openParts([a, b])
    return { orphans: orphans(src), attached: attached(src) }
  }, { orphans: [], attached: [] })
}

console.log('\nTWO PAIRS THAT JOIN TO ONE STRING STAY TWO COLUMNS')
{
  // `a` in `|b` and `a|` in `b` both join to `a|||b`. Each part declares only
  // one of the two readings, so each header has exactly one — but a merge
  // keyed by the joined string would add the two columns into one.
  const cells = cellsOf([['a', 'g1', '|b', 3], ['a|', 'g2', 'b', 4]])
  await attempt('both columns survive the merge, each with its own count and counts', async () => {
    const src = await openParts([cells.slice(0, 3), cells.slice(3)])
    return found(src, truth(cells))
  }, truth(cells))
}

console.log('\nTWO DECLARED READINGS OF ONE HEADER: REFUSED, NOT GUESSED')
{
  // Here one part declares both: samples `a` and `a|`, clusters `|b` and `b`.
  // `a|||b||3` is then either pair, and choosing one would put one sample's
  // counts under the other's name.
  const cells = cellsOf([['a', 'g1', '|b', 3], ['a|', 'g2', 'b', 3]])
  const src = openBundle(cells)
  check('the bundle offers no pseudobulk table', src.pseudobulk, null)
  check('and does not promise one', src.meta.hasRawCounts, false)
  check('a note names the header that reads two ways',
    src.meta.notes.some(n => n.includes('a|||b||3') && /two|more than one/i.test(n)), true)
  await attempt('a collection refuses it the same way, with a note', async () => {
    const col = await openParts([cells])
    return { table: col.pseudobulk, noted: col.meta.notes.some(n => n.includes('a|||b||3')) }
  }, { table: null, noted: true })
  // The cells themselves are untouched: this is about the summed table only.
  check('the cells keep their samples (guard)', src.d.samples.map(s => s.id), ['a', 'a|'])
}

console.log("\nGUARD: HEADERS WITH NO '|' IN THEIR IDS READ AS THEY ALWAYS DID")
{
  /** The reading every studio before this one gave a header. */
  const old = (h) => {
    const [sample, cluster, nCells] = h.split('||')
    return { sample, cluster: cluster ?? '', nCells: Number(nCells) || 0 }
  }
  const plain = cellsOf([
    ['s1', 'a1', 'TypeA', 3], ['s1', 'a1', 'TypeB', 2], ['s2', 'a2', 'TypeA', 4], ['s3', 'a2', 'TypeB', 1],
  ])
  const header = (files) => new TextDecoder().decode(files['pseudobulk.tsv']).split('\n')[0].split('\t').slice(1)
  const src = openBundle(plain)
  check('a plain bundle: the same columns, in the same order',
    src.pseudobulk.columns, header(bundleFiles(plain)).map(old))
  const sb = bundleSource(parseBundle(sentinelBundle()))
  const fromFile = (await import('fflate')).unzipSync(new Uint8Array(sentinelBundle()))
  check('the committed sentinel fixture: the same columns, in the same order',
    sb.pseudobulk.columns, header(fromFile).map(old))
  const blob = sentinelCollection()
  const sc = await openCollection(blob, await readCollectionIndex(blob))
  check('its collection: the same number of columns as the unsplit bundle',
    sc.pseudobulk.columns.length, sb.pseudobulk.columns.length)
  check('and the same cells in each', sc.pseudobulk.columns.map(c => `${c.sample}|${c.cluster}|${c.nCells}`).sort(),
    sb.pseudobulk.columns.map(c => `${c.sample}|${c.cluster}|${c.nCells}`).sort())
}

console.log(failed ? `\n${failed} FAILED` : '\nAll pseudobulk-id tests passed')
process.exit(failed ? 1 : 0)
