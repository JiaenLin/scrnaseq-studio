// Does the module score still produce the same numbers?
//
// The scoring was split in two so that a collection can run it in a worker: the
// expression bins became a job, the accumulation became a job, and the control
// draw moved from name-keyed Maps to gene indices. Every one of those is a place
// where a score could shift in its last bits and nobody would notice — the
// figure would still look right and the table would still round to the same two
// decimals.
//
// So this runs the implementation as it was before the change, from git, beside
// the one that is there now, and compares every cell of every score BIT FOR BIT.
// Not "close enough": Float32Array against Float32Array, exact.
//
//   node scripts/prove-score.mjs [bundle.zip] [collection.zip]

import fs from 'node:fs'
import { fileBlob, needsShim } from './big-blob.mjs'
import { loadBaseline } from './score-baseline.mjs'
import {
  moduleScore as newScore, moduleScoreAsync as newScoreAsync,
  averagesSpec, averagesPlan, resolve, scorePlan, scoreAccumPlan,
  SCORE_DEFAULTS,
} from '../src/lib/score.ts'
import { GENE_SETS } from '../src/lib/genesets.ts'
import { demoSource, bundleSource } from '../src/lib/source.ts'
import { parseBundle } from '../src/lib/bundle.ts'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { scanMatrix } from '../src/lib/part-scan.ts'

const [bundlePath, collectionPath] = process.argv.slice(2)
const { moduleScore: oldScore, moduleScoreAsync: oldScoreAsync } = await loadBaseline()
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Bit-for-bit, over every cell. Reports the first cell that differs. */
function identical(a, b) {
  if (a.length !== b.length) return `lengths ${a.length} vs ${b.length}`
  for (let i = 0; i < a.length; i++) {
    if (Object.is(a[i], b[i])) continue
    return `cell ${i}: ${a[i]} vs ${b[i]}`
  }
  return null
}

const SETS = GENE_SETS.slice(0, 6)

async function compareSync(label, src) {
  console.log(`\n${label} — ${src.d.cells.length} cells, ${src.genes.length} genes`)
  check('gene names are unique (indices and names address the same thing)',
    new Set(src.genes).size === src.genes.length,
    `${src.genes.length - new Set(src.genes).size} duplicates`)
  for (const set of SETS) {
    const a = oldScore(src, set.genes)
    const b = newScore(src, set.genes)
    const diff = identical(a.scores, b.scores)
    check(`${set.id}: every cell scores the same`, diff === null, diff ?? `${a.used.length} genes`)
    check(`${set.id}: the same control genes are drawn`,
      JSON.stringify(a.control) === JSON.stringify(b.control),
      `${a.control.length} vs ${b.control.length}`)
    check(`${set.id}: the same genes used and missing`,
      JSON.stringify([a.used, a.missing]) === JSON.stringify([b.used, b.missing]))
  }
  // A custom list is the case the studio actually exercises most: not a curated
  // set, and with names the object does not measure mixed in.
  const at = (i) => src.genes[i % src.genes.length]
  const custom = [at(3), 'NotAGene', at(100), at(3), at(7)]
  const ca = oldScore(src, custom)
  const cb = newScore(src, custom)
  check('an ad-hoc list with a repeat and an unknown scores the same',
    identical(ca.scores, cb.scores) === null, identical(ca.scores, cb.scores) ?? '')
  check('and reports the same missing gene', JSON.stringify(ca.missing) === JSON.stringify(cb.missing))
  check('an empty set is still zero everywhere',
    identical(oldScore(src, []).scores, newScore(src, []).scores) === null)
}

async function compareStreamed(label, src) {
  console.log(`\n${label} — ${src.d.cells.length} cells, ${src.genes.length} genes, `
    + `${src.nParts} part${src.nParts === 1 ? '' : 's'}, remote=${src.remote !== null}`)
  for (const set of SETS.slice(0, 3)) {
    const t0 = Date.now()
    check(`${set.id}: the set is not empty, so this compares something`,
      resolve(src, set.genes).used.length > 0)
    const a = await oldScoreAsync(src, set.genes)
    const b = await newScoreAsync(src, set.genes)
    const diff = identical(a.scores, b.scores)
    check(`${set.id}: streamed, every cell scores the same`, diff === null,
      diff ?? `${a.used.length} genes, ${((Date.now() - t0) / 1000).toFixed(1)}s for both`)
    check(`${set.id}: the same control genes are drawn`,
      JSON.stringify(a.control) === JSON.stringify(b.control))
  }
}

/**
 * The worker path, run without a worker.
 *
 * The worker is handed `file` and `plan` and calls `scanMatrix(...)` with the
 * plans out of score.ts — exactly what happens here. If this agrees with the
 * streamed path then the only thing the worker adds is the thread it runs on.
 */
/**
 * Genes this object actually measures.
 *
 * The built-in sets are gene symbols; the atlas stores Ensembl IDs, so every one
 * of them resolves to nothing there. Comparing two implementations on an empty
 * gene set compares two all-zero arrays and passes gloriously, which is how a
 * proof becomes a decoration. So the object is asked what it carries, and the
 * caller asserts the answer is not empty.
 */
function pickGenes(src) {
  for (const set of SETS) {
    const { used } = resolve(src, set.genes)
    if (used.length >= 3) return { id: set.id, genes: set.genes }
  }
  // An evenly spread handful, so the control bins are not all drawn from one end.
  const step = Math.max(1, Math.floor(src.genes.length / 9))
  return {
    id: 'the object\'s own genes',
    genes: Array.from({ length: 8 }, (_v, i) => src.genes[i * step]),
  }
}

async function compareWorkerShape(label, src) {
  console.log(`\n${label} — the worker's own code path`)
  const { file, plan: matrix } = src.remote
  const set = pickGenes(src)

  const ap = averagesPlan(averagesSpec(src))
  await scanMatrix(file, matrix, ap.visit)
  const avg = ap.done()

  const { used } = resolve(src, set.genes)
  check(`${set.id}: the set is not empty, so this compares something`, used.length > 0,
    `${used.length} genes`)
  const p = scorePlan(src, used, avg, SCORE_DEFAULTS)
  // The engine transfers the buffer, so the job carries a copy — as the view does.
  const acc = scoreAccumPlan({
    weight: p.weight.slice(), nCells: src.d.cells.length, nGenes: src.genes.length,
  })
  await scanMatrix(file, matrix, acc.visit)

  const ref = await oldScoreAsync(src, set.genes)
  const diff = identical(ref.scores, acc.done())
  check(`${set.id}: what the worker computes is what the page computed before`,
    diff === null, diff ?? `${used.length} genes`)
}

/* ---------------- run ---------------- */

console.log('THE DEMO OBJECT (in memory, synchronous — the path a small object takes)')
await compareSync('cohort', demoSource('cohort'))
await compareSync('course', demoSource('course'))

if (bundlePath) {
  console.log('\n\nA REAL BUNDLE')
  const src = bundleSource(parseBundle(new Uint8Array(fs.readFileSync(bundlePath)).buffer))
  await compareSync(bundlePath.split(/[\\/]/).pop(), src)
  // The same object, streamed rather than read at once: the two paths sum in a
  // different order, so this is not expected to be bit-identical and is not
  // asserted to be. What is asserted is that each path still matches ITSELF.
  const a = newScore(src, SETS[0].genes)
  const b = await newScoreAsync(src, SETS[0].genes)
  let worst = 0
  for (let i = 0; i < a.scores.length; i++) worst = Math.max(worst, Math.abs(a.scores[i] - b.scores[i]))
  console.log(`       inline vs streamed on the same object: worst cell differs by ${worst.toExponential(2)}`
    + ' (Float32 addition is not associative; the orders differ, as they did before this change)')
}

if (collectionPath) {
  console.log('\n\nA REAL COLLECTION (read off the file, which is what the worker does)')
  // Past 4 GB Node's own Blob reports the wrong length; see big-blob.mjs.
  const blob = needsShim(collectionPath)
    ? fileBlob(collectionPath)
    : await fs.openAsBlob(collectionPath)
  const index = await readCollectionIndex(blob)
  if (!index) throw new Error('not recognised as a collection')
  const src = await openCollection(blob, index)
  const name = collectionPath.split(/[\\/]/).pop()
  // On an atlas each of these is a forward pass over the whole file, so the
  // number of sets compared is the number of minutes this takes. One is enough
  // to catch a change in the arithmetic; the small collection covers the rest.
  const heavy = src.d.cells.length > 100_000
  if (!heavy) await compareStreamed(name, src)
  else console.log(`\n${name} — ${src.d.cells.length} cells: one set only, each pass reads the file`)
  await compareWorkerShape(name, src)
}

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nEvery score is bit-for-bit what it was\n')
process.exit(failed ? 1 : 0)
