// What the page says about pseudobulk must be what the page does.
//
// The pseudobulk path sums raw counts per animal and hands the matrix over: the
// DE card says "the matrix is here; the model is not" (Stats.tsx). The Methods
// paragraph said the profiles "were tested with DESeq2 … with Benjamini–Hochberg
// adjustment", and Overview that "pseudobulk DESeq2 tests between animals". The
// Methods paragraph is the text people copy into a paper, so a test that was
// never run went into papers as one that was.
//
// These render the real components — the words a reader is given — rather than
// a function that might drift from them.

import { DE_GATES, thresholdFor } from '../src/lib/stats.ts'
import { demoSource } from '../src/lib/source.ts'
import { loadComponents, render, textOf } from './render.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

const C = await loadComponents()

// The replicated demo: four animals a group, so pseudobulk is offered and the
// paragraph has a real design to describe.
const src = demoSource('cohort')
const [ctrl, cs] = src.d.conds
const methods = (method) => textOf(render(C.Methods, {
  src, types: src.types, tis: [0], ctrl: [ctrl], cs: [cs], method,
  padjMax: 0.05, lfcMin: thresholdFor(method).lfc, gates: DE_GATES, lib: null,
}))

console.log('\nMETHODS, PSEUDOBULK: WHAT WAS DONE, AND NOTHING THAT WAS NOT')
{
  const t = methods('pseudobulk')
  check('it does not say the profiles were tested with DESeq2', t.includes('tested with DESeq2'), false)
  check('nor that differential expression "was tested on pseudobulk profiles"',
    /was tested on pseudobulk/i.test(t), false)
  check('nor that any gene was "considered differentially expressed"',
    t.includes('considered differentially expressed'), false)
  check('nor that the studio "runs these tests"', t.includes('runs these tests'), false)
  check('it says the summed counts were exported for DESeq2',
    /summed counts[^.]*were exported for DESeq2/.test(t), true)
  check('and, in so many words, that no test was run here', t.includes('No test was run here'), true)
  check('the design it describes is still the object\'s own (4 v 4 animals)',
    t.includes(`4 ${ctrl} and 4 ${cs} profiles`), true)
  check('DESeq2 is still cited, as what the counts are for', t.includes('Love MI'), true)
}

console.log('\nMETHODS, WILCOXON: THE TEST THAT DOES RUN IS STILL NAMED')
{
  const t = methods('wilcox')
  check('the per-cell paragraph still names its test',
    t.includes('was tested with a Wilcoxon rank-sum test across cells'), true)
  check('and its cutoffs', t.includes('were considered differentially expressed'), true)
  check('and says the studio runs it', t.includes('runs these tests in the browser'), true)
}

console.log('\nOVERVIEW: THE DESIGN NOTE OFFERS WHAT EXISTS')
{
  const t = textOf(render(C.Overview, {
    src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {},
  }))
  check('it no longer promises "pseudobulk DESeq2 tests between animals"',
    /DESeq2 tests/.test(t), false)
  check('nor "both tests"', /both tests/i.test(t), false)
  check('it says the pseudobulk counts are exported for DESeq2', t.includes('exported for DESeq2'), true)
  check('and that DESeq2 is not run here', t.includes('not run here'), true)
}

console.log(failed ? `\n${failed} FAILED` : '\nAll Methods tests passed')
process.exit(failed ? 1 : 0)
