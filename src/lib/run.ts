// The run that produced an object, as the bundle holds it.
//
// The lab's converter writes what an object's uns says about the run that made
// it — each tool's provenance record, the harness's run record — into the
// bundle as `meta.run` (scrnaseq-lab, src/lib/h5ad.ts readRun):
//
//   { searched, records: [{ path, record }], leftOut?: { count, paths } }
//
// What `record` is depends on the converter that wrote the bundle, and the
// bundle has no version field that says which did (`schema` and `searched` are
// the same in both). So the form is read from the fields present:
//
// - TODAY the lab lists a record by up to six named fields: a dict holding one
//   to six of tool, version, commit, stage, run_key and job, each a string,
//   and nothing else of the record. `leftOut` then counts records it found and
//   did not list; why is in the bundle's notes, not in the section.
// - EARLIER it copied the record: the uns entry as JSON, whatever it held; or
//   one of its "(not copied: …)" sentences, when it named the record instead
//   of copying it (over its budget, say, with the size); or null. `leftOut`
//   then counted the records that did not fit.
//
// A section holding at least one record that is not in the six-field form was
// written by an earlier converter, and is described as copies. A section whose
// every record is in that form cannot be placed — an earlier bundle of small
// records reads the same — so it is described only by what is true of both:
// which of the six fields the bundle holds. A section with no record cannot be
// placed either, and the card says only what it lists. Nothing here reads the
// prose of the bundle's notes to decide a fact.
//
// This file says what the section holds, record by record, and nothing more.
// A record's fields keep their own names and values: none is renamed,
// abbreviated, read for its meaning or filled in, and a tool is never taken
// from a record's path. What a record does not say is not shown.

import type { SourceMeta } from './source.ts'

/** One field of a record: its own name, and its value as recorded. */
export interface RunField { key: string; value: unknown }

export type RunRecordView =
  /** Listed by the six named fields the bundle holds for it (one to six of them). */
  | { path: string; kind: 'fields'; fields: RunField[] }
  /** An earlier converter's copy of the uns entry: every top-level field. */
  | { path: string; kind: 'copied'; fields: RunField[] }
  /** Named in place of a copy; the converter's sentence says why, and over budget, its size. */
  | { path: string; kind: 'named'; sentence: string }
  /** Listed with no content: a null. The section does not say why. */
  | { path: string; kind: 'empty' }
  /** Kept as its text: a harness record that did not parse as JSON. */
  | { path: string; kind: 'text'; text: string }
  /** Anything else JSON holds: a list, a number, a boolean. */
  | { path: string; kind: 'value'; value: unknown }

export interface RunLeftOut { count: number; paths: string[] }

/**
 * How a section's records are written: `fields` when every one is in the
 * six-field form, `copies` when at least one is not (an earlier converter's
 * section), null when it lists none.
 */
export type RunForm = 'fields' | 'copies' | null

export type RunView =
  /** A built-in demo object, made in the browser. */
  | { kind: 'demo' }
  /** The bundle has no run section. */
  | { kind: 'absent' }
  /** It has one that is not in the shape the lab writes; none of it is shown. */
  | { kind: 'malformed'; why: string }
  | { kind: 'section'; form: RunForm; searched: string | null; records: RunRecordView[]; leftOut: RunLeftOut | null }

/**
 * The six fields the lab lists a record by, in the order they are shown. In an
 * earlier converter's copy they are shown first when the record has them, under
 * exactly these names. This orders; it does not interpret. A record that calls
 * its commit something else still shows it, in its own place, and a record
 * without one of these gets no row for it.
 */
export const IDENTITY: readonly string[] = ['tool', 'version', 'commit', 'stage', 'run_key', 'job']

/** Past this many characters a value is folded behind a disclosure, never cut. */
export const FOLD = 120

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** The converter's own form for a record it named instead of copying. */
const NOT_COPIED = /^\(not copied: [\s\S]*\)$/

/**
 * Is this record in the form the lab writes today: one to six of the named
 * fields, each a string, and no other key? Read from the record alone. The
 * lab's limit on a value's length is not tested: it is the lab's to move.
 */
export function isSixFields(record: unknown): record is Record<string, string> {
  if (!isObject(record)) return false
  const keys = Object.keys(record)
  return keys.length > 0 && keys.every(k => IDENTITY.includes(k) && typeof record[k] === 'string')
}

/** One record as the card shows it, in a section of this form. */
export function recordView(path: string, record: unknown, form: RunForm = 'copies'): RunRecordView {
  if (record === null) return { path, kind: 'empty' }
  if (typeof record === 'string') {
    return NOT_COPIED.test(record) ? { path, kind: 'named', sentence: record } : { path, kind: 'text', text: record }
  }
  if (isObject(record)) {
    const keys = Object.keys(record)
    const order = [...IDENTITY.filter(k => keys.includes(k)), ...keys.filter(k => !IDENTITY.includes(k))]
    return { path, kind: form === 'fields' ? 'fields' : 'copied', fields: order.map(key => ({ key, value: record[key] })) }
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
  const listed: { path: string; record: unknown }[] = []
  for (let i = 0; i < run.records.length; i++) {
    const r = run.records[i]
    if (!isObject(r) || typeof r.path !== 'string' || !('record' in r)) {
      return { kind: 'malformed', why: `entry ${i + 1} of its records is not a path and a record` }
    }
    listed.push({ path: r.path, record: r.record })
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
  const form: RunForm = listed.length === 0 ? null : listed.every(r => isSixFields(r.record)) ? 'fields' : 'copies'
  return {
    kind: 'section', form, searched: typeof run.searched === 'string' ? run.searched : null,
    records: listed.map(r => recordView(r.path, r.record, form)), leftOut,
  }
}

/** The paths of the records the bundle holds content for: listed by fields, copied, kept as text, or a value. */
export const carriedRecords = (v: RunView): string[] =>
  (v.kind === 'section' ? v.records.filter(r => r.kind !== 'named' && r.kind !== 'empty').map(r => r.path) : [])

/**
 * Does a note of the bundle speak of these records — or, given none, of the
 * run section itself? Read only to decide whether the card may point at the
 * notes for a reason; it decides no fact, and when it is false the card says
 * nothing about why.
 */
export function notesSpeakOf(notes: readonly string[] | undefined, paths: readonly string[]): boolean {
  const all = (notes ?? []).filter(n => typeof n === 'string')
  return paths.length
    ? all.some(n => paths.some(p => n.includes(p)))
    : all.some(n => /\brun (record|section)\b/.test(n))
}

/** A value as a person reads it: a string as itself, anything else as JSON. */
export const valueText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v))
