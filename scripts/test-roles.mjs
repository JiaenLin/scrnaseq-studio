// Re-pointing which carried column counts as the cell type, or as the group.
//
// The columns are already in the bundle, so this is arithmetic on arrays in
// memory rather than a re-read — 68 ms on a 1.2 M-cell object. What it must not
// be is arithmetic that quietly disagrees with itself: a Source caches its
// group lookups by `ti|cond`, so a re-point that reused the old source would
// answer every question with the arrangement that no longer exists.

import { demoSource } from '../src/lib/source.ts'
import { groupable, groupOptions, typeOptions, withRoles } from '../src/lib/roles.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

/** A demo object with extra columns attached, as a bundle carries them. */
function withExtras(key = 'cohort') {
  const src = demoSource(key)
  const n = src.d.cells.length
  // Constant within a sample: legal as a group.
  const bySample = new Map()
  src.d.samples.forEach((s, i) => bySample.set(s.id, i % 2))
  const arm = {
    key: 'Arm', levels: ['left', 'right'],
    codes: Uint16Array.from(src.d.cells, c => bySample.get(c.s) ?? 0),
  }
  // Varies within a sample: NOT legal as a group.
  const phase = {
    key: 'Phase', levels: ['G1', 'S', 'G2M'],
    codes: Uint16Array.from({ length: n }, (_v, i) => i % 3),
  }
  // A finer clustering — the common reason to re-point the cell type.
  const sub = {
    key: 'sub.cluster', levels: ['a', 'b', 'c', 'd', 'e'],
    codes: Uint16Array.from({ length: n }, (_v, i) => i % 5),
  }
  Object.assign(src.d, { columns: { cond: 'Treatment', extras: [arm, phase, sub] } })
  return { src, arm, phase, sub }
}

console.log('\nWHICH COLUMNS MAY STAND IN')
{
  const { src, arm, phase, sub } = withExtras()
  check('a column constant within every sample can be a group', groupable(src.d, arm), true)
  check('one that varies inside a sample cannot', groupable(src.d, phase), false)
  check('and a fine clustering is judged the same way', groupable(src.d, sub), false)

  check('every extra is offered for the cell type',
    typeOptions(src.d, 'cell type').map(o => o.key),
    ['cell type', 'Arm', 'Phase', 'sub.cluster'])
  // The exclusion is the point: a group that varies inside a sample would put
  // one animal on both sides of its own pseudobulk comparison.
  check('only the sample-constant one is offered for the group',
    groupOptions(src.d, 'Treatment').map(o => o.key), ['Treatment', 'Arm'])
}

console.log('\nRE-POINTING THE CELL TYPE')
{
  const { src, sub } = withExtras()
  const before = src.d.cells.length
  const { src: next, types } = withRoles(src, 2, -1)   // sub.cluster

  check('the type list becomes the column levels', types.map(t => t.name), sub.levels)
  check('every cell keeps its place',
    [next.d.cells.length, next.d.cells.length === before], [before, true])
  check('and takes the code the column gives it',
    next.d.cells.every((c, i) => c.t === sub.codes[i]), true)
  check('the groups are untouched', next.d.conds, src.d.conds)

  // The composition grid is what Composition draws and what every "n cells"
  // count reads; it has to be rebuilt, not carried over from 9 types to 5.
  check('the grid is rebuilt to the new shape',
    [next.d.grid.length, next.d.grid[0].length],
    [sub.levels.length, src.d.samples.length])
  const total = next.d.grid.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0)
  check('and still accounts for every cell', total, before)

  // THE ONE THAT MATTERS. A Source memoises group lookups by `ti|cond`; if the
  // re-point handed back the same source, this would return the old cluster's
  // cells under the new cluster's index and nothing would look wrong.
  const cond = src.d.conds[0]
  const got = Array.from(next.group(0, [cond]))
  const want = []
  next.d.cells.forEach((c, i) => { if (c.t === 0 && c.cond === cond) want.push(i) })
  check('the rebound source answers about the NEW types', got, want)
  // Built once, outside the loop. Inside it, this rebuilt the whole demo
  // object per cell — 34 367 times — and the test simply never returned.
  const pristine = demoSource('cohort')
  check('and the original source is unchanged',
    src.d.cells.every((c, i) => c.t === pristine.d.cells[i].t), true)
}

console.log('\nRE-POINTING THE GROUP')
{
  const { src, arm } = withExtras()
  const { src: next } = withRoles(src, -1, 0)   // Arm

  check('the groups become the column levels', next.d.conds, arm.levels)
  check('every cell takes its level',
    next.d.cells.every((c, i) => c.cond === arm.levels[arm.codes[i]]), true)
  // Everything replicate-based reads samples[].cond, so it has to follow — and
  // `groupable` is what makes "the sample's level" a well-defined thing.
  check('each sample carries one level, matching its cells',
    next.d.samples.every(s => {
      const mine = next.d.cells.filter(c => c.s === s.id)
      return mine.length === 0 || mine.every(c => c.cond === s.cond)
    }), true)
  const counted = arm.levels.map(l => next.d.cells.filter(c => c.cond === l).length)
  check('the per-group totals are recounted',
    arm.levels.map(l => next.d.nPerCond[l]), counted)
  check('and add up to every cell',
    counted.reduce((a, b) => a + b, 0), src.d.cells.length)
  check('the cell types are untouched',
    next.d.cells.every((c, i) => c.t === src.d.cells[i].t), true)
}

console.log('\nNOTHING CHOSEN IS NOTHING DONE')
{
  const { src } = withExtras()
  const same = withRoles(src, -1, -1)
  // Referentially identical, so every memo keyed on the source holds and the
  // page does not re-render for a setting nobody changed.
  check('the object is handed back as it was', same.src === src, true)
  check('with its own types', same.types === src.types, true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll role tests passed\n')
process.exit(failed ? 1 : 0)
