// Enrichment and module-score regressions.
import { bh, hyperTail, runORA } from '../src/lib/ora.ts'
import { GENE_SETS, SET_SOURCES } from '../src/lib/genesets.ts'
import { moduleScore, summarise } from '../src/lib/score.ts'
import { GENES } from '../src/lib/demo.ts'
import { demoSource } from '../src/lib/source.ts'
import { deWilcox, thresholdFor, isSig } from '../src/lib/stats.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const near = (name, got, want, tol = 1e-6) => {
  const ok = Math.abs(got - want) < tol
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${got}\n        want ${want}`}`)
}

console.log('\nHYPERGEOMETRIC TAIL')
// Hand-checkable: P(X >= 1) drawing 1 from 2 with 1 success = 1/2.
near('P(X>=1 | k=1,K=1,n=1,N=2)', hyperTail(1, 1, 1, 2), 0.5)
near('the whole tail is 1', hyperTail(0, 5, 5, 10), 1)
near('impossible overlap is 0', hyperTail(6, 5, 5, 10), 0)
// Reference values computed by exact BigInt binomials, not from memory —
// the first draft of this test asserted 0.31828 and the code was right.
near('P(X>=3 | K=10,n=20,N=100)', hyperTail(3, 10, 20, 100), 0.3187799361823111, 1e-9)
near('P(X>=2 | K=5,n=8,N=20)', hyperTail(2, 5, 8, 20), 0.6934984520123839, 1e-9)
// A set that is the entire background can never be enriched.
near('universal set gives p = 1', hyperTail(10, 100, 10, 100), 1)

console.log('\nBENJAMINI–HOCHBERG')
check('order is preserved', bh([0.01, 0.5, 0.03]).length, 3)
near('smallest p, m=3', bh([0.01, 0.5, 0.03])[0], 0.03)
near('largest p is capped at 1', bh([0.01, 0.5, 0.03])[1], 0.5)
check('monotone after sorting', (() => {
  const ps = [0.001, 0.02, 0.03, 0.4, 0.9]
  const a = bh(ps)
  const bySize = ps.map((p, i) => [p, a[i]]).sort((x, y) => x[0] - y[0]).map(x => x[1])
  return bySize.every((v, i) => i === 0 || bySize[i - 1] <= v + 1e-12)
})(), true)
check('nothing exceeds 1', bh([0.9, 0.95, 0.99]).every(v => v <= 1), true)

console.log('\nOVER-REPRESENTATION')
{
  const bg = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  const sets = [
    { source: 'T', id: 'hit', name: 'hit', genes: ['A', 'B', 'C'] },
    { source: 'T', id: 'miss', name: 'miss', genes: ['H', 'I', 'J'] },
  ]
  const res = runORA(['A', 'B', 'C'], sets, bg, { minSize: 1, maxSize: 100 })
  check('the overlapping set ranks first', res[0].id, 'hit')
  check('overlap is reported', res[0].overlap, ['A', 'B', 'C'])
  near('fold enrichment', res[0].foldEnrichment, (3 / 3) / (3 / 10))
  check('a set with no overlap is dropped', res.some(r => r.id === 'miss'), false)
}
check('matching is case-insensitive',
  runORA(['ascl1'], [{ source: 'T', id: 'x', name: 'x', genes: ['ASCL1', 'Egfr', 'Sox2'] }],
    ['Ascl1', 'Egfr', 'Sox2', 'Gfap'], { minSize: 1, maxSize: 99 })[0].count, 1)
check('genes outside the background never inflate K',
  runORA(['Ascl1'], [{ source: 'T', id: 'x', name: 'x', genes: ['Ascl1', 'NotMeasured1', 'NotMeasured2'] }],
    ['Ascl1', 'Egfr', 'Sox2'], { minSize: 1, maxSize: 99 })[0].setSize, 1)
check('an empty query yields nothing', runORA([], GENE_SETS, GENES), [])
check('size filters are applied',
  runORA(['Ascl1', 'Egfr'], GENE_SETS, GENES, { minSize: 999, maxSize: 1000 }), [])
check('source filter is honoured', (() => {
  const only = new Set(['KEGG'])
  return runORA(GENES, GENE_SETS, GENES, { minSize: 1, maxSize: 999, sources: only })
    .every(r => r.source === 'KEGG')
})(), true)

console.log('\nTHE COLLECTION')
check('every set has a source, id, name and genes',
  GENE_SETS.every(s => s.source && s.id && s.name && s.genes.length >= 3), true)
check('ids are unique', new Set(GENE_SETS.map(s => s.id)).size, GENE_SETS.length)
check('no set has duplicate genes',
  GENE_SETS.every(s => new Set(s.genes).size === s.genes.length), true)
check('every set overlaps the demo object',
  GENE_SETS.filter(s => s.genes.some(g => GENES.includes(g))).length, GENE_SETS.length)
check('sources are enumerated', SET_SOURCES.length >= 3, true)

console.log('\nENRICHMENT ON A REAL CONTRAST')
{
  const src = demoSource('cohort')
  const ti = src.clusters.indexOf('qNSC')
  const th = thresholdFor('wilcox')
  const up = deWilcox(src, ti, 'Quiescent', 'Reactivated').rows
    .filter(r => isSig(r, th) && r.lfc > 0).map(r => r.gene)
  const res = runORA(up, GENE_SETS, GENES, { minSize: 3, maxSize: 500 })
  check('genes up on reactivation enrich a proliferation set',
    res.slice(0, 4).some(r => /E2F|DNA replication|G2\/M|Activated NSC/i.test(r.name)), true)
  check('and not the quiescence signature at the top',
    /Quiescent NSC/i.test(res[0]?.name ?? ''), false)
}

console.log('\nMODULE SCORE')
{
  const src = demoSource('cohort')
  const set = GENE_SETS.find(s => s.id === 'ACTIVE_NSC')
  const sc = moduleScore(src, set.genes)
  check('one score per cell', sc.scores.length, src.d.nCells)
  check('genes outside the object are reported, not dropped silently',
    sc.missing.every(g => !GENES.includes(g)), true)
  check('used genes are all measured', sc.used.every(g => GENES.includes(g)), true)
  check('controls exclude the set itself', sc.control.every(g => !sc.used.includes(g)), true)
  check('scores are finite', Array.from(sc.scores).every(Number.isFinite), true)

  // The whole point of the control subtraction: an activation signature must
  // score higher in activated NSCs than in an unrelated lineage.
  const idxOf = (name, cond) => {
    const t = src.clusters.indexOf(name)
    const out = []
    src.d.cells.forEach((c, i) => { if (c.t === t && (!cond || c.cond === cond)) out.push(i) })
    return out
  }
  const aNSC = summarise(sc.scores, idxOf('aNSC')).med
  const oligo = summarise(sc.scores, idxOf('Oligodendrocyte')).med
  check('activation signature is higher in aNSC than oligodendrocytes', aNSC > oligo, true)
  check('and it is positive there', aNSC > 0, true)

  const quiescence = moduleScore(src, GENE_SETS.find(s => s.id === 'QUIESCENT_NSC').genes)
  check('quiescence signature is higher in qNSC than in TAP',
    summarise(quiescence.scores, idxOf('qNSC')).med > summarise(quiescence.scores, idxOf('TAP')).med, true)
  check('and it falls on reactivation',
    summarise(quiescence.scores, idxOf('qNSC', 'Quiescent')).med >
    summarise(quiescence.scores, idxOf('qNSC', 'Reactivated')).med, true)

  check('an empty set scores zero everywhere',
    Array.from(moduleScore(src, []).scores).every(v => v === 0), true)
  check('an all-unknown set is reported as missing',
    moduleScore(src, ['Nope1', 'Nope2']).missing, ['Nope1', 'Nope2'])
  check('scoring is deterministic',
    moduleScore(src, set.genes).scores[0], sc.scores[0])
}

console.log('\nSUMMARIES')
check('an empty selection summarises to zeros', summarise(new Float32Array([1, 2, 3]), []).n, 0)
near('median of a known vector', summarise(new Float32Array([1, 2, 3, 4, 5]), [0, 1, 2, 3, 4]).med, 3)

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll gene-set tests passed\n')
process.exit(failed ? 1 : 0)
