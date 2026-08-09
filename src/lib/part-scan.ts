// One forward pass over a collection's matrix, described by numbers alone.
//
// `openCollection` builds a Source full of closures, and a closure cannot cross
// to a worker. Everything a reader actually needs to walk the matrix, though, is
// numeric: where each part's chunk entry starts in the container, its gene
// offsets, its chunk offsets, and where its cells sit in the global numbering.
// That is a MatrixPlan, it structured-clones, and it is the whole of what the
// compute worker is handed.
//
// The walk itself lives here so there is one of it. collection-source.ts's
// `scan` calls this, and so does the worker; if the chunk order or the cell
// renumbering ever changed in one and not the other, the two would disagree
// about the numbers while both looking correct.

import { readGenes, makeChunkCache } from './chunked.ts'
import type { NonZeroWalk } from './source.ts'

/** One bundle inside the container, as bytes and offsets. */
export interface PartPlan {
  /** Byte offset of expr.chunk.bin's payload within the whole container. */
  base: number
  /** Where this part's cells start in the global numbering. */
  offset: number
  indptr: Int32Array
  chunkptr: Int32Array
  chunkGenes: number
}

/** Everything needed to read any gene of a collection, and nothing else. */
export interface MatrixPlan {
  nGenes: number
  /** Genes per chunk, taken from the first part; every part agrees. */
  chunkGenes: number
  parts: PartPlan[]
}

/** Called once per gene, with the gene's index and a walk over its non-zeros. */
export type IndexVisit = (gene: number, each: NonZeroWalk) => void

/** How many chunks the plan's genes make. */
export const planChunks = (plan: MatrixPlan): number =>
  Math.ceil(plan.nGenes / plan.chunkGenes)

/**
 * Walk every gene once, chunk by chunk, holding one chunk per part.
 *
 * The order is gene order, which is also file order, so this is a forward pass
 * whatever the object weighs. Nothing is retained between chunks: the caller's
 * `visit` keeps a result row and the bytes are dropped.
 *
 * `cancelled` is consulted at the chunk boundary — the only place where nothing
 * is half-done — so abandoning a pass costs at most one chunk of work.
 */
export async function scanMatrix(
  file: Blob,
  plan: MatrixPlan,
  visit: IndexVisit,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<void> {
  const { nGenes, chunkGenes, parts } = plan
  const nChunks = planChunks(plan)
  // One chunk per part, replaced each round: a cache of 1 is what makes this a
  // pass rather than an accumulation.
  const scratch = parts.map(() => makeChunkCache(1))
  const getBytes = parts.map(p =>
    async (from: number, to: number) =>
      new Uint8Array(await file.slice(p.base + from, p.base + to).arrayBuffer()))
  const idxs: number[] = []

  for (let k = 0; k < nChunks; k++) {
    if (cancelled?.()) return
    const lo = k * chunkGenes
    const hi = Math.min(nGenes, lo + chunkGenes)
    idxs.length = 0
    for (let g = lo; g < hi; g++) idxs.push(g)

    const perPart = await Promise.all(parts.map((p, pi) =>
      readGenes(getBytes[pi], p.chunkptr, p.indptr, p.chunkGenes, idxs, scratch[pi])))

    for (let gi = 0; gi < idxs.length; gi++) {
      visit(lo + gi, cb => {
        for (let pi = 0; pi < parts.length; pi++) {
          const v = perPart[pi][gi]
          const off = parts[pi].offset
          for (let m = 0; m < v.cells.length; m++) cb(v.cells[m] + off, v.values[m])
        }
      })
    }
    onProgress?.(hi, nGenes)
  }
}
