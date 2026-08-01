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
  const bg = new Set(background.map(g => g.toUpperCase()))
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
