// What Overview and Methods SAY of an object, bundle by bundle: the views
// themselves, rendered, on a bundle of each source kind and on its twin that
// differs in one respect (a source removed, a decoy name added).
//
//   node scripts/test-facts-views.mjs      (in `npm test`)
//
// It imports nothing of lib/facts.ts, so the same file runs against the tree
// before the sentence table existed and fails there wherever the words changed
// (a guessed method "as recorded in the object", cited from its name).
//
// The bundles are synthetic: the sentinel fixture, edited here to today's form
// and to the `facts` form, and the bundle the lab's own converter wrote
// (testdata/lab/family-2x2.zip).

import fs from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { parseBundle } from '../src/lib/bundle.ts'
import { bundleSource, demoSource } from '../src/lib/source.ts'
import { DE_GATES } from '../src/lib/stats.ts'
import { N, clusterOf, sentinelBundle } from './fixture-sentinels.mjs'
import { loadComponents, render, textOf } from './render.mjs'

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${String(detail).slice(0, 400)}` : ''}`) }
}

const C = await loadComponents()
const edit = (buf, fn) => {
  const files = unzipSync(new Uint8Array(buf))
  const meta = JSON.parse(strFromU8(files['meta.json']))
  fn(meta, files)
  files['meta.json'] = strToU8(JSON.stringify(meta))
  return zipSync(files).buffer
}
const open = buf => bundleSource(parseBundle(buf))
// One space between words, none before the punctuation that follows a name drawn in mono.
const tidy = t => t.replace(/\s+/g, ' ').replace(/ ([,.;:)])/g, '$1').trim()
const part = (html, id) => {
  const m = html.match(new RegExp(`<(tr|p|div|span)[^>]*data-fact="${id}"[^>]*>(.*?)</\\1>`, 's'))
  return m ? tidy(textOf(m[0])) : null
}
const view = (src, method = 'wilcox') => {
  const o = render(C.Overview, { src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {} })
  const conds = src.d.conds
  const m = render(C.Methods, { src, types: src.types, tis: [1], ctrl: [conds[0]], cs: [conds[conds.length - 1]],
    method, padjMax: 0.05, lfcMin: 0.25, gates: DE_GATES, lib: null })
  const methods = tidy(textOf(m))
  return {
    overview: tidy(textOf(o)), methods, refs: methods.slice(methods.indexOf('References')).split('How to read')[0],
    row: id => part(o, id), said: id => part(m, id),
  }
}
const has = (t, s) => t !== null && t.includes(s)
const lacks = (t, s) => t !== null && !t.includes(s)

// A bundle as every converter writes it today: the older fields, each a value with no source. Every
// name here LOOKS like a method: an integration, a normalization, a doublet column, an ambient tool, a
// cell type column named for a clustering, embeddings named for two projections.
const today = (meta, files) => {
  meta.provenance = { normalization: 'log1p(CP10K)', clustering: 'leiden', condition: 'factor_a', sample: 'sample',
    integration: 'harmony', doublets: 'scrublet_score', ambient: 'cellbender' }
  meta.embeddings = [{ key: 'X_umap', file: 'embed.f32' }, { key: 'X_harmony', file: 'embed.1.f32' }, { key: 'X_tsne', file: 'embed.2.f32' }]
  files['embed.1.f32'] = files['embed.f32'].slice(); files['embed.2.f32'] = files['embed.f32'].slice()
  meta.notes = ['no total-count column; recomputed from the matrix', 'no detected-gene column; recomputed from the matrix']
}
const TODAY = edit(sentinelBundle(), today)
const withFacts = (facts, more = () => {}) => edit(TODAY, (meta, files) => { meta.facts = { v: 1, ...facts }; more(meta, files) })
const noCounts = (meta, files) => { meta.hasRawCounts = false; delete files['pseudobulk.tsv'] }

console.log('\nA BUNDLE OF TODAY: A VALUE WITH NO SOURCE IS NOT A RECORD')
{
  const v = view(open(TODAY))
  ok(lacks(v.overview, 'from your file'), 'Overview badges nothing "from your file"')
  ok(has(v.row('integration'), 'source not stated') && has(v.row('integration'), 'harmony, as the converter wrote it. This bundle gives no source for it, so it is not a record of what was run.'),
    'integration: the converter\'s word, with no source, and not a record of what was run', v.row('integration'))
  ok(has(v.row('normalization'), 'source not stated') && has(v.row('normalization'), 'log1p(CP10K), as the converter wrote it'), 'normalization: the same', v.row('normalization'))
  ok(has(v.row('doublets'), 'scrublet_score, as the converter wrote it') && has(v.row('ambient'), 'cellbender, as the converter wrote it'), 'doublet calls and ambient RNA: the same')
  ok(has(v.row('cell_type_column'), 'Cell type column') && has(v.row('cell_type_column'), 'leiden, as the converter wrote it. This bundle gives no source for it.') && lacks(v.overview, 'Clustering'),
    'the cell type column is called a column, not a clustering', v.row('cell_type_column'))
  ok(has(v.row('expression'), 'source not stated') && has(v.row('expression'), 'log1p(CP10K), as the converter wrote it'), 'expression: the bundle\'s label, unsourced', v.row('expression'))
  ok(has(v.row('embedding'), 'in this bundle') && has(v.row('embedding'), 'X_umap, X_harmony, X_tsne'), 'the embeddings are the bundle\'s own keys', v.row('embedding'))
  ok(lacks(v.overview, 'Read from the object') && has(v.overview, 'Each line says where it comes from'), 'the table no longer says it was read from the object')
  ok(lacks(v.methods, 'corrected with') && lacks(v.methods, 'as recorded in the object'), 'Methods does not say the object was corrected with a method "as recorded"')
  ok(!/\bharmony\b/i.test(v.methods), 'Methods names no integration method the bundle gives no source for', v.said('integration'))
  ok(has(v.said('integration'), 'This bundle gives no source for an integration method, so none is named here.'), 'and says so in a sentence', v.said('integration'))
  ok(!/Korsunsky|Traag|McInnes|van der Maaten/.test(v.methods), 'no reference is chosen from a name: not Harmony\'s, Leiden\'s, UMAP\'s or t-SNE\'s', v.refs)
  ok(has(v.said('cell_type_column'), 'the levels of leiden, the column the bundle names for them; this bundle records no clustering or annotation method for them.'),
    'a column named for a clustering is a column', v.said('cell_type_column'))
  ok(has(v.said('expression'), 'The bundle labels its expression values log1p(CP10K) and gives no source for that label'), 'the expression label is said as the bundle\'s label', v.said('expression'))
  ok(has(v.methods, 'a name is not a record of how an embedding was computed, so none is cited'), 'and an embedding\'s name is not cited')
  ok(has(v.methods, 'was tested with a Wilcoxon rank-sum test across cells') && /Hao Y/.test(v.refs) && /scRNA-seq Studio/.test(v.refs),
    'what this app itself did is still said, and cited')
  ok(lacks(v.methods, 'it did not find') && has(v.methods, 'cites nothing from the name of a column or an embedding'), 'and its promise is the new one')
}

console.log('\nA NAME ADDED OR REMOVED CHANGES NO SOURCE (the decoy twin)')
{
  const plainTwin = view(open(edit(TODAY, meta => { meta.provenance.integration = null; meta.provenance.doublets = null; meta.provenance.ambient = null })))
  ok(has(plainTwin.row('integration'), 'not stated') && has(plainTwin.row('integration'), 'This bundle states none.'), 'no name: "not stated", and nothing is said to be absent from the object', plainTwin.row('integration'))
  ok(plainTwin.row('doublets') === null && plainTwin.row('ambient') === null && lacks(plainTwin.overview, 'no doublet column found'),
    'doublet calls and ambient RNA are not stated at all when the bundle states none')
  ok(has(plainTwin.said('integration'), 'This bundle gives no source for an integration method, so none is named here.'), 'Methods says the same sentence with and without the name')
}

console.log('\nRECORDED: THE BUNDLE GIVES THE PLACE')
{
  const rec = { integration: { kind: 'recorded', value: 'scanvi', at: 'uns/tool/default_method' },
    integration_embedding: { kind: 'recorded', value: 'X_harmony', at: 'uns/tool/default_embedding' } }
  const v = view(open(withFacts(rec)))
  ok(has(v.row('integration'), 'from your file') && has(v.row('integration'), 'scanvi, as recorded in the object at uns/tool/default_method.'),
    'the recorded method wins over the older field\'s name, with its place', v.row('integration'))
  ok(has(v.row('integration'), 'Its embedding is recorded as X_harmony at uns/tool/default_embedding.'), 'and its embedding, with its place')
  ok(has(v.said('integration'), 'The object records its integration method as scanvi (at uns/tool/default_method) and that method’s embedding as X_harmony.'),
    'Methods: "the object records", never "was corrected with"', v.said('integration'))
  ok(!/Korsunsky/.test(v.methods) && !/\bharmony\b/.test(v.methods), 'a recorded method outside the closed table is not cited, and the guessed one is not named')
  const cited = view(open(withFacts({ integration: { kind: 'recorded', value: 'harmony', at: 'uns/tool/default_method' } })))
  ok(/Korsunsky/.test(cited.refs) && has(cited.said('integration'), 'as harmony 1 (at uns/tool/default_method).'), 'a recorded "harmony" is cited: the value equals the table\'s key', cited.said('integration'))
  const near = view(open(withFacts({ integration: { kind: 'recorded', value: 'Harmony2', at: 'uns/tool/default_method' } })))
  ok(!/Korsunsky/.test(near.methods), 'a recorded value that only looks like it is not cited')
  const noPlace = view(open(withFacts({ integration: { kind: 'recorded', value: 'scanvi' } })))
  ok(has(noPlace.row('integration'), 'unreadable') && lacks(noPlace.row('integration'), 'from your file') && lacks(noPlace.row('integration'), 'as recorded'),
    'the twin with the place removed is unreadable, never recorded', noPlace.row('integration'))
  ok(has(noPlace.said('integration'), 'no source for an integration method') && !/scanvi|\bharmony\b/.test(noPlace.methods), 'and Methods names no method for it')
  const absent = view(open(withFacts({ integration: { kind: 'recorded', value: null, searched: 'a dict under uns holding default_method' } })))
  ok(has(absent.row('integration'), 'not recorded') && has(absent.row('integration'), 'Not recorded in the object. The converter looked at a dict under uns holding default_method.'),
    'not recorded, with where the converter looked', absent.row('integration'))
  ok(has(absent.said('integration'), 'The object records no integration method (the converter looked at a dict under uns holding default_method).'), 'and Methods says so')
  for (const [what, f] of [['an unknown kind', { kind: 'inferred', value: 'harmony', at: 'obsm/X_harmony' }], ['a value that is an object', { kind: 'recorded', value: { a: 1 }, at: 'uns/x' }],
    ['a value that is markup', { kind: 'recorded', value: '<i>harmony</i>', at: 'uns/x' }]]) {
    const h = view(open(withFacts({ integration: f })))
    ok(has(h.row('integration'), 'unreadable') && lacks(h.overview, 'from your file') && !/Korsunsky/.test(h.methods) && lacks(h.overview, '<i>'), `a malformed fact (${what}) is said unreadable`, h.row('integration'))
  }
}

console.log('\nMEASURED AND CHOSEN: SAID WITH THE MATRIX, OR WITH WHO CHOSE')
{
  const counts = { kind: 'measured', value: true, of: 'layers/counts', how: 'every stored value is an integer', carried: false, why: 'one matrix is read from an object held in parts' }
  const v = view(open(withFacts({
    expression: { kind: 'measured', value: 'log1p of counts scaled to 10,000 per cell', of: 'X', how: 'the sums of 2,000 cells are within 0.1% of 10,000' },
    counts, total: { kind: 'measured', value: null, of: 'X', how: 'summed per cell' }, cell_type_column: { kind: 'chosen', value: 'cell_type', by: 'guess' },
  }, noCounts)))
  ok(has(v.row('expression'), 'measured at conversion') && has(v.row('expression'), 'log1p of counts scaled to 10,000 per cell, measured at conversion on X: the sums of 2,000 cells are within 0.1% of 10,000.'),
    'expression: measured, the matrix and how', v.row('expression'))
  ok(has(v.said('expression'), 'Expression values are log1p of counts scaled to 10,000 per cell, measured at conversion on X'), 'and in Methods', v.said('expression'))
  ok(has(v.row('counts'), 'not in bundle') && has(v.row('counts'), 'In your object at layers/counts; not in this bundle: one matrix is read from an object held in parts.'),
    'raw counts in the object and not in the bundle: both said, with why', v.row('counts'))
  ok(has(v.row('cell_type_column'), 'chosen at conversion') && has(v.row('cell_type_column'), 'cell_type, chosen at conversion by the command’s guess from a name.'), 'a role is a choice, with who chose', v.row('cell_type_column'))
  ok(has(v.said('cell_type_column'), 'the levels of cell_type, the column chosen at conversion by the command’s guess from a name'), 'and in Methods', v.said('cell_type_column'))
  ok(has(v.overview, 'Per-cell total') && lacks(v.overview, 'Total counts') && has(v.row('qc'), 'total = summed at conversion from X'), 'a total measured on X is not called counts', v.row('qc'))
  const onCounts = view(open(withFacts({ counts, total: { kind: 'measured', value: null, of: 'layers/counts', how: 'summed per cell' } })))
  ok(has(onCounts.overview, 'Total counts') && has(onCounts.row('qc'), 'total = summed at conversion from layers/counts'), 'the twin measured on the counts matrix is', onCounts.row('qc'))
  const noMatrix = view(open(withFacts({ expression: { kind: 'measured', value: 'log1p(CP10K)', how: 'looked' } })))
  ok(has(noMatrix.row('expression'), 'unreadable') && lacks(noMatrix.row('expression'), 'measured at conversion'), 'a measured fact with no matrix is unreadable', noMatrix.row('expression'))
}

console.log('\nTHE QC TITLES OF A BUNDLE OF TODAY')
{
  const a = view(open(TODAY))
  ok(has(a.overview, 'Total counts') && has(a.row('qc'), 'total = raw counts summed at conversion · genes = counted at conversion on the same matrix'),
    'recomputed, in a bundle written with raw counts: "Total counts"', a.row('qc'))
  const b = view(open(edit(TODAY, noCounts)))
  ok(has(b.overview, 'Sum of log-normalized values') && lacks(b.overview, 'Total counts') && has(b.row('qc'), 'total = expression values summed at conversion, not counts'),
    'recomputed with no raw counts: "Sum of log-normalized values"', b.row('qc'))
  const c = view(open(edit(TODAY, meta => { meta.notes = ['total counts recomputed from the counts layer'] })))
  ok(has(c.overview, 'Per-cell total') && lacks(c.overview, 'Total counts') && has(c.row('qc'), 'total = source not stated · genes = source not stated'),
    'no sentence of the writer\'s (a note that only looks like one): "Per-cell total"', c.row('qc'))
}

console.log('\nPSEUDOBULK COUNTS CAN BE SAVED ONLY WHEN THE BUNDLE HOLDS THEM (the lab\'s own bundle, 4 samples a group)')
{
  const raw = fs.readFileSync(new URL('../testdata/lab/family-2x2.zip', import.meta.url))
  // The command writes a collection; its one part is a bundle, opened here as the lab wrote it.
  const inner = unzipSync(new Uint8Array(raw))['parts/family-2x2.zip']
  const LAB = inner.buffer.slice(inner.byteOffset, inner.byteOffset + inner.byteLength)
  const v = view(open(LAB))
  ok(has(v.row('pseudobulk'), 'Wilcoxon runs here; pseudobulk counts can be saved.') && has(v.row('counts'), 'in this bundle') && has(v.row('counts'), 'the pseudobulk table holds'),
    'with a usable table: can be saved', `${v.row('pseudobulk')} / ${v.row('counts')}`)
  ok(lacks(v.overview, 'from your file') && lacks(v.methods, 'as recorded in the object') && !/Korsunsky|Traag|McInnes/.test(v.methods),
    'and the lab\'s bundle, written before sources existed, is called recorded nowhere and cited from no name')
  const none = view(open(edit(LAB, noCounts)))
  ok(has(none.row('pseudobulk'), 'Wilcoxon runs here; no pseudobulk counts to save. 4 samples a group are enough for DESeq2, but this bundle holds no raw counts.')
    && lacks(none.overview, 'counts can be saved'), 'the twin with no counts: not said', none.row('pseudobulk'))
  ok(has(none.row('counts'), 'not in bundle') && has(none.row('counts'), 'This bundle holds no summed raw counts. It does not say whether the object has any.') && lacks(none.overview, 'absent'),
    'and its raw counts are "not in bundle": nothing is said to be absent from the object', none.row('counts'))
  const ragged = view(open(edit(LAB, (_meta, files) => {
    const lines = strFromU8(files['pseudobulk.tsv']).split('\n')
    lines[2] = lines[2].split('\t').slice(0, -1).join('\t')
    files['pseudobulk.tsv'] = strToU8(lines.join('\n'))
  })))
  ok(has(ragged.row('pseudobulk'), 'no pseudobulk counts to save') && has(ragged.row('pseudobulk'), 'this bundle’s summed counts are not offered here') && lacks(ragged.overview, 'counts can be saved'),
    'a refused table: not said (GAP-C129)', ragged.row('pseudobulk'))
  ok(has(ragged.row('counts'), 'not offered here') && has(ragged.row('counts'), 'The bundle holds summed counts that this app does not offer: see the notes below.'), 'and the row says the bundle held them', ragged.row('counts'))
  const demo = view(demoSource('cohort'))
  ok(has(demo.row('pseudobulk'), 'no pseudobulk counts to save') && has(demo.row('pseudobulk'), 'this demo holds no raw counts') && lacks(demo.overview, 'from your file') && !/\bharmony\b/i.test(demo.methods),
    'a demo holds no counts and states no method: neither is said', demo.row('pseudobulk'))
}

console.log('\nCELLS NOT CALLED: DRAWN IS MEASURED FROM THE COORDINATES')
{
  const nanFor = level => (_meta, files) => {
    const xy = new Float32Array(files['embed.f32'].slice().buffer)
    for (let i = 0; i < N; i++) if (level(clusterOf(i))) { xy[2 * i] = NaN; xy[2 * i + 1] = NaN }
    files['embed.f32'] = new Uint8Array(xy.buffer)
  }
  const all = view(open(TODAY))
  ok(has(all.row('not_called'), 'Drawn grey on the embedding') && has(all.methods, 'every test below, and kept on the embedding.') && has(all.row('not_called'), 'source not stated'),
    'every one has coordinates: drawn grey, as before', all.row('not_called'))
  const some = view(open(edit(TODAY, nanFor(c => c === 0))))
  ok(has(some.row('not_called'), '10 have no coordinates on X_umap and are not drawn; the rest are drawn grey.'), 'one label\'s 10 cells without coordinates: counted, and not said to be drawn', some.row('not_called'))
  ok(has(some.methods, '; 10 of them have no coordinates on X_umap and are not drawn, and the rest are kept on it.'), 'and in Methods')
  const none = view(open(edit(TODAY, nanFor(c => c === 0 || c === 4))))
  ok(has(none.row('not_called'), 'None of them has coordinates on X_umap, so none is drawn.'), 'all 16 without coordinates: none is drawn', none.row('not_called'))
}

console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`)
process.exit(fail ? 1 : 0)
