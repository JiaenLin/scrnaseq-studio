// The per-identity table the Gene sets tab should show, computed in Node by the
// implementation as it was BEFORE the score moved into a worker.
//
// The browser probe compares its rows against this, cell by cell and digit by
// digit. That is the whole point: the studio is not being checked against
// itself, it is being checked against the answer it used to give.
//
//   node scripts/expect-sets.mjs <collection.zip> <out.json> [setIndex] [custom genes]

import fs from 'node:fs'
import { fileBlob, needsShim } from './big-blob.mjs'
import { loadBaseline } from './score-baseline.mjs'
import { summarise } from '../src/lib/score.ts'
import { GENE_SETS } from '../src/lib/genesets.ts'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'

const [collectionPath, outPath, setIdx = '0', customArg = 'MS4A1, CD79A, CD79B'] =
  process.argv.slice(2)
const set = GENE_SETS[Number(setIdx)]
const { moduleScoreAsync: baselineScore } = await loadBaseline()

// Past 4 GB Node's own Blob lies about its length; see big-blob.mjs.
const blob = needsShim(collectionPath)
  ? fileBlob(collectionPath)
  : await fs.openAsBlob(collectionPath)
console.error(`  ${collectionPath} is ${(blob.size / 1e9).toFixed(2)} GB`)
const index = await readCollectionIndex(blob)
if (!index) throw new Error('not recognised as a collection')
const src = await openCollection(blob, index)

// The identity axis as the tab builds it with "Across cell types": one row per
// cluster, in the object's own cluster order, holding every cell of that cluster.
// Built once — it is the same axis whichever set is being scored.
const perType = src.types.map(() => [])
src.d.cells.forEach((c, i) => { if (perType[c.t]) perType[c.t].push(i) })
const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`

async function table(label, genes) {
  const t0 = Date.now()
  let last = 0
  const score = await baselineScore(src, genes, undefined, (phase, done, total) => {
    if (Date.now() - last < 4000) return
    last = Date.now()
    console.error(`  ${label} · ${phase}: ${done} of ${total}`)
  })
  console.error(`  ${label}: ${score.used.length} genes, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  return src.types.map((t, ti) => {
    const st = summarise(score.scores, perType[ti])
    return [t.name, String(st.n), signed(st.med), signed(st.mean)]
  })
}

const out = {
  setId: set.id,
  setName: set.name,
  rows: await table(set.id, set.genes),
  custom: customArg,
  // The studio parses the box into found-then-missing before scoring; a list of
  // genes the object measures is the same either way.
  customRows: await table('custom', customArg.split(',').map(g => g.trim()).filter(Boolean)),
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1))
console.error(`wrote ${out.rows.length} rows to ${outPath}`)
