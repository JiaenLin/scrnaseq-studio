// The run that produced an object, as the object records it.
//
// The lab's converter copies the records an object's uns holds about the run
// that made it — each tool's provenance, the harness's run record — into the
// bundle as `meta.run` (scrnaseq-lab, src/lib/h5ad.ts readRun):
//
//   { searched, records: [{ path, record }], leftOut?: { count, paths } }
//
// `record` is the uns entry as JSON, or one of the converter's "(not copied:
// …)" sentences when it named the record instead of copying it, or null when
// it could not read it. The studio showed none of it: Overview had no word
// about which tool, version or commit made the object, and Methods said the
// file carried none of the upstream steps when the file had just told it.
//
// These render the real Overview and Methods, through render.mjs, on bundles
// built in memory, and read what a person is shown. The card says what each
// record says, under its own field names; it names no tool the record does not.

import { strToU8, zipSync } from 'fflate'
import { parseBundle } from '../src/lib/bundle.ts'
import { writeChunked } from '../src/lib/chunked.ts'
import { readCollectionIndex, writeCollection } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { bundleSource, demoSource } from '../src/lib/source.ts'
import { DE_GATES, thresholdFor } from '../src/lib/stats.ts'
import { loadComponents, render, textOf } from './render.mjs'

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

const C = await loadComponents()
const bytes = (arr, Ctor) => new Uint8Array(Ctor.from(arr).buffer)

/** Four cells, three genes, two clusters, two samples — test-bundle.mjs's object — and `run` as given. */
function bundleFiles(run, { chunked = false } = {}) {
  const meta = {
    schema: 'scrnaseq-studio/bundle@1',
    label: 'tiny', source: 'tiny.h5ad (AnnData, converted in scRNA-seq Lab)',
    nCells: 4, nGenes: 3, nnz: 6,
    clusters: ['alpha', 'beta'],
    samples: [{ id: 's1', condition: 'ctrl' }, { id: 's2', condition: 'treat' }],
    conditions: ['ctrl', 'treat'],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: false,
    provenance: { normalization: 'log1p(CP10K)', clustering: 'leiden' },
    ...(run === undefined ? {} : { run }),
    notes: ['a note'],
    ...(chunked ? { chunkGenes: 2 } : {}),
  }
  const indptr = Int32Array.from([0, 2, 4, 6])
  const indices = Int32Array.from([0, 1, 2, 3, 0, 2])
  const data = Float32Array.from([1.5, 1.2, 2.0, 1.8, 0.9, 1.1])
  const files = {
    'meta.json': strToU8(JSON.stringify(meta)),
    'genes.txt': strToU8('A\nB\nC'),
    'expr.indptr.i32': new Uint8Array(indptr.buffer),
    'expr.indices.i32': new Uint8Array(indices.buffer),
    'expr.data.f32': new Uint8Array(data.buffer),
    'cluster.u16': bytes([0, 0, 1, 1], Uint16Array),
    'sample.u16': bytes([0, 0, 1, 1], Uint16Array),
    'embed.f32': bytes([0, 0, 1, 0, 5, 5, 6, 5], Float32Array),
    'qc.f32': bytes([100, 2, 1, 110, 2, 1, 120, 2, 2, 130, 2, 2], Float32Array),
  }
  if (chunked) {
    const { bin, ptr } = writeChunked(indptr, indices, data, 2)
    files['expr.chunkptr.i32'] = new Uint8Array(ptr.buffer)
    files['expr.chunk.bin'] = [bin, { level: 0 }]
  }
  return files
}
const open = (run) => bundleSource(parseBundle(zipSync(bundleFiles(run)).buffer))

const overview = (src) => render(C.Overview, {
  src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {},
})
const methods = (src) => textOf(render(C.Methods, {
  src, types: src.types, tis: [0], ctrl: [src.d.conds[0]], cs: [src.d.conds[1] ?? src.d.conds[0]],
  method: 'wilcox', padjMax: 0.05, lfcMin: thresholdFor('wilcox').lfc, gates: DE_GATES, lib: null,
}))

const TITLE = 'The run that produced this object'
/** The Run card's markup on Overview, or '' when there is none. */
const runCard = (html) => html.split('<section class="card">').slice(1)
  .map(s => `<section class="card">${s}`).find(s => s.includes(TITLE)) ?? ''
/** Each record the card shows: its path, its kind, and its rows as [key, value] text. */
const recordsOf = (card) => card.split('data-run-record="').slice(1).map(chunk => {
  const path = textOf(chunk.slice(0, chunk.indexOf('"')))
  const kind = /data-run-kind="([^"]*)"/.exec(chunk)?.[1] ?? null
  const rows = [...chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(td => textOf(td[1]).trim()))
  return { path, kind, rows, text: textOf(chunk) }
})

const SEARCHED = 'uns/harness_run; every entry of uns, and every child of a dict directly under uns, named provenance or *_provenance; every dict directly under uns whose own schema names provenance'
const PROV = {
  argv: ['scintegrate', 'integrate', '--h5ad', 'joint.h5ad'],
  batch_key: 'sample',
  commit: 'f'.repeat(40),
  job: 'job-42',
  seed: 0,
  sees: { harmony: ['sample'], none: [] },
  stage: 'integrate',
  tool: 'scintegrate',
  run_key: 'RK-0001',
  version: '1.2.3',
  flag: false,
  missing: null,
}

console.log('\nA COPIED RECORD: EVERY FIELD, AS RECORDED, THE IDENTITY FIRST')
{
  const card = runCard(overview(open({ searched: SEARCHED, records: [{ path: 'uns/scintegrate/provenance', record: PROV }] })))
  check('Overview has a Run card', card.length > 0, true)
  const recs = recordsOf(card)
  check('it shows the one record, by its path', recs.map(r => r.path), ['uns/scintegrate/provenance'])
  check('marked as copied', recs[0]?.kind, 'copied')
  check('tool, version, commit, stage, run key and job first, then the rest in the record\'s own order',
    recs[0]?.rows.map(r => r[0]),
    ['tool', 'version', 'commit', 'stage', 'run_key', 'job', 'argv', 'batch_key', 'seed', 'sees', 'flag', 'missing'])
  const row = (k) => recs[0]?.rows.find(r => r[0] === k)?.[1]
  check('a string verbatim: the whole commit, not an abbreviation', row('commit'), 'f'.repeat(40))
  check('the version and the run key as recorded', [row('version'), row('run_key'), row('job')],
    ['1.2.3', 'RK-0001', 'job-42'])
  check('a number, a boolean and a null as JSON', [row('seed'), row('flag'), row('missing')], ['0', 'false', 'null'])
  check('a list and a dict as compact JSON', [row('argv'), row('sees')],
    ['["scintegrate","integrate","--h5ad","joint.h5ad"]', '{"harmony":["sample"],"none":[]}'])
  check('where the converter looked is said', textOf(card).includes(SEARCHED), true)
}

console.log('\nNOTHING IS INFERRED')
{
  // The path names a tool; the record does not. The card must not say one.
  const rec = { batch_key: 'sample', seed: 3 }
  const card = runCard(overview(open({ searched: SEARCHED, records: [{ path: 'uns/scintegrate/provenance', record: rec }] })))
  const recs = recordsOf(card)
  check('a record with no tool, version or commit gets no such rows', recs[0]?.rows.map(r => r[0]), ['batch_key', 'seed'])
  check('and the tool in its path is not repeated as its tool',
    (textOf(card).match(/scintegrate/g) ?? []).length, 1)
}

console.log('\nNAMED, NOT COPIED: SHOWN AS NAMED, WITH ITS SIZE')
{
  const named = '(not copied: 300,053 bytes as written, over the 262,144-byte budget for one record)'
  const card = runCard(overview(open({ searched: SEARCHED, records: [
    { path: 'uns/big_provenance', record: named },
    { path: 'uns/broken_provenance', record: null },
    { path: 'uns/harness_run', record: 'stage one: done; stage two: sealed' },
  ], leftOut: { count: 12, paths: ['uns/k_provenance', 'uns/m_provenance'] } })))
  const recs = recordsOf(card)
  check('three records, in the order the converter wrote them', recs.map(r => r.path),
    ['uns/big_provenance', 'uns/broken_provenance', 'uns/harness_run'])
  check('the over-budget record is named, not copied', recs[0]?.kind, 'named')
  check('with the converter\'s sentence, which carries its size', recs[0]?.text.includes(named), true)
  check('a record the converter could not read is listed with no content', recs[1]?.kind, 'empty')
  check('and says so, with no reason the bundle does not give', [/Listed with no content\./.test(recs[1]?.text ?? ''), /could not read/.test(recs[1]?.text ?? '')], [true, false])
  check('a record kept as text is shown as its text', [recs[2]?.kind, recs[2]?.text.includes('stage one: done; stage two: sealed')],
    ['text', true])
  const text = textOf(card)
  check('the records not listed are counted, and no reason is given for them', [/12 more records the converter found are not listed here/.test(text), /budget\b(?!\s+for one record)/.test(text.replace(named, ''))], [true, false])
  check('named as the converter named them', text.includes('uns/k_provenance') && text.includes('uns/m_provenance'), true)
  check('and the ones it did not list are counted, not invented', /10 more/.test(text), true)
}

console.log('\nAN EMPTY RECORD SAYS SO')
{
  const recs = recordsOf(runCard(overview(open({ searched: SEARCHED, records: [{ path: 'uns/x_provenance', record: {} }] }))))
  check('it is listed, copied, with no rows and a sentence saying it is empty',
    [recs.map(r => r.path), recs[0]?.kind, recs[0]?.rows.length, /empty record/.test(recs[0]?.text ?? '')],
    [['uns/x_provenance'], 'copied', 0, true])
}

console.log('\nA LONG VALUE IS FOLDED, NOT CUT')
{
  const log = 'b'.repeat(240_000)
  const card = runCard(overview(open({ searched: SEARCHED, records: [{ path: 'uns/b_provenance', record: { log, tool: 'synthetic-tool' } }] })))
  check('it sits behind a disclosure that says how long it is',
    /<details[^>]*><summary[^>]*>240,000 characters<\/summary>/.test(card), true)
  check('and all of it is there', card.includes(log), true)
}

console.log('\nNO RECORD, NO SECTION, A BROKEN SECTION, THE DEMO')
{
  const empty = textOf(runCard(overview(open({ searched: SEARCHED, records: [] }))))
  check('records: [] says the bundle lists no run record, and never that the converter found none', [empty.includes('This bundle lists no run record'), /found none/.test(empty)], [true, false])
  check('and where the converter looked', empty.includes(SEARCHED), true)

  const allOut = textOf(runCard(overview(open({ searched: SEARCHED, records: [], leftOut: { count: 2, paths: ['uns/a_provenance', 'uns/b_provenance'] } }))))
  check('records: [] with records left out never says there is none',
    [allOut.length > 0, allOut.includes('carries no run record')], [true, false])
  check('it says none of the 2 is listed, and names them',
    /none of (the|its) 2/i.test(allOut) && allOut.includes('uns/a_provenance'), true)

  const absent = textOf(runCard(overview(open(undefined))))
  check('a bundle with no run section says it carries none', absent.includes('carries no run section'), true)

  await attempt('a run section not in the lab\'s shape still opens, and is named, not half-shown', () => {
    const card = textOf(runCard(overview(open({ searched: SEARCHED, records: { path: 'uns/x' } }))))
    return [card.includes('not in the shape the lab writes'), card.includes('uns/x')]
  }, [true, false])

  const demo = textOf(runCard(overview(demoSource('cohort'))))
  check('the demo says no run produced it', /demo object[^.]*no run produced it/.test(demo), true)
}

console.log('\nA COLLECTION: THE PARTS\' RUN, AND A PART THAT DISAGREES')
{
  const run1 = { searched: SEARCHED, records: [{ path: 'uns/scintegrate/provenance', record: PROV }] }
  const run2 = { searched: SEARCHED, records: [{ path: 'uns/scintegrate/provenance', record: { ...PROV, commit: 'e'.repeat(40) } }] }
  const collection = (runs) => {
    const parts = runs.map((run, k) => ({
      key: `p${k + 1}`, file: `parts/p${k + 1}.zip`, nCells: 4, bytes: zipSync(bundleFiles(run, { chunked: true })),
    }))
    return writeCollection({
      schema: 'scrnaseq-studio/collection@1', label: 'tiny', source: 'tiny.h5ad', splitBy: 'sample',
      reason: 'split for the test', nCells: 8, nGenes: 3,
      parts: parts.map(p => ({ key: p.key, file: p.file, nCells: p.nCells, nnz: 6, bytes: p.bytes.length })), notes: [],
    }, parts.map(p => ({ file: p.file, bytes: p.bytes })))
  }
  await attempt('parts that agree: the card shows their record', async () => {
    const blob = collection([run1, run1])
    const src = await openCollection(blob, await readCollectionIndex(blob))
    const recs = recordsOf(runCard(overview(src)))
    return [recs.map(r => r.path), src.meta.notes.some(n => /different run section/.test(n))]
  }, [['uns/scintegrate/provenance'], false])
  await attempt('a part that disagrees: the first part\'s is shown, and a note says so', async () => {
    const blob = collection([run1, run2])
    const src = await openCollection(blob, await readCollectionIndex(blob))
    const recs = recordsOf(runCard(overview(src)))
    return [recs[0]?.rows.find(r => r[0] === 'commit')?.[1], src.meta.notes.some(n => /p2[^.]*different run section/.test(n))]
  }, ['f'.repeat(40), true])
}

console.log('\nMETHODS NO LONGER SAYS THE FILE CARRIES NONE OF IT')
{
  const withRun = methods(open({ searched: SEARCHED, records: [{ path: 'uns/scintegrate/provenance', record: PROV }] }))
  check('with a copied record, "a bundle carries none of them" is gone', withRun.includes('a bundle carries none of them'), false)
  check('nor does it say those steps are not carried in the file', withRun.includes('are not carried in the file'), false)
  check('it names the record, and says Overview shows it as recorded',
    withRun.includes('uns/scintegrate/provenance') && /Overview/.test(withRun), true)
  check('and still guesses no parameter out of it', /not read out of (it|them)[^.]*here/.test(withRun), true)
  const without = methods(open(undefined))
  check('without one, the text is what it was (guard)', [without.includes('a bundle carries none of them'),
    without.includes('Everything between the counts and those labels is unknown to this app')], [true, true])
  const namedOnly = methods(open({ searched: SEARCHED, records: [{ path: 'uns/a_provenance', record: '(not copied: 300,053 bytes as written, over the 262,144-byte budget for one record)' }] }))
  check('a record named but not copied carries nothing, so the text is what it was (guard)',
    namedOnly.includes('a bundle carries none of them'), true)
}

console.log(failed ? `\n${failed} FAILED` : '\nAll Run card tests passed')
process.exit(failed ? 1 : 0)
