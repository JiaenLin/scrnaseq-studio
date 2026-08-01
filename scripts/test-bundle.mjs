// Bundle reader regressions.
//
// A bundle is written by two independent exporters, in Python and in R, and read
// here. Nothing checks that contract at runtime except this file — so it builds
// bundles in memory, reads them back, and makes sure a damaged one is refused
// rather than half-loaded. A half-loaded object is worse than none: the app
// would draw figures from whatever survived.
import { zipSync, strToU8 } from 'fflate'
import { parseBundle, bundleDataset } from '../src/lib/bundle.ts'
import { bundleSource } from '../src/lib/source.ts'
import { deMarkers, isSig, thresholdFor } from '../src/lib/stats.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const rejects = (name, build, fragment) => {
  try {
    parseBundle(build())
    failed++
    console.log(`  FAIL ${name}\n        it was accepted`)
  } catch (e) {
    const ok = String(e.message).toLowerCase().includes(fragment.toLowerCase())
    if (!ok) failed++
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        message was: ${e.message}`}`)
  }
}

const bytes = (arr, Ctor) => new Uint8Array(Ctor.from(arr).buffer)

/**
 * Four cells, three genes, two clusters, two samples in two groups.
 *   gene A: only in cluster 0    gene B: only in cluster 1    gene C: everywhere
 */
function build(over = {}) {
  const meta = {
    schema: 'scrnaseq-studio/bundle@1',
    label: 'tiny', source: 'built in the test',
    nCells: 4, nGenes: 3, nnz: 6,
    clusters: ['alpha', 'beta'],
    samples: [{ id: 's1', condition: 'ctrl' }, { id: 's2', condition: 'treat' }],
    conditions: ['ctrl', 'treat'],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: false,
    provenance: { normalization: 'log1p(CP10K)', clustering: 'leiden' },
    notes: ['a note'],
    ...(over.meta ?? {}),
  }
  const files = {
    'meta.json': strToU8(JSON.stringify(meta)),
    'genes.txt': strToU8(over.genes ?? 'A\nB\nC'),
    // CSC over genes: A -> cells 0,1 · B -> cells 2,3 · C -> cells 0,2
    'expr.indptr.i32': over.indptr ?? bytes([0, 2, 4, 6], Int32Array),
    'expr.indices.i32': over.indices ?? bytes([0, 1, 2, 3, 0, 2], Int32Array),
    'expr.data.f32': bytes([1.5, 1.2, 2.0, 1.8, 0.9, 1.1], Float32Array),
    'cluster.u16': over.cluster ?? bytes([0, 0, 1, 1], Uint16Array),
    'sample.u16': bytes([0, 0, 1, 1], Uint16Array),
    'embed.f32': bytes([0, 0, 1, 0, 5, 5, 6, 5], Float32Array),
    'qc.f32': bytes([100, 2, 1, 110, 2, 1, 120, 2, 2, 130, 2, 2], Float32Array),
    ...(over.files ?? {}),
  }
  for (const drop of over.drop ?? []) delete files[drop]
  return zipSync(files).buffer
}

console.log('\nA WELL-FORMED BUNDLE ROUND-TRIPS')
{
  const b = parseBundle(build())
  check('cells and genes', [b.meta.nCells, b.genes.length], [4, 3])
  check('gene names', b.genes, ['A', 'B', 'C'])
  check('the CSC index is intact', [b.indptr.length, b.indptr[3]], [4, 6])
  const d = bundleDataset(b)
  check('one cell record each', d.cells.length, 4)
  check('conditions come from the samples', d.conds, ['ctrl', 'treat'])
  check('the grid counts cells per cluster and sample', d.grid, [[2, 0], [0, 2]])
  check('proportions sum to 1 per sample',
    d.prop.every(r => Math.abs(r.reduce((x, y) => x + y, 0) - 1) < 1e-9), true)
  check('QC is de-interleaved', [d.cells[0].counts, d.cells[0].genes, d.cells[0].mito], [100, 2, 1])
  check('the embedding is de-interleaved', [d.cells[2].x, d.cells[2].y], [5, 5])
}

console.log('\nTHE SOURCE READS IT')
{
  const src = bundleSource(parseBundle(build()))
  // Rounded: the bundle stores float32, so 1.2 comes back as 1.2000000476837158.
  const vec = g => Array.from(src.vector(g)).map(v => +v.toFixed(3))
  check('a gene vector is dense and per cell', vec('A'), [1.5, 1.2, 0, 0])
  check('an unknown gene is all zeros', vec('ZZZ'), [0, 0, 0, 0])
  check('lookup is case-insensitive', vec('a'), [1.5, 1.2, 0, 0])
  check('group() selects a cluster', Array.from(src.group(1)), [2, 3])
  check('group() can narrow to a condition', Array.from(src.group(1, 'treat')), [2, 3])
  check('mean over a cluster', +src.mean('A', 0).toFixed(3), 1.35)
  check('pct over a cluster', [src.pct('A', 0), src.pct('A', 1)], [1, 0])
  check('non-zero iteration visits only stored values', (() => {
    const seen = []
    src.forEachNonZero('C', (cell, v) => seen.push([cell, +v.toFixed(1)]))
    return seen
  })(), [[0, 0.9], [2, 1.1]])

  // The property the whole app rests on: the cluster-specific gene ranks first.
  // Not that it is *significant* — four cells cannot reach any sane threshold,
  // and a rank test that claimed otherwise would be the bug.
  // deMarkers returns both directions, as FindAllMarkers does; A is the gene
  // enriched in cluster 0, B the one depleted from it.
  const rows = deMarkers(src, 0).rows
  check('the enriched gene is the cluster-specific one',
    rows.filter(r => r.lfc > 0)[0]?.gene, 'A')
  check("and the other cluster's gene is depleted",
    rows.filter(r => r.lfc < 0)[0]?.gene, 'B')
  check('four cells reach no significance, correctly',
    rows.some(r => isSig(r, thresholdFor('wilcox'))), false)
}

console.log('\nA DAMAGED BUNDLE IS REFUSED, NOT HALF-LOADED')
rejects('not a zip at all', () => strToU8('hello there').buffer, 'not a zip')
rejects('no meta.json', () => build({ drop: ['meta.json'] }), 'meta.json')
rejects('no expression matrix', () => build({ drop: ['expr.data.f32'] }), 'expr.data.f32')
rejects('a schema this app does not read',
  () => build({ meta: { schema: 'something/else@9' } }), 'schema')
rejects('gene count disagreeing with meta',
  () => build({ genes: 'A\nB' }), 'genes.txt has 2')
rejects('an indptr of the wrong length',
  () => build({ indptr: bytes([0, 2, 4], Int32Array) }), 'indptr')
rejects('a cell index past the end of the matrix',
  () => build({ indices: bytes([0, 1, 2, 3, 0, 99], Int32Array) }), 'outside the matrix')
rejects('a cluster code meta.json does not define',
  () => build({ cluster: bytes([0, 0, 1, 7], Uint16Array) }), 'cluster')
rejects('a byte length that is not a multiple of the element size',
  () => build({ files: { 'qc.f32': new Uint8Array(7) } }), 'not a multiple')

console.log('\nLINE ENDINGS DO NOT SILENTLY BREAK LOOKUPS')
// R's writeLines emits CRLF and a trailing newline. That once put a carriage
// return on every gene name, so every search missed and nothing said why.
{
  const b = parseBundle(build({ genes: 'A\r\nB\r\nC\r\n' }))
  check('CR and a trailing blank are stripped', b.genes, ['A', 'B', 'C'])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll bundle tests passed\n')
process.exit(failed ? 1 : 0)
