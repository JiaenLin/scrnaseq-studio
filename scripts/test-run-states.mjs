// Every state of a bundle's run section, as the Lab writes it today and as it
// wrote it before: every sentence the studio says about run records is true.
//
// testdata/lab/run-states.json holds, for one object per state, the run section
// and the notes the Lab's converter wrote, twice: at the Lab commit that lists a
// record by six named fields ("new") and at the commit before it, which copied
// the record itself ("old"). scripts/make-run-states.mjs wrote it from the
// converter's own bundles. A bundle has no version field, so the studio tells
// the two apart by the fields present (src/lib/run.ts), and where the fields
// cannot place a section, it says only what is true of both.
//
// Each row below is written by hand: what the bundle holds, and the sentences a
// reader must be shown for it. The test renders the real Overview and Methods
// and compares. No sentence may give a reason the bundle does not give.

import { readFileSync } from 'node:fs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { parseBundle } from '../src/lib/bundle.ts'
import { bundleSource } from '../src/lib/source.ts'
import { DE_GATES, thresholdFor } from '../src/lib/stats.ts'
import { loadComponents, render, textOf } from './render.mjs'
import { ABSENT, METHODS, NEVER, NONE, ROWS, SUB, WHY, WRONG, looked, more, noneOf } from './run-states-table.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const C = await loadComponents()
const FIX = JSON.parse(readFileSync(new URL('../testdata/lab/run-states.json', import.meta.url), 'utf8'))
const bytes = (arr, Ctor) => new Uint8Array(Ctor.from(arr).buffer)

/** What one side of a state holds: its run section and notes, from the fixture or from the committed bundle it names. */
function held(side) {
  if (!side.zip) return side
  let z = unzipSync(readFileSync(new URL(`../testdata/lab/${side.zip}`, import.meta.url)))
  const inner = Object.keys(z).find(k => k.endsWith('.zip'))
  if (inner) z = unzipSync(z[inner])
  const meta = JSON.parse(strFromU8(z['meta.json']))
  return { run: meta.run, notes: meta.notes ?? [] }
}

/** Four cells, three genes, two clusters, two samples (test-bundle.mjs's object), with this run section and these notes. */
function open({ run, notes }) {
  const meta = {
    schema: 'scrnaseq-studio/bundle@1', label: 'tiny', source: 'tiny.h5ad (AnnData, converted in scRNA-seq Lab)',
    nCells: 4, nGenes: 3, nnz: 6, clusters: ['alpha', 'beta'],
    samples: [{ id: 's1', condition: 'ctrl' }, { id: 's2', condition: 'treat' }], conditions: ['ctrl', 'treat'],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: false,
    provenance: { normalization: 'log1p(CP10K)', clustering: 'leiden' },
    ...(run === undefined ? {} : { run }), notes,
  }
  return bundleSource(parseBundle(zipSync({
    'meta.json': strToU8(JSON.stringify(meta)), 'genes.txt': strToU8('A\nB\nC'),
    'expr.indptr.i32': new Uint8Array(Int32Array.from([0, 2, 4, 6]).buffer),
    'expr.indices.i32': new Uint8Array(Int32Array.from([0, 1, 2, 3, 0, 2]).buffer),
    'expr.data.f32': new Uint8Array(Float32Array.from([1.5, 1.2, 2.0, 1.8, 0.9, 1.1]).buffer),
    'cluster.u16': bytes([0, 0, 1, 1], Uint16Array), 'sample.u16': bytes([0, 0, 1, 1], Uint16Array),
    'embed.f32': bytes([0, 0, 1, 0, 5, 5, 6, 5], Float32Array),
    'qc.f32': bytes([100, 2, 1, 110, 2, 1, 120, 2, 2, 130, 2, 2], Float32Array),
  }).buffer))
}

const TITLE = 'The run that produced this object'
// Markup read as text leaves a space where a tag closed before a comma or a full stop: both sides are read alike.
const plain = s => s.replace(/’/g, "'").replace(/\s+/g, ' ').replace(/ ([,.])(?= |$)/g, '$1').trim()
const cards = (html) => html.split('<section class="card">').slice(1).map(s => `<section class="card">${s}`)

/** What a reader is shown about the run: the card's subtitle, its sentences, each record, and the card after it. */
function shown(src) {
  const all = cards(render(C.Overview, { src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {} }))
  const at = all.findIndex(s => s.includes(TITLE))
  const card = all[at]
  const sub = plain(textOf(/<p class="sub">([\s\S]*?)<\/p>/.exec(card)?.[1] ?? ''))
  const records = card.split('data-run-record="').slice(1).map(chunk => {
    const rows = [...chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m =>
      [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(td => plain(textOf(td[1]))))
    return {
      path: textOf(chunk.slice(0, chunk.indexOf('"'))), kind: /data-run-kind="([^"]*)"/.exec(chunk)?.[1],
      badge: plain(textOf(/<span class="badge[^"]*">([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? '')), rows,
      blank: rows.filter(r => r[1] === '').length, empties: (chunk.match(/title="An empty string, as recorded"/g) ?? []).length,
      said: [...chunk.matchAll(/<p class="mt-3 tx-small" data-run-of="record"[^>]*>([\s\S]*?)<\/p>/g)].map(m => plain(textOf(m[1]))),
    }
  })
  // The card's own sentences, in order: not the ones under a record.
  const said = [...card.matchAll(/<p class="mt-3 tx-(?:small" data-run-of="section|micro)"[^>]*>([\s\S]*?)<\/p>/g)].map(m => plain(textOf(m[1])))
  const methods = plain(textOf(render(C.Methods, {
    src, types: src.types, tis: [0], ctrl: [src.d.conds[0]], cs: [src.d.conds[1] ?? src.d.conds[0]],
    method: 'wilcox', padjMax: 0.05, lfcMin: thresholdFor('wilcox').lfc, gates: DE_GATES, lib: null,
  })))
  return { sub, said, records, next: all[at + 1] ? plain(textOf(all[at + 1])) : '', all: plain(textOf(card)), methods }
}

console.log(`\nTHE TRUTH TABLE: each state as the Lab writes it at ${FIX.lab.new.slice(0, 7)} (new) and wrote it at ${FIX.lab.old.slice(0, 7)} (old)`)
for (const [state, object, sides] of ROWS) {
  for (const side of ['new', 'old']) {
    const want = sides[side]
    const b = held(FIX.states[object][side])
    const got = shown(open(b))
    const uniq = a => [...new Set(a)]
    check(`${state}, ${side} bundle: the subtitle, the card's sentences, the records and Methods`, {
      sub: got.sub, said: got.said, n: got.records.length, kinds: uniq(got.records.map(r => r.kind)),
      badges: uniq(got.records.map(r => r.badge)), blank: got.records.reduce((a, r) => a + r.blank, 0),
      empties: got.records.reduce((a, r) => a + r.empties, 0),
      methods: METHODS[want.form].test(got.methods), never: NEVER.filter(re => re.test(got.all) || re.test(got.methods)).map(String),
      next: want.next ? want.next.test(got.next) : true,
      whyHasItsCard: got.all.includes(WHY.trim()) ? got.next.startsWith('From the conversion') : true,
    }, {
      sub: want.form === 'none' ? '' : SUB[want.form](want.n), said: [...want.said, looked(b.run)].map(plain), n: want.n,
      kinds: want.kinds ?? [], badges: want.badges ?? [], blank: 0, empties: want.empties ?? 0,
      methods: true, never: [], next: true, whyHasItsCard: true,
    })
  }
}

console.log('\nNO RUN SECTION, AND A SECTION IN ANOTHER SHAPE (made here from the listed bundle of each Lab: neither Lab writes them)')
for (const side of ['new', 'old']) {
  const b = held(FIX.states.R01_family[side])
  const absent = shown(open({ notes: b.notes }))
  check(`no run section, ${side} bundle`, [absent.sub, absent.said, absent.records.length, METHODS.none.test(absent.methods)], ['', [plain(ABSENT)], 0, true])
  const wrong = shown(open({ run: { ...b.run, records: 'uns/x' }, notes: b.notes }))
  check(`a wrong shape, ${side} bundle: named, none of it shown`, [wrong.sub, wrong.said, wrong.records.length, wrong.all.includes('uns/x'), METHODS.none.test(wrong.methods)],
    ['', [plain(WRONG)], 0, false, true])
}

console.log('\nHOW A SECTION IS PLACED, AND WHAT IS SAID WHEN IT CANNOT BE')
{
  const S = 'where it looked'
  const one = (record, extra = {}, notes = []) => shown(open({ run: { searched: S, records: [{ path: 'uns/x_provenance', record }], ...extra }, notes }))
  check('a record of only the six named fields, each a string: listed by its fields',
    [one({ tool: 't', job: 'j' }).records[0].kind, one({ tool: 't', job: 'j' }).records[0].badge, one({ tool: 't', job: 'j' }).records[0].rows], ['fields', '2 of 6 fields', [['tool', 't'], ['job', 'j']]])
  check('one more key, a value that is not a string, or no key at all: an earlier converter\'s copy',
    [one({ tool: 't', seed: 0 }).records[0].kind, one({ tool: 1 }).records[0].kind, one({}).records[0].kind], ['copied', 'copied', 'copied'])
  check('one record in another form places the whole section as copies',
    shown(open({ run: { searched: S, records: [{ path: 'uns/a_provenance', record: { tool: 't' } }, { path: 'uns/b_provenance', record: { argv: ['x'] } }] }, notes: [] })).records.map(r => r.badge), ['copied', 'copied'])
  check('an empty string in a copied record is the mark for no value too, never a blank; spaces are shown quoted',
    [one({ tool: '', note: ' ', seed: 0 }).records[0].rows, one({ tool: '', note: ' ', seed: 0 }).records[0].empties], [[['tool', '—'], ['note', '" "'], ['seed', '0']], 1])
  check('a null record states no reason; it points at the notes only when one names it',
    [one(null).records[0].said, one(null, {}, ['uns/x_provenance could not be read; run lists it with no content']).records[0].said],
    [['Listed with no content.'], [plain('Listed with no content.' + WHY)]])
  check('records not listed, and no note that names one: counted and named, with no pointer and no reason',
    one({ tool: 't' }, { leftOut: { count: 1, paths: ['uns/z_provenance'] } }, ['a note about something else']).said, [plain(more(1, 'uns/z_provenance')), `Where the converter looked: ${S}`])
  check('no record, and no note about the run: nothing is said about why',
    shown(open({ run: { searched: S, records: [] }, notes: ['a note about something else'] })).said, [NONE, `Where the converter looked: ${S}`])
  check('no record and no notes at all: there is no next card to point at',
    shown(open({ run: { searched: S, records: [], leftOut: { count: 1, paths: ['uns/z_provenance'] } }, notes: [] })).said,
    [plain(noneOf(1, 'uns/z_provenance')), `Where the converter looked: ${S}`])
}

console.log(failed ? `\n${failed} FAILED` : '\nAll run-state tests passed')
process.exit(failed ? 1 : 0)
