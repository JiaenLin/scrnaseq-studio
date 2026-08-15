// Gene search regressions (npm test, and in CI before deploy).
// Runs the real src/lib/genes.ts via Node's built-in TypeScript type-stripping.
import { makeGeneNames, mergeGenes, parseGeneList, rankGenes, MAX_GENES } from '../src/lib/genes.ts'
import { bwNrd0, density } from '../src/lib/chart.ts'

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


console.log(String.fromCharCode(10) + 'AN ACCESSION-INDEXED OBJECT IS SHOWN, AND SEARCHED, IN SYMBOLS')
// The failure this exists for: the developing-mouse atlas is indexed by Ensembl
// accessions, so every table said ENSMUSG00000074637 where it meant Sox2 and
// every built-in gene set matched nothing at all on an object that measures all
// of their genes. The symbols were in the file the whole time.
{
  const ids = ['ENSMUSG01', 'ENSMUSG02', 'ENSMUSG03', 'ENSMUSG04']
  // Row 3 has no symbol, so the exporter repeats the accession; rows 1 and 2
  // genuinely share one — several accessions per symbol is normal, and there are
  // 71 such rows on the real atlas.
  const alias = ['Sox2', 'Sox2', 'Gfap', 'ENSMUSG04']
  const n = makeGeneNames(ids, alias, { idKind: 'accession', aliasKind: 'symbol', aliasColumn: 'Gene', missing: 1 })

  check('an unshared symbol is shown bare', n.display[2], 'Gfap')
  check('a shared symbol carries its accession, so both rows stay reachable',
    [n.display[0], n.display[1]], ['Sox2 (ENSMUSG01)', 'Sox2 (ENSMUSG02)'])
  check('no name is used twice', new Set(n.display).size, n.display.length)
  check('a row with no symbol keeps its accession', n.display[3], 'ENSMUSG04')
  check('and is not written as "X (X)"', n.display[3].includes('('), false)
  check('the collision is counted', n.duplicated, 2)
  check('the accession is still there for every row', n.other, ids)

  check('a symbol finds every row that carries it', n.match('Sox2'), ['Sox2 (ENSMUSG01)', 'Sox2 (ENSMUSG02)'])
  check('an accession finds exactly its own row', n.match('ENSMUSG02'), ['Sox2 (ENSMUSG02)'])
  check('case does not matter', n.match('gfap'), ['Gfap'])
  check('an unknown name finds nothing', n.match('Nope'), [])

  check('a pasted list of symbols resolves against accessions',
    parseGeneList('Gfap, Sox2', n.display, n).found,
    ['Gfap', 'Sox2 (ENSMUSG01)', 'Sox2 (ENSMUSG02)'])
  check('a pasted list of accessions resolves too',
    parseGeneList('ENSMUSG03', n.display, n).found, ['Gfap'])
  check('typing an accession ranks its row', rankGenes('ENSMUSG03', n.display, 8, n), ['Gfap'])
  check('typing the symbol ranks it too', rankGenes('Gfap', n.display, 8, n), ['Gfap'])

  // The bug this caught in the browser: a shared symbol's display name only
  // PREFIX-matches the symbol, so an unrelated longer symbol that starts the
  // same way sorted above the rows the user asked for.
  const wide = makeGeneNames(
    ['E1', 'E2', 'E3', 'E4'], ['Gene2', 'Gene2', 'Gene20', 'Gene21'],
    { idKind: 'accession', aliasKind: 'symbol' })
  check('an exact symbol outranks a longer one that shares its prefix',
    rankGenes('Gene2', wide.display, 8, wide).slice(0, 2), ['Gene2 (E1)', 'Gene2 (E2)'])
}

console.log(String.fromCharCode(10) + 'AN OBJECT WITH ONE NAMING IS UNTOUCHED')
{
  const n = makeGeneNames(GENES, null)
  check('the display names are the file\'s own', n.display, GENES)
  check('there is no second naming', n.other, null)
  check('nothing claims to be renamed', n.renamed, false)
  check('and the old two-argument search still behaves', rankGenes('Sox2', n.display)[0], 'Sox2')
  check('as does the old list parse',
    parseGeneList('sox2, gfap', n.display).found, ['Sox2', 'Gfap'])
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
console.log('\nA VIOLIN OF NOTHING IS A LINE, NOT A SHAPE')
{
  // Reported as "the violin plot shows a weird shape even with no expression".
  // The bandwidth was (hi - lo) / 14 — a fixed fraction of the AXIS, with no
  // reference to the data — so every cell sitting at exactly zero still drew a
  // Gaussian a fourteenth of the axis wide. Nothing trimmed the estimate to the
  // observed range either, so the outline claimed expression the object does
  // not contain.
  const flat = density(new Array(200).fill(0), 0, 4)
  check('all cells at zero: one step wide', flat.filter(v => v > 0).length, 1)
  check('and that step is at zero', flat.indexOf(1), 0)

  const one = density(new Array(200).fill(2), 0, 4)
  check('all cells at one value: a line at that value', one.filter(v => v > 0).length, 1)
  check('placed where the value is', one.indexOf(1), 13)

  // Trimmed: a real distribution must not be drawn outside its own range.
  const half = density(Array.from({ length: 300 }, (_, i) => (i % 100) / 100), 0, 4)
  check('nothing is drawn above the largest value observed',
    half.slice(8).every(v => v === 0), true)
  check('but the occupied part is a real profile',
    half.slice(0, 8).filter(v => v > 0).length > 3, true)

  // The bandwidth follows the data, which is the whole fix.
  const tight = bwNrd0([...Array(100).keys()].map(i => i / 1000).sort((a, b) => a - b))
  const wide = bwNrd0([...Array(100).keys()].map(i => i / 10).sort((a, b) => a - b))
  check('a hundred-fold wider spread gives a wider bandwidth', wide > tight * 50, true)
  check('no spread gives no bandwidth', bwNrd0([3, 3, 3, 3]), 0)

  // Zero-inflation is the normal case in single cell: most cells at 0 and a
  // long right tail. min(sd, IQR/1.349) is what keeps the tail from choosing
  // a bandwidth wide enough to flatten the peak at zero.
  const zi = new Array(180).fill(0).concat([2, 3, 4, 5, 9, 14, 20])
  const d = density(zi, 0, 20)
  check('the mode is at zero where the cells are', d.indexOf(1), 0)
  check('and the tail is drawn, not smoothed away', d.slice(1).some(v => v > 0), true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll gene-search tests passed\n')
process.exit(failed ? 1 : 0)
