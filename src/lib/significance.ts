// How a significance is written, everywhere one is written.
//
// The marker table, the DE table, both of their CSVs and the volcano's readout
// all report the same two numbers, so they all report them from here. A reader
// who compares the screen against the CSV must not find two different stories in
// the same column, and the CSV is the copy someone will fit something to.
//
// The problem this exists for: `padj` is a probability, and on a 292 495-cell
// object most of the interesting ones are smaller than a double can hold.
// `normalTail` is floored at Number.MIN_VALUE, so past z = 38.6 every row alike
// reports that floor and `padj = p x nTested` turns it into one shared constant
// — 3.06844e-319 for the 31 053 genes of this atlas. Bergmann glia's entire top
// twenty read it. Eleven percent of all rows and 96 % of every displayed top ten
// sit there. A column headed "adjusted p" showing twenty identical numbers,
// ordered by something the reader cannot see, is indistinguishable from a broken
// sort — which is exactly the bug that was just fixed underneath it.
//
// So: the significance shown and sorted on is `nlp`, -log10 of the adjusted p,
// which stats.ts forms in log space and which reaches 48 017 here without losing
// a digit; and `padj` is kept beside it but is never printed once it has
// underflowed. scanpy shows `scores` next to `pvals_adj` for the same reason.
// Both are kept rather than one, because `padj` is what the thresholds, the
// Methods sentence and every other tool in the field are stated in.

import { sci } from './chart.ts'

/**
 * Where a double stops carrying digits.
 *
 * The real boundary is 2**-1022 = 2.225e-308, the smallest double with a full
 * 53-bit mantissa; below it a double is subnormal, keeping its magnitude and
 * losing its precision a bit at a time — 3.06844e-319 carries about eleven of
 * them, so the six significant figures printed from it are not figures anything
 * computed.
 *
 * The constant is 1e-308 rather than that boundary because it is also the bound
 * printed, and a bound has to be TRUE of the value it stands for. Thresholding
 * at 2.225e-308 while printing `< 10^-308` would claim something false of every
 * value in between. 1e-308 is already deep inside the subnormal range, and
 * nothing here lands in the sliver above it: the floor this exists for is
 * Number.MIN_VALUE times the number of genes tested, eleven orders of magnitude
 * further down.
 */
const REPRESENTABLE = 1e-308

/**
 * A p the gene does not have: it was not tested.
 *
 * A gene the effect-size gate keeps but does not test (`carry` in lib/stats.ts)
 * has NaN for p, padj, FDR and −log₁₀ padj. That is absence, and it is written
 * as absence: an empty cell in a CSV, the em dash on screen. It was caught by the
 * saturation rule below, which was written so that a NaN counted as an
 * underflow, and every untested gene was saved as `<1e-308`: the most
 * significant genes in the file. Checked first, everywhere, for that reason.
 */
export const untested = (p: number | null | undefined): boolean =>
  p === null || p === undefined || !Number.isFinite(p)

/**
 * Has this p run out of double? A real test whose p underflowed, to 0 included.
 * A NaN is not one: `untested` above, checked before this.
 */
const saturated = (p: number) => p < REPRESENTABLE

/**
 * A p-value as it is shown on screen.
 *
 * Under the floor it is written as a bound rather than a number. `< 10^-308` is
 * true of the value and is visibly not a measurement, which is the whole point:
 * a reader must never be handed the arithmetic's floor as though it were a
 * reading.
 */
export const pTxt = (p: number): string =>
  (untested(p) ? '—' : saturated(p) ? '< 10⁻³⁰⁸' : sci(p))

/** The same rule for export — a bound, never the floor dressed as a number. */
export const pCsv = (p: number): string =>
  untested(p) ? '' : saturated(p) ? '<1e-308' : p.toExponential(4)

/**
 * The significance that still has resolution.
 *
 * Six significant figures, not a fixed number of decimals, because nlp spans
 * 1.3 to 48 017 on one object and a fixed count is either too coarse at one end
 * or a column of noise at the other. Counted over the 156 453 adjacent pairs of
 * the atlas's own marker export: one decimal leaves 3 pairs inside a displayed
 * top twenty reading the same number, and this leaves 0 — while still being
 * narrower on screen than two decimals would be.
 *
 * Six is also about as far as the number goes. `logNormalTail` is 3.6e-12
 * absolute in the log, so nlp is good to roughly 1.6e-12 absolute; six figures
 * claims 0.05 at the top of the range and 5e-6 at the cutoff, inside that
 * either way.
 */
export const nlpTxt = (nlp: number): string => (untested(nlp) ? '—' : nlp.toPrecision(6))

/** Four decimals in the CSV — already past the accuracy of `logNormalTail`. */
export const nlpCsv = (nlp: number): string => (untested(nlp) ? '' : nlp.toFixed(4))

/**
 * A significance cutoff as it is written, everywhere it is shown or saved: the
 * standard's p (docs/DESIGN.md, Words, Numbers), two significant digits, and
 * under 0.001 as 1.4e-5. 0.05, 0.32, 0.001, 5e-4.
 *
 * The slider sets 10^-v, so a moved cutoff was printed as 0.31622776601683794
 * in the head line, the chip, Methods and the saved legend. `cutOf` is applied
 * where the cutoff is set, so the number written IS the cutoff in force: a head
 * reading "FDR < 0.32" over a cut at 0.3162 would misstate which genes pass.
 */
export const cutOf = (v: number): number =>
  (Number.isFinite(v) && v > 0 ? Number(v.toPrecision(2)) : v)

export const cutTxt = (v: number): string => {
  const c = cutOf(v)
  return c < 1e-3 ? c.toExponential() : String(c)
}
