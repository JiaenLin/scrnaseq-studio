// What this app may say of a fact about the object, and on what source.
//
// Every sentence, label and citation built from a fact about the object is
// made here: Overview's table, the processing paragraph of Methods and its one
// citation choice, the titles of the QC panels, the lines about raw counts and
// pseudobulk, the lines about cells not called. A fact has ONE source kind,
// read from the bundle by `sourceOf` and never from the look of a value, a key
// or a name:
//
//   recorded    the bundle says where in the object it was read (`at`)
//   absent      the converter looked at a named place and found nothing
//   measured    the converter measured it, on a named matrix, and says how
//   chosen      a parameter of the conversion, and who chose it
//   unsourced   an older field states a value and no source: every bundle
//               written before `meta.facts` existed, and the offline exporters
//   silent      nothing is stated
//   unreadable  `meta.facts` holds something this reader refuses
//
// Only `recorded` is worded "as recorded" and badged "from your file", with
// its place beside it, and only a recorded value that EQUALS a key of `CITED`
// is cited. scripts/test-facts.mjs walks SENTENCES over every kind with a
// decoy for each (a value that looks like a method, with no source).
//
// The shape of `meta.facts` is the one the lab's converter will write
// (tools/BUNDLE.md, "facts"); a bundle without it is read as unsourced.

import type { GeneNames } from './genes.ts'
import type { SourceMeta } from './source.ts'

/** A sentence in pieces: the app's own words, and what the bundle filled in (drawn in mono). */
export type Part = string | { m: string }
const m = (s: string): Part => ({ m: s })
export const plain = (parts: Part[]): string => parts.map(p => (typeof p === 'string' ? p : p.m)).join('')

export type FactId =
  | 'integration' | 'integration_embedding' | 'normalization' | 'expression' | 'counts'
  | 'total' | 'genes_detected' | 'mito' | 'cell_type_column' | 'embedding' | 'not_called'
  | 'gene_ids' | 'doublets' | 'ambient'

export type Sourced =
  | { kind: 'recorded'; value: string; at: string }
  | { kind: 'absent'; searched: string }
  | { kind: 'measured'; value: string | number | boolean | null; of: string; how: string; carried?: boolean; why?: string }
  | { kind: 'chosen'; value: string | null; by: 'flag' | 'guess' | 'app' }
  | { kind: 'unsourced'; value: string }
  | { kind: 'silent' }
  | { kind: 'unreadable'; why: string }

type Written = 'recorded' | 'measured' | 'chosen'

interface Row {
  /** The row's name in Overview's table. */
  label: string
  /** The kinds a bundle may give this fact. Any other is refused: a method is never "measured". */
  takes: readonly Written[]
  /** What a bundle states for it in its older field, with no source. */
  legacy: (mt: SourceMeta) => string | null
  /** A step of processing: an unsourced value is said not to be a record of what was run. */
  step: boolean
  /** Drawn even when nothing is stated. */
  always: boolean
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const prov = (k: string) => (mt: SourceMeta) => str(Object.hasOwn(mt.provenance ?? {}, k) ? mt.provenance[k] : null)
const none = () => null

/** The closed list of facts. A sentence about the object names one of these, or it is not written. */
export const FACTS: Record<FactId, Row> = {
  integration: { label: 'Batch integration', takes: ['recorded'], legacy: prov('integration'), step: true, always: true },
  integration_embedding: { label: 'Integration embedding', takes: ['recorded'], legacy: none, step: true, always: false },
  normalization: { label: 'Normalization', takes: ['recorded'], legacy: prov('normalization'), step: true, always: true },
  expression: { label: 'Expression', takes: ['measured'], legacy: mt => str(mt.expression), step: false, always: true },
  counts: { label: 'Raw counts', takes: ['measured'], legacy: none, step: false, always: true },
  total: { label: 'Per-cell total', takes: ['recorded', 'measured'], legacy: none, step: false, always: true },
  genes_detected: { label: 'Genes detected', takes: ['recorded', 'measured'], legacy: none, step: false, always: true },
  mito: { label: 'Mitochondrial %', takes: ['recorded'], legacy: none, step: false, always: true },
  cell_type_column: { label: 'Cell type column', takes: ['chosen'], legacy: prov('clustering'), step: false, always: true },
  embedding: { label: 'Embedding', takes: ['chosen'], legacy: mt => str(mt.embedding), step: false, always: true },
  not_called: { label: 'Cells not called', takes: ['chosen'], legacy: mt => str((mt.sentinels ?? []).join(', ')), step: false, always: false },
  gene_ids: { label: 'Gene identifiers', takes: ['measured'], legacy: none, step: false, always: true },
  doublets: { label: 'Doublet calls', takes: ['recorded'], legacy: prov('doublets'), step: true, always: false },
  ambient: { label: 'Ambient RNA', takes: ['recorded'], legacy: prov('ambient'), step: true, always: false },
}
export const FACT_IDS = Object.keys(FACTS) as FactId[]

/* ---------------- the one reader ---------------- */

const MAX_VALUE = 64, MAX_PLACE = 256, MAX_HOW = 300

/** One short line of text: no line break or other control character, no markup. */
function line(v: unknown, max: number): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) return false
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 32 || c === 127 || c === 60 || c === 62) return false
  }
  return true
}
const bad = (why: string): Sourced => ({ kind: 'unreadable', why })

function readFact(x: unknown, row: Row): Sourced {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return bad('it is not an object')
  const f = x as Record<string, unknown>
  const own = (k: string): unknown => (Object.hasOwn(f, k) ? f[k] : undefined)
  const kind = own('kind')
  if (kind !== 'recorded' && kind !== 'measured' && kind !== 'chosen') return bad('its kind is not one this app knows')
  if (!row.takes.includes(kind)) return bad(`this fact is never ${kind}`)
  if (kind === 'recorded') {
    const value = own('value'), at = own('at'), searched = own('searched')
    if (value === null) return line(searched, MAX_PLACE) ? { kind: 'absent', searched } : bad('it does not say where the converter looked')
    if (!line(value, MAX_VALUE)) return bad('its value is not one short line of text')
    return line(at, MAX_PLACE) ? { kind: 'recorded', value, at } : bad('it gives no place in the object')
  }
  if (kind === 'measured') {
    const value = own('value'), of = own('of'), how = own('how'), carried = own('carried'), why = own('why')
    const scalar = value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || line(value, MAX_VALUE)
    if (!scalar) return bad('its value is not one short line of text, a number, or yes or no')
    if (!line(of, MAX_PLACE)) return bad('it does not say what was measured')
    if (!line(how, MAX_HOW)) return bad('it does not say how it was measured')
    return {
      kind: 'measured', value: value as string | number | boolean | null, of, how,
      ...(typeof carried === 'boolean' ? { carried } : {}), ...(line(why, MAX_HOW) ? { why } : {}),
    }
  }
  const value = own('value'), by = own('by')
  if (value !== null && !line(value, MAX_PLACE)) return bad('its value is not one short line of text')
  if (by !== 'flag' && by !== 'guess' && by !== 'app') return bad('it does not say who chose')
  return { kind: 'chosen', value, by }
}

/**
 * The source kind of one fact, from the bundle alone.
 *
 * A bundle with no `facts` is unsourced wherever its older field states a
 * value. A `facts` this reader cannot take makes every fact unreadable: the
 * older field is NOT used in its place, because the bundle said it has
 * something better and this app could not read it.
 */
export function sourceOf(mt: SourceMeta, id: FactId): Sourced {
  const row = FACTS[id]
  const facts = mt.facts
  if (facts !== undefined) {
    if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) return bad('its facts are not an object')
    const f = facts as Record<string, unknown>
    if (!Object.hasOwn(f, 'v') || f.v !== 1) return bad('its facts are not version 1')
    if (Object.hasOwn(f, id)) return readFact(f[id], row)
  }
  const old = row.legacy(mt)
  return old === null ? { kind: 'silent' } : { kind: 'unsourced', value: old }
}

/* ---------------- the words of each kind ---------------- */

export type BadgeClass = 'file' | 'here' | 'none'
export const BADGE: Record<Sourced['kind'], { text: string; cls: BadgeClass }> = {
  recorded: { text: 'from your file', cls: 'file' },
  absent: { text: 'not recorded', cls: 'none' },
  measured: { text: 'measured at conversion', cls: 'here' },
  chosen: { text: 'chosen at conversion', cls: 'here' },
  unsourced: { text: 'source not stated', cls: 'none' },
  silent: { text: 'not stated', cls: 'none' },
  unreadable: { text: 'unreadable', cls: 'none' },
}
/** What this app reads of the bundle itself, or computes: no claim about the object's past. */
export const OWN_BADGE = {
  held: 'in this bundle', missing: 'not in bundle', refused: 'not offered here', here: 'computed here',
} as const

const BY = {
  flag: 'by a flag of the command',
  guess: 'by the command’s guess from a name',
  app: 'in the lab’s page',
} as const
/** Who named the labels of cells not called: the short form, for a line that also counts them. */
const NAMED = { flag: 'given by a flag', guess: 'guessed from their names', app: 'chosen in the lab' } as const
const noStop = (s: string) => s.replace(/[.\s]+$/, '')
const count = (n: number) => n.toLocaleString('en-US')

function said(s: Sourced, row: Row, mt: SourceMeta): Part[] {
  switch (s.kind) {
    case 'recorded': return [m(s.value), ', as recorded in the object at ', m(s.at), '.']
    case 'absent': return ['Not recorded in the object. The converter looked at ', m(s.searched), '.']
    case 'measured': return [m(String(s.value)), ', measured at conversion on ', m(s.of), ': ', noStop(s.how), '.']
    case 'chosen': return s.value === null
      ? [`None chosen at conversion ${BY[s.by]}.`]
      : [m(s.value), `, chosen at conversion ${BY[s.by]}.`]
    case 'unsourced':
      if (mt.isDemo) return [m(s.value), ', as this built-in demo states it. The object is synthetic.']
      return [m(s.value), ', as the converter wrote it. This bundle gives no source for it',
        row.step ? ', so it is not a record of what was run.' : '.']
    case 'silent': return [mt.isDemo ? 'This demo states none.' : 'This bundle states none.']
    case 'unreadable': return [`This bundle’s entry for it cannot be read (${s.why}), so nothing is said of it.`]
  }
}

/** One line of Overview's table. */
export interface FactRow { key: string; kind: string; label: string; badge: string; cls: BadgeClass; body: Part[] }

const rowOf = (id: FactId, s: Sourced, mt: SourceMeta, body?: Part[]): FactRow => ({
  key: id, kind: s.kind, label: FACTS[id].label, badge: BADGE[s.kind].text, cls: BADGE[s.kind].cls,
  body: body ?? said(s, FACTS[id], mt),
})

/** A fact's line in the table, in the words of its source kind. Null when nothing is stated and the row is not always drawn. */
export function factRow(id: FactId, mt: SourceMeta): FactRow | null {
  const s = sourceOf(mt, id)
  if (s.kind === 'silent' && !FACTS[id].always) return null
  return rowOf(id, s, mt)
}

/** The integration method, and beside a recorded one the embedding the object records for it. */
export function integrationRow(mt: SourceMeta, keys: readonly string[]): FactRow {
  const s = sourceOf(mt, 'integration'), e = sourceOf(mt, 'integration_embedding')
  const r = rowOf('integration', s, mt)
  if (s.kind === 'recorded' && e.kind === 'recorded') {
    r.body = [...r.body, ' Its embedding is recorded as ', m(e.value), ' at ', m(e.at),
      keys.includes(e.value) ? '.' : ', which is not an embedding in this bundle.']
  }
  return r
}

/** Every embedding that came with the object: the bundle's own keys, which are names and not methods. */
export function embeddingRow(mt: SourceMeta, keys: readonly string[]): FactRow {
  const s = sourceOf(mt, 'embedding')
  const body: Part[] = keys.length > 1
    ? [`${keys.join(', ')}; ${keys[0]} opens by default, and any of them can be chosen wherever cells are drawn`]
    : [keys[0] ?? mt.embedding]
  if (s.kind === 'chosen') body.push(`. The one that opens was chosen at conversion ${BY[s.by]}.`)
  return { key: 'embedding', kind: s.kind, label: FACTS.embedding.label, badge: OWN_BADGE.held, cls: 'here', body }
}

/**
 * What the rows of the matrix are called, and where the names came from.
 *
 * On an accession-indexed object this app SHOWS something other than what the
 * gene index holds, and says so with the column the bundle names for it.
 */
export function geneRow(mt: SourceMeta, n: GeneNames): FactRow {
  const s = sourceOf(mt, 'gene_ids')
  const label = FACTS.gene_ids.label
  if (n.renamed) {
    const extra = [
      n.duplicated ? `${n.duplicated} rows share a symbol and carry their ${n.idKind ?? 'accession'} `
        + 'in the name, because they are separate genes and were not summed' : '',
      n.missing ? `${n.missing} rows have no symbol and keep their ${n.idKind ?? 'accession'}` : '',
    ].filter(Boolean)
    const body = `matrix indexed by ${n.idKind ?? 'accession'}s; symbols shown, taken from `
      + `${n.aliasColumn ?? 'the object'} in the same file; nothing is looked up`
      + (extra.length ? `. ${extra.join('; ')}` : '')
    // The bundle names the column the symbols were read from: that much has a place.
    return n.aliasColumn
      ? { key: 'gene_ids', kind: 'recorded', label, badge: BADGE.recorded.text, cls: 'file', body: [body] }
      : { key: 'gene_ids', kind: 'unsourced', label, badge: BADGE.unsourced.text, cls: 'none', body: [body] }
  }
  if (s.kind === 'measured') {
    return rowOf('gene_ids', s, mt, [...said(s, FACTS.gene_ids, mt), ' Shown as stored; nothing is looked up.'])
  }
  if (s.kind === 'unreadable') return rowOf('gene_ids', s, mt)
  return n.idKind
    ? { key: 'gene_ids', kind: 'unsourced', label, badge: BADGE.unsourced.text, cls: 'none',
        body: ['Shown as stored; nothing is looked up. The converter calls them ', m(`${n.idKind}s`), ' and gives no source for that.'] }
    : { key: 'gene_ids', kind: 'silent', label, badge: OWN_BADGE.held, cls: 'here', body: ['Shown as stored; nothing is looked up.'] }
}

/* ---------------- raw counts and pseudobulk ---------------- */

/** The object's raw counts, as far as the bundle says: in the object, and in the bundle, are two facts. */
function countsState(mt: SourceMeta): 'in object' | 'none in object' | 'refused' | 'demo' | 'unstated' | 'unreadable' {
  const s = sourceOf(mt, 'counts')
  if (s.kind === 'unreadable' || (s.kind === 'measured' && typeof s.value !== 'boolean')) return 'unreadable'
  if (s.kind === 'measured') return s.value ? 'in object' : 'none in object'
  if (mt.countsRefused) return 'refused'
  return mt.isDemo ? 'demo' : 'unstated'
}

/**
 * The raw-counts line. `columns` is the usable pseudobulk table this app holds
 * (null when it holds none): what is in the BUNDLE is this app's own reading,
 * and what is in the OBJECT is said only from a measured fact.
 */
export function countsRow(mt: SourceMeta, columns: number | null): FactRow {
  const s = sourceOf(mt, 'counts'), state = countsState(mt)
  const row = (kind: string, badge: string, cls: BadgeClass, body: Part[]): FactRow =>
    ({ key: 'counts', kind, label: FACTS.counts.label, badge, cls, body })
  const where: Part[] = s.kind === 'measured' && state === 'in object' ? [' The counts are in your object at ', m(s.of), '.'] : []
  if (columns !== null) {
    return row('held', OWN_BADGE.held, 'here',
      [`Summed per sample and cell type: the pseudobulk table holds ${count(columns)} columns.`, ...where])
  }
  if (state === 'unreadable') return rowOf('counts', s.kind === 'unreadable' ? s : bad('its value is not yes or no'), mt)
  if (s.kind === 'measured' && state === 'in object') {
    return row('missing', OWN_BADGE.missing, 'none',
      ['In your object at ', m(s.of), '; not in this bundle', s.why ? `: ${noStop(s.why)}.` : '.'])
  }
  if (s.kind === 'measured') {
    return row('measured', BADGE.measured.text, 'here', [m(s.of), ' holds no raw counts, measured at conversion: ', noStop(s.how), '.'])
  }
  if (state === 'refused') {
    return row('refused', OWN_BADGE.refused, 'none', ['The bundle holds summed counts that this app does not offer: see the notes below.'])
  }
  if (state === 'demo') return row('silent', BADGE.silent.text, 'none', ['This demo holds no summed raw counts.'])
  return row('missing', OWN_BADGE.missing, 'none',
    ['This bundle holds no summed raw counts. It does not say whether the object has any.'])
}

const NO_COUNTS = {
  'in object': 'the object’s raw counts are not in this bundle',
  'none in object': 'the object holds no raw counts',
  refused: 'this bundle’s summed counts are not offered here',
  demo: 'this demo holds no raw counts',
  unstated: 'this bundle holds no raw counts',
  unreadable: 'this bundle holds no raw counts this app can read',
} as const

/**
 * The design note: which tests the object's samples allow.
 *
 * "Pseudobulk counts can be saved" is said only when this app holds a usable
 * table of them. It used to follow the samples per group alone, and so was
 * said of a bundle with no counts, of a refused table and of every demo.
 */
export function pseudobulkNote(mt: SourceMeta, nRep: number, usable: boolean): { head: string; rest: string } {
  if (usable) {
    return { head: 'Wilcoxon runs here; pseudobulk counts can be saved.',
      rest: `With ${nRep} samples a group, the counts summed per sample can be saved for DESeq2, which is not run here.` }
  }
  return { head: 'Wilcoxon runs here; no pseudobulk counts to save.',
    rest: `${nRep} samples a group are enough for DESeq2, but ${NO_COUNTS[countsState(mt)]}.` }
}

/** The title of the pseudobulk view when there is no table to sum from: said of the bundle, not of the object. */
export function noCountsTitle(mt: SourceMeta): string {
  const state = countsState(mt)
  if (state === 'in object') return 'The object’s raw counts are not in this bundle'
  if (state === 'none in object') return 'The object holds no raw counts'
  if (state === 'refused') return 'This bundle’s summed counts are not offered here'
  return state === 'demo' ? 'This demo holds no raw counts' : 'This bundle holds no raw counts'
}

/** Co-expression's note on the option that needs the pseudobulk table. */
export const noBulkTip = (mt: SourceMeta): string =>
  `${mt.isDemo ? 'This demo' : 'This bundle'} has no pseudobulk table. Cell type × group answers the same question from the cells`

/* ---------------- the QC panels ---------------- */

// The three writers' own sentences, whole: read by equality, never by a pattern.
const TOTAL_RECOMPUTED = ['no total-count column; recomputed from the matrix', 'no total-count column in obs; recomputed from the matrix']
const GENES_RECOMPUTED = ['no detected-gene column; recomputed from the matrix', 'no detected-gene column in obs; recomputed from the matrix']

export interface QcWords { total: string; genes: string; mito: string; line: Part[] }

/**
 * The titles of the three QC panels, and one line saying what each was read from.
 *
 * A per-cell total is "Total counts" only when the bundle says it was summed
 * from counts: a measured total on the matrix the `counts` fact measured as
 * counts, or, in a bundle of today, the writer's own note that it recomputed
 * the total, in a bundle the writer gave raw counts. A total recomputed with
 * no counts is a sum of the expression values, and is titled so.
 */
export function qcWords(mt: SourceMeta, withMito: boolean): QcWords {
  const out: QcWords = { total: 'Per-cell total', genes: FACTS.genes_detected.label, mito: FACTS.mito.label, line: [] }
  if (mt.isDemo) return { ...out, total: 'Total counts', line: ['synthetic values, made by this demo'] }
  const part = (name: string, id: 'total' | 'genes_detected' | 'mito', legacy: Part[]): Part[] => {
    const s = sourceOf(mt, id)
    if (s.kind === 'recorded') return [`${name} = `, m(s.value), ' at ', m(s.at), ', as recorded']
    if (s.kind === 'absent') return [`${name} = not recorded in the object`]
    if (s.kind === 'measured') return [`${name} = ${id === 'total' ? 'summed' : 'counted'} at conversion from `, m(s.of)]
    if (s.kind === 'unreadable') return [`${name} = an entry this app cannot read`]
    return legacy
  }
  const t = sourceOf(mt, 'total'), c = sourceOf(mt, 'counts')
  const recomputed = mt.notes.some(n => TOTAL_RECOMPUTED.includes(n))
  const wroteCounts = mt.hasRawCounts || mt.countsRefused === true
  let legacyTotal: Part[] = ['total = source not stated']
  if (t.kind === 'measured') {
    if (c.kind === 'measured' && c.value === true && c.of === t.of) out.total = 'Total counts'
  } else if (t.kind === 'silent' && recomputed && wroteCounts) {
    out.total = 'Total counts'
    legacyTotal = ['total = raw counts summed at conversion']
  } else if (t.kind === 'silent' && recomputed) {
    out.total = 'Sum of log-normalized values'
    legacyTotal = ['total = expression values summed at conversion, not counts']
  }
  const genes = mt.notes.some(n => GENES_RECOMPUTED.includes(n))
    ? ['genes = counted at conversion on the same matrix'] : ['genes = source not stated']
  out.line = [...part('total', 'total', legacyTotal), ' · ', ...part('genes', 'genes_detected', genes),
    ...(withMito ? [' · ', ...part('mitochondrial %', 'mito', ['mitochondrial % = source not stated'])] : [])]
  return out
}

/* ---------------- cells the annotator did not call ---------------- */

/** How many of the cells not called have no finite coordinates on one embedding: measured here, from what is drawn. */
export function undrawnOf(xy: Float32Array | undefined, cells: readonly { t: number }[], types: readonly { sentinel?: boolean }[]): number {
  if (!xy) return 0
  let n = 0
  for (let i = 0; i < cells.length; i++) {
    if (types[cells[i].t]?.sentinel && !(Number.isFinite(xy[2 * i]) && Number.isFinite(xy[2 * i + 1]))) n++
  }
  return n
}

/** Overview's line for them. `labels` is their own labels with counts; `undrawn` is of the embedding that opens. */
export function notCalledRow(mt: SourceMeta, labels: string, total: number, undrawn: number, key: string): FactRow {
  const s = sourceOf(mt, 'not_called')
  const body: Part[] = [`${labels}: the annotator’s labels for cells it did not call`,
    s.kind === 'chosen' ? ` (${NAMED[s.by]}). ` : '. ']
  if (undrawn === 0) body.push('Drawn grey on the embedding; not a cell type, so left out of composition, markers and every test.')
  else {
    if (undrawn >= total) body.push('None of them has coordinates on ', m(key), ', so none is drawn. ')
    else body.push(`${count(undrawn)} have no coordinates on `, m(key), ' and are not drawn; the rest are drawn grey. ')
    body.push('Not a cell type, so left out of composition, markers and every test.')
  }
  const shown: Sourced = s.kind === 'chosen' || s.kind === 'unreadable' ? s : { kind: 'unsourced', value: labels }
  return rowOf('not_called', shown, mt, s.kind === 'unreadable' ? undefined : body)
}

/** The line under Cells' key, of the embedding now drawn. */
export function notCalledHint(labels: string, total: number, undrawn: number): string {
  if (undrawn === 0) return `Drawn grey: ${count(total)} cells the annotator did not call (${labels}). Not a cell type.`
  return `${count(total)} cells the annotator did not call (${labels}): ${count(total - undrawn)} drawn grey, `
    + `${count(undrawn)} with no coordinates here, not drawn. Not a cell type.`
}

/** How Methods ends its sentence about them. */
export function notCalledKept(total: number, undrawn: number, key: string): Part[] {
  if (undrawn === 0) return [', and kept on the embedding.']
  if (undrawn >= total) return ['; none of them has coordinates on ', m(key), ', so none is drawn.']
  return [`; ${count(undrawn)} of them have no coordinates on `, m(key), ' and are not drawn, and the rest are kept on it.']
}

/* ---------------- Methods ---------------- */

/** The references a recorded value may be given: by equality with a key, never by a pattern on a name. */
export const CITED = { harmony: 'harmony' } as const
export type CitedRef = (typeof CITED)[keyof typeof CITED]
export const citationFor = (s: Sourced): CitedRef | null =>
  (s.kind === 'recorded' && Object.hasOwn(CITED, s.value) ? CITED[s.value as keyof typeof CITED] : null)

/** What the expression values are, before "; nothing in this app imputes, denoises or rescales them." */
export function methodsExpression(mt: SourceMeta): Part[] {
  const s = sourceOf(mt, 'expression')
  if (s.kind === 'measured') return ['Expression values are ', m(String(s.value)), ', measured at conversion on ', m(s.of)]
  if (s.kind === 'unsourced') {
    return mt.isDemo
      ? ['Expression values are synthetic, labelled ', m(s.value), ' by this demo']
      : ['The bundle labels its expression values ', m(s.value), ' and gives no source for that label']
  }
  return ['The bundle does not say what its expression values are']
}

/** What the cell types are, after "The n cell types are ": a column and who chose it, never a method. */
export function methodsCellTypes(mt: SourceMeta): Part[] {
  const s = sourceOf(mt, 'cell_type_column')
  const tail = mt.isDemo ? '; this demo states no clustering or annotation method for them.'
    : '; this bundle records no clustering or annotation method for them.'
  if (s.kind === 'chosen' && s.value !== null) return ['the levels of ', m(s.value), `, the column chosen at conversion ${BY[s.by]}`, tail]
  if (s.kind === 'unsourced') return ['the levels of ', m(s.value), ', the column the bundle names for them', tail]
  return ['the object’s own labels', tail]
}

/**
 * The integration sentence of Methods, and its citation.
 *
 * Never "was corrected with": a recorded value is the object's own word for
 * its method and can be "none". With no recorded source no method is named at
 * all, whatever the bundle's older field says: this is the sentence a reader
 * pastes into a paper.
 */
export function methodsIntegration(mt: SourceMeta): { before: Part[]; cite: CitedRef | null; after: Part[] } {
  const s = sourceOf(mt, 'integration')
  if (s.kind === 'recorded') {
    const e = sourceOf(mt, 'integration_embedding')
    return {
      before: ['The object records its integration method as ', m(s.value)], cite: citationFor(s),
      after: [' (at ', m(s.at), ')', ...(e.kind === 'recorded' ? [' and that method’s embedding as ', m(e.value)] : []), '.'],
    }
  }
  if (s.kind === 'absent') {
    return { before: ['The object records no integration method (the converter looked at ', m(s.searched), ').'], cite: null, after: [] }
  }
  return { before: [mt.isDemo ? 'This demo states no integration method, so none is named here.'
    : 'This bundle gives no source for an integration method, so none is named here.'], cite: null, after: [] }
}

/** Cells' head line: the key is the bundle's name for the coordinates, and no more. */
export const embeddingHead = (mt: SourceMeta, key: string): string =>
  (mt.isDemo ? `Embedding · ${key}, made by this demo` : `Embedding · ${key}, as the bundle names it`)

/* ---------------- the table the test walks ---------------- */

export type BudgetKind = 'badge' | 'title' | 'text' | 'note' | 'legend' | 'help' | 'status' | 'tooltip' | 'empty state title' | 'methods'

/** One sentence this app builds from a fact: where it is drawn, the fact it speaks of, and its budget. */
export interface Sentence { where: string; fact: FactId; budget: BudgetKind; say: (mt: SourceMeta) => Part[] }

const KEYS = ['X_umap', 'X_other']
const NAMES = { renamed: false, idKind: 'symbol', duplicated: 0, missing: 0, aliasColumn: null } as unknown as GeneNames
const body = (r: FactRow | null): Part[] => r?.body ?? []
const badge = (r: FactRow | null): Part[] => (r ? [r.badge] : [])
const generic = (id: FactId): Sentence[] => [
  { where: `Overview, ${FACTS[id].label}`, fact: id, budget: 'text', say: mt => body(factRow(id, mt)) },
  { where: `Overview, ${FACTS[id].label}: badge`, fact: id, budget: 'badge', say: mt => badge(factRow(id, mt)) },
]

/**
 * Every sentence about the object, each with the fact it speaks of. A sentence
 * is added here or it is not drawn: scripts/test-facts.mjs walks this list
 * over every source kind, and reads the components for a fact said elsewhere.
 */
export const SENTENCES: Sentence[] = [
  ...generic('normalization'), ...generic('cell_type_column'), ...generic('expression'), ...generic('doublets'), ...generic('ambient'),
  { where: 'Overview, Batch integration', fact: 'integration', budget: 'text', say: mt => body(integrationRow(mt, KEYS)) },
  { where: 'Overview, Batch integration: badge', fact: 'integration', budget: 'badge', say: mt => badge(integrationRow(mt, KEYS)) },
  { where: 'Overview, Batch integration, its embedding', fact: 'integration_embedding', budget: 'text', say: mt => body(integrationRow(mt, KEYS)) },
  { where: 'Methods, integration', fact: 'integration', budget: 'methods', say: mt => { const i = methodsIntegration(mt); return [...i.before, ...i.after] } },
  { where: 'Methods, integration, its embedding', fact: 'integration_embedding', budget: 'methods', say: mt => methodsIntegration(mt).after },
  { where: 'Methods, expression', fact: 'expression', budget: 'methods', say: methodsExpression },
  { where: 'Methods, cell types', fact: 'cell_type_column', budget: 'methods', say: methodsCellTypes },
  { where: 'Overview, Embedding', fact: 'embedding', budget: 'text', say: mt => body(embeddingRow(mt, KEYS)) },
  { where: 'Overview, Embedding: badge', fact: 'embedding', budget: 'badge', say: mt => badge(embeddingRow(mt, KEYS)) },
  { where: 'Cells, head', fact: 'embedding', budget: 'status', say: mt => [embeddingHead(mt, '')] },
  { where: 'Overview, Gene identifiers', fact: 'gene_ids', budget: 'text', say: mt => body(geneRow(mt, NAMES)) },
  { where: 'Overview, Gene identifiers: badge', fact: 'gene_ids', budget: 'badge', say: mt => badge(geneRow(mt, NAMES)) },
  { where: 'Overview, Raw counts', fact: 'counts', budget: 'text', say: mt => body(countsRow(mt, null)) },
  { where: 'Overview, Raw counts: badge', fact: 'counts', budget: 'badge', say: mt => badge(countsRow(mt, null)) },
  { where: 'Overview, Raw counts, a usable table', fact: 'counts', budget: 'text', say: mt => body(countsRow(mt, 8)) },
  { where: 'Overview, the design note', fact: 'counts', budget: 'note', say: mt => { const n = pseudobulkNote(mt, 4, false); return [n.head, ' ', n.rest] } },
  { where: 'Differential expression, no counts', fact: 'counts', budget: 'empty state title', say: mt => [noCountsTitle(mt)] },
  { where: 'Co-expression, no table', fact: 'counts', budget: 'tooltip', say: mt => [noBulkTip(mt)] },
  { where: 'Overview, QC: the total’s title', fact: 'total', budget: 'title', say: mt => [qcWords(mt, true).total] },
  { where: 'Overview, QC: what each was read from', fact: 'total', budget: 'legend', say: mt => qcWords(mt, true).line },
  { where: 'Overview, QC: genes detected', fact: 'genes_detected', budget: 'legend', say: mt => qcWords(mt, true).line },
  { where: 'Overview, QC: mitochondrial %', fact: 'mito', budget: 'legend', say: mt => qcWords(mt, true).line },
  { where: 'Overview, Cells not called', fact: 'not_called', budget: 'text', say: mt => body(notCalledRow(mt, '', 9, 3, '')) },
  { where: 'Overview, Cells not called: badge', fact: 'not_called', budget: 'badge', say: mt => badge(notCalledRow(mt, '', 9, 3, '')) },
]
