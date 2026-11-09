// A synthetic object carrying an annotator's sentinels, in the shape the lab writes.
//
// A sentinel is a label value that says the annotator did NOT call a cell —
// the single-cell profile's defaults are EXCLUDED and UNRESOLVED. The lab's
// command-line converter keeps such cells in `clusters` (they are real cells,
// and they are drawn) and lists the levels in `meta.sentinels`, in every part
// and in `collection.json` (scrnaseq-lab, src/lib/build.ts `sentinels`).
//
// Everything here is made up: types TypeA..TypeC, samples s1..s4, groups a1/a2,
// genes Gene01..Gene12. The sentinels sit FIRST and LAST in the cluster order,
// which is where an alphabetical level order puts them, so an off-by-one in
// any index arithmetic shows up as a wrong type.

import { strToU8, zipSync } from 'fflate'
import { writeChunked } from '../src/lib/chunked.ts'
import { writeCollection } from '../src/lib/collection.ts'

export const CLUSTERS = ['EXCLUDED', 'TypeA', 'TypeB', 'TypeC', 'UNRESOLVED']
export const SENTINELS = ['EXCLUDED', 'UNRESOLVED']
export const SAMPLES = [
  { id: 's1', condition: 'a1' }, { id: 's2', condition: 'a1' },
  { id: 's3', condition: 'a2' }, { id: 's4', condition: 'a2' },
]
export const CONDITIONS = ['a1', 'a2']
export const GENES = Array.from({ length: 12 }, (_g, i) => `Gene${String(i + 1).padStart(2, '0')}`)
const PER_SAMPLE = 25
export const N = SAMPLES.length * PER_SAMPLE

/** Sample of cell i. */
export const sampleOf = (i) => Math.floor(i / PER_SAMPLE)

/**
 * Cluster code of cell i: the sentinels at fixed places, the rest spread over
 * the three types unevenly and differently per sample, so composition has
 * something to say and no two samples say the same thing.
 */
export const clusterOf = (i) =>
  (i % 10 === 3 ? 0
    : i % 16 === 7 ? 4
      : 1 + ((i * 7 + sampleOf(i) * 2 + (i % 5 === 0 ? 1 : 0)) % 3))

/**
 * Deterministic expression. Gene01..03 mark TypeA..C. Gene04 is high in the
 * EXCLUDED cells and nowhere else: it is the probe for whether sentinel cells
 * leak into a marker comparison, because only they could make it a marker.
 * The rest is background that every type shares.
 */
export function valueAt(g, i) {
  const t = clusterOf(i)
  const wobble = ((g * 13 + i * 7) % 11) / 10
  if (g < 3) return t === g + 1 ? 1.5 + wobble : (i + g) % 9 === 0 ? 0.3 : 0
  if (g === 3) return t === 0 ? 2.5 + wobble : 0
  return (g * 5 + i * 3) % 4 === 0 ? 0 : 0.2 + wobble
}

/** The CSC (gene-major) arrays over cells [from, to). */
function csc(from, to) {
  const indptr = new Int32Array(GENES.length + 1)
  const idx = []
  const dat = []
  for (let g = 0; g < GENES.length; g++) {
    for (let i = from; i < to; i++) {
      const v = valueAt(g, i)
      if (v !== 0) { idx.push(i - from); dat.push(v) }
    }
    indptr[g + 1] = idx.length
  }
  return { indptr, indices: Int32Array.from(idx), data: Float32Array.from(dat) }
}

const u8 = (typed) => new Uint8Array(typed.buffer)

/** Summed "raw counts" per sample × cluster, as pseudobulk.tsv carries them. */
function pseudobulkTsv(from, to, clusters, sampleIds) {
  const cols = new Map()
  for (let i = from; i < to; i++) {
    const key = `${SAMPLES[sampleOf(i)].id}||${CLUSTERS[clusterOf(i)]}`
    if (!cols.has(key)) cols.set(key, { n: 0, sums: new Array(GENES.length).fill(0) })
    const c = cols.get(key)
    c.n++
    for (let g = 0; g < GENES.length; g++) c.sums[g] += Math.round(valueAt(g, i) * 4)
  }
  const keys = [...cols.keys()].filter(k => {
    const [s, cl] = k.split('||')
    return sampleIds.includes(s) && clusters.includes(cl)
  })
  const header = ['gene', ...keys.map(k => `${k}||${cols.get(k).n}`)].join('\t')
  const rows = GENES.map((gene, g) => [gene, ...keys.map(k => cols.get(k).sums[g])].join('\t'))
  return [header, ...rows].join('\n')
}

/**
 * A coarser label carried as an extra column, which names the same uncalled
 * cells with the same words — what re-pointing the cell type lands on.
 */
export const COARSE = ['Lineage1', 'Lineage2', 'EXCLUDED', 'UNRESOLVED']
const coarseOf = (i) => [2, 0, 0, 1, 3][clusterOf(i)]

/**
 * `sentinels` as asked for: the lab's list when the option is not given at all,
 * and exactly what was given otherwise — including `undefined`, which is a
 * bundle with no field. (A destructuring default would quietly turn an explicit
 * `undefined` back into the list.)
 */
const sentinelsOf = (opts) => ('sentinels' in opts ? opts.sentinels : SENTINELS)

/**
 * The bundle, over cells [from, to). `sentinels` is the list as the lab writes
 * it (a part names only the ones it has cells of), `undefined` for a bundle
 * that predates the field, or anything else to test how a malformed one is
 * met. `raw` is written verbatim, unfiltered.
 */
function bundleFiles(opts = {}) {
  const { from = 0, to = N, raw, chunked = false } = opts
  const sentinels = sentinelsOf(opts)
  const n = to - from
  // A part names only the levels it has cells for, as the lab writes them.
  const usedC = [...new Set(Array.from({ length: n }, (_x, k) => clusterOf(from + k)))].sort((a, b) => a - b)
  const usedS = [...new Set(Array.from({ length: n }, (_x, k) => sampleOf(from + k)))].sort((a, b) => a - b)
  const clusters = usedC.map(c => CLUSTERS[c])
  const samples = usedS.map(s => SAMPLES[s])
  const cluster = Uint16Array.from({ length: n }, (_x, k) => usedC.indexOf(clusterOf(from + k)))
  const sample = Uint16Array.from({ length: n }, (_x, k) => usedS.indexOf(sampleOf(from + k)))
  const embed = Float32Array.from({ length: 2 * n }, (_x, k) => {
    const i = from + (k >> 1)
    return k % 2 === 0 ? clusterOf(i) * 4 + (i % 7) / 7 : sampleOf(i) + (i % 5) / 5
  })
  const qc = Float32Array.from({ length: 3 * n }, (_x, k) => {
    const i = from + Math.floor(k / 3)
    return k % 3 === 0 ? 1000 + i : k % 3 === 1 ? 400 + (i % 50) : (i % 7) * 0.5
  })
  const { indptr, indices, data } = csc(from, to)
  const meta = {
    schema: 'scrnaseq-studio/bundle@1',
    label: 'sentinel fixture', source: 'fixture.h5ad (AnnData, converted in scRNA-seq Lab)',
    nCells: n, nGenes: GENES.length, nnz: indices.length,
    clusters, samples, conditions: [...new Set(samples.map(s => s.condition))],
    embedding: 'X_umap', expression: 'log1p(CP10K)', hasRawCounts: true,
    provenance: { normalization: 'log1p(CP10K)', clustering: 'cell_type', condition: 'factor_a' },
    notes: ['a fixture'],
    extras: [{ key: 'coarse', file: 'extra.coarse.u16', levels: COARSE }],
    ...(raw !== undefined ? { sentinels: raw }
      : sentinels === undefined ? {}
        : { sentinels: Array.isArray(sentinels) ? sentinels.filter(s => clusters.includes(s)) : sentinels }),
    ...(chunked ? { chunkGenes: 4 } : {}),
  }
  const files = {
    'meta.json': strToU8(JSON.stringify(meta)),
    'genes.txt': strToU8(GENES.join('\n')),
    'cluster.u16': u8(cluster),
    'sample.u16': u8(sample),
    'extra.coarse.u16': u8(Uint16Array.from({ length: n }, (_x, k) => coarseOf(from + k))),
    'embed.f32': u8(embed),
    'qc.f32': u8(qc),
    'expr.indptr.i32': u8(indptr),
    'expr.indices.i32': u8(indices),
    'expr.data.f32': u8(data),
    'pseudobulk.tsv': strToU8(pseudobulkTsv(from, to, clusters, samples.map(s => s.id))),
  }
  if (chunked) {
    // Stored, not deflated: a collection reads its chunks by byte range.
    const { bin, ptr } = writeChunked(indptr, indices, data, 4)
    files['expr.chunkptr.i32'] = u8(ptr)
    files['expr.chunk.bin'] = [bin, { level: 0 }]
  }
  return files
}

/** One bundle holding the whole object. */
export const sentinelBundle = (opts = {}) => zipSync(bundleFiles(opts)).buffer

/**
 * The same object as a two-part collection, split by sample the way the lab
 * splits an atlas: s1–s2 and s3–s4, each part with its own levels and its own
 * `sentinels`, and the whole list in `collection.json`.
 */
export function sentinelCollection(opts = {}) {
  const sentinels = sentinelsOf(opts)
  const half = N / 2
  const parts = [[0, half], [half, N]].map(([from, to], k) => ({
    key: `p${k + 1}`, file: `parts/p${k + 1}.zip`, nCells: to - from,
    bytes: zipSync(bundleFiles({ from, to, sentinels, chunked: true })),
  }))
  const meta = {
    schema: 'scrnaseq-studio/collection@1',
    label: 'sentinel fixture', source: 'fixture.h5ad (AnnData, converted in scRNA-seq Lab)',
    splitBy: 'sample', reason: 'split for the test', nCells: N, nGenes: GENES.length,
    clusterOrder: CLUSTERS, condOrder: CONDITIONS,
    ...(sentinels === undefined ? {} : { sentinels }),
    parts: parts.map(p => ({ key: p.key, file: p.file, nCells: p.nCells, nnz: 0, bytes: p.bytes.length })),
    notes: [],
  }
  return writeCollection(meta, parts.map(p => ({ file: p.file, bytes: p.bytes })))
}

/** The truth, counted straight from the generator: cells per sample per cluster. */
export function truth() {
  const per = SAMPLES.map(() => new Array(CLUSTERS.length).fill(0))
  for (let i = 0; i < N; i++) per[sampleOf(i)][clusterOf(i)]++
  return per
}
