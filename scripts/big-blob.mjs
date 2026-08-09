// A Blob over a file Node cannot make a Blob of.
//
// `fs.openAsBlob` reports the size through a 32-bit field: the 5,827,420,174-byte
// atlas comes back claiming 1,532,452,878, which is exactly size − 2³². Nothing
// then throws. `readCollectionIndex` looks for the end-of-central-directory
// record 1.5 GB into the file, does not find it, and returns null — and the
// caller reports "not recognised as a collection" about a collection the browser
// opens without complaint. It cost an afternoon once; it should not cost another.
//
// The reader only ever asks a Blob two things: how big it is, and for the bytes
// between two offsets. That is all this provides, over a plain file descriptor
// with 64-bit offsets.

import fs from 'node:fs'

/** @returns {Blob} — enough of one for `readCollectionIndex` and `scanMatrix`. */
export function fileBlob(path, fd = fs.openSync(path, 'r'), from = 0, to = null) {
  const size = to ?? fs.fstatSync(fd).size
  return {
    size: size - from,
    slice(a = 0, b = size - from) {
      const lo = from + Math.max(0, Math.min(a, size - from))
      const hi = from + Math.max(0, Math.min(b, size - from))
      return fileBlob(path, fd, lo, Math.max(lo, hi))
    },
    async arrayBuffer() {
      const n = size - from
      const buf = Buffer.allocUnsafe(n)
      let got = 0
      // One read can come back short on a large request; a short read that is
      // treated as the whole answer is a chunk of zeroes in the middle of the
      // matrix, which produces numbers rather than an error.
      while (got < n) {
        const r = fs.readSync(fd, buf, got, n - got, from + got)
        if (r <= 0) throw new Error(`short read at ${from + got} of ${path}`)
        got += r
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + n)
    },
  }
}

/** True when Node's own Blob would misreport this file's length. */
export const needsShim = (path) => fs.statSync(path).size > 0xffffffff
