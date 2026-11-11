// A bundle that declares no sentinels is read exactly as it always was.
//
// The studio is live, and every bundle written before the lab's converter
// declared sentinels — and every bundle the in-browser lab still writes — has
// no such field. For those, the sentinel rule must be invisible: every count,
// every denominator and every legend the same as before it existed. The same
// object as test-sentinels.mjs, with the field absent and with it empty: its
// EXCLUDED and UNRESOLVED are then two ordinary clusters, because nothing said
// otherwise, and the numbers are the ones the studio has always computed —
// counted here again, independently, straight from the cells.

import { cellColumns, parseBundle } from '../src/lib/bundle.ts'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { compFields, compTable, extraAt, rowAxes } from '../src/lib/composition.ts'
import { pal } from '../src/lib/palette.ts'
import { bundleSource } from '../src/lib/source.ts'
import { DE_GATES, deMarkersAll, markersSpec } from '../src/lib/stats.ts'
import { CLUSTERS, N, SAMPLES, sentinelBundle, sentinelCollection, truth } from './fixture-sentinels.mjs'
import { loadComponents, render } from './render.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const S = await import('../src/lib/sentinels.ts').catch(() => null)
const P = await import('../src/lib/embed-paint.ts').catch(() => null)
const C = await loadComponents()
const T = truth()
const legendOf = (html) => [...html.matchAll(/<span><i class="sw" style="background:([^"]*)"><\/i>([^<]*)<\/span>/g)]
  .map(m => [m[1], m[2]])

/** Every pairing's counts, tallied from the cells with no composition code at all. */
function naive(d, parts, rowFields) {
  const sampleAt = new Map(d.samples.map((s, i) => [s.id, i]))
  const condAt = new Map(d.conds.map((c, i) => [c, i]))
  const extras = cellColumns(d).extras
  const value = (f, c, i) => (f === 'type' ? c.t : f === 'cond' ? condAt.get(c.cond)
    : f === 'sample' ? sampleAt.get(c.s) : extras[extraAt(f)].codes[i])
  const tally = new Map()
  d.cells.forEach((c, i) => {
    const key = `${rowFields.map(f => value(f, c, i)).join('|')}#${value(parts, c, i)}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  })
  return tally
}

/** Does compTable agree with the hand tally on every cell of every pairing? */
function everyPairing(d, types) {
  let wrong = 0
  let total = 0
  let pairings = 0
  let reported = 0
  for (const parts of compFields(d)) {
    for (const axis of rowAxes(d, parts)) {
      pairings++
      const t = compTable(d, types, parts, axis.fields)
      const want = naive(d, parts, axis.fields)
      let seen = 0
      t.rows.forEach((r, i) => {
        for (let p = 0; p < t.nParts; p++) {
          const c = t.counts[i * t.nParts + p]
          if (!c) continue
          seen++
          if (want.get(`${r.keys.join('|')}#${p}`) !== c) wrong++
        }
      })
      if (seen !== want.size) wrong++
      if (t.nCells !== d.cells.length) total++
      if (t.nSentinel !== 0) reported++
    }
  }
  return { wrong, total, pairings, reported }
}

const html = {}
for (const [label, opts] of [['with no sentinels field', { sentinels: undefined }],
  ['with an empty sentinels list', { sentinels: [] }]]) {
  console.log(`\nA BUNDLE ${label.toUpperCase()}`)
  const src = bundleSource(parseBundle(sentinelBundle(opts)))
  const d = src.d
  check('nothing is declared', src.meta.sentinels ?? 'no declared list on the source', [])
  check('no cluster is marked', src.types.map(t => !!t.sentinel), CLUSTERS.map(() => false))
  check('marking against an empty list hands back the very same types',
    S ? S.markSentinels(src.types, []) === src.types : 'src/lib/sentinels.ts is missing', true)

  const p = everyPairing(d, src.types)
  check(`all ${p.pairings} composition pairings match a hand tally of every cell`, p.wrong, 0)
  check('every cell is counted, EXCLUDED and UNRESOLVED as ordinary clusters', p.total, 0)
  check('and every pairing reports that it left nothing out', p.reported, 0)
  check('the per-sample fractions are over all of a sample\'s cells, as before',
    d.prop.map(row => row.map(v => +v.toFixed(12))),
    SAMPLES.map((_s, si) => CLUSTERS.map((_c, ci) => +(T[si][ci] / 25).toFixed(12))))

  const spec = markersSpec(src)
  check('the marker spec owns every cell', [spec.nUsed, [...spec.owner].every(o => o >= 0)], [N, true])
  const all = deMarkersAll(src)
  check('each cluster is tested against every other cell',
    all.map(r => [r.n1, r.n0]), CLUSTERS.map((_c, ci) => {
      const n = T.reduce((a, row) => a + row[ci], 0)
      return [n, N - n]
    }))

  // The rule the Cells tab has always drawn by: every cell, in the object's
  // order, in its cluster's palette colour, and every cluster named.
  if (!P) check('src/lib/embed-paint.ts paints the embedding', 'missing', 'present')
  else {
    const arcs = []
    const texts = []
    let pending = false
    const g = {
      canvas: { width: 800, height: 600 }, font: '600 20px system-ui', fillStyle: '', strokeStyle: '',
      lineWidth: 1, textAlign: 'left', fillRect() {}, beginPath() { pending = false }, arc() { pending = true },
      fill() { if (pending) arcs.push(this.fillStyle); pending = false },
      measureText(s) { return { width: s.length * 9 } }, strokeText() {}, fillText(s) { texts.push(s) },
    }
    P.paintEmbedding(g, {
      d, types: src.types, xy: src.embeddings[0].xy, cond: null, colorBy: 'type',
      palKey: 'npg', rampKey: 'blue', labels: true, ink: '#000', surface: '#fff', sunk: '#eee',
    })
    check('the embedding paints every cell in order, in its cluster\'s colour',
      arcs, d.cells.map(c => pal(c.t, 'npg')))
    check('and names every cluster it can place', texts.filter(s => CLUSTERS.includes(s)).length, CLUSTERS.length)
  }

  const cells = render(C.Cells, {
    src, types: src.types, emb: src.embeddings[0], colorBy: 'type', split: false,
    palKey: 'npg', rampKey: 'blue', onColorBy: () => {}, onSplit: () => {},
  })
  check('the embedding legend is every cluster, in its own colour',
    legendOf(cells), CLUSTERS.map((c, i) => [pal(i, 'npg'), c]))
  const comp = render(C.Composition, { d, types: src.types, palKey: 'npg' })
  check('so is the composition legend', legendOf(comp).slice(0, CLUSTERS.length).map(x => x[1]), CLUSTERS)
  const methods = render(C.Methods, {
    src, types: src.types, tis: [1], ctrl: ['a1'], cs: ['a2'], method: 'wilcox',
    padjMax: 0.05, lfcMin: 0.25, gates: DE_GATES, lib: null,
  })
  const overview = render(C.Overview, {
    src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {},
  })
  const markers = render(C.Markers, {
    src, types: src.types, palKey: 'npg', go: true, want: new Set(),
    onGo: () => {}, onWant: () => {}, onRename: () => {}, onPickGene: () => {},
  })
  check('Methods counts all five as populations', methods.includes('The 5 cell types'), true)
  check('and Markers tests all five',
    [...markers.matchAll(/aria-label="Rename cell type ([^"]*)"/g)].map(m => m[1]), CLUSTERS)
  html[label] = { cells, comp, methods, overview, markers }
}

console.log('\nNO FIELD AND AN EMPTY FIELD ARE THE SAME OBJECT')
{
  const [a, b] = Object.values(html)
  for (const k of Object.keys(a)) check(`${k}: the same markup, character for character`, a[k] === b[k], true)
}

console.log('\nA COLLECTION WITH NO SENTINELS')
{
  const blob = sentinelCollection({ sentinels: undefined })
  const coll = await openCollection(blob, await readCollectionIndex(blob))
  check('no cluster is marked', coll.types.map(t => !!t.sentinel), CLUSTERS.map(() => false))
  const p = everyPairing(coll.d, coll.types)
  check(`all ${p.pairings} pairings match the hand tally`, [p.wrong, p.total], [0, 0])
  check('and report nothing left out', p.reported, 0)
}

console.log(failed ? `\n${failed} FAILED` : '\nAll no-sentinel tests passed')
process.exit(failed ? 1 : 0)
