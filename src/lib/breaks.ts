// Where a colour bar puts its numbers.
//
// Its own module because it is arithmetic, not a component — and because both
// the SVG legends and the canvas ones have to choose the same breaks, or the
// same scale gets described two different ways in one figure panel.

/** Nicely spaced break values across [lo, hi], always including both ends. */
export function breaksOf(lo: number, hi: number, want = 5): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / (want - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => (hi - lo) / s <= want) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(6))
  }
  if (!out.length) return [lo, hi]
  return out
}

export const fmtBreak = (v: number): string => {
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return String(+v.toFixed(1))
  return String(+v.toFixed(2))
}

