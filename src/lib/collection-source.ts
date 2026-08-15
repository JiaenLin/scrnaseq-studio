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
import type { Bundle, BundleMeta, Embedding, ExtraColumn, Pseudobulk } from './bundle.ts'
import { bundleDataset, SCHEMA } from './bundle.ts'
import { makeGeneNames } from './genes.ts'
import {
  chunkCount, makeChunkCache, readGenes,
  type ChunkCache, type GeneVector, type GetBytes,
} from './chunked.ts'
import type { CollectionIndex, CollectionMeta, PartEntry } from './collection.ts'
import { unionLevels } from './levels.ts'
import { scanMatrix, type MatrixPlan } from './part-scan.ts'
import { baseSource, type Source } from './source.ts'
import { readZipDir, payloadStart, readZipEntry, type ZipEntry } from './zipdir.ts'

class CollectionError extends Error {}
/**
 * The annotation is on the VARIABLE, not just the return type.
 *
 * TypeScript narrows control flow past a never-returning call only when the
 * thing being called is declared with an explicit type — with the `: never`
 * on the arrow alone, `if (!x) fail(...)` does not narrow `x` afterwards, and
 * every caller was reaching for a `!` to get past it. That is how a parser
 * that already checks its input ended up full of assertions.
 */
const fail: (msg: string) => never = (msg) => { throw new CollectionError(msg) }

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
  // Read without the index type having to know the fields, so a studio built
  // against an older collection.ts still reads a collection that carries them.
  const { condOrder, extraOrder } = cmeta as CollectionMeta & {
    condOrder?: string[]
    extraOrder?: Record<string, string[]>
  }

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
  let alias: string[] | null = null
  let offset = 0
  let nnz = 0

  // The extra embeddings, by key, one entry per part in part order. The keys
  // come from the FIRST part, because every part is written from one object —
  // but each part's own meta says where its copy lives, since the entry name is
  // sanitised and two parts need not agree on it.
  let extraKeys: string[] = []
  const extras: Float32Array[][] = []
  const droppedEmb = new Set<string>()

  // The extra categorical columns, the same way and for the same reason: the
  // keys come from the first part, each part says where its own copy lives, and
  // a part that cannot supply one drops it from the whole object rather than
  // leaving a hole. Half a column would put a third of the atlas in whichever
  // level happens to be code 0 — a figure, not an error.
  let colKeys: string[] = []
  const colLevels: string[][][] = []
  const colCodes: Uint16Array[][] = []
  const droppedCol = new Set<string>()

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

    // The alias is a property of the gene list, and the gene list is checked
    // above to be identical in every part — so it is read from the first only,
    // exactly as genes.txt is.
    if (i === 0 && meta.geneAlias) {
      const name = meta.geneAlias.file || 'gene_alias.txt'
      const lines = dec.decode(await readZipEntry(file, need(dir, name, info.key)))
        .split('\n').map(g => g.replace(/\r$/, ''))
      if (lines.length === meta.nGenes + 1 && lines[lines.length - 1] === '') lines.pop()
      if (lines.length !== meta.nGenes) {
        fail(`part ${info.key} has ${lines.length} gene aliases but ${meta.nGenes} genes`)
      }
      // `genes` is filled from part 0 before this runs, but that is an
      // invariant of the loop rather than something the type system knows —
      // and this is a user's file. Checked, so a bundle that somehow arrives
      // with an alias table and no gene list says so instead of throwing
      // "cannot read properties of null" out of a render.
      if (!genes) fail(`part ${info.key} carries gene aliases but no gene list`)
      // Copied to a const: `genes` is a `let`, so the narrowing above does not
      // survive into the callback — it could in principle be reassigned before
      // the callback runs. It cannot here, and this says so.
      const from = genes
      alias = lines.map((a, k) => a || from[k])
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

    // Every embedding other than the default. A part that cannot supply one
    // drops it from the whole menu rather than leaving a hole: half an
    // embedding would draw that part's cells stacked on the origin, which looks
    // like a result.
    const listed = meta.embeddings ?? [{ key: meta.embedding, file: 'embed.f32' }]
    if (i === 0) extraKeys = listed.slice(1).map(e => e.key)
    const mine: Float32Array[] = []
    for (const key of extraKeys) {
      const ent = listed.find(e => e.key === key)
      const zip = ent && ent.file !== 'embed.f32' ? dir.get(ent.file) : undefined
      const xy = zip ? view(Float32Array, await readZipEntry(file, zip)) : null
      if (!xy || xy.length !== 2 * n) droppedEmb.add(key)
      mine.push(xy ?? new Float32Array(0))
    }
    extras.push(mine)

    const carried = Array.isArray(meta.extras) ? meta.extras : []
    if (i === 0) colKeys = carried.map(c => c.key)
    const mineLevels: string[][] = []
    const mineCodes: Uint16Array[] = []
    for (const key of colKeys) {
      const ent = carried.find(c => c.key === key)
      const zip = ent?.file ? dir.get(ent.file) : undefined
      const codes = zip ? view(Uint16Array, await readZipEntry(file, zip)) : null
      const levels = ent?.levels ?? []
      if (!codes || codes.length !== n || !levels.length) droppedCol.add(key)
      else {
        for (let k = 0; k < n; k++) {
          if (codes[k] >= levels.length) { droppedCol.add(key); break }
        }
      }
      mineLevels.push(levels)
      mineCodes.push(codes ?? new Uint16Array(0))
    }
    colLevels.push(mineLevels)
    colCodes.push(mineCodes)

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
    const pbEntry = dir.get('pseudobulk.tsv')
    pbTexts.push(pbEntry ? dec.decode(await readZipEntry(file, pbEntry)) : null)
    offset += n
    nnz += meta.nnz ?? 0
  }
  onProgress?.('reading parts', parts.length, parts.length)

  const nCells = offset
  // Every path above sets this from part 0; saying so out loud costs nothing
  // and turns "a part is missing its gene list" from a blank page into a
  // sentence that names the problem.
  if (!genes) fail('no part in this collection carries a gene list')
  const nGenes = genes.length
  const notes: string[] = [...(parts[0].meta.notes ?? [])]

  // ---- one set of levels across every part --------------------------------
  // The writer records the whole object's cluster order; using it keeps a
  // cell type the colour it had before the object was ever split.
  //
  // Group order is recorded the same way and matters for a different reason.
  // Reconstructed order falls back to numeric collation for the pairs no part
  // orders, and that compares the digit run after the dot as a number: the
  // developing-mouse timepoints come out e16.0, e16.5, e16.25, e17.0, so the
  // Groups menu, both contrast pickers and every per-group axis offer a
  // sequence the experiment never had. No number moves — the maps are keyed by
  // name — but the reading of every one of them does.
  //
  // Optional, like clusterOrder: a collection written before the lab recorded
  // it still opens, and still gets the reconstruction in levels.ts.
  const cl = unionLevels(clusterLevels, cmeta.clusterOrder)
  const sm = unionLevels(sampleLevels)
  const cd = unionLevels(condLevels, condOrder)

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

  // The extra columns, through the same union and against the same hazard: a
  // part is written with the levels it uses, so part A's dissection 0 is
  // usually not part B's. Their order is recorded by the lab for the reason
  // condition order is — a dissection list in collation order is only ugly, but
  // the machinery is one machinery and it may be an age next time.
  const columns: ExtraColumn[] = []
  colKeys.forEach((key, k) => {
    if (droppedCol.has(key)) return
    const u = unionLevels(colLevels.map(l => l[k]), extraOrder?.[key])
    if (u.levels.length > 65535) { droppedCol.add(key); return }
    const codes = new Uint16Array(nCells)
    parts.forEach((p, pi) => {
      const map = u.maps[pi]
      const src = colCodes[pi][k]
      for (let j = 0; j < p.nCells; j++) codes[p.offset + j] = map[src[j]]
    })
    columns.push({ key, levels: u.levels, codes })
  })
  if (droppedCol.size) {
    notes.push(`${[...droppedCol].join(', ')} could not be assembled across every part of `
      + 'this object, so it is not offered as something to break a figure down by')
  }

  // Concatenated in part order, exactly as embed.f32 is, so cell i means the
  // same cell in every embedding.
  const embeddings: Embedding[] = [{ key: parts[0].meta.embedding, xy: embed }]
  extraKeys.forEach((key, k) => {
    if (droppedEmb.has(key)) return
    const xy = new Float32Array(nCells * 2)
    parts.forEach((p, pi) => xy.set(extras[pi][k], p.offset * 2))
    embeddings.push({ key, xy })
  })
  if (droppedEmb.size) {
    notes.push(`${[...droppedEmb].join(', ')} could not be assembled across every part, `
      + 'so only the embeddings every part carries are offered')
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
    cluster, sample, embed, qc, pseudobulk, extras: columns,
  } as Bundle)

  const types: CellType[] = merged.clusters.map(name => ({
    name, key: name, cx: 0, cy: 0, sd: 0, base: 0, resp: 0, mk: [],
  }))

  // ---- gene values, read from the file on demand --------------------------
  // Named exactly as a one-part bundle is: the display name is the only name
  // anything above this file uses, and the accession stays reachable through
  // `names` for searching and for showing beside the symbol.
  const meta1 = parts[0].meta
  const names = makeGeneNames(genes!, alias, {
    idKind: meta1.geneIdKind,
    aliasKind: meta1.geneAlias?.kind,
    aliasColumn: meta1.geneAlias?.column,
    missing: meta1.geneAlias?.missing,
  })
  const display = names.display
  const geneIndex = new Map(display.map((g, i) => [g.toUpperCase(), i]))
  const loaded = new Map<string, Sparse>()
  let loadedBytes = 0
  // Genes somebody is being shown right now, which eviction may not take: the
  // whole of the newest ensure(), plus whatever a call currently in flight is
  // in the middle of reading. Without this a request evicts inside its own call
  // and hands back genes that read as all-zero — and an evicted gene and a gene
  // nobody expresses are then the same picture.
  const promised = new Set<string>()
  const holds = new Map<string, number>()
  const held = (gene: string) => promised.has(gene) || holds.has(gene)
  const hold = (gs: readonly string[]) => {
    for (const g of gs) holds.set(g, (holds.get(g) ?? 0) + 1)
  }
  const release = (gs: readonly string[]) => {
    for (const g of gs) {
      const n = (holds.get(g) ?? 0) - 1
      if (n > 0) holds.set(g, n)
      else holds.delete(g)
    }
  }

  const indexOf = (gene: string): number => geneIndex.get(gene.toUpperCase()) ?? -1

  /** What one gene costs assembled, from the offsets alone — nothing is read. */
  const costOf = (gi: number): number => {
    let nnz = 0
    for (const p of parts) nnz += p.indptr[gi + 1] - p.indptr[gi]
    return nnz * 8
  }

  const forget = (gene: string) => {
    const s = loaded.get(gene)
    if (!s) return
    loaded.delete(gene)
    loadedBytes -= s.cells.length * 8
  }

  const remember = (gene: string, s: Sparse) => {
    loaded.set(gene, s)
    loadedBytes += s.cells.length * 8
    for (const [k, v] of loaded) {
      if (loadedBytes <= GENE_BUDGET) break
      if (held(k)) continue
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

  /** The distinct genes of `want` this object has, and where they were asked. */
  const resolve = (want: readonly string[]) => {
    const names: string[] = []
    const idxs: number[] = []
    const at: number[] = []
    const seen = new Set<string>()
    want.forEach((g, i) => {
      const gi = indexOf(g)
      if (gi < 0 || seen.has(display[gi])) return
      seen.add(display[gi])
      names.push(display[gi])
      idxs.push(gi)
      at.push(i)
    })
    return { names, idxs, at }
  }

  /**
   * Read genes into memory, in batches and a few parts at a time.
   *
   * One readGenes call holds every chunk its genes touch, so asking for the
   * marker panel's 300 genes across 43 parts in one go would inflate most of
   * the matrix at once — which is exactly what this file exists to avoid.
   * Sorted first, so a batch stays within a few neighbouring chunks. The caller
   * must be holding `names`, or a later batch can evict an earlier one.
   */
  const fetch = async (names: string[], idxs: number[]) => {
    const order = names.map((_n, i) => i)
      .filter(i => !loaded.has(names[i]))
      .sort((a, b) => idxs[a] - idxs[b])
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

  const ensure = async (want: readonly string[]) => {
    const { names, idxs } = resolve(want)
    if (!names.length) return
    // What the request costs is in the offsets, so one that cannot be held is
    // refused before a byte is read. The alternative is what this used to do:
    // evict inside its own call and return genes that read as all-zero, which
    // no caller can tell from a gene nobody expresses — 49 % of the marker dot
    // plot was that, and the Gene tab went grey behind it.
    let cost = 0
    for (const gi of idxs) cost += costOf(gi)
    if (cost > GENE_BUDGET) {
      fail(`${names.length} genes come to ${(cost / (1 << 20)).toFixed(0)} MB of values, past `
        + `the ${GENE_BUDGET >> 20} MB this object holds at once — a set this large has to be `
        + 'read with withGenes, which streams it a window at a time')
    }
    hold(names)
    try {
      await fetch(names, idxs)
      promised.clear()
      for (const n of names) promised.add(n)
    } finally {
      release(names)
    }
  }

  const withGenes: Source['withGenes'] = async (want, visit) => {
    const { names, idxs, at } = resolve(want)
    // Planned over the file's own order, so the pass walks the matrix forwards
    // instead of coming back for a chunk it has already inflated; `at` carries
    // where each gene was asked for, so the caller still gets its own order.
    const order = names.map((_n, i) => i).sort((a, b) => idxs[a] - idxs[b])
    // Whatever the panel was promised is not room this pass may spend.
    let kept = 0
    for (const g of promised) kept += (loaded.get(g)?.cells.length ?? 0) * 8
    const budget = Math.max(1, GENE_BUDGET - kept)

    for (let from = 0; from < order.length;) {
      let to = from
      for (let cost = 0; to < order.length; to++) {
        const c = costOf(idxs[order[to]])
        if (to > from && cost + c > budget) break
        cost += c
      }
      const win = order.slice(from, to)
      const gs = win.map(i => names[i])
      hold(gs)
      try {
        await fetch(gs, win.map(i => idxs[i]))
        visit(gs, Int32Array.from(win, i => at[i]))
      } finally {
        release(gs)
      }
      // Dropped here rather than left for the next window to evict by size.
      // Eviction takes the oldest gene in the object, which is whichever one
      // the Gene tab is drawing — so a marker plot that let it run would empty
      // the panel behind it, and nothing re-reads that panel.
      for (const g of gs) if (!held(g)) forget(g)
      from = to
    }
  }

  const resident = (gene: string): boolean => {
    const gi = indexOf(gene)
    // A gene this object does not carry needs nothing read: zero is its whole
    // answer. It is the genes it does carry and has not read that the
    // synchronous accessors below cannot speak for.
    return gi < 0 || loaded.has(display[gi])
  }

  const nonZero = (gene: string, cb: (cell: number, value: number) => void) => {
    const s = loaded.get(display[indexOf(gene)] ?? '')
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

  const src = baseSource(d, types, names, {
    label: merged.label,
    source: merged.source,
    expression: merged.expression,
    hasRawCounts: merged.hasRawCounts,
    embedding: merged.embedding,
    provenance: merged.provenance,
    notes,
    isDemo: false,
    // The summed counts are indexed by row, so they carry the display name too —
    // an exported pseudobulk matrix must not be the one table in a different
    // vocabulary from every figure beside it.
  }, vector, nonZero, pseudobulk && { ...pseudobulk, genes: display }, embeddings, resident)

  return Object.assign(src, {
    lazy: true,
    nParts: parts.length,
    remote: { file, plan },
    ensure,
    withGenes,
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
    if (!text) return null
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    if (lines.length < 2) return null
    const cols = lines[0].split('\t').slice(1).map(h => {
      const [s, c, n] = h.split('||')
      return { sample: s, cluster: c ?? '', nCells: Number(n) || 0 }
    })
    return { lines, cols }
  })
  // Narrowed once, rather than asserted at each of the four uses below. The
  // guard was already here; what was missing was telling the type system, so
  // every later `p!` was a promise the compiler could not check and a reader
  // had to take on trust.
  const ok = parsed.filter((x): x is NonNullable<typeof x> => x !== null)
  if (ok.length !== parsed.length) return null

  for (const p of ok) {
    for (const c of p.cols) {
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
  for (const p of ok) {
    // Every column was inserted into `at` in the loop above, so this lookup
    // cannot miss — but a -1 would silently accumulate into the wrong gene's
    // row, so it is checked rather than asserted.
    const map = p.cols.map(c => at.get(key(c)) ?? -1)
    if (map.some(m => m < 0)) return null
    for (let r = 1; r < p.lines.length; r++) {
      const cells = p.lines[r].split('\t')
      const gi = r - 1
      if (cells[0] !== genes[gi]) return null
      for (let c = 0; c < map.length; c++) {
        counts[gi * columns.length + map[c]] += +cells[c + 1] || 0
      }
    }
  }
  return { genes, columns, counts }
}
