// What a composition bar is made of, and what it is broken down by.
//
// The fixed view — cell types, one bar per sample — answers exactly one
// question. An object carrying clusters, groups and samples supports several,
// and which one a reader needs is not something this app can know in advance:
// "what is each animal made of" and "which animals is each cluster made of" are
// the same three columns read two different ways. So the pairing is chosen.
//
// Nor are there only three columns. An object that annotates each cell with a
// dissection as well as an age has a fourth, and the question the reader came
// with is as likely to be about that one — so every column the bundle carries
// is a field here, and the products come out of the same loop as the rest.
// Nothing below knows which of them is "the region".
//
// What is NOT chosen is the rule that keeps the figure honest. A bar may not
// merge the cells of several samples unless the samples are themselves what the
// bar is divided into. Cells from one animal are not independent observations,
// and a stacked bar has no way of saying so — it just makes the proportion look
// more precise than the experiment can support. Those combinations are refused,
// with the reason and with the single edit that fixes them, rather than drawn.
//
// The counting is one pass over the cells for any pairing, cached per object,
// because the atlas is 292 495 cells and the user is expected to try several
// pairings in a row.

import type { CellType, Dataset } from '../types.ts'
import { cellColumns } from './bundle.ts'
import { cellsBySample } from './chart.ts'

/**
 * A categorical column of this object, by role or by position.
 *
 * The first three are the roles every bundle carries. `extraN` is the Nth of
 * whatever else the object brought — a dissection, a coarser annotation level —
 * in the order the exporter wrote them. Nothing below treats them as a special
 * case: a field is a level list and a code per cell, and that is all any of
 * this needs, which is why the products come out of one loop.
 */
export type CompField = 'type' | 'cond' | 'sample' | `extra${number}`

const EXTRA = /^extra(\d+)$/

/** Which extra column a field names, or -1 for the three roles. */
export function extraAt(f: CompField): number {
  const m = EXTRA.exec(f)
  return m ? Number(m[1]) : -1
}

/**
 * What to call a field, in the object's own words where it has them.
 *
 * "Group" is a placeholder for whatever the experiment varied, and an object
 * that calls it Age should have the menu say Age. Cell type and sample keep the
 * studio's words: those are its whole vocabulary, spoken in every caption
 * beside these menus.
 */
export function fieldLabel(d: Dataset, f: CompField): string {
  if (f === 'type') return 'Cell type'
  if (f === 'sample') return 'Sample'
  const cols = cellColumns(d)
  if (f === 'cond') return cols.cond ?? 'Group'
  return cols.extras[extraAt(f)]?.key ?? f
}

/**
 * The exporter's entry-name rule, mirrored from scrnaseq-lab src/lib/build.ts
 * (`safeEntry`).
 *
 * Deliberately the same rule and not this studio's own `slug`: it is the rule
 * that turned this column's name into the zip entry `extra.dissection.u16` the
 * cells were read out of, so a CSV column and the entry behind it are spelled
 * the same way. Copied rather than imported because the lab is a separate app
 * that this one shares no module with — it shares a file format.
 */
const safeName = (s: string) =>
  (s || 'x').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'x'

/**
 * What to call a field in a file, as opposed to on a menu.
 *
 * The three roles keep the words every other export in this studio spends —
 * `deg_*.csv` says gene, `cluster_markers.csv` says cluster, the pseudobulk
 * header says sample and cond — so a composition table joins to them on column
 * names a reader already has.
 *
 * A column the object brought has no word of the studio's, and the internal one
 * is not a name at all: `extra0` is a position in whatever list this object
 * happened to carry, it means a different column in the next object, and
 * composition_type_by_extra0.csv is a file nobody can read six months later.
 * So it leaves under the name the object gave it. The screen has always shown
 * that name (see fieldLabel); this is the same promise kept on the way out.
 */
export function fieldExport(d: Dataset, f: CompField): string {
  const i = extraAt(f)
  return i < 0 ? f : safeName(cellColumns(d).extras[i]?.key ?? f)
}

/** The three columns every composition table writes, whatever the pairing. */
const FIXED = ['cells', 'row_total', 'samples', 'fraction']

/**
 * The header of the exported table.
 *
 * The names are made unique even though the fields already are, because two
 * names can still collide where two fields cannot: an object carrying a column
 * called "Sample", or "cells", or two columns that differ only in punctuation,
 * lands on a word this header has already spent — and a CSV with one name twice
 * is a file a spreadsheet reads by silently picking one. The studio's own
 * columns keep their words and the newcomer takes the suffix, which is the same
 * way round the exporter resolves it when two column names flatten to one zip
 * entry.
 */
export function compHeader(d: Dataset, parts: CompField, rowFields: CompField[]): string[] {
  const seen = new Set(FIXED)
  const uniq = (n: string) => {
    let name = n
    for (let i = 2; seen.has(name); i++) name = `${n}-${i}`
    seen.add(name)
    return name
  }
  return [...rowFields.map(f => uniq(fieldExport(d, f))), uniq(fieldExport(d, parts)), ...FIXED]
}

/** The download name of the exported table and figure, in the object's words. */
export function compName(d: Dataset, parts: CompField, rowFields: CompField[]): string {
  return `composition_${fieldExport(d, parts)}_by_${rowFields.map(f => fieldExport(d, f)).join('_')}`
}

/**
 * The fields this object can actually be split by.
 *
 * A single-condition object has nothing to say about groups, and offering the
 * choice would only produce a figure with one category in it — which is the
 * same test every extra column has to pass.
 *
 * The extras sit between the group and the sample because that is what they
 * are: facts about the cells, like the group, rather than the unit of
 * replication.
 */
export function compFields(d: Dataset): CompField[] {
  const out: CompField[] = ['type']
  if (d.conds.length > 1) out.push('cond')
  cellColumns(d).extras.forEach((c, i) => {
    if (c.levels.length > 1) out.push(`extra${i}`)
  })
  out.push('sample')
  return out
}

export function levelsOf(d: Dataset, types: CellType[], f: CompField): string[] {
  if (f === 'type') return types.map(t => t.name)
  if (f === 'cond') return d.conds
  if (f === 'sample') return d.samples.map(s => s.id)
  return cellColumns(d).extras[extraAt(f)]?.levels ?? []
}

/** A row definition: one field, or two nested outer-then-inner. */
export interface RowAxis {
  key: string
  label: string
  fields: CompField[]
}

/**
 * The row axes that still make sense once `parts` has taken one field.
 *
 * Nesting a group inside a sample is left out: a sample belongs to exactly one
 * group, so it would draw the same rows under a longer name.
 */
export function rowAxes(d: Dataset, parts: CompField): RowAxis[] {
  const others = compFields(d).filter(f => f !== parts)
  const out: RowAxis[] = others.map(f => ({ key: f, label: fieldLabel(d, f), fields: [f] }))
  for (const a of others) {
    for (const b of others) {
      if (a === b || (a === 'sample' && b === 'cond')) continue
      out.push({
        key: `${a}+${b}`,
        label: `${fieldLabel(d, a)} × ${fieldLabel(d, b)}`,
        fields: [a, b],
      })
    }
  }
  return out
}

export interface CompRow {
  /** Level index per row field, outermost first. */
  keys: number[]
  n: number
  /** How many samples this row merges. 1 is the honest case. */
  nSamples: number
  /** True when this row's cells came from more than one sample. */
  multiSample: boolean
  /** The one sample this row belongs to, or -1 when it spans several. */
  sample: number
}

export interface CompTable {
  parts: CompField
  rowFields: CompField[]
  /** Only the combinations that hold cells, in level order. */
  rows: CompRow[]
  /**
   * How many combinations the row fields make, before the empty ones are cut.
   *
   * The gap between this and `rows.length` is the whole story of a product
   * axis: 133 cell types × 11 dissections is 1 463 rows on paper and a few
   * hundred in the object. A figure that does not say so looks like a figure
   * with rows missing.
   */
  possible: number
  nParts: number
  /** counts[rowIndex * nParts + partIndex]. */
  counts: Float64Array
  /** Some row merges cells from more than one sample. */
  pools: boolean
  /**
   * How much pooling, and why — the three numbers the refusal card quotes.
   *
   * A rule that cannot say how much it is refusing reads as an arbitrary one.
   * `pooledRows` and `worstPool` measure the damage; `spanningSamples` is the
   * reason, and it is the number that settles the argument: when none of the
   * object's samples reaches more than one of these rows, no arrangement of
   * these two fields separates them, and the refusal is a fact about how the
   * experiment was collected rather than something the app declines to do.
   */
  pooledRows: number
  worstPool: number
  spanningSamples: number
  /** Every row falls in a single part, so the bars would carry no information. */
  degenerate: boolean
  nCells: number
}

/** 0, 1, 2 for the three roles; 3 + N for the Nth extra column. */
const codeOf = (f: CompField): number =>
  f === 'type' ? 0 : f === 'cond' ? 1 : f === 'sample' ? 2 : 3 + extraAt(f)

const CACHE = new WeakMap<Dataset, Map<string, CompTable>>()

/**
 * Count cells for one pairing.
 *
 * Cached on the Dataset. Cluster names are not part of the key because nothing
 * here stores a name — rows carry level indices and the caller resolves them,
 * so renaming a cluster in Markers cannot invalidate a count.
 */
export function compTable(
  d: Dataset, types: CellType[], parts: CompField, rowFields: CompField[],
): CompTable {
  const key = `${parts}|${rowFields.join('+')}|${types.length}`
  let per = CACHE.get(d)
  if (!per) { per = new Map(); CACHE.set(d, per) }
  const hit = per.get(key)
  if (hit) return hit
  const out = build(d, types, parts, rowFields)
  per.set(key, out)
  return out
}

/**
 * The rule at the top of this file, asked of a finished table.
 *
 * One predicate for both of its uses — refusing a pairing and choosing one — so
 * a menu can never open on something the figure will then refuse to draw.
 */
export function refuses(t: CompTable): boolean {
  return t.pools && t.parts !== 'sample'
}

/**
 * The row axis to open on, for a given bars field.
 *
 * `rowAxes` is ordered by field and knows nothing about the cells, so on an
 * object with several animals per group its first entry is one this figure
 * refuses: cell types by group pools those animals. Taking `axes[0]` on arrival,
 * and again on every change of the bars menu, therefore put a refusal card where
 * the figure was under a pairing the reader never chose — and setting the bars
 * menu back the way it had been did not bring the figure back. The axis to open
 * on is the first that survives the test the figure itself applies.
 *
 * Falls back to `axes[0]` when every axis pools, which is a real object: one
 * group of several animals, with nothing but those animals to put on the rows.
 * The tab then refuses and says why, which is the honest answer.
 */
export function defaultRowAxis(d: Dataset, types: CellType[], parts: CompField): RowAxis {
  const axes = rowAxes(d, parts)
  return axes.find(a => !refuses(compTable(d, types, parts, a.fields))) ?? axes[0]
}

function build(
  d: Dataset, types: CellType[], parts: CompField, rowFields: CompField[],
): CompTable {
  const nType = types.length
  const nCond = d.conds.length
  const nSample = d.samples.length
  const extras = cellColumns(d).extras
  const size = (f: CompField) => (f === 'type' ? nType : f === 'cond' ? nCond
    : f === 'sample' ? nSample : extras[extraAt(f)]?.levels.length ?? 1)
  // Indexed by the code above minus 3, so the inner loop reaches an extra
  // column's per-cell codes with an array read and no lookup.
  const extraCodes = extras.map(c => c.codes)

  const condAt = new Map(d.conds.map((c, i) => [c, i]))
  const sampleCond = Int32Array.from(d.samples, s => condAt.get(s.cond) ?? 0)

  const nParts = Math.max(1, size(parts))
  const partCode = codeOf(parts)
  const rowCodes = rowFields.map(codeOf)
  const dims = rowFields.map(f => Math.max(1, size(f)))
  const nRows = dims.reduce((a, b) => a * b, 1)

  const counts = new Float64Array(nRows * nParts)
  const rowN = new Float64Array(nRows)
  const firstSample = new Int32Array(nRows).fill(-1)
  // How many samples each row merges, and how many rows each sample is spread
  // over. Both fall out of walking sample by sample for nothing: inside one
  // sample's cells the sample never changes, so a row is new to this sample
  // exactly when the stamp it carries is not this sample's index.
  const nSamp = new Int32Array(nRows)
  const stamp = new Int32Array(nRows).fill(-1)
  const rowsPerSample = new Int32Array(nSample)

  // Walking sample by sample means the sample and its group are known outside
  // the inner loop, so the only per-cell read is the cluster code. On the atlas
  // that is the difference between one pass and 292 495 map lookups.
  const buckets = cellsBySample(d)
  const cells = d.cells
  let nCells = 0
  for (let si = 0; si < nSample; si++) {
    const ci = sampleCond[si]
    const idx = buckets[si]
    for (let k = 0; k < idx.length; k++) {
      const cell = idx[k]
      const ti = cells[cell].t
      if (ti >= nType) continue
      let r = 0
      for (let j = 0; j < rowCodes.length; j++) {
        const c = rowCodes[j]
        r = r * dims[j] + (c === 0 ? ti : c === 1 ? ci : c === 2 ? si : extraCodes[c - 3][cell])
      }
      const p = partCode === 0 ? ti : partCode === 1 ? ci
        : partCode === 2 ? si : extraCodes[partCode - 3][cell]
      counts[r * nParts + p]++
      rowN[r]++
      nCells++
      if (stamp[r] !== si) {
        stamp[r] = si
        nSamp[r]++
        rowsPerSample[si]++
        if (firstSample[r] < 0) firstSample[r] = si
      }
    }
  }

  // Empty combinations are dropped rather than drawn as blank rows: on the
  // atlas, cell type × sample is 12 369 slots and most of them hold nothing.
  const rows: CompRow[] = []
  const kept: number[] = []
  for (let r = 0; r < nRows; r++) {
    if (!rowN[r]) continue
    const keys = new Array<number>(rowCodes.length)
    let x = r
    for (let j = rowCodes.length - 1; j >= 0; j--) {
      keys[j] = x % dims[j]
      x = Math.floor(x / dims[j])
    }
    rows.push({
      keys,
      n: rowN[r],
      nSamples: nSamp[r],
      multiSample: nSamp[r] > 1,
      sample: nSamp[r] > 1 ? -1 : firstSample[r],
    })
    kept.push(r)
  }

  const packed = new Float64Array(rows.length * nParts)
  for (let i = 0; i < kept.length; i++) {
    packed.set(counts.subarray(kept[i] * nParts, kept[i] * nParts + nParts), i * nParts)
  }

  let degenerate = nParts > 1
  for (let i = 0; i < rows.length && degenerate; i++) {
    let seen = 0
    for (let p = 0; p < nParts; p++) if (packed[i * nParts + p] > 0) seen++
    if (seen > 1) degenerate = false
  }

  let pooledRows = 0
  let worstPool = 0
  for (const r of rows) {
    if (r.multiSample) pooledRows++
    if (r.nSamples > worstPool) worstPool = r.nSamples
  }
  // Samples with no cells here are not counted as spanning and not counted as
  // confined: they are silent, and a sentence built on this number says "of the
  // object's samples", never "of the samples in this figure".
  let spanningSamples = 0
  for (let si = 0; si < nSample; si++) if (rowsPerSample[si] > 1) spanningSamples++

  return {
    parts,
    rowFields,
    rows,
    possible: nRows,
    nParts,
    counts: packed,
    pools: pooledRows > 0,
    pooledRows,
    worstPool,
    spanningSamples,
    degenerate,
    nCells,
  }
}
