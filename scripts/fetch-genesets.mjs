// Pack MSigDB into the compact assets the studio ships.
//
//   Rscript scripts/export-genesets.R scratch-msigdb/gmt   # 1. export
//   node scripts/fetch-genesets.mjs                        # 2. pack
//
// Two steps because they need different things: the export needs R and
// msigdbr, the packing needs fflate and the format the app parses. Splitting
// them also means the packing can be re-run — to change what is on by default,
// or to add a collection — without going back to the database.
//
// The outputs are committed, so CI and the deploy need no network and no R.
// Re-run both when MSigDB releases; the app prints the release it is using, so
// a stale asset is visible rather than silent.

import { gzipSync } from 'fflate'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const inArg = process.argv.indexOf('--in')
const IN = inArg > 0 ? process.argv[inArg + 1] : 'scratch-msigdb/gmt'
const outArg = process.argv.indexOf('--out')
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/genesets'

/**
 * Which collections a species starts with.
 *
 * The rest are downloadable and off: the app fetches a collection the first
 * time it is switched on, so an immunology library nobody has asked for costs
 * nothing. Hallmark, KEGG, Reactome, WikiPathways and GO:BP are the ones people
 * mean by "pathway enrichment"; cell-type signatures are on because this is a
 * single-cell studio and they are the collection most likely to be useful here.
 */
const ON = new Set(['Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways',
  'PID', 'GO:BP', 'Cell type'])

/**
 * The order collections are offered in, grouped the way MSigDB groups them.
 *
 * EVERY label the exporter writes must appear here. `unslug` is built from this
 * list, so a collection missing from it is not offered in some other order —
 * it is dropped from the manifest with no error at any point. That is how
 * mouse KEGG went missing once already, and it is why this list is now checked
 * against the input directory rather than trusted.
 */
const ORDER = [
  // Curated pathways — what most people mean by "pathway enrichment".
  'Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways', 'PID',
  'BioCarta', 'Canonical (other)',
  // Ontologies.
  'GO:BP', 'GO:MF', 'GO:CC', 'Human phenotype', 'Mouse phenotype',
  // Signatures from experiments.
  'Cell type', 'Perturbations', 'Immunologic', 'Vaccine response', 'Oncogenic',
  // Regulatory targets.
  'TF targets', 'miRNA targets',
  // Cancer and genome position.
  'Cancer atlas (3CA)', 'Cancer modules', 'Cancer neighbourhoods',
  'Copy-number correlates', 'Positional',
]

/**
 * Collections that are NOT a native annotation for their species.
 *
 * Mouse KEGG is human KEGG mapped through orthologs, because no native one is
 * distributable. It is a weaker claim than the rest of the library and the
 * interface says so wherever it appears, rather than letting it sit in a row
 * of native collections looking like one of them.
 */
const PROJECTED = new Set(['KEGG (orthologs)'])

const LABEL = {
  human: { label: 'Human', taxon: 'Homo sapiens' },
  mouse: { label: 'Mouse', taxon: 'Mus musculus' },
}

/**
 * Back from a file slug to the collection label the R export used.
 *
 * Character for character what slug() in export-genesets.R does, TRAILING DASH
 * INCLUDED — "KEGG (orthologs)" ends in a bracket, so a naive slug leaves
 * "kegg-orthologs-" while R writes "kegg-orthologs", the lookup misses, and the
 * collection is silently dropped from the manifest with no error anywhere.
 * Two slug functions that must agree, in two languages; they agree here.
 */
const slugOf = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const unslug = new Map(ORDER.map(s => [slugOf(s), s]))

/**
 * MSigDB's systematic name, made readable.
 *
 * The prefix repeats the collection, which the app shows in its own column, so
 * it goes. The rest is lower-cased with the first letter raised — the
 * convention every enrichment tool prints. The systematic name stays as the id
 * and is what the CSV export carries, so nothing is lost by making the screen
 * readable.
 */
export function readableName(systematic) {
  const body = systematic.replace(
    /^(HALLMARK|GOBP|GOMF|GOCC|KEGG_MEDICUS|KEGG|REACTOME|WP|BIOCARTA|HP|MODULE)_/, '')
  const words = body.replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * GMT text -> the compact payload the app parses.
 *
 * One dictionary of symbols, then one line per set holding indices into it.
 * A gene sits in many sets — Actb is in 349 of mouse GO:BP's 7 781 — so writing
 * the symbol once and referring to it by number is most of the saving, and the
 * indices gzip better than repeated names would.
 */
export function compact(gmt, { species, source, release }) {
  const dict = new Map()
  const lines = []
  for (const raw of gmt.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const id = parts[0]
    const idx = []
    for (let i = 2; i < parts.length; i++) {
      const g = parts[i]
      if (!g) continue
      let at = dict.get(g)
      if (at === undefined) { at = dict.size; dict.set(g, at) }
      idx.push(at)
    }
    if (!idx.length) continue
    lines.push(`${id}\t${readableName(id)}\t${idx.join(',')}`)
  }
  const head = `MSIG1\t${species}\t${source}\t${release}\t${lines.length}\t${dict.size}`
  return {
    text: `${head}\n${[...dict.keys()].join('\t')}\n${lines.join('\n')}\n`,
    nSets: lines.length,
    nGenes: dict.size,
  }
}

if (!existsSync(IN)) {
  console.error(`No GMT export at ${IN}.\n`
    + `Run:  Rscript scripts/export-genesets.R ${IN}`)
  process.exit(1)
}

const release = JSON.parse(readFileSync(join(IN, 'release.json'), 'utf8'))
mkdirSync(OUT, { recursive: true })

const manifest = { generated: new Date().toISOString().slice(0, 10), msigdbr: release.msigdbr, species: {} }
let rawTotal = 0, gzTotal = 0

for (const species of ['human', 'mouse']) {
  const all = readdirSync(IN)
    .filter(f => f.startsWith(`${species}.`) && f.endsWith('.gmt'))
    .map(f => ({ file: f, source: unslug.get(basename(f, '.gmt').slice(species.length + 1)) }))
  // Loudly. A GMT whose label is not in ORDER used to be filtered away here in
  // silence, so a collection could be exported, packed against nothing, and be
  // absent from the app with every step reporting success. It has happened —
  // mouse KEGG, over a trailing dash in one of the two slug functions.
  const orphans = all.filter(f => !f.source).map(f => f.file)
  if (orphans.length) {
    console.error(`\n  ${species}: ${orphans.length} GMT file(s) match no label in ORDER:`)
    for (const o of orphans) console.error(`    ${o}`)
    console.error('  Add them to ORDER in this file, or delete them from the input.\n')
    process.exitCode = 1
  }
  const files = all.filter(f => f.source)
    .sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source))
  if (!files.length) continue

  const sources = []
  console.log(`\n${LABEL[species].label}  (MSigDB ${release[species]})`)
  for (const { file, source } of files) {
    const gmt = readFileSync(join(IN, file), 'utf8')
    const { text, nSets, nGenes } = compact(gmt, { species, source, release: release[species] })
    const gz = gzipSync(new TextEncoder().encode(text), { level: 9 })
    const name = `${species}.${basename(file, '.gmt').slice(species.length + 1)}.gs`
    writeFileSync(join(OUT, name), gz)
    rawTotal += gmt.length
    gzTotal += gz.length
    sources.push({ source, file: name, nSets, nGenes, bytes: gz.length,
      on: ON.has(source), projected: PROJECTED.has(source) })
    console.log(`  ${source.padEnd(14)} ${String(nSets).padStart(5)} sets  `
      + `${String(nGenes).padStart(6)} genes  `
      + `gmt ${(gmt.length / 1e6).toFixed(2)} MB -> gz ${(gz.length / 1e6).toFixed(2)} MB`
      + (ON.has(source) ? '  [on]' : '') + (PROJECTED.has(source) ? '  [orthologs]' : ''))
  }
  manifest.species[species] = { ...LABEL[species], release: release[species], sources }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const on = Object.values(manifest.species)
  .flatMap(s => s.sources.filter(x => x.on).map(x => x.bytes))
  .reduce((a, b) => a + b, 0)
console.log(`\n  total     gmt ${(rawTotal / 1e6).toFixed(1)} MB -> gz ${(gzTotal / 1e6).toFixed(1)} MB committed`)
console.log(`  on first open, per species: about ${(on / 2 / 1e6).toFixed(1)} MB`)
console.log(`  wrote ${OUT}/manifest.json`)
