// Statistics regressions. These encode the decisions that are easy to undo by
// accident: which test is offered when, and which cutoff each one is judged at.
import { makeTypes, buildDataset } from '../src/lib/demo.ts'
import {
  combinedScore, deWilcox, dePseudobulk, designFor, isSig, MIN_REPS_PB,
  minReplicates, sigCount, thresholdFor, pbKey, LFC_GATE,
} from '../src/lib/stats.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const types = makeTypes()
const cohort = buildDataset('cohort', types)
const course = buildDataset('course', types)
const wt = buildDataset('wt', types)
const ti = (name) => types.findIndex(t => t.name === name)

console.log('\nTHRESHOLDS ARE PER METHOD')
// |log2FC| > 1 is a bulk convention. Log-normalized single-cell values are
// compressed, so applying it to the per-cell test throws away almost everything.
check('wilcoxon uses Seurat logfc.threshold', thresholdFor('wilcox').lfc, LFC_GATE)
check('pseudobulk uses the bulk cutoff', thresholdFor('pseudobulk').lfc, 1)
check('isSig respects the method', [
  isSig({ padj: 0.01, lfc: 0.4 }, thresholdFor('wilcox')),
  isSig({ padj: 0.01, lfc: 0.4 }, thresholdFor('pseudobulk')),
], [true, false])
check('a large padj never passes',
  isSig({ padj: 0.2, lfc: 3 }, thresholdFor('pseudobulk')), false)

console.log('\nWILCOXON NEEDS NO REPLICATES')
check('one sample per group still returns results',
  deWilcox(course, ti('aNSC'), '0 h', '72 h').rows.length > 0, true)
check('and counts cells, not samples',
  deWilcox(course, ti('aNSC'), '0 h', '72 h').n0 > 50, true)
check('a group with no cells of that type is reported as zero',
  deWilcox(wt, ti('aNSC'), 'Wild type', 'Wild type').n0 > 0, true)

console.log('\nPSEUDOBULK IS GATED ABOVE THREE PER GROUP')
check('4 v 4 cohort qualifies', designFor(cohort, ti('qNSC'), 'Quiescent', 'Reactivated').pbOK, true)
check('1 v 1 time course does not', designFor(course, ti('aNSC'), '0 h', '72 h').pbOK, false)
check('a rare population does not, even in the cohort',
  designFor(cohort, ti('Pericyte'), 'Quiescent', 'Reactivated').pbOK, false)
check('same group on both sides is never testable',
  designFor(cohort, ti('qNSC'), 'Quiescent', 'Quiescent').pbOK, false)
check('MIN_REPS_PB means "> 3"', MIN_REPS_PB, 4)

console.log('\nTHE TWO TESTS DISAGREE, AND THAT IS THE POINT')
{
  const w = sigCount(deWilcox(cohort, ti('qNSC'), 'Quiescent', 'Reactivated').rows, thresholdFor('wilcox'))
  const pb = sigCount(dePseudobulk(cohort, ti('qNSC'), 'Quiescent', 'Reactivated').rows, thresholdFor('pseudobulk'))
  check('per-cell testing reports more genes', w > pb, true)
  check('both report something', w > 0 && pb > 0, true)
}
{
  // Pseudobulk fold changes are on summed raw counts and are NOT compressed;
  // comparing the two lists on one scale is what produced a bogus "0" once.
  const w = deWilcox(cohort, ti('qNSC'), 'Quiescent', 'Reactivated').rows
  const pb = dePseudobulk(cohort, ti('qNSC'), 'Quiescent', 'Reactivated').rows
  const wMax = Math.max(...w.map(r => Math.abs(r.lfc)))
  const pMax = Math.max(...pb.map(r => Math.abs(r.lfc)))
  check('pseudobulk effect sizes are larger', pMax > wMax, true)
}

console.log('\nDIRECTION AND ORDERING')
{
  const rows = deWilcox(cohort, ti('qNSC'), 'Quiescent', 'Reactivated').rows
  const byGene = Object.fromEntries(rows.map(r => [r.gene, r.lfc]))
  check('Ascl1 is higher in the reactivated arm', byGene.Ascl1 > 0, true)
  check('Id3 is higher in the quiescent arm', byGene.Id3 < 0, true)
  check('rows are sorted by adjusted p',
    rows.every((r, i) => i === 0 || rows[i - 1].padj <= r.padj), true)
  check('reversing the contrast flips every sign',
    deWilcox(cohort, ti('qNSC'), 'Reactivated', 'Quiescent').rows
      .find(r => r.gene === 'Ascl1').lfc < 0, true)
}

console.log('\nDESIGN SHAPES')
check('cohort has 4 replicates', minReplicates(cohort), 4)
check('time course has 1', minReplicates(course), 1)
check('wild type has 1', minReplicates(wt), 1)
check('single-condition objects are flagged', [cohort.multi, course.multi, wt.multi], [true, true, false])
check('group order is the file order, never sorted', course.conds, ['0 h', '6 h', '24 h', '72 h'])

console.log('\nCOMBINED RANKING SCORE')
// Sorting by p alone promotes tiny significant changes; by fold change alone,
// noise. The product keeps both, and its sign keeps the direction.
check('sign follows the fold change',
  [combinedScore(2, 1e-10) > 0, combinedScore(-2, 1e-10) < 0], [true, true])
check('a bigger effect at equal p ranks higher',
  Math.abs(combinedScore(2, 1e-10)) > Math.abs(combinedScore(1, 1e-10)), true)
check('a smaller p at equal effect ranks higher',
  Math.abs(combinedScore(1, 1e-20)) > Math.abs(combinedScore(1, 1e-2)), true)
check('p = 0 is clamped rather than infinite', Number.isFinite(combinedScore(1, 0)), true)
check('non-finite input returns null', combinedScore(NaN, 0.01), null)
{
  // The ordering property the DEG table's Combined column relies on.
  const order = [
    ['tiny-but-sig', 0.3, 1e-40],
    ['big-and-sig', 3.0, 1e-20],
    ['big-but-weak', 3.0, 0.04],
  ].map(([g, lfc, pv]) => [g, Math.abs(combinedScore(lfc, pv))])
    .sort((a, b) => b[1] - a[1])
    .map(x => x[0])
  check('ranks a large significant change first', order[0], 'big-and-sig')
  check('and a large but weak one last', order[2], 'big-but-weak')
}

console.log('\nRENAMING NEVER ORPHANS A RESULT')
{
  const before = pbKey(types[0], 'Quiescent', 'Reactivated')
  const renamed = { ...types[0], name: 'Dormant NSC' }
  check('the key follows `key`, not `name`', pbKey(renamed, 'Quiescent', 'Reactivated'), before)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll statistics tests passed\n')
process.exit(failed ? 1 : 0)
