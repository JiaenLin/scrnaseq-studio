// Gene search regressions (npm test, and in CI before deploy).
// Runs the real src/lib/genes.ts via Node's built-in TypeScript type-stripping.
import { mergeGenes, parseGeneList, rankGenes, MAX_GENES } from '../src/lib/genes.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const GENES = ['Ascl1', 'Ascl2', 'Sox2', 'Sox9', 'Sox10', 'Sox11', 'Sox21', 'Gfap', 'Egfr', 'Mki67']

console.log('\nEXACT MATCH RANKS FIRST')
// The bug this exists for: Sox21 sorting above Sox2 for the query "Sox2".
check('Sox2 beats Sox21', rankGenes('Sox2', GENES)[0], 'Sox2')
check('Ascl1 beats Ascl2', rankGenes('Ascl1', GENES)[0], 'Ascl1')
check('case-insensitive exact', rankGenes('sox2', GENES)[0], 'Sox2')
check('prefix band, shortest first', rankGenes('Sox', GENES).slice(0, 3), ['Sox2', 'Sox9', 'Sox10'])
check('no query, no hits', rankGenes('   ', GENES), [])
check('unknown query, no hits', rankGenes('zzz', GENES), [])

console.log('\nLIST PASTING')
const sep = parseGeneList('ascl1, EGFR  mki67\nGFAP; sox2|Sox21', GENES)
check('every separator understood', sep.found, ['Ascl1', 'Egfr', 'Mki67', 'Gfap', 'Sox2', 'Sox21'])
check('nothing missing', sep.missing, [])

const mixed = parseGeneList('ASCL1, notagene, Gfap, alsomissing', GENES)
check('case resolves to the object spelling', mixed.found, ['Ascl1', 'Gfap'])
check('unknown symbols reported as typed', mixed.missing, ['notagene', 'alsomissing'])

check('duplicates collapse', parseGeneList('Gfap gfap GFAP', GENES).found, ['Gfap'])
check('missing deduplicates too', parseGeneList('zz, ZZ2, zz', GENES).missing, ['zz', 'ZZ2'])
check('empty text is empty', parseGeneList('   \n  ', GENES), { found: [], missing: [] })

console.log('\nMERGING INTO A SELECTION')
check('appends, preserving order', mergeGenes(['Gfap'], ['Sox2', 'Egfr']), ['Gfap', 'Sox2', 'Egfr'])
check('never duplicates', mergeGenes(['Gfap', 'Sox2'], ['Sox2']), ['Gfap', 'Sox2'])
{
  const many = Array.from({ length: MAX_GENES + 6 }, (_, i) => `G${i}`)
  const out = mergeGenes([], many)
  check('caps at MAX_GENES', out.length, MAX_GENES)
  check('keeps the most recent', out[out.length - 1], `G${MAX_GENES + 5}`)
}


console.log(String.fromCharCode(10) + 'EXTENTS DO NOT SPREAD PER-CELL ARRAYS INTO A CALL')
// Math.min(...xs) passes every element as an argument and V8 refuses past about
// 124,000 of them. A per-cell array crosses that at 124k cells and throws
// RangeError, which unmounts React and leaves a blank page with no message.
// That is exactly what a 292,495-cell atlas did, on every tab that draws an
// extent, and nothing caught it because no test ever opened an object that big.
{
  const { minOf, maxOf } = await import('../src/lib/chart.ts')
  const big = new Float32Array(300_000)
  for (let i = 0; i < big.length; i++) big[i] = (i % 977) - 488
  check('300,000 values do not overflow the stack', minOf(big), -488)
  check('and the max is right', maxOf(big), 488)
  check('an empty array falls back rather than returning Infinity',
    [minOf(new Float32Array(0), 7), maxOf(new Float32Array(0), 7)], [7, 7])
}

console.log(String.fromCharCode(10) + 'AN AXIS DRAWS EVEN WHEN EVERY VALUE IS THE SAME')
// A covariate the object does not carry arrives as a flat zero - the QC panel
// shows a mitochondrial fraction of 0 for every cell when there was no such
// column. Then lo === hi, the padding is zero, every coordinate is (v-y0)/0,
// and SVG rejects each attribute with 'Expected length, NaN' while the numbers
// beside the broken chart are perfectly correct.
{
  const { axisRange } = await import('../src/lib/chart.ts')
  const flat = axisRange(0, 0, { fromZero: true })
  check('an all-zero covariate still spans something', flat.y1 > flat.y0, true)
  check('and does not go negative', flat.y0 >= 0, true)
  const same = axisRange(3.5, 3.5)
  check('a constant non-zero value spans something too', same.y1 > same.y0, true)
  const norm = axisRange(0, 100, { fromZero: true })
  check('a normal range is padded, not distorted',
    [norm.y0, Math.round(norm.y1)], [0, 104])
  check('every bound is finite',
    [flat, same, norm].every(r => Number.isFinite(r.y0) && Number.isFinite(r.y1)), true)
}
console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll gene-search tests passed\n')
process.exit(failed ? 1 : 0)
