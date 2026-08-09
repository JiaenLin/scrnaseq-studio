// One file in, one file out.
//
// A large object cannot be one bundle — the studio holds the matrix in memory —
// so the lab splits it. But splitting should not become the user's problem:
// they get a single `.zip` back, and the studio opens it.
//
// The container is a plain zip whose entries are STORED, never deflated. That
// is deliberate twice over. The parts inside are already compressed bundles, so
// deflating them again buys nothing and costs minutes. And because they are
// stored verbatim, every part is one contiguous byte range — so the studio can
// read the index from the tail of the file and then pull out exactly the part
// it needs, without ever holding the whole collection in memory. A 3 GB
// collection opens as cheaply as a 30 MB one.
//
// Written by the lab, read by the studio. Both copies of this file must agree.

export const COLLECTION_SCHEMA = 'scrnaseq-studio/collection@1'
export const INDEX_NAME = 'collection.json'

export interface PartInfo {
  /** The split level this part holds, e.g. a donor id. */
  key: string
  /** Entry name inside the container. */
  file: string
  nCells: number
  nnz: number
  bytes: number
}

export interface CollectionMeta {
  schema: string
  label: string
  source: string
  /** The column the object was split along, or null when it was not split. */
  splitBy: string | null
  /** Why it was split, in words, for the studio to show. */
  reason: string | null
  nCells: number
  nGenes: number
  /**
   * The cluster names in the order the whole object had them.
   *
   * Parts drop levels they have no cells for, so a part's own list is neither
   * complete nor in the parent's order — and cluster order decides colour.
   * Without this the studio has to guess, and the same cell type comes out red
   * unsplit and cyan split, which is the most visible way to break "the user
   * should feel no difference".
   */
  clusterOrder?: string[]
  parts: PartInfo[]
  notes: string[]
}

// ---------------------------------------------------------------------------
// CRC-32. Required in both zip headers; there is no "skip it" option that other
// unzip tools will accept, and a collection should open in any of them.

let TABLE: Uint32Array | null = null
function crcTable(): Uint32Array {
  if (TABLE) return TABLE
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  TABLE = t
  return t
}

export function crc32(data: Uint8Array): number {
  const t = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// Writing.

const enc = (s: string) => new TextEncoder().encode(s)

const u32 = (v: number) =>
  new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255])
const u16 = (v: number) => new Uint8Array([v & 255, (v >>> 8) & 255])

/**
 * 64-bit little-endian, for the offsets that no longer fit in 32.
 *
 * A real atlas does not fit in 4 GB. The developing-mouse object measures
 * 5.84 GB once every part carries both copies of its matrix — the flat entries
 * and the chunked ones — so the plain zip offsets wrap and the container reads
 * back as "not a collection". That is the whole reason ZIP64 exists.
 */
const u64 = (v: number) => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(v), true)
  return out
}

/** Above this an offset needs ZIP64; the field holds 0xffffffff as a flag. */
const U32_MAX = 0xffffffff

const join = (...parts: Uint8Array[]): Uint8Array => {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

interface Pending { name: Uint8Array; crc: number; size: number; offset: number }

/**
 * The container, in order, as the pieces it is made of.
 *
 * A generator rather than one buffer, and the only description of the format
 * there is — `writeCollection` below is this plus a Blob. It exists in this
 * shape because a real atlas cannot become a Blob at all: a collection of the
 * developing-mouse object is 5.8 GB, and a Chromium Blob past a few hundred
 * megabytes spills to disk and then fails every read with NotReadableError.
 * Measured, not assumed — building a 1 GB Blob out of typed arrays succeeds and
 * reading any slice of it back throws, headless or headed, temp profile or
 * persistent. So the lab writes these pieces straight to the file the user
 * picked and never holds the container at all.
 *
 * `zip64Above` exists only so the tests can walk the 4 GB path without building
 * 4 GB. Leave it alone in real code: the branch it selects is the one that
 * silently produced an unreadable file the first time a real atlas was
 * converted, so it is worth being able to exercise cheaply.
 */
export function* collectionPieces(
  meta: CollectionMeta, parts: { file: string; bytes: Uint8Array }[],
  zip64Above: number = U32_MAX,
): Generator<Uint8Array> {
  const central: Pending[] = []
  let offset = 0

  const index = enc(JSON.stringify(meta, null, 1))
  const all = [{ file: INDEX_NAME, bytes: index }, ...parts]

  for (const p of all) {
    const name = enc(p.file)
    const crc = crc32(p.bytes)
    const header = join(
      u32(0x04034b50),          // local file header
      u16(20), u16(0), u16(0),  // version, flags, method 0 = stored
      u16(0), u16(0),           // mod time, mod date
      u32(crc), u32(p.bytes.length), u32(p.bytes.length),
      u16(name.length), u16(0),
      name,
    )
    yield header
    yield p.bytes
    central.push({ name, crc, size: p.bytes.length, offset })
    offset += header.length + p.bytes.length
  }

  const dirStart = offset
  const dir: Uint8Array[] = []
  for (const e of central) {
    // Entries themselves are always under 4 GB — a part the studio can open is
    // far smaller than that — so only the offset can overflow. When it does,
    // the 32-bit field carries the escape value and the real number goes into a
    // ZIP64 extra field, which is what every unzip tool looks for.
    const big = e.offset > zip64Above
    const extra = big ? join(u16(0x0001), u16(8), u64(e.offset)) : new Uint8Array(0)
    // 45 is "needs ZIP64" — set on the entries that use it and on nothing else,
    // so a container under 4 GB is byte-for-byte the file this format has
    // always written and every collection made before today still opens.
    const v = big ? 45 : 20
    dir.push(join(
      u32(0x02014b50),                    // central directory header
      u16(v), u16(v), u16(0), u16(0),     // made by, needed, flags, method
      u16(0), u16(0),
      u32(e.crc), u32(e.size), u32(e.size),
      u16(e.name.length), u16(extra.length), u16(0), u16(0), u16(0),
      u32(0), u32(big ? U32_MAX : e.offset),
      e.name, extra,
    ))
  }
  const dirBytes = join(...dir)

  // The end record is 32-bit too. Past 4 GB it gets a ZIP64 record in front of
  // it holding the real numbers, and a locator saying where that record is; the
  // old record stays behind with escape values so a 32-bit reader still finds
  // something well-formed rather than a truncated file.
  const tail: Uint8Array[] = []
  const bigDir = dirStart > zip64Above || dirBytes.length > U32_MAX || central.length > 0xffff
  if (bigDir) {
    tail.push(join(
      u32(0x06064b50), u64(44),          // ZIP64 end record, size of what follows
      u16(45), u16(45), u32(0), u32(0),
      u64(central.length), u64(central.length),
      u64(dirBytes.length), u64(dirStart),
    ))
    tail.push(join(
      u32(0x07064b50), u32(0),           // ZIP64 locator
      u64(dirStart + dirBytes.length),
      u32(1),
    ))
  }
  tail.push(join(
    u32(0x06054b50),
    u16(0), u16(0),
    u16(bigDir ? 0xffff : central.length), u16(bigDir ? 0xffff : central.length),
    u32(bigDir ? U32_MAX : dirBytes.length), u32(bigDir ? U32_MAX : dirStart),
    u16(0),
  ))
  yield dirBytes
  for (const t of tail) yield t
}

/**
 * The same container as one Blob.
 *
 * Only safe below the few hundred megabytes at which Chromium starts paging a
 * Blob to disk and losing it — which is every object that did not need
 * splitting. Anything larger must go through `collectionPieces` straight to a
 * file. See the note above.
 */
export function writeCollection(
  meta: CollectionMeta, parts: { file: string; bytes: Uint8Array }[],
  zip64Above: number = U32_MAX,
): Blob {
  return new Blob([...collectionPieces(meta, parts, zip64Above)] as BlobPart[],
    { type: 'application/zip' })
}

// ---------------------------------------------------------------------------
// Reading, without loading the file.

export interface PartEntry { name: string; start: number; size: number }
export interface CollectionIndex { meta: CollectionMeta; entries: Map<string, PartEntry> }

const dv = (b: ArrayBuffer) => new DataView(b)

/**
 * Read the zip index from the end of the file.
 *
 * A zip is designed to be read backwards: the directory lives at the tail, so a
 * 64 KB slice is enough to locate every entry in a file of any size. Nothing
 * before that slice is touched until a part is actually opened.
 */
export async function readCollectionIndex(file: Blob): Promise<CollectionIndex | null> {
  const tailLen = Math.min(file.size, 65_536 + 22)
  const tail = await file.slice(file.size - tailLen).arrayBuffer()
  const t = dv(tail)

  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (t.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null

  let count = t.getUint16(eocd + 10, true)
  let dirSize = t.getUint32(eocd + 12, true)
  let dirOffset = t.getUint32(eocd + 16, true)

  // Past 4 GB the three numbers above are escape values and the real ones live
  // in a ZIP64 end record, found through the locator that sits just before the
  // ordinary one. Reading the escape values as if they were real is how a
  // large collection turns into "this is not a collection".
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    const loc = eocd - 20
    if (loc < 0 || t.getUint32(loc, true) !== 0x07064b50) return null
    const at = Number(t.getBigUint64(loc + 8, true))
    if (at < 0 || at + 56 > file.size) return null
    const z = dv(await file.slice(at, at + 56).arrayBuffer())
    if (z.getUint32(0, true) !== 0x06064b50) return null
    count = Number(z.getBigUint64(32, true))
    dirSize = Number(z.getBigUint64(40, true))
    dirOffset = Number(z.getBigUint64(48, true))
  }
  if (dirOffset + dirSize > file.size) return null

  const dirBuf = await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer()
  const d = dv(dirBuf)
  const entries = new Map<string, PartEntry>()
  let p = 0
  for (let i = 0; i < count && p + 46 <= dirBuf.byteLength; i++) {
    if (d.getUint32(p, true) !== 0x02014b50) break
    const method = d.getUint16(p + 10, true)
    const size = d.getUint32(p + 20, true)
    const nameLen = d.getUint16(p + 28, true)
    const extraLen = d.getUint16(p + 30, true)
    const commentLen = d.getUint16(p + 32, true)
    let localAt = d.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(dirBuf, p + 46, nameLen))
    if (localAt === 0xffffffff) {
      // The real offset is in the ZIP64 extra field, which holds only the
      // fields that were escaped, in a fixed order: uncompressed size,
      // compressed size, then the offset. This writer escapes nothing but the
      // offset, so it is first — but count the ones in front of it anyway,
      // because a container written by any other tool is still a collection.
      const before = (d.getUint32(p + 24, true) === 0xffffffff ? 8 : 0)
        + (d.getUint32(p + 20, true) === 0xffffffff ? 8 : 0)
      localAt = -1
      let x = p + 46 + nameLen
      const end = x + extraLen
      while (x + 4 <= end) {
        const id = d.getUint16(x, true)
        const len = d.getUint16(x + 2, true)
        if (id === 0x0001 && len >= before + 8) {
          localAt = Number(d.getBigUint64(x + 4 + before, true))
          break
        }
        x += 4 + len
      }
      if (localAt < 0) return null
    }
    // Only stored entries can be sliced out directly. A deflated container is
    // still a valid zip, just not one this reader can open lazily.
    if (method === 0) entries.set(name, { name, start: localAt, size })
    p += 46 + nameLen + extraLen + commentLen
  }

  const idx = entries.get(INDEX_NAME)
  if (!idx) return null
  const raw = await readEntry(file, idx)
  let meta: CollectionMeta
  try {
    meta = JSON.parse(new TextDecoder().decode(raw)) as CollectionMeta
  } catch {
    return null
  }
  if (meta.schema !== COLLECTION_SCHEMA) return null
  return { meta, entries }
}

/** Pull one entry's bytes, reading only its own range. */
export async function readEntry(file: Blob, e: PartEntry): Promise<Uint8Array> {
  // The local header repeats the name and may carry a different extra field, so
  // the payload offset has to come from the header itself, not the directory.
  const head = await file.slice(e.start, e.start + 30).arrayBuffer()
  const h = dv(head)
  if (h.getUint32(0, true) !== 0x04034b50) {
    throw new Error('this collection is damaged — a part is not where its index says')
  }
  const nameLen = h.getUint16(26, true)
  const extraLen = h.getUint16(28, true)
  const from = e.start + 30 + nameLen + extraLen
  return new Uint8Array(await file.slice(from, from + e.size).arrayBuffer())
}
