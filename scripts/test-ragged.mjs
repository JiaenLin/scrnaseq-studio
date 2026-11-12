// A table whose rows are not as wide as its header is refused, by name.
//
// pseudobulk.tsv is written with a tab between cells, and a header cell is
// `sample||cluster||nCells`. A tab inside a sample or a cell type name therefore
// makes the header one column wider than every row. Read by position, the table
// was offered with every later column holding its neighbour's counts, and no
// note (GAP-C117). Both readers of the table now check it first: one bundle
// (src/lib/bundle.ts) and the parts of a collection (src/lib/collection-source.ts).
// A table that fails is not offered, raw counts read as absent, and a note says
// which table, which line, and what to do. A well-formed table is read as before.

import { strToU8, zipSync } from 'fflate'
import * as bundle from '../src/lib/bundle.ts'
import { writeChunked } from '../src/lib/chunked.ts'
import { readCollectionIndex, writeCollection } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { bundleSource } from '../src/lib/source.ts'
import { BUDGET, words } from './copy-standard.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const attempt = async (name, fn, want) => {
  try {
    check(name, await fn(), want)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}\n        threw ${e?.message ?? e}`)
  }
}
const bytes = (arr, Ctor) => new Uint8Array(Ctor.from(arr).buffer)

/** Four cells, three genes, two cell types, two samples named as given, and this pseudobulk table. */
function bundleFiles(tsv, { samples = ['s1', 's2'], clusters = ['alpha', 'beta'], genes = ['A', 'B', 'C'], chunked = false } = {}) {
  const meta = {
    schema: 'scrnaseq-studio/bundle@1', label: 'tiny', source: 'tiny.h5ad (AnnData, converted in scRNA-seq Lab)',
    nCells: 4, nGenes: 3, nnz: 6, clusters,
    samples: [{ id: samples[0], condition: 'ctrl' }, { id: samples[1], condition: 'treat' }], conditions: ['ctrl', 'treat'],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: true,
    provenance: { normalization: 'log1p(CP10K)', clustering: 'leiden' }, notes: [],
    ...(chunked ? { chunkGenes: 2 } : {}),
  }
  const indptr = Int32Array.from([0, 2, 4, 6]), indices = Int32Array.from([0, 1, 2, 3, 0, 2])
  const data = Float32Array.from([1.5, 1.2, 2.0, 1.8, 0.9, 1.1])
  const files = {
    'meta.json': strToU8(JSON.stringify(meta)), 'genes.txt': strToU8(genes.join('\n')),
    'expr.indptr.i32': new Uint8Array(indptr.buffer), 'expr.indices.i32': new Uint8Array(indices.buffer),
    'expr.data.f32': new Uint8Array(data.buffer),
    'cluster.u16': bytes([0, 0, 1, 1], Uint16Array), 'sample.u16': bytes([0, 0, 1, 1], Uint16Array),
    'embed.f32': bytes([0, 0, 1, 0, 5, 5, 6, 5], Float32Array),
    'qc.f32': bytes([100, 2, 1, 110, 2, 1, 120, 2, 2, 130, 2, 2], Float32Array),
    'pseudobulk.tsv': strToU8(tsv),
  }
  if (chunked) {
    const { bin, ptr } = writeChunked(indptr, indices, data, 2)
    files['expr.chunkptr.i32'] = new Uint8Array(ptr.buffer)
    files['expr.chunk.bin'] = [bin, { level: 0 }]
  }
  return files
}
const { parseBundle } = bundle
// Through the module, so that on a tree without the check these two fail as checks and the rest still run.
const raggedLine = (text) => bundle.raggedLine(text)
const open = (tsv, opts) => bundleSource(parseBundle(zipSync(bundleFiles(tsv, opts)).buffer))
/** The table a writer makes: a header of sample||cluster||nCells cells joined by tabs, one row per gene. */
const table = (s1, s2, rows = [['A', 5, 7], ['B', 1, 2], ['C', 0, 3]]) =>
  [`gene\t${s1}||alpha||2\t${s2}||beta||2`, ...rows.map(r => r.join('\t'))].join('\n')
const about = (src) => src.meta.notes.filter(n => /summed raw counts/.test(n))

console.log('\nA WELL-FORMED TABLE IS READ AS BEFORE')
{
  const src = open(table('s1', 's2'))
  check('its columns, its counts, and raw counts present',
    [src.pseudobulk?.columns, [...(src.pseudobulk?.counts ?? [])], src.meta.hasRawCounts, about(src)],
    [[{ sample: 's1', cluster: 'alpha', nCells: 2 }, { sample: 's2', cluster: 'beta', nCells: 2 }], [5, 7, 1, 2, 0, 3], true, []])
  const crlf = open(table('s1', 's2').replace(/\n/g, '\r\n') + '\r\n\r\n')
  check('blank lines and CRLF line ends are not raggedness', [[...(crlf.pseudobulk?.counts ?? [])], about(crlf)], [[5, 7, 1, 2, 0, 3], []])
  await attempt('raggedLine: null for a table whose every line is as wide as its header', () => raggedLine(table('s1', 's2')), null)
}

console.log('\nA TAB INSIDE A SAMPLE NAME: THE HEADER IS WIDER THAN ITS ROWS')
{
  const src = open(table('s\t1', 's2'), { samples: ['s\t1', 's2'] })
  check('the table is not offered, and raw counts read as absent', [src.pseudobulk, src.meta.hasRawCounts], [null, false])
  check('one note: the table, the line, both widths, the name that holds the tab, and what to do', about(src),
    ['the summed raw counts are not offered: line 2 of pseudobulk.tsv has 3 columns and its header has 4. The sample "s\\t1" holds a tab, '
      + 'which splits a column in two: rename it in the object and convert again'])
  const two = open(table('s\t1', 's2').replace(/alpha/, 'al\tpha'), { samples: ['s\t1', 's2'], clusters: ['al\tpha', 'beta'] })
  check('a sample and a cell type: both named', about(two),
    ['the summed raw counts are not offered: line 2 of pseudobulk.tsv has 3 columns and its header has 5. The sample "s\\t1" and the cell type "al\\tpha" '
      + 'each hold a tab, which splits a column in two: rename them in the object and convert again'])
}

console.log('\nA TAB INSIDE A GENE ID: ONE ROW IS WIDER THAN THE HEADER')
{
  const rows = [['A', 5, 7], ['B\tx', 1, 2], ['C', 0, 3]]
  const src = open(table('s1', 's2', rows), { genes: ['A', 'B\tx', 'C'] })
  check('the table is not offered, and raw counts read as absent', [src.pseudobulk, src.meta.hasRawCounts], [null, false])
  check('one note: the line, both widths, the gene whose id holds the tab, and the change that makes another table', about(src),
    ['the summed raw counts are not offered: line 3 of pseudobulk.tsv has 4 columns and its header has 3. The gene "B\\tx" holds a tab, '
      + 'which splits a column in two: rename it in the object and convert again'])
  check('it never ends at converting the same object again', /Convert the object again/.test(about(src)[0] ?? ''), false)
}

console.log('\nA ROW THAT IS NOT AS WIDE AS THE HEADER, AND NO NAME THAT EXPLAINS IT')
{
  const src = open(table('s1', 's2', [['A', 5, 7], ['B', 1], ['C', 0, 3]]))
  check('refused, with the line of the first such row, and no cause is guessed',
    [src.pseudobulk, src.meta.hasRawCounts, about(src)],
    [null, false, ['the summed raw counts are not offered: line 3 of pseudobulk.tsv has 2 columns and its header has 3. '
      + 'Convert the object again: if the same line comes back, the cause is in the object or the converter']])
  check('its advice does not end at converting again: it says what a second conversion tells', /convert(ing)? (the object )?again$/i.test(about(src)[0] ?? ''), false)
  const wide = open(table('s1', 's2', [['A', 5, 7], ['B', 1, 2], ['C', 0, 3, 9]]))
  check('a row wider than the header is refused the same way', [wide.pseudobulk, /line 4 of pseudobulk\.tsv has 4 columns and its header has 3/.test(about(wide)[0] ?? '')], [null, true])
  await attempt('the line is its number in the file, blank lines counted', () => raggedLine('gene\ta\tb\n\nA\t1\t2\nB\t1\n'), { line: 4, columns: 2, header: 3 })
}

console.log('\nA COLLECTION: ONE PART\'S TABLE IS RAGGED')
{
  const collection = (tsvs, opts) => {
    const parts = tsvs.map((tsv, k) => ({ key: `p${k + 1}`, file: `parts/p${k + 1}.zip`, nCells: 4, bytes: zipSync(bundleFiles(tsv, { chunked: true, ...opts[k] })) }))
    return writeCollection({
      schema: 'scrnaseq-studio/collection@1', label: 'tiny', source: 'tiny.h5ad', splitBy: 'sample',
      reason: 'split for the test', nCells: 8, nGenes: 3,
      parts: parts.map(p => ({ key: p.key, file: p.file, nCells: p.nCells, nnz: 6, bytes: p.bytes.length })), notes: [],
    }, parts.map(p => ({ file: p.file, bytes: p.bytes })))
  }
  await attempt('two well-formed parts: the merged table is offered, as before', async () => {
    const blob = collection([table('s1', 's2'), table('s1', 's2')], [{}, {}])
    const src = await openCollection(blob, await readCollectionIndex(blob))
    return [[...(src.pseudobulk?.counts ?? [])], src.meta.hasRawCounts, about(src)]
  }, [[10, 14, 2, 4, 0, 6], true, []])
  await attempt('a ragged part refuses the merge, and the note names the part', async () => {
    const blob = collection([table('s1', 's2'), table('s\t1', 's2')], [{}, { samples: ['s\t1', 's2'] }])
    const src = await openCollection(blob, await readCollectionIndex(blob))
    return [src.pseudobulk, src.meta.hasRawCounts, about(src)]
  }, [null, false, ['the summed raw counts are not offered: line 2 of pseudobulk.tsv in part p2 has 3 columns and its header has 4. The sample "s\\t1" holds a tab, '
    + 'which splits a column in two: rename it in the object and convert again']])
  await attempt('a gene id with a tab, in a collection: the gene and the part are named', async () => {
    const rows = [['A', 5, 7], ['B\tx', 1, 2], ['C', 0, 3]], genes = ['A', 'B\tx', 'C']
    const blob = collection([table('s1', 's2', rows), table('s1', 's2', rows)], [{ genes }, { genes }])
    const src = await openCollection(blob, await readCollectionIndex(blob))
    return [src.pseudobulk, src.meta.hasRawCounts, about(src)]
  }, [null, false, ['the summed raw counts are not offered: line 3 of pseudobulk.tsv in part p1 has 4 columns and its header has 3. The gene "B\\tx" holds a tab, '
    + 'which splits a column in two: rename it in the object and convert again']])
  await attempt('no name that explains it, in a collection: the note, with its part, is within a paragraph\'s words (numbers set aside)', async () => {
    const blob = collection([table('s1', 's2'), table('s1', 's2', [['A', 5, 7], ['B', 1], ['C', 0, 3]])], [{}, {}])
    const src = await openCollection(blob, await readCollectionIndex(blob))
    const note = about(src)[0] ?? ''
    return [note, words(note.replace(/\b\d+\b/g, ' ')) <= BUDGET.text]
  }, ['the summed raw counts are not offered: line 3 of pseudobulk.tsv in part p2 has 2 columns and its header has 3. '
    + 'Convert the object again: if the same line comes back, the cause is in the object or the converter', true])
}

console.log(failed ? `\n${failed} FAILED` : '\nAll ragged-table tests passed')
process.exit(failed ? 1 : 0)
