// A metabolic library, assembled from MSigDB — a collection in its own right.
//
//   node scripts/derive-metabolic.mjs          # after fetch-genesets.mjs
//
// MSigDB has no metabolic collection. It has metabolic pathways and metabolic
// ontology terms, scattered across KEGG, Reactome, WikiPathways, Hallmark, PID
// and GO:BP and mixed in with signalling, disease, development, protein
// turnover and mRNA decay — so the only way to ask "is this contrast
// metabolic?" was to test against fifteen thousand sets and read the answer out
// of whatever survived correction. That is a worse test than the question
// deserves: over-representation is corrected across everything tested, so
// carrying 7 500 GO terms to find out about glycolysis costs power on
// glycolysis.
//
// So this assembles one, and it STANDS ON ITS OWN. That is the difference from
// the first version of this file, which subset the curated pathway collections
// and kept their ids: `indexFor` folds a repeated id once, so with the default
// collections enabled — which they are — switching that collection on changed
// nothing a reader could see. A collection that does nothing until you switch
// four others off is not a collection beside the others, it is a mode.
//
// Independent means two things here, and both cost something:
//
//   - Its own ids. Every set is `METABOLIC_` + the id it was assembled from, so
//     no fold can remove it and every hit is reported under Metabolic whatever
//     else is on. The price is real and is stated on the card: a pathway also
//     present in an ENABLED parent is now tested twice and enters the
//     Benjamini–Hochberg correction twice. The parent id is recoverable by
//     dropping the prefix, so a hit is still citable as what it is.
//   - Its own content. GO:BP and GO:MF are sources here, not only the curated
//     pathway collections, so the library carries metabolic terms no pathway
//     database has and is worth enabling next to a full default library rather
//     than instead of one.
//
// The selection is by NAME, and that is a real limit, stated rather than
// hidden: MSigDB ships no machine-readable category for these. What makes it
// defensible is that the rule is different for the two kinds of source — see
// `RULES` below.

import { gzipSync, gunzipSync } from 'fflate'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/lib/msigdb.ts'

const outArg = process.argv.indexOf('--out')
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/genesets'

/** The label this collection is offered under. */
export const LABEL = 'Metabolic'

/** The prefix that makes every id here its own, and keeps the parent's readable. */
export const PREFIX = 'METABOLIC_'

/**
 * The vocabulary of metabolism as a NAMED process or metabolite.
 *
 * Written out rather than reduced to "METABOL" because most of the central
 * pathways are not named for the word: glycolysis, the TCA cycle, oxidative
 * phosphorylation, the pentose phosphate pathway and beta-oxidation are all
 * metabolism and none of them says so. Under "METABOL" alone KEGG contributes
 * 43 sets and misses every one of those.
 *
 * `MITOCHONDRI` is deliberately NOT here. It would read as a metabolic word and
 * carry in mitochondrial translation, mitochondrial DNA replication and
 * mitochondrial fission — the respiratory terms are already caught by
 * ELECTRON_TRANSPORT, CELLULAR_RESPIRATION and ATP_SYNTHESIS, which say what
 * they mean.
 */
export const SUBJECT = new RegExp([
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

/** The catch-all. Safe in a pathway database, not safe in an ontology. */
export const GENERIC = /METABOL|CATABOL|BIOSYNTH/

/**
 * What "metabolic process" in GO covers that this collection does not.
 *
 * GO calls protein turnover, mRNA decay, chromatin modification and
 * translation metabolic processes, and they are — in GO's sense. They are not
 * what anybody enabling a metabolic collection is asking about, and 400 of them
 * would be most of what the correction is spent on. The very top of the
 * hierarchy goes too: "cellular metabolic process" is 5 000 genes and says
 * nothing.
 *
 * `(^|_)PROTEINS?(_|$)` rather than `PROTEIN`, so lipoprotein and apolipoprotein
 * metabolism survive — six terms that are unambiguously lipid metabolism and
 * would have been dropped by a substring match.
 */
export const MACRO = new RegExp([
  '(^|_)PROTEINS?(_|$)', 'PEPTID', '_RNA', 'RNA_', 'DNA', 'CHROMATIN', 'HISTONE',
  'NUCLEOSOME', 'RECEPTOR', 'AMYLOID', 'COLLAGEN', 'GLYCOPROTEIN', 'PROTEOGLYCAN',
  'MACROMOLECULE', 'BIOPOLYMER', 'GENE_EXPRESSION', 'TRANSCRIPT', 'TRANSLATION',
  'POLYSACCHARIDE', 'GLYCOSAMINOGLYCAN', 'MUCOPOLYSACCHARID',
  'CELLULAR_METABOLIC', 'ORGANIC_SUBSTANCE_METABOLIC', 'PRIMARY_METABOLIC',
  'NITROGEN_COMPOUND_METABOLIC',
].join('|'))

/**
 * An enzyme, for GO:MF.
 *
 * A molecular function is metabolic when it is a reaction, not when it is a
 * binding or a transport event. Without this gate the vocabulary returns 99
 * terms dominated by "phospholipid binding", "lipid antigen binding" and
 * "guanyl nucleotide exchange factor activity" — a GEF is signalling, and a
 * poly-pyrimidine tract binder is an RNA protein. With it, 19 terms, all of
 * them a metabolic enzyme.
 */
export const ENZYME = new RegExp([
  'DEHYDROGENASE', 'OXIDOREDUCTASE', 'TRANSFERASE', 'SYNTHASE', 'SYNTHETASE', '_LYASE',
  'LIGASE', 'ISOMERASE', 'HYDROLASE', 'CARBOXYLASE', 'DECARBOXYLASE', 'REDUCTASE',
  'OXIDASE', 'DESATURASE', 'ELONGASE', 'MONOOXYGENASE', 'DIOXYGENASE', 'HYDROXYLASE',
  'THIOLASE', 'MUTASE', 'ALDOLASE', 'ENOLASE', 'PHOSPHORYLASE', 'LIPASE', 'ESTERASE',
].join('|'))

/**
 * Names the vocabulary catches that are not metabolism.
 *
 * All substrings of a word that means something else: PURINERGIC is receptor
 * signalling and contains PURINE, nucleotide excision repair is DNA repair, a
 * nucleotide-binding domain is a protein fold, and a guanyl nucleotide exchange
 * factor is a signalling adaptor. A short exclusion list is honest; loosening
 * the vocabulary to avoid them would cost real pathways.
 */
export const NOT_METABOLIC =
  /PURINERGIC|NUCLEOTIDE_EXCISION_REPAIR|NUCLEOTIDE_BINDING|GUANYL_NUCLEOTIDE_EXCHANGE/

/**
 * Which rule each source is read under.
 *
 * A pathway database has already decided that a pathway is a pathway, so a
 * KEGG entry called "X metabolism" is a metabolic pathway and needs no guard.
 * An ontology has not: it is a classification of everything, so the same
 * vocabulary there needs `MACRO` to keep protein turnover out, and GO:MF needs
 * `ENZYME` on top because a molecular function is metabolic only when it is a
 * reaction.
 */
export const RULES = {
  curated: id => SUBJECT.test(id) || GENERIC.test(id),
  ontology: id => (SUBJECT.test(id) || GENERIC.test(id)) && !MACRO.test(id),
  enzyme: id => (SUBJECT.test(id) || GENERIC.test(id)) && ENZYME.test(id)
    && !MACRO.test(id) && !/BINDING/.test(id),
}

/**
 * Where the sets come from, and under which rule.
 *
 * In this order, so the collection reads pathways first and ontology terms
 * after — which is also the order a reader scanning the picker wants them.
 */
export const PARENTS = [
  ['Hallmark', 'curated'],
  ['KEGG', 'curated'],
  ['KEGG (orthologs)', 'curated'],
  ['Reactome', 'curated'],
  ['WikiPathways', 'curated'],
  ['PID', 'curated'],
  ['BioCarta', 'curated'],
  ['Canonical (other)', 'curated'],
  ['GO:BP', 'ontology'],
  ['GO:MF', 'enzyme'],
]

export const isMetabolic = (id, rule = 'curated') =>
  !NOT_METABOLIC.test(id) && RULES[rule](id)

/**
 * The chosen sets of several collections, as one collection's payload.
 *
 * One symbol dictionary across all of them, as every .gs file has: a gene sits
 * in many sets, so writing the symbol once and pointing at it by number is most
 * of the saving.
 *
 * Ids are prefixed and names carry their origin. The name matters as much as
 * the id here and for a reason the subset version did not have: merged into one
 * collection, Hallmark's "Glycolysis", Reactome's "Glycolysis" and
 * WikiPathways' are three different sets that would otherwise be three
 * identical rows in a results table with nothing to tell them apart. The source
 * column says "Metabolic" for all three, so the origin has to be in the name.
 */
/**
 * The origin as it reads inside a name's own brackets.
 *
 * "KEGG (orthologs)" is a collection label with brackets already in it, and
 * "Glycolysis (KEGG (orthologs))" is not a name — it is a name with a nested
 * parenthetical that no reader parses and no regexp closes. The brackets go;
 * the words stay, because which KEGG it is matters.
 */
export const originOf = (source) => source.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()

export function mergeMetabolic(collections) {
  const at = new Map()
  const symbols = []
  const lines = []
  const seen = new Set()
  const from = []
  for (const { collection: c, rule } of collections) {
    let took = 0
    for (const s of c.sets) {
      const id = PREFIX + s.id
      if (!isMetabolic(s.id, rule) || seen.has(id)) continue
      seen.add(id)
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
      .map(([name, rule]) => ({ entry: spec.sources.find(s => s.source === name), rule }))
      .filter(p => p.entry)
    if (!parents.length) continue

    const collections = parents.map(p => ({
      rule: p.rule,
      collection: parse(new TextDecoder().decode(gunzipSync(readFileSync(join(dir, p.entry.file))))),
    }))
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
      // Off by default. It is worth enabling next to a full library now rather
      // than instead of one, but a collection nobody asked for should not be
      // downloaded before they ask.
      on: false,
      // Only if EVERY parent is. Mouse takes its KEGG from orthologs and the
      // rest from native annotations, so flagging the whole collection would
      // tell the reader something false about most of it. The parent list is
      // the accurate version of the same warning.
      projected: parents.every(p => p.entry.projected),
      /** What it was assembled from, so the interface can say so. */
      derived: from.map(f => f.source),
    }
    // Replace in place if it is already there, so re-running does not append.
    const was = spec.sources.findIndex(s => s.source === LABEL)
    if (was >= 0) spec.sources[was] = entry
    else {
      // Beside the curated pathway collections it draws most of its names from.
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
  console.log('\nMetabolic — a metabolic library assembled from MSigDB')
  deriveMetabolic(OUT)
  console.log(`  wrote ${OUT}/manifest.json`)
}
