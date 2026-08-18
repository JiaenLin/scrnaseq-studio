// Enrichment and module-score regressions.
import { bh, bhNlp, hyperTail, logHyperTail, runORA } from '../src/lib/ora.ts'
import { indexFor, parse } from '../src/lib/msigdb.ts'
import { oraIndexed } from '../src/lib/ora.ts'
import { detectSpecies, matchRate } from '../src/lib/species.ts'
import { gunzipSync } from 'fflate'
import { existsSync, readFileSync } from 'node:fs'

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

console.log('\nEVERY COLLECTION MSIGDB HAS, NOT A SELECTION OF THEM')
{
  // What this pins: the studio shipped 20 367 of the human database's 35 361
  // sets and said nothing about the rest — PID, perturbations, TF and miRNA
  // targets, phenotypes and the cancer collections were absent entirely, and
  // KEGG shipped only its frozen 2011 subcollection. A reader who switched
  // every collection on still could not test them.
  //
  // The numbers are MSigDB 2026.1's own, read out of msigdbr at export time.
  // If a release moves them this test fails, which is the point: it should be a
  // decision to ship a different amount of the database, never a drift.
  const man = JSON.parse(readFileSync('public/genesets/manifest.json', 'utf8'))
  // Derived collections are excluded from the total, and that is not a loophole
  // in the count — they carry no set MSigDB did not publish. Metabolic is a
  // subset of the curated pathway collections under their parents' own ids, so
  // adding its 502 to the human sum would make this assertion read "the studio
  // ships 35 863 of MSigDB's 35 361", which is arithmetic about nothing. What
  // stops IT from drifting is the block below, which checks every id against a
  // parent.
  const native = sp => man.species[sp].sources.filter(c => !c.derived)
  const total = sp => native(sp).reduce((a, c) => a + c.nSets, 0)
  const has = (sp, name) => man.species[sp].sources.find(c => c.source === name)

  check('human ships all 35 361 sets', total('human'), 35361)
  // Mouse is 17 068 native plus the one labelled ortholog projection.
  check('mouse ships all 17 068 native sets, plus KEGG orthologs',
    total('mouse'), 17068 + 835)

  check('KEGG is both subcollections, not just the legacy snapshot',
    has('human', 'KEGG').nSets, 186 + 658)
  check('and the mouse projection is too', has('mouse', 'KEGG (orthologs)').nSets, 835)
  check('KEGG MEDICUS is no longer a separate source',
    has('human', 'KEGG MEDICUS'), undefined)

  // The collections that were missing outright.
  for (const [sp, name, n] of [
    ['human', 'PID', 196], ['human', 'Perturbations', 3555],
    ['human', 'TF targets', 506 + 610], ['human', 'miRNA targets', 2377 + 221],
    ['human', 'Human phenotype', 5793], ['human', 'Vaccine response', 347],
    ['human', 'Cancer atlas (3CA)', 148], ['human', 'Positional', 302],
    ['mouse', 'Perturbations', 984], ['mouse', 'TF targets', 279],
    ['mouse', 'miRNA targets', 1768], ['mouse', 'Mouse phenotype', 92],
    ['mouse', 'Positional', 341],
  ]) check(`${sp} ${name} is present and complete`, has(sp, name)?.nSets, n)

  // Only one collection may claim to be something it is not.
  const projected = [...man.species.human.sources, ...man.species.mouse.sources]
    .filter(c => c.projected).map(c => c.source)
  check('exactly one projected collection, and it says so in its name',
    projected, ['KEGG (orthologs)'])

  // Every file the manifest names must exist, or a collection is offered and
  // then fails to load when it is switched on.
  const missing = []
  for (const sp of ['human', 'mouse'])
    for (const c of man.species[sp].sources)
      if (!existsSync(`public/genesets/${c.file}`)) missing.push(c.file)
  check('every collection the manifest offers has a file', missing, [])
}

console.log('\nTHE METABOLIC LIBRARY IS A COLLECTION, NOT A FOLD OF THE OTHERS')
{
  // What this pins: Metabolic exists so a reader can test metabolism without
  // spending the correction on fifteen thousand terms they did not ask about,
  // AND so that enabling it beside a full default library does something. The
  // first version kept its parents' ids, which meant indexFor folded every one
  // of its sets away whenever a parent was on — a collection that did nothing
  // until you switched four others off. Its own ids are what fixed that, and
  // they are what these checks are about.
  const man = JSON.parse(readFileSync('public/genesets/manifest.json', 'utf8'))
  for (const [sp, nSets] of [['human', 1533], ['mouse', 1391]]) {
    const entry = man.species[sp].sources.find(c => c.source === 'Metabolic')
    check(`${sp} offers Metabolic`, entry?.nSets, nSets)
    check(`${sp} Metabolic names what it was assembled from`, entry.derived.length > 1, true)
    check(`${sp} Metabolic is off by default`, entry.on, false)
    // Ontology terms are the half that makes it worth enabling next to a full
    // library: without GO it carries nothing the pathway collections lack.
    check(`${sp} Metabolic draws on GO as well as the pathway databases`,
      entry.derived.includes('GO:BP'), true)

    const derived = collection(entry.file)
    check(`${sp} Metabolic parses to the count the manifest claims`,
      derived.sets.length, nSets)

    // Its own namespace. This is the whole property: no id here may collide
    // with any id in any collection this species ships, or indexFor folds it
    // away exactly as it used to.
    const native = new Set()
    for (const c of man.species[sp].sources) {
      if (c.source === 'Metabolic') continue
      for (const s2 of collection(c.file).sets) native.add(s2.id)
    }
    const collide = derived.sets.filter(s2 => native.has(s2.id)).map(s2 => s2.id)
    check(`${sp} no Metabolic id collides with a shipped collection`, collide, [])
    check(`${sp} every Metabolic id is prefixed`,
      derived.sets.every(s2 => s2.id.startsWith('METABOLIC_')), true)

    // Prefixed, but the parent is still recoverable and the members are still
    // the parent's — an assembled collection may not quietly become a
    // different set under a name that looks like a citation.
    const parents = entry.derived.map(name =>
      collection(man.species[sp].sources.find(c => c.source === name).file))
    const byId = new Map()
    for (const c of parents) {
      for (const s2 of c.sets) {
        if (!byId.has(s2.id)) byId.set(s2.id, new Set(Array.from(s2.genes, i => c.symbols[i])))
      }
    }
    const orphan = derived.sets.filter(s2 => !byId.has(s2.id.slice(10))).map(s2 => s2.id)
    check(`${sp} dropping the prefix names a real set in a parent`, orphan, [])
    const edited = derived.sets.filter(s2 => {
      const want = byId.get(s2.id.slice(10))
      const got = Array.from(s2.genes, i => derived.symbols[i])
      return !want || want.size !== got.length || got.some(g => !want.has(g))
    }).map(s2 => s2.id)
    check(`${sp} and carries that set's members unchanged`, edited, [])

    // Three databases call a set "Glycolysis". Merged into one collection the
    // source column says "Metabolic" for all of them, so the origin has to be
    // in the NAME or the results table has identical rows telling a reader
    // nothing.
    const names = derived.sets.map(s2 => s2.name)
    check(`${sp} every set name carries its origin`,
      names.every(n => /\([^)]+\)$/.test(n)), true)
    check(`${sp} and the names are therefore unique`,
      new Set(names).size, names.length)

    // A spot check of what must be in, and of what the ontology guard keeps out.
    for (const id of ['METABOLIC_HALLMARK_GLYCOLYSIS',
      'METABOLIC_HALLMARK_OXIDATIVE_PHOSPHORYLATION',
      'METABOLIC_HALLMARK_FATTY_ACID_METABOLISM']) {
      check(`${sp} Metabolic contains ${id}`, derived.sets.some(s2 => s2.id === id), true)
    }
    check(`${sp} Metabolic excludes signalling that merely contains a metabolite`,
      derived.sets.some(s2 => /PURINERGIC|NUCLEOTIDE_EXCISION_REPAIR/.test(s2.id)), false)
    // GO calls protein turnover, mRNA decay and tRNA processing metabolic
    // processes. They are, in GO's sense, and they are not what this
    // collection is for. Named individually, and checked to be CANDIDATES
    // first — asserting the absence of something that was never in the input
    // proves nothing about the guard.
    const turnover = ['GOBP_PROTEIN_CATABOLIC_PROCESS', 'GOBP_MRNA_CATABOLIC_PROCESS',
      'GOBP_TRNA_METABOLIC_PROCESS']
    const bp = collection(man.species[sp].sources.find(c => c.source === 'GO:BP').file)
    check(`${sp} GO:BP does carry the turnover terms`,
      turnover.filter(id => bp.sets.some(s2 => s2.id === id)), turnover)
    check(`${sp} and Metabolic excludes every one of them`,
      turnover.filter(id => derived.sets.some(s2 => s2.id === 'METABOLIC_' + id)), [])
    // The guard is on the WORD, not the substring: proteinogenic amino acid
    // biosynthesis is amino acid metabolism and has to survive it.
    check(`${sp} while proteinogenic amino acid biosynthesis survives`,
      derived.sets.some(s2 => s2.id === 'METABOLIC_GOBP_PROTEINOGENIC_AMINO_ACID_BIOSYNTHETIC_PROCESS'),
      true)
  }

  // The property the ids buy: enabling it beside a parent adds its sets rather
  // than folding into it. Both versions of glycolysis survive, under different
  // sources, which is also what makes the double-testing warning on the card
  // a true statement rather than a precaution.
  const both = ['mouse.hallmark.gs', 'mouse.metabolic.gs'].map(collection)
  const idx = indexFor(both, GENES)
  const glyc = idx.sets.filter(s2 =>
    s2.id === 'HALLMARK_GLYCOLYSIS' || s2.id === 'METABOLIC_HALLMARK_GLYCOLYSIS')
  check('Hallmark glycolysis survives beside the Metabolic library',
    glyc.map(s2 => s2.source).sort(), ['Hallmark', 'Metabolic'])
  check('and every id in the folded index is still unique',
    idx.sets.length, new Set(idx.sets.map(s2 => s2.id)).size)

  // The fold itself still works, for the case a reader can actually create:
  // a GMT of their own repeating a set MSigDB already ships.
  {
    const mine = { species: 'mouse', source: 'My sets', release: 'your file',
      symbols: both[0].symbols,
      sets: [both[0].sets[0]] }
    const folded = indexFor([both[0], mine], GENES)
    check('a custom GMT repeating an MSigDB id is tested once',
      folded.sets.filter(s2 => s2.id === both[0].sets[0].id).length, 1)
  }
}

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

console.log('\nA TAIL TOO SMALL FOR A DOUBLE STILL HAS AN ORDER')
{
  // hyperTail summed its terms AFTER exponentiating out of log space, so a set
  // essentially contained in the query returned exactly 0 — and padj was the
  // sort key, so every such set arrived tied at the top of the table in library
  // order. It is the same defect logNormalTail was written to escape on the DE
  // side of this app, and it now has the same answer: carry -log10 p alongside.
  check('the double underflows to exactly zero', hyperTail(600, 700, 4000, 22000), 0)
  const lp = logHyperTail(600, 700, 4000, 22000)
  check('but the log does not', Number.isFinite(lp) && lp < -700, true)

  // Two sets that BOTH underflow must still be ORDERED, which is the whole
  // point: 0 === 0 is not a ranking. Measured, not assumed — with K=700,
  // n=4000, N=22000 the double gives out between k=580 (3.6e-317, already
  // subnormal and mostly noise) and k=600.
  check('one k below the boundary still has a double',
    hyperTail(560, 700, 4000, 22000) > 0, true)
  check('two k above it do not',
    hyperTail(600, 700, 4000, 22000) === 0 && hyperTail(700, 700, 4000, 22000) === 0, true)
  const a = -logHyperTail(700, 700, 4000, 22000) / Math.LN10
  const b = -logHyperTail(600, 700, 4000, 22000) / Math.LN10
  near('and the logs still say how far past zero each one is', b, 345.41, 0.05)
  near('for both of them', a, 541.63, 0.05)
  check('so they can be ranked against each other', a > b, true)

  // Where the double CAN hold the answer the two must agree — this is a
  // reformulation of one sum, not a second opinion about it.
  for (const [k, K, n, N] of [[3, 10, 20, 100], [2, 5, 8, 20], [1, 1, 1, 2], [12, 40, 300, 5000]]) {
    near(`log and linear agree at k=${k},K=${K},n=${n},N=${N}`,
      Math.exp(logHyperTail(k, K, n, N)), hyperTail(k, K, n, N), 1e-12)
  }
}

console.log('\nBH IN BOTH SPACES IS ONE STEP-UP')
{
  const ps = [1e-9, 2e-4, 0.03, 0.2, 0.5, 0.9, 0.011, 0.047]
  const adj = bh(ps)
  const adjN = bhNlp(ps.map(v => -Math.log10(v)))
  for (let i = 0; i < ps.length; i++) {
    near(`set ${i} agrees between bh and bhNlp`, adjN[i], -Math.log10(adj[i]), 1e-9)
  }
  // And the transform holds where bh cannot: p below the smallest double.
  const deep = bhNlp([953.3, 400.1, 2.0, 0.3])
  check('an underflowed p keeps a distinct adjusted significance',
    deep[0] > deep[1] && deep[1] > deep[2], true)
}

console.log('\nopts.sources NARROWS THE REPORT, NOT THE BACKGROUND')
{
  // The convention, pinned, because a review read it as a bug and narrowing the
  // universe to the filtered sources is exactly what breaks the equivalence
  // asserted above: oraIndexed takes N from the collections its index was BUILT
  // from. The reader's real control is the collection toggle, which rebuilds
  // the index and does move N.
  const sets = [
    { source: 'A', id: 'a1', name: 'a1', genes: ['G1', 'G2', 'G3', 'G4'] },
    { source: 'B', id: 'b1', name: 'b1', genes: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'] },
  ]
  const bg = ['G1', 'G2', 'G3', 'G4', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'Z1', 'Z2']
  const all = runORA(['G1', 'G2', 'G3'], sets, bg, { minSize: 1, maxSize: 100 })
  const justA = runORA(['G1', 'G2', 'G3'], sets, bg,
    { minSize: 1, maxSize: 100, sources: new Set(['A']) })
  check('only set A can be reported either way', all.length === 1 && justA.length === 1, true)
  check('and filtering the sources does not move its p-value',
    justA[0].pvalue, all[0].pvalue)
  check('because N stayed the annotated background of every set given',
    Math.abs(all[0].foldEnrichment - justA[0].foldEnrichment) < 1e-12, true)
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
