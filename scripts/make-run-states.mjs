// Developer script — its OUTPUT is committed, so `npm test` needs no Lab checkout.
//
// Writes testdata/lab/run-states.json: the run section and the notes that the
// Lab's converter wrote for one object per state of a run section, each object
// converted twice, by the Lab as it is today ("new") and by the Lab before it
// listed records by six named fields ("old"). scripts/test-run-states.mjs opens
// each of them and reads every sentence the studio says about run records.
//
//   node scripts/make-run-states.mjs <dir> <new Lab commit> <old Lab commit>
//
// <dir> holds `<object>.new.zip` and `<object>.old.zip`, each written by
// `bin/scrnaseq-lab.mjs convert <object>.h5ad <zip> --label p` from that Lab
// checkout. The objects are synthetic (the Lab's committed fixtures with made-up
// uns records; testdata/lab/README.md says what each holds). Only `run` and
// `notes` are kept: they are all the studio reads about the run. A bundle that
// is byte for byte a committed fixture of testdata/lab is named instead.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

const [dir, labNew, labOld] = process.argv.slice(2)
if (!dir || !labNew || !labOld) {
  console.error('usage: node scripts/make-run-states.mjs <dir> <new Lab commit> <old Lab commit>')
  process.exit(2)
}
// A bundle that is already a committed fixture is named, not written twice.
const LAB = fileURLToPath(new URL('../testdata/lab/', import.meta.url))
const committed = new Map(readdirSync(LAB).filter(f => f.endsWith('.zip'))
  .map(f => [createHash('sha256').update(readFileSync(join(LAB, f))).digest('hex'), f]))
const read = (file) => {
  const bytes = readFileSync(join(dir, file))
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (committed.has(sha)) return { sha256: sha, zip: committed.get(sha) }
  let z = unzipSync(bytes)
  const inner = Object.keys(z).find(k => k.endsWith('.zip'))
  if (inner) z = unzipSync(z[inner])
  const meta = JSON.parse(strFromU8(z['meta.json']))
  return { sha256: createHash('sha256').update(bytes).digest('hex'), ...('run' in meta ? { run: meta.run } : {}), notes: meta.notes ?? [] }
}
const objects = [...new Set(readdirSync(dir).filter(f => /\.(new|old)\.zip$/.test(f)).map(f => f.replace(/\.(new|old)\.zip$/, '')))].sort()
const states = {}
for (const o of objects) {
  states[o] = { new: read(`${o}.new.zip`), old: read(`${o}.old.zip`) }
  for (const side of ['new', 'old']) {
    if (states[o][side].zip) { console.log(`${o}.${side}: the committed ${states[o][side].zip}`); continue }
    const r = states[o][side].run
    console.log(`${o}.${side}: ${r ? `${r.records.length} listed [${[...new Set(r.records.map(x => x.record === null ? 'null' : typeof x.record === 'string' ? 'string' : Object.keys(x.record).join('+')))].slice(0, 6).join(' | ').slice(0, 150)}] leftOut ${JSON.stringify(r.leftOut ?? null).slice(0, 110)}` : 'no run'}`)
  }
}
const out = fileURLToPath(new URL('../testdata/lab/run-states.json', import.meta.url))
writeFileSync(out, JSON.stringify({ lab: { new: labNew, old: labOld }, states }, null, 1) + '\n')
console.log(`${objects.length} objects -> ${out}`)
