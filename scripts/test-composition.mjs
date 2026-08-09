// The composition table must be the cells, counted, and nothing else.
//
// Every pairing reads the same three columns a different way, and a mistake in
// the row/part index arithmetic does not throw — it draws a perfectly plausible
// figure with the wrong cells in the wrong bars. So this recounts every pairing
// a second time, straight off d.cells with string lookups, and asserts the two
// agree cell for cell. The fast path walks the per-sample buckets and never
// touches a string; the check deliberately does not.

import { strToU8, zipSync } from 'fflate'
import { bundleDataset, cellColumns, parseBundle } from '../src/lib/bundle.ts'
import { demoSource } from '../src/lib/source.ts'
import {
  compFields, compTable, extraAt, fieldLabel, levelsOf, rowAxes,
} from '../src/lib/composition.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const ok = (name, cond, detail = '') => check(name + (detail ? ` — ${detail}` : ''), !!cond, true)

/** The same counts, from the cells, without any of the machinery under test. */
function naive(d, types, parts, rowFields) {
  const sampleAt = new Map(d.samples.map((s, i) => [s.id, i]))
  const condAt = new Map(d.conds.map((c, i) => [c, i]))
  const extras = cellColumns(d).extras
  const value = (f, c, i) =>
    f === 'type' ? c.t
      : f === 'cond' ? condAt.get(c.cond)
      : f === 'sample' ? sampleAt.get(c.s)
      : extras[extraAt(f)].codes[i]
  const tally = new Map()
  d.cells.forEach((c, i) => {
    const key = `${rowFields.map(f => value(f, c, i)).join('|')}#${value(parts, c, i)}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  })
  return tally
}

/**
 * Every pairing this object offers, counted twice and compared.
 *
 * One function for all of them, and it never asks what kind of field it is
 * looking at — which is the claim being tested as much as the counts are: the
 * products over an extra column go through the same arithmetic as the products
 * over the three roles, or they go through arithmetic nothing has checked.
 */
function exercise(d, types) {
  for (const parts of compFields(d)) {
    for (const axis of rowAxes(d, parts)) {
      const t = compTable(d, types, parts, axis.fields)
      const want = naive(d, types, parts, axis.fields)

      // Every stored count matches the independent tally, and nothing the
      // independent tally found is missing.
      let wrong = 0
      let seen = 0
      t.rows.forEach((r, i) => {
        for (let p = 0; p < t.nParts; p++) {
          const c = t.counts[i * t.nParts + p]
          if (!c) continue
          seen++
          if (want.get(`${r.keys.join('|')}#${p}`) !== c) wrong++
        }
      })
      const label = `${parts} by ${axis.key}`
      check(`${label}: every non-zero count matches a hand tally`, [wrong, seen], [0, want.size])

      // Nothing is lost and nothing is invented.
      let total = 0
      for (let i = 0; i < t.counts.length; i++) total += t.counts[i]
      check(`${label}: every cell is counted exactly once`, total, d.cells.length)
      check(`${label}: row totals sum to the same`,
        t.rows.reduce((a, r) => a + r.n, 0), d.cells.length)

      // Empty combinations are dropped, and only empty ones — and the figure is
      // told how many there were.
      ok(`${label}: no empty row survives`, t.rows.every(r => r.n > 0))
      const dims = axis.fields.map(f => levelsOf(d, types, f).length)
      check(`${label}: the full grid is reported`,
        [t.possible, t.rows.length <= t.possible],
        [dims.reduce((a, b) => a * b, 1), true])

      // Rows come out in the object's own level order, outermost first — the
      // reason e10.0 must not land between e1 and e2.
      const rank = r => r.keys.reduce((a, k, j) => a * dims[j] + k, 0)
      let sorted = true
      for (let i = 1; i < t.rows.length; i++) {
        if (rank(t.rows[i - 1]) >= rank(t.rows[i])) sorted = false
      }
      ok(`${label}: rows are in level order`, sorted)
    }
  }
}

for (const key of ['cohort', 'course']) {
  const src = demoSource(key)
  const d = src.d
  const types = src.types
  console.log(`\n${key.toUpperCase()}: ${d.cells.length} cells, ${types.length} types, `
    + `${d.conds.length} groups, ${d.samples.length} samples`)

  exercise(d, types)

  console.log('\n  THE HONESTY FLAGS')
  const nPerCond = {}
  for (const s of d.samples) nPerCond[s.cond] = (nPerCond[s.cond] ?? 0) + 1
  const replicated = Object.values(nPerCond).some(n => n > 1)

  // One row per group merges the animals of that group — which is the whole
  // reason the tab refuses to draw it.
  check('one row per group pools when a group has more than one sample',
    compTable(d, types, 'type', ['cond']).pools, replicated)
  check('one row per sample never pools',
    compTable(d, types, 'type', ['sample']).pools, false)
  check('group × sample never pools',
    compTable(d, types, 'cond', ['type', 'sample']).pools, false)

  // A sample belongs to one group, so splitting groups by sample can only ever
  // produce solid bars.
  check('groups per sample are degenerate',
    compTable(d, types, 'cond', ['sample']).degenerate, true)
  check('cell types per sample are not',
    compTable(d, types, 'type', ['sample']).degenerate, false)
}

console.log('\nTHE ROW MENU')
{
  const d = demoSource('cohort').d
  for (const parts of compFields(d)) {
    const axes = rowAxes(d, parts)
    ok(`bars = ${parts}: no axis re-uses the field the bars took`,
      axes.every(a => !a.fields.includes(parts)), axes.map(a => a.key).join(', '))
    // Nesting a group inside a sample draws the same rows under a longer name.
    ok(`bars = ${parts}: no group nested inside a sample`,
      !axes.some(a => a.fields[0] === 'sample' && a.fields[1] === 'cond'))
    ok(`bars = ${parts}: no field appears twice in one axis`,
      axes.every(a => new Set(a.fields).size === a.fields.length))
  }
  // A single-condition object has no groups to offer, and still has a row axis:
  // the fixed view it always had.
  const one = demoSource('wt')
  check('a single-condition object offers no group field',
    compFields(one.d), ['type', 'sample'])
  check('and still offers one row per sample',
    rowAxes(one.d, 'type').map(a => a.key), ['sample'])
  check('with every cell in its single row',
    compTable(one.d, one.types, 'type', ['sample']).rows.length, 1)
}

console.log('\nAN OBJECT WITH MORE THAN THREE COLUMNS')
{
  // 12 cells: 3 cell types, 4 samples in 2 groups, and two further columns the
  // object happens to carry. Neither of them nests inside a sample — s1 spans
  // two dissections — because that is what a real atlas does and it is the case
  // the row/part arithmetic can get wrong without throwing.
  const u16 = a => new Uint8Array(Uint16Array.from(a).buffer)
  const f32 = a => new Uint8Array(Float32Array.from(a).buffer)
  const n = 12
  const meta = {
    schema: 'scrnaseq-studio/bundle@1',
    label: 'four columns', source: 'built in the test',
    nCells: n, nGenes: 2, nnz: 4,
    clusters: ['Radial glia', 'Neuroblast', 'Blood'],
    samples: [{ id: 's1', condition: 'e9.0' }, { id: 's2', condition: 'e9.0' },
      { id: 's3', condition: 'e12.5' }, { id: 's4', condition: 'e12.5' }],
    conditions: ['e9.0', 'e12.5'],
    extras: [
      { key: 'dissection', file: 'extra.dissection.u16',
        levels: ['Forebrain', 'Midbrain', 'Hindbrain'] },
      { key: 'Class', file: 'extra.Class.u16', levels: ['Neuroectoderm', 'Mesoderm'] },
    ],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: false,
    provenance: { clustering: 'Subclass', condition: 'Age' },
    notes: [],
  }
  const b = parseBundle(zipSync({
    'meta.json': strToU8(JSON.stringify(meta)),
    'genes.txt': strToU8('A\nB'),
    'expr.indptr.i32': new Uint8Array(Int32Array.from([0, 2, 4]).buffer),
    'expr.indices.i32': new Uint8Array(Int32Array.from([0, 5, 3, 11]).buffer),
    'expr.data.f32': f32([1, 2, 3, 4]),
    'cluster.u16': u16([0, 1, 2, 0, 0, 1, 2, 2, 1, 0, 1, 2]),
    'sample.u16': u16([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]),
    'extra.dissection.u16': u16([0, 0, 1, 1, 2, 2, 0, 1, 2, 2, 1, 0]),
    'extra.Class.u16': u16([0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
    'embed.f32': f32(Array.from({ length: 2 * n }, (_v, i) => i)),
    'qc.f32': f32(Array.from({ length: 3 * n }, () => 1)),
  }).buffer)
  const d = bundleDataset(b)
  const types = meta.clusters.map(name => ({ name, key: name }))

  check('all four columns are offered', compFields(d),
    ['type', 'cond', 'extra0', 'extra1', 'sample'])
  check('each under the name the object gave it',
    compFields(d).map(f => fieldLabel(d, f)),
    ['Cell type', 'Age', 'dissection', 'Class', 'Sample'])
  check('every product of the others is a row axis',
    rowAxes(d, 'type').map(a => a.label),
    ['Age', 'dissection', 'Class', 'Sample',
      'Age × dissection', 'Age × Class', 'Age × Sample',
      'dissection × Age', 'dissection × Class', 'dissection × Sample',
      'Class × Age', 'Class × dissection', 'Class × Sample',
      'Sample × dissection', 'Sample × Class'])

  // The same double-counting the demo objects get, over every one of those.
  exercise(d, types)

  // And the two the human asked for by name, read off the counts.
  const byRegion = compTable(d, types, 'type', ['extra0'])
  check('cell types per dissection', byRegion.rows.map(r => r.n), [4, 4, 4])
  const regionByAge = compTable(d, types, 'extra0', ['cond'])
  check('dissections per age', [...regionByAge.counts], [2, 2, 2, 2, 2, 2])
  check('a product row axis reports the empty half of the grid',
    [compTable(d, types, 'cond', ['type', 'extra0']).possible,
      compTable(d, types, 'cond', ['type', 'extra0']).rows.length], [9, 8])
}

console.log(failed ? `\n${failed} FAILED` : '\nAll composition tests passed')
process.exit(failed ? 1 : 0)
