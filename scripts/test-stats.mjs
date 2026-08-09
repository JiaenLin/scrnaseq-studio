// Statistics regressions. These encode the decisions that are easy to undo by
// accident: which test is offered when, which cutoff each is judged at, and
// whether the sparse rank-sum agrees with a straightforward dense one.
import { demoSource } from '../src/lib/source.ts'
import {
  combinedScore, deMarkers, deMarkersAll, deWilcox, designFor, isSig, LFC_GATE,
  logNormalTail, markersPlan, MIN_REPS_PB, minReplicates, nlpFromZ, normalTail, pbKey,
  rankSumSparse, sigCount, thresholdFor,
} from '../src/lib/stats.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const near = (name, got, want, tol) => {
  const ok = Math.abs(got - want) < tol
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${got}\n        want ${want}`}`)
}

const cohort = demoSource('cohort')
const course = demoSource('course')
const wt = demoSource('wt')
const ti = (src, name) => src.clusters.indexOf(name)

console.log('\nTHRESHOLDS ARE PER METHOD')
// |log2FC| > 1 is a bulk convention. Log-normalized single-cell values are
// compressed, so applying it to the per-cell test throws away almost everything.
check('wilcoxon uses Seurat logfc.threshold', thresholdFor('wilcox').lfc, LFC_GATE)
check('pseudobulk uses the bulk cutoff', thresholdFor('pseudobulk').lfc, 1)
check('isSig respects the method', [
  isSig({ padj: 0.01, lfc: 0.4 }, thresholdFor('wilcox')),
  isSig({ padj: 0.01, lfc: 0.4 }, thresholdFor('pseudobulk')),
], [true, false])

console.log('\nTHE NORMAL TAIL IS ACCURATE WHERE IT IS SMALL')
// The reference column is scipy's norm.sf / log_ndtr, printed to 17 figures.
// What is being defended is RELATIVE accuracy: the previous approximation was
// accurate to 7.5e-8 ABSOLUTE, which past z = 6 is no accuracy at all — it was
// out by 2 % at z = 6-10 and 16 % at z = 30-38, so every small p in the atlas
// was wrong in its second figure.
{
  const TAIL = [
    [0.5, 3.08537538725986882e-01], [1, 1.58655253931457074e-01],
    [2, 2.27501319481791947e-02], [3, 1.34989803163009328e-03],
    [5, 2.86651571879193277e-07], [8, 6.22096057427174049e-16],
    [12, 1.77648211207765304e-33], [20, 2.75362411860615560e-89],
    [30, 4.90671392714790795e-198], [37, 5.72557122252392658e-300],
  ]
  let worst = 0
  for (const [z, want] of TAIL) worst = Math.max(worst, Math.abs(normalTail(z) - want) / want)
  check(`the tail is within 1e-12 relative out to z = 37 (worst ${worst.toExponential(1)})`,
    worst < 1e-12, true)

  const LOG = [
    [1, -1.84102164500926335e+00], [5, -1.50649983939887271e+01],
    [20, -2.03917155371097294e+02], [38.5, -7.45695270290411258e+02],
    [50, -1.25483136113941987e+03], [80, -3.20530112135689069e+03],
    [120, -7.20570649970837985e+03], [150, -1.12559296182668077e+04],
  ]
  let worstLog = 0
  for (const [z, want] of LOG) worstLog = Math.max(worstLog, Math.abs(logNormalTail(z) - want))
  check(`the log tail is within 1e-11 absolute out to z = 150 (worst ${worstLog.toExponential(1)})`,
    worstLog < 1e-11, true)

  // The point of carrying the log at all: past here the tail is not a double.
  check('the tail floors where the double runs out, the log does not',
    [normalTail(60) === Number.MIN_VALUE, logNormalTail(60) < -1800], [true, true])
  check('and the log still separates two rows the floor cannot',
    logNormalTail(60) < logNormalTail(50), true)

  // Monotone, so nothing downstream can be reordered by the tail itself.
  let mono = true
  for (let z = 0.1; z < 60; z += 0.05) {
    if (normalTail(z + 0.05) > normalTail(z) || logNormalTail(z + 0.05) > logNormalTail(z)) mono = false
  }
  check('both are non-increasing in z', mono, true)
}

console.log('\nTHE RANK-SUM AGREES WITH A DENSE REFERENCE')
// The shipped test skips every zero and treats them as one tie block. This is
// the same computation written the obvious way, over every value.
function denseRankSum(a, b) {
  const all = [...a.map(x => [x, 0]), ...b.map(x => [x, 1])].sort((p, q) => p[0] - q[0])
  const n1 = a.length
  const n2 = b.length
  const n = n1 + n2
  let r1 = 0
  let tie = 0
  let i = 0
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++
    const size = j - i + 1
    const rank = i + 1 + (size - 1) / 2
    for (let k = i; k <= j; k++) if (all[k][1] === 0) r1 += rank
    if (size > 1) tie += size ** 3 - size
    i = j + 1
  }
  const u = r1 - (n1 * (n1 + 1)) / 2
  const varU = ((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1)))
  if (varU <= 0) return 1
  return Math.min(1, 2 * normalTail((Math.abs(u - (n1 * n2) / 2) - 0.5) / Math.sqrt(varU)))
}
const sparseOf = (a, b) => {
  const xs = []
  const gs = []
  let z1 = 0
  let z2 = 0
  for (const x of a) { if (x > 0) { xs.push(x); gs.push(0) } else z1++ }
  for (const x of b) { if (x > 0) { xs.push(x); gs.push(1) } else z2++ }
  return rankSumSparse(xs, gs, z1, z2)
}
{
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (const trial of [0, 1, 2, 3, 4]) {
    const mk = (n, p, scale) =>
      Array.from({ length: n }, () => (rnd() < p ? +(rnd() * scale).toFixed(3) : 0))
    const a = mk(120, 0.3 + trial * 0.1, 3)
    const b = mk(90, 0.25, 2)
    near(`trial ${trial}: sparse == dense`, sparseOf(a, b), denseRankSum(a, b), 1e-9)
  }
  check('all zeros is not significant', sparseOf([0, 0, 0], [0, 0, 0]), 1)
  check('an empty side returns 1', sparseOf([], [1, 2, 3]), 1)
  near('a clean separation is significant',
    sparseOf(Array(40).fill(5), Array(40).fill(0)), 0, 1e-6)
}

console.log('\nTHE MARKER SORT ORDERS NEGATIVE VALUES')
// The marker pass sorts on the IEEE754 total-order key rather than by
// comparator, and the negative half of that transform is the half no real object
// reaches: log-normalized expression is never below zero, so on the atlas the
// branch is dead. It is exercised here instead, against the same dense reference
// the sparse test is held to.
//
// Every cell carries a stored value, so there is no implicit zero block and the
// ranks come from nothing but the sort. The values are exact in float32 — the
// key is built from the float32 bits, and every Source walks a Float32Array, so
// this is the precision the sort actually sees.
{
  const a = [2.5, -0.75, 3.25, -0.75, 0.5, 4, -2.5, 1.25, 2.5, -0.25]
  const b = [-1.5, 0.25, -0.75, 1.75, -3.5, 0.5, -0.25, -1.25, 2.5, -0.5]
  const owner = Int32Array.from([...a.map(() => 0), ...b.map(() => 1)])
  const all = [...a, ...b]
  const plan = markersPlan({
    owner, size: Int32Array.from([a.length, b.length]), nUsed: all.length, nGenes: 1,
  })
  plan.visit(0, cb => { all.forEach((v, i) => cb(i, v)) })
  const [ra, rb] = plan.done()
  near('cluster A against the rest matches a dense rank-sum',
    ra.rows[0].p, denseRankSum(a, b), 1e-12)
  near('cluster B against the rest matches a dense rank-sum',
    rb.rows[0].p, denseRankSum(b, a), 1e-12)
  // Ties that straddle zero, and a value on each side of it, are the cases where
  // a sign-blind key would put the order back to front.
  check('both sides reported a row', [ra.rows.length, rb.rows.length], [1, 1])
  check('the two sides are opposite in sign', ra.rows[0].lfc * rb.rows[0].lfc < 0, true)
}

console.log('\nWILCOXON NEEDS NO REPLICATES')
check('one sample per group still returns results',
  deWilcox(course, ti(course, 'aNSC'), '0 h', '72 h').rows.length > 0, true)
check('and counts cells, not samples',
  deWilcox(course, ti(course, 'aNSC'), '0 h', '72 h').n0 > 50, true)

console.log('\nDIRECTION AND ORDERING')
{
  // Tested inside aNSC, where Ascl1 is actually expressed. In qNSC the same
  // gene changes by the same factor but off a near-zero baseline, so on the
  // log-normalized scale it falls under the fold-change gate — which is the
  // gate doing its job, not a bug.
  const rows = deWilcox(cohort, ti(cohort, 'aNSC'), 'Quiescent', 'Reactivated').rows
  const byGene = Object.fromEntries(rows.map(r => [r.gene, r.lfc]))
  check('Ascl1 is higher in the reactivated arm', byGene.Ascl1 > 0, true)
  check('rows are sorted by adjusted p',
    rows.every((r, i) => i === 0 || rows[i - 1].padj <= r.padj), true)
  check('reversing the contrast flips every sign',
    deWilcox(cohort, ti(cohort, 'aNSC'), 'Reactivated', 'Quiescent').rows
      .find(r => r.gene === 'Ascl1').lfc < 0, true)
  check('pct.1 and pct.2 are fractions',
    rows.every(r => r.pct1 >= 0 && r.pct1 <= 1 && r.pct2 >= 0 && r.pct2 <= 1), true)

  const q = deWilcox(cohort, ti(cohort, 'qNSC'), 'Quiescent', 'Reactivated').rows
  const qGene = Object.fromEntries(q.map(r => [r.gene, r.lfc]))
  check('quiescence genes fall on reactivation', qGene.Id3 < 0 && qGene.Gfap < 0, true)
}

console.log('\nONE-VS-REST MARKERS FIND THE RIGHT CLUSTER')
// The only differential test a single-condition object has, so it has to work.
for (const [cluster, marker] of [['aNSC', 'Ascl1'], ['TAP', 'Mki67'], ['qNSC', 'Gfap'],
                                 ['Neuroblast', 'Dcx'], ['Oligodendrocyte', 'Plp1']]) {
  const t = ti(wt, cluster)
  const up = deMarkers(wt, t).rows.filter(r => isSig(r, thresholdFor('wilcox')) && r.lfc > 0)
  check(`${cluster} is marked by ${marker}`, up.slice(0, 8).some(r => r.gene === marker), true)
}

console.log('\nPSEUDOBULK IS GATED ABOVE THREE PER GROUP')
check('4 v 4 cohort qualifies',
  designFor(cohort, ti(cohort, 'qNSC'), 'Quiescent', 'Reactivated').pbOK, true)
check('1 v 1 time course does not',
  designFor(course, ti(course, 'aNSC'), '0 h', '72 h').pbOK, false)
check('a rare population does not, even in the cohort',
  designFor(cohort, ti(cohort, 'Pericyte'), 'Quiescent', 'Reactivated').pbOK, false)
check('same group on both sides is never testable',
  designFor(cohort, ti(cohort, 'qNSC'), 'Quiescent', 'Quiescent').pbOK, false)
check('MIN_REPS_PB means "> 3"', MIN_REPS_PB, 4)

console.log('\nDESIGN SHAPES')
check('cohort has 4 replicates', minReplicates(cohort), 4)
check('time course has 1', minReplicates(course), 1)
check('single-condition objects are flagged',
  [cohort.d.multi, course.d.multi, wt.d.multi], [true, true, false])
check('group order is the file order, never sorted',
  course.d.conds, ['0 h', '6 h', '24 h', '72 h'])

console.log('\nCOMBINED RANKING SCORE')
// The argument is -log10(adjusted p), not the p itself. It used to be the p, and
// these cases used to pass a p — which is why they went on passing after the
// units changed, asserting nothing about either version.
check('sign follows the fold change',
  [combinedScore(2, 10) > 0, combinedScore(-2, 10) < 0], [true, true])
check('a bigger effect at equal significance ranks higher',
  Math.abs(combinedScore(2, 10)) > Math.abs(combinedScore(1, 10)), true)
check('more significant at equal effect ranks higher',
  Math.abs(combinedScore(2, 400)) > Math.abs(combinedScore(2, 10)), true)
// The case that bites. Both of these rows have an adjusted p below the smallest
// double, so both report padj = 0 or its floor and -log10(padj) is one constant
// for the pair; scored off p they were indistinguishable, and the column fell
// back to being log2FC times 323. Scored off nlp the more significant one wins
// even though its fold change is smaller.
{
  const far = nlpFromZ(120)   // padj far past the floor
  const near = nlpFromZ(45)   // also past the floor, but not as far
  check('two rows past the p floor still order by significance',
    [near > 300 && far > 300, Math.abs(combinedScore(1.0, far)) > Math.abs(combinedScore(1.2, near))],
    [true, true])
  check('and the p they would have been scored off is the same floor for both',
    Math.min(1, 2 * normalTail(120)) === Math.min(1, 2 * normalTail(45)), true)
}
check('non-finite input returns null', combinedScore(NaN, 2), null)
check('sigCount respects the threshold',
  sigCount([{ padj: 0.01, lfc: 2 }, { padj: 0.5, lfc: 2 }], { padj: 0.05, lfc: 1 }), 1)

// Every cluster is tested in one pass over the genes now, sharing the sort and
// the tie correction. That is only sound if it gives the same answer as testing
// each cluster on its own — a 64-cluster object would never reveal a
// disagreement by eye, so it is asserted here, row for row.
console.log('\nALL CLUSTERS AT ONCE == ONE CLUSTER AT A TIME')
// The p-values, the detection rates and the gene order must be bit-identical.
// The fold change is a sum of the same numbers in a different order — the rest
// of the object is reached as "everything minus this cluster" instead of being
// added up again per cluster — so it agrees to about 1e-14 and no further. That
// is float addition not being associative, not a different statistic.
for (const [label, src] of [['cohort', cohort], ['course', course], ['wt', wt]]) {
  const all = deMarkersAll(src)
  let exact = true
  let worst = 0
  let n = 0
  src.types.forEach((_t, k) => {
    const one = deMarkers(src, k)
    n += one.rows.length
    if (one.rows.length !== all[k].rows.length) { exact = false; return }
    one.rows.forEach((r, i) => {
      const b = all[k].rows[i]
      if (r.gene !== b.gene || r.p !== b.p || r.padj !== b.padj
        || r.pct1 !== b.pct1 || r.pct2 !== b.pct2) exact = false
      worst = Math.max(worst, Math.abs(r.lfc - b.lfc) / Math.max(1e-9, Math.abs(r.lfc)))
    })
  })
  check(`${label}: same genes, same p, same rates across ${src.types.length} clusters (${n} rows)`,
    exact, true)
  check(`${label}: fold changes agree to 1e-11 (worst ${worst.toExponential(1)})`,
    worst < 1e-11, true)
  check(`${label}: group sizes add up to every cell`,
    all.map(r => r.n0 + r.n1), src.types.map(() => src.d.cells.length))
}

console.log('\nRENAMING NEVER ORPHANS A RESULT')
{
  const t = cohort.types[0]
  check('the key follows `key`, not `name`',
    pbKey({ ...t, name: 'Dormant NSC' }, 'Quiescent', 'Reactivated'),
    pbKey(t, 'Quiescent', 'Reactivated'))
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll statistics tests passed\n')
process.exit(failed ? 1 : 0)
