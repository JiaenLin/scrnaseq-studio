// Developer script — its OUTPUT is committed, so `npm test` needs no Lab checkout.
//
// Writes testdata/lab/*.zip: what the Lab's own converter (scrnaseq-lab, the
// `bin/scrnaseq-lab.mjs` command) writes for its committed synthetic fixtures,
// and for copies of them edited here through the Lab's own h5wasm. Those are
// the files scripts/test-lab-bundles.mjs opens, through the studio's reader, to
// test the contract between the two repositories on the writer's real bytes
// rather than on an imitation of them written here.
//
//   node scripts/make-lab-bundles.mjs <scrnaseq-lab checkout> [out dir]
//
// The Lab's converter gives the same bytes for the same input and flags, so a
// rerun against the same Lab commit reproduces every file. Its sha256 values,
// and the Lab commit they came from, are in testdata/lab/README.md; the test
// checks them, so a regenerated file is a deliberate change of that record.
//
// Everything here is synthetic: the Lab's fixtures are made-up objects (samples
// s1..s8, types TypeA..TypeD, neutral factors), and the edits add made-up
// levels and records. Nothing here may ever come from a real object.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [labArg, outArg] = process.argv.slice(2)
if (!labArg) {
  console.error('usage: node scripts/make-lab-bundles.mjs <scrnaseq-lab checkout> [out dir]')
  process.exit(2)
}
const LAB = resolve(labArg)
const OUT = resolve(outArg ?? fileURLToPath(new URL('../testdata/lab', import.meta.url)))
const fixture = (name) => join(LAB, 'scripts', 'fixtures', name)

const git = spawnSync('git', ['-C', LAB, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
const labCommit = git.status === 0 ? git.stdout.trim() : '(not a git checkout)'

// The Lab's own HDF5 writer, so an edited copy is written by the same library
// the Lab's own tests edit their fixtures with.
const { default: h5wasm } = await import(pathToFileURL(join(LAB, 'node_modules/h5wasm/dist/node/hdf5_hl.js')).href)
await h5wasm.ready

const tmp = mkdtempSync(join(tmpdir(), 'lab-bundles-'))
mkdirSync(OUT, { recursive: true })

const enc = (o, type, version) => {
  o.create_attribute('encoding-type', type)
  o.create_attribute('encoding-version', version)
  return o
}
const dict = (g, name) => enc(g.create_group(name), 'dict', '0.1.0')
const str = (g, name, value) => enc(g.create_dataset({ name, data: value }), 'string', '0.2.0')

/** A copy of a committed fixture, edited through h5wasm. The file name is the bundle's `source`. */
function copyWith(src, name, edit) {
  const dst = join(tmp, `${name}.h5ad`)
  copyFileSync(src, dst)
  const f = new h5wasm.File(dst, 'a')
  try { edit(f) } finally { f.flush(); f.close() }
  return dst
}

/** A categorical obs column's level per cell. */
function levelsOf(f, name) {
  const g = f.get(`obs/${name}`)
  const cats = g.get('categories').value
  return { cats: Array.from(cats), values: Array.from(g.get('codes').value, c => cats[Number(c)]) }
}

/** Add a categorical obs column in anndata's layout, after the existing ones. */
function addCategorical(f, name, levels, values) {
  const obs = f.get('obs')
  const g = enc(obs.create_group(name), 'categorical', '0.2.0')
  g.create_attribute('ordered', new Int8Array([0]), [], '<b')
  g.create_dataset({ name: 'categories', data: levels })
  g.create_dataset({ name: 'codes', data: Int8Array.from(values, v => levels.indexOf(v)) })
  const order = obs.attrs['column-order'].value
  obs.delete_attribute('column-order')
  obs.create_attribute('column-order', [...order, name])
}

/** Each sample's k-th cell, in file order, through `pick(sample, k)`. */
function perSample(samples, pick) {
  const seen = new Map()
  return samples.map(s => {
    const k = seen.get(s) ?? 0
    seen.set(s, k + 1)
    return pick(s, k)
  })
}

const inputs = []

// The committed fixture, as it is.
inputs.push({ name: 'family-2x2', input: fixture('family-2x2.h5ad'), flags: [] })

// The committed fixture whose uns carries no run record at all.
inputs.push({ name: 'no-record', input: fixture('nullable-mask.h5ad'), flags: [] })

// The probe the W017 verifier found GAP-C52 with: three samples each split by a
// condition level that is empty, starts with '|', or holds '||'. Every other
// sample sits in one level. The verifier's own rule, value for value, and its
// file name and flags, so this is the verifier's bundle byte for byte.
inputs.push({
  name: 'odd-levels',
  input: copyWith(fixture('family-2x2.h5ad'), 'oddlevels', f => {
    const { values } = levelsOf(f, 'sample')
    const other = { s1: '', s2: '|x', s3: 'a||b' }
    addCategorical(f, 'odd', ['ok', '', '|x', 'a||b'], perSample(values,
      (s, k) => (s in other && k % 2 === 1 ? other[s] : 'ok')))
  }),
  flags: ['--condition', 'odd', '--label', 'x'],
})

// Split names that collide with names the object already has. s1 spans both
// levels; three other samples are already called what s1's halves would be
// called, so the split ones must take '#2' and on.
inputs.push({
  name: 'collide',
  input: copyWith(fixture('family-2x2.h5ad'), 'collide', f => {
    const { cats, values } = levelsOf(f, 'sample')
    addCategorical(f, 'crossed', ['c1', 'c2'], perSample(values, (s, k) => (
      s === 's1' ? (k % 2 === 0 ? 'c2' : 'c1') : ['s2', 's4', 's6', 's8'].includes(s) ? 'c1' : 'c2')))
    const rename = { s2: 's1|c1', s3: 's1|c2', s4: 's1|c2#2' }
    const donors = cats.map(c => rename[c] ?? c)
    addCategorical(f, 'donor', donors, values.map(s => rename[s] ?? s))
  }),
  flags: ['--sample', 'donor', '--condition', 'crossed', '--extra', 'factor_a', '--extra', 'factor_b',
    '--label', 'x'],
})

// Records the converter cannot copy whole. a_provenance is over the 262,144
// bytes one record may take, so it is named with its size; b..f are ~240 KB
// each, and the section's 1,048,576 bytes hold four of them after the tool's
// own record, so f_provenance is left out. harness_run is the harness's
// record as one JSON string, which the converter parses.
inputs.push({
  name: 'budget',
  input: copyWith(fixture('family-2x2.h5ad'), 'budget', f => {
    const uns = f.get('uns')
    const a = dict(uns, 'a_provenance')
    str(a, 'tool', 'synthetic-tool')
    str(a, 'log', 'x'.repeat(300_000))
    for (const k of ['b', 'c', 'd', 'e', 'f']) {
      const g = dict(uns, `${k}_provenance`)
      str(g, 'tool', 'synthetic-tool')
      str(g, 'log', k.repeat(240_000))
    }
    str(uns, 'harness_run', JSON.stringify({
      stages: [{ stage: 'integrate', tool: 'synthetic-tool', version: '0.0.0+fixture',
        commit: '0'.repeat(40), run_key: 'RUNKEY-FIXTURE', job: 'fixture', sealed: true }],
      decisions: [],
    }))
  }),
  flags: [],
})

const manifest = []
for (const { name, input, flags } of inputs) {
  const out = join(OUT, `${name}.zip`)
  const r = spawnSync(process.execPath, [join(LAB, 'bin', 'scrnaseq-lab.mjs'), 'convert', input, out, ...flags],
    { cwd: tmp, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`${name}: the Lab's converter exited ${r.status}\n${r.stderr}`)
    process.exit(1)
  }
  const sha = createHash('sha256').update(readFileSync(out)).digest('hex')
  const shown = flags.length ? ` ${flags.join(' ')}` : ''
  const from = input.startsWith(tmp) ? input.slice(tmp.length + 1) : input.slice(LAB.length + 1)
  manifest.push(`| \`${name}.zip\` | \`${sha}\` | \`${from}${shown}\` |`)
  console.log(`${name}.zip  ${sha}`)
}
rmSync(tmp, { recursive: true, force: true })
console.log(`\nLab commit ${labCommit}\n`)
console.log(manifest.join('\n'))
