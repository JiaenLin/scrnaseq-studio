// A metabolic library, assembled from MSigDB — a collection in its own right.
//
//   node scripts/derive-metabolic.mjs          # after fetch-genesets.mjs
//
// MSigDB has no metabolic collection. It has metabolic pathways and metabolic
// ontology terms, scattered across KEGG, Reactome, WikiPathways, Hallmark, PID
// and GO and mixed in with signalling, disease, development, protein turnover
// and mRNA decay — so the only way to ask "is this contrast metabolic?" was to
// test against fifteen thousand sets and read the answer out of whatever
// survived correction. That is a worse test than the question deserves:
// over-representation is corrected across everything tested, so carrying 7 500
// GO terms to find out about glycolysis costs power on glycolysis.
//
// So this assembles one, and it STANDS ON ITS OWN:
//
//   - Its own ids. Every set is `METABOLIC_` + the id it was assembled from, so
//     no fold can remove it and every hit is reported under Metabolic whatever
//     else is on. The price is stated on the card: a pathway also present in an
//     ENABLED parent is tested twice and enters the Benjamini–Hochberg
//     correction twice. The parent id is recoverable by dropping the prefix, so
//     a hit is still citable as what it is.
//   - Its own content. GO is a source here, not only the curated pathway
//     collections, so the library carries metabolic terms no pathway database
//     has and is worth enabling next to a full default library rather than
//     instead of one.
//
// WHICH TERMS, AND HOW THEY WERE CHOSEN
//
// By hand, into `metabolic-terms.tsv`, which is the input to this script and is
// committed beside it. It is not a rule this file evaluates.
//
// It was a rule, and the rule was the problem. A name-matching vocabulary —
// "METABOL", "GLYCOLY", "FATTY_ACID" and forty more — is only ever as good as
// the correlation between what a pathway is called and what it is about, and
// that correlation is poor in exactly the places that matter. It missed
// `KEGG_PENTOSE_AND_GLUCURONATE_INTERCONVERSIONS`, which is a metabolic map
// with no metabolic word in it; `REACTOME_COMPLEX_I_BIOGENESIS`, which builds
// the respiratory chain; `REACTOME_MITOCHONDRIAL_BIOGENESIS`;
// `KEGG_INSULIN_SIGNALING_PATHWAY` and `KEGG_PPAR_SIGNALING_PATHWAY`, whose
// whole subject is metabolic control; and `KEGG_TYPE_II_DIABETES_MELLITUS`. No
// vocabulary catches those without catching half of signalling with them.
//
// So every one of the 15 646 term names in the pathway and ontology collections
// — the union across both species, since they share systematic ids — was read
// and judged against written criteria, and the ones that are about metabolism
// are listed in that file with a category. A list is auditable in a way a
// regexp is not: it diffs, it can be argued with line by line, and it cannot
// silently change its mind about a term nobody was looking at.
//
// The check that keeps it honest as MSigDB moves is at the bottom of this file:
// a deliberately broad vocabulary flags terms in a NEW release that look
// metabolic and are not in the list, so a stale list is reported rather than
// quietly shipped.

import { gzipSync, gunzipSync } from 'fflate'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/lib/msigdb.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const outArg = process.argv.indexOf('--out')
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/genesets'

/** The label this collection is offered under. */
export const LABEL = 'Metabolic'

/** The prefix that makes every id here its own, and keeps the parent's readable. */
export const PREFIX = 'METABOLIC_'

/** The curated list, beside this script. */
export const TERMS = join(HERE, 'metabolic-terms.tsv')

/**
 * Where the sets come from, in the order they are read.
 *
 * A set present in two of these is taken from the first — which is also the
 * order a reader scanning the picker wants: the curated maps, then the
 * ontology.
 */
export const PARENTS = [
  'Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways', 'PID',
  'BioCarta', 'Canonical (other)', 'GO:BP', 'GO:MF', 'GO:CC',
]

/**
 * The curated list: what is in, and what was looked at and left out.
 *
 * Two answers, not one, because "not in the list" is ambiguous and the
 * difference matters when MSigDB moves. A term nobody has judged yet should be
 * reported; a term somebody judged and rejected should not be reported every
 * time the assets are rebuilt. So a rejection is written down — prefixed `!` —
 * which also makes it arguable in a diff instead of invisible.
 */
export function readTerms(file = TERMS) {
  const terms = new Map()
  const judged = new Set()
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('!')) { judged.add(line.slice(1).split('\t')[0]); continue }
    const [id, category] = line.split('\t')
    if (id && !terms.has(id)) terms.set(id, category || 'other')
  }
  return { terms, judged }
}

/**
 * The origin as it reads inside a name's own brackets.
 *
 * "KEGG (orthologs)" is a collection label with brackets already in it, and
 * "Glycolysis (KEGG (orthologs))" is not a name — it is a name with a nested
 * parenthetical that no reader parses and no regexp closes. The brackets go;
 * the words stay, because which KEGG it is matters.
 */
export const originOf = (source) => source.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()

/**
 * The chosen sets of several collections, as one collection's payload.
 *
 * One symbol dictionary across all of them, as every .gs file has: a gene sits
 * in many sets, so writing the symbol once and pointing at it by number is most
 * of the saving.
 *
 * Ids are prefixed and names carry their origin. The name matters as much as
 * the id: merged into one collection, Hallmark's "Glycolysis", Reactome's and
 * WikiPathways' are three different sets that would otherwise be three
 * identical rows in a results table with nothing to tell them apart, because
 * the source column says "Metabolic" for all three.
 */
export function mergeMetabolic(collections, terms) {
  const at = new Map()
  const symbols = []
  const lines = []
  const seen = new Set()
  const from = []
  const used = new Set()
  for (const c of collections) {
    let took = 0
    for (const s of c.sets) {
      const id = PREFIX + s.id
      if (!terms.has(s.id) || seen.has(id)) continue
      seen.add(id)
      used.add(s.id)
      const idx = []
      for (const gi of s.genes) {
        const sym = c.symbols[gi]
        let k = at.get(sym)
        if (k === undefined) { k = symbols.length; at.set(sym, k); symbols.push(sym) }
        idx.push(k)
      }
      if (!idx.length) continue
      lines.push(`${id}\t${s.name} (${originOf(c.source)})\t${idx.join(',')}`)
      took++
    }
    if (took) from.push({ source: c.source, nSets: took })
  }
  return { symbols, lines, from, used }
}

/** The MSIG1 payload for one species. */
export function packMetabolic(collections, terms, { species, release }) {
  const { symbols, lines, from, used } = mergeMetabolic(collections, terms)
  const head = `MSIG1\t${species}\t${LABEL}\t${release}\t${lines.length}\t${symbols.length}`
  return {
    text: `${head}\n${symbols.join('\t')}\n${lines.join('\n')}\n`,
    nSets: lines.length,
    nGenes: symbols.length,
    from,
    used,
  }
}

/**
 * A term that LOOKS metabolic, for the staleness check only.
 *
 * Deliberately loose, and deliberately not the selection rule — this is the
 * alarm that a new MSigDB release has added terms nobody has judged yet. It
 * over-reports by design: a handful of names to glance at is the right cost for
 * never shipping a list that has quietly gone out of date.
 */
export const LOOKS_METABOLIC = new RegExp([
  'METABOL', 'CATABOL', 'BIOSYNTH', 'GLYCOLY', 'GLUCONEOGEN', 'TCA_CYCLE', 'CITRIC_ACID',
  'OXIDATIVE_PHOSPHORYL', 'ELECTRON_TRANSPORT', 'RESPIRATION', 'PENTOSE_PHOSPHATE',
  'GLYCOGEN', 'GLUCOSE', 'FATTY_ACID', 'BETA_OXIDATION', 'LIPID', 'CHOLESTEROL', 'STEROL',
  'BILE_ACID', 'KETONE', 'UREA_CYCLE', 'AMINO_ACID', 'NUCLEOTIDE', 'PURINE', 'PYRIMIDINE',
  'FOLATE', 'GLUTATHIONE', 'PEROXISOM', 'MITOCHONDRIAL_RESPIR', 'ATP_SYNTH',
].join('|'))

/**
 * Derive the file for every species in a manifest, and record it there.
 *
 * Reads the collections that were just packed rather than the GMT export, so
 * this can be re-run on its own — and so it cannot disagree with what the app
 * will actually load: it selects from the same bytes.
 */
export function deriveMetabolic(dir = OUT) {
  const at = join(dir, 'manifest.json')
  if (!existsSync(at)) throw new Error(`no manifest at ${at} — run fetch-genesets.mjs first`)
  const manifest = JSON.parse(readFileSync(at, 'utf8'))
  const { terms, judged } = readTerms()

  /** Every id offered by any species, and every id any species used. */
  const offered = new Set()
  const used = new Set()
  const unjudged = new Map()

  for (const [species, spec] of Object.entries(manifest.species ?? {})) {
    const parents = PARENTS
      .map(name => spec.sources.find(s => s.source === name))
      .filter(Boolean)
    if (!parents.length) continue

    const collections = parents.map(p =>
      parse(new TextDecoder().decode(gunzipSync(readFileSync(join(dir, p.file))))))
    for (const c of collections) {
      for (const s of c.sets) {
        offered.add(s.id)
        if (!terms.has(s.id) && !judged.has(s.id) && LOOKS_METABOLIC.test(s.id)) {
          unjudged.set(s.id, c.source)
        }
      }
    }

    const packed = packMetabolic(collections, terms, { species, release: spec.release })
    for (const id of packed.used) used.add(id)
    if (!packed.nSets) continue

    const file = `${species}.metabolic.gs`
    const gz = gzipSync(new TextEncoder().encode(packed.text), { level: 9 })
    writeFileSync(join(dir, file), gz)

    const entry = {
      source: LABEL,
      file,
      nSets: packed.nSets,
      nGenes: packed.nGenes,
      bytes: gz.length,
      // Off by default. It is worth enabling next to a full library, but a
      // collection nobody asked for should not be downloaded before they ask.
      on: false,
      // Only if EVERY parent is. Mouse takes its KEGG from orthologs and the
      // rest from native annotations, so flagging the whole collection would
      // tell the reader something false about most of it. The parent list is
      // the accurate version of the same warning.
      projected: parents.every(p => p.projected),
      /** What it was assembled from, so the interface can say so. */
      derived: packed.from.map(f => f.source),
    }
    const was = spec.sources.findIndex(s => s.source === LABEL)
    if (was >= 0) spec.sources[was] = entry
    else {
      const after = spec.sources.findIndex(s => s.source === 'Hallmark')
      spec.sources.splice(after >= 0 ? after + 1 : 0, 0, entry)
    }

    console.log(`  ${species.padEnd(6)} ${LABEL.padEnd(10)} ${String(packed.nSets).padStart(5)} sets  `
      + `${String(packed.nGenes).padStart(6)} genes  gz ${(gz.length / 1e3).toFixed(0)} kB`)
    console.log(`         from ${packed.from.map(f => `${f.source} ${f.nSets}`).join(', ')}`)
  }

  writeFileSync(at, JSON.stringify(manifest, null, 2) + '\n')

  // Two ways the list can be out of step with the library, both reported and
  // neither fatal — this script writes assets, and refusing to write them
  // because a future release renamed a term would be the wrong trade.
  const stale = [...terms.keys(), ...judged].filter(id => !offered.has(id))
  if (stale.length) {
    console.log(`\n  ${stale.length} listed term(s) are in no collection this release ships:`)
    for (const id of stale.slice(0, 12)) console.log(`    ${id}`)
    if (stale.length > 12) console.log(`    …and ${stale.length - 12} more`)
  }
  if (unjudged.size) {
    console.log(`\n  ${unjudged.size} term(s) look metabolic and are not in the list —`
      + ' judge them and add them, or leave them out deliberately:')
    for (const [id, src] of [...unjudged].slice(0, 12)) console.log(`    ${src.padEnd(16)} ${id}`)
    if (unjudged.size > 12) console.log(`    …and ${unjudged.size - 12} more`)
  }
  console.log(`\n  ${used.size} of ${terms.size} listed terms were used;`
    + ` ${judged.size} more are recorded as judged and left out.`)
  return manifest
}

// Run when invoked directly; importable from fetch-genesets.mjs otherwise.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nMetabolic — a metabolic library assembled from MSigDB')
  deriveMetabolic(OUT)
  console.log(`  wrote ${OUT}/manifest.json`)
}
