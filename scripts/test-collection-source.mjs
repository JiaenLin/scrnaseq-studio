// Opening a collection as one intact dataset.
//
// The fixture is deliberately nasty in the one way real parts are nasty: each
// part is written with only the levels it uses, so part A's cluster 0 and part
// B's cluster 0 are different cell types, and part orders disagree. A reader
// that concatenates the code arrays without remapping renders perfectly and
// mislabels a third of the object, so the check here is against the truth table
// the fixture was built from, cell by cell — not against "it loaded".

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { CHUNK_GENES, writeChunked } from '../src/lib/chunked.ts'
import { cellColumns } from '../src/lib/bundle.ts'
import { readCollectionIndex, writeCollection } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { compFields, compTable, fieldLabel } from '../src/lib/composition.ts'
import { unionLevels } from '../src/lib/levels.ts'
import { deMarkersAllAsync, deWilcoxAsync } from '../src/lib/stats.ts'

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
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${msg}\n        want …${fragment}…`}`)
}

console.log('\nLEVELS COME BACK IN THE ORDER THE OBJECT HAD THEM')
{
  // Each part is a subsequence of [A,B,C,D,E]; no single part shows the whole
  // order, and no part shows B next to C.
  const u = unionLevels([['A', 'C', 'E'], ['B', 'C', 'D'], ['A', 'B'], ['D', 'E']])
  check('the parent order is recovered', u.levels, ['A', 'B', 'C', 'D', 'E'])
  check('every part maps onto it', u.maps.map(m => [...m]), [[0, 2, 4], [1, 2, 3], [0, 1], [3, 4]])
}
{
  const u = unionLevels([['x'], ['x'], ['x']])
  check('one shared level stays one level', [u.levels, u.maps.map(m => [...m])],
    [['x'], [[0], [0], [0]]])
}
{
  // Two parts that genuinely disagree — B before C in one, C before B in the
  // other. Nothing may be dropped or duplicated.
  const u = unionLevels([['B', 'C'], ['C', 'B']])
  check('a contradiction still yields every level once',
    [u.levels.length, [...u.levels].sort()], [2, ['B', 'C']])
  check('and both parts still map onto it',
    u.maps.map(m => m.length), [2, 2])
}
{
  const u = unionLevels([[], ['a']])
  check('an empty part is harmless', [u.levels, [...u.maps[1]]], [['a'], [0]])
}
{
  // Split an object by donor and every part holds one timepoint, so nothing in
  // the file says which came first. Order them the way the collection was made,
  // not the way the lab happened to emit the parts.
  const u = unionLevels([['e8.5'], ['e10.0'], ['e7.0'], ['e8.0']])
  check('timepoints no part orders come back in their own order',
    u.levels, ['e7.0', 'e8.0', 'e8.5', 'e10.0'])
  check('and the parts still map onto them', u.maps.map(m => [...m]), [[2], [3], [0], [1]])
  check('part order does not change the answer',
    unionLevels([['e7.0'], ['e8.0'], ['e8.5'], ['e10.0']]).levels, u.levels)
}
{
  // But evidence beats the guess: one part that holds both says which is first.
  const u = unionLevels([['Treated', 'Control'], ['Control'], ['Treated']])
  check('a part that orders two levels overrules the alphabet',
    u.levels, ['Treated', 'Control'])
}

/* ------------------------------------------------------------------ fixture */

// 6 genes, 12 cells, 3 parts. Cluster names are chosen so that a reader which
// forgets to remap produces a specific, checkable lie.
const GENES = ['Aaa', 'Bbb', 'Ccc', 'Ddd', 'Eee', 'Fff']
// `regions` is an extra categorical column, dropped to the levels each part
// uses in exactly the way cluster and sample are — so part 2's region 0 is
// Midbrain while part 1's is Cortex. Nothing about it is a role, which is the
// point: it has to survive the same remap through code that never heard of it.
const PARTS = [
  {
    key: 'p1',
    clusters: ['Astrocyte', 'Neuron'],
    samples: [{ id: 's1', condition: 'ctrl' }],
    conditions: ['ctrl'],
    regions: ['Cortex', 'Midbrain'],
    // per cell: [cluster code, sample code, region code]
    cells: [[0, 0, 0], [1, 0, 1], [1, 0, 0], [0, 0, 1]],
  },
  {
    key: 'p2',
    clusters: ['Neuron', 'Microglia'],
    samples: [{ id: 's2', condition: 'drug' }],
    conditions: ['drug'],
    regions: ['Midbrain', 'Hindbrain'],
    cells: [[1, 0, 0], [0, 0, 1], [1, 0, 0]],
  },
  {
    key: 'p3',
    clusters: ['Astrocyte', 'Microglia'],
    samples: [{ id: 's3', condition: 'ctrl' }, { id: 's4', condition: 'drug' }],
    conditions: ['ctrl', 'drug'],
    regions: ['Cortex', 'Hindbrain'],
    cells: [[0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 0], [0, 0, 0]],
  },
]

/** Deterministic sparse values: gene g, global cell c. */
const valueAt = (g, c) => ((g * 7 + c * 3) % 5 === 0 ? 0 : ((g + 1) * (c + 2)) % 11)

function buildPart(part, offset, chunkGenes, dropRegion = false) {
  const n = part.cells.length
  const cluster = Uint16Array.from(part.cells.map(c => c[0]))
  const sample = Uint16Array.from(part.cells.map(c => c[1]))
  const region = Uint16Array.from(part.cells.map(c => c[2]))
  const embed = Float32Array.from(part.cells.flatMap((_c, i) => [offset + i, -(offset + i)]))
  const qc = Float32Array.from(part.cells.flatMap((_c, i) => [1000 + offset + i, 500, 0.5]))

  const indptr = new Int32Array(GENES.length + 1)
  const idx = []
  const dat = []
  for (let g = 0; g < GENES.length; g++) {
    for (let i = 0; i < n; i++) {
      const v = valueAt(g, offset + i)
      if (v !== 0) { idx.push(i); dat.push(v) }
    }
    indptr[g + 1] = idx.length
  }
  const indices = Int32Array.from(idx)
  const data = Float32Array.from(dat)
  const { bin, ptr } = writeChunked(indptr, indices, data, chunkGenes)

  const meta = {
    schema: 'scrnaseq-studio/bundle@1',
    label: `object ${part.key}`, source: 'fixture.h5ad',
    nCells: n, nGenes: GENES.length, nnz: indices.length,
    clusters: part.clusters, samples: part.samples, conditions: part.conditions,
    extras: dropRegion
      ? []
      : [{ key: 'region', file: 'extra.region.u16', levels: part.regions }],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: true,
    provenance: { normalization: 'log1p(CP10K)', clustering: 'leiden', condition: 'timepoint' },
    notes: ['a fixture'], chunkGenes,
  }
  const files = {
    'meta.json': strToU8(JSON.stringify(meta)),
    'genes.txt': strToU8(GENES.join('\n')),
    'cluster.u16': new Uint8Array(cluster.buffer),
    'sample.u16': new Uint8Array(sample.buffer),
    ...(dropRegion ? {} : { 'extra.region.u16': new Uint8Array(region.buffer) }),
    'embed.f32': new Uint8Array(embed.buffer),
    'qc.f32': new Uint8Array(qc.buffer),
    'expr.indptr.i32': new Uint8Array(indptr.buffer),
    'expr.indices.i32': new Uint8Array(indices.buffer),
    'expr.data.f32': new Uint8Array(data.buffer),
    'expr.chunkptr.i32': new Uint8Array(ptr.buffer),
  }
  return zipSync({ ...files, 'expr.chunk.bin': [bin, { level: 0 }] }, { level: 6 })
}

function buildCollection({
  chunkGenes = CHUNK_GENES, breakGenes = false, halfRegion = false,
  orders = { extras: { region: ['Hindbrain', 'Midbrain', 'Cortex'] } },
} = {}) {
  let offset = 0
  const bundles = PARTS.map((p, i) => {
    const bytes = buildPart(p, offset, chunkGenes, halfRegion && i === 1)
    offset += p.cells.length
    return { key: p.key, file: `parts/${p.key}.zip`, bytes, nCells: p.cells.length, i }
  })
  if (breakGenes) {
    // One part measuring different genes is not a piece of the same object.
    const other = { ...PARTS[1] }
    const saved = GENES[0]
    GENES[0] = 'Zzz'
    bundles[1].bytes = buildPart(other, PARTS[0].cells.length, chunkGenes)
    GENES[0] = saved
  }
  const meta = {
    schema: 'scrnaseq-studio/collection@1',
    label: 'one intact object', source: 'fixture.h5ad',
    splitBy: 'sample', reason: 'too large for one bundle',
    nCells: offset, nGenes: GENES.length,
    // What the whole object's order was, before the parts dropped what they do
    // not hold. Both are optional and a collection without them still opens —
    // the levels are then reconstructed from the parts.
    ...(orders
      ? { condOrder: orders.conds ?? ['ctrl', 'drug'], extraOrder: orders.extras }
      : {}),
    parts: bundles.map(b => ({
      key: b.key, file: b.file, nCells: b.nCells, nnz: 0, bytes: b.bytes.length,
    })),
    notes: [],
  }
  return writeCollection(meta, bundles.map(b => ({ file: b.file, bytes: b.bytes })))
}

/** The truth the fixture was built from, computed independently of the reader. */
const TRUTH = (() => {
  const cells = []
  let offset = 0
  for (const p of PARTS) {
    for (const [c, s, r] of p.cells) {
      cells.push({
        cluster: p.clusters[c], sample: p.samples[s].id,
        cond: p.samples[s].condition, region: p.regions[r],
      })
    }
    offset += p.cells.length
  }
  return { cells, n: offset }
})()

async function openFixture(opts) {
  const blob = buildCollection(opts)
  const index = await readCollectionIndex(blob)
  if (!index) throw new Error('the fixture is not recognised as a collection')
  return openCollection(blob, index)
}

/* -------------------------------------------------------------------- tests */

console.log('\nA COLLECTION OPENS AS ONE OBJECT')
const src = await openFixture()
check('every cell is there', src.d.nCells, TRUTH.n)
check('not one part of it', src.d.nCells > Math.max(...PARTS.map(p => p.cells.length)), true)
check('the gene list is the object\'s', src.genes, GENES)
check('it knows it is stored in parts', src.nParts, PARTS.length)
check('and that its values are not in memory', src.lazy, true)

console.log('\nEVERY CELL KEEPS THE LABEL IT HAD')
// The whole point. Part 2's cluster 0 is Neuron; part 1's cluster 0 is Astrocyte.
check('cluster names, cell by cell',
  src.d.cells.map(c => src.clusters[c.t]), TRUTH.cells.map(c => c.cluster))
check('sample ids, cell by cell', src.d.cells.map(c => c.s), TRUTH.cells.map(c => c.sample))
check('groups, cell by cell', src.d.cells.map(c => c.cond), TRUTH.cells.map(c => c.cond))
check('the cluster menu is the union, in order',
  src.clusters, ['Astrocyte', 'Neuron', 'Microglia'])
check('the samples are the union', src.d.samples.map(s => s.id), ['s1', 's2', 's3', 's4'])
check('the groups are the union', src.d.conds, ['ctrl', 'drug'])
check('the embedding follows the cells',
  [...src.d.cells.map(c => c.x)], TRUTH.cells.map((_c, i) => i))
check('so does QC', [...src.d.cells.map(c => c.counts)], TRUTH.cells.map((_c, i) => 1000 + i))

console.log('\nAN EXTRA COLUMN SURVIVES THE SPLIT TOO')
{
  const [region] = cellColumns(src.d).extras
  check('it is there, under the object\'s own name', region?.key, 'region')
  check('the recorded order wins over the one the parts imply',
    region.levels, ['Hindbrain', 'Midbrain', 'Cortex'])
  // Part 2's region 0 is Midbrain and part 1's is Cortex; a reader that
  // concatenated the codes would relabel seven of these twelve cells.
  check('regions, cell by cell',
    [...region.codes].map(c => region.levels[c]), TRUTH.cells.map(c => c.region))

  // And the composition machinery treats it as another field, with no idea
  // which one it is.
  check('it joins the fields a figure can be split by',
    compFields(src.d), ['type', 'cond', 'extra0', 'sample'])
  check('the menus say the object\'s word, not ours',
    [fieldLabel(src.d, 'extra0'), fieldLabel(src.d, 'cond')], ['region', 'timepoint'])
  const t = compTable(src.d, src.types, 'type', ['extra0'])
  check('and the products count the cells',
    t.rows.map(r => [region.levels[r.keys[0]], r.n]),
    ['Hindbrain', 'Midbrain', 'Cortex'].map(name =>
      [name, TRUTH.cells.filter(c => c.region === name).length]))
}
{
  const plain = await openFixture({ orders: null })
  const [region] = cellColumns(plain.d).extras
  check('without a recorded order the levels are still all there, once',
    [...region.levels].sort(), ['Cortex', 'Hindbrain', 'Midbrain'])
  check('and every cell still has the region it had',
    [...region.codes].map(c => region.levels[c]), TRUTH.cells.map(c => c.region))
}
{
  // Half a column would put a third of the object in whichever level is code 0.
  const partial = await openFixture({ halfRegion: true })
  check('a column one part does not carry is not offered at all',
    cellColumns(partial.d).extras.length, 0)
  check('and the object says why',
    partial.meta.notes.some(n => n.includes('region') && n.includes('every part')), true)
}

console.log('\nA GENE READS BACK ACROSS EVERY PART')
await src.ensure(GENES)
for (const g of GENES) {
  const gi = GENES.indexOf(g)
  check(`${g} matches the values it was written with`,
    [...src.vector(g)], TRUTH.cells.map((_c, i) => valueAt(gi, i)))
}
{
  // Proof that the answer really spans parts rather than stopping at the first.
  const v = src.vector('Bbb')
  const partOf = i => (i < 4 ? 0 : i < 7 ? 1 : 2)
  const hit = new Set()
  v.forEach((x, i) => { if (x > 0) hit.add(partOf(i)) })
  check('Bbb has cells in all three parts', [...hit].sort(), [0, 1, 2])
}
check('an unmeasured gene is empty, not an error',
  [...src.vector('Nope')].every(x => x === 0), true)

console.log('\nGROUP STATISTICS ARE THE WHOLE OBJECT\'S')
{
  const astro = src.clusters.indexOf('Astrocyte')
  const want = TRUTH.cells
    .map((c, i) => (c.cluster === 'Astrocyte' ? valueAt(GENES.indexOf('Ccc'), i) : null))
    .filter(x => x !== null)
  check('mean over a cluster spanning two parts',
    +src.mean('Ccc', astro).toFixed(9),
    +(want.reduce((a, b) => a + b, 0) / want.length).toFixed(9))
  check('and the detection rate',
    +src.pct('Ccc', astro).toFixed(9),
    +(want.filter(x => x > 0).length / want.length).toFixed(9))
}

console.log('\nA WHOLE-TRANSCRIPTOME PASS SEES EVERY GENE, ONCE')
{
  const seen = []
  const sums = new Map()
  const steps = []
  await src.scan((gi, each) => {
    seen.push(src.genes[gi])
    let s = 0
    each((cell, value) => { s += value * (cell + 1) })
    sums.set(src.genes[gi], s)
  }, (done, total) => steps.push([done, total]))
  check('every gene, in order', seen, GENES)
  check('progress ends at the last gene', steps[steps.length - 1], [GENES.length, GENES.length])
  const want = new Map(GENES.map((g, gi) =>
    [g, TRUTH.cells.reduce((a, _c, i) => a + valueAt(gi, i) * (i + 1), 0)]))
  check('with the right values and the right global cell numbers',
    GENES.map(g => sums.get(g)), GENES.map(g => want.get(g)))
  check('a stream cannot be run synchronously', src.scanSync(() => {}), false)
}

console.log('\nTHE STREAMED TESTS RUN ON IT')
{
  const markers = await deMarkersAllAsync(src, null)
  check('one result per cluster', markers.length, src.types.length)
  check('and it counted every cell', markers.map(m => m.n0 + m.n1),
    src.types.map(() => TRUTH.n))
  const de = await deWilcoxAsync(src, src.clusters.indexOf('Astrocyte'), 'ctrl', 'drug')
  check('a contrast finds cells on both sides', [de.n0 > 0, de.n1 > 0], [true, true])
}

console.log('\nA CHUNK SIZE THIS APP DID NOT CHOOSE STILL READS')
{
  // The bundle says how it was written; the constant in this build is irrelevant.
  const odd = await openFixture({ chunkGenes: 2 })
  await odd.ensure(['Ddd'])
  check('chunkGenes comes from the file',
    [...odd.vector('Ddd')], TRUTH.cells.map((_c, i) => valueAt(GENES.indexOf('Ddd'), i)))
}

console.log('\nPARTS THAT ARE NOT ONE OBJECT ARE REFUSED')
await throws('a different gene list is refused, clearly',
  () => openFixture({ breakGenes: true }), 'not pieces of one object')

console.log('\nAND A PLAIN BUNDLE IS NOT MISTAKEN FOR A COLLECTION')
{
  const plain = new Blob([buildPart(PARTS[0], 0, CHUNK_GENES)])
  check('readCollectionIndex says no', await readCollectionIndex(plain), null)
  const tmp = path.join(os.tmpdir(), 'not-a-zip.bin')
  fs.writeFileSync(tmp, 'hello')
  check('and so does a file that is not a zip at all',
    await readCollectionIndex(new Blob([fs.readFileSync(tmp)])), null)
  fs.unlinkSync(tmp)
}


console.log(String.fromCharCode(10) + 'A RECORDED CLUSTER ORDER IS USED, NOT GUESSED')
// Cluster order decides colour. Parts drop the levels they have no cells for,
// so reconstructing the order from the parts is a guess, and a wrong guess
// repaints every cluster: CD4 T cells came out red unsplit and cyan split.
{
  const { unionLevels } = await import('../src/lib/levels.ts')
  const parts = [['B', 'NK'], ['CD4 T', 'B'], ['NK', 'Platelet']]
  const parent = ['CD4 T', 'B', 'NK', 'Platelet']
  const u = unionLevels(parts, parent)
  check('the parent order is kept exactly', u.levels, parent)
  check('each part maps into it', u.maps.map(m => Array.from(m)), [[1, 2], [0, 1], [2, 3]])
  const missing = unionLevels([['B'], ['NK']], ['CD4 T', 'B', 'NK'])
  check('a level no part carries is dropped', missing.levels, ['B', 'NK'])
  const extra = unionLevels([['B'], ['Ghost']], ['B'])
  check('a level the order does not mention is still kept, or its cells vanish',
    extra.levels, ['B', 'Ghost'])
  check('without a recorded order it still infers one',
    unionLevels(parts).levels.length, 4)
}
console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll collection-source tests passed\n')
process.exit(failed ? 1 : 0)
