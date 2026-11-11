// Every screen and panel of the studio as a real browser renders it, for the
// design record (docs/design/before, docs/design/after, docs/DESIGN.md).
//
//   CHROME=<a Chrome or Chromium binary> node scripts/shot-design.mjs \
//     <url> <out-dir> [widths=1280,1440,1920] [themes=light,dark] [only=name,name]
//
// Synthetic objects only: the in-browser demos and the committed synthetic
// testdata/lab/family-2x2.zip (for the Run card). Never a cohort's object.
// Reduced motion is on, so no frame is caught mid-transition. A page taller
// than MAXH is cut at MAXH: the record is of the layout, not of every row.

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const [url = 'http://localhost:4431', out = 'docs/design/after',
  w = '1280,1440,1920', th = 'light,dark', only = ''] = process.argv.slice(2)
const WIDTHS = w.split(',').map(Number)
const THEMES = th.split(',')
const ONLY = new Set(only ? only.split(',') : [])
const LAB = path.resolve('testdata/lab/family-2x2.zip')
const MAXH = 2600
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true })
const errors = []

for (const T of THEMES) for (const W of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: 900 }, colorScheme: T, reducedMotion: 'reduce', deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${W}/${T}: ${e.message}`))
  const settle = async (ms = 500) => {
    await page.waitForTimeout(ms)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  const shot = async (name, full = true) => {
    if (ONLY.size && !ONLY.has(name)) return
    // The frame does not scroll (the stage does), so a whole view is taken by
    // growing the window by what the stage has below the fold, up to MAXH.
    const below = full ? await page.evaluate(() => {
      const m = document.querySelector('main.stage')
      return m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0
    }) : 0
    if (below > 0) { await page.setViewportSize({ width: W, height: Math.min(MAXH, 900 + below) }); await settle(400) }
    try { await capture(name, full) } finally {
      if (below > 0) { await page.setViewportSize({ width: W, height: 900 }); await settle(300) }
    }
  }
  const capture = async (name, full) => {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.screenshot({
      path: path.join(out, `${name}-${W}-${T}.png`), fullPage: full,
      ...(full ? { clip: { x: 0, y: 0, width: W, height: Math.min(h, MAXH) } } : {}),
    })
  }
  const tab = async name => {
    await page.getByRole('tab', { name, exact: true }).click()
    await settle(700)
  }
  const open = async label => {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.getByText(label, { exact: true }).click()
    await page.waitForSelector('[role="tablist"]', { timeout: 60_000 })
    await settle(800)
  }

  // With `only`, a block none of whose screens is asked for is skipped, so one
  // screen can be looked at without walking the whole app.
  const want = (...names) => !ONLY.size || names.some(n => ONLY.has(n))

  if (want('landing')) {
    await page.goto(url, { waitUntil: 'networkidle' })
    await settle()
    await shot('landing')
  }

  await open('Replicated cohort')
  if (want('overview')) { await tab('Overview'); await shot('overview') }
  if (want('cells', 'cells-viewport', 'cells-single', 'cells-split', 'cells-split-nokey', 'cells-split-bare',
    'cells-isolate', 'menu-order', 'menu-style')) {
    await tab('Cells'); await shot('cells')
    await shot('cells-viewport', false)
    const split = page.getByRole('button', { name: 'Split by group', exact: true })
    if (await split.count()) {
      const was = await split.getAttribute('aria-pressed')
      await split.click(); await settle()
      await shot(was === 'true' ? 'cells-single' : 'cells-split')
      await split.click(); await settle()
      // Split, with the key closed (it moves into the head), then both panes closed.
      if (was !== 'true') { await split.click(); await settle() }
      await page.keyboard.press(']'); await settle(); await shot('cells-split-nokey', false)
      await page.keyboard.press('['); await settle(); await shot('cells-split-bare', false)
      await page.keyboard.press('['); await page.keyboard.press(']'); await settle()
      // One entry of the key isolated.
      const entry = page.locator('aside.inspector button.lg-row').nth(3)
      if (await entry.count()) { await entry.click(); await settle(); await shot('cells-isolate', false); await page.keyboard.press('Escape'); await settle() }
      if (was !== 'true') { await split.click(); await settle() }
    }
    // The two menus in the control bar, open, over the Cells view.
    const menus = page.locator('header button[aria-haspopup="dialog"]')
    for (let i = 0; i < await menus.count(); i++) {
      await menus.nth(i).click(); await settle(400)
      await shot(`menu-${i === (await menus.count()) - 1 ? 'style' : 'order'}`, false)
      await page.keyboard.press('Escape'); await settle(300)
    }
  }
  if (want('composition')) { await tab('Composition'); await shot('composition') }
  if (want('markers')) {
    await tab('Markers')
    await page.waitForSelector('main svg[role="img"]', { timeout: 120_000 }).catch(() => {})
    await settle(800); await shot('markers')
  }
  if (want('de', 'menu-celltype', 'de-table', 'de-volcano', 'de-volcano-pin', 'de-enrich', 'de-fdr')) {
    await tab('Differential expression'); await shot('de')
    // A contrast is never chosen for the reader: pick a cell type, a control and a
    // comparison through the rail's own pickers, the first free option of each.
    // In the bar under the tabs before W037, in the rail after it.
    const pickers = page.locator('header button[aria-haspopup="listbox"], aside.rail > .rail-group button[aria-haspopup="listbox"]')
    for (let i = 0; i < await pickers.count(); i++) {
      await pickers.nth(i).click(); await settle(300)
      if (i === 0) await shot('menu-celltype', false)
      await page.locator('[role="option"]:not([disabled])').first().click()
      await page.keyboard.press('Escape'); await settle(300)
    }
    const run = page.getByRole('button', { name: 'Run', exact: true })
    if (await run.count()) await run.click()
    await page.waitForSelector('main table', { timeout: 180_000 }).catch(() => {})
    await settle(800); await shot('de-table')
    for (const [k, label] of [['volcano', 'Volcano'], ['enrich', 'Enrichment']]) {
      const b = page.getByRole('button', { name: label, exact: true })
      if (await b.count()) { await b.first().click(); await settle(2500); await shot(`de-${k}`) }
      // A point pinned: its row in the inspector, its name on the figure.
      if (k === 'volcano') {
        const pt = page.locator('main svg[role="img"] circle[data-gene]').first()
        if (await pt.count()) { await pt.click({ force: true }); await settle(400); await shot('de-volcano-pin', false) }
      }
    }
  }
  if (want('expr-violin', 'expr-dot', 'expr-feature')) {
    await tab('Gene expression')
    const q = page.locator('input[aria-label="Search a gene or paste a gene list"]')
    await q.fill('Gfap, Ascl1, Mki67, Dcx, Plp1, Cx3cr1'); await q.press('Enter'); await settle(2500)
    for (const [k, label] of [['violin', 'Violin panel'], ['dot', 'Dot plot'], ['feature', 'Feature plot']]) {
      const b = page.getByRole('button', { name: label, exact: true })
      if (await b.count()) { await b.first().click(); await settle(1500); await shot(`expr-${k}`) }
    }
  }
  if (want('sets', 'sets-result', 'sets-many')) {
    await tab('Gene sets'); await settle(1500); await shot('sets')
    // One set scored: the first of the list, through the view's own controls.
    const first = page.locator('main [role="option"], main button.set-row').first()
    if (await first.count()) {
      await first.click(); await settle(500)
      const score = page.getByRole('button', { name: /^Score/ })
      if (await score.count()) await score.first().click()
      await page.waitForSelector('main canvas', { timeout: 120_000 }).catch(() => {})
      await settle(1500); await shot('sets-result')
    }
    const many = page.getByRole('button', { name: 'Several sets', exact: true })
    if (await many.count()) {
      await many.click(); await settle(600)
      const rows = page.locator('main [role="option"], main button.set-row')
      for (let i = 0; i < 4 && i < await rows.count(); i++) { await rows.nth(i).click(); await settle(150) }
      const run = page.getByRole('button', { name: /^Score/ })
      if (await run.count()) await run.first().click()
      await page.waitForSelector('main svg[role="img"]', { timeout: 120_000 }).catch(() => {})
      await settle(1500); await shot('sets-many')
    }
  }
  if (want('coexpr', 'coexpr-result')) {
    await tab('Co-expression'); await shot('coexpr')
    // One gene correlated against every gene, through the view's own controls.
    const seed = page.locator('input[aria-label="Seed gene"]')
    if (await seed.count()) {
      await seed.fill('Gfap'); await settle(400); await seed.press('Enter'); await settle(1200)
      const go = page.getByRole('button', { name: 'Correlate', exact: true })
      if (await go.count()) await go.click()
      await page.waitForSelector('main table', { timeout: 180_000 }).catch(() => {})
      await settle(800); await shot('coexpr-result', false)
    }
  }
  if (want('methods')) { await tab('Methods'); await shot('methods') }

  // A view that fails to draw: the boundary takes the view, never the app.
  // (`?crash=<tab>` is the app's own switch for showing this state.)
  if (want('state-error')) {
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}crash=coexpr`, { waitUntil: 'networkidle' })
    await page.getByText('Replicated cohort', { exact: true }).click()
    await page.waitForSelector('[role="tablist"]', { timeout: 60_000 })
    await settle(800)
    await tab('Co-expression'); await shot('state-error', false)
  }

  if (want('wt-cells')) {
    await open('Wild type only')
    await tab('Cells'); await shot('wt-cells')
  }

  // Four panels: the time course, split by group.
  if (want('tc-cells-split')) {
    await open('Time course')
    await tab('Cells')
    const split4 = page.getByRole('button', { name: 'Split by group', exact: true })
    if (await split4.count() && await split4.getAttribute('aria-pressed') !== 'true') { await split4.click(); await settle() }
    await shot('tc-cells-split', false)
  }

  if (want('lab-overview', 'lab-cells')) {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.setInputFiles('input[type=file]', LAB)
    await page.waitForSelector('[role="tablist"]', { timeout: 60_000 })
    await settle(800); await shot('lab-overview')
    await tab('Cells'); await shot('lab-cells')
  }

  await ctx.close()
  console.log(`done ${W} ${T}`)
}
await browser.close()
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors')
