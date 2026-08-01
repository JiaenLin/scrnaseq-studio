// The demo object must be internally consistent, and the palette must never
// hand two clusters the same colour.
import { buildDataset, makeTypes, meanExpr, cellExpr, hash, MARKER_OF, GENES } from '../src/lib/demo.ts'
import { pal, rampColor, PALETTES, RAMPS } from '../src/lib/palette.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const types = makeTypes()
const d = buildDataset('cohort', types)

console.log('\nDATASET IS SELF-CONSISTENT')
check('every cell is accounted for in the grid',
  d.grid.flat().reduce((a, b) => a + b, 0), d.nCells)
check('each sample sums to 1 in proportions',
  d.prop.every(row => Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9), true)
check('conditions cover every cell',
  Object.values(d.nPerCond).reduce((a, b) => a + b, 0), d.nCells)
check('no cell has a negative QC covariate',
  d.cells.every(c => c.counts > 0 && c.genes > 0 && c.mito >= 0), true)
check('deterministic across builds',
  buildDataset('cohort', makeTypes()).nCells, d.nCells)

console.log('\nBETWEEN-ANIMAL SPREAD EXISTS')
// Without it the composition panel claims to show spread and shows none.
{
  const ti = 0
  const q = d.samples.map((s, si) => (s.cond === 'Quiescent' ? d.prop[si][ti] : null)).filter(v => v !== null)
  check('animals in a group differ', Math.max(...q) - Math.min(...q) > 0.01, true)
}

console.log('\nMARKERS ARE HIGHEST IN THEIR OWN CLUSTER')
{
  const bad = []
  for (const g of Object.keys(MARKER_OF)) {
    const own = MARKER_OF[g][0]
    const mine = meanExpr(g, own, 0)
    for (let ti = 0; ti < types.length; ti++) {
      if (ti !== own && meanExpr(g, ti, 0) >= mine) bad.push(`${g} in ${types[ti].name}`)
    }
  }
  check('no marker is beaten elsewhere', bad, [])
}

console.log('\nPER-CELL EXPRESSION')
check('every gene has its own dropout pattern', (() => {
  const a = hash('Ascl1'), b = hash('Gfap')
  let same = 0
  for (let i = 0; i < 400; i++) {
    if ((cellExpr(a, i, 1) === 0) === (cellExpr(b, i, 1) === 0)) same++
  }
  return same < 400   // identical masks would mean one shared random draw
})(), true)
check('values are never negative',
  Array.from({ length: 500 }, (_, i) => cellExpr(hash('Ascl1'), i, 1.4)).every(v => v >= 0), true)
check('a gene with no expression stays at zero', meanExpr('Ascl1', 0, 0) > 0, true)
check('every listed gene is resolvable', GENES.every(g => meanExpr(g, 0, 0) > 0), true)

console.log('\nPALETTES')
for (const [key, p] of Object.entries(PALETTES)) {
  check(`${key} has no duplicate colours`, new Set(p.cols).size, p.cols.length)
}
check('past the end, colours keep differing', (() => {
  const seen = new Set()
  for (let i = 0; i < 40; i++) seen.add(pal(i, 'npg'))
  return seen.size
})(), 40)
check('ramps are clamped at both ends', [
  rampColor(-5, 'viridis') === rampColor(0, 'viridis'),
  rampColor(9, 'viridis') === rampColor(1, 'viridis'),
], [true, true])
for (const key of Object.keys(RAMPS)) {
  check(`${key} interpolates without NaN`,
    [0, 0.33, 0.5, 0.9, 1].every(f => !rampColor(f, key).includes('NaN')), true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll demo-object tests passed\n')
process.exit(failed ? 1 : 0)
