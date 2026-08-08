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

const join = (...parts: Uint8Array[]): Uint8Array => {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

interface Pending { name: Uint8Array; crc: number; size: number; offset: number }

/**
 * Assemble the container as a Blob.
 *
 * The part payloads are handed to `Blob` rather than copied into one big array.
 * That matters: 43 parts of an atlas come to a few gigabytes, which the browser
 * keeps backed by disk as long as nobody asks for it as one ArrayBuffer. Build
 * it by concatenation instead and the tab dies.
 */
export function writeCollection(
  meta: CollectionMeta, parts: { file: string; bytes: Uint8Array }[],
): Blob {
  const pieces: BlobPart[] = []
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
    pieces.push(header as unknown as BlobPart, p.bytes as unknown as BlobPart)
    central.push({ name, crc, size: p.bytes.length, offset })
    offset += header.length + p.bytes.length
  }

  const dirStart = offset
  const dir: Uint8Array[] = []
  for (const e of central) {
    dir.push(join(
      u32(0x02014b50),                    // central directory header
      u16(20), u16(20), u16(0), u16(0),   // made by, needed, flags, method
      u16(0), u16(0),
      u32(e.crc), u32(e.size), u32(e.size),
      u16(e.name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(e.offset),
      e.name,
    ))
  }
  const dirBytes = join(...dir)
  const eocd = join(
    u32(0x06054b50),
    u16(0), u16(0),
    u16(central.length), u16(central.length),
    u32(dirBytes.length), u32(dirStart),
    u16(0),
  )
  pieces.push(dirBytes as unknown as BlobPart, eocd as unknown as BlobPart)
  return new Blob(pieces, { type: 'application/zip' })
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

  const count = t.getUint16(eocd + 10, true)
  const dirSize = t.getUint32(eocd + 12, true)
  const dirOffset = t.getUint32(eocd + 16, true)
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
    const localAt = d.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(dirBuf, p + 46, nameLen))
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
