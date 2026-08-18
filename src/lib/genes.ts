// Gene names and gene search.
//
// Three jobs: decide what a row of the matrix is CALLED, rank the autocomplete
// so an exact match is never buried, and take a pasted list without asking the
// user to clean it first.

/**
 * How many genes one panel may hold.
 *
 * 24 was the cap for as long as the tab drew one figure per gene at a readable
 * size, and it is the wrong number for the two figures that draw a COLUMN per
 * gene: a dot plot and a per-gene heatmap of a marker panel are routinely
 * fifty to a hundred genes, and the cap turned a pasted list into a silent
 * truncation of its own tail — `mergeGenes` keeps the most recent, so the
 * genes dropped were the ones at the START of what the reader pasted.
 *
 * The cost is bounded by what a source can answer for, not by this: a
 * collection refuses an `ensure` past its gene budget and says so, and the
 * violin and feature panels stay one figure per gene, which is the reader's
 * choice to make and their scroll to pay.
 */
export const MAX_GENES = 100

/* ---------------- what a row is called ---------------- */

export type GeneIdKind = 'accession' | 'symbol' | 'mixed'

/**
 * The two names a row of the matrix can have, and which one is shown.
 *
 * An object indexed by Ensembl accessions is unreadable — every table says
 * ENSMUSG00000074637 where it means Sox2, and every gene set silently matches
 * nothing because the sets are written in symbols. The exporter carries the
 * symbols alongside the accessions when the file has them, so the conversion is
 * BY INDEX and needs no lookup table: no species assumption, nothing to go
 * stale.
 *
 * `display` is what the rest of the studio calls a gene — it is what
 * `Source.genes` holds, so every table, every plot, every gene set and every
 * worker message speaks in symbols with no further change. `other` is the
 * naming that is not shown, kept so the accession stays visible and searchable:
 * a symbol is not a stable identifier and must not be the only thing on screen.
 *
 * Nothing is merged. Several accessions genuinely map to one symbol (71 on the
 * developing-mouse atlas); summing them would put two genes' expression under
 * one name. Instead the rows that collide get their accession into the display
 * name, so every row stays reachable and no lookup can silently pick one of two.
 */
export interface GeneNames {
  /** Display name of each row, in row order. Unique — this is `Source.genes`. */
  display: string[]
  /** The display name before collisions were disambiguated. */
  bare: string[]
  /** The other naming of each row, or null when the object had only one. */
  other: string[] | null
  /** What the file's own gene index held. null when the exporter did not say. */
  idKind: GeneIdKind | null
  /** What `other` holds — the opposite naming. null when there is no alias. */
  aliasKind: 'symbol' | 'accession' | null
  /** The var / feature column the alias came from. */
  aliasColumn: string | null
  /** Rows whose bare name is shared with at least one other row. */
  duplicated: number
  /** Rows the object had no alias for; those keep the name the matrix is indexed by. */
  missing: number
  /** True when the display name is not the name the matrix is indexed by. */
  renamed: boolean
  /**
   * Every row matching one word, on EITHER naming, as display names.
   *
   * A list rather than one hit because a symbol can name several rows, and
   * picking one of them silently is the failure this whole file exists to
   * avoid — the caller decides what to do with two.
   */
  match(word: string): string[]
}

export interface AliasInfo {
  idKind?: GeneIdKind
  aliasKind?: 'symbol' | 'accession'
  aliasColumn?: string
  /** Rows the object had no alias for, as counted by the exporter. */
  missing?: number
}

export function makeGeneNames(
  ids: string[], alias: string[] | null, info: AliasInfo = {},
): GeneNames {
  const aliasKind = alias ? info.aliasKind ?? 'symbol' : null
  // When the alias holds the symbols, the symbols are what to show; when the
  // rows are already symbols the alias is the accession and stays in reserve.
  const bare = aliasKind === 'symbol' && alias ? alias : ids
  const other = alias ? (aliasKind === 'symbol' ? ids : alias) : null

  const count = new Map<string, number>()
  for (const b of bare) count.set(b, (count.get(b) ?? 0) + 1)

  let duplicated = 0
  const display = bare.map((b, i) => {
    if ((count.get(b) ?? 0) < 2) return b
    duplicated++
    const o = other?.[i]
    // `o !== b` matters for the rows that had no alias at all: the exporter
    // repeats the row id there, and "X (X)" would be noise.
    return o && o !== b ? `${b} (${o})` : b
  })

  // Last resort, so that a name always identifies exactly one row. Reached only
  // if two rows share BOTH namings, which no real object should — but a name
  // that maps to two rows makes one of them permanently unreadable, and that is
  // not a failure worth risking on "should".
  const seen = new Set<string>()
  for (let i = 0; i < display.length; i++) {
    if (!seen.has(display[i])) { seen.add(display[i]); continue }
    let k = 2
    while (seen.has(`${display[i]} #${k}`)) k++
    display[i] = `${display[i]} #${k}`
    seen.add(display[i])
  }

  // Built on first use: on the atlas this is three 31 053-entry passes, and an
  // object whose names are never searched should not pay for them.
  let index: Map<string, number[]> | null = null
  const build = () => {
    const m = new Map<string, number[]>()
    const put = (k: string, i: number) => {
      const key = k.toLowerCase()
      const at = m.get(key)
      if (!at) m.set(key, [i])
      else if (at[at.length - 1] !== i) at.push(i)
    }
    for (let i = 0; i < ids.length; i++) {
      put(display[i], i)
      put(bare[i], i)
      if (other) put(other[i], i)
    }
    return m
  }

  return {
    display, bare, other,
    idKind: info.idKind ?? null,
    aliasKind,
    aliasColumn: alias ? info.aliasColumn ?? null : null,
    duplicated,
    missing: alias ? info.missing ?? 0 : 0,
    renamed: aliasKind === 'symbol',
    match(word) {
      index ??= build()
      return (index.get(word.trim().toLowerCase()) ?? []).map(i => display[i])
    },
  }
}

/** Anything a user pastes between symbols: comma, semicolon, pipe, tab, newline, space. */
export const SEPS = /[\s,;|]+/

/**
 * Autocomplete order: exact, then prefix, then substring; shorter first inside
 * each band. Without the exact-match band, typing `Sox2` puts `Sox21` above it
 * whenever the shorter name sorts later — reported on the bulk studio and fixed
 * there the same way.
 *
 * With `names`, every name a row has is ranked: the symbol, the accession, and
 * the disambiguated display name. Ranking the display name alone is not enough —
 * on an object where two rows share the symbol Gene2 their display names are
 * `Gene2 (ENSMUSG…)`, which only PREFIX-matches "Gene2", so `Gene20` sorted
 * above the two rows the user was actually asking for. The row still comes back
 * under its display name: the caller asks the Source for values by that name and
 * must not be handed a second vocabulary.
 */
export function rankGenes(
  query: string, genes: string[], limit = 8, names?: GeneNames | null,
): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const of = (g: string) => {
    const l = g.toLowerCase()
    return l === q ? 0 : l.startsWith(q) ? 1 : l.includes(q) ? 2 : 3
  }
  const band = (g: string, i: number) => {
    let b = of(g)
    if (b === 0 || !names) return b
    if (names.bare[i] !== undefined) b = Math.min(b, of(names.bare[i]))
    if (b !== 0 && names.other?.[i] !== undefined) b = Math.min(b, of(names.other[i]))
    return b
  }
  return genes
    .map((g, i) => [g, band(g, i)] as const)
    .filter(([, b]) => b < 3)
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([g]) => g)
}

/**
 * The gene list keyed by its own lower-cased names, remembered per list.
 *
 * Every case-insensitive lookup in the studio wants this map, and rebuilding it
 * is 31 053 `toLowerCase` calls and a 31 053-entry Map. The gene-set box does
 * that on every keystroke; before this it did it three times per keystroke. The
 * list belongs to a Source and never changes, so neither does the map.
 */
const LOWER = new WeakMap<readonly string[], Map<string, string>>()

export function lowerIndex(genes: readonly string[]): Map<string, string> {
  let hit = LOWER.get(genes)
  if (!hit) { hit = new Map(genes.map(g => [g.toLowerCase(), g])); LOWER.set(genes, hit) }
  return hit
}

/** The same list keyed by its exact names, for turning a name into an index. */
const INDEX = new WeakMap<readonly string[], Map<string, number>>()

export function geneIndex(genes: readonly string[]): Map<string, number> {
  let hit = INDEX.get(genes)
  if (!hit) { hit = new Map(genes.map((g, i) => [g, i])); INDEX.set(genes, hit) }
  return hit
}

export interface ParsedList {
  /** Resolved to the object's own capitalisation, in the order given, deduplicated. */
  found: string[]
  /** Symbols with no match, as the user typed them. */
  missing: string[]
}

/**
 * Resolve a pasted list.
 *
 * Matching is case-insensitive because a list copied out of a paper or a
 * spreadsheet is rarely cased the way the matrix is — and a silent zero-result
 * search is the worst possible answer to `ASCL1` in a mouse object.
 *
 * With `names`, either naming resolves: a list of symbols opens an
 * accession-indexed object, and a list of accessions still works after the rows
 * have been renamed to symbols. A word that names several rows brings back all
 * of them, so nothing is dropped without the user seeing it.
 */
export function parseGeneList(
  text: string, genes: string[], names?: GeneNames | null,
): ParsedList {
  const byLower = lowerIndex(genes)
  const found: string[] = []
  const missing: string[] = []
  for (const raw of text.split(SEPS)) {
    const w = raw.trim()
    if (!w) continue
    const hits = names ? names.match(w) : []
    if (!hits.length) {
      const hit = byLower.get(w.toLowerCase())
      if (!hit) { if (!missing.includes(w)) missing.push(w) }
      else if (!found.includes(hit)) found.push(hit)
      continue
    }
    for (const h of hits) if (!found.includes(h)) found.push(h)
  }
  return { found, missing }
}

/** Merge new symbols into a selection, keeping the most recent MAX_GENES. */
export const mergeGenes = (current: string[], add: string[]): string[] => {
  const out = [...current]
  for (const g of add) if (!out.includes(g)) out.push(g)
  return out.slice(-MAX_GENES)
}
