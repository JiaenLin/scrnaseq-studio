// A collection, opened as one intact dataset.
//
// The lab splits a large object because a browser cannot hold 736 M stored
// values. That is a storage decision, and it stops here: from this file upward
// there is one object with all of its cells, one gene list, one cluster menu,
// and every tab behaves exactly as it does for a 5 MB bundle. There is no part
// switcher because there is nothing to switch — the parts are not a thing the
// user has.
//
// Two things make that affordable.
//
// The cell-level data is small. 292 495 cells of cluster code, sample code,
// embedding and QC is about 7 MB, so all of it is read at open and the studio
// knows the whole object immediately: the real cell count, the real cluster
// list, every UMAP point.
//
// The matrix is not, so it is never held. A gene is read out of the file when a
// view asks for it (`ensure`), and the whole-transcriptome views walk the file
// once in chunk order and keep only their result row (`scan`). Both go through
// chunked.ts, which turns "gene 12 040" into one byte range per part.
//
// The dangerous step is the level union, and it lives in levels.ts with its own
// test: parts are written with unused levels dropped, so part A's cluster 0 and
// part B's cluster 0 are usually different cell types.

import type { CellType } from '../types.ts'
import type { Bundle, BundleMeta, Pseudobulk } from './bundle.ts'
import { bundleDataset, SCHEMA } from './bundle.ts'
import {
  chunkCount, makeChunkCache, readGenes,
  type ChunkCache, type GeneVector, type GetBytes,
} from './chunked.ts'
import type { CollectionIndex, PartEntry } from './collection.ts'
import { unionLevels } from './levels.ts'
import { scanMatrix, type MatrixPlan } from './part-scan.ts'
import { baseSource, type Source } from './source.ts'
import { readZipDir, payloadStart, readZipEntry, type ZipEntry } from './zipdir.ts'

class CollectionError extends Error {}
const fail = (msg: string): never => { throw new CollectionError(msg) }

/** Inflated chunk bytes held across all parts at once, while idle. */
const CACHE_BUDGET = 96 << 20
/** Assembled gene vectors kept in memory. A gene is ~1 % dense, so this is many. */
const GENE_BUDGET = 48 << 20
/** Pseudobulk is a dense genes × columns table; past this it is not worth it. */
const PB_MAX_VALUES = 12_000_000
/** Genes fetched per round, so one request cannot inflate half the matrix. */
const GENE_BATCH = 32
/** Parts read at once. Enough to keep the disk busy, few enough to bound memory. */
const PART_FANOUT = 8

interface Part {
  key: string
  nCells: number
  /** Where this part's cells start in the global numbering. */
  offset: number
  /** Byte offset of this part's expr.chunk.bin payload within the container. */
  base: number
  indptr: Int32Array
  chunkptr: Int32Array
  chunkGenes: number
  getBytes: GetBytes
  cache: ChunkCache
  meta: BundleMeta
}

interface Sparse { cells: Int32Array; values: Float32Array }

const dec = new TextDecoder()

/** The payload offset of one collection entry, from its own local header. */
async function entryStart(file: Blob, e: PartEntry): Promise<number> {
  const head = await file.slice(e.start, e.start + 30).arrayBuffer()
  const h = new DataView(head)
  if (h.getUint32(0, true) !== 0x04034b50) {
    fail(`the part ${e.name} is not where the collection index says — this file is damaged`)
  }
  return e.start + 30 + h.getUint16(26, true) + h.getUint16(28, true)
}

const need = (dir: Map<string, ZipEntry>, name: string, part: string): ZipEntry =>
  dir.get(name) ?? fail(`part ${part} has no ${name} — rebuild this collection in the lab`)

/** A typed view that copies, because a zip payload is not aligned. */
const view = <T>(Ctor: new (b: ArrayBuffer) => T, bytes: Uint8Array): T =>
  new Ctor(bytes.slice().buffer)

export interface OpenProgress {
  (phase: string, done: number, total: number): void
}

export async function openCollection(
  file: Blob, index: CollectionIndex, onProgress?: OpenProgress,
): Promise<Source> {
  const cmeta = index.meta
  if (!cmeta.parts?.length) fail('this collection lists no parts')

  const perPartCache = Math.max(2 << 20, Math.floor(CACHE_BUDGET / cmeta.parts.length))
  const parts: Part[] = []
  const clusterLevels: string[][] = []
  const sampleLevels: string[][] = []
  const condLevels: string[][] = []
  const clusterCodes: Uint16Array[] = []
  const sampleCodes: Uint16Array[] = []
  const embeds: Float32Array[] = []
  const qcs: Float32Array[] = []
  const pbTexts: (string | null)[] = []
  let genes: string[] | null = null
  let geneBytes: Uint8Array | null = null
  let offset = 0
  let nnz = 0

  for (let i = 0; i < cmeta.parts.length; i++) {
    const info = cmeta.parts[i]
    onProgress?.('reading parts', i, cmeta.parts.length)
    const entry = index.entries.get(info.file)
      ?? fail(`the collection index names a part "${info.file}" that is not in the file`)
    const start = await entryStart(file, entry)
    const dir = await readZipDir(file, start, entry.size)

    const meta = JSON.parse(dec.decode(
      await readZipEntry(file, need(dir, 'meta.json', info.key)))) as BundleMeta
    if (meta.schema !== SCHEMA) {
      fail(`part ${info.key} says schema ${meta.schema ?? '(none)'}; this app reads ${SCHEMA}`)
    }

    const gz = await readZipEntry(file, need(dir, 'genes.txt', info.key))
    if (geneBytes === null) {
      geneBytes = gz
      genes = dec.decode(gz).split('\n').map(g => g.replace(/\r$/, '')).filter(g => g.length > 0)
      if (genes.length !== meta.nGenes) {
        fail(`part ${info.key} lists ${genes.length} genes but its own header says ${meta.nGenes}`)
      }
    } else if (gz.length !== geneBytes.length || !gz.every((b, k) => b === geneBytes![k])) {
      // Parts are pieces of one object; a different gene list means they are not.
      fail(`part ${info.key} has a different gene list from the first part — `
        + 'these bundles are not pieces of one object and cannot be opened together')
    }

    const chunk = need(dir, 'expr.chunk.bin', info.key)
    if (chunk.method !== 0) {
      fail(`part ${info.key} stores its expression chunks compressed, so single genes `
        + 'cannot be read out of it — rebuild this collection in the lab')
    }
    const chunkGenes = meta.chunkGenes ?? 0
    if (!Number.isInteger(chunkGenes) || chunkGenes < 1) {
      fail(`part ${info.key} does not say how many genes are in a chunk — rebuild this collection in the lab`)
    }
    const base = await payloadStart(file, chunk)

    const indptr = view(Int32Array, await readZipEntry(file, need(dir, 'expr.indptr.i32', info.key)))
    const chunkptr = view(Int32Array, await readZipEntry(file, need(dir, 'expr.chunkptr.i32', info.key)))
    const cluster = view(Uint16Array, await readZipEntry(file, need(dir, 'cluster.u16', info.key)))
    const sample = view(Uint16Array, await readZipEntry(file, need(dir, 'sample.u16', info.key)))
    const embed = view(Float32Array, await readZipEntry(file, need(dir, 'embed.f32', info.key)))
    const qc = view(Float32Array, await readZipEntry(file, need(dir, 'qc.f32', info.key)))

    const n = meta.nCells
    if (indptr.length !== meta.nGenes + 1) {
      fail(`part ${info.key} has ${indptr.length} gene offsets, expected ${meta.nGenes + 1}`)
    }
    if (chunkptr.length !== chunkCount(meta.nGenes, chunkGenes) + 1) {
      fail(`part ${info.key} has ${chunkptr.length - 1} chunks but ${meta.nGenes} genes `
        + `at ${chunkGenes} per chunk make ${chunkCount(meta.nGenes, chunkGenes)}`)
    }
    if (cluster.length !== n || sample.length !== n) {
      fail(`part ${info.key} has cluster/sample arrays that do not match its ${n} cells`)
    }
    if (embed.length !== 2 * n) fail(`part ${info.key} has a malformed embedding`)
    if (qc.length !== 3 * n) fail(`part ${info.key} has a malformed QC table`)
    if (!meta.clusters?.length) fail(`part ${info.key} has no clusters`)
    if (!meta.samples?.length) fail(`part ${info.key} has no samples`)
    for (let k = 0; k < n; k++) {
      if (cluster[k] >= meta.clusters.length) fail(`part ${info.key} refers to a cluster it does not define`)
      if (sample[k] >= meta.samples.length) fail(`part ${info.key} refers to a sample it does not define`)
    }

    parts.push({
      key: info.key, nCells: n, offset, base, indptr, chunkptr, chunkGenes, meta,
      cache: makeChunkCache(perPartCache),
      getBytes: async (from, to) =>
        new Uint8Array(await file.slice(base + from, base + to).arrayBuffer()),
    })
    clusterLevels.push(meta.clusters)
    sampleLevels.push(meta.samples.map(s => s.id))
    condLevels.push(meta.conditions ?? [])
    clusterCodes.push(cluster)
    sampleCodes.push(sample)
    embeds.push(embed)
    qcs.push(qc)
    pbTexts.push(dir.has('pseudobulk.tsv')
      ? dec.decode(await readZipEntry(file, dir.get('pseudobulk.tsv')!)) : null)
    offset += n
    nnz += meta.nnz ?? 0
  }
  onProgress?.('reading parts', parts.length, parts.length)

  const nCells = offset
  const nGenes = genes!.length
  const notes: string[] = [...(parts[0].meta.notes ?? [])]

  // ---- one set of levels across every part --------------------------------
  // The writer records the whole object's cluster order; using it keeps a
  // cell type the colour it had before the object was ever split.
  const cl = unionLevels(clusterLevels, cmeta.clusterOrder)
  const sm = unionLevels(sampleLevels)
  const cd = unionLevels(condLevels)

  // A sample can appear in more than one part, and the exporter records one
  // condition per sample by looking at that part's first cell — so two parts can
  // disagree. First wins, which is what an unsplit export would also have done;
  // saying so is better than a number nobody can trace.
  const sampleCond = new Array<string | null>(sm.levels.length).fill(null)
  let conflicts = 0
  parts.forEach((p, pi) => {
    p.meta.samples.forEach((s, si) => {
      const gi = sm.maps[pi][si]
      if (sampleCond[gi] === null) sampleCond[gi] = s.condition
      else if (sampleCond[gi] !== s.condition) conflicts++
    })
  })
  if (conflicts) {
    notes.push(`${conflicts} sample${conflicts === 1 ? '' : 's'} carry more than one group label `
      + 'across the object; the first one found is used, as it would be without the split')
  }

  const cluster = new Uint16Array(nCells)
  const sample = new Uint16Array(nCells)
  const embed = new Float32Array(nCells * 2)
  const qc = new Float32Array(nCells * 3)
  parts.forEach((p, pi) => {
    const cmap = cl.maps[pi]
    const smap = sm.maps[pi]
    const src = clusterCodes[pi]
    const ssrc = sampleCodes[pi]
    for (let k = 0; k < p.nCells; k++) {
      cluster[p.offset + k] = cmap[src[k]]
      sample[p.offset + k] = smap[ssrc[k]]
    }
    embed.set(embeds[pi], p.offset * 2)
    qc.set(qcs[pi], p.offset * 3)
  })
  if (cl.levels.length > 65535 || sm.levels.length > 65535) {
    fail('this object has more than 65 535 clusters or samples across its parts')
  }

  const meta0 = parts[0].meta
  // Merged first, because whether the summed counts survived the merge is what
  // "raw counts: present" on Overview is actually promising.
  const pseudobulk = mergePseudobulk(pbTexts, genes!, notes)
  const merged: BundleMeta = {
    schema: SCHEMA,
    label: cmeta.label ?? meta0.label,
    source: cmeta.source ?? meta0.source,
    nCells, nGenes, nnz,
    clusters: cl.levels,
    samples: sm.levels.map((id, i) => ({ id, condition: sampleCond[i] ?? cd.levels[0] ?? 'all cells' })),
    conditions: cd.levels.length ? cd.levels : ['all cells'],
    embedding: meta0.embedding,
    expression: meta0.expression,
    hasRawCounts: parts.every(p => p.meta.hasRawCounts) && pseudobulk !== null,
    provenance: meta0.provenance ?? {},
    notes,
  }


  // ---- the cell-level object the views already know -----------------------
  const d = bundleDataset({
    meta: merged, genes: genes!,
    indptr: new Int32Array(0), indices: new Int32Array(0), data: new Float32Array(0),
    cluster, sample, embed, qc, pseudobulk,
  } as Bundle)

  const types: CellType[] = merged.clusters.map(name => ({
    name, key: name, cx: 0, cy: 0, sd: 0, base: 0, resp: 0, mk: [],
  }))

  // ---- gene values, read from the file on demand --------------------------
  const geneIndex = new Map(genes!.map((g, i) => [g.toUpperCase(), i]))
  const loaded = new Map<string, Sparse>()
  let loadedBytes = 0

  const remember = (gene: string, s: Sparse) => {
    loaded.set(gene, s)
    loadedBytes += s.cells.length * 8
    for (const [k, v] of loaded) {
      if (loadedBytes <= GENE_BUDGET || loaded.size <= 1) break
      loaded.delete(k)
      loadedBytes -= v.cells.length * 8
    }
  }

  /** One gene across every part, renumbered into global cells. */
  const stitch = (perPart: { cells: Int32Array; values: Float32Array }[]): Sparse => {
    let total = 0
    for (const v of perPart) total += v.cells.length
    const cells = new Int32Array(total)
    const values = new Float32Array(total)
    let w = 0
    perPart.forEach((v, pi) => {
      const off = parts[pi].offset
      for (let k = 0; k < v.cells.length; k++) cells[w + k] = v.cells[k] + off
      values.set(v.values, w)
      w += v.cells.length
    })
    return { cells, values }
  }

  const ensure = async (want: readonly string[]) => {
    const names: string[] = []
    const idxs: number[] = []
    for (const g of want) {
      const canonical = genes![geneIndex.get(g.toUpperCase()) ?? -1]
      if (canonical === undefined || loaded.has(canonical) || names.includes(canonical)) continue
      names.push(canonical)
      idxs.push(geneIndex.get(g.toUpperCase())!)
    }
    if (!names.length) return
    // In batches, and a few parts at a time. One readGenes call holds every
    // chunk its genes touch, so asking for the marker panel's 300 genes across
    // 43 parts in one go would inflate most of the matrix at once — which is
    // exactly what this file exists to avoid. Sorted first, so a batch stays
    // within a few neighbouring chunks.
    const order = names.map((_n, i) => i).sort((a, b) => idxs[a] - idxs[b])
    for (let at = 0; at < order.length; at += GENE_BATCH) {
      const batch = order.slice(at, at + GENE_BATCH)
      const wanted = batch.map(i => idxs[i])
      const perPart: GeneVector[][] = new Array(parts.length)
      for (let from = 0; from < parts.length; from += PART_FANOUT) {
        const slice = parts.slice(from, from + PART_FANOUT)
        const got = await Promise.all(slice.map(p =>
          readGenes(p.getBytes, p.chunkptr, p.indptr, p.chunkGenes, wanted, p.cache)))
        got.forEach((v, k) => { perPart[from + k] = v })
      }
      batch.forEach((i, gi) => remember(names[i], stitch(perPart.map(v => v[gi]))))
    }
  }

  const nonZero = (gene: string, cb: (cell: number, value: number) => void) => {
    const s = loaded.get(genes![geneIndex.get(gene.toUpperCase()) ?? -1] ?? '')
    if (!s) return
    for (let k = 0; k < s.cells.length; k++) cb(s.cells[k], s.values[k])
  }

  const vector = (gene: string): Float32Array => {
    const out = new Float32Array(nCells)
    nonZero(gene, (cell, value) => { out[cell] = value })
    return out
  }

  // Where every gene lives, as numbers only — no Blob slices bound into
  // closures, nothing that cannot be structured-cloned. This is what the compute
  // worker is handed, and it is also what this Source's own scan runs on, so
  // page and worker walk the file by the same description.
  const plan: MatrixPlan = {
    nGenes,
    chunkGenes: parts[0].chunkGenes,
    parts: parts.map(p => ({
      base: p.base, offset: p.offset,
      indptr: p.indptr, chunkptr: p.chunkptr, chunkGenes: p.chunkGenes,
    })),
  }

  const scan: Source['scan'] = (visit, onScanProgress, cancelled) =>
    scanMatrix(file, plan, visit, onScanProgress, cancelled)

  const src = baseSource(d, types, genes!, {
    label: merged.label,
    source: merged.source,
    expression: merged.expression,
    hasRawCounts: merged.hasRawCounts,
    embedding: merged.embedding,
    provenance: merged.provenance,
    notes,
    isDemo: false,
  }, vector, nonZero, pseudobulk)

  return Object.assign(src, {
    lazy: true,
    nParts: parts.length,
    remote: { file, plan },
    ensure,
    scan,
    scanSync: () => false,
  })
}

/**
 * The parts' pseudobulk tables, added back together.
 *
 * A column is one sample within one cluster. Splitting by anything other than
 * sample or cluster can put the same column in two parts, so the counts are
 * summed rather than concatenated — which is what the unsplit export would have
 * written.
 */
function mergePseudobulk(
  texts: (string | null)[], genes: string[], notes: string[],
): Pseudobulk | null {
  if (!texts.some(t => t)) return null
  if (!texts.every(t => t)) {
    notes.push('some parts carry summed raw counts and others do not, so pseudobulk is not offered')
    return null
  }

  type Col = { sample: string; cluster: string; nCells: number }
  const key = (c: Col) => `${c.sample}||${c.cluster}`
  const columns: Col[] = []
  const at = new Map<string, number>()
  // The headers carry sample and cluster by NAME, not by code, so nothing has to
  // be remapped here — which is exactly why the exporter writes them that way.
  const parsed = texts.map((text) => {
    const lines = text!.split('\n').filter(l => l.trim().length > 0)
    if (lines.length < 2) return null
    const cols = lines[0].split('\t').slice(1).map(h => {
      const [s, c, n] = h.split('||')
      return { sample: s, cluster: c ?? '', nCells: Number(n) || 0 }
    })
    return { lines, cols }
  })
  if (parsed.some(p => !p)) return null

  for (const p of parsed) {
    for (const c of p!.cols) {
      const k = key(c)
      const seen = at.get(k)
      if (seen === undefined) { at.set(k, columns.length); columns.push({ ...c }) }
      else columns[seen].nCells += c.nCells
    }
  }

  if (columns.length * genes.length > PB_MAX_VALUES) {
    notes.push(`the summed raw counts across this object come to ${columns.length} `
      + `sample × cluster columns over ${genes.length} genes, too large to hold in the browser — `
      + 'the pseudobulk export is not offered, and the Wilcoxon test is unaffected')
    return null
  }

  const counts = new Int32Array(genes.length * columns.length)
  for (const p of parsed) {
    const map = p!.cols.map(c => at.get(key(c))!)
    for (let r = 1; r < p!.lines.length; r++) {
      const cells = p!.lines[r].split('\t')
      const gi = r - 1
      if (cells[0] !== genes[gi]) return null
      for (let c = 0; c < map.length; c++) {
        counts[gi * columns.length + map[c]] += +cells[c + 1] || 0
      }
    }
  }
  return { genes, columns, counts }
}
