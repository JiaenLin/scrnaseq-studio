// What the DE table saves and what the volcano draws, as data: one place each, so
// a check can read exactly what the file holds and which genes the figure places.
//
// A gene the effect-size gate keeps but does not test has a fold change and its
// detection rates and no p. It is in the table and in the CSV, with its p, padj,
// FDR, −log₁₀ padj and Combined absent and a column that says why; it is not on
// the volcano, whose y is a significance it does not have.

import type { DERow } from '../types.ts'
import { combinedScore, condLabel, type SigBasis } from './stats.ts'
import { nlpCsv, pCsv, untested } from './significance.ts'

/** The table's own words for such a row (DEGTable's note), written into its CSV row. */
export const UNTESTED_WHY = 'under logfc.threshold: kept, but not tested'

export const deCsvHeader = (wilcox: boolean): string[] =>
  ['gene', ...(wilcox ? ['pct.1', 'pct.2'] : ['baseMean']), 'log2FC', 'combined',
    'p', 'padj', 'fdr_BH', 'neg_log10_padj', 'direction', 'not_tested']

/** The CSV's rows, in the order given. An absent number is an empty cell, never a bound. */
export const deCsvRows = (rows: DERow[], o: { wilcox: boolean; cs: string; ctrl: string }) =>
  rows.map(r => [
    r.gene,
    ...(o.wilcox ? [r.pct1?.toFixed(4), r.pct2?.toFixed(4)] : [r.mean?.toFixed(2)]),
    r.lfc.toFixed(4),
    combinedScore(r.lfc, r.nlp)?.toFixed(3),
    pCsv(r.p),
    pCsv(r.padj),
    r.fdr === undefined ? '' : pCsv(r.fdr),
    nlpCsv(r.nlp),
    r.lfc > 0 ? `higher in ${condLabel(o.cs)}` : `higher in ${condLabel(o.ctrl)}`,
    untested(r.p) ? UNTESTED_WHY : '',
  ])

/** The genes the volcano places: the tested ones. */
export const volcanoRows = (rows: DERow[]): DERow[] => rows.filter(r => !untested(r.p) && !untested(r.nlp))

/**
 * A point's height: −log₁₀ of the correction the cutoff is read off, so the
 * dashed line at the cutoff and the larger points past it are one correction.
 * Under FDR it was the Bonferroni padj, with the line at the FDR's value: a
 * gene can pass FDR with its padj capped at 1, and no line on that axis is the
 * FDR cutoff.
 */
export const volcanoY = (r: DERow, basis: SigBasis): number =>
  basis === 'fdr'
    ? r.nlq ?? (r.fdr === undefined || untested(r.fdr) ? NaN : -Math.log10(Math.max(r.fdr, Number.MIN_VALUE)))
    : r.nlp
