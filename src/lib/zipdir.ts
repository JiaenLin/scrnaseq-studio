// Reading named entries out of a zip that lives inside another file.
//
// A collection is a zip of bundles, and a bundle is itself a zip. Opening one
// part the obvious way — slice the part out, hand it to unzipSync — inflates
// every entry, including the 65 MB of expr.indices/expr.data the studio is
// specifically trying not to hold. With 43 parts that is the whole atlas in
// memory, which is the thing the split was supposed to avoid.
//
// So read the part's own central directory instead and pull only the entries
// that are actually wanted. Everything here works in byte offsets relative to
// the outer file, so a nested zip needs no copying: the part's directory is at
// `partStart + itsOwnOffset`, and so is every payload inside it.
//
// collection.ts does the same trick one level up; it stays as it is because the
// lab writes with it and the two copies must remain identical.

import { inflateSync } from 'fflate'

export interface ZipEntry {
  name: string
  /** 0 = stored, 8 = deflated. Nothing else is written by fflate or by us. */
  method: number
  /** Byte offset of the LOCAL header, relative to the start of the outer file. */
  headerAt: number
  /** Bytes on disk. */
  compressedSize: number
  size: number
}

export class ZipError extends Error {}
/**
 * The annotation is on the VARIABLE, not just the return type.
 *
 * TypeScript narrows control flow past a never-returning call only when the
 * thing being called is declared with an explicit type — with the `: never`
 * on the arrow alone, `if (!x) fail(...)` does not narrow `x` afterwards, and
 * every caller was reaching for a `!` to get past it. That is how a parser
 * that already checks its input ended up full of assertions.
 */
const fail: (msg: string) => never = (msg) => { throw new ZipError(msg) }

const dv = (b: ArrayBuffer) => new DataView(b)

/**
 * Read the directory of a zip occupying `[start, start+size)` of `file`.
 *
 * Only the tail is fetched, so this costs one small range read whatever the
 * part weighs.
 */
export async function readZipDir(
  file: Blob, start: number, size: number,
): Promise<Map<string, ZipEntry>> {
  const tailLen = Math.min(size, 65_536 + 22)
  const tail = await file.slice(start + size - tailLen, start + size).arrayBuffer()
  const t = dv(tail)

  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (t.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) fail('this part is not a zip — the collection is damaged')

  const count = t.getUint16(eocd + 10, true)
  const dirSize = t.getUint32(eocd + 12, true)
  const dirOffset = t.getUint32(eocd + 16, true)
  if (dirOffset + dirSize > size) fail('this part\'s index points outside the part')

  const dirBuf = await file.slice(start + dirOffset, start + dirOffset + dirSize).arrayBuffer()
  const d = dv(dirBuf)
  const out = new Map<string, ZipEntry>()
  let p = 0
  for (let i = 0; i < count && p + 46 <= dirBuf.byteLength; i++) {
    if (d.getUint32(p, true) !== 0x02014b50) break
    const method = d.getUint16(p + 10, true)
    const compressedSize = d.getUint32(p + 20, true)
    const entrySize = d.getUint32(p + 24, true)
    const nameLen = d.getUint16(p + 28, true)
    const extraLen = d.getUint16(p + 30, true)
    const commentLen = d.getUint16(p + 32, true)
    const localAt = d.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(dirBuf, p + 46, nameLen))
    out.set(name, {
      name, method, compressedSize, size: entrySize, headerAt: start + localAt,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (!out.size) fail('this part has no entries')
  return out
}

/**
 * Where an entry's bytes begin, relative to the outer file.
 *
 * The local header repeats the name and may carry a different extra field from
 * the directory's, so the offset has to be read from the header itself.
 */
export async function payloadStart(file: Blob, e: ZipEntry): Promise<number> {
  const head = await file.slice(e.headerAt, e.headerAt + 30).arrayBuffer()
  const h = dv(head)
  if (h.getUint32(0, true) !== 0x04034b50) {
    fail(`${e.name} is not where the index says — this file is damaged`)
  }
  return e.headerAt + 30 + h.getUint16(26, true) + h.getUint16(28, true)
}

/** One entry's contents, reading only its own byte range. */
export async function readZipEntry(file: Blob, e: ZipEntry): Promise<Uint8Array> {
  const from = await payloadStart(file, e)
  const raw = new Uint8Array(await file.slice(from, from + e.compressedSize).arrayBuffer())
  if (raw.length !== e.compressedSize) {
    fail(`${e.name} is ${raw.length} bytes but the index says ${e.compressedSize} — this file is truncated`)
  }
  if (e.method === 0) return raw
  if (e.method !== 8) fail(`${e.name} uses compression method ${e.method}, which this reader does not know`)
  let out: Uint8Array
  try {
    out = inflateSync(raw)
  } catch (err) {
    fail(`${e.name} is corrupt (${(err as Error).message})`)
  }
  if (out!.length !== e.size) {
    fail(`${e.name} inflated to ${out!.length} bytes, not the ${e.size} its index promises`)
  }
  return out!
}
