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

/** P(X ≥ k) for X ~ Hypergeometric(N, K, n): drawing n from N, K successes total. */
export function hyperTail(k: number, K: number, n: number, N: number): number {
  const maxI = Math.min(K, n)
  const denom = logChoose(N, n)
  let p = 0
  for (let i = k; i <= maxI; i++) p += Math.exp(logChoose(K, i) + logChoose(N - K, n - i) - denom)
  return Math.min(1, Math.max(p, 0))
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
  const universe = new Set<string>()
  for (const s of sets) for (const g of s.genes) universe.add(g.toUpperCase())
  const bg = new Set<string>()
  for (const g of background) {
    const u = g.toUpperCase()
    if (universe.has(u)) bg.add(u)
  }
  const q = new Set(query.map(g => g.toUpperCase()))
  const N = bg.size
  let n = 0
  for (const g of q) if (bg.has(g)) n++
  if (!N || !n) return []

  const raw: Omit<ORAResult, 'padj'>[] = []
  for (const s of sets) {
    if (opts.sources && !opts.sources.has(s.source)) continue
    let K = 0
    const overlap: string[] = []
    for (const gene of s.genes) {
      const g = gene.toUpperCase()
      if (!bg.has(g)) continue
      K++
      if (q.has(g)) overlap.push(gene)
    }
    if (K < opts.minSize || K > opts.maxSize) continue
    const k = overlap.length
    if (k < 1) continue
    raw.push({
      id: s.id, name: s.name, source: s.source,
      setSize: K, count: k, overlap,
      foldEnrichment: (k / n) / (K / N),
      pvalue: hyperTail(k, K, n, N),
    })
  }
  const padj = bh(raw.map(r => r.pvalue))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i] }))
    .sort((a, b) => a.padj - b.padj || b.foldEnrichment - a.foldEnrichment)
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
  for (const g of query) {
    const at = index.idOf.get(g.toUpperCase())
    if (at !== undefined && !inQuery.has(at)) { inQuery.add(at); hit.push(at) }
  }
  const n = inQuery.size
  if (!n) return []

  const counts = new Int32Array(index.sets.length)
  for (const at of hit) {
    const sets = index.bySymbol[at]
    for (let i = 0; i < sets.length; i++) counts[sets[i]]++
  }

  const raw: Omit<ORAResult, 'padj'>[] = []
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
      if (inQuery.has(at)) overlap.push(index.symbols[at])
    }
    raw.push({
      id: s.id, name: s.name, source: s.source,
      setSize: s.K, count: k, overlap,
      foldEnrichment: (k / n) / (s.K / N),
      pvalue: hyperTail(k, s.K, n, N),
    })
  }
  const padj = bh(raw.map(r => r.pvalue))
  return raw
    .map((r, i) => ({ ...r, padj: padj[i] }))
    .sort((a, b) => a.padj - b.padj || b.foldEnrichment - a.foldEnrichment)
}
