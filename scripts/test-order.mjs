// The group order is a view of the object, and must not be able to become an
// edit of it.
//
// What this pins: every figure that splits by group reads `Dataset.conds`, so
// reordering that one array reorders all of them at once. The risk in that is
// the same one that would make it worth having: if anything downstream
// identified a group by its POSITION rather than its name, moving a level would
// silently move cells between groups — a figure, not an error. So the checks
// below are not about the sort, they are about what the sort must leave alone.

import { moveItem, orderedBy, withCondOrder } from '../src/lib/order.ts'
import { demoSource } from '../src/lib/source.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('\nORDEREDBY')
{
  const all = ['0 h', '6 h', '24 h', '72 h']
  check('no order is the object\'s order', orderedBy(all, []), all)
  check('and is the SAME array, so nothing memoised on it rebuilds',
    orderedBy(all, []) === all, true)
  check('an order that agrees is also the same array',
    orderedBy(all, all) === all, true)
  check('a full order is followed',
    orderedBy(all, ['72 h', '0 h', '24 h', '6 h']), ['72 h', '0 h', '24 h', '6 h'])
  check('a partial order places what it names and keeps the rest in file order',
    orderedBy(all, ['72 h']), ['72 h', '0 h', '6 h', '24 h'])
  check('a name the object does not have is ignored, not inserted',
    orderedBy(all, ['nonesuch', '24 h']), ['24 h', '0 h', '6 h', '72 h'])
  check('every level survives, whatever the order says',
    orderedBy(all, ['24 h', 'nonesuch']).slice().sort(), all.slice().sort())
  check('a repeated name does not duplicate the level',
    orderedBy(all, ['6 h', '6 h']), ['6 h', '0 h', '24 h', '72 h'])
}

console.log('\nMOVEITEM')
{
  const l = ['a', 'b', 'c', 'd']
  check('down one', moveItem(l, 0, 1), ['b', 'a', 'c', 'd'])
  check('up one', moveItem(l, 3, 2), ['a', 'b', 'd', 'c'])
  check('to the far end', moveItem(l, 0, 3), ['b', 'c', 'd', 'a'])
  check('a move to itself is the same array', moveItem(l, 2, 2) === l, true)
  check('off either end is the same array', moveItem(l, 0, -1) === l, true)
  check('and past the end too', moveItem(l, 0, 4) === l, true)
}

console.log('\nWITHCONDORDER CHANGES THE ORDER AND NOTHING ELSE')
{
  const src = demoSource('course')
  const file = src.d.conds
  check('the demo has the levels this test is written against', file.length > 2, true)

  const same = withCondOrder(src, [])
  check('no order hands back the identical Source', same === src, true)

  const flipped = [...file].reverse()
  const rev = withCondOrder(src, flipped)
  check('the groups come back in the order asked for', rev.d.conds, flipped)
  check('the original Source is untouched', src.d.conds, file)
  check('and its Dataset is untouched', src.d.conds === file, true)

  // The one that matters. Every accessor takes a group by NAME, so reordering
  // must not move a single cell into a different group.
  const sameCells = file.every(c => {
    const a = src.group(0, c)
    const b = rev.group(0, c)
    return a.length === b.length && a.every((v, i) => v === b[i])
  })
  check('every group holds exactly the cells it held', sameCells, true)

  const gene = src.genes[3]
  check('and therefore reports the same mean, level by level',
    file.map(c => src.mean(gene, 1, c)), file.map(c => rev.mean(gene, 1, c)))
  check('the cells themselves are the same objects', rev.d.cells === src.d.cells, true)
  check('so are the counts per group', rev.d.nPerCond, src.d.nPerCond)
  check('and the gene list', rev.genes === src.genes, true)

  // A pooled contrast is a SET of names, so it cannot be reordered out from
  // under a reader who has one selected.
  const pooled = [file[0], file[2]]
  const a = src.group(0, pooled), b = rev.group(0, pooled)
  check('a pooled selection is the same cells after reordering',
    a.length === b.length && a.every((v, i) => v === b[i]), true)
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll group-order tests passed')
process.exit(failed ? 1 : 0)
