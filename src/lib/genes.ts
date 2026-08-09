// Gene search.
//
// Two jobs: rank the autocomplete so an exact match is never buried, and take a
// pasted list without asking the user to clean it first.

export const MAX_GENES = 24

/** Anything a user pastes between symbols: comma, semicolon, pipe, tab, newline, space. */
export const SEPS = /[\s,;|]+/

/**
 * Autocomplete order: exact, then prefix, then substring; shorter first inside
 * each band. Without the exact-match band, typing `Sox2` puts `Sox21` above it
 * whenever the shorter name sorts later — reported on the bulk studio and fixed
 * there the same way.
 */
export function rankGenes(query: string, genes: string[], limit = 8): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const band = (g: string) => {
    const l = g.toLowerCase()
    return l === q ? 0 : l.startsWith(q) ? 1 : l.includes(q) ? 2 : 3
  }
  return genes
    .map(g => [g, band(g)] as const)
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
 */
export function parseGeneList(text: string, genes: string[]): ParsedList {
  const byLower = lowerIndex(genes)
  const found: string[] = []
  const missing: string[] = []
  for (const raw of text.split(SEPS)) {
    const w = raw.trim()
    if (!w) continue
    const hit = byLower.get(w.toLowerCase())
    if (!hit) { if (!missing.includes(w)) missing.push(w) }
    else if (!found.includes(hit)) found.push(hit)
  }
  return { found, missing }
}

/** Merge new symbols into a selection, keeping the most recent MAX_GENES. */
export const mergeGenes = (current: string[], add: string[]): string[] => {
  const out = [...current]
  for (const g of add) if (!out.includes(g)) out.push(g)
  return out.slice(-MAX_GENES)
}
