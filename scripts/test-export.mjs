// What a Save writes, and in what ink (src/lib/figure-pick.ts, lib/download.ts,
// lib/palette.ts, src/index.css; docs/DESIGN.md "Charts", Save and Figure ink).
//
// What this pins, each from a defect that reached a reviewer:
//   - the drawing a figure saves is its own, never an icon or a glyph in its
//     box (Cells saved its axis glyph: four states, one byte-identical file;
//     every corner Save wrote its own download icon);
//   - a figure is read for export with every token at its light value and
//     nothing in transition (figures saved from the dark theme kept light ink
//     on a white page);
//   - a colour that is blended is a literal (a custom property handed to
//     `mix` drew a legend as a flat black bar);
//   - on the dark ground a scale starts at the ground and rises, so absence
//     is never the brightest thing on screen;
//   - a label on a filled mark reads on that fill; a PNG says its resolution.
//
// The parts that need a browser (the files themselves, opened and measured in
// both themes) are scripts/test-export-browser.mjs: `npm run test:export`.

import fs from 'node:fs'
import zlib from 'node:zlib'
import { figureSvg, isDrawing, sheetSvgs } from '../src/lib/figure-pick.ts'
import {
  MIN_PRINT_PT, PRINT_PX_PER_IN, atPrintSize, pngWithDpi, printSize, scaleForDpi, FIGURE_INCHES, SHEET_INCHES,
} from '../src/lib/download.ts'
import { FIG_TYPE } from '../src/lib/figure-ink.ts'
import {
  DIVERGING, PALETTES, RAMPS, SEQUENTIAL, ZERO_ON_DARK, inkOn, mix, pal, rampColor,
} from '../src/lib/palette.ts'

let failed = 0
const check = (name, got, want = true) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

// The least of a DOM: a node knows its attributes and its ancestors.
const node = (tag, attrs = {}, kids = []) => {
  const n = { tag, attrs, kids, parent: null }
  for (const k of kids) k.parent = n
  n.getAttribute = a => (a in attrs ? attrs[a] : null)
  const is = (e, sel) => sel.split(',').map(s => s.trim()).some(s =>
    s.startsWith('.') ? (e.attrs.class ?? '').split(' ').includes(s.slice(1))
      : s.startsWith('[') ? e.attrs.role === s.match(/"(.*)"/)[1] : e.tag === s)
  n.closest = sel => { for (let e = n; e; e = e.parent) if (is(e, sel)) return e; return null }
  n.querySelectorAll = t => { const out = []; const walk = e => { for (const k of e.kids) { if (k.tag === t) out.push(k); walk(k) } }; walk(n); return out }
  return n
}
const icon = () => node('svg', { class: 'ico', 'aria-hidden': 'true' })

console.log('\nTHE DRAWING A FIGURE SAVES IS ITS OWN')
{
  // Cells: an axis glyph beside the canvases, in the figure's box.
  const glyph = node('svg', { 'aria-hidden': 'true' })
  const cells = node('div', {}, [node('canvas'), glyph, node('canvas')])
  check('Cells: the axis glyph is not the figure', figureSvg(cells, true), null)
  check('Cells: nor is it without a painter', figureSvg(cells), null)
  // A panel of a small multiple: its corner Save holds the drawn icon, first in the box.
  const drawing = node('svg', { role: 'img' })
  const corner = node('div', { class: 'fig-corner' }, [node('button', {}, [icon()])])
  const panel = node('div', {}, [corner, drawing])
  check('a corner Save: the icon is skipped, the drawing is saved', figureSvg(panel) === drawing)
  check('an icon is not a drawing', isDrawing(icon()), false)
  check('a drawing inside a control is not the figure', isDrawing(node('svg', {}, [])) && !isDrawing(corner.kids[0].kids[0]))
  check('a canvas panel with a corner Save has no SVG to save', figureSvg(node('div', {}, [corner, node('canvas')])), null)
  // A sheet: every panel's drawing and none of the icons.
  const p2 = node('div', {}, [node('div', { class: 'fig-corner' }, [node('button', {}, [icon()])]), node('svg', { role: 'img' })])
  const sheet = node('div', {}, [panel, p2])
  check('a sheet holds the drawings only', sheetSvgs(sheet).map(s => s.attrs.role), ['img', 'img'])
  check('nothing to save where there is no box', [figureSvg(null), sheetSvgs(null)], [null, []])
}

console.log('\nA FIGURE IS READ FOR EXPORT IN PRINT INK')
{
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)')
  const dark = css.slice(darkAt, css.indexOf('\n}\n', darkAt))
  check('the dark theme sits on a root that is not stamped light',
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{/.test(css))
  check('no second, partial list of light tokens to fall behind', /:root\[data-theme='light'\]\s*\{/.test(css), false)
  const figs = t => [...new Set(t.match(/--fig-[\w-]+(?=:)/g) ?? [])].sort()
  check('every figure ink has a value on both grounds', figs(dark), figs(light))
  check('there is figure ink to speak of', figs(light).length >= 6)
  check('nothing is in transition while a figure is read',
    /:root\[data-exporting\] \*[^{]*\{\s*transition: none !important;/.test(css))
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)')).replace(/\/\*[\s\S]*?\*\//g, '')
  check('reduced motion gives no element a transition it did not declare',
    /transition-duration:[^;]*!important/.test(reduced), false)
  const dl = fs.readFileSync(new URL('../src/lib/download.ts', import.meta.url), 'utf8')
  const f = dl.slice(dl.indexOf('function forceLightFigures'), dl.indexOf('function portableSvg'))
  check('export turns transitions off before it stamps the theme',
    f.indexOf("setAttribute('data-exporting'") > 0 && f.indexOf("setAttribute('data-exporting'") < f.indexOf("setAttribute('data-theme', 'light')"))
  check('a gradient stop keeps its colour in the file', dl.includes("getPropertyValue('stop-color')"))
}

console.log('\nA COLOUR THAT IS BLENDED IS A LITERAL')
{
  let threw = ''
  try { mix('#E2E5EA', 'var(--fig-label)', 0.5) } catch (e) { threw = e.constructor.name }
  check('a custom property handed to mix is refused, not drawn as black', threw, 'TypeError')
  check('two literals blend', mix('#000000', '#ffffff', 0.5), 'rgb(128,128,128)')
  // No figure hands a custom-property ink to a blend or to a colour bar's ends.
  const VARS = ['AXIS_INK', 'GRID_INK', 'SUMMARY_INK', 'PLATE', 'LABEL_INK']
  const bad = []
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = `${d}/${e.name}`
    if (e.isDirectory()) return walk(p)
    if (!/\.tsx?$/.test(e.name)) return
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(/(?:\bmix(?:Hex)?\(|[cC]olors=\{\[)([^)\]]*)/)
      if (m && VARS.some(v => new RegExp(`\\b${v}\\b`).test(m[1]))) bad.push(`${p.split('/src/')[1]}:${i + 1}`)
    })
  })
  walk(new URL('../src', import.meta.url).pathname)
  check('no source line blends a custom-property ink', bad, [])
}

console.log('\nON THE DARK GROUND A SCALE STARTS AT THE GROUND')
{
  const rgb = c => c.match(/\d+/g).map(Number)
  const lum = c => { const [r, g, b] = rgb(c).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const zero = lum(mix(ZERO_ON_DARK, ZERO_ON_DARK, 0))
  for (const key of SEQUENTIAL) {
    const steps = Array.from({ length: 21 }, (_v, i) => lum(rampColor(i / 20, key, 'dark')))
    check(`${key}: nothing is expressed, nothing is bright`, rampColor(0, key, 'dark'), mix(ZERO_ON_DARK, ZERO_ON_DARK, 0))
    check(`${key}: lighter as the value rises`, steps.every((v, i) => i === 0 || v >= steps[i - 1] - 0.004))
    check(`${key}: the top is the lightest value, well clear of the ground`, steps[20] > 0.25 && steps[20] > 4 * zero)
    check(`${key}: on white it is the scale as defined`, [rampColor(0, key), rampColor(1, key)],
      [mix(RAMPS[key].cols[0], RAMPS[key].cols[0], 0), mix(RAMPS[key].cols.at(-1), RAMPS[key].cols.at(-1), 0)])
  }
  for (const key of DIVERGING) {
    check(`${key}: the neutral middle is the ground's grey, not white`, rampColor(0.5, key, 'dark'), mix(ZERO_ON_DARK, ZERO_ON_DARK, 0))
    check(`${key}: both ends are lighter than the middle`, lum(rampColor(0, key, 'dark')) > 2 * zero && lum(rampColor(1, key, 'dark')) > 2 * zero)
  }
}

console.log('\nA LABEL ON A FILL READS ON THAT FILL')
{
  const L = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const key of Object.keys(PALETTES)) {
    const worst = Math.min(...PALETTES[key].cols.map(c => ratio(inkOn(c), c)))
    check(`${key}: the label ink is at least 4.5:1 on every colour`, worst >= 4.5)
  }
  check('past the palette too', Array.from({ length: 12 }, (_v, i) => ratio(inkOn(pal(10 + i, 'studio')), pal(10 + i, 'studio')) >= 4.5).every(Boolean))
}

console.log('\nA PNG SAYS ITS RESOLUTION')
{
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8)
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length)
    return b
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])
  const out = Buffer.from(pngWithDpi(new Uint8Array(png), 300))
  const at = out.indexOf('pHYs')
  check('pHYs follows the header', at, 8 + 25 + 4)
  check('300 dpi is 11,811 pixels per metre, both ways, in metres', [out.readUInt32BE(at + 4), out.readUInt32BE(at + 8), out[at + 12]], [11811, 11811, 1])
  check('the chunk checks', out.readUInt32BE(at + 13), zlib.crc32(out.subarray(at, at + 13)))
  check('the rest of the file is untouched', Buffer.concat([out.subarray(0, 33), out.subarray(33 + 21)]).equals(png))
  check('not a PNG, not touched', Buffer.from(pngWithDpi(new Uint8Array([1, 2, 3]), 300)).equals(Buffer.from([1, 2, 3])))
  check('one column is 3.5 in, a sheet 7: 300 dpi is 1,050 and 2,100 px',
    [Math.round(500 * scaleForDpi(500, 300)), Math.round(500 * scaleForDpi(500, 300, SHEET_INCHES)), FIGURE_INCHES], [1050, 2100, 3.5])
}

console.log('\nA SAVED FIGURE IS THE WIDTH ITS MENU SAYS, AND ITS TYPE IS IN PRINT RANGE')
{
  // Every figure was saved "3.5 in wide" whatever its drawn width: true only
  // at one window (Markers' file was 3.80 in at 1,440 px, a Cells panel
  // 3.69), with type from 2.3 pt (Markers) to 12.6 pt (a Composition panel).
  const px = []; for (let w = 120; w <= 2600; w += 1) px.push(w)
  const sizes = px.map(w => ({ w, ...printSize(w) }))
  const pt = (s, type) => (type * 72 * s.inches) / s.w
  check('the width is a multiple of 0.1 in at every drawn width', sizes.filter(s => Math.abs(s.inches * 10 - Math.round(s.inches * 10)) > 1e-9).length, 0)
  check('at 300 and at 600 dpi the file is that width to the pixel',
    sizes.filter(s => [300, 600].some(dpi => Math.round(s.w * scaleForDpi(s.w, dpi, s.inches)) !== Math.round(s.inches * dpi))).length, 0)
  check('no floor on the scale: a 1,139 px drawing at "3.5 in" is 1,050 px, not 1,139', Math.round(1139 * scaleForDpi(1139, 300)), 1050)
  check(`the smallest figure type (${FIG_TYPE.tick} px) never prints under ${MIN_PRINT_PT} pt`, sizes.filter(s => pt(s, FIG_TYPE.tick) < MIN_PRINT_PT - 1e-9).map(s => s.w).slice(0, 5), [])
  check('and a figure title (13 px) never over 8.5 pt', sizes.filter(s => pt(s, 13) > 8.5).map(s => s.w).slice(0, 5), [])
  check('up to two columns a figure is its own width at 120 px to the inch', [420, 493, 573, 760, 840].map(w => printSize(w).inches), [3.5, 4.1, 4.8, 6.3, 7])
  check('420 px is one column and 840 px two', [printSize(420).fits, printSize(421).fits === 'one', printSize(840).fits, PRINT_PX_PER_IN], ['one', true, 'two', 120])
  check('past two columns it stays at 7 in while its type holds 5 pt (to 1,058 px)', [900, 1000, 1058].map(w => [printSize(w).inches, printSize(w).fits]), [[7, 'two'], [7, 'two'], [7, 'two']])
  check('wider still it keeps 5 pt and says it is wider than two columns', [1139, 1182].map(w => [printSize(w).inches, printSize(w).fits, printSize(w).pt]), [[7.6, 'wider', 5], [7.9, 'wider', 5.1]])
  check('the stated type size is the size the scale gives', sizes.filter(s => Math.abs(s.pt - pt(s, FIG_TYPE.tick)) > 0.051).length, 0)
  check('the width does not depend on the window, only on the drawing (the function takes nothing else)', printSize.length, 1)
  const xml = '<svg viewBox="0 0 760 280" width="760" height="280" xmlns="http://www.w3.org/2000/svg"><svg x="1" width="5" height="5"/></svg>'
  check('the vector file carries the same width, in inches, on its root only',
    atPrintSize({ xml, w: 760, h: 280 }), '<svg viewBox="0 0 760 280" width="6.3in" height="2.321in" xmlns="http://www.w3.org/2000/svg"><svg x="1" width="5" height="5"/></svg>')
  const fig = fs.readFileSync(new URL('../src/components/Figure.tsx', import.meta.url), 'utf8')
  check('the menu and the file read one function, and no figure passes a width of its own',
    [/setSize\(printSize\(drawnPx\(\)\)\)/.test(fig), /scaleForDpi\(shown, kind, printSize\(shown\)\.inches\)/.test(fig), /inches\??:/.test(fig), /FIGURE_INCHES|SHEET_INCHES/.test(fig)], [true, true, false, false])
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll export tests passed')
process.exit(failed ? 1 : 0)
