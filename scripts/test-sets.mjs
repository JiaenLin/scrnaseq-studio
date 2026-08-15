// Enrichment and module-score regressions.
import { bh, hyperTail, runORA } from '../src/lib/ora.ts'
import { indexFor, parse } from '../src/lib/msigdb.ts'
import { oraIndexed } from '../src/lib/ora.ts'
import { detectSpecies, matchRate } from '../src/lib/species.ts'
import { gunzipSync } from 'fflate'
import { readFileSync } from 'node:fs'

// The real library, off disk. These are the assets the app ships, so a broken
// generator or a corrupted file fails here rather than in a browser.
const collection = f =>
  parse(new TextDecoder().decode(gunzipSync(readFileSync(`public/genesets/${f}`))))
const MOUSE = ['mouse.hallmark.gs', 'mouse.go-bp.gs', 'mouse.reactome.gs'].map(collection)
// The GeneSetDef[] shape runORA takes, from the same collections, so the two
// implementations can be held to the same answer.
const DEFS = MOUSE.flatMap(c => c.sets.map(s => ({
  source: c.source, id: s.id, name: s.name,
  genes: Array.from(s.genes, i => c.symbols[i]),
})))
import {
  geneAveragesSync, moduleScore, resolve, SCORE_DEFAULTS, scoreAccumPlan, scorePlan, summarise,
} from '../src/lib/score.ts'
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
  // N is the ANNOTATED background, so it is six here and not ten: D through G
  // are in the background but in no set, and a gene no set contains can never
  // be drawn into one. This expectation used to read (3/3)/(3/10) = 3.33, which
  // is the whole-background rule; rnaseq-studio has always used the annotated
  // one and calls it that on screen, so the two studios now agree.
  check('the annotated background excludes genes no set contains', res[0].setSize, 3)
  near('fold enrichment', res[0].foldEnrichment, (3 / 3) / (3 / 6))
  check('a set with no overlap is dropped', res.some(r => r.id === 'miss'), false)
}
check('matching is case-insensitive',
  runORA(['ascl1'], [{ source: 'T', id: 'x', name: 'x', genes: ['ASCL1', 'Egfr', 'Sox2'] }],
    ['Ascl1', 'Egfr', 'Sox2', 'Gfap'], { minSize: 1, maxSize: 99 })[0].count, 1)
check('genes outside the background never inflate K',
  runORA(['Ascl1'], [{ source: 'T', id: 'x', name: 'x', genes: ['Ascl1', 'NotMeasured1', 'NotMeasured2'] }],
    ['Ascl1', 'Egfr', 'Sox2'], { minSize: 1, maxSize: 99 })[0].setSize, 1)
check('an empty query yields nothing', runORA([], DEFS, GENES), [])
check('size filters are applied',
  runORA(['Ascl1', 'Egfr'], DEFS, GENES, { minSize: 9999, maxSize: 10000 }), [])
check('source filter is honoured', (() => {
  const only = new Set(['Hallmark'])
  return runORA(GENES, DEFS, GENES, { minSize: 1, maxSize: 999, sources: only })
    .every(r => r.source === 'Hallmark')
})(), true)

console.log('\nTHE MSIGDB ASSETS')
check('the mouse hallmark collection is the size MSigDB publishes',
  MOUSE[0].sets.length, 50)
check('symbols are native mouse casing, not human',
  MOUSE[0].symbols.some(g => /^[A-Z][a-z]/.test(g)) && !MOUSE[0].symbols.includes('GFAP'), true)
check('every set has an id, a readable name and members',
  MOUSE.every(c => c.sets.every(s => s.id && s.name && s.genes.length > 0)), true)
check('the readable name drops the systematic prefix',
  MOUSE[0].sets.find(s => s.id === 'HALLMARK_ADIPOGENESIS')?.name, 'Adipogenesis')
check('ids are unique within a collection',
  MOUSE.every(c => new Set(c.sets.map(s => s.id)).size === c.sets.length), true)
check('member indices are all in range',
  MOUSE.every(c => c.sets.every(s =>
    s.genes.every(i => i >= 0 && i < c.symbols.length))), true)

console.log('\nTHE BACKGROUND-FOLDED INDEX')
{
  const idx = indexFor(MOUSE, GENES)
  check('N is the ANNOTATED background, not every gene tested',
    idx.N === idx.symbols.length && idx.N <= GENES.length, true)
  check('and it is smaller than the object, because not every gene is annotated',
    idx.N < GENES.length, true)
  check('every surviving set has at least one member in the background',
    idx.sets.every(s => s.K >= 1), true)
  check('K never exceeds the set as MSigDB published it', (() => {
    const size = new Map()
    for (const c of MOUSE) for (const s of c.sets) size.set(s.id, s.genes.length)
    return idx.sets.every(s => s.K <= size.get(s.id))
  })(), true)
  check('bySymbol is the inverse of the members lists', (() => {
    for (let i = 0; i < idx.sets.length; i += 97) {
      for (const m of idx.sets[i].members) if (!idx.bySymbol[m].includes(i)) return false
    }
    return true
  })(), true)
}

console.log('\nORA: THE INDEXED PATH MUST EQUAL THE REFERENCE')
{
  // An optimisation that quietly changes a p-value is a worse bug than a slow
  // page, so the fast path is held to the slow one on every shape of input the
  // app can produce.
  const idx = indexFor(MOUSE, GENES)
  const key = r => [r.id, r.setSize, r.count, r.pvalue, r.padj, r.foldEnrichment,
    r.overlap.join(' ')].join('|')
  const same = (q, opts) => {
    const a = runORA(q, DEFS, GENES, opts).map(key)
    const b = oraIndexed(q, idx, opts).map(key)
    return a.length === b.length && a.every((x, i) => x === b[i])
  }
  check('half the demo genes', same(GENES.slice(0, 36), { minSize: 3, maxSize: 500 }), true)
  check('a single gene', same([GENES[0]], { minSize: 1, maxSize: 500 }), true)
  check('every gene', same(GENES, { minSize: 2, maxSize: 2000 }), true)
  check('a lower-cased query', same(GENES.slice(0, 36).map(g => g.toLowerCase()),
    { minSize: 3, maxSize: 500 }), true)
  check('one source only', same(GENES.slice(0, 36),
    { minSize: 3, maxSize: 500, sources: new Set(['Hallmark']) }), true)
  check('a gene the object never measured', same(['NOTAGENE', 'Gfap'],
    { minSize: 1, maxSize: 500 }), true)
  check('an empty query', oraIndexed([], idx, { minSize: 1, maxSize: 500 }), [])
}

console.log('\nSPECIES DETECTION')
check('mouse symbols read as mouse', detectSpecies(GENES).species, 'mouse')
check('human symbols read as human',
  detectSpecies(['GFAP', 'MKI67', 'ASCL1', 'SOX2', 'TP53', 'ACTB']).species, 'human')
check('ENSMUSG accessions settle it regardless of the symbols',
  detectSpecies(['x'], Array.from({ length: 40 }, (_, i) =>
    `ENSMUSG${String(i).padStart(11, '0')}`)).species, 'mouse')
check('ENSG accessions settle it too',
  detectSpecies(['x'], Array.from({ length: 40 }, (_, i) =>
    `ENSG${String(i).padStart(11, '0')}`)).species, 'human')
check('an accession call says so', detectSpecies(['x'], Array.from({ length: 40 }, (_, i) =>
  `ENSG${String(i).padStart(11, '0')}`)).from, 'accession')
check('nothing to read falls back rather than throwing',
  detectSpecies(['1', '2', '3']).from, 'default')
// The measurement, not the convention: this is what the interface reports, and
// it only means anything case-sensitively. Compared case-insensitively a mouse
// object matches the human library at 96% and the check would be a reassurance.
check('a mouse object matches the mouse library',
  matchRate(GENES, MOUSE[1].symbols) > 0.9, true)
check('and not the human one', (() => {
  const human = collection('human.go-bp.gs')
  return matchRate(GENES, human.symbols) < 0.05
})(), true)

console.log('\nENRICHMENT ON A REAL CONTRAST')
{
  const src = demoSource('cohort')
  const ti = src.clusters.indexOf('qNSC')
  const th = thresholdFor('wilcox')
  const up = deWilcox(src, ti, 'Quiescent', 'Reactivated').rows
    .filter(r => isSig(r, th) && r.lfc > 0).map(r => r.gene)
  const res = oraIndexed(up, indexFor(MOUSE, GENES), { minSize: 3, maxSize: 500 })
  // Against real MSigDB rather than eighteen sets chosen so this would pass:
  // the TOP of the list has to be about division, and it is not enough for
  // something proliferative to turn up somewhere in a thousand results.
  check('genes up on reactivation enrich cell-cycle biology at the top',
    res.slice(0, 10).some(r =>
      /cell cycle|mitotic|division|dna replication|e2f|chromosom/i.test(r.name)), true)
  check('the leading p-value is small before correction', res[0].pvalue < 0.05, true)
  // And nothing survives BH, which is the honest outcome and worth pinning: the
  // demo object measures 72 genes, the contrast leaves six significant, and six
  // genes against 430 testable sets cannot clear a correction. The toy
  // collection this replaced had eighteen sets and so always produced a
  // "significant" pathway — that was the collection flattering the data.
  check('and nothing clears BH on a 72-gene demo, correctly',
    res.every(r => r.padj > 0.05), true)
  check('every result carries the members it was scored on',
    res.every(r => r.overlap.length === r.count), true)
}

console.log('\nTHE ORA BACKGROUND IS NOT THE FILTERED LIST')
{
  // The bug this pins: Enrichment used to build its background from the rows
  // deWilcox returns, on the reasoning that a gene which never got a p-value
  // was never in the population the list was drawn from. The reasoning is
  // right; the mapping was wrong. deWilcox drops a gene BEFORE testing it
  // whenever |log2FC| < LFC_GATE, so its rows are the genes that already passed
  // an effect-size gate — and the query is the significant subset of those.
  //
  // The result is arithmetic, not biology: n/N approaches 1, every set's k/n
  // matches its K/N, every fold enrichment is 1 and no p can be small. A user
  // reported 324 changed genes and zero enriched sets against a background of
  // 328. On this demo it is starker: every returned row is significant.
  const src = demoSource('cohort')
  const ti = src.clusters.indexOf('qNSC')
  const th = thresholdFor('wilcox')
  const de = deWilcox(src, ti, 'Quiescent', 'Reactivated')
  const sig = de.rows.filter(r => isSig(r, th)).map(r => r.gene)

  check('deWilcox returns fewer rows than the object measures',
    de.rows.length < src.genes.length, true)
  check('and nearly all of them are significant, which is the trap',
    sig.length / de.rows.length > 0.9, true)

  const filtered = indexFor(MOUSE, de.rows.map(r => r.gene))
  const measured = indexFor(MOUSE, src.genes)
  check('the filtered background is far smaller than the measured one',
    filtered.N < measured.N / 2, true)

  const bad = oraIndexed(sig, filtered, { minSize: 3, maxSize: 500 })
  const good = oraIndexed(sig, measured, { minSize: 3, maxSize: 500 })
  // Every fold enrichment collapses to 1 when the background is the filtered
  // list, because the query IS the background.
  check('against the filtered background every fold enrichment is 1',
    bad.length === 0 || bad.every(r => Math.abs(r.foldEnrichment - 1) < 1e-9), true)
  check('against the measured background they are not',
    good.some(r => r.foldEnrichment > 1.5), true)
  check('and the measured background returns more sets to look at',
    good.length > bad.length, true)
}

console.log('\nMODULE SCORE')
{
  const src = demoSource('cohort')
  // A real MSigDB set that the demo's 72 genes actually cover: 18 of the 880
  // members of GO's mitotic cell cycle are measured here.
  const set = DEFS.find(s => s.id === 'GOBP_MITOTIC_CELL_CYCLE')
  const sc = moduleScore(src, set.genes)
  check('one score per cell', sc.scores.length, src.d.nCells)
  check('genes outside the object are reported, not dropped silently',
    sc.missing.every(g => !GENES.includes(g)), true)
  check('used genes are all measured', sc.used.every(g => GENES.includes(g)), true)
  check('controls exclude the set itself', sc.control.every(g => !sc.used.includes(g)), true)
  check('scores are finite', Array.from(sc.scores).every(Number.isFinite), true)

  // The whole point of the control subtraction: a cell-cycle signature must
  // separate the dividing populations from the post-mitotic ones, and it must
  // do it with a real set rather than one written to make this pass.
  const idxOf = (name, cond) => {
    const t = src.clusters.indexOf(name)
    const out = []
    src.d.cells.forEach((c, i) => { if (c.t === t && (!cond || c.cond === cond)) out.push(i) })
    return out
  }
  const med = (name, cond) => summarise(sc.scores, idxOf(name, cond)).med
  const dividing = Math.min(med('aNSC'), med('TAP'))
  const post = Math.max(med('Neuroblast'), med('Astrocyte'), med('Oligodendrocyte'))
  check('every dividing population outscores every post-mitotic one',
    dividing > post, true)
  check('and the score is positive in the dividing ones', dividing > 0, true)
  check('the control subtraction puts the post-mitotic ones below zero', post < 0, true)
  check('cell-cycle score rises in qNSC on reactivation',
    med('qNSC', 'Reactivated') > med('qNSC', 'Quiescent'), true)

  check('an empty set scores zero everywhere',
    Array.from(moduleScore(src, []).scores).every(v => v === 0), true)
  check('an all-unknown set is reported as missing',
    moduleScore(src, ['Nope1', 'Nope2']).missing, ['Nope1', 'Nope2'])
  check('scoring is deterministic',
    moduleScore(src, set.genes).scores[0], sc.scores[0])

  // Pinned numbers, not properties.
  //
  // The score was split into two passes so a collection can run it in a worker,
  // and every part of that split — averages held by index instead of by name,
  // the control draw by index, the order the accumulation walks — is somewhere a
  // value could move in its last bits with every property above still holding.
  //
  // Two of these moved once, deliberately. The accumulation now walks gene
  // order, because that is the only order a matrix streamed off disk can be
  // walked in, and Float32 addition is not associative: accumulating
  // set-then-controls in memory made the same object score differently
  // depending on whether it was held in memory or read from a collection.
  // 2,043 of 2,638 cells disagreed, by up to 1.9e-7 — numerically nothing, and
  // two different answers to one question. These are the values both paths now
  // produce.
  //
  // They moved a second time when the hand-written collection was replaced by
  // MSigDB. Nothing in score.ts changed; the SET did — ACTIVE_NSC was nine
  // curated genes and this is the 18 members of GO's mitotic cell cycle that
  // this object measures — so a different input gives different output and the
  // pin is re-taken against it. Worth being explicit about, because a pinned
  // number that gets quietly refreshed whenever it fails is not a pin.
  check('the first five cells score exactly what they always have',
    Array.from(sc.scores.slice(0, 5)).map(v => v.toPrecision(9)),
    ['-0.541803300', '-0.332846642', '-0.425116152', '-0.425016195', '-0.311089098'])
  check('and the whole object still sums to the same number',
    sc.scores.reduce((a, b) => a + b, 0).toPrecision(12), '-2169.18977807')
  check('the same control genes are drawn, in the same order',
    sc.control.slice(0, 5), ['B2m', 'Rpl13a', 'Mcm5', 'Agt', 'Plp1'])

  // The worker runs `scorePlan` then `scoreAccumPlan` over a scan and never
  // calls moduleScore at all. This is that path, on an object small enough to
  // hold in one piece, so the two can be compared without a file.
  const avg = geneAveragesSync(src)
  const { used } = resolve(src, set.genes)
  const p = scorePlan(src, used, avg, SCORE_DEFAULTS)
  // The engine transfers the buffer, so a job carries a copy — as the view sends.
  const acc = scoreAccumPlan({
    weight: p.weight.slice(), nCells: src.d.nCells, nGenes: src.genes.length,
  })
  src.scanSync(acc.visit)
  const streamed = acc.done()
  check('the plan the worker is given names the same control genes',
    Array.from(p.control, i => src.genes[i]), sc.control)
  // Gene order, not set-then-controls order, so the two sums round differently
  // in their last bits — as they did before this change. Nothing else may move.
  check('and it scores every cell to within a float32 rounding of the inline path',
    Array.from(streamed).every((v, i) => Math.abs(v - sc.scores[i]) < 1e-5), true)
}

console.log('\nSUMMARIES')
check('an empty selection summarises to zeros', summarise(new Float32Array([1, 2, 3]), []).n, 0)
near('median of a known vector', summarise(new Float32Array([1, 2, 3, 4, 5]), [0, 1, 2, 3, 4]).med, 3)

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll gene-set tests passed\n')
process.exit(failed ? 1 : 0)
