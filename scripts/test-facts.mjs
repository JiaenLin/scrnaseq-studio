// The sentence table, walked: what this app says of a fact about the object
// follows the fact's SOURCE, and the source is read from the bundle alone.
//
//   node scripts/test-facts.mjs      (in `npm test`)
//
// Every row of SENTENCES (src/lib/facts.ts) is said under every source kind a
// bundle can give its fact, and under a decoy for each: a value, a key or a
// name that LOOKS like a method, a normalization or a tool, with no source.
// No row may call a decoy recorded, badge it "from your file" or cite from
// it. Then the source is read for a fact said anywhere else.

import fs from 'node:fs'
import path from 'node:path'
import { BUDGET, retiredIn, words } from './copy-standard.mjs'
import {
  BADGE, CITED, FACTS, FACT_IDS, SENTENCES, citationFor, methodsIntegration, plain, qcWords, sourceOf, undrawnOf,
} from '../src/lib/facts.ts'

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`) }
}

/** A bundle of today: no facts, nothing stated. */
const bare = (over = {}) => ({
  label: 'x', source: 'x.h5ad (AnnData, converted in scRNA-seq Lab)', expression: 'log1p(CP10K)', hasRawCounts: false,
  embedding: 'X_umap', provenance: {}, notes: [], isDemo: false, ...over,
})
const withFact = (id, fact, over = {}) => bare({ facts: { v: 1, [id]: fact }, ...over })

// One written fact of each kind, as the lab's converter will write them.
const RECORDED = { kind: 'recorded', value: 'harmony', at: 'uns/tool/default_method' }
const ABSENT = { kind: 'recorded', value: null, searched: 'a dict under uns holding default_method' }
const MEASURED = { kind: 'measured', value: true, of: 'layers/counts', how: 'every stored value is an integer' }
const CHOSEN = { kind: 'chosen', value: 'cell_type', by: 'guess' }
const WRITTEN = { recorded: [RECORDED, ABSENT], measured: [MEASURED, { ...MEASURED, value: 'log1p of counts scaled to 10,000 per cell', of: 'X' }], chosen: [CHOSEN, { ...CHOSEN, by: 'flag' }, { ...CHOSEN, by: 'app' }] }

// The decoys: each LOOKS like a source and is none. A name in the older field; a fact with no place, no
// matrix, no chooser; a kind this app does not know; a value that is not one short line of text.
const LOOKS = {
  integration: 'harmony', normalization: 'log1p(CP10K)', doublets: 'scrublet_score', ambient: 'cellbender',
  cell_type_column: 'leiden', expression: 'log1p(CP10K)', embedding: 'X_umap_harmony', not_called: 'EXCLUDED',
}
const HOSTILE = [
  ['a recorded value with no place', { kind: 'recorded', value: 'harmony' }],
  ['a place that is empty', { kind: 'recorded', value: 'harmony', at: '' }],
  ['a kind this app does not know', { kind: 'inferred', value: 'harmony', at: 'obsm/X_harmony' }],
  ['no kind at all', { value: 'harmony', at: 'uns/tool/default_method' }],
  ['a bare string', 'harmony'],
  ['a value that is an object', { kind: 'recorded', value: { name: 'harmony' }, at: 'uns/tool/default_method' }],
  ['a value that is markup', { kind: 'recorded', value: '<b>harmony</b>', at: 'uns/tool/default_method' }],
  ['a value with a line break', { kind: 'recorded', value: 'harmony\nas recorded', at: 'uns/tool/default_method' }],
  ['a value of 65 characters', { kind: 'recorded', value: 'h'.repeat(65), at: 'uns/tool/default_method' }],
  ['a measured value with no matrix', { kind: 'measured', value: true, how: 'looked at it' }],
  ['a choice with no chooser', { kind: 'chosen', value: 'harmony' }],
  ['a kind inherited, not owned', Object.create({ kind: 'recorded', value: 'harmony', at: 'uns/tool/default_method' })],
]
const CLAIM = /as recorded|from your file/i
const ownWords = parts => words(parts.filter(p => typeof p === 'string').join(' ').replace(/[\d,]+/g, ' '))

console.log('Facts: the table is closed, and every fact has a sentence')
ok(FACT_IDS.every(id => SENTENCES.some(s => s.fact === id)), `each of the ${FACT_IDS.length} facts is spoken of by a row of SENTENCES (${SENTENCES.length} rows)`,
  FACT_IDS.filter(id => !SENTENCES.some(s => s.fact === id)).join(', '))
ok(SENTENCES.every(s => FACT_IDS.includes(s.fact) && BUDGET[s.budget] !== undefined), 'each row names a fact of the table and a kind of string the standard budgets')
ok(Object.values(BADGE).every(b => words(b.text) <= BUDGET.badge), 'every badge is within a badge\'s 3 words')
ok(Object.keys(CITED).join() === 'harmony', 'the closed citation table holds one key, read by equality')

console.log('Facts: each row under each source kind a bundle can give')
for (const s of SENTENCES) {
  const row = FACTS[s.fact]
  const states = [['a bundle of today, nothing stated', bare()],
    ...row.takes.flatMap(k => WRITTEN[k].map((f, i) => [`${k} #${i + 1}`, withFact(s.fact, f)]))]
  const bad = []
  for (const [what, mt] of states) {
    const parts = s.say(mt), text = plain(parts), kind = sourceOf(mt, s.fact).kind
    if (CLAIM.test(text) && kind !== 'recorded') bad.push(`${what}: claims a record under kind ${kind}: ${text}`)
    if (ownWords(parts) > BUDGET[s.budget]) bad.push(`${what}: ${ownWords(parts)} words, over ${BUDGET[s.budget]} (${s.budget}): ${text}`)
    if (retiredIn(text).length) bad.push(`${what}: a retired word: ${text}`)
    if (/undefined|\[object|NaN/.test(text)) bad.push(`${what}: a hole in the sentence: ${text}`)
  }
  ok(bad.length === 0, `${s.where} (${s.fact}; ${states.length} states; ${s.budget} ${BUDGET[s.budget]})`, bad.join('\n       '))
}
{
  // The kinds are reached: a row that takes "recorded" really says so with the place, and only then.
  const rec = SENTENCES.filter(s => FACTS[s.fact].takes.includes('recorded') && !['badge', 'title'].includes(s.budget) && !/embedding|badge/.test(s.where))
  const says = rec.filter(s => plain(s.say(withFact(s.fact, RECORDED))).includes(RECORDED.at))
  ok(says.length === rec.length && rec.length >= 6, `a recorded fact is said with its place by every row that takes one (${says.length} of ${rec.length})`,
    rec.filter(s => !says.includes(s)).map(s => s.where).join('; '))
}

console.log('Facts: a decoy for every row (a name with no source is never a record)')
for (const s of SENTENCES) {
  const decoys = [
    ...(LOOKS[s.fact] ? [['the older field holds a name', bare({
      provenance: { integration: LOOKS.integration, normalization: LOOKS.normalization, doublets: LOOKS.doublets, ambient: LOOKS.ambient, clustering: LOOKS.cell_type_column },
      expression: LOOKS.expression, embedding: LOOKS.embedding, sentinels: [LOOKS.not_called],
      notes: ['total counts as recorded in obs', 'harmony was run'],
    })]] : []),
    ...HOSTILE.map(([what, f]) => [what, withFact(s.fact, f, { provenance: { integration: 'harmony' } })]),
    ['facts that are not an object', bare({ facts: 'harmony', provenance: { integration: 'harmony' } })],
    ['facts of another version', bare({ facts: { v: 2, [s.fact]: RECORDED } })],
    ['facts with no version', bare({ facts: { [s.fact]: RECORDED } })],
  ]
  const bad = []
  for (const [what, mt] of decoys) {
    const text = plain(s.say(mt)), src = sourceOf(mt, s.fact)
    if (src.kind === 'recorded' || src.kind === 'measured' || src.kind === 'chosen') bad.push(`${what}: read as ${src.kind}`)
    if (CLAIM.test(text)) bad.push(`${what}: claims a record: ${text}`)
    if (citationFor(sourceOf(mt, 'integration')) !== null || methodsIntegration(mt).cite !== null) bad.push(`${what}: cited`)
    if (/<b>|\[object/.test(text)) bad.push(`${what}: drew what it could not read: ${text}`)
  }
  ok(bad.length === 0, `${s.where}: ${decoys.length} decoys, none recorded, none cited`, bad.slice(0, 4).join('\n       '))
}

console.log('Facts: the citation is by equality with a recorded value')
{
  const cite = v => methodsIntegration(withFact('integration', { ...RECORDED, value: v })).cite
  ok(cite('harmony') === 'harmony', 'a recorded "harmony" is cited')
  ok(['Harmony', 'harmony2', 'harmonypy', 'X_harmony', 'not harmony', 'scanvi', 'none', '__proto__', 'constructor', 'toString'].every(v => cite(v) === null),
    'a value that only looks like it is not: Harmony, harmony2, X_harmony, scanvi, none, __proto__, constructor')
  const m = bare({ provenance: { integration: 'harmony' } })
  ok(methodsIntegration(m).cite === null && !/harmony/.test(plain(methodsIntegration(m).before)),
    'an unsourced "harmony" is not cited and not named in Methods', plain(methodsIntegration(m).before))
  ok(/no source for an integration method, so none is named/.test(plain(methodsIntegration(m).before)), 'Methods says what was not recorded instead')
  const none = withFact('integration', { ...RECORDED, value: 'none' })
  ok(/records its integration method as none \(at /.test(plain([...methodsIntegration(none).before, ...methodsIntegration(none).after])),
    'a recorded "none" is shown as the object\'s own word, never as "was corrected with"')
}

console.log('Facts: a per-cell total is called counts only when the bundle says it was summed from counts')
{
  const LAB = 'no total-count column; recomputed from the matrix', PY = 'no total-count column in obs; recomputed from the matrix'
  const t = mt => qcWords(mt, true).total
  ok(t(bare({ notes: [LAB], hasRawCounts: true })) === 'Total counts' && t(bare({ notes: [PY], hasRawCounts: true })) === 'Total counts',
    'today: recomputed (the lab\'s or the exporter\'s own sentence) in a bundle written with raw counts: "Total counts"')
  ok(t(bare({ notes: [LAB], hasRawCounts: false, countsRefused: true })) === 'Total counts', 'and when this app then refused the table: still summed from counts')
  ok(t(bare({ notes: [LAB] })) === 'Sum of log-normalized values', 'today: recomputed with no raw counts: "Sum of log-normalized values"', t(bare({ notes: [LAB] })))
  ok(t(bare({ hasRawCounts: true })) === 'Per-cell total' && t(bare()) === 'Per-cell total', 'today: no such note (a column by a standard name): "Per-cell total"')
  ok(t(bare({ notes: ['total counts were recomputed from the counts layer', `${LAB} `, LAB.toUpperCase()], hasRawCounts: true })) === 'Per-cell total',
    'a note that only looks like the writer\'s sentence decides nothing')
  const counts = { kind: 'measured', value: true, of: 'layers/counts', how: 'every stored value is an integer', carried: false, why: 'one matrix is read from a split object' }
  const facts = of => bare({ facts: { v: 1, counts, total: { kind: 'measured', value: null, of, how: 'summed per cell' } } })
  ok(t(facts('layers/counts')) === 'Total counts', 'facts: a total measured on the matrix measured as counts: "Total counts"')
  ok(t(facts('X')) === 'Per-cell total' && /summed at conversion from X/.test(plain(qcWords(facts('X'), true).line)), 'facts: a total measured on another matrix: "Per-cell total", the matrix named')
  ok(t(bare({ facts: { v: 1, counts: { ...counts, value: false }, total: { kind: 'measured', value: null, of: 'layers/counts', how: 'summed' } } })) === 'Per-cell total',
    'facts: a matrix named counts that was not measured as counts: "Per-cell total"')
  const rec = bare({ facts: { v: 1, total: { kind: 'recorded', value: 'total_counts', at: 'obs/total_counts' } } })
  ok(t(rec) === 'Per-cell total' && /total_counts at obs\/total_counts, as recorded/.test(plain(qcWords(rec, true).line)), 'facts: a recorded column is named with its place, and its name does not make it counts')
}

console.log('Facts: cells with no coordinates are counted from the coordinates')
{
  const xy = Float32Array.from([0, 0, NaN, 1, 2, Infinity, 3, 3, NaN, NaN])
  const cells = [{ t: 0 }, { t: 1 }, { t: 1 }, { t: 1 }, { t: 0 }], types = [{}, { sentinel: true }]
  ok(undrawnOf(xy, cells, types) === 2, 'two of three cells not called have a non-finite coordinate (a cell type\'s cell is not counted)')
  ok(undrawnOf(undefined, cells, types) === 0 && undrawnOf(new Float32Array(10), cells, types) === 0, 'none without coordinates to read, none when all are finite')
}

console.log('Facts: no fact is said anywhere else')
{
  const files = []
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name)) files.push(p) } }
  walk('src')
  // The Run card keeps its own closed reader (lib/run.ts): "as recorded" there is of a field it read by name.
  const ALLOWED = /lib\/facts\.ts$|components\/RunCard\.tsx$|lib\/run\.ts$/
  const hits = files.filter(f => !ALLOWED.test(f)).flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
    .map((l, i) => (/as recorded|from your file|not recorded|none recorded|METHOD_REFS|EMB_REFS/i.test(l.replace('which Overview shows as recorded', '')) ? `${f}:${i + 1} ${l.trim().slice(0, 90)}` : null)).filter(Boolean))
  ok(hits.length === 0, '"as recorded", "from your file" and "not recorded" are written in lib/facts.ts and the Run card only; the two pattern tables are gone', hits.join('\n       '))
  const reads = files.filter(f => /components\//.test(f)).flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
    .map((l, i) => (/\.provenance\b|\.hasRawCounts\b|meta\.facts\b/.test(l) ? `${f}:${i + 1} ${l.trim().slice(0, 90)}` : null)).filter(Boolean))
  ok(reads.length === 0, 'no component reads the bundle\'s provenance, hasRawCounts or facts itself', reads.join('\n       '))
  const expr = files.filter(f => /components\//.test(f)).flatMap(f => fs.readFileSync(f, 'utf8').split('\n')
    .map((l, i) => (/meta\.expression\b/.test(l) ? `${f.replace(/^src\/components\//, '')}:${i + 1}` : null)).filter(Boolean))
  ok(expr.length === 3 && expr.every(e => /^(gene\/ViolinPanel|gene\/FeaturePlot|GeneSets)\.tsx:/.test(e)),
    'the bundle\'s label for its values is drawn verbatim as an axis unit in three gene panels, and read nowhere else', expr.join(', '))
}

console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`)
process.exit(fail ? 1 : 0)
