import type { SetIndex } from './msigdb.ts'

// Over-representation analysis.
//
// Ported from rnaseq-studio unchanged: a one-sided hypergeometric test per set,
// Benjamini–Hochberg across the sets actually tested. The only single-cell
// difference is what feeds it — a DEG list from whichever test is selected —
// and what the background is: the genes the object measured, never the whole
// genome, because testing against genes your assay could not detect inflates
// every enrichment.

export interface GeneSetDef {
  source: string
  id: string
  name: string
  genes: string[]
}

// Lanczos approximation, g = 5, n = 6 (Numerical Recipes §6.1). Two of the
// published literals are written here at the precision a double actually
// stores (…678 and …007, not …677 and …005), so the source says what runs.
const LG = [
  76.18009172947146, -86.50532032941678, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
]
const SER0 = 1.000000000190015
const SQRT_2PI = 2.5066282746310007

function logGamma(x: number): number {
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = SER0
  for (let j = 0; j < 6; j++) ser += LG[j] / ++y
  return -tmp + Math.log((SQRT_2PI * ser) / x)
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
}

/**
 * ln P(X ≥ k) for X ~ Hypergeometric(N, K, n): drawing n from N, K successes.
 *
 * The terms are formed in log space — they have to be, since each is a ratio of
 * factorials of tens of thousands — and this sums them there too, rather than
 * exponentiating each one and adding. That is the same discipline `stats.ts`
 * applies to the DE p-values, and it is here for the same reason: a set almost
 * entirely contained in the query has a tail below 1e-308, and adding those
 * terms in linear space returns exactly 0. Not a small number — zero. p = 0
 * makes padj 0, and padj is the sort key, so the strongest results in the table
 * arrive tied at the top in whatever order the library happened to store them.
 *
 * Log-sum-exp, factoring out the largest term so the exponentials that remain
 * are all ≤ 1. The largest is the first: the hypergeometric pmf is decreasing
 * in i past its mode, and the tail is summed from k upward with k at or above
 * the mode whenever the set is enriched — which is the only case that matters
 * here, since this is the one-sided over-representation tail.
 */
export function logHyperTail(k: number, K: number, n: number, N: number): number {
  const maxI = Math.min(K, n)
  if (k > maxI) return -Infinity
  const denom = logChoose(N, n)
  let max = -Infinity
  const terms: number[] = []
  for (let i = k; i <= maxI; i++) {
    const t = logChoose(K, i) + logChoose(N - K, n - i) - denom
    terms.push(t)
    if (t > max) max = t
  }
  if (max === -Infinity) return -Infinity
  let sum = 0
  for (const t of terms) sum += Math.exp(t - max)
  return Math.min(0, max + Math.log(sum))
}

/**
 * P(X ≥ k), as a double.
 *
 * Kept, because a p-value is what a reader expects to see in a column and what
 * a CSV should carry. It underflows to 0 below ~1e-308 and that is fine — what
 * must not happen is for the SORT to underflow with it, which is why `nlp`
 * below is carried alongside and is what the results are ordered on.
 */
export function hyperTail(k: number, K: number, n: number, N: number): number {
  return Math.min(1, Math.max(Math.exp(logHyperTail(k, K, n, N)), 0))
}

/** Benjamini–Hochberg adjusted p-values, returned in the input order. */
export function bh(ps: number[]): number[] {
  const m = ps.length
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0])
  const adj = new Array<number>(m)
  let prev = 1
  for (let rank = m - 1; rank >= 0; rank--) {
    const [p, idx] = order[rank]
    prev = Math.min(prev, (p * m) / (rank + 1))
    adj[idx] = prev
  }
  return adj
}

/**
 * The same step-up, on −log₁₀ p instead of p.
 *
 * Identical arithmetic seen through a monotone transform: BH multiplies by
 * m/(rank+1), which in −log₁₀ is a subtraction of log₁₀(m/(rank+1)), and its
 * running minimum over p becomes a running maximum over −log₁₀ p. Doing it this
 * way is what lets a set with p = 1e-450 keep a distinct adjusted significance
 * instead of joining every other underflowed set at zero.
 *
 * Input must be ordered by the same key `bh` would order by — which it is, since
 * −log₁₀ p is decreasing in p.
 */
export function bhNlp(nlps: number[]): number[] {
  const m = nlps.length
  // Descending nlp is ascending p, so rank 0 is the smallest p.
  const order = nlps.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])
  const adj = new Array<number>(m)
  let prev = 0
  for (let rank = m - 1; rank >= 0; rank--) {
    const [v, idx] = order[rank]
    prev = Math.max(prev, Math.max(0, v - Math.log10(m / (rank + 1))))
    adj[idx] = prev
  }
  return adj
}

export interface ORAResult {
  id: string
  name: string
  source: string
  /** Set genes present in the background (K). */
  setSize: number
  /** Query genes in the set (k). */
  count: number
  overlap: string[]
  foldEnrichment: number
  pvalue: number
  padj: number
  /**
   * −log₁₀ of the raw p, and after BH, −log₁₀ of the adjusted p.
   *
   * Carried because `pvalue` and `padj` are doubles and a strongly enriched set
   * against a large background lands below what a double holds. The same pair
   * the DE tables carry for the same reason — see significance.ts, which is
   * where the argument is written out.
   */
  nlp: number
  nlpAdj: number
}

export interface ORAOpts {
  minSize: number
  maxSize: number
  sources?: Set<string>
}

export function runORA(
  query: string[],
  sets: GeneSetDef[],
  background: string[],
  opts: ORAOpts = { minSize: 3, maxSize: 500 },
): ORAResult[] {
  // The ANNOTATED background: genes this object tested that are in at least one
  // set. Not every tested gene.
  //
  // This is rnaseq-studio's rule, and it was worth going and reading rather
  // than deciding again — that app computes `background` as the tested genes
  // intersected with the union of every set's members, and calls it "the
  // annotated background" on screen. It is also what g:Profiler and DAVID do.
  // This function used to take N as the whole tested list, which quietly gave
  // the two sibling studios different p-values for the same contrast against
  // the same collection.
  //
  // Over every set GIVEN, not every set `opts.sources` will let through. That
  // asymmetry is deliberate and was worth resolving rather than assuming: a
  // review read it as a bug, and narrowing the universe to the filtered sources
  // made this function disagree with `oraIndexed` — which builds N from the
  // collections it was CONSTRUCTED with and treats `sources` purely as a
  // post-filter. The equivalence of those two is the invariant the suite
  // protects, so the convention is fixed here to match the index.
  //
  // It is also the right convention for how the studio actually works. The
  // reader's control is the collection toggle, and switching one off rebuilds
  // the index — N moves with it, as it must. `opts.sources` narrows what is
  // REPORTED out of an already-built background; it is not a second way to
  // choose the population, and treating it as one would silently give the same
  // reader two different p-values for one contrast depending on which control
  // they reached for.
  const universe = new Set<string>()
  for (const s of sets) for (const g of s.genes) universe.add(g.toUpperCase())
  const bg = new Set<string>()
  for (const g of background) {
    const u = g.toUpperCase()
    if (universe.has(u)) bg.add(u)
  }
  /**
   * Upper-cased query gene -> the spelling the caller used.
   *
   * A Set of upper-cased names would lose that, and the overlap has to come
   * back in the reader's own vocabulary: the term-detail table joins it against
   * the object's DE rows, and a foreign casing fails that join silently. First
   * spelling wins, so the answer does not depend on the order of the list.
   */
  const q = new Map<string, string>()
  for (const g of query) {
    const u = g.toUpperCase()
    if (!q.has(u)) q.set(u, g)
  }
  const N = bg.size
  let n = 0
  for (const g of q.keys()) if (bg.has(g)) n++
  if (!N || !n) return []

  const raw: Omit<ORAResult, 'padj' | 'nlpAdj'>[] = []
  for (const s of sets) {
    if (opts.sources && !opts.sources.has(s.source)) continue
    let K = 0
    const overlap: string[] = []
    for (const gene of s.genes) {
      const g = gene.toUpperCase()
      if (!bg.has(g)) continue
      K++
      const asked = q.get(g)
      if (asked !== undefined) overlap.push(asked)
    }
    if (K < opts.minSize || K > opts.maxSize) continue
    const k = overlap.length
    if (k < 1) continue
    raw.push({
      id: s.id, name: s.name, source: s.source,
      setSize: K, count: k, overlap,
      foldEnrichment: (k / n) / (K / N),
      pvalue: hyperTail(k, K, n, N),
      nlp: Math.max(0, -logHyperTail(k, K, n, N) / Math.LN10),
    })
  }
  // Both, and the order is taken from the one that survives underflow. They are
  // the same step-up on the same ranking, so padj stays the number a reader can
  // quote while nlpAdj is the number the table can be sorted by.
  const padj = bh(raw.map(r => r.pvalue))
  const nlpAdj = bhNlp(raw.map(r => r.nlp))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i], nlpAdj: nlpAdj[i] }))
    .sort((a, b) => b.nlpAdj - a.nlpAdj || b.foldEnrichment - a.foldEnrichment)
}

/**
 * The same test, over a library that has already met the object.
 *
 * `runORA` above walks every gene of every set and upper-cases as it goes. That
 * was free across the eighteen hand-written sets this app used to ship; across
 * MSigDB's 20 454 human sets it is about 1.6 million string operations, and it
 * runs again on every drag of a threshold slider.
 *
 * So the part that depends only on the object is hoisted into `indexFor`, and
 * what is left here is a walk over the query: for each query gene, the sets it
 * belongs to. A DEG list touches a fraction of the library, and the sets it
 * never touches cannot have k >= 1 and were never going to be reported.
 *
 * This must agree with `runORA` exactly, not approximately — scripts/test-sets.mjs
 * asserts they return identical results on the same data, because an
 * optimisation that quietly changes a p-value is a worse bug than a slow page.
 */
export function oraIndexed(
  query: string[],
  index: SetIndex,
  opts: ORAOpts = { minSize: 3, maxSize: 500 },
): ORAResult[] {
  // N is the annotated background — see SetIndex.N and runORA above. n counts
  // the query genes inside it, which is the same rule applied to the same set,
  // so the two describe one population.
  const N = index.N
  if (!N) return []

  const hit: number[] = []
  const inQuery = new Set<number>()
  /** Row -> the spelling the caller used, so the overlap can join back to it. */
  const queryOf = new Map<number, string>()
  for (const g of query) {
    const at = index.idOf.get(g.toUpperCase())
    if (at !== undefined && !inQuery.has(at)) {
      inQuery.add(at)
      hit.push(at)
      queryOf.set(at, g)
    }
  }
  const n = inQuery.size
  if (!n) return []

  const counts = new Int32Array(index.sets.length)
  for (const at of hit) {
    const sets = index.bySymbol[at]
    for (let i = 0; i < sets.length; i++) counts[sets[i]]++
  }

  const raw: Omit<ORAResult, 'padj' | 'nlpAdj'>[] = []
  for (let i = 0; i < counts.length; i++) {
    const k = counts[i]
    if (k < 1) continue
    const s = index.sets[i]
    if (opts.sources && !opts.sources.has(s.source)) continue
    if (s.K < opts.minSize || s.K > opts.maxSize) continue
    // Only now, and only for a set that will be reported. Walked in member
    // order so the overlap column reads the same way runORA writes it.
    const overlap: string[] = []
    for (let j = 0; j < s.members.length; j++) {
      const at = s.members[j]
      // The QUERY's spelling, not the library's.
      //
      // `index.symbols[at]` is how the collection spells the gene, and the
      // term-detail table joins the overlap back against the object's own DE
      // rows. On an object whose genes are upper-cased while the library is
      // title-cased — a mouse matrix indexed by accessions, a human GMT scored
      // on a mouse object — every join missed and a term reporting "120/197
      // genes" showed an empty table. k, K, N and p were all correct; only the
      // member list was unusable.
      if (inQuery.has(at)) overlap.push(queryOf.get(at) ?? index.symbols[at])
    }
    raw.push({
      id: s.id, name: s.name, source: s.source,
      setSize: s.K, count: k, overlap,
      foldEnrichment: (k / n) / (s.K / N),
      pvalue: hyperTail(k, s.K, n, N),
      nlp: Math.max(0, -logHyperTail(k, s.K, n, N) / Math.LN10),
    })
  }
  // Both, and the order is taken from the one that survives underflow. They are
  // the same step-up on the same ranking, so padj stays the number a reader can
  // quote while nlpAdj is the number the table can be sorted by.
  const padj = bh(raw.map(r => r.pvalue))
  const nlpAdj = bhNlp(raw.map(r => r.nlp))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i], nlpAdj: nlpAdj[i] }))
    .sort((a, b) => b.nlpAdj - a.nlpAdj || b.foldEnrichment - a.foldEnrichment)
}
