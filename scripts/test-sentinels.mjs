// A sentinel is a cell the annotator did not call, not a cell type.
//
// The annotator writes EXCLUDED and UNRESOLVED as label values, and the lab
// keeps those cells (they are real, and they are drawn) while listing the
// levels in `meta.sentinels`. The studio read them as two more clusters: they
// took a slice of every composition bar and of its denominator, a legend entry,
// a row in the marker plot, a place on both sides of every marker test, and a
// tick in the cell-type pickers. The single-cell profile's rule is the opposite
// (single-cell-harness docs/profiles/single-cell.md §4): never a population,
// never a denominator, never a legend entry as though it were one, never
// dropped, and how many there were is stated.
//
// Everything is checked against the generator's own truth table, not against
// "it rendered".

import { compFields, compTable, rowAxes } from '../src/lib/composition.ts'
import { bundleSource } from '../src/lib/source.ts'
import { parseBundle } from '../src/lib/bundle.ts'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'
import { scopeMask } from '../src/lib/correlate.ts'
import { withRoles } from '../src/lib/roles.ts'
import { pal } from '../src/lib/palette.ts'
import {
  DE_GATES, deMarkers, deMarkersAll, designFor, markersSpec, wilcoxSpec,
} from '../src/lib/stats.ts'
import {
  CLUSTERS, N, SAMPLES, SENTINELS, clusterOf, sampleOf, sentinelBundle, sentinelCollection, truth,
} from './fixture-sentinels.mjs'
import { loadComponents, render, textOf } from './render.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
/** A module this wave adds. Absent on an older tree, which is a failure, not a crash. */
const optional = async (path) => import(path).catch(() => null)
const S = await optional('../src/lib/sentinels.ts')
const P = await optional('../src/lib/embed-paint.ts')
const C = await loadComponents()

const SENT = new Set([0, 4]) // the sentinel cluster codes in CLUSTERS
const REAL = [1, 2, 3]
const T = truth()
const realOf = (si) => REAL.reduce((a, c) => a + T[si][c], 0)
const nSentinelCells = T.reduce((a, row) => a + row[0] + row[4], 0)
const nReal = N - nSentinelCells
const legendOf = (html) => [...html.matchAll(/<span><i class="sw" style="background:([^"]*)"><\/i>([^<]*)<\/span>/g)]
  .map(m => m[2])

const src = bundleSource(parseBundle(sentinelBundle()))
const d = src.d

console.log('\nTHE LAB\'S FIELD IS READ')
{
  check('the declared sentinels arrive in the source', src.meta.sentinels, SENTINELS)
  check('and mark exactly those cluster levels', src.types.map(t => !!t.sentinel),
    CLUSTERS.map((_c, i) => SENT.has(i)))
  check('the cells are all still there — a sentinel cell is a cell', d.cells.length, N)
  let refused = null
  try { parseBundle(sentinelBundle({ sentinels: 'EXCLUDED' })) } catch (e) { refused = e.message }
  check('a sentinels field that is not a list is refused, by name',
    refused !== null && /sentinels/.test(refused), true)
  const loose = bundleSource(parseBundle(sentinelBundle({ raw: ['EXCLUDED', 'NOT_A_LEVEL'] })))
  check('a declared name no cluster carries marks nothing and breaks nothing',
    [loose.meta.sentinels, loose.types.map(t => !!t.sentinel)],
    [['EXCLUDED'], [true, false, false, false, false]])
  check('the population names leave the sentinels out',
    S ? S.populationNames(src.types) : 'src/lib/sentinels.ts is missing', ['TypeA', 'TypeB', 'TypeC'])
}

console.log('\nCOMPOSITION: REAL TYPES ONLY, IN EVERY DENOMINATOR')
{
  let leaked = 0
  let wrongTotal = 0
  let unsummed = 0
  let pairings = 0
  for (const parts of compFields(d)) {
    for (const axis of rowAxes(d, parts)) {
      pairings++
      const t = compTable(d, src.types, parts, axis.fields)
      // A sentinel level never holds a count, as the bars or as a row.
      if (parts === 'type') for (const c of SENT) for (let r = 0; r < t.rows.length; r++) leaked += t.counts[r * t.nParts + c]
      axis.fields.forEach((f, j) => { if (f === 'type') for (const r of t.rows) if (SENT.has(r.keys[j])) leaked++ })
      if (t.nCells !== nReal || t.nSentinel !== nSentinelCells) wrongTotal++
      for (let r = 0; r < t.rows.length; r++) {
        let s = 0
        for (let p = 0; p < t.nParts; p++) s += t.counts[r * t.nParts + p] / t.rows[r].n
        if (Math.abs(s - 1) > 1e-12) unsummed++
      }
    }
  }
  check(`no sentinel cell is counted in any of the ${pairings} pairings`, leaked, 0)
  check('every pairing counts the typed cells and states how many were left out', wrongTotal, 0)
  check('every row\'s fractions add up to one', unsummed, 0)

  // The figure the tab opens on: cell types, one bar per sample.
  const t = compTable(d, src.types, 'type', ['sample'])
  check('each sample\'s bar is its own typed cells, against the truth table',
    t.rows.map(r => [r.keys[0], r.n, REAL.map(c => t.counts[t.rows.indexOf(r) * t.nParts + c])]),
    SAMPLES.map((_s, si) => [si, realOf(si), REAL.map(c => T[si][c])]))
  check('the per-sample fractions (d.prop) leave the sentinels out of the denominator',
    d.prop.map(row => row.map(v => +v.toFixed(12))),
    SAMPLES.map((_s, si) => CLUSTERS.map((_c, ci) => (SENT.has(ci) ? 0 : +(T[si][ci] / realOf(si)).toFixed(12)))))
  check('and so each sample still sums to one',
    d.prop.map(row => +row.reduce((a, b) => a + b, 0).toFixed(12)), SAMPLES.map(() => 1))
}

console.log('\nLEGENDS: NO SENTINEL IS A LEGEND ENTRY')
{
  const cells = (colorBy) => render(C.Cells, {
    src, types: src.types, emb: src.embeddings[0], colorBy, split: false,
    palKey: 'npg', rampKey: 'blue', onColorBy: () => {}, onSplit: () => {},
  })
  const byType = cells('type')
  check('the embedding\'s cell-type legend lists the three types', legendOf(byType), ['TypeA', 'TypeB', 'TypeC'])
  check('and its colours are the types\' own, unchanged by the sentinels around them',
    [...byType.matchAll(/<span><i class="sw" style="background:([^"]*)"><\/i>/g)].map(m => m[1]),
    REAL.map(c => pal(c, 'npg')))
  const said = textOf(byType)
  check('it says how many cells are drawn grey, and why',
    said.includes(`${nSentinelCells} cells`) && /grey/i.test(said) && said.includes('EXCLUDED'), true)
  check('colouring by group is untouched: the groups are the legend',
    legendOf(cells('cond')), ['a1', 'a2'])

  const comp = render(C.Composition, { d, types: src.types, palKey: 'npg' })
  check('the composition legend lists the three types', legendOf(comp).slice(0, 3), ['TypeA', 'TypeB', 'TypeC'])
  check('and nothing else that is a cell type', legendOf(comp).filter(l => CLUSTERS.includes(l)),
    ['TypeA', 'TypeB', 'TypeC'])
  check('no stacked segment is a sentinel',
    [...comp.matchAll(/<title>(EXCLUDED|UNRESOLVED) — /g)].length, 0)
  check('no per-cell-type panel is drawn for a sentinel',
    [...comp.matchAll(/aria-label="([^"]*) proportion by group"/g)].map(m => m[1]), ['TypeA', 'TypeB', 'TypeC'])
  check('the figure states how many cells it left out',
    new RegExp(`${nSentinelCells} [^.·]*left out`).test(textOf(comp)), true)
}

console.log('\nMARKERS: SENTINEL CELLS ARE ON NEITHER SIDE OF ANY TEST')
{
  const spec = markersSpec(src)
  const sentCells = d.cells.map((c, i) => (SENT.has(c.t) ? i : -1)).filter(i => i >= 0)
  check('no sentinel cell is owned by a population', sentCells.filter(i => spec.owner[i] !== -1).length, 0)
  check('so the comparisons are over the typed cells only', spec.nUsed, nReal)
  check('and no sentinel level is a population to test', [...spec.want], CLUSTERS.map((_c, i) => (SENT.has(i) ? 0 : 1)))

  const all = deMarkersAll(src)
  const nType = (c) => T.reduce((a, row) => a + row[c], 0)
  check('each type is tested against the other TYPED cells',
    REAL.map(c => [all[c].n1, all[c].n0]), REAL.map(c => [nType(c), nReal - nType(c)]))
  check('a sentinel has no result of its own', [...SENT].map(c => all[c].rows.length), [0, 0])
  // Gene04 is expressed only by EXCLUDED cells. Only a comparison that let them
  // in could report it, as anybody's marker or anybody's absence.
  check('the gene only sentinel cells express is nobody\'s marker',
    REAL.filter(c => all[c].rows.some(r => r.gene === 'Gene04')).length, 0)
  check('the per-cluster reference agrees on the populations',
    REAL.map(c => { const r = deMarkers(src, c); return [r.n1, r.n0] }), REAL.map(c => [nType(c), nReal - nType(c)]))

  const props = (go) => ({
    src, types: src.types, palKey: 'npg', go, want: new Set(),
    onGo: () => {}, onWant: () => {}, onRename: () => {}, onPickGene: () => {},
  })
  const before = render(C.Markers, props(false))
  check('the picker offers the three types', [...before.matchAll(/truncate tx-micro">([^<]*)</g)].map(m => m[1]),
    ['TypeA', 'TypeB', 'TypeC'])
  check('and the button counts them', textOf(before).includes('Find markers for all 3'), true)
  const after = render(C.Markers, props(true))
  check('the finished plot has a row, and a rename box, for each type and no other',
    [...after.matchAll(/aria-label="Rename cell type ([^"]*)"/g)].map(m => m[1]), ['TypeA', 'TypeB', 'TypeC'])
  check('and says how many types it covers', /across 3 of 3 cell types/.test(textOf(after)), true)
}

console.log('\nDIFFERENTIAL EXPRESSION AND SCOPES: TYPES ONLY')
{
  const [a1, a2] = ['a1', 'a2']
  const typeA = d.cells.filter(c => c.t === 1).length
  const w = wilcoxSpec(src, [0, 1], [a1], [a2], DE_GATES)
  check('a contrast handed a sentinel index still compares TypeA\'s cells only', w.n1 + w.n2, typeA)
  const design = designFor(src, [0], [a1], [a2])
  check('a sentinel contributes no sample to a pseudobulk design', design.used.map(s => s.n), [0, 0, 0, 0])
  const keep = scopeMask(src, null, null)
  check('"every cell type" as a co-expression scope means the typed cells',
    keep.reduce((a, b) => a + b, 0), nReal)

  const methods = textOf(render(C.Methods, {
    src, types: src.types, tis: [1], ctrl: [a1], cs: [a2], method: 'wilcox',
    padjMax: 0.05, lfcMin: 0.25, gates: DE_GATES, lib: null,
  }))
  check('Methods counts three populations', methods.includes('The 3 cell types'), true)
  check('and reports them as the three types', methods.includes('reported as TypeA, TypeB, TypeC.'), true)
  check('and says what the sentinel cells were, and what was done with them',
    methods.includes(`${nSentinelCells} cells`) && methods.includes('EXCLUDED') && /not a (cell type|population)/.test(methods), true)

  const over = textOf(render(C.Overview, {
    src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {},
  }))
  check('Overview counts the three types as the clusters', /\b3\s*clusters\b/.test(over), true)
  check('and states the sentinel cells', over.includes(`EXCLUDED ${T.reduce((a, r) => a + r[0], 0)}`), true)
}

console.log('\nTHE EMBEDDING DRAWS SENTINEL CELLS GREY, UNDER THE TYPES')
{
  /** A 2-D context that remembers what was drawn, in order. */
  const recorder = () => {
    const arcs = []
    const texts = []
    let pending = false
    const g = {
      canvas: { width: 800, height: 600 }, font: '600 20px system-ui', fillStyle: '', strokeStyle: '',
      lineWidth: 1, textAlign: 'left',
      fillRect() {}, beginPath() { pending = false }, arc() { pending = true },
      fill() { if (pending) arcs.push(this.fillStyle); pending = false },
      measureText(s) { return { width: s.length * 9 } }, strokeText() {}, fillText(s) { texts.push(s) },
    }
    return { g, arcs, texts }
  }
  if (!P) {
    check('src/lib/embed-paint.ts paints the embedding', 'missing', 'present')
  } else {
    const r = recorder()
    P.paintEmbedding(r.g, {
      d, types: src.types, xy: src.embeddings[0].xy, cond: null, colorBy: 'type',
      palKey: 'npg', rampKey: 'blue', labels: true, ink: '#000', surface: '#fff', sunk: '#eee',
    })
    const sentinelIdx = d.cells.map((c, i) => (SENT.has(c.t) ? i : -1)).filter(i => i >= 0)
    const typedIdx = d.cells.map((c, i) => (SENT.has(c.t) ? -1 : i)).filter(i => i >= 0)
    check('every cell is drawn once', r.arcs.length, N)
    check('the sentinel cells first, all of them grey',
      r.arcs.slice(0, sentinelIdx.length), sentinelIdx.map(() => S?.SENTINEL_GREY ?? 'grey'))
    check('then every typed cell in its type\'s colour',
      r.arcs.slice(sentinelIdx.length), typedIdx.map(i => pal(d.cells[i].t, 'npg')))
    check('no cluster name is written on the plate for a sentinel',
      r.texts.filter(s => SENTINELS.includes(s)), [])
    check('the types are named', r.texts.filter(s => s.startsWith('Type')).length > 0, true)

    const byGroup = recorder()
    P.paintEmbedding(byGroup.g, {
      d, types: src.types, xy: src.embeddings[0].xy, cond: null, colorBy: 'cond',
      palKey: 'npg', rampKey: 'blue', labels: false, ink: '#000', surface: '#fff', sunk: '#eee',
    })
    check('coloured by group, a sentinel cell is its group\'s colour, in file order',
      byGroup.arcs, d.cells.map(c => pal(d.conds.indexOf(c.cond), 'npg')))
  }
}

console.log('\nA COLLECTION CARRIES THEM TOO')
{
  const blob = sentinelCollection()
  const coll = await openCollection(blob, await readCollectionIndex(blob))
  check('the index\'s list arrives', coll.meta.sentinels, SENTINELS)
  check('and marks the same levels of the merged object',
    coll.types.map(t => [t.name, !!t.sentinel]), CLUSTERS.map((c, i) => [c, SENT.has(i)]))
  const t = compTable(coll.d, coll.types, 'type', ['sample'])
  check('composition counts the typed cells, over both parts', [t.nCells, t.nSentinel], [nReal, nSentinelCells])
  check('the marker spec leaves the same cells out', markersSpec(coll).nUsed, nReal)
}

console.log('\nRE-POINTING THE CELL TYPE KEEPS THE RULE')
{
  // The coarse column names the same uncalled cells with the same words.
  const coarse = withRoles(src, 0, -1)
  check('a carried column with the same sentinel levels marks them',
    coarse.types.map(t => [t.name, !!t.sentinel]),
    [['Lineage1', false], ['Lineage2', false], ['EXCLUDED', true], ['UNRESOLVED', true]])
  const t = compTable(coarse.src.d, coarse.types, 'type', ['sample'])
  check('and its composition leaves them out as well', [t.nCells, t.nSentinel], [nReal, nSentinelCells])
  check('with each sample summing to one over the lineages',
    coarse.src.d.prop.map(row => +row.reduce((a, b) => a + b, 0).toFixed(12)), SAMPLES.map(() => 1))
  const back = withRoles(src, -1, -1)
  check('pointing back gives the object\'s own marked types', back.types.map(x => !!x.sentinel),
    CLUSTERS.map((_c, i) => SENT.has(i)))
}

// The truth table is the generator's, so a fixture edit cannot quietly agree with itself.
check('the fixture still has sentinel cells in every sample', T.map(row => row[0] + row[4] > 0), SAMPLES.map(() => true))
check('and they sit where the generator put them', d.cells.map(c => SENT.has(c.t)),
  Array.from({ length: N }, (_x, i) => SENT.has(clusterOf(i))))
void sampleOf

console.log(failed ? `\n${failed} FAILED` : '\nAll sentinel tests passed')
process.exit(failed ? 1 : 0)
