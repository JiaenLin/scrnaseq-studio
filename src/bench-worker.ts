/// <reference lib="webworker" />
//
// The receiving end of shape B, for the bench only.
//
// It does no statistics; it counts what arrives. The point of shape B was never
// whether a worker can add numbers up, it is what the PAGE has to do to keep it
// fed — so what is being measured is the sending side, and this exists so that
// the sending side is measured against a real postMessage and a real transfer
// rather than against nothing.

interface Chunk { cells: Int32Array; values: Float32Array }

let values = 0
let batches = 0

self.onmessage = (e: MessageEvent<{ cmd: 'batch'; parts: Chunk[] } | { cmd: 'total' }>) => {
  if (e.data.cmd === 'total') {
    ;(self as unknown as Worker).postMessage({ values, batches })
    values = 0
    batches = 0
    return
  }
  batches++
  for (const p of e.data.parts) values += p.cells.length
}
