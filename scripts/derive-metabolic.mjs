// A metabolism-only collection, derived from the curated pathway collections.
//
//   node scripts/derive-metabolic.mjs          # after fetch-genesets.mjs
//
// MSigDB has no metabolic collection. It has metabolic pathways, scattered
// across KEGG, Reactome, WikiPathways, Hallmark and PID and mixed in with
// signalling, disease and development — so the only way to ask "is this
// contrast metabolic?" was to test against nine thousand sets and read the
// answer out of whatever survived correction. That is a worse test than the
// question deserves: over-representation is corrected across everything
// tested, so carrying 7 500 GO terms to find out about glycolysis costs power
// on glycolysis.
//
// So this packs the metabolic pathways of those collections as one collection
// of their own. Nothing is invented and nothing is edited: a set here IS a set
// there, with the same systematic id, the same members and the same name. What
// the file adds is a boundary — turn the parent collections off, turn this on,
// and the test is metabolism against a background of metabolism.
//
// Two consequences of keeping the ids, both deliberate:
//
//   - Having this on WITH its parents does not double-count. indexFor folds a
//     set id once however many enabled collections carry it, so the worst case
//     of the overlap is that this collection adds nothing.
//   - A result found here is citable as what it is. "REACTOME_GLYCOLYSIS" is
//     the Reactome pathway, not a copy of it under a new name that a reader
//     cannot look up.
//
// The selection is by NAME, and that is a real limit, stated rather than
// hidden: MSigDB ships no machine-readable category for these, so the rule is
// the vocabulary below applied to the systematic name. It is deliberately a
// curated-pathway rule — GO:BP is not a source here, because "metabolic
// process" in GO covers protein turnover and mRNA decay as much as it covers
// intermediary metabolism, and a collection that mixes those is not the
// boundary this file exists to draw.

import { gzipSync, gunzipSync } from 'fflate'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/lib/msigdb.ts'

const outArg = process.argv.indexOf('--out')
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/genesets'

/** The label this collection is offered under. */
export const LABEL = 'Metabolic'

/**
 * Where the sets come from, and nowhere else.
 *
 * Curated pathway collections only. Each is a pathway database's own view of a
 * process, which is what "a metabolic pathway" means to the person asking; the
 * ontologies and the experimental signature collections are a different kind of
 * claim and are left where they are.
 */
export const PARENTS = [
  'Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways', 'PID',
  'BioCarta', 'Canonical (other)',
]

/**
 * The vocabulary of metabolism, as these databases spell it in a set name.
 *
 * Written out rather than reduced to "METABOL" because most of the central
 * pathways are not named for the word: glycolysis, the TCA cycle, oxidative
 * phosphorylation, the pentose phosphate pathway and beta-oxidation are all
 * metabolism and none of them says so. Under "METABOL" alone KEGG contributes
 * 43 sets and misses every one of those.
 */
export const METABOLIC = new RegExp([
  // The word itself, and its two halves.
  'METABOL', 'CATABOL', 'BIOSYNTH',
  // Central carbon and energy.
  'GLYCOLY', 'GLUCONEOGEN', 'CITRATE_CYCLE', 'CITRIC_ACID', 'TCA_CYCLE', 'KREBS',
  'TRICARBOXYLIC', 'OXIDATIVE_PHOSPHORYL', 'ELECTRON_TRANSPORT', 'RESPIRATORY_ELECTRON',
  'ATP_SYNTHESIS', 'CELLULAR_RESPIRATION', 'PENTOSE_PHOSPHATE', 'GLYCOGEN', 'GLUCOSE',
  'HEXOSAMINE',
  // Lipid.
  'FATTY_ACID', 'BETA_OXIDATION', 'LIPOLYSIS', 'LIPID', 'CHOLESTEROL', 'STEROL',
  'BILE_ACID', 'KETONE_BOD', 'KETOGENESIS', 'SPHINGOLIPID', 'PHOSPHOLIPID',
  'TRIACYLGLYCEROL', 'TRIGLYCERIDE', 'PEROXISOM',
  // Nitrogen, nucleotide and one-carbon.
  'UREA_CYCLE', 'AMINO_ACID', 'NUCLEOTIDE', 'PURINE', 'PYRIMIDINE', 'ONE_CARBON',
  'FOLATE', 'POLYAMINE', 'GLUTATHIONE',
  // Cofactors and pigments.
  'RETINOL', 'PORPHYRIN', 'HEME_',
].join('|'))

/**
 * Names the vocabulary catches that are not metabolism.
 *
 * Three of them, all substrings of a word that means something else:
 * PURINERGIC is receptor signalling and contains PURINE, nucleotide excision
 * repair is DNA repair, and a nucleotide-binding domain is a protein fold. A
 * short exclusion list is honest; loosening the vocabulary to avoid them would
 * cost real pathways.
 */
export const NOT_METABOLIC = /PURINERGIC|NUCLEOTIDE_EXCISION_REPAIR|NUCLEOTIDE_BINDING/

export const isMetabolic = (id) => METABOLIC.test(id) && !NOT_METABOLIC.test(id)

/**
 * The chosen sets of several collections, as one collection's payload.
 *
 * One symbol dictionary across all of them, as every .gs file has: a gene sits
 * in many sets, so writing the symbol once and pointing at it by number is most
 * of the saving. Set ids are kept exactly as the parent wrote them, and a set
 * seen twice is written once.
 */
export function mergeMetabolic(collections) {
  const at = new Map()
  const symbols = []
  const lines = []
  const seen = new Set()
  const from = []
  for (const c of collections) {
    let took = 0
    for (const s of c.sets) {
      if (!isMetabolic(s.id) || seen.has(s.id)) continue
      seen.add(s.id)
      const idx = []
      for (const gi of s.genes) {
        const sym = c.symbols[gi]
        let k = at.get(sym)
        if (k === undefined) { k = symbols.length; at.set(sym, k); symbols.push(sym) }
        idx.push(k)
      }
      if (!idx.length) continue
      lines.push(`${s.id}\t${s.name}\t${idx.join(',')}`)
      took++
    }
    if (took) from.push({ source: c.source, nSets: took })
  }
  return { symbols, lines, from }
}

/** The MSIG1 payload for one species. */
export function packMetabolic(collections, { species, release }) {
  const { symbols, lines, from } = mergeMetabolic(collections)
  const head = `MSIG1\t${species}\t${LABEL}\t${release}\t${lines.length}\t${symbols.length}`
  return {
    text: `${head}\n${symbols.join('\t')}\n${lines.join('\n')}\n`,
    nSets: lines.length,
    nGenes: symbols.length,
    from,
  }
}

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

  for (const [species, spec] of Object.entries(manifest.species ?? {})) {
    const parents = PARENTS
      .map(name => spec.sources.find(s => s.source === name))
      .filter(Boolean)
    if (!parents.length) continue

    const collections = parents.map(p =>
      parse(new TextDecoder().decode(gunzipSync(readFileSync(join(dir, p.file))))))
    const { text, nSets, nGenes, from } = packMetabolic(collections,
      { species, release: spec.release })
    if (!nSets) continue

    const file = `${species}.metabolic.gs`
    const gz = gzipSync(new TextEncoder().encode(text), { level: 9 })
    writeFileSync(join(dir, file), gz)

    const entry = {
      source: LABEL,
      file,
      nSets,
      nGenes,
      bytes: gz.length,
      // Off by default. Every set in it is already in a collection that IS on,
      // so switching it on alone changes nothing — its value is what it lets
      // you switch OFF, and that is a decision the reader makes.
      on: false,
      // Only if EVERY parent is. Mouse takes 101 of its 335 sets from KEGG
      // orthologs and the rest from native annotations, and flagging the whole
      // collection would tell the reader something false about 234 of them.
      // The parent list below names the projected one, which is the accurate
      // version of the same warning.
      projected: parents.every(p => p.projected),
      /** What it was subset from, so the interface can say so rather than imply. */
      derived: from.map(f => f.source),
    }
    // Replace in place if it is already there, so re-running does not append.
    const was = spec.sources.findIndex(s => s.source === LABEL)
    if (was >= 0) spec.sources[was] = entry
    else {
      // Beside the curated pathway collections it came from, not at the end.
      const after = spec.sources.findIndex(s => s.source === 'Hallmark')
      spec.sources.splice(after >= 0 ? after + 1 : 0, 0, entry)
    }

    console.log(`  ${species.padEnd(6)} ${LABEL.padEnd(10)} ${String(nSets).padStart(5)} sets  `
      + `${String(nGenes).padStart(6)} genes  gz ${(gz.length / 1e3).toFixed(0)} kB`)
    console.log(`         from ${from.map(f => `${f.source} ${f.nSets}`).join(', ')}`)
  }

  writeFileSync(at, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

// Run when invoked directly; importable from fetch-genesets.mjs otherwise.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nMetabolic — subset of the curated pathway collections')
  deriveMetabolic(OUT)
  console.log(`  wrote ${OUT}/manifest.json`)
}
