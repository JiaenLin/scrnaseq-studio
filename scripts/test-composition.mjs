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
  compFields, compHeader, compName, compTable, extraAt, fieldExport, fieldLabel, levelsOf,
  rowAxes,
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

/**
 * 12 cells: 3 cell types, 4 samples in 2 groups, and two further columns the
 * object happens to carry. Neither of them nests inside a sample — s1 spans two
 * dissections — because that is what a real atlas does and it is the case the
 * row/part arithmetic can get wrong without throwing.
 *
 * The two extra columns are named by the caller, because the names are half of
 * what is under test here: everything the object exports has to arrive under
 * them, including when they are names the studio already spends.
 */
function fourColumns(k0 = 'dissection', k1 = 'Class') {
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
      { key: k0, file: 'extra.0.u16', levels: ['Forebrain', 'Midbrain', 'Hindbrain'] },
      { key: k1, file: 'extra.1.u16', levels: ['Neuroectoderm', 'Mesoderm'] },
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
    'extra.0.u16': u16([0, 0, 1, 1, 2, 2, 0, 1, 2, 2, 1, 0]),
    'extra.1.u16': u16([0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
    'embed.f32': f32(Array.from({ length: 2 * n }, (_v, i) => i)),
    'qc.f32': f32(Array.from({ length: 3 * n }, () => 1)),
  }).buffer)
  return { d: bundleDataset(b), types: meta.clusters.map(name => ({ name, key: name })) }
}

console.log('\nAN OBJECT WITH MORE THAN THREE COLUMNS')
{
  const { d, types } = fourColumns()

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

console.log('\nTHE NAMES THAT LEAVE THE APP')
{
  // extra0 is a position in a list. It is fine on a menu's value attribute and
  // it is not fine in a file, where it is the only thing the reader will have
  // six months from now — so nothing that lands on disk may spell a column that
  // way. The three roles keep the words the studio's other exports spend.
  const { d } = fourColumns()
  check('the three roles export under the studio\'s own words',
    ['type', 'cond', 'sample'].map(f => fieldExport(d, f)), ['type', 'cond', 'sample'])
  check('a carried column exports under the object\'s word, never its index',
    compFields(d).map(f => fieldExport(d, f)),
    ['type', 'cond', 'dissection', 'Class', 'sample'])

  check('the CSV header names every column it writes',
    compHeader(d, 'type', ['extra0']),
    ['dissection', 'type', 'cells', 'row_total', 'samples', 'fraction'])
  check('and does so whichever side the carried column is on',
    compHeader(d, 'extra0', ['cond']),
    ['cond', 'dissection', 'cells', 'row_total', 'samples', 'fraction'])
  check('both fields of a product axis are named',
    compHeader(d, 'type', ['cond', 'extra0']),
    ['cond', 'dissection', 'type', 'cells', 'row_total', 'samples', 'fraction'])

  check('the download name carries the column too',
    [compName(d, 'type', ['extra0']), compName(d, 'extra0', ['cond']),
      compName(d, 'type', ['cond', 'extra0'])],
    ['composition_type_by_dissection', 'composition_dissection_by_cond',
      'composition_type_by_cond_dissection'])
  // Nothing on disk may still read as a list position, under any pairing.
  const everyName = compFields(d).flatMap(p =>
    rowAxes(d, p).flatMap(a => [compName(d, p, a.fields), ...compHeader(d, p, a.fields)]))
  ok('no export name anywhere spells a column extraN',
    !everyName.some(s => /extra\d/.test(s)), `${everyName.length} names checked`)

  // A name a file system would refuse, or would silently change, is not a name.
  const { d: odd } = fourColumns('Dissection / region', 'ages (E)')
  check('a column name is sanitised the way the exporter sanitises an entry',
    [fieldExport(odd, 'extra0'), fieldExport(odd, 'extra1')],
    ['Dissection_region', 'ages_E'])

  // Two fields cannot collide; two names can. A CSV with one name twice is a
  // file a spreadsheet reads by silently picking one of them.
  const { d: clash } = fourColumns('cells', 'Cell.type')
  check('a carried column that lands on a column this table already writes is suffixed',
    compHeader(clash, 'type', ['extra0']),
    ['cells-2', 'type', 'cells', 'row_total', 'samples', 'fraction'])
  const { d: twin } = fourColumns('cell type', 'cell/type')
  check('and so are two carried columns that flatten to the same word',
    compHeader(twin, 'sample', ['extra0', 'extra1']),
    ['cell_type', 'cell_type-2', 'sample', 'cells', 'row_total', 'samples', 'fraction'])
}

console.log('\nWHAT THE REFUSAL IS ALLOWED TO CLAIM')
{
  // The card quotes these three numbers back at the reader, so they have to be
  // the cells and not an approximation of them.
  const { d, types } = fourColumns()
  const perRegion = compTable(d, types, 'type', ['extra0'])
  // Counted by hand off the fixture's own codes: dissection 1 holds cells from
  // all four samples, the other two hold three each.
  check('a row knows how many samples it merges',
    perRegion.rows.map(r => r.nSamples), [3, 4, 3])
  check('and the table totals it', [perRegion.pooledRows, perRegion.worstPool], [3, 4])
  check('every sample of this fixture reaches more than one dissection',
    perRegion.spanningSamples, d.samples.length)

  // The atlas's shape, and the reason its three figures are refused: a sample
  // sits in exactly one group, so no arrangement of the two separates them.
  const cohort = demoSource('cohort')
  const perGroup = compTable(cohort.d, cohort.types, 'type', ['cond'])
  check('no sample of a one-group-per-animal object spans two groups',
    perGroup.spanningSamples, 0)
  check('so every group row is whole animals merged',
    [perGroup.pooledRows, perGroup.rows.length],
    [perGroup.rows.length, cohort.d.conds.length])
  check('and the row sample counts add up to the object\'s samples',
    perGroup.rows.reduce((a, r) => a + r.nSamples, 0), cohort.d.samples.length)

  // The card offers exactly one fix, and claims it draws. It has to exist for
  // every refused pairing, and it must not itself pool — a row that ends in a
  // sample is inside one animal by construction, and the card says so.
  let missing = 0
  let stillPools = 0
  for (const src of [fourColumns(), cohort]) {
    for (const parts of compFields(src.d)) {
      for (const a of rowAxes(src.d, parts)) {
        const t = compTable(src.d, src.types, parts, a.fields)
        if (!(t.pools && parts !== 'sample')) continue
        const fix = rowAxes(src.d, parts).find(x => x.key === `${a.fields[0]}+sample`)
        if (!fix) { missing++; continue }
        if (compTable(src.d, src.types, parts, fix.fields).pools) stillPools++
      }
    }
  }
  check('every refused pairing has the fix the card offers', missing, 0)
  check('and the fix never pools in its turn', stillPools, 0)
}

console.log(failed ? `\n${failed} FAILED` : '\nAll composition tests passed')
process.exit(failed ? 1 : 0)
