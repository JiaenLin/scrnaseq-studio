// The truth table of a bundle's run section: for each state, and for the Lab
// that wrote it (today's, "new"; the one before it listed records by six named
// fields, "old"), the sentences a reader must be shown. Written by hand from
// what each bundle holds; read by scripts/test-run-states.mjs, which renders the
// components, and by a check of the built app in a browser.

// ---- the sentences, as the truth table states them ---------------------------
export const WHY = " The converter's notes, in the next card, say why."
export const SUB = {
  fields: n => `${n} record${n === 1 ? '' : 's'} listed from the object's uns. Of ${n === 1 ? 'it' : 'each'}, this bundle holds up to six fields as recorded: tool, version, commit, stage, run_key and job.`,
  copies: n => `${n} record${n === 1 ? '' : 's'} from the object's uns, copied unless marked otherwise. Each field is shown under its own name, as recorded; nothing here is inferred.`,
}
export const NONE = 'This bundle lists no run record, so it cannot say which run produced the object.'
/** How such a sentence ends: a colon and the paths the converter named; or, when it named none, at its count. */
const named = paths => (paths ? `: ${paths}.` : '.')
export const noneOf = (n, paths) => (n === 1 ? `This bundle does not list the 1 run record the converter found in the object${named(paths)}`
  : `This bundle lists none of the ${n} run records the converter found in the object${named(paths)}`)
export const more = (n, paths) => `${n} more record${n === 1 ? '' : 's'} the converter found ${n === 1 ? 'is' : 'are'} not listed here${named(paths)}`
export const ABSENT = "This bundle carries no run section, so it cannot say which run produced the object. The lab's converter writes one from an .h5ad's uns; an older bundle, another exporter's, or one from an .rds has none."
export const WRONG = "This bundle's run section is not in the shape the lab writes (its records are not a list), so none of it is shown."
export const looked = run => `Where the converter looked: ${run.searched}`
export const METHODS = {
  fields: /the bundle lists the run's records? \([^)]*\) by up to six named fields, which Overview shows, and how many variable genes were kept[^.]*are not among them, and are not guessed at\./,
  copies: /the object carries the run's own records? \([^)]*\), which Overview shows as recorded, and how many variable genes were kept[^.]*are not read out of (it|them) here, and are not guessed at\./,
  none: /Everything between the counts and those labels is unknown to this app/,
}
/** Words that state a reason, or a finding, no bundle states: none may appear on the card or in Methods. */
export const NEVER = [/over its budget/, /found none where it looked/, /could not read it/, /was copied into this bundle/]

const tenA = Array.from({ length: 10 }, (_, k) => `uns/a${String(k).padStart(2, '0')}_provenance`).join(', ')

/**
 * The truth table. `form` is how the studio places the section; `said` the card's
 * own sentences in order (before "Where the converter looked"); `kinds` and
 * `badges` each distinct value among the records, in order of first use.
 */
export const ROWS = [
  ['no record listed and none found', 'N00_norecord', {
    new: { form: 'none', n: 0, said: [NONE + WHY] },
    old: { form: 'none', n: 0, said: [NONE + WHY] } }],
  ['no record listed, and the one candidate could not be inspected', 'U2_0L_uninspected', {
    new: { form: 'none', n: 0, said: [NONE + WHY], next: /could not be inspected[^.]*cannot tell whether it holds a record/ },
    old: { form: 'none', n: 0, said: [NONE + WHY], next: /could not be inspected[^.]*cannot tell whether it holds a record/ } }],
  ['no record listed and some found', 'R04_0L_sixless_string', {
    new: { form: 'none', n: 0, said: [noneOf(2, 'uns/a00_provenance, uns/a01_provenance') + WHY] },
    old: { form: 'copies', n: 2, said: [], kinds: ['copied', 'text'], badges: ['copied', 'as text'] } }],
  ['no record listed and 66 found, two of them past the cap', 'R05_0L_cap', {
    new: { form: 'none', n: 0, said: [noneOf(66, `${tenA}, and 56 more`) + WHY] },
    old: { form: 'copies', n: 66, said: [], kinds: ['copied'], badges: ['copied'] } }],
  ['records listed', 'R01_family', {
    new: { form: 'fields', n: 3, said: [], kinds: ['fields'], badges: ['3 of 6 fields', '4 of 6 fields'] },
    old: { form: 'copies', n: 5, said: [], kinds: ['copied'], badges: ['copied'], empties: 2 } }],
  ['listed and one left out by the cap: 65 records', 'R08_65good', {
    new: { form: 'fields', n: 64, said: [more(1, 'uns/l64_provenance') + WHY], kinds: ['fields'], badges: ['2 of 6 fields'] },
    old: { form: 'fields', n: 65, said: [], kinds: ['fields'], badges: ['2 of 6 fields'] } }],
  ['listed and one left out after a long value', 'R06_mixed', {
    new: { form: 'fields', n: 2, said: [more(1, 'uns/z0_provenance') + WHY], kinds: ['fields'], badges: ['2 of 6 fields'] },
    old: { form: 'copies', n: 4, said: [], kinds: ['copied'], badges: ['copied'] } }],
  ['listed and two left out after a long value', 'R06b_mixed_after', {
    new: { form: 'fields', n: 2, said: [more(2, 'uns/m00_provenance, uns/z0_provenance') + WHY], kinds: ['fields'], badges: ['2 of 6 fields'] },
    old: { form: 'copies', n: 4, said: [], kinds: ['copied'], badges: ['copied'] } }],
  ['a record of six empty fields', 'R07_empty6', {
    new: { form: 'fields', n: 1, said: [], kinds: ['fields'], badges: ['6 of 6 fields'], empties: 6 },
    old: { form: 'fields', n: 1, said: [], kinds: ['fields'], badges: ['6 of 6 fields'], empties: 6 } }],
  ['records too large for the earlier budgets', 'B00_budget', {
    new: { form: 'fields', n: 7, said: [], kinds: ['fields'], badges: ['1 of 6 fields', '4 of 6 fields'] },
    old: { form: 'copies', n: 7, said: [more(1, 'uns/f_provenance') + WHY], kinds: ['named', 'copied'], badges: ['named, not copied', 'copied'] } }],
]
