// Co-expression: which genes move with a gene, or with a signature.
//
// One pass over the matrix, the same shape as markers and the module score —
// for every gene, accumulate three sums against a seed and throw the values
// away. What makes this file worth reading is not the arithmetic; it is the
// three ways the obvious version of this analysis lies.
//
// 1. SHARED ZEROS. A Pearson correlation across cells on a matrix that is ~1 %
//    dense is mostly a statement about absence: two genes detected in 8 % of
//    cells agree in the other 92 % for no biological reason at all, and come
//    out strongly correlated. Two answers here, and both are on by default: a
//    detection floor, so a gene nobody expresses is never ranked; and pooling,
//    which averages neighbouring cells into metacells and is what makes r mean
//    what a reader thinks it means.
//
// 2. n IS NOT THE SAMPLE SIZE. With 292 495 cells, r = 0.01 has a p around
//    1e-5. Every gene in the object is "significant" and the ranking is
//    unaffected by the p, so this returns r and the detection rate and no
//    p-value at all. Cells from one animal are not independent draws — the same
//    argument the studio already makes for Wilcoxon versus pseudobulk — and a
//    column of 1e-300 next to r = 0.02 would be a number that looks like
//    evidence and is not.
//
// 3. A SET IS NOT ITS MEAN. Averaging a signature's members to make one seed is
//    the version everybody writes first, and it cancels: a pathway holds
//    activators and repressors, the mean is dominated by whichever members are
//    most abundant, and two members that genuinely move in opposite directions
//    subtract. So the set is correlated WITH ITSELF first — see `withinSet` —
//    every member is standardised and given the sign of the leading eigenvector,
//    and only then are they combined.
//
//    The identity that makes that affordable: with each member standardised to
//    unit norm, r(g, m) = <ĝ, ẑ_m>, so a weighted mean of the members' own
//    independent correlations is
//
//        Σ_m w_m s_m r(g, m) = <ĝ, Σ_m w_m s_m ẑ_m>
//
//    which is the correlation of g against ONE composite vector, up to its
//    norm. Correlating each member separately and combining afterwards, and
//    correlating once against the signed composite, are the same number. This
//    file does the second and reports it as the first, because the first is
//    what it means and the second is what fits in one pass.

import type { Conds, NonZeroWalk, Source } from './source.ts'

/* ---------------- the axis a correlation is taken over ---------------- */

/**
 * Which bucket each cell belongs to, and how big each bucket is.
 *
 * One structure for all three modes, because the arithmetic below does not care
 * which it is looking at:
 *
 *   per cell    one bucket per cell in scope, every size 1
 *   pooled      one bucket per metacell, sizes in the tens
 *   pseudobulk  one bucket per (sample x cell type) column — built elsewhere,
 *               from the counts table the bundle already carries
 *
 * `of[cell]` is -1 for a cell outside the scope, which is how "this cell type
 * only" and "this group only" are expressed. Nothing downstream needs to know
 * why a cell was excluded.
 */
export interface Axis {
  of: Int32Array
  size: Int32Array
  n: number
  /** Cells that landed in some bucket — the denominator of a detection rate. */
  nCells: number
  /** True when any bucket holds more than one cell. */
  pooled: boolean
}

/** Every cell of the scope in its own bucket: the per-cell axis. */
export function cellAxis(keep: ArrayLike<number>, nCells: number): Axis {
  const of = new Int32Array(nCells).fill(-1)
  let n = 0
  for (let i = 0; i < nCells; i++) if (keep[i]) of[i] = n++
  return { of, size: new Int32Array(n).fill(1), n, nCells: n, pooled: false }
}

/**
 * Split one block of cells into exactly `k` spatially contiguous, equal parts.
 *
 * Repeated median cuts, but cutting proportionally rather than in half: a block
 * that owes 5 pools is cut into 2 and 3 at the point two fifths of the way
 * along, not into 2 and 2 with one thrown away. The earlier version halved and
 * so could only ever produce a power of two — asking for 300 gave 256, which
 * was tolerable when there was one block and is not once every cell type x
 * sample is its own block: twenty blocks each rounding down is a systematic
 * shortfall in the number of metacells, in the mode whose whole purpose is to
 * have enough of them.
 *
 * The cut is on whichever axis the block is WIDER on, rather than alternating.
 * Alternating is the textbook k-d tree and it is the wrong rule for a block
 * that is long and thin, which a single cell type in a single animal usually
 * is — it would cut across the short axis half the time and produce slivers.
 */
function splitInto(cells: number[], k: number, xy: Float32Array): number[][] {
  if (k <= 1 || cells.length < 2) return [cells]
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const c of cells) {
    const x = xy[2 * c], y = xy[2 * c + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const axis = (x1 - x0) >= (y1 - y0) ? 0 : 1
  const sorted = [...cells].sort((p, q) => xy[2 * p + axis] - xy[2 * q + axis])
  const k1 = k >> 1
  const cut = Math.max(1, Math.min(sorted.length - 1, Math.round((sorted.length * k1) / k)))
  return [
    ...splitInto(sorted.slice(0, cut), k1, xy),
    ...splitInto(sorted.slice(cut), k - k1, xy),
  ]
}

/** A cell may never share a metacell with a cell of another group. */
export type Within = 'none' | 'type' | 'type-sample'

/**
 * Which cells may be pooled together, as one id per cell.
 *
 * hdWGCNA's `group.by`, and the reason it exists: a metacell that averages two
 * cell types is a profile of neither, and one that averages two animals has
 * quietly pooled the replicates that a later claim depends on. Constraining the
 * pooling costs nothing and removes a whole class of artefact — a "co-expression"
 * that is really two populations sitting next to each other on a UMAP.
 */
export function constraintOf(
  cells: readonly { t: number; s: string }[],
  samples: readonly { id: string }[],
  within: Within,
): Int32Array | null {
  if (within === 'none') return null
  const at = new Map(samples.map((s, i) => [s.id, i]))
  const width = Math.max(1, samples.length)
  const out = new Int32Array(cells.length)
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    out[i] = within === 'type' ? c.t : c.t * width + (at.get(c.s) ?? 0)
  }
  return out
}

/**
 * Metacells: the scope's cells split into about `want` pools of equal size.
 *
 * By repeated proportional median cuts of the embedding — see `splitInto`. Two
 * properties matter and a uniform grid has neither: pools hold about the same
 * number of cells, so no pool is a single cell pretending to be a metacell; and
 * pools are spatially contiguous, so averaging them removes dropout noise
 * without averaging away the local structure the correlation is supposed to
 * find.
 *
 * `groups` constrains which cells may share a pool — hdWGCNA's `group.by`. With
 * it, the pool budget is shared out in proportion to each group's size, and a
 * group too small to fill even one pool is dropped from the scope rather than
 * being allowed to stand as a metacell built from four cells. Cells that fall
 * out this way are not silently absorbed: `nCells` counts what was actually
 * used, and the card reports it against the scope.
 *
 * The embedding is the only geometry a bundle carries, and it is a 2-D
 * projection — hdWGCNA builds its metacells by KNN in a reduced space with many
 * more components. That is a real approximation and the card says so. It is
 * still much closer to the truth than correlating across single cells.
 *
 * Deterministic: no randomness anywhere, so the same object and scope give the
 * same pools every time.
 */
export function poolAxis(
  xy: Float32Array, keep: ArrayLike<number>, nCells: number, want: number,
  groups: Int32Array | null = null,
): Axis {
  /**
   * The fewest cells a metacell may be built from.
   *
   * Ten, which is the cell floor the studio already applies before it will
   * build a pseudobulk column — the same judgement about the same question, so
   * it is the same number. It was three, which is defensible for one big
   * unconstrained pool budget and is not once the budget is shared among cell
   * type x sample groups: a rare population in one animal would have produced
   * metacells of three cells, which is not pooling, it is the per-cell mode
   * with a longer name and a claim attached.
   *
   * hdWGCNA aggregates about twenty-five nearest neighbours per metacell, so
   * ten is still permissive — it is a floor, not a target. What sets the actual
   * size is the pool budget against the scope.
   */
  const MIN_PER_POOL = 10

  const byGroup = new Map<number, number[]>()
  let total = 0
  for (let i = 0; i < nCells; i++) {
    if (!keep[i]) continue
    const g = groups ? groups[i] : 0
    let list = byGroup.get(g)
    if (!list) { list = []; byGroup.set(g, list) }
    list.push(i)
    total++
  }
  const of = new Int32Array(nCells).fill(-1)
  if (!total) return { of, size: new Int32Array(0), n: 0, nCells: 0, pooled: true }

  // In a stable order, so the pool numbering does not depend on Map insertion
  // order — which depends on cell order, which is not something a figure should
  // be able to notice.
  const ids = [...byGroup.keys()].sort((a, b) => a - b)
  const size: number[] = []
  let used = 0
  for (const id of ids) {
    const cells = byGroup.get(id)!
    const room = Math.floor(cells.length / MIN_PER_POOL)
    if (room < 1) continue
    // Proportional share of the budget, and never more than the cells can fill.
    const share = Math.max(1, Math.min(room, Math.round((want * cells.length) / total)))
    for (const block of splitInto(cells, share, xy)) {
      if (!block.length) continue
      const b = size.length
      size.push(block.length)
      for (const c of block) of[c] = b
      used += block.length
    }
  }
  return { of, size: Int32Array.from(size), n: size.length, nCells: used, pooled: true }
}

/**
 * Cells aggregated into one column per cell type x level — the axis that needs
 * no counts table.
 *
 * This is what most people mean by "correlate over pseudobulk", and unlike the
 * real pseudobulk path it is available on every object: the columns are built
 * from the expression the studio already reads, by bucketing cells, so nothing
 * has to have been exported for it and nothing has to be held as a dense table.
 * On an atlas that is the difference between having the analysis and not —
 * collection-source.ts drops the exporter's pseudobulk past 12 M values, so the
 * objects large enough to want this are exactly the ones that never had it.
 *
 * It is NOT the same quantity, and the interface must not call it pseudobulk.
 * Real pseudobulk sums raw counts and normalises afterwards; this averages
 * values that are already log-normalised, which is a mean of logs rather than a
 * log of means. Both are defensible summaries of a population and they are not
 * interchangeable, so they are two modes under two names.
 *
 * A column built from a handful of cells is noise wearing a column's clothes,
 * so `minCells` drops it — the same floor, and the same reasoning, as the cell
 * floor pseudobulk DE applies before it will build a column at all.
 */
export function groupAxis(
  cells: readonly { t: number; cond: string; s: string }[],
  keep: ArrayLike<number>,
  levels: readonly string[],
  by: 'cond' | 'sample',
  nTypes: number,
  minCells = 10,
): Axis {
  const at = new Map(levels.map((l, i) => [l, i]))
  const width = Math.max(1, levels.length)
  const raw = new Int32Array(cells.length).fill(-1)
  const count = new Int32Array(nTypes * width)
  for (let i = 0; i < cells.length; i++) {
    if (!keep[i]) continue
    const c = cells[i]
    const li = at.get(by === 'cond' ? c.cond : c.s)
    if (li === undefined || c.t < 0 || c.t >= nTypes) continue
    const k = c.t * width + li
    raw[i] = k
    count[k]++
  }
  // Compacted, so the axis holds only the combinations this object actually
  // has. A cell type x group product is mostly empty on a real annotation —
  // 133 clusters against 20 groups is 2 660 slots and nothing like that many
  // populations — and empty columns would be a column of zeros correlating
  // with every other column of zeros.
  const slot = new Int32Array(nTypes * width).fill(-1)
  const size: number[] = []
  for (let k = 0; k < slot.length; k++) {
    if (count[k] < minCells) continue
    slot[k] = size.length
    size.push(count[k])
  }
  const of = new Int32Array(cells.length).fill(-1)
  let nCells = 0
  for (let i = 0; i < cells.length; i++) {
    if (raw[i] < 0) continue
    const b = slot[raw[i]]
    if (b < 0) continue
    of[i] = b
    nCells++
  }
  return { of, size: Int32Array.from(size), n: size.length, nCells, pooled: true }
}

/* ---------------- the seed, and what a set does to itself ---------------- */

/** Mean and standard deviation of a vector, over its whole length. */
export function moments(v: ArrayLike<number>): { mean: number; sd: number } {
  const n = v.length
  if (!n) return { mean: 0, sd: 0 }
  let s = 0
  for (let i = 0; i < n; i++) s += v[i]
  const mean = s / n
  let ss = 0
  for (let i = 0; i < n; i++) ss += (v[i] - mean) ** 2
  return { mean, sd: Math.sqrt(ss / n) }
}

/**
 * A vector centred and scaled to unit norm, or null when it does not vary.
 *
 * Null rather than a vector of zeros: a gene with the same value in every
 * bucket has no correlation with anything, and saying so is different from
 * saying its correlation is zero.
 */
export function standardise(v: ArrayLike<number>): Float64Array | null {
  const { mean, sd } = moments(v)
  if (!(sd > 1e-12)) return null
  const out = new Float64Array(v.length)
  // Unit NORM, not unit variance: then a dot product of two of these is exactly
  // their Pearson correlation, which is what every formula below relies on.
  const scale = 1 / (sd * Math.sqrt(v.length))
  for (let i = 0; i < v.length; i++) out[i] = (v[i] - mean) * scale
  return out
}

export interface SetShape {
  /** The members that vary enough to be used, by index into what was asked. */
  used: number[]
  /** +1 or -1 per used member: which way it runs against the set's own axis. */
  sign: Float64Array
  /** |loading| per used member — how strongly it belongs. */
  weight: Float64Array
  /** Fraction of the members' variance the leading direction explains. */
  coherence: number
  /** How many used members run against the majority. */
  flipped: number
  /** Mean correlation between members, after signing. Near 1 is one programme. */
  meanR: number
}

/**
 * What a gene set looks like to itself, before it is used as a seed.
 *
 * The leading eigenvector of the members' correlation matrix, by power
 * iteration — WGCNA's module eigengene, computed the cheap way because the
 * matrix is at most a few hundred square. Its signs say which members run with
 * the set's dominant direction and which run against it; its magnitudes say how
 * strongly each belongs.
 *
 * This is the step that stops a set from cancelling itself, and it is also a
 * result in its own right: `coherence` near 1 with no flipped members is one
 * programme, and 0.3 with a third of the members flipped is two programmes that
 * somebody has written down as one set. The card reports both, because a
 * combined score over an incoherent set is a number the reader should not trust
 * without being told.
 *
 * Deterministic: the iteration starts from a fixed vector, not a random one, and
 * the sign convention is fixed by making the largest loading positive — so the
 * same set always gives the same signs rather than the same partition with
 * everything inverted.
 */
export function withinSet(members: (Float64Array | null)[]): SetShape {
  const used: number[] = []
  const vecs: Float64Array[] = []
  members.forEach((v, i) => { if (v) { used.push(i); vecs.push(v) } })
  const m = vecs.length
  const sign = new Float64Array(m).fill(1)
  const weight = new Float64Array(m).fill(1)
  if (m === 0) return { used, sign, weight, coherence: 0, flipped: 0, meanR: 0 }
  if (m === 1) return { used, sign, weight, coherence: 1, flipped: 0, meanR: 1 }

  // The correlation matrix. Each vector is already unit-norm and centred, so a
  // dot product IS the correlation and there is nothing else to divide by.
  const C: Float64Array[] = []
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(m)
    for (let j = 0; j < m; j++) {
      if (j < i) { row[j] = C[j][i]; continue }
      let s = 0
      const a = vecs[i], b = vecs[j]
      for (let k = 0; k < a.length; k++) s += a[k] * b[k]
      row[j] = s
    }
    C.push(row)
  }

  // Power iteration. Fifty passes over a matrix this size is microseconds, and
  // it converges long before that on anything with a dominant direction.
  let v = new Float64Array(m).fill(1 / Math.sqrt(m))
  let lambda = 0
  for (let it = 0; it < 50; it++) {
    const next = new Float64Array(m)
    for (let i = 0; i < m; i++) {
      let s = 0
      const row = C[i]
      for (let j = 0; j < m; j++) s += row[j] * v[j]
      next[i] = s
    }
    let norm = 0
    for (let i = 0; i < m; i++) norm += next[i] * next[i]
    norm = Math.sqrt(norm)
    if (!(norm > 1e-12)) break
    for (let i = 0; i < m; i++) next[i] /= norm
    lambda = norm
    v = next
  }
  // A fixed sign convention, so "flipped" names a minority rather than
  // depending on which way the iteration happened to settle.
  let big = 0
  for (let i = 1; i < m; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i
  const flip = v[big] < 0 ? -1 : 1
  let flipped = 0
  for (let i = 0; i < m; i++) {
    const load = v[i] * flip
    sign[i] = load < 0 ? -1 : 1
    weight[i] = Math.abs(load)
    if (load < 0) flipped++
  }

  // The mean off-diagonal correlation after signing: what the set looks like
  // once its members have been turned the same way round.
  let sum = 0, pairs = 0
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) { sum += C[i][j] * sign[i] * sign[j]; pairs++ }
  }
  return {
    used, sign, weight,
    // The eigenvalue of a correlation matrix runs 0..m, so this is the share of
    // the members' total variance the leading direction accounts for.
    coherence: Math.min(1, Math.max(0, lambda / m)),
    flipped,
    meanR: pairs ? sum / pairs : 1,
  }
}

/**
 * The set as one vector: every member standardised, signed, and weighted.
 *
 * This is the seed a correlation runs against, and by the identity at the top
 * of this file, correlating against it is the same as correlating against each
 * member separately and taking the weighted mean. Members that do not vary are
 * already gone — `withinSet` dropped them.
 */
export function composite(
  members: (Float64Array | null)[], shape: SetShape,
): Float64Array | null {
  const first = members.find(v => v) ?? null
  if (!first) return null
  const out = new Float64Array(first.length)
  shape.used.forEach((mi, i) => {
    const v = members[mi]
    if (!v) return
    const w = shape.sign[i] * shape.weight[i]
    for (let k = 0; k < out.length; k++) out[k] += w * v[k]
  })
  return standardise(out)
}

/* ---------------- the pass ---------------- */

/**
 * Everything the worker needs to correlate every gene against one seed.
 *
 * Structured-cloneable by construction, like every other job: typed arrays and
 * numbers. The seed is already reduced to the axis — one value per bucket — so
 * the worker never has to know whether it is looking at cells, metacells or
 * pseudobulk columns.
 */
export interface CorrSpec {
  bucket: Int32Array
  size: Int32Array
  nBuckets: number
  /** The seed's value per bucket. Standardised on the page; see `standardise`. */
  seed: Float64Array
  /** Cells that are in scope at all — the denominator of the detection rate. */
  nScope: number
  /** A gene detected in fewer than this fraction of them is not ranked. */
  minPct: number
  nGenes: number
  pooled: boolean
}

export interface CorrResult {
  /** Pearson r per gene index. NaN for a gene that was not ranked. */
  r: Float64Array
  /** Fraction of the scope's cells with a non-zero value, per gene index. */
  pct: Float64Array
}

/**
 * The accumulation, per gene, in one pass.
 *
 * Two paths, and the difference is whether a bucket holds one cell or many.
 * Per cell the three sums come straight off the non-zeros and nothing is
 * materialised — which matters, because materialising a 292 495-long vector per
 * gene across 31 053 genes is the whole matrix, one gene at a time. Pooled, the
 * bucket means are needed before anything can be summed, so a dense array as
 * long as the number of POOLS is filled and cleared per gene; at 256 pools that
 * is 256 writes against a gene's worth of non-zeros.
 *
 * A gene absent from a bucket contributes a zero mean, not a missing value: it
 * was measured there and it was not detected, which is a number.
 */
export function corrPlan(spec: CorrSpec) {
  const r = new Float64Array(spec.nGenes).fill(NaN)
  const pct = new Float64Array(spec.nGenes)
  const { bucket, seed, size, nBuckets, pooled } = spec
  const acc = pooled ? new Float64Array(nBuckets) : null
  const floor = Math.max(0, Math.min(1, spec.minPct)) * spec.nScope

  // The seed's own sums, once. It does not change between genes.
  let sSum = 0, sSq = 0
  for (let b = 0; b < nBuckets; b++) { sSum += seed[b]; sSq += seed[b] * seed[b] }
  const sVar = nBuckets * sSq - sSum * sSum

  return {
    visit: (gene: number, each: NonZeroWalk) => {
      let hit = 0
      let gSum = 0, gSq = 0, sg = 0
      if (acc) {
        each((cell, value) => {
          const b = bucket[cell]
          if (b < 0) return
          acc[b] += value
          hit++
        })
        for (let b = 0; b < nBuckets; b++) {
          const mean = acc[b] / size[b]
          gSum += mean
          gSq += mean * mean
          sg += seed[b] * mean
          acc[b] = 0
        }
      } else {
        each((cell, value) => {
          const b = bucket[cell]
          if (b < 0) return
          hit++
          gSum += value
          gSq += value * value
          sg += seed[b] * value
        })
      }
      pct[gene] = spec.nScope ? hit / spec.nScope : 0
      // Ranked only if it clears the floor. NaN, not zero — "not tested" and
      // "tested and uncorrelated" are different answers and the table shows
      // only the first kind of row.
      if (hit < floor) return
      const gVar = nBuckets * gSq - gSum * gSum
      if (!(gVar > 1e-12) || !(sVar > 1e-12)) return
      r[gene] = (nBuckets * sg - sSum * gSum) / Math.sqrt(gVar * sVar)
    },
    done: (): CorrResult => ({ r, pct }),
  }
}

/**
 * The same correlation over a dense matrix that is already in memory.
 *
 * The pseudobulk path: `counts[gene * nCols + col]`, summed per (sample x cell
 * type) column by the exporter. No dropout to fight — a column is thousands of
 * cells added up — but few columns, so a correlation over them is a statement
 * about co-variation ACROSS SAMPLES AND TYPES rather than co-expression across
 * cells. Different question, honestly a better-powered one, and the card names
 * which is on screen.
 *
 * Counts are log-transformed first, and per column rather than raw: a column is
 * a sum over however many cells that sample contributed, so raw counts
 * correlate through library size before they correlate through biology.
 */
export function corrDense(
  values: Float64Array, nGenes: number, nCols: number, seed: Float64Array,
  detected: Float64Array, minPct: number,
): CorrResult {
  const r = new Float64Array(nGenes).fill(NaN)
  let sSum = 0, sSq = 0
  for (let c = 0; c < nCols; c++) { sSum += seed[c]; sSq += seed[c] * seed[c] }
  const sVar = nCols * sSq - sSum * sSum
  for (let g = 0; g < nGenes; g++) {
    if (detected[g] < minPct) continue
    let gSum = 0, gSq = 0, sg = 0
    for (let c = 0; c < nCols; c++) {
      const v = values[g * nCols + c]
      gSum += v
      gSq += v * v
      sg += seed[c] * v
    }
    const gVar = nCols * gSq - gSum * gSum
    if (!(gVar > 1e-12) || !(sVar > 1e-12)) continue
    r[g] = (nCols * sg - sSum * gSum) / Math.sqrt(gVar * sVar)
  }
  return { r, pct: detected }
}

/* ---------------- building the seed off the object ---------------- */

/**
 * The scope, as a mask over every cell.
 *
 * A cell type, a group, both, or neither. Expressed as a mask rather than a
 * list because that is what the axes want, and because "which cells" is the
 * only thing the rest of this file needs to know about a scope.
 */
export function scopeMask(
  src: Source, tis: readonly number[] | null, cond: Conds,
): Uint8Array {
  const cells = src.d.cells
  const keep = new Uint8Array(cells.length)
  const set = cond != null && typeof cond !== 'string' ? new Set(cond) : null
  // A LIST of types, or null for every one of them. It was a single index, so a
  // correlation over "the three cardiomyocyte states" was not askable — and this
  // is a scope, not a contrast, so restricting it is exactly the kind of thing a
  // reader does two or three types at a time.
  //
  // null and an empty list are different on purpose. null is "every cell type",
  // which is the default; empty is "these zero types", which is what the picker
  // holds after the last one is unticked, and it has to mean no cells rather
  // than silently widening to everything.
  const want = tis === null ? null : new Set(tis)
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (want && !want.has(c.t)) continue
    if (set ? !set.has(c.cond) : cond && c.cond !== cond) continue
    keep[i] = 1
  }
  return keep
}

/**
 * Each gene's profile over the axis, standardised.
 *
 * Streamed through `withGenes`, so a set larger than the object will hold in
 * memory is read a window at a time — and only the REDUCED profile is kept, one
 * value per bucket rather than one per cell. That is the whole reason this is
 * safe to call for a two-hundred-gene signature: at 256 pools a profile is 2 kB,
 * where the per-cell version would be 2.3 MB and two hundred of them would be
 * most of a gigabyte.
 *
 * Null for a gene that does not vary across the axis, which `withinSet` then
 * drops — a gene detected nowhere has no direction to contribute.
 */
export async function profilesOn(
  src: Source, axis: Axis, genes: readonly string[],
): Promise<(Float64Array | null)[]> {
  const out: (Float64Array | null)[] = genes.map(() => null)
  const sums = genes.map(() => new Float64Array(axis.n))
  await src.withGenes(genes, (win, at) => {
    for (let k = 0; k < win.length; k++) {
      const acc = sums[at[k]]
      src.forEachNonZero(win[k], (cell, value) => {
        const b = axis.of[cell]
        if (b >= 0) acc[b] += value
      })
    }
  })
  sums.forEach((acc, i) => {
    for (let b = 0; b < axis.n; b++) acc[b] /= axis.size[b]
    out[i] = standardise(acc)
  })
  return out
}

/**
 * The signed composite over an axis too large to hold every member on.
 *
 * The per-cell case. Two streamed passes rather than one, because standardising
 * a member needs its mean and spread before anything can be added up, and
 * holding every member's per-cell vector to get them is the allocation this
 * exists to avoid. Two passes over a few hundred genes is nothing against the
 * pass over all 31 053 that follows.
 *
 * `shape` comes from the POOLED profiles, always — which is deliberate and not
 * a shortcut. Deciding which way a member runs from its per-cell correlations
 * would be deciding it from mostly shared zeros, which is the first thing this
 * file says not to do. Coherence is judged where dropout has been averaged out;
 * the composite is then built wherever the reader asked for it.
 */
export async function compositeOn(
  src: Source, axis: Axis, genes: readonly string[], shape: SetShape,
): Promise<Float64Array | null> {
  const w = new Float64Array(genes.length)
  shape.used.forEach((mi, i) => { w[mi] = shape.sign[i] * shape.weight[i] })

  const sum = new Float64Array(genes.length)
  const sq = new Float64Array(genes.length)
  await src.withGenes(genes, (win, at) => {
    for (let k = 0; k < win.length; k++) {
      const g = at[k]
      if (!w[g]) continue
      let s = 0, q = 0
      src.forEachNonZero(win[k], (cell, value) => {
        if (axis.of[cell] < 0) return
        s += value
        q += value * value
      })
      sum[g] = s
      sq[g] = q
    }
  })

  const n = axis.n
  if (!n) return null
  const out = new Float64Array(n)
  await src.withGenes(genes, (win, at) => {
    for (let k = 0; k < win.length; k++) {
      const g = at[k]
      if (!w[g]) continue
      const mean = sum[g] / n
      const varr = sq[g] / n - mean * mean
      if (!(varr > 1e-24)) continue
      const scale = w[g] / (Math.sqrt(varr) * Math.sqrt(n))
      // Every bucket starts at -mean*scale and the non-zeros add to it, which
      // is the same sum as (x - mean) * scale without walking the zeros.
      const base = -mean * scale
      for (let b = 0; b < n; b++) out[b] += base
      src.forEachNonZero(win[k], (cell, value) => {
        const b = axis.of[cell]
        if (b >= 0) out[b] += value * scale
      })
    }
  })
  return standardise(out)
}

/**
 * The pseudobulk axis: the sample x cell type columns the bundle already holds.
 *
 * No dropout to fight — a column is thousands of cells added up — and no
 * question about independence either, because the columns ARE the replicates.
 * What it buys in honesty it pays for in width: a design with eight animals and
 * nine cell types has 72 columns, and a correlation over 72 observations is a
 * different and much weaker instrument than one over 34 367. It is also a
 * different QUESTION — co-variation across samples and types, not co-expression
 * across cells — and the card says which is on screen.
 *
 * Counts are normalised per column before anything is correlated. A column is a
 * sum over however many cells that sample contributed, so raw counts correlate
 * through library size first and through biology second; every gene would come
 * back correlated with every other.
 */
export function pseudobulkOn(
  pb: { genes: string[]; columns: { sample: string; cluster: string }[]; counts: Int32Array },
  samples: readonly { id: string; cond: string }[],
  /**
   * Which clusters' columns to keep, or null for all of them.
   *
   * A FILTER here, not a sum — unlike the pseudobulk export, which has to add
   * count vectors together to pool clusters. This function correlates ACROSS
   * columns, and a (cluster, sample) column is already an observation, so
   * choosing three clusters simply admits three clusters' worth of columns.
   * More columns is more to correlate over, which is the direction that helps.
   */
  clusters: readonly string[] | null,
  cond: readonly string[] | string | null,
): {
  cols: number[]
  values: Float64Array | null
  detected: Float64Array | null
  at: Map<string, number>
} {
  const condOf = new Map(samples.map(s => [s.id, s.cond]))
  const wantC = clusters === null ? null : new Set(clusters)
  const wantG = cond == null ? null : new Set(typeof cond === 'string' ? [cond] : cond)
  const cols: number[] = []
  pb.columns.forEach((c, i) => {
    if (wantC && !wantC.has(c.cluster)) return
    const g = condOf.get(c.sample)
    if (wantG && (g === undefined || !wantG.has(g))) return
    cols.push(i)
  })
  const at = new Map(pb.genes.map((g, i) => [g, i]))
  // Under three columns there is no correlation to speak of — r over two points
  // is 1 or -1 whatever the data says.
  if (cols.length < 3) return { cols, values: null, detected: null, at }

  const nAll = pb.columns.length
  const nGenes = pb.genes.length
  const total = new Float64Array(cols.length)
  for (let k = 0; k < cols.length; k++) {
    let s = 0
    for (let g = 0; g < nGenes; g++) s += pb.counts[g * nAll + cols[k]]
    total[k] = s || 1
  }
  const values = new Float64Array(nGenes * cols.length)
  const detected = new Float64Array(nGenes)
  for (let g = 0; g < nGenes; g++) {
    let hit = 0
    for (let k = 0; k < cols.length; k++) {
      const c = pb.counts[g * nAll + cols[k]]
      if (c > 0) hit++
      values[g * cols.length + k] = Math.log1p((c / total[k]) * 1e4)
    }
    detected[g] = hit / cols.length
  }
  return { cols, values, detected, at }
}

/* ---------------- reading the answer ---------------- */

export interface CorrRow {
  gene: string
  r: number
  pct: number
  /** True when this gene is one of the seed set's own members. */
  member: boolean
}

/**
 * The ranked table, both ends of it.
 *
 * Both ends, always: a co-expression table that shows only the positive side is
 * half an answer, and the anti-correlated genes are usually the more
 * interesting half — they are what the programme turns off. The seed itself is
 * dropped, because r = 1 with yourself is not a finding; a SET's members are
 * kept and marked, because whether the members come back at the top is how a
 * reader checks that the composite is describing the set it was built from.
 */
export function rankCorr(
  result: CorrResult, genes: readonly string[], opts: {
    seedGenes: ReadonlySet<string>
    /** Drop the seed's own members from the table entirely. */
    hideMembers?: boolean
    top: number
  },
): { up: CorrRow[]; down: CorrRow[]; tested: number } {
  const rows: CorrRow[] = []
  let tested = 0
  for (let g = 0; g < genes.length; g++) {
    const v = result.r[g]
    if (!Number.isFinite(v)) continue
    tested++
    const member = opts.seedGenes.has(genes[g])
    if (member && opts.hideMembers) continue
    rows.push({ gene: genes[g], r: v, pct: result.pct[g], member })
  }
  const byR = [...rows].sort((a, b) => b.r - a.r || a.gene.localeCompare(b.gene))
  return {
    up: byR.slice(0, opts.top),
    down: byR.slice(Math.max(0, byR.length - opts.top)).reverse(),
    tested,
  }
}
