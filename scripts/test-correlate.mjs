// Co-expression regressions.
//
// The claims worth pinning are not "Pearson is Pearson". They are the three
// ways this analysis lies if it is written the obvious way, and each has a
// block below:
//
//   - a correlation over pools is a correlation over pools, and the pools are
//     equal-sized and stable
//   - a gene set does not cancel itself, because its members are signed before
//     they are combined
//   - the combined score IS the weighted mean of the members' own independent
//     correlations, which is the identity that lets one pass stand in for many

import {
  cellAxis, composite, corrDense, corrPlan, moments, poolAxis, pseudobulkOn,
  rankCorr, standardise, withinSet,
} from '../src/lib/correlate.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const near = (name, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) <= tol
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got ${got}  want ${want}`)
}

/** Pearson, written the slow obvious way, as the thing to be held to. */
function pearson(a, b) {
  const n = a.length
  let sa = 0, sb = 0
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i] }
  const ma = sa / n, mb = sb / n
  let num = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    va += (a[i] - ma) ** 2
    vb += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(va * vb)
}

/** A tiny object: dense per-cell values, and the walker corrPlan expects. */
function fixture(matrix) {
  const nGenes = matrix.length
  const nCells = matrix[0].length
  const visitAll = (plan) => {
    for (let g = 0; g < nGenes; g++) {
      plan.visit(g, cb => {
        for (let c = 0; c < nCells; c++) if (matrix[g][c] !== 0) cb(c, matrix[g][c])
      })
    }
  }
  return { nGenes, nCells, visitAll }
}

console.log('\nTHE PASS AGREES WITH PEARSON, PER CELL')
{
  // Deterministic, and deliberately sparse: zeros are the case this whole file
  // is careful about, so they are in the fixture rather than assumed away.
  const nCells = 60
  const seedRow = Array.from({ length: nCells }, (_v, i) => (i % 5 === 0 ? 0 : (i % 7) + 1))
  const with_ = seedRow.map(v => v * 2 + (v ? 1 : 0))
  const against = seedRow.map(v => 9 - v)
  const flat = Array.from({ length: nCells }, () => 3)
  const sparse = Array.from({ length: nCells }, (_v, i) => (i < 3 ? 5 : 0))
  const matrix = [with_, against, flat, sparse]
  const f = fixture(matrix)

  const keep = new Uint8Array(nCells).fill(1)
  const axis = cellAxis(keep, nCells)
  check('the per-cell axis is one bucket per cell', [axis.n, axis.pooled], [nCells, false])

  const seed = new Float64Array(seedRow)
  const plan = corrPlan({
    bucket: axis.of, size: axis.size, nBuckets: axis.n, seed,
    nScope: axis.nCells, minPct: 0, nGenes: f.nGenes, pooled: false,
  })
  f.visitAll(plan)
  const { r, pct } = plan.done()
  near('a gene that moves with the seed', r[0], pearson(with_, seedRow))
  near('a gene that moves against it', r[1], pearson(against, seedRow))
  check('a gene that does not vary is not ranked', Number.isFinite(r[2]), false)
  near('and the detection rate is the fraction of cells', pct[3], 3 / nCells)

  // The floor is the guard against a correlation made of shared zeros.
  const gated = corrPlan({
    bucket: axis.of, size: axis.size, nBuckets: axis.n, seed,
    nScope: axis.nCells, minPct: 0.1, nGenes: f.nGenes, pooled: false,
  })
  f.visitAll(gated)
  const g = gated.done()
  check('a gene under the detection floor is not ranked', Number.isFinite(g.r[3]), false)
  check('and one over it still is', Number.isFinite(g.r[0]), true)
  near('the floor changes what is ranked, never the value', g.r[0], r[0])
}

console.log('\nA SCOPE IS CELLS LEFT OUT, NOT VALUES ZEROED')
{
  const nCells = 40
  const row = Array.from({ length: nCells }, (_v, i) => (i * 7) % 11)
  const other = Array.from({ length: nCells }, (_v, i) => (i * 3) % 5)
  const f = fixture([other])
  const keep = new Uint8Array(nCells)
  for (let i = 0; i < nCells; i++) if (i >= 10 && i < 30) keep[i] = 1
  const axis = cellAxis(keep, nCells)
  check('the scope is the cells that were kept', axis.n, 20)

  const seed = new Float64Array(20)
  for (let i = 10; i < 30; i++) seed[axis.of[i]] = row[i]
  const plan = corrPlan({
    bucket: axis.of, size: axis.size, nBuckets: axis.n, seed,
    nScope: axis.nCells, minPct: 0, nGenes: 1, pooled: false,
  })
  f.visitAll(plan)
  // The same answer as correlating the two slices directly: cells outside the
  // scope must not reach the sums at all, which is a different thing from
  // their values being zero.
  near('r is taken over the scope alone',
    plan.done().r[0], pearson(other.slice(10, 30), row.slice(10, 30)))
}

console.log('\nPOOLS ARE EQUAL, CONTIGUOUS AND STABLE')
{
  const nCells = 400
  const xy = new Float32Array(nCells * 2)
  for (let i = 0; i < nCells; i++) {
    // A deterministic spread, not a random one: two clumps, so contiguity is
    // something the test can actually see.
    xy[2 * i] = (i % 20) + (i < 200 ? 0 : 50)
    xy[2 * i + 1] = Math.floor(i / 20)
  }
  const keep = new Uint8Array(nCells).fill(1)
  const a = poolAxis(xy, keep, nCells, 16)
  check('a power of two pools', a.n, 16)
  check('every cell landed in one', a.of.every(v => v >= 0), true)
  check('the pools are equal sized', [...new Set(a.size)], [25])
  check('and they account for every cell', a.size.reduce((s, v) => s + v, 0), nCells)
  const again = poolAxis(xy, keep, nCells, 16)
  check('the same object gives the same pools', [...again.of], [...a.of])
  check('pools are spatially contiguous', (() => {
    // Every cell of a pool should be nearer its own pool's centre than the
    // spread of the whole embedding — a grid-free way of saying "not scattered".
    for (let b = 0; b < a.n; b++) {
      const xs = [], ys = []
      for (let i = 0; i < nCells; i++) if (a.of[i] === b) { xs.push(xy[2 * i]); ys.push(xy[2 * i + 1]) }
      const w = Math.max(...xs) - Math.min(...xs)
      const h = Math.max(...ys) - Math.min(...ys)
      if (w > 30 || h > 12) return false
    }
    return true
  })(), true)

  // Asking for more pools than the cells can fill is capped, not obeyed.
  const small = new Uint8Array(nCells)
  for (let i = 0; i < 20; i++) small[i] = 1
  const tiny = poolAxis(xy, small, nCells, 512)
  check('pools never fall below three cells', Math.min(...tiny.size) >= 3, true)
  check('a scope of 20 cells gives at most 4 pools', tiny.n <= 4, true)
}

console.log('\nPOOLING IS A CORRELATION OVER POOL MEANS')
{
  const nCells = 64
  const xy = new Float32Array(nCells * 2)
  for (let i = 0; i < nCells; i++) { xy[2 * i] = i; xy[2 * i + 1] = 0 }
  const keep = new Uint8Array(nCells).fill(1)
  const axis = poolAxis(xy, keep, nCells, 8)
  const row = Array.from({ length: nCells }, (_v, i) => (i % 3) * (i % 2 ? 1 : 0))
  const f = fixture([row])

  // What the pooled path must equal, computed the long way round.
  const poolMean = (vals) => {
    const s = new Float64Array(axis.n)
    for (let i = 0; i < nCells; i++) s[axis.of[i]] += vals[i]
    return Array.from(s, (v, b) => v / axis.size[b])
  }
  const seedCells = Array.from({ length: nCells }, (_v, i) => Math.sin(i) + 2)
  const seed = new Float64Array(poolMean(seedCells))
  const plan = corrPlan({
    bucket: axis.of, size: axis.size, nBuckets: axis.n, seed,
    nScope: axis.nCells, minPct: 0, nGenes: 1, pooled: true,
  })
  f.visitAll(plan)
  near('r over pools is r of the pool means', plan.done().r[0],
    pearson(poolMean(row), Array.from(seed)), 1e-9)

  // The accumulator is cleared between genes; a second gene must not inherit
  // the first one's sums.
  const two = fixture([row, row.map(v => v * 3 + 1)])
  const p2 = corrPlan({
    bucket: axis.of, size: axis.size, nBuckets: axis.n, seed,
    nScope: axis.nCells, minPct: 0, nGenes: 2, pooled: true,
  })
  two.visitAll(p2)
  const r2 = p2.done().r
  near('and each gene starts from zero', r2[0], plan.done().r[0], 1e-12)
  near('an affine copy of a gene has the same r', r2[1], r2[0], 1e-9)
}

console.log('\nA SET DOES NOT CANCEL ITSELF')
{
  const n = 50
  const base = Array.from({ length: n }, (_v, i) => Math.sin(i / 3))
  // Three members with the programme, two against it. A mean seed is the
  // failure this is here to prevent.
  const members = [
    base.map(v => v * 2 + 5),
    base.map(v => v * 1.5 + 4),
    base.map(v => v * 3 + 9),
    base.map(v => -v * 2 + 6),
    base.map(v => -v * 2.5 + 7),
  ].map(v => standardise(v))

  const shape = withinSet(members)
  check('every member varies, so every member is used', shape.used.length, 5)
  check('the two that run against the programme are signed -1',
    [...shape.sign].map(s => (s < 0 ? 1 : 0)).reduce((a, b) => a + b, 0), 2)
  check('and are counted as flipped', shape.flipped, 2)
  near('a set built from one direction is coherent', shape.coherence, 1, 0.02)
  near('and its signed members agree with each other', shape.meanR, 1, 0.02)

  const seed = composite(members, shape)
  near('the composite carries the programme', Math.abs(pearson(seed, base)), 1, 1e-6)

  // The failure being prevented, stated as a test.
  //
  // The mean has to be taken over the RAW members, because that is what the
  // naive version does and it is where the cancellation lives: correlation is
  // scale-invariant, so averaging members that have already been standardised
  // cannot cancel exact copies of one signal — it only shrinks the amplitude,
  // which r does not see. Raw, with the two directions at comparable
  // amplitude, the sum is very nearly a constant and what survives is noise.
  const wobble = (i, k) => Math.sin(i * (k + 3) * 2.399) * 0.35
  const raw = [
    base.map((v, i) => v * 2 + 5 + wobble(i, 0)),
    base.map((v, i) => v * 2 + 4 + wobble(i, 1)),
    base.map((v, i) => v * 2 + 9 + wobble(i, 2)),
    base.map((v, i) => -v * 3 + 6 + wobble(i, 3)),
    base.map((v, i) => -v * 3 + 7 + wobble(i, 4)),
  ]
  const rawMean = Array.from({ length: n }, (_v, i) =>
    raw.reduce((s, m) => s + m[i], 0) / raw.length)
  const signed = composite(raw.map(v => standardise(v)), withinSet(raw.map(v => standardise(v))))
  const cancelled = Math.abs(pearson(rawMean, base))
  const kept = Math.abs(pearson(signed, base))
  console.log(`       raw mean |r| = ${cancelled.toFixed(3)}, signed composite |r| = ${kept.toFixed(3)}`)
  check('a plain mean of the same members loses the signal the composite keeps',
    cancelled < 0.4 && kept > 0.95, true)

  // A set with no shared direction should say so rather than inventing one.
  const noise = [0, 1, 2, 3].map(k =>
    standardise(Array.from({ length: n }, (_v, i) => Math.sin(i * (k + 1) * 1.7) + k)))
  check('an incoherent set reports low coherence', withinSet(noise).coherence < 0.6, true)

  // A member that never varies cannot be signed and is dropped, not counted.
  const withFlat = [...members, standardise(Array.from({ length: n }, () => 4))]
  check('a member that does not vary is dropped', withinSet(withFlat).used.length, 5)
}

console.log('\nCOMBINE-THEN-CORRELATE IS CORRELATE-THEN-COMBINE')
{
  // The identity the whole design rests on: one pass against the signed
  // composite gives the same ranking as correlating every member separately
  // and taking the weighted mean of those correlations. If this ever stops
  // holding, the card is claiming an analysis it is not running.
  const n = 40
  const base = Array.from({ length: n }, (_v, i) => Math.cos(i / 4))
  const members = [
    base.map(v => v * 2 + 5),
    base.map(v => -v * 3 + 8),
    base.map((v, i) => v + Math.sin(i) * 0.4 + 2),
  ].map(v => standardise(v))
  const shape = withinSet(members)
  const seed = composite(members, shape)

  const genes = [
    Array.from({ length: n }, (_v, i) => base[i] * 4 + 1),
    Array.from({ length: n }, (_v, i) => -base[i] * 2 + 6),
    Array.from({ length: n }, (_v, i) => Math.sin(i * 2.3) + 3),
  ]
  const combined = genes.map(g => pearson(g, seed))
  const perMember = genes.map(g => {
    // Each member's own independent correlation, combined afterwards.
    let s = 0
    shape.used.forEach((mi, i) => {
      s += shape.sign[i] * shape.weight[i] * pearson(g, members[mi])
    })
    return s
  })
  // Equal up to the composite's norm, which is one constant for every gene —
  // so the ratio is the same for all of them and the ranking is identical.
  const ratios = combined.map((c, i) => perMember[i] / c)
  near('every gene shares one constant of proportionality',
    Math.max(...ratios) - Math.min(...ratios), 0, 1e-9)
  check('so the two orderings are the same',
    combined.map((_v, i) => i).sort((a, b) => combined[b] - combined[a]),
    perMember.map((_v, i) => i).sort((a, b) => perMember[b] - perMember[a]))
}

console.log('\nTHE DENSE PATH AGREES WITH THE SPARSE ONE')
{
  const nCols = 12, nGenes = 4
  const values = new Float64Array(nGenes * nCols)
  for (let g = 0; g < nGenes; g++) {
    for (let c = 0; c < nCols; c++) values[g * nCols + c] = Math.sin(c * (g + 1) * 0.7) + g
  }
  const seed = new Float64Array(nCols)
  for (let c = 0; c < nCols; c++) seed[c] = Math.cos(c * 0.5)
  const detected = new Float64Array(nGenes).fill(1)
  detected[3] = 0.01
  const out = corrDense(values, nGenes, nCols, seed, detected, 0.1)
  for (let g = 0; g < 3; g++) {
    const row = Array.from({ length: nCols }, (_v, c) => values[g * nCols + c])
    near(`gene ${g} matches Pearson`, out.r[g], pearson(row, Array.from(seed)))
  }
  check('and one under the floor is not ranked', Number.isFinite(out.r[3]), false)
}

console.log('\nTHE PSEUDOBULK AXIS')
{
  // The one path no demo object can exercise — the built-in objects carry no
  // raw counts — so it is checked here against a hand-built table instead of
  // being shipped on the strength of having compiled.
  const genes = ['A', 'B', 'C']
  const columns = [
    { sample: 'S1', cluster: 'T', nCells: 100 },
    { sample: 'S2', cluster: 'T', nCells: 100 },
    { sample: 'S3', cluster: 'T', nCells: 100 },
    { sample: 'S4', cluster: 'T', nCells: 100 },
    { sample: 'S1', cluster: 'U', nCells: 100 },
    { sample: 'S2', cluster: 'U', nCells: 100 },
  ]
  const samples = [
    { id: 'S1', cond: 'ctrl' }, { id: 'S2', cond: 'ctrl' },
    { id: 'S3', cond: 'treat' }, { id: 'S4', cond: 'treat' },
  ]
  // counts[gene * nCols + col]
  const counts = new Int32Array([
    10, 20, 30, 40, 5, 6, // A
    20, 40, 60, 80, 1, 2, // B — twice A everywhere, so perfectly correlated
    0, 0, 0, 7, 9, 9, // C — detected in one of the four T columns
  ])
  const pb = { genes, columns, counts }

  const all = pseudobulkOn(pb, samples, null, null)
  check('with no scope every column is used', all.cols.length, 6)
  const one = pseudobulkOn(pb, samples, 'T', null)
  check('a cell type takes its own columns', one.cols, [0, 1, 2, 3])
  const pair = pseudobulkOn(pb, samples, 'T', 'ctrl')
  check('and a group narrows it further', pair.cols, [0, 1])
  check('under three columns there is nothing to correlate', pair.values, null)

  check('detection is the fraction of columns with a count', one.detected[2], 0.25)
  check('and a gene in every column reads 1', one.detected[0], 1)

  // Normalised per column: A and B are proportional within every column, so
  // after per-column scaling they must still move together.
  const nCols = one.cols.length
  const rowOf = g => Array.from({ length: nCols }, (_v, k) => one.values[g * nCols + k])
  const out = corrDense(one.values, genes.length, nCols, new Float64Array(rowOf(0)),
    one.detected, 0.1)
  near('a gene correlates perfectly with itself', out.r[0], 1, 1e-9)
  near('and B, which is twice A in every column, comes with it', out.r[1], 1, 1e-9)
  // C is detected in one column of four, so it clears a 10 % floor and not a
  // 50 % one — the floor is what decides, not the sparsity by itself.
  check('a gene over the floor is ranked', Number.isFinite(out.r[2]), true)
  const strict = corrDense(one.values, genes.length, nCols, new Float64Array(rowOf(0)),
    one.detected, 0.5)
  check('and the same gene under a higher floor is not',
    Number.isFinite(strict.r[2]), false)
  check('while the ones that clear it are unaffected',
    [Number.isFinite(strict.r[0]), Number.isFinite(strict.r[1])], [true, true])

  // The reason for normalising at all: a column that is simply deeper must not
  // make every gene in it look correlated with every other.
  const deep = new Int32Array([
    10, 20, 30, 40, 5, 6,
    20, 40, 60, 80, 1, 2,
    0, 0, 0, 7, 9, 9,
  ])
  for (let g = 0; g < 3; g++) deep[g * 6 + 3] *= 50
  const scaled = pseudobulkOn({ genes, columns, counts: deep }, samples, 'T', null)
  const before = rowOf(0)
  const after = Array.from({ length: nCols }, (_v, k) => scaled.values[0 * nCols + k])
  check('multiplying one column through leaves the profile alone',
    after.map(v => +v.toFixed(6)), before.map(v => +v.toFixed(6)))
}

console.log('\nTHE TABLE SHOWS BOTH ENDS')
{
  const genes = ['A', 'B', 'C', 'D', 'E']
  const r = new Float64Array([0.9, -0.8, 0.5, NaN, -0.2])
  const pct = new Float64Array([1, 1, 1, 1, 1])
  const out = rankCorr({ r, pct }, genes, { seedGenes: new Set(['A']), top: 2 })
  check('the positive end is ranked down from the top',
    out.up.map(x => x.gene), ['A', 'C'])
  check('the negative end is ranked up from the bottom',
    out.down.map(x => x.gene), ['B', 'E'])
  check('a gene that was not ranked is in neither', out.tested, 4)
  check('a seed member is marked', out.up[0].member, true)
  const hidden = rankCorr({ r, pct }, genes, {
    seedGenes: new Set(['A']), hideMembers: true, top: 2,
  })
  check('and can be left out entirely', hidden.up.map(x => x.gene), ['C', 'E'])
}

console.log('\nMOMENTS AND STANDARDISATION')
{
  const v = [1, 2, 3, 4]
  const m = moments(v)
  near('mean', m.mean, 2.5)
  near('sd is the population one', m.sd, Math.sqrt(1.25))
  const z = standardise(v)
  let sum = 0, norm = 0
  for (const x of z) { sum += x; norm += x * x }
  near('standardised is centred', sum, 0, 1e-12)
  near('and has unit norm, so a dot product is a correlation', norm, 1, 1e-12)
  check('a constant vector cannot be standardised', standardise([2, 2, 2]), null)
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll co-expression tests passed')
process.exit(failed ? 1 : 0)
