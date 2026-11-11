// Every string a change reworded or cut, before and after, for docs/design/COPY.md.
//
//   git archive <base> src | tar -x -C <dir>
//   node scripts/copy-changes.mjs <dir>/src        (writes docs/design/inventory/copy-changes.json)
//
// Reads the source at the base and now with the parser of scripts/test-copy.mjs,
// and pairs the strings of each file BY WHAT THEY SAY, never by where they sit:
// a string that is in both is unchanged; of the rest, an old one and a new one
// are a pair only when they share enough of their letters (trigrams), the
// likeliest pairs taken first across the whole file. An old string with no such
// partner is listed as cut or reworded whole, and a new one as new: run 5 paired
// those leftovers by position, which set about twenty unrelated strings side by
// side. The reason is counted, not typed: the retired term the old string held,
// or the budget it was over.

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
// Shared trigrams over the shorter string's, and none at all when the longer string shares under 21% of its
// own: a short label is inside almost any long sentence ("Genes of the set" is in a 24-word note about a gene).
const like = (a, b) => { const x = grams(a), y = grams(b); let n = 0; for (const g of x) if (y.has(g)) n++; return n / Math.max(1, x.size, y.size) < 0.21 ? 0 : n / Math.max(1, Math.min(x.size, y.size)) }

const changes = []
let same = 0
for (const [file, bs] of B) {
  const as = A.get(file) ?? []
  const left = as.map(s => s.text)
  const olds = []
  for (const b of bs) { const i = left.indexOf(b.text); if (i >= 0) { left[i] = null; same++ } else olds.push(b) }
  const news = as.filter((s, i) => left[i] !== null)
  const cand = []
  olds.forEach((b, bi) => news.forEach((n, ni) => { const sc = like(b.text, n.text); if (sc > 0.34) cand.push([sc, bi, ni]) }))
  cand.sort((x, y) => y[0] - x[0])
  const pairOf = new Map(), used = new Set()
  for (const [, bi, ni] of cand) { if (pairOf.has(bi) || used.has(ni)) continue; pairOf.set(bi, ni); used.add(ni) }
  for (const [bi, b] of olds.entries()) {
    const best = pairOf.get(bi) ?? -1
    const why = [b.retired.length ? `retired: ${[...new Set(b.retired)].join('; ')}` : '', b.over ? `over the ${b.kind} budget` : ''].filter(Boolean).join('. ')
    changes.push({ file, kind: b.kind, before: b.text, after: best >= 0 ? news[best].text : null, why: why || (best >= 0 ? 'reworded' : 'cut, or reworded whole: no string now shares its words') })
  }
  news.forEach((n, i) => { if (!used.has(i)) changes.push({ file, kind: n.kind, before: '', after: n.text, why: 'new: something a view or a saved file did not say' }) })
}
fs.writeFileSync('docs/design/inventory/copy-changes.json', JSON.stringify(changes, null, 1))
const cut = changes.filter(c => c.before && !c.after).length, added = changes.filter(c => !c.before).length
console.log(`${before.length} strings before, ${after.length} now: ${changes.length - cut - added} reworded, ${cut} cut, ${added} new, ${same} unchanged`)
