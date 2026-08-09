// The result cache decides whether four minutes of work survives, so its
// arithmetic is asserted directly rather than inferred from the app.
//
// Two properties matter more than the rest:
//   - an answer is only ever returned under the key it was computed for;
//   - the bound actually bounds, and the entry just stored is never the one
//     thrown away to satisfy it.

import { makeCache, sizeOf, ROW_BYTES, BUDGET } from '../src/lib/result-cache.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const table = (n) => ({ rows: new Array(n).fill(0).map(() => ({ gene: 'g' })), n0: 1, n1: 2 })

console.log('\nWHAT AN ANSWER COSTS')
check('a DE table is counted in rows', sizeOf(table(1000)), 1000 * ROW_BYTES)
check('markers is every cluster added up', sizeOf([table(10), table(20)]), 30 * ROW_BYTES)
check('a typed array knows its own size', sizeOf(new Float32Array(292495)), 292495 * 4)
check('a Float64 gene vector likewise', sizeOf(new Float64Array(31053)), 31053 * 8)
check('anything else is not guessed at', sizeOf({ nope: 1 }), 0)

// The real object, so the documented number is the one the code produces.
const MARKERS_ROWS = 400324
console.log(`\nTHE ATLAS: ${MARKERS_ROWS.toLocaleString()} marker rows`)
const markersBytes = sizeOf([table(MARKERS_ROWS)])
console.log(`       ${(markersBytes / 1024 / 1024).toFixed(1)} MB of a ${(BUDGET / 1024 / 1024).toFixed(0)} MB budget`)
check('one markers pass fits inside the bound', markersBytes < BUDGET, true)

console.log('\nAN ANSWER COMES BACK ONLY UNDER ITS OWN KEY')
{
  const c = makeCache()
  c.put('de|0|A|B', table(3))
  check('a key never stored is a miss', c.get('de|0|A|C'), null)
  check('a key stored is a hit', c.get('de|0|A|B').value.rows.length, 3)
  c.put('de|0|A|B', table(9))
  check('re-storing replaces rather than accumulates', c.get('de|0|A|B').value.rows.length, 9)
  check('and is not counted twice', c.bytes(), 9 * ROW_BYTES)
}

console.log('\nTHE BOUND BOUNDS')
{
  // Four answers of 300 bytes each in a 1 000-byte cache: the fourth must push
  // the first out, and only the first.
  const c = makeCache(1000)
  for (const k of ['a', 'b', 'c']) c.put(k, new Uint8Array(300))
  check('three fit', c.keys(), ['a', 'b', 'c'])
  c.put('d', new Uint8Array(300))
  check('the fourth evicts the oldest', c.keys(), ['b', 'c', 'd'])
  check('and the total is under the bound', c.bytes() <= 1000, true)
}
{
  const c = makeCache(1000)
  for (const k of ['a', 'b', 'c']) c.put(k, new Uint8Array(300))
  c.get('a')                       // touched, so no longer the oldest
  c.put('d', new Uint8Array(300))
  check('reading an answer saves it from eviction', c.keys(), ['c', 'a', 'd'])
}

console.log('\nPEEK IS A PURE READ')
{
  const c = makeCache(1000)
  for (const k of ['a', 'b', 'c']) c.put(k, new Uint8Array(300))
  check('peek finds what get would', c.peek('a').value.byteLength, 300)
  check('peek misses what get would miss', c.peek('zz'), null)
  c.peek('a')
  check('but peek does not reorder', c.keys(), ['a', 'b', 'c'])
  c.put('d', new Uint8Array(300))
  check('so a peeked answer is still the next evicted', c.keys(), ['b', 'c', 'd'])
  check('peek creates nothing', c.bytes(), 900)
}
{
  const c = makeCache(1000)
  c.put('small', new Uint8Array(100))
  c.put('huge', new Uint8Array(5000))
  check('an answer bigger than the budget is still kept', c.get('huge') !== null, true)
  check('everything else went to make room for it', c.keys(), ['huge'])
  console.log(`       over the bound by ${c.bytes() - 1000} bytes, deliberately: evicting it`)
  console.log('       would guarantee recomputing the pass that just finished')
}
{
  // Eviction must free enough in one go, not one entry per insertion.
  const c = makeCache(1000)
  for (const k of ['a', 'b', 'c']) c.put(k, new Uint8Array(300))
  c.put('big', new Uint8Array(900))
  check('a large answer evicts as many as it needs', c.keys(), ['big'])
  check('and lands inside the bound', c.bytes(), 900)
}

console.log(failed ? `\n${failed} FAILED\n` : '\nAll result-cache tests passed\n')
process.exit(failed ? 1 : 0)
