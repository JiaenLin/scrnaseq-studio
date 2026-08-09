// The dot grid must agree with the Source, to the bit.
//
// dotGrid exists only because asking `src.mean(g, ti)` fifty thousand times is
// slow. Being fast is worth nothing if it is a second answer to the same
// question, so this asserts Object.is on every value of a full grid — not a
// tolerance, because a tolerance would hide exactly the mistake this is here to
// catch: summing in a different order and calling it the same number.

import { demoSource } from '../src/lib/source.ts'
import { dotGrid, dotAt } from '../src/lib/dots.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

console.log('\nTHE DOT GRID IS THE SOURCE, ONE CELL AT A TIME')
for (const key of ['cohort', 'course']) {
  const src = demoSource(key)
  const nT = src.types.length
  // More genes than the Source's vector cache holds, which is the case the grid
  // exists for and the case a small fixture would miss.
  const genes = src.genes.slice(0, 120)
  const grid = dotGrid(src, genes, nT)

  let meanBad = 0
  let pctBad = 0
  let nonzero = 0
  for (let gi = 0; gi < genes.length; gi++) {
    for (let ti = 0; ti < nT; ti++) {
      const m = src.mean(genes[gi], ti)
      const p = src.pct(genes[gi], ti)
      if (!Object.is(grid.mean[dotAt(grid, gi, ti)], m)) meanBad++
      if (!Object.is(grid.pct[dotAt(grid, gi, ti)], p)) pctBad++
      if (m !== 0) nonzero++
    }
  }
  console.log(`       ${key}: ${genes.length} genes x ${nT} clusters, `
    + `${src.d.cells.length} cells, ${nonzero} non-zero means`)
  check(`${key}: every mean is the same number`, meanBad, 0)
  check(`${key}: every detection rate is the same number`, pctBad, 0)
  check(`${key}: the grid is not trivially zero`, nonzero > genes.length, true)
}

console.log('\nDEGENERATE GRIDS DO NOT THROW')
{
  const src = demoSource('cohort')
  check('no genes', dotGrid(src, [], src.types.length).mean.length, 0)
  check('no clusters', dotGrid(src, [src.genes[0]], 0).mean.length, 0)
  // The demo generator synthesises a value for any name it is given, so an
  // unknown gene is not zero there — it is whatever the Source says, and that is
  // the only thing worth asserting.
  const unknown = dotGrid(src, ['not-a-gene'], src.types.length)
  check('an unlisted gene still reads exactly as the Source reads it',
    [...unknown.mean].every((x, ti) => Object.is(x, src.mean('not-a-gene', ti))), true)
}

console.log(failed ? `\n${failed} FAILED` : '\nAll dot-grid tests passed')
process.exit(failed ? 1 : 0)
