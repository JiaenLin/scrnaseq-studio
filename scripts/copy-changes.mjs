// Every string a change reworded or cut, before and after, for docs/design/COPY.md.
//
//   git archive <base> src | tar -x -C <dir>
//   node scripts/copy-changes.mjs <dir>/src        (writes docs/design/inventory/copy-changes.json)
//
// Reads the source at the base and now with the parser of scripts/test-copy.mjs,
// and pairs the strings of each file in order: a string that is in both is
// unchanged; between two unchanged strings the old ones are paired with the new
// ones by likeness; an old one with no partner was cut. The reason is counted,
// not typed: the retired term the old string held, or the budget it was over.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

const base = process.argv[2]
const run = env => {
  const out = `${os.tmpdir()}/copy-${process.pid}-${Object.keys(env).length}.json`
  execFileSync('node', ['scripts/test-copy.mjs', '--json'], { env: { ...process.env, ...env, COPY_OUT: out } })
  const list = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.rmSync(out, { force: true })
  return list
}
const before = run({ COPY_SRC: base }), after = run({})
const byFile = list => { const m = new Map(); for (const s of list) { if (!m.has(s.file)) m.set(s.file, []); m.get(s.file).push(s) } return m }
const B = byFile(before), A = byFile(after)
const grams = s => { const g = new Set(); const t = s.toLowerCase(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g }
const like = (a, b) => { const x = grams(a), y = grams(b); let n = 0; for (const g of x) if (y.has(g)) n++; return n / Math.max(1, Math.min(x.size, y.size)) }

const changes = []
let same = 0
for (const [file, bs] of B) {
  const as = A.get(file) ?? []
  const left = as.map(s => s.text)
  const olds = []
  for (const b of bs) { const i = left.indexOf(b.text); if (i >= 0) { left[i] = null; same++ } else olds.push(b) }
  const news = as.filter((s, i) => left[i] !== null)
  const used = new Set()
  for (const b of olds) {
    let best = -1, score = 0.34
    news.forEach((n, i) => { if (used.has(i)) return; const sc = like(b.text, n.text); if (sc > score) { score = sc; best = i } })
    // A short string reworded whole ("Clusters" to "Cell types") is paired with the next new one of its kind.
    if (best < 0) best = news.findIndex((n, i) => !used.has(i) && n.kind === b.kind && Math.abs(n.line - b.line) < 40)
    if (best >= 0) used.add(best)
    const why = [b.retired.length ? `retired: ${[...new Set(b.retired)].join('; ')}` : '', b.over ? `over the ${b.kind} budget` : ''].filter(Boolean).join('. ')
    changes.push({ file, kind: b.kind, before: b.text, after: best >= 0 ? news[best].text : null, why: why || 'shorter' })
  }
  news.forEach((n, i) => { if (!used.has(i)) changes.push({ file, kind: n.kind, before: '', after: n.text, why: 'new: something a view or a saved file did not say' }) })
}
fs.writeFileSync('docs/design/inventory/copy-changes.json', JSON.stringify(changes, null, 1))
const cut = changes.filter(c => c.before && !c.after).length, added = changes.filter(c => !c.before).length
console.log(`${before.length} strings before, ${after.length} now: ${changes.length - cut - added} reworded, ${cut} cut, ${added} new, ${same} unchanged`)
