// The gene-set library: real MSigDB, read from the assets scripts/fetch-genesets.mjs builds.
//
// This replaced eighteen gene sets written by hand. They were honest about
// being a demo collection, but an enrichment run against eighteen sets is not
// an enrichment analysis — it cannot fail to find something, and it cannot find
// anything that was not already anticipated by whoever typed the list.
//
// Two things are kept apart here on purpose:
//
//   parse()   pure, synchronous, testable in node — text in, collection out
//   load()    fetch + gunzip + parse, cached, browser only
//
// The tests run under node with no DOM and no network, so everything that has
// a right answer is in the first one.

import { gunzipSync } from 'fflate'

/** One MSigDB collection for one species, as it sits in memory. */
export interface Collection {
  species: string
  source: string
  /** The MSigDB release these sets came from, e.g. "2024.1.Mm". */
  release: string
  /** Symbols as MSigDB spells them for this species — Gfap for mouse, GFAP for human. */
  symbols: string[]
  sets: CollectionSet[]
}

export interface CollectionSet {
  /** MSigDB's systematic name, e.g. GOBP_MITOTIC_CELL_CYCLE. What the CSV carries. */
  id: string
  /** The same name made readable. What the screen shows. */
  name: string
  /** Indices into `symbols`. */
  genes: Int32Array
}

export interface ManifestSource {
  source: string
  file: string
  nSets: number
  nGenes: number
  bytes: number
  /** Enabled the first time an object of this species is opened. */
  on: boolean
  /**
   * Not a native annotation for this species — human sets mapped through
   * orthologs. Only mouse KEGG, and only because no native one is
   * distributable. Carried this far so the interface can say so.
   */
  projected?: boolean
}

export interface Manifest {
  generated: string
  species: Record<string, {
    label: string
    /** The binomial, for the Methods text — "Mus musculus", not "mouse". */
    taxon: string
    release: string
    sources: ManifestSource[]
  }>
}

/**
 * The compact format, parsed.
 *
 * Line 1  MSIG1 \t species \t source \t release \t nSets \t nGenes
 * Line 2  every symbol, tab separated — written once, referred to by index
 * Line n  id \t name \t comma-separated indices
 *
 * A symbol dictionary rather than repeated text because a gene belongs to many
 * sets: Actb is in 349 of mouse GO:BP's 7 713. Writing it once and pointing at
 * it is most of the saving, and the indices gzip better than the names would.
 */
export function parse(text: string): Collection {
  const nl1 = text.indexOf('\n')
  const nl2 = text.indexOf('\n', nl1 + 1)
  if (nl1 < 0 || nl2 < 0) throw new Error('gene set file is truncated')

  const head = text.slice(0, nl1).split('\t')
  if (head[0] !== 'MSIG1') throw new Error(`unknown gene set format ${JSON.stringify(head[0])}`)
  const [, species, source, release, nSetsTxt, nGenesTxt] = head

  const symbols = text.slice(nl1 + 1, nl2).split('\t')
  if (symbols.length !== Number(nGenesTxt)) {
    throw new Error(`gene set file claims ${nGenesTxt} symbols and carries ${symbols.length}`)
  }

  const sets: CollectionSet[] = []
  let at = nl2 + 1
  while (at < text.length) {
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    if (end > at) {
      const t1 = text.indexOf('\t', at)
      const t2 = text.indexOf('\t', t1 + 1)
      if (t1 > 0 && t2 > t1) {
        const idxTxt = text.slice(t2 + 1, end)
        // Parsed by hand rather than split(',').map(Number): a collection is up
        // to half a million indices and the intermediate array of strings is
        // the expensive part, not the arithmetic.
        let n = 1
        for (let i = 0; i < idxTxt.length; i++) if (idxTxt.charCodeAt(i) === 44) n++
        const genes = new Int32Array(n)
        let v = 0, k = 0
        for (let i = 0; i < idxTxt.length; i++) {
          const c = idxTxt.charCodeAt(i)
          if (c === 44) { genes[k++] = v; v = 0 } else v = v * 10 + (c - 48)
        }
        genes[k] = v
        sets.push({ id: text.slice(at, t1), name: text.slice(t1 + 1, t2), genes })
      }
    }
    at = end + 1
  }
  if (sets.length !== Number(nSetsTxt)) {
    throw new Error(`gene set file claims ${nSetsTxt} sets and carries ${sets.length}`)
  }
  return { species, source, release, symbols, sets }
}

/* ---------------------------------------------------------------------------
   The background-restricted index.

   ORA used to walk every gene of every set on every call, upper-casing as it
   went. That was free across eighteen sets; across the 20 454 human sets it is
   about 1.6 million string operations per keystroke on a threshold slider.

   So the work that depends only on the OBJECT is done once, when a collection
   meets it: which sets survive the background, how many of each survive (K),
   and which sets each background gene belongs to. A query then touches only
   the sets its own genes are in, which for a real DEG list is a small fraction
   of the library.
--------------------------------------------------------------------------- */

export interface IndexedSet {
  /** MSigDB's systematic name. What the CSV carries. */
  id: string
  /** The readable name. What the screen shows. */
  name: string
  source: string
  /** Members present in this object's background — ORA's K. */
  K: number
  /** Those members, as indices into `SetIndex.symbols`. */
  members: Int32Array
}

export interface SetIndex {
  species: string
  release: string
  sources: string[]
  sets: IndexedSet[]
  /** Background symbols that are in at least one set, in the library's casing. */
  symbols: string[]
  /** The same symbols upper-cased, same order. */
  upper: string[]
  /** Upper-cased symbol -> its index in `symbols`. */
  idOf: Map<string, number>
  /** Symbol index -> the sets containing it. */
  bySymbol: Int32Array[]
  /**
   * ORA's N: the ANNOTATED background.
   *
   * The genes this object tested that are in at least one set — not every gene
   * it tested. This is rnaseq-studio's rule, read out of that app rather than
   * decided again here, and it is what g:Profiler and DAVID use. It equals
   * `symbols.length`, because a symbol only enters this index by being in both.
   */
  N: number
}

/**
 * Fold one or more collections against the genes an object actually measured.
 *
 * The background is the object's genes, never the whole genome: testing against
 * genes the assay could not detect inflates every enrichment it produces.
 *
 * Members are held as integer indices rather than strings. A gene sits in many
 * sets, so the string form would be stored 1.6 million times over the human
 * library; an Int32Array of indices into one shared table is a quarter of the
 * memory and turns the inner loop of ORA into integer comparisons.
 */
export function indexFor(collections: Collection[], background: string[]): SetIndex {
  const bgUpper = new Set<string>()
  for (const g of background) bgUpper.add(g.toUpperCase())

  const symbols: string[] = []
  const upper: string[] = []
  const idOf = new Map<string, number>()
  const sets: IndexedSet[] = []
  const sources: string[] = []
  const hits: number[][] = []
  let species = '', release = ''

  for (const c of collections) {
    species ||= c.species
    release ||= c.release
    if (!sources.includes(c.source)) sources.push(c.source)
    // Per collection, because the same index means different symbols in each.
    const seen = new Int32Array(c.symbols.length).fill(-1)
    const idxOfMember = (gi: number): number => {
      const cached = seen[gi]
      if (cached >= 0) return cached
      const sym = c.symbols[gi]
      const u = sym.toUpperCase()
      if (!bgUpper.has(u)) return (seen[gi] = -2)
      let at = idOf.get(u)
      if (at === undefined) {
        at = symbols.length
        symbols.push(sym)
        upper.push(u)
        idOf.set(u, at)
        hits.push([])
      }
      return (seen[gi] = at)
    }
    for (const s of c.sets) {
      const members: number[] = []
      for (let i = 0; i < s.genes.length; i++) {
        const at = idxOfMember(s.genes[i])
        if (at >= 0) members.push(at)
      }
      if (!members.length) continue
      const at = sets.length
      sets.push({ id: s.id, name: s.name, source: c.source, K: members.length,
        members: Int32Array.from(members) })
      for (const m of members) hits[m].push(at)
    }
  }

  return {
    species, release, sources, sets, symbols, upper, idOf,
    bySymbol: hits.map(h => Int32Array.from(h)),
    N: symbols.length,
  }
}

/* ---------------------------------------------------------------------------
   Loading, in the browser.
--------------------------------------------------------------------------- */

// `import.meta.env.BASE_URL` is what vite substitutes for the `base: './'` in
// vite.config.ts, so this resolves under a GitHub Pages sub-path as well as at
// a domain root.
const base = () => {
  const env = (import.meta as { env?: { BASE_URL?: string } }).env
  return env?.BASE_URL ?? './'
}

let manifest: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  manifest ??= fetch(`${base()}genesets/manifest.json`).then(r => {
    if (!r.ok) throw new Error(`gene set manifest: ${r.status} ${r.statusText}`)
    return r.json() as Promise<Manifest>
  })
  return manifest
}

// Per file, and kept for the life of the tab: a collection is the same bytes
// whatever object is open, and re-reading 1.4 MB to switch back to a source you
// had a minute ago is a delay with nothing behind it.
const cache = new Map<string, Promise<Collection>>()

export function loadCollection(file: string): Promise<Collection> {
  let got = cache.get(file)
  if (!got) {
    got = fetch(`${base()}genesets/${file}`)
      .then(async r => {
        if (!r.ok) throw new Error(`${file}: ${r.status} ${r.statusText}`)
        const gz = new Uint8Array(await r.arrayBuffer())
        return parse(new TextDecoder().decode(gunzipSync(gz)))
      })
      .catch(e => { cache.delete(file); throw e })
    cache.set(file, got)
  }
  return got
}

/** Whether a collection is already in hand, so a caller can skip a spinner. */
export const isLoaded = (file: string) => cache.has(file)
