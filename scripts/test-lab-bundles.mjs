// The Lab's converter's own bytes, opened by the studio.
//
// testdata/lab/ holds bundles the Lab's converter (scrnaseq-lab, the command
// line its app's modules run under) wrote from the Lab's committed synthetic
// fixtures — see testdata/lab/README.md for the commit, the command and each
// file's sha256. This file opens them through the studio's own reader, the way
// the app opens a file, and checks what a person would then be shown:
//
//   - the run behind the object, from the `run` section the converter writes;
//   - every pseudobulk column attached to its own sample, when the converter
//     has split a sample by condition into ids that hold '|'.
//
// What the bundle should contain is read here independently, straight out of
// the zip — the records from meta.json, the sample × cluster cell counts from
// sample.u16 and cluster.u16 — and never from the studio's parse of it.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { loadComponents, render, textOf } from './render.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
/** A check whose setup may throw: a throw fails this check, not the file. */
const attempt = async (name, fn, want) => {
  try {
    check(name, await fn(), want)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}\n        threw ${e?.message ?? e}`)
  }
}

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const DIR = here('../testdata/lab')
const C = await loadComponents()

/** The bundle's own files, read without the studio: collection.json and each part's entries. */
function raw(file) {
  const outer = unzipSync(new Uint8Array(readFileSync(join(DIR, file))))
  const index = JSON.parse(strFromU8(outer['collection.json']))
  const parts = index.parts.map(p => {
    const files = unzipSync(outer[p.file])
    return { key: p.key, files, meta: JSON.parse(strFromU8(files['meta.json'])) }
  })
  return { index, parts }
}

/** Opened the way the app opens a file it was handed. */
async function open(file) {
  const blob = new Blob([readFileSync(join(DIR, file))])
  return openCollection(blob, await readCollectionIndex(blob))
}

const overview = (src) => render(C.Overview, {
  src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {},
})
const TITLE = 'The run that produced this object'
const runCard = (html) => html.split('<section class="card">').slice(1)
  .map(s => `<section class="card">${s}`).find(s => s.includes(TITLE)) ?? ''
const recordsOf = (card) => card.split('data-run-record="').slice(1).map(chunk => {
  const path = textOf(chunk.slice(0, chunk.indexOf('"')))
  const kind = /data-run-kind="([^"]*)"/.exec(chunk)?.[1] ?? null
  const rows = [...chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(td => textOf(td[1]).trim()))
  return { path, kind, rows, text: textOf(chunk) }
})

/** A field's value as a person should read it: a string as itself, anything else as JSON. */
const asRecorded = (v) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Cells per sample × cluster, counted from the part's own cell arrays. */
function cellCounts(part) {
  const sample = new Uint16Array(part.files['sample.u16'].slice().buffer)
  const cluster = new Uint16Array(part.files['cluster.u16'].slice().buffer)
  const n = new Map()
  for (let i = 0; i < sample.length; i++) {
    const k = JSON.stringify([part.meta.samples[sample[i]].id, part.meta.clusters[cluster[i]]])
    n.set(k, (n.get(k) ?? 0) + 1)
  }
  return n
}
/** The truth for a whole object: every sample × cluster with cells, summed over parts. */
function truthOf(parts) {
  const n = new Map()
  for (const p of parts) for (const [k, v] of cellCounts(p)) n.set(k, (n.get(k) ?? 0) + v)
  return [...n].map(([k, v]) => `${JSON.parse(k).join(' / ')}: ${v}`).sort()
}
const columnsOf = (src) => (src.pseudobulk?.columns ?? []).map(c => `${c.sample} / ${c.cluster}: ${c.nCells}`).sort()
const orphans = (src) => {
  const ids = new Set(src.d.samples.map(s => s.id))
  const types = new Set(src.clusters)
  return (src.pseudobulk?.columns ?? []).filter(c => !ids.has(c.sample) || !types.has(c.cluster))
    .map(c => `${c.sample} / ${c.cluster}`)
}
function unattached(src) {
  const cells = new Map()
  for (const c of src.d.cells) cells.set(c.s, (cells.get(c.s) ?? 0) + 1)
  const pb = new Map()
  for (const c of src.pseudobulk?.columns ?? []) pb.set(c.sample, (pb.get(c.sample) ?? 0) + c.nCells)
  return [...cells].filter(([s, n]) => pb.get(s) !== n).map(([s, n]) => `${s}: ${pb.get(s) ?? 0} of ${n}`)
}

console.log('\nTHE FILES ARE THE ONES THE README NAMES')
{
  const listed = [...readFileSync(join(DIR, 'README.md'), 'utf8')
    .matchAll(/^\| `([^`]+\.zip)` \| `([0-9a-f]{64})` \|/gm)].map(m => [m[1], m[2]])
  const onDisk = readdirSync(DIR).filter(f => f.endsWith('.zip')).sort()
  check('every zip here is listed, and every listed one is here', listed.map(l => l[0]).sort(), onDisk)
  check('each has the sha256 the Lab\'s converter gave it',
    listed.filter(([f, sha]) => createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex') !== sha)
      .map(([f]) => f), [])
}

console.log("\nTHE LAB'S COMMITTED FIXTURE: THE RUN CARD SHOWS ITS ONE RECORD, AS RECORDED")
{
  const { parts } = raw('family-2x2.zip')
  const written = parts[0].meta.run
  const record = written.records[0].record
  check('(the converter wrote one record)', written.records.map(r => r.path), ['uns/scintegrate/provenance'])
  await attempt('the card shows exactly that record', async () =>
    recordsOf(runCard(overview(await open('family-2x2.zip')))).map(r => [r.path, r.kind]),
  [['uns/scintegrate/provenance', 'copied']])
  await attempt('every one of its fields, with the value the converter wrote', async () => {
    const rec = recordsOf(runCard(overview(await open('family-2x2.zip'))))[0]
    return Object.fromEntries((rec?.rows ?? []).map(([k, v]) => [k, v]))
  }, Object.fromEntries(Object.entries(record).map(([k, v]) => [k, asRecorded(v)])))
  await attempt('tool, version, commit and job first; then the record\'s own order', async () =>
    recordsOf(runCard(overview(await open('family-2x2.zip'))))[0]?.rows.map(r => r[0]),
  ['tool', 'version', 'commit', 'job',
    ...Object.keys(record).filter(k => !['tool', 'version', 'commit', 'job'].includes(k))])
  await attempt('and where the converter looked', async () =>
    textOf(runCard(overview(await open('family-2x2.zip')))).includes(written.searched), true)
  await attempt('its pseudobulk is untouched: every column, no orphan (guard)', async () => {
    const src = await open('family-2x2.zip')
    return [columnsOf(src), orphans(src)]
  }, [truthOf(parts), []])
}

console.log('\nA FIXTURE WITH NO RUN RECORD')
{
  const { parts } = raw('no-record.zip')
  check('(the converter wrote an empty run section)', parts[0].meta.run.records, [])
  await attempt('the card says the object carries no run record, and where the converter looked', async () => {
    const card = textOf(runCard(overview(await open('no-record.zip'))))
    return [card.includes('The object carries no run record'), card.includes(parts[0].meta.run.searched)]
  }, [true, true])
}

console.log("\nGAP-C52'S PROBE: LEVELS '', '|x' AND 'a||b'")
{
  const { parts } = raw('odd-levels.zip')
  const ids = parts[0].meta.samples.map(s => s.id)
  check('(the converter split s1, s2 and s3 into ids that hold |)',
    ['s1|', 's2||x', 's3|a||b'].every(id => ids.includes(id)), true)
  const headers = strFromU8(parts[0].files['pseudobulk.tsv']).split('\n')[0].split('\t').slice(1)
  await attempt('every column the converter wrote is read, each as its own sample × cluster', async () =>
    columnsOf(await open('odd-levels.zip')), truthOf(parts))
  await attempt(`all ${headers.length} of them`, async () =>
    (await open('odd-levels.zip')).pseudobulk?.columns.length, headers.length)
  await attempt('0 orphaned columns', async () => orphans(await open('odd-levels.zip')), [])
  await attempt("every sample's columns sum to its cells — s1|, s2||x and s3|a||b included", async () =>
    unattached(await open('odd-levels.zip')), [])
  await attempt('each column carries the counts written under its header', async () => {
    const src = await open('odd-levels.zip')
    const rows = strFromU8(parts[0].files['pseudobulk.tsv']).split('\n').slice(1).map(l => l.split('\t'))
    const pb = src.pseudobulk
    let wrong = 0
    rows.forEach((r, g) => headers.forEach((_h, j) => { if (pb.counts[g * pb.columns.length + j] !== +r[j + 1]) wrong++ }))
    return wrong
  }, 0)
}

console.log("\nSPLIT NAMES THAT COLLIDE: '#2' AND '#3'")
{
  const { parts } = raw('collide.zip')
  check('(the converter wrote #2 and #3 ids)',
    parts[0].meta.samples.map(s => s.id).filter(id => id.includes('#')).sort(), ['s1|c1#2', 's1|c2#2', 's1|c2#3'])
  await attempt('every column read as its own pair, none orphaned, every sample attached (guard)', async () => {
    const src = await open('collide.zip')
    return [columnsOf(src), orphans(src), unattached(src)]
  }, [truthOf(parts), [], []])
}

console.log('\nRECORDS THE CONVERTER COULD NOT COPY WHOLE')
{
  const { parts } = raw('budget.zip')
  const run = parts[0].meta.run
  const named = run.records.find(r => r.path === 'uns/a_provenance').record
  await attempt('the records, in the order the converter wrote them', async () =>
    recordsOf(runCard(overview(await open('budget.zip')))).map(r => r.path), run.records.map(r => r.path))
  await attempt('the over-budget one is named, not copied, with its size as the converter wrote it', async () => {
    const rec = recordsOf(runCard(overview(await open('budget.zip')))).find(r => r.path === 'uns/a_provenance')
    return [rec?.kind, rec?.text.includes(named), /300,053 bytes as written/.test(rec?.text ?? '')]
  }, ['named', true, true])
  await attempt('the one left out of the section is named as left out', async () => {
    const card = textOf(runCard(overview(await open('budget.zip'))))
    return [/1 more record/.test(card), card.includes('uns/f_provenance')]
  }, [true, true])
  await attempt("the harness's record, parsed by the converter, shows its stages as recorded", async () => {
    const rec = recordsOf(runCard(overview(await open('budget.zip')))).find(r => r.path === 'uns/harness_run')
    return [rec?.kind, rec?.rows.map(r => r[0]), rec?.text.includes('"run_key":"RUNKEY-FIXTURE"')]
  }, ['copied', ['stages', 'decisions'], true])
}

console.log("\nTHE PROBE CUT INTO PARTS BY THE STUDIO'S OWN make-collection.mjs")
{
  const tmp = mkdtempSync(join(tmpdir(), 'studio-lab-'))
  try {
    const { index } = raw('odd-levels.zip')
    const outer = unzipSync(new Uint8Array(readFileSync(join(DIR, 'odd-levels.zip'))))
    const bundle = join(tmp, 'x.zip')
    writeFileSync(bundle, outer[index.parts[0].file])
    const out = join(tmp, 'odd-levels-3.zip')
    const r = spawnSync(process.execPath, [here('./make-collection.mjs'), bundle, '3', out], { encoding: 'utf8' })
    check('(make-collection.mjs ran)', r.status, 0)
    await attempt('the three parts hold the same columns as the one bundle, none orphaned, every sample attached', async () => {
      const blob = new Blob([readFileSync(out)])
      const src = await openCollection(blob, await readCollectionIndex(blob))
      return [src.nParts, columnsOf(src), orphans(src), unattached(src)]
    }, [3, truthOf(raw('odd-levels.zip').parts), [], []])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nAll Lab-bundle tests passed")
process.exit(failed ? 1 : 0)
