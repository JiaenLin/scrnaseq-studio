// Answers already computed, and what it costs to keep them.
//
// A whole-transcriptome pass over the atlas is four minutes of CPU. An answer
// already in hand is therefore the most valuable thing this app holds — more
// valuable than the memory it occupies, up to a point, and this file is where
// that point is written down.
//
// It is deliberately its own module, with no idea what a Source or a DE row is,
// because the only interesting thing here is arithmetic: what an answer costs,
// and which one goes when the total is too high. Arithmetic that decides whether
// four minutes of work survives is arithmetic that should be tested directly,
// which is what scripts/test-cache.mjs does.

/**
 * What a cached answer costs, in bytes.
 *
 * Typed arrays know their own size. A DE table is counted in rows: six doubles
 * plus a reference to a gene name shared with the Source, which V8 lays out in
 * roughly 80 bytes. ROW_BYTES rounds up, because the one direction this estimate
 * must not err in is optimism — undercounting is how a bound stops bounding.
 */
export const ROW_BYTES = 96

/**
 * How much of one object's answers to keep, in bytes.
 *
 * The largest single answer the studio can produce is FindAllMarkers on the
 * 292 495-cell atlas: 400 324 rows across 133 clusters, 36.7 MB by the count
 * above. 256 MB therefore holds that pass and some fifty contrasts beside it
 * before anything is dropped — which in practice means that for one open object
 * nothing is ever recomputed, and the bound exists for the session that goes
 * looking through a hundred of them.
 */
export const BUDGET = 256 * 1024 * 1024

export function sizeOf(v: unknown): number {
  if (ArrayBuffer.isView(v)) return v.byteLength
  if (Array.isArray(v)) {
    let n = 0
    for (const x of v) n += sizeOf(x)
    return n
  }
  if (v && typeof v === 'object' && Array.isArray((v as { rows?: unknown }).rows))
    return (v as { rows: unknown[] }).rows.length * ROW_BYTES
  return 0
}

interface Held { value: unknown; bytes: number }

export interface ResultCache {
  /** The answer stored under this key, or null. Never a different key's answer. */
  get: (key: string) => { value: unknown } | null
  /**
   * The same answer, without recording that it was wanted.
   *
   * A pure read, so a view may call it while rendering — which is the whole
   * point: an answer already computed has to be on screen in the FIRST frame
   * after a tab switch. Reading it in an effect instead means one frame where
   * the view has nothing, and a view with nothing says so out loud ("no markers
   * to show"). Flashing that at someone who just waited four minutes for the
   * markers is its own kind of lie.
   */
  peek: (key: string) => { value: unknown } | null
  put: (key: string, value: unknown) => void
  /** For the test, and for anyone measuring what an object is costing. */
  bytes: () => number
  keys: () => string[]
}

/**
 * A bounded store of answers, least-recently-used first out.
 *
 * Re-inserting on read is what makes a plain Map an LRU: a Map iterates in
 * insertion order, so the entry the user keeps coming back to walks to the end,
 * and the one nobody has asked for since is the first thing eviction reaches.
 */
export function makeCache(budget = BUDGET): ResultCache {
  const m = new Map<string, Held>()
  let total = 0
  return {
    get(key) {
      const hit = m.get(key)
      if (!hit) return null
      m.delete(key)
      m.set(key, hit)
      return hit
    },
    peek: (key) => m.get(key) ?? null,
    put(key, value) {
      const had = m.get(key)
      if (had) { total -= had.bytes; m.delete(key) }
      const bytes = sizeOf(value)
      m.set(key, { value, bytes })
      total += bytes
      // The entry just stored is never the one evicted, however big it is: a
      // view is about to render it, and dropping it here would mean computing it
      // again immediately. So a single answer larger than the whole budget is
      // kept — being over the bound by one answer is better than a cache that
      // guarantees a four-minute recomputation.
      for (const k of m.keys()) {
        if (total <= budget || k === key) break
        total -= m.get(k)!.bytes
        m.delete(k)
      }
    },
    bytes: () => total,
    keys: () => [...m.keys()],
  }
}
