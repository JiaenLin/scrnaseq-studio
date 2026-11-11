// A category's name is never broken inside a word (src/lib/labels.ts;
// docs/DESIGN.md "Charts", Names under an axis).
//
// The defect this pins reached a reviewer twice: under the violin panel
// grouped "Cell type x group" the cell types read "Oligode / ndrocyt / e" and
// "Pericyt / e" (six names of nine at 1,280 px, three at 1,440), on screen and
// in the saved file, because the wrap cut a token that was wider than its
// block. The rule: fit; wrap at a space or at the punctuation of a compound
// name; turn the whole row; only where a box cannot grow, first letters and an
// ellipsis with the whole name in the element's title.

import fs from 'node:fs'
import { bandNames, bandNeed, textW, wrapAll, wrapWords } from '../src/lib/labels.ts'
import { FIG_TYPE } from '../src/lib/figure-ink.ts'

let failed = 0
const check = (name, got, want = true) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const DEMO = ['qNSC', 'aNSC', 'TAP', 'Neuroblast', 'Astrocyte', 'Oligodendrocyte', 'Microglia', 'Endothelial', 'Pericyte']
const REAL = [
  'Cardiomyocyte/Working cardiomyocyte', 'Cardiomyocyte/Working cardiomyocyte EXCLUDED', 'Immune|Myeloid',
  'Endothelial/Lymphatic', 'Smooth muscle cell', 'CD8+ T cell, effector memory', 'group_a1b1', 'Fibroblast-like',
  'GOBP_REGULATION_OF_CELL_POPULATION_PROLIFERATION', 'Negative regulation of transcription by rna polymerase ii',
  'Pneumonoultramicroscopicsilicovolcanoconiosis', 'x',
]
const BREAK = ' /|,_-'

/** The first line break that falls inside a word, or '' when every break is at a break point. */
const brokenInside = (name, lines) => {
  let at = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.endsWith('…')) {
      // The stated abbreviation: the first letters of one whole token, on a line of its own.
      const stem = line.slice(0, -1)
      if (!name.startsWith(stem, at)) return `"${line}" is not the start of a token of "${name}"`
      if (at > 0 && !BREAK.includes(name[at - 1])) return `"${line}" starts inside a word of "${name}"`
      let end = at
      while (end < name.length && !BREAK.includes(name[end])) end++
      at = Math.min(name.length, end + 1)
      while (name[at] === ' ') at++
      continue
    }
    if (!name.startsWith(line, at)) return `"${line}" is not the next part of "${name}"`
    at += line.length
    if (i < lines.length - 1) {
      if (!BREAK.includes(name[at - 1]) && name[at] !== ' ') return `"${line}" ends inside a word of "${name}"`
      while (name[at] === ' ') at++
    }
  }
  return at >= name.length ? '' : `"${name}" lost its end after "${lines.join(' / ')}"`
}

console.log('\nA NAME IS NEVER BROKEN INSIDE A WORD')
{
  const widths = []; for (let w = 14; w <= 420; w += 7) widths.push(w)
  const sizes = [[9.5, true], [10.5, false], [FIG_TYPE.name, true], [11.5, false]]
  const bad = { wrapAll: [], wrapWords: [], wide: [], lost: [] }
  let n = 0
  for (const name of [...DEMO, ...REAL]) for (const w of widths) for (const [px, bold] of sizes) {
    n++
    const all = wrapAll(name, w, px, bold)
    const b = brokenInside(name, all)
    if (b && bad.wrapAll.length < 4) bad.wrapAll.push(`${w}px: ${b}`)
    const words = wrapWords(name, w, px, bold)
    if (words) {
      const bw = brokenInside(name, words)
      if (bw || words.some(l => l.endsWith('…'))) bad.wrapWords.push(`${w}px: ${bw || 'shortened'}`)
      if (words.some(l => textW(l, px, bold) > w + 1e-6)) bad.wide.push(`${w}px: ${words.join(' / ')}`)
      if (words.join(' ').replace(/\s+/g, '') !== name.replace(/\s+/g, '')) bad.lost.push(name)
    }
  }
  check(`wrapAll breaks only at a space or a compound name's punctuation (${n} cases)`, bad.wrapAll, [])
  check('wrapWords breaks only there, and never shortens', bad.wrapWords.slice(0, 4), [])
  check('a line wrapWords returns fits the width it was given', bad.wide.slice(0, 4), [])
  check('wrapWords keeps every character of the name', bad.lost.slice(0, 4), [])
  check('the reviewer\'s case: "Oligodendrocyte" in a 45 px block is not cut by wrapWords', wrapWords('Oligodendrocyte', 45, 9.5, true), null)
  check('and wrapAll, where a box cannot grow, keeps its first letters and says so',
    wrapAll('Oligodendrocyte', 45, 9.5, true).every(l => l.endsWith('…') || l === 'Oligodendrocyte'), true)
  check('a compound name wraps at its slash', wrapAll('Cardiomyocyte/Working cardiomyocyte', 130, 11, true), ['Cardiomyocyte/', 'Working', 'cardiomyocyte'].reduce((a, p) => {
    // as many pieces to a line as fit 130 px at 11 px semibold (19 characters)
    const last = a[a.length - 1]
    if (last !== undefined && (last + (last.endsWith('/') ? '' : ' ') + p).length <= 19) a[a.length - 1] = last + (last.endsWith('/') ? '' : ' ') + p
    else a.push(p)
    return a
  }, []))
}

console.log('\nA ROW OF NAMES UNDER BANDS: UPRIGHT, WRAPPED, OR THE WHOLE ROW TURNED')
{
  const bad = { inside: [], wide: [], mixed: [] }
  let n = 0
  for (const names of [DEMO, REAL, [...DEMO, ...REAL]]) for (let band = 8; band <= 260; band += 3) {
    n++
    const b = bandNames(names, { band, leftAnchor: 44 + band / 2, px: FIG_TYPE.name, bold: true })
    if (b.rotate) {
      if (![42, 55, 72, 90].includes(b.deg) || !(b.bottom > 0)) bad.mixed.push(`${band}: ${JSON.stringify(b)}`)
      continue
    }
    names.forEach((name, i) => {
      const br = brokenInside(name, b.lines[i])
      if (br || b.lines[i].some(l => l.endsWith('…'))) bad.inside.push(`${band}px: ${br || 'shortened'}`)
      if (b.lines[i].some(l => textW(l, FIG_TYPE.name, true) > band)) bad.wide.push(`${band}px: ${b.lines[i].join(' / ')}`)
    })
  }
  check(`no name of a row is cut inside a word or shortened, at any band (${n} rows)`, bad.inside.slice(0, 4), [])
  check('an upright name stays inside its band', bad.wide.slice(0, 4), [])
  check('a turned row is turned whole, to one angle, with room reserved', bad.mixed.slice(0, 4), [])
  // The widths the reviewer measured: 18 violins in a 493 px and a 573 px panel.
  for (const [win, panel] of [[1280, 493], [1440, 573]]) {
    const block = ((panel - 44 - 8) / 18) * 2
    const b = bandNames(DEMO, { band: block, leftAnchor: 44 + block / 2, px: FIG_TYPE.name, bold: true })
    check(`nine cell types in the ${panel} px panel of a ${win} px window (${block.toFixed(0)} px blocks): the row is turned, not cut`, b.rotate, true)
  }
  const need = bandNeed(DEMO, FIG_TYPE.name, true)
  const at = bandNames(DEMO, { band: need, leftAnchor: 44 + need / 2, px: FIG_TYPE.name, bold: true })
  check('at the band bandNeed asks for, every name is upright on one line', [at.rotate, at.rotate ? 0 : Math.max(...at.lines.map(l => l.length))], [false, 1])
  check('and the panel that gives it fits a 1,280 px window\'s stage (1,000 px)', 44 + 8 + DEMO.length * need <= 1000, true)
  const two = bandNeed(REAL.slice(0, 4), FIG_TYPE.name, true, 2)
  const atTwo = bandNames(REAL.slice(0, 4), { band: two, leftAnchor: 44 + two / 2, px: FIG_TYPE.name, bold: true })
  check('compound names are given the band that holds them on two lines', [atTwo.rotate, atTwo.rotate ? 0 : Math.max(...atTwo.lines.map(l => l.length)) <= 2], [false, true])
  check('a category\'s name is set at the interface\'s floor, 11 px', FIG_TYPE.name, 11)
}

console.log('\nNO FIGURE CUTS A NAME BY ITS OWN ARITHMETIC')
{
  // A figure that draws names goes through lib/labels.ts; a hand-rolled
  // `slice` into lines is how the next one would be cut.
  const dir = new URL('../src/components/', import.meta.url)
  const files = [...fs.readdirSync(dir), ...fs.readdirSync(new URL('gene/', dir)).map(f => 'gene/' + f)].filter(f => f.endsWith('.tsx'))
  const own = files.filter(f => /for \(let i = 0; i < \w+\.length; i \+= \w+\) \w+\.push\(\w+\.slice\(i, i \+ \w+\)\)/.test(fs.readFileSync(new URL(f, dir), 'utf8')))
  check(`none of ${files.length} components chops a string into fixed-length lines`, own, [])
  const violin = fs.readFileSync(new URL('gene/ViolinPanel.tsx', dir), 'utf8')
  check('the grouped violin sets its cell types with bandNames', [/bandNames\(/.test(violin), /wrapAll\(/.test(violin)], [true, false])
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll name tests passed')
process.exit(failed ? 1 : 0)
