// What do an object's gene names actually look like, and does it matter?
//
//   node scripts/inspect-names.mjs "<path to .scstudio or .zip>"
//
// Written for one question. A real object reported that only 12.5% of its genes
// are spelled the way the mouse MSigDB library spells them, and the studio has
// to say whether that changes an enrichment RESULT or only the warning about
// one. Matching in ora.ts is case-insensitive by design — exporters vary — so
// the answer should be that it does not, and "should" is not an answer.
//
// READ-ONLY. It reads the zip index and the few small entries it needs. It
// never reads the expression matrix and it never writes anything.

import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { gunzipSync } from 'fflate'
import { readZipDir, readZipEntry, payloadStart } from '../src/lib/zipdir.ts'
import { parse, indexFor } from '../src/lib/msigdb.ts'
import { oraIndexed } from '../src/lib/ora.ts'
import { detectSpecies, matchRate } from '../src/lib/species.ts'

const NL = String.fromCharCode(10)
const path = process.argv[2]
if (!path) { console.error('usage: node scripts/inspect-names.mjs <bundle>'); process.exit(1) }

/* A Blob-alike over a file on disk, so the studio's own readers work unchanged
   without pulling 895 MB into memory. */
const total = statSync(path).size
const fd = openSync(path, 'r')
const readRange = (from, to) => {
  const a = Math.max(0, Math.floor(from))
  const b = Math.max(a, Math.min(Math.floor(to), total))
  const buf = Buffer.allocUnsafe(b - a)
  if (b > a) readSync(fd, buf, 0, b - a, a)
  return buf
}
const blob = {
  size: total,
  slice: (from, to) => ({
    arrayBuffer: async () => {
      const b = readRange(from, to === undefined ? total : to)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    },
  }),
}

let genes
if (path.endsWith('.txt')) {
  // A gene list already pulled out of a bundle, so this can be re-run without
  // touching an 895 MB file again.
  genes = readFileSync(path, 'utf8').split(NL).map(x => x.trim()).filter(Boolean)
  console.log(`  a plain gene list, ${genes.length.toLocaleString()} names`)
} else {
  const dir = await readZipDir(blob, 0, total)
  const names = [...dir.keys()]
  console.log(`  ${(total / 1e6).toFixed(0)} MB, ${dir.size} entries`)
  const flat = names.find(n => n.endsWith('genes.txt'))
  if (flat) {
    genes = new TextDecoder().decode(await readZipEntry(blob, dir.get(flat)))
      .split(NL).map(x => x.trim()).filter(Boolean)
  } else {
    // A collection stores each part as a whole zip inside this one, and every
    // part carries the same gene list, so the first is enough.
    const part = names.find(n => n.startsWith('parts/'))
    const pe = dir.get(part)
    const at = await payloadStart(blob, pe)
    const inner = {
      size: pe.compressedSize,
      slice: (f, t) => blob.slice(at + Math.max(0, f),
        at + Math.min(t === undefined ? pe.compressedSize : t, pe.compressedSize)),
    }
    const pdir = await readZipDir(inner, 0, pe.compressedSize)
    const gk = [...pdir.keys()].find(n => n.endsWith('genes.txt'))
    genes = new TextDecoder().decode(await readZipEntry(inner, pdir.get(gk)))
      .split(NL).map(x => x.trim()).filter(Boolean)
    console.log(`  a collection, gene list read from ${part}`)
  }
}
closeSync(fd)

/* ---------------- what the names look like ---------------- */
const isUpper = g => /[A-Za-z]/.test(g) && g === g.toUpperCase()
const isTitle = g => /^[A-Z][a-z]/.test(g)
const upper = genes.filter(isUpper)
const title = genes.filter(isTitle)
const other = genes.filter(g => !isUpper(g) && !isTitle(g))
const pct = n => `${(100 * n / genes.length).toFixed(1)}%`

console.log(`${NL}GENE NAMES  (${genes.length.toLocaleString()})`)
console.log(`  UPPER CASE  ${String(upper.length).padStart(6)}  ${pct(upper.length).padStart(6)}  e.g. ${upper.slice(0, 6).join(', ')}`)
console.log(`  Title case  ${String(title.length).padStart(6)}  ${pct(title.length).padStart(6)}  e.g. ${title.slice(0, 6).join(', ')}`)
console.log(`  neither     ${String(other.length).padStart(6)}  ${pct(other.length).padStart(6)}  e.g. ${other.slice(0, 6).join(', ')}`)

/* Uppercasing is how ORA matches, so anything it collapses is a real loss. */
const seen = new Map()
const clash = []
for (const g of genes) {
  const u = g.toUpperCase()
  const had = seen.get(u)
  if (had !== undefined && had !== g) clash.push(`${had}/${g}`)
  else seen.set(u, g)
}
console.log(`${NL}CASE COLLISIONS  (matching upper-cases, so these would merge)`)
console.log(`  ${genes.length - seen.size} of ${genes.length.toLocaleString()} names collapse`
  + (clash.length ? ` e.g. ${clash.slice(0, 8).join(', ')}` : ''))

console.log(`${NL}DETECTION`)
const det = detectSpecies(genes)
console.log(`  ${det.species}  (${det.from}, ${(det.support * 100).toFixed(0)}%)  ${det.why}`)

/* ---------------- does it change the answer? ---------------- */
const col = f => parse(new TextDecoder().decode(gunzipSync(readFileSync(`public/genesets/${f}`))))
const MOUSE = ['mouse.hallmark.gs', 'mouse.reactome.gs', 'mouse.go-bp.gs'].map(col)
const HUMAN = ['human.hallmark.gs', 'human.reactome.gs', 'human.go-bp.gs'].map(col)
const symsOf = cs => { const s = new Set(); for (const c of cs) for (const g of c.symbols) s.add(g); return s }
const ciRate = (bg, cs) => {
  const lib = new Set([...symsOf(cs)].map(g => g.toUpperCase()))
  let n = 0
  for (const g of bg) if (lib.has(g.toUpperCase())) n++
  return n / bg.length
}

console.log(`${NL}MATCH RATE`)
console.log(`  mouse, case-SENSITIVE    ${(matchRate(genes, symsOf(MOUSE)) * 100).toFixed(1).padStart(5)}%   <- what the warning reads`)
console.log(`  human, case-SENSITIVE    ${(matchRate(genes, symsOf(HUMAN)) * 100).toFixed(1).padStart(5)}%`)
console.log(`  mouse, case-INSENSITIVE  ${(ciRate(genes, MOUSE) * 100).toFixed(1).padStart(5)}%   <- what ORA actually uses`)
console.log(`  human, case-INSENSITIVE  ${(ciRate(genes, HUMAN) * 100).toFixed(1).padStart(5)}%`)

/* Symbols in one library and not the other, compared case-insensitively so
   spelling cannot influence which way this points. */
const only = (a, b) => {
  const B = new Set([...symsOf(b)].map(g => g.toUpperCase()))
  return new Set([...symsOf(a)].map(g => g.toUpperCase()).filter(g => !B.has(g)))
}
const mOnly = only(MOUSE, HUMAN), hOnly = only(HUMAN, MOUSE)
const hits = S => genes.reduce((n, g) => n + (S.has(g.toUpperCase()) ? 1 : 0), 0)
console.log(`${NL}SPECIES-DIAGNOSTIC SYMBOLS  (case-insensitive, so spelling cannot skew it)`)
console.log(`  mouse-only in the libraries ${mOnly.size.toLocaleString().padStart(6)}, this object hits ${hits(mOnly).toLocaleString()}`)
console.log(`  human-only in the libraries ${hOnly.size.toLocaleString().padStart(6)}, this object hits ${hits(hOnly).toLocaleString()}`)

/* The claim under test. Same query, same library, twice: once with the object's
   own names, once with every name title-cased. If casing is invisible to ORA
   then every id, K, k, p and padj comes back identical. */
console.log(`${NL}DOES CASING CHANGE AN ENRICHMENT RESULT?`)
const titleCase = g => g.charAt(0).toUpperCase() + g.slice(1).toLowerCase()
const asIs = indexFor(MOUSE, genes)
const recased = indexFor(MOUSE, genes.map(titleCase))
const q = genes.slice(0, 400)
const a = oraIndexed(q, asIs, { minSize: 10, maxSize: 500 })
const b = oraIndexed(q.map(titleCase), recased, { minSize: 10, maxSize: 500 })
const sig = r => [r.id, r.setSize, r.count, r.pvalue, r.padj].join('|')
const same = a.length === b.length && a.every((r, i) => sig(r) === sig(b[i]))
console.log(`  N (annotated background)      as-is ${asIs.N.toLocaleString().padStart(7)}   title-cased ${recased.N.toLocaleString()}`)
console.log(`  sets surviving the background  as-is ${asIs.sets.length.toLocaleString().padStart(7)}   title-cased ${recased.sets.length.toLocaleString()}`)
console.log(`  results for a 400-gene query   as-is ${String(a.length).padStart(7)}   title-cased ${b.length}`)
console.log(`  every id, K, k, p and padj identical: ${same}`)
if (a.length) {
  console.log(`  top hit: ${a[0].name}, k=${a[0].count}/${a[0].setSize}, padj ${a[0].padj.toExponential(2)}`)
}
