// The run that produced an object, as the bundle carries it.
//
// The lab's converter copies what an object's uns says about the run that made
// it — each tool's provenance record, the harness's run record — into the
// bundle as `meta.run` (scrnaseq-lab, src/lib/h5ad.ts readRun):
//
//   { searched, records: [{ path, record }], leftOut?: { count, paths } }
//
// `record` is the uns entry as JSON; or one of the converter's "(not copied: …)"
// sentences, when it named the record instead of copying it (over its budget,
// say, with the size); or null, when it could not read it. `leftOut` counts the
// records it found and did not write, and names the first of them.
//
// This file says what that section holds, record by record, and nothing more.
// A record's fields keep the tool's own names and values: none is renamed,
// abbreviated, read for its meaning or filled in, and a tool is never taken
// from a record's path. What a record does not say is not shown.

import type { SourceMeta } from './source.ts'

/** One field of a copied record: its own name, and its value as recorded. */
export interface RunField { key: string; value: unknown }

export type RunRecordView =
  /** The uns entry, copied: every top-level field. */
  | { path: string; kind: 'copied'; fields: RunField[] }
  /** Named in place of a copy; the converter's sentence says why, and over budget, its size. */
  | { path: string; kind: 'named'; sentence: string }
  /** Listed with no content: the converter could not read it. */
  | { path: string; kind: 'empty' }
  /** Kept as its text: a harness record that did not parse as JSON. */
  | { path: string; kind: 'text'; text: string }
  /** Anything else JSON holds: a list, a number, a boolean. */
  | { path: string; kind: 'value'; value: unknown }

export interface RunLeftOut { count: number; paths: string[] }

export type RunView =
  /** A built-in demo object, made in the browser. */
  | { kind: 'demo' }
  /** The bundle has no run section. */
  | { kind: 'absent' }
  /** It has one that is not in the shape the lab writes; none of it is shown. */
  | { kind: 'malformed'; why: string }
  | { kind: 'section'; searched: string | null; records: RunRecordView[]; leftOut: RunLeftOut | null }

/**
 * Fields shown first when a record has them, under exactly these names: what
 * made the object, and in which run. This orders; it does not interpret. A
 * record that calls its commit something else still shows it, in its own place,
 * and a record without one of these gets no row for it.
 */
export const IDENTITY: readonly string[] = ['tool', 'version', 'commit', 'stage', 'run_key', 'job']

/** Past this many characters a value is folded behind a disclosure, never cut. */
export const FOLD = 120

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** The converter's own form for a record it named instead of copying. */
const NOT_COPIED = /^\(not copied: [\s\S]*\)$/

/** One record as the card shows it. */
export function recordView(path: string, record: unknown): RunRecordView {
  if (record === null) return { path, kind: 'empty' }
  if (typeof record === 'string') {
    return NOT_COPIED.test(record) ? { path, kind: 'named', sentence: record } : { path, kind: 'text', text: record }
  }
  if (isObject(record)) {
    const keys = Object.keys(record)
    const order = [...IDENTITY.filter(k => keys.includes(k)), ...keys.filter(k => !IDENTITY.includes(k))]
    return { path, kind: 'copied', fields: order.map(key => ({ key, value: record[key] })) }
  }
  return { path, kind: 'value', value: record }
}

/**
 * What the card shows for this source.
 *
 * A section that is not in the lab's shape is named as such and shown not at
 * all: half of a run record, read past a field that was not what it claimed, is
 * a provenance nobody wrote. The bundle still opens — the cells do not depend
 * on it.
 */
export function runView(meta: Pick<SourceMeta, 'isDemo' | 'run'>): RunView {
  if (meta.isDemo) return { kind: 'demo' }
  const run = meta.run
  if (run === undefined || run === null) return { kind: 'absent' }
  if (!isObject(run)) return { kind: 'malformed', why: 'it is not an object' }
  if (!Array.isArray(run.records)) return { kind: 'malformed', why: 'its records are not a list' }
  const records: RunRecordView[] = []
  for (let i = 0; i < run.records.length; i++) {
    const r = run.records[i]
    if (!isObject(r) || typeof r.path !== 'string' || !('record' in r)) {
      return { kind: 'malformed', why: `entry ${i + 1} of its records is not a path and a record` }
    }
    records.push(recordView(r.path, r.record))
  }
  let leftOut: RunLeftOut | null = null
  if (run.leftOut !== undefined) {
    const l = run.leftOut
    if (!isObject(l) || !Number.isInteger(l.count) || (l.count as number) < 0
      || !Array.isArray(l.paths) || !l.paths.every(p => typeof p === 'string')) {
      return { kind: 'malformed', why: 'its leftOut is not a count and a list of paths' }
    }
    leftOut = { count: l.count as number, paths: l.paths as string[] }
  }
  return { kind: 'section', searched: typeof run.searched === 'string' ? run.searched : null, records, leftOut }
}

/** The paths of the records whose content travelled with the bundle: copied, kept as text, or a value. */
export const carriedRecords = (v: RunView): string[] =>
  (v.kind === 'section' ? v.records.filter(r => r.kind !== 'named' && r.kind !== 'empty').map(r => r.path) : [])

/** A value as a person reads it: a string as itself, anything else as JSON. */
export const valueText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v))
