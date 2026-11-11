// The copy standard as data: one place for the word budgets and the retired
// terms (docs/DESIGN.md, "Words"). Read by the inventory, by the report that
// writes docs/design/COPY.md, and by scripts/test-copy.mjs, which fails
// `npm test` when a string is over its kind's budget or uses a retired term.

/** A word is a run of characters holding a letter or a digit: "×", "·" and "—" are not words. */
export const words = s => String(s).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length

/**
 * Words allowed in one string of each kind. The reason for each number is in
 * docs/DESIGN.md beside it; the number here is the one that is enforced.
 */
export const BUDGET = {
  'tab': 2,
  'button': 3,
  'segment': 3,
  'option': 3,
  'chip': 3,
  'picker': 4,
  'menu item': 4,
  'menu item note': 5,
  'menu note': 20,
  'label': 3,
  'table header': 3,
  'badge': 2,
  'title': 8,
  'placeholder': 6,
  'accessible name': 8,
  'status': 14,
  'help': 20,
  'tooltip': 16,
  'legend': 24,
  'note': 30,
  'empty state title': 12,
  'empty state': 24,
  'error': 30,
  'readout': 12,
  'figure text': 8,
  'figure legend': 45,
  'text': 40,
  'methods': 160,
}

/** The app's own words visible at rest in a 1,440 by 900 window, by kind of view. */
export const SCREEN_BUDGET = { figure: 160, table: 220, document: 520 }
export const SCREEN_KIND = {
  'Landing': 'table', 'Overview': 'table', 'Cells': 'figure', 'Composition': 'figure', 'Markers': 'figure',
  'Differential expression': 'table', 'Differential expression / Volcano': 'figure',
  'Differential expression / Enrichment': 'table', 'Gene expression / Violin panel': 'figure',
  'Gene expression / Dot plot': 'figure', 'Gene expression / Feature plot': 'figure', 'Gene sets': 'table',
  'Gene sets / Several sets': 'table', 'Co-expression': 'table', 'Methods': 'document',
}

/**
 * One term per concept. `re` finds the retired word in a string the reader
 * sees; `use` is the term that replaced it; `but` exempts the places where the
 * retired word is another thing's own name (a tool's argument, a quoted
 * method, a file's field).
 */
export const RETIRED = [
  { re: /\bdownload(s|ed|ing)?\b/i, use: 'save', why: 'one verb for a file leaving the app: the button says Save' },
  { re: /\bexport(s|ing)?\b(?! counts)/i, use: 'save', why: 'the same act as Save', but: /exported from|exporter|export_h5ad|export_seurat|was exported|bundle exported/i },
  { re: /\bconditions?\b/i, use: 'group', why: 'the experimental factor is a group everywhere a reader chooses one', but: /condition number/i },
  { re: /\banimals?\b/i, use: 'sample', why: 'a demo is mice, a cohort may be organoids or patients: the object calls it a sample' },
  { re: /\bclusters?\b(?! (rows|columns|the))/i, use: 'cell type', why: 'the annotation a view splits by is a cell type; clustering is the order of a heat map', but: /does not cluster|clustering|cluster\.u16|Cluster (rows|columns|sets|genes|cell types)|clustered|not cluster,/i },
  { re: /\bpopulations?\b/i, use: 'cell type', why: 'a second word for a cell type', but: /populations are the object|4 populations|9 populations|every population, proportion|each population against/i },
  { re: /\bsignatures?\b/i, use: 'gene set', why: 'a set of genes is a gene set whether pasted or from MSigDB' },
  { re: /\bidentit(y|ies)\b/i, use: 'cell type or group', why: "Seurat's word, not the reader's" },
  { re: /\bsentinels?\b/i, use: 'cells not called', why: 'the code word for a label that is not a cell type', but: /in sentinels|listed in sentinels/i },
  { re: /\buncalled\b/i, use: 'not called', why: 'one phrase for a cell the annotator gave no cell type' },
  { re: /\bpick(s|ed|ers?)?\b/i, use: 'choose', why: 'one verb for taking one of a list' },
  { re: /\bdatasets?\b/i, use: 'object', why: 'what is open is an object; the file it came in is a bundle' },
  { re: /\bthe studio\b/i, use: 'this app (or no subject)', why: 'the app does not name itself in its own sentences', but: /scRNA-seq Studio/ },
  { re: /\bpadj\b/, use: 'adj. p', why: "a column name from DESeq2's output, not a word; the table header says adj. p", but: /log₁₀ padj|padj_/ },
  { re: /\bcontrols on the left\b/i, use: 'on the left', why: 'the rail is where controls are; said once, shortly' },
  { re: /\bclick\b/i, use: 'select', why: 'a control is reached by keyboard too' },
  { re: /\bhover\b/i, use: 'point at', why: 'as above' },
  { re: /\bnormali[sz]ation\b|\bnormali[sz]e[sd]?\b/, use: 'one spelling: normalize', why: 'the field spells it with a z (log-normalized)', only: /normalis/ },
  { re: / — /, use: 'a colon, a comma or a full stop', why: 'a dash joins two sentences that each need writing; in a figure legend it is also read as a minus' },
]

/** Gene and gene-set names keep their source's capitals: these may not be re-cased. */
export const ACRONYMS = ['DNA', 'RNA', 'E2F', 'MYC', 'G2M', 'KRAS', 'TNFA', 'NFKB', 'MTORC1', 'IL2', 'IL6', 'JAK', 'STAT3', 'STAT5',
  'UV', 'TGF', 'PI3K', 'AKT', 'MTOR', 'P53', 'WNT', 'ATP', 'GTP', 'NADH', 'ER', 'ROS', 'MHC', 'TCA', 'UTR', 'tRNA', 'mRNA', 'rRNA']

/** A string's shape: its numbers and the object's own names set aside, so one sentence is counted once. */
export const shapeOf = (s, names) => {
  let t = String(s).replace(/[-−]?\d[\d,.]*(e[-+]?\d+)?%?/g, '#')
  if (names?.size) t = t.split(/(\s+|[,;:()/·×])/).map(w => (names.has(w) ? '‹name›' : w)).join('')
  return t
}

export const retiredIn = s => RETIRED.filter(r => {
  if (r.only && !r.only.test(s)) return false
  if (!r.re.test(s)) return false
  if (r.but) {
    // Exempt only when every hit of the retired word sits inside an exempt phrase.
    const rest = s.replace(new RegExp(r.but.source, r.but.flags.includes('g') ? r.but.flags : r.but.flags + 'g'), '')
    return r.re.test(rest)
  }
  return true
})
