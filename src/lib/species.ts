// Which organism an object is from, decided from the object rather than asked.
//
// It has to be decided because the gene sets are per species and MSigDB spells
// the same gene two ways — GFAP for human, Gfap for mouse. Load the wrong
// library and every set comes back with an empty overlap: not an error, just a
// silent, complete absence of results, which is the worst way for this to fail.
//
// Two signals, in order of how much they can be trusted.

export type Species = 'human' | 'mouse'

export interface Detection {
  species: Species
  /**
   * How the call was made, in the words the interface shows. This is displayed,
   * not logged: a reader who disagrees with the guess needs to know what it was
   * based on before they override it.
   */
  why: string
  /** 'accession' is decisive; 'symbols' is a strong convention; 'default' is a guess. */
  from: 'accession' | 'symbols' | 'default'
  /** Fraction of the evidence that agreed, 0..1. */
  support: number
}

/**
 * Ensembl's stable-ID species prefixes.
 *
 * Decisive where present: the prefix is part of the identifier, not a
 * convention anyone can break. Human alone has no species letters — ENSG,
 * not ENSHSAG — which is why this is a prefix table and not a pattern.
 */
const ENS: [RegExp, Species][] = [
  [/^ENSMUS[GTP]\d/i, 'mouse'],
  [/^ENS[GTP]\d/i, 'human'],
]

/**
 * Symbols that are spelled the same in both species and so say nothing.
 *
 * Anything purely numeric or with no letters cannot carry casing information
 * either. Excluded before the vote so they do not dilute it.
 */
const uninformative = (s: string) => !/[A-Za-z]{2}/.test(s)

/**
 * The casing convention.
 *
 * Human symbols are upper case (GFAP, MKI67); mouse symbols are title case
 * (Gfap, Mki67). It is a convention rather than a rule, and upstream tools do
 * sometimes upper-case a mouse object wholesale — so this votes across every
 * symbol instead of trusting any one of them, and reports how strong the
 * majority was so a weak call can be shown as weak.
 */
function byCasing(symbols: string[]): { species: Species; support: number } {
  let upper = 0, title = 0
  for (const s of symbols) {
    if (uninformative(s)) continue
    const letters = s.replace(/[^A-Za-z]/g, '')
    if (!letters) continue
    if (letters === letters.toUpperCase()) upper++
    // Title case: one leading capital and at least one following lower-case.
    else if (/^[A-Z][a-z]/.test(s)) title++
  }
  const n = upper + title
  if (!n) return { species: 'human', support: 0 }
  return upper >= title
    ? { species: 'human', support: upper / n }
    : { species: 'mouse', support: title / n }
}

/**
 * Decide the species from whatever naming the object carries.
 *
 * `display` is what the studio shows; `other` is the accession column when the
 * matrix is indexed one way and displayed the other. Accessions are checked
 * first wherever they are, because they settle it.
 */
export function detectSpecies(display: readonly string[], other?: readonly string[] | null): Detection {
  // A sample is enough for a vote and keeps this instant on a 31 053-gene
  // object; taken across the whole list rather than from the front, because
  // gene lists arrive sorted and the front of one is not representative.
  const sample = (xs: readonly string[], n = 4000) => {
    if (xs.length <= n) return [...xs]
    const step = xs.length / n
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(xs[Math.floor(i * step)])
    return out
  }

  for (const list of [other, display]) {
    if (!list?.length) continue
    const hits = new Map<Species, number>()
    let seen = 0
    for (const g of sample(list)) {
      for (const [re, sp] of ENS) {
        if (re.test(g)) { hits.set(sp, (hits.get(sp) ?? 0) + 1); seen++; break }
      }
    }
    if (seen >= 10) {
      const [species, n] = [...hits.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        species, from: 'accession', support: n / seen,
        why: `${species === 'mouse' ? 'ENSMUSG' : 'ENSG'} accessions in this object`,
      }
    }
  }

  const vote = byCasing(sample(display))
  if (!vote.support) {
    return {
      species: 'human', from: 'default', support: 0,
      why: 'no accessions and no casing to read — assuming human',
    }
  }
  return {
    species: vote.species, from: 'symbols', support: vote.support,
    why: `${Math.round(vote.support * 100)}% of symbols are `
      + `${vote.species === 'mouse' ? 'title case (Gfap)' : 'upper case (GFAP)'}`,
  }
}

/**
 * How well the object's genes match a library, EXACTLY, once one is loaded.
 *
 * Case-sensitive, and that is the whole point of it. ORA itself matches case-
 * insensitively — it has to, because exporters vary — which means a mouse
 * object run against the human library still hits 96% of its genes and returns
 * a full page of results that are quietly answering the wrong question. Compared
 * case-insensitively this number cannot tell the two libraries apart, so it
 * would be a reassurance rather than a check.
 *
 * Spelled the library's way, it separates them cleanly: Gfap is mouse MSigDB's
 * spelling and GFAP is human's, so the object's own casing says which library
 * was built for it. That is a measurement the reader can act on.
 */
export function matchRate(background: readonly string[], librarySymbols: Iterable<string>): number {
  const lib = new Set<string>(librarySymbols)
  if (!lib.size || !background.length) return 0
  let hit = 0
  for (const g of background) if (lib.has(g)) hit++
  return hit / background.length
}
