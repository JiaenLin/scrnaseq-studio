// Every Save, in both themes, opened and measured: the file holds the figure's
// marks, in print ink on white, and is the same file from either theme.
//
//   CHROME=<a Chrome or Chromium binary> node scripts/test-export-browser.mjs <url> [out-dir]
//
// Needs a browser and `playwright-core` on the module path, like
// scripts/shot-design.mjs, so it is `npm run test:export` and not part of
// `npm test`; scripts/test-export.mjs holds the rules that need neither.
// Synthetic demo only. Reduced motion is on, which is where figures saved
// from the dark theme kept the dark theme's ink.
//
// What it would have caught: Cells saving its axis glyph (four states, one
// byte-identical 1,050 x 420 file), every corner Save writing its own download
// icon (1,050 x 1,050), figures saved from dark with white text on white, and
// a legend whose gradient was one flat colour.

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const [url = 'http://localhost:4173', out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-export-'))] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
let failed = 0, passed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true })
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const DARK_INK = /rgb\(231, 233, 236\)|rgb\(176, 182, 192\)|rgb\(196, 201, 209\)|rgb\(138, 145, 157\)|#e7e9ec/gi

const probe = await (await browser.newContext()).newPage()
await probe.goto('about:blank')
/** A PNG's facts, read from its pixels. */
const pixels = file => probe.evaluate(async b64 => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d'); g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let white = 0, ink = 0, colour = 0
  const hues = new Set(), corner = [d[0], d[1], d[2]]
  for (let i = 0; i < d.length; i += 4) {
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2])
    if (mn > 250) white++
    else if (mx < 90) ink++
    else if (mx - mn > 60) { colour++; hues.add(((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5)) }
  }
  const n = d.length / 4
  return { w: img.width, h: img.height, white: white / n, ink: ink / n, colour: colour / n, hues: hues.size, corner }
}, fs.readFileSync(file).toString('base64'))

/** What every saved figure must be. `marks` is the least it must hold. */
async function judge(tag, file, { marks = 1, texts = 1, hues = 1, dpi } = {}) {
  if (file.endsWith('.svg')) {
    const x = fs.readFileSync(file, 'utf8')
    const n = t => (x.match(new RegExp('<' + t + '[ >]', 'g')) || []).length
    const drawn = n('circle') + n('rect') + n('path') + n('line')
    check(`${tag}: the file holds the figure's marks (${drawn} marks, ${n('text')} texts)`, drawn >= marks && n('text') >= texts, `marks ${drawn} < ${marks} or texts ${n('text')} < ${texts}`)
    check(`${tag}: no ink of the dark theme, no unresolved colour`, !(x.match(DARK_INK) || []).length && !x.includes('var(') && !x.includes('NaN'),
      `dark ink ${(x.match(DARK_INK) || []).length}, var( ${x.includes('var(')}, NaN ${x.includes('NaN')}`)
    const stops = [...x.matchAll(/<stop[^>]*stop-color[:=]"?\s*([^";>]+)/g)].map(m => m[1].trim())
    if (stops.length) check(`${tag}: a colour legend runs through colours (${new Set(stops).size} of ${stops.length} stops)`, new Set(stops).size > stops.length / 2, stops.slice(0, 3).join(' '))
    return
  }
  const buf = fs.readFileSync(file), at = buf.indexOf('pHYs')
  const p = await pixels(file)
  check(`${tag}: a figure, not an icon (${p.w} x ${p.h}; ${(p.ink * 100).toFixed(2)}% ink, ${p.hues} hues)`,
    p.w >= 1000 && p.h >= 200 && p.ink > 0.0005 && p.hues >= hues && p.white < 0.985, JSON.stringify(p))
  // The ink itself is judged on the SVG (no colour of the dark theme in the
  // file) and by the last block (the same bytes from either theme): a PNG of
  // a figure with grid lines and pale marks has light grey of its own.
  check(`${tag}: on a white page`, p.corner.every(v => v > 250) && p.white > 0.3, JSON.stringify(p))
  if (dpi) check(`${tag}: the file says ${dpi} dpi`, at > 0 && Math.round(buf.readUInt32BE(at + 4) * 0.0254) === dpi, `pHYs at ${at}`)
}

const files = { light: {}, dark: {} }
for (const theme of ['light', 'dark']) {
  console.log(`\n${theme.toUpperCase()} THEME`)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, reducedMotion: 'reduce', acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const settle = async (ms = 500) => { await page.waitForTimeout(ms); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))) }
  const tab = async name => { await page.getByRole('tab', { name, exact: true }).click(); await settle(700) }
  const save = async (tag, trigger, item, want) => {
    try {
      await trigger.scrollIntoViewIfNeeded(); await trigger.hover(); await trigger.click(); await settle(300)
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.locator('[role="menu"] [role="menuitem"]', { hasText: item }).first().click(),
      ])
      const to = path.join(out, `${theme}__${tag}__${dl.suggestedFilename()}`)
      await dl.saveAs(to); await settle(250)
      files[theme][tag] = to
      await judge(tag, to, want)
    } catch (e) { check(`${tag}: saved`, false, e.message.split('\n')[0]) }
  }
  const head = () => page.locator('main .stage-actions button[aria-haspopup="menu"]').first()
  const corner = () => page.locator('main .fig-corner-btn').first()

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByText('Replicated cohort', { exact: true }).click()
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 }); await settle(800)

  // Cells: a canvas figure with an axis glyph beside it. Four states, four figures.
  await tab('Cells')
  await save('cells split', head(), '300', { hues: 20, dpi: 300 })
  await page.locator('aside.rail button.opt', { hasText: 'Split by group' }).click(); await settle(400)
  await save('cells one panel', head(), '300', { hues: 20, dpi: 300 })
  await save('cells one panel 600', head(), '600', { hues: 20, dpi: 600 })
  await page.locator('aside.rail button.opt', { hasText: '% mito' }).click(); await settle(400)
  await save('cells by mito', head(), '300', { hues: 2, dpi: 300 })
  await page.locator('aside.rail button.opt', { hasText: 'Cell type' }).click(); await settle(300)
  await page.locator('aside.inspector button.lg-row').nth(2).click(); await settle(300)
  await save('cells one entry isolated', head(), '300', { hues: 2, dpi: 300 })
  await page.keyboard.press('Escape')
  const four = ['cells split', 'cells one panel', 'cells by mito', 'cells one entry isolated'].map(t => files[theme][t]).filter(Boolean).map(md5)
  check('cells: four states are four different files', new Set(four).size === 4, four.join(' '))

  await tab('Composition')
  await save('composition bars png', head(), '300', { hues: 20, dpi: 300 })
  await save('composition bars svg', head(), 'SVG', { marks: 40, texts: 20 })
  const all = page.locator('main button[aria-haspopup="menu"]', { hasText: 'Save all panels' }).first()
  await save('composition sheet svg', all, 'SVG', { marks: 60, texts: 30 })
  await save('composition sheet png', all, '300', { hues: 2, dpi: 300 })
  await save('composition corner png', corner(), '300', { hues: 1, dpi: 300 })
  await save('composition corner svg', corner(), 'SVG', { marks: 5, texts: 4 })

  await tab('Markers')
  await page.waitForSelector('main svg[role="img"]', { timeout: 120_000 }); await settle(800)
  await save('markers png', head(), '300', { hues: 20, dpi: 300 })
  await save('markers svg', head(), 'SVG', { marks: 200, texts: 50 })

  await tab('Differential expression')
  const pickers = page.locator('aside.rail > .rail-group button[aria-haspopup="listbox"]')
  for (let i = 0; i < await pickers.count(); i++) {
    await pickers.nth(i).click(); await settle(300)
    await page.locator('[role="option"]:not([disabled])').first().click()
    await page.keyboard.press('Escape'); await settle(300)
  }
  const run = page.getByRole('button', { name: 'Run', exact: true })
  if (await run.count()) await run.click()
  await page.waitForSelector('main table', { timeout: 180_000 }); await settle(800)
  await page.getByRole('button', { name: 'Volcano', exact: true }).first().click(); await settle(2000)
  await save('volcano png', head(), '300', { hues: 2, dpi: 300 })
  await save('volcano svg', head(), 'SVG', { marks: 60, texts: 12 })
  await page.getByRole('button', { name: 'Enrichment', exact: true }).first().click(); await settle(2500)
  const enr = page.locator('main button[aria-haspopup="menu"]').first()
  if (await enr.count()) { await save('enrichment png', enr, '300', { hues: 1, dpi: 300 }); await save('enrichment svg', enr, 'SVG', { marks: 4, texts: 6 }) }

  await tab('Gene expression')
  const q = page.locator('input[aria-label="Search a gene or paste a gene list"]')
  await q.fill('Gfap, Ascl1, Mki67, Dcx, Plp1, Cx3cr1'); await q.press('Enter'); await settle(2500)
  await page.getByRole('button', { name: 'Violin panel', exact: true }).first().click(); await settle(1800)
  await save('violin sheet svg', head(), 'SVG', { marks: 100, texts: 60 })
  await save('violin sheet png', head(), '300', { hues: 10, dpi: 300 })
  await save('violin corner png', corner(), '300', { hues: 4, dpi: 300 })
  await save('violin corner svg', corner(), 'SVG', { marks: 20, texts: 10 })
  await page.getByRole('button', { name: 'Dot plot', exact: true }).first().click(); await settle(1800)
  await save('dot plot png', head(), '300', { hues: 2, dpi: 300 })
  await save('dot plot svg', head(), 'SVG', { marks: 40, texts: 15 })
  await page.getByRole('button', { name: 'Feature plot', exact: true }).first().click(); await settle(2500)
  await save('feature sheet png', head(), '300', { hues: 2, dpi: 300 })
  await save('feature corner png', corner(), '300', { hues: 2, dpi: 300 })

  await tab('Gene sets'); await settle(1200)
  await page.locator('main button.set-row').first().click(); await settle(500)
  const score = page.getByRole('button', { name: /^Score/ })
  if (await score.count()) await score.first().click()
  await page.waitForSelector('main canvas', { timeout: 120_000 }); await settle(1500)
  await save('score map png', page.locator('main button[aria-haspopup="menu"]').first(), '300', { hues: 2, dpi: 300 })

  await tab('Co-expression')
  const seed = page.locator('input[aria-label="Seed gene"]')
  await seed.fill('Gfap'); await settle(400); await seed.press('Enter'); await settle(1200)
  const go = page.getByRole('button', { name: 'Correlate', exact: true })
  if (await go.count()) await go.click()
  await page.waitForSelector('main table', { timeout: 180_000 }); await settle(800)
  await save('co-expression svg', head(), 'SVG', { marks: 20, texts: 20 })
  await save('co-expression png', head(), '300', { hues: 2, dpi: 300 })

  check(`no page error in ${theme}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

console.log('\nTHE SAME FILE FROM EITHER THEME')
for (const tag of Object.keys(files.light)) {
  const a = files.light[tag], b = files.dark[tag]
  check(`${tag}: saved from dark is byte for byte the file saved from light`, !!a && !!b && md5(a) === md5(b), `${a && md5(a)} ${b && md5(b)}`)
}
await browser.close()
console.log(failed ? `\n${failed} export check(s) failed, ${passed} passed; files in ${out}` : `\nAll ${passed} export checks passed; files in ${out}`)
process.exit(failed ? 1 : 0)
