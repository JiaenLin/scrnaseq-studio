// Load a real bundle and run the statistics against it.
//
// Not part of `npm test` — it needs a bundle on disk. Run it after
// tools/export_*.  It answers the two questions a unit test cannot: is a full
// 13k-gene run fast enough to sit behind a click, and does it find the biology.
//
//   node scripts/bench-bundle.mjs testdata/pbmc3k_h5ad.zip
import { readFileSync } from 'node:fs'
import { parseBundle } from '../src/lib/bundle.ts'
import { bundleSource } from '../src/lib/source.ts'
import { deMarkers, thresholdFor, isSig } from '../src/lib/stats.ts'

const path = process.argv[2] ?? 'testdata/pbmc3k_h5ad.zip'
const t0 = performance.now()
const b = parseBundle(readFileSync(path).buffer)
const src = bundleSource(b)
console.log(`${path}\n  parsed in ${(performance.now() - t0) | 0} ms — `
  + `${src.d.nCells} cells × ${src.genes.length} genes, ${b.meta.nnz} non-zeros`)
console.log(`  clusters: ${src.clusters.join(', ')}`)
console.log(`  pseudobulk: ${src.pseudobulk ? src.pseudobulk.columns.length + ' columns' : 'none'}`)

const th = thresholdFor('wilcox')
let total = 0
for (let ti = 0; ti < src.clusters.length; ti++) {
  const t = performance.now()
  const { rows, n1 } = deMarkers(src, ti)
  const ms = performance.now() - t
  total += ms
  const up = rows.filter(r => isSig(r, th) && r.lfc > 0)
  console.log(
    `  ${src.clusters[ti].padEnd(20)} ${String(n1).padStart(5)} cells  `
    + `${String(up.length).padStart(4)} markers  ${String(ms | 0).padStart(5)} ms  `
    + `top: ${up.slice(0, 6).map(r => r.gene).join(', ')}`)
}
console.log(`  all ${src.clusters.length} clusters in ${(total / 1000).toFixed(1)} s`)
