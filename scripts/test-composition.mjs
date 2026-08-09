// The composition table must be the cells, counted, and nothing else.
//
// Every pairing reads the same three columns a different way, and a mistake in
// the row/part index arithmetic does not throw — it draws a perfectly plausible
// figure with the wrong cells in the wrong bars. So this recounts every pairing
// a second time, straight off d.cells with string lookups, and asserts the two
// agree cell for cell. The fast path walks the per-sample buckets and never
// touches a string; the check deliberately does not.

import { demoSource } from '../src/lib/source.ts'
import { compFields, compTable, levelsOf, rowAxes } from '../src/lib/composition.ts'

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
  const value = (f, c) =>
    f === 'type' ? c.t : f === 'cond' ? condAt.get(c.cond) : sampleAt.get(c.s)
  const tally = new Map()
  for (const c of d.cells) {
    const key = `${rowFields.map(f => value(f, c)).join('|')}#${value(parts, c)}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  return tally
}

for (const key of ['cohort', 'course']) {
  const src = demoSource(key)
  const d = src.d
  const types = src.types
  console.log(`\n${key.toUpperCase()}: ${d.cells.length} cells, ${types.length} types, `
    + `${d.conds.length} groups, ${d.samples.length} samples`)

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

      // Empty combinations are dropped, and only empty ones.
      ok(`${label}: no empty row survives`, t.rows.every(r => r.n > 0))

      // Rows come out in the object's own level order, outermost first — the
      // reason e10.0 must not land between e1 and e2.
      const dims = axis.fields.map(f => levelsOf(d, types, f).length)
      const rank = r => r.keys.reduce((a, k, j) => a * dims[j] + k, 0)
      let sorted = true
      for (let i = 1; i < t.rows.length; i++) {
        if (rank(t.rows[i - 1]) >= rank(t.rows[i])) sorted = false
      }
      ok(`${label}: rows are in level order`, sorted)
    }
  }

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

console.log(failed ? `\n${failed} FAILED` : '\nAll composition tests passed')
process.exit(failed ? 1 : 0)
