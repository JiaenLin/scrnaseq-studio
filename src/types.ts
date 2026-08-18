/** One Leiden cluster, with the geometry the demo generator needs to place it. */
export interface CellType {
  /** Display name — editable by the user. */
  name: string
  /** Stable identity the data is stored under; renaming `name` never changes this. */
  key: string
  cx: number
  cy: number
  sd: number
  /** Baseline cell count before any activation response. */
  base: number
  /** How strongly abundance tracks activation, in log2 units. */
  resp: number
  /** Canonical markers, most specific first. */
  mk: string[]
}

export interface SampleRow {
  id: string
  cond: string
}

export interface Cell {
  /** Index into the cell-type list. */
  t: number
  /** Sample id. */
  s: string
  cond: string
  /** Activation level of this cell's group, 0–1. */
  a: number
  x: number
  y: number
  counts: number
  genes: number
  mito: number
}

export interface DatasetSpec {
  label: string
  file: string
  /** Group names, in the object's own categorical order — never sorted. */
  conds: string[]
  act: Record<string, number>
  samples: SampleRow[]
}

export interface Dataset extends DatasetSpec {
  key: string
  cells: Cell[]
  /** grid[typeIndex][sampleIndex] = number of cells. */
  grid: number[][]
  /** prop[sampleIndex][typeIndex] = fraction of that sample's cells. */
  prop: number[][]
  nPerCond: Record<string, number>
  nCells: number
  multi: boolean
}

export interface DERow {
  gene: string
  lfc: number
  p: number
  padj: number
  /**
   * −log10 of the adjusted p, computed in log space.
   *
   * Not a convenience: on an object of this size the adjusted p underflows the
   * double and every strongly significant row reports the same 3.07e-319. This
   * is the number that still separates them, and it is what the ranking, the
   * volcano axis and the combined score read. `p` and `padj` keep their present
   * meaning for display, export and the significance thresholds.
   */
  nlp: number
  /**
   * Benjamini–Hochberg, beside the Bonferroni in `padj`.
   *
   * Seurat reports both and so does this now. `padj` keeps every meaning it
   * had — the thresholds cut on it, the CSV column is still called padj — and
   * this is an extra column, because Bonferroni over thirty thousand genes is
   * severe enough that a reader wants to see what the FDR says as well.
   */
  fdr?: number
  /** Wilcoxon only — fraction detected in the comparison and control groups. */
  pct1?: number
  pct2?: number
  /** Pseudobulk only. */
  mean?: number
}

/** A row on the categorical axis: a cell type, a group, or their product. */
export interface Identity {
  label: string
  full: string
  color: string
  ti: number
  cond: string
  /** 0–1 position within the group ramp, for the product view. */
  dim?: number
}

export interface Design {
  used: (SampleRow & { n: number })[]
  kept: (SampleRow & { n: number })[]
  n0: number
  n1: number
  /** Whether pseudobulk is defensible for this cell type and pair. */
  pbOK: boolean
}

export type PlotKind = 'violin' | 'dot' | 'feature'
export type GroupBy = 'type' | 'cond' | 'both'
export type Method = 'wilcox' | 'pseudobulk'
// No 'gene'. Colouring the embedding by one gene lives on the Gene expression
// tab, where the gene is named on the figure and the scale is stated. Leaving
// the variant here would let a future caller reintroduce the unnamed version.
export type ColorBy = 'type' | 'cond' | 'sample' | 'mito'

export type TabId =
  | 'overview' | 'cells' | 'composition'
  | 'markers' | 'de' | 'expr' | 'sets' | 'coexpr'
  | 'methods'

/**
 * The three renderings of one differential-expression pass.
 *
 * Not tabs. They were, and it made them look like three questions: the table,
 * the volcano and the enrichment all read the rows of the same `useDE` call, so
 * a reader who changed the test on one found it changed on the other two and
 * could not tell whether that was the interface or the statistics.
 */
export type DEView = 'table' | 'volcano' | 'enrich'
