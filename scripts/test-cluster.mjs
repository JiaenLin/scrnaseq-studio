// Hierarchical clustering, checked against answers worked out by hand.
//
// The reason this file exists rather than "it looks clustered": average linkage
// has one detail that is easy to get wrong and invisible in the output — the
// merged node's distance is the SIZE-WEIGHTED mean of its children's, which is
// what makes it UPGMA rather than WPGMA. Both produce a plausible-looking
// dendrogram. Only one of them is what pheatmap draws.

import {
  correlationDistance, dendroLines, euclideanDistance, hclust, orderRows,
} from '../src/lib/cluster.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const near = (name, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) <= tol
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${got}\n        want ${want} ± ${tol}`))
}

console.log('\nDISTANCE')
{
  // Perfectly correlated rows are at distance 0 however different their scale —
  // which is the whole reason this figure uses correlation and not Euclidean.
  const d = correlationDistance([[1, 2, 3], [2, 4, 6], [3, 2, 1]])
  near('a row and twice that row are the same profile', d[0][1], 0, 1e-12)
  near('and the reverse profile is as far as it gets', d[0][2], 2, 1e-12)
  near('the matrix is symmetric', d[1][0], d[0][1], 0)
  near('and zero down the diagonal', d[0][0], 0)

  // A flat row correlates with nothing; it must not land beside an arbitrary
  // neighbour just because 0/0 came out as some number.
  const f = correlationDistance([[1, 2, 3], [5, 5, 5]])
  near('a row with no variance is maximally distant', f[0][1], 2, 0)
  check('and that is a number, not NaN', Number.isFinite(f[0][1]), true)

  const e = euclideanDistance([[0, 0], [3, 4]])
  near('euclidean is euclidean', e[0][1], 5, 1e-12)
}

console.log('\nAVERAGE LINKAGE, BY HAND')
{
  /**
   * Four points on a line at 0, 1, 4, 6. Worked through:
   *
   *   d(0,1)=1  d(0,4)=4  d(0,6)=6  d(1,4)=3  d(1,6)=5  d(4,6)=2
   *   closest is (0,1) at 1        -> node A, leaves {0,1}, size 2
   *   d(A,4) = (4+3)/2 = 3.5,  d(A,6) = (6+5)/2 = 5.5
   *   closest is (4,6) at 2        -> node B, leaves {4,6}, size 2
   *   d(A,B) = (2*3.5 + 2*5.5)/4 = 4.5   <- the size weighting, checked
   */
  const pts = [[0], [1], [4], [6]]
  const t = hclust(euclideanDistance(pts))
  check('three merges for four leaves', t.merges.length, 3)
  near('the first merge is the closest pair', t.merges[0].height, 1, 1e-12)
  near('then the next closest', t.merges[1].height, 2, 1e-12)
  near('and the root is the weighted mean, 4.5', t.merges[2].height, 4.5, 1e-12)
  near('the tree height is the root', t.height, 4.5, 1e-12)
  check('every leaf appears exactly once', [...t.order].sort((a, b) => a - b), [0, 1, 2, 3])
  // 0 and 1 are adjacent, and so are 2 and 3 — the ordering is what the figure
  // uses, so adjacency of the merged pairs is the property that matters.
  const at = i => t.order.indexOf(i)
  check('the first pair ends up adjacent', Math.abs(at(0) - at(1)), 1)
  check('and so does the second', Math.abs(at(2) - at(3)), 1)
}

console.log('\nWEIGHTED, NOT UNWEIGHTED')
{
  // Three points where WPGMA and UPGMA disagree: merge a pair, then a single.
  //   0,1 at distance 1; 2 far away.
  //   UPGMA: d({0,1},2) = (d(0,2)+d(1,2))/2
  // With d(0,2)=10 and d(1,2)=20 that is 15 either way for a 2+1 merge, so the
  // discriminating case needs unequal sizes — four leaves, 3 against 1.
  const d = [
    [0, 1, 1, 10],
    [1, 0, 1, 20],
    [1, 1, 0, 30],
    [10, 20, 30, 0],
  ]
  const t = hclust(d)
  // {0,1} merges at 1, then {0,1}+2 at (1+1)/2 = 1, then that triple against 3:
  // UPGMA = (10 + 20 + 30)/3 = 20. WPGMA would give ((10+20)/2 + 30)/2 = 22.5.
  near('the root is the mean over LEAVES, not over branches',
    t.merges[t.merges.length - 1].height, 20, 1e-12)
}

console.log('\nEDGES')
{
  check('nothing to cluster', hclust([]).order, [])
  check('one row is its own order', hclust([[0]]).order, [0])
  check('two rows still merge', hclust([[0, 5], [5, 0]]).merges.length, 1)
  check('orderRows declines below three rows', orderRows([[1], [2]]), null)
  check('and takes over at three', orderRows([[1, 2], [2, 1], [5, 5]]) !== null, true)

  // Identical rows: every distance is 0, and it must still return every leaf
  // rather than looping or dropping one.
  const same = hclust(euclideanDistance([[1, 1], [1, 1], [1, 1], [1, 1]]))
  check('four identical rows still yield four leaves', same.order.length, 4)
  check('with no duplicates', new Set(same.order).size, 4)
}

console.log('\nDRAWING')
{
  const t = hclust(euclideanDistance([[0], [1], [4], [6]]))
  const lines = dendroLines(t, 400, 40)
  check('three segments per merge', lines.length, t.merges.length * 3)
  check('every coordinate is finite',
    lines.every(l => [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite)), true)
  check('nothing is drawn deeper than the box',
    lines.every(l => l.y1 <= 40.0001 && l.y2 <= 40.0001), true)
  check('nor outside its span',
    lines.every(l => l.x1 >= 0 && l.x2 <= 400), true)
  // The root crossbar sits at the full depth, which is what makes the scale
  // readable: the deepest join touches the edge of the band it is drawn in.
  near('the root reaches the full depth',
    Math.max(...lines.map(l => Math.max(l.y1, l.y2))), 40, 1e-9)
  check('a single leaf draws nothing', dendroLines(hclust([[0]]), 100, 10), [])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll clustering tests passed\n')
process.exit(failed ? 1 : 0)
