// Drive the Composition tab in a real browser.
//
//   node scripts/probe-composition.mjs <url> <collection.zip> [shots-dir]
//
// Every assertion is on a string grepped out of Composition.tsx, and every miss
// prints the page text — a silent false negative looks exactly like a hang.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, shots = '.'] = process.argv.slice(2)
const s = (ms) => `${(ms / 1000).toFixed(1)} s`

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))
page.on('console', m => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`) })

const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 4000))
  await page.screenshot({ path: `${shots}/composition-fail.png`, fullPage: false })
  await browser.close()
  process.exit(1)
}

const sel = (label) => `label:has(span.glabel:text-is("${label}")) select`
const pick = async (label, value) => {
  await page.selectOption(sel(label), { label: value })
  await page.waitForTimeout(400)
}
const rowCount = () => page.evaluate(() =>
  document.querySelectorAll('svg[role=img] g[clip-path]').length)
const rectCount = () => page.evaluate(() =>
  document.querySelectorAll('svg[role=img] g[clip-path] rect').length)
/**
 * Does every label sit inside the viewBox?
 *
 * A row name drawn at a negative x still shows on screen — the browser is
 * happy to paint outside an inline <svg> — but the PNG export rasterizes the
 * viewBox, so the whole axis would be missing from the exported figure and
 * nothing on screen would say so.
 */
const labelBounds = () => page.evaluate(() => {
  const svg = document.querySelector('svg[role=img]')
  if (!svg) return { err: 'no svg' }
  let minX = Infinity, worst = ''
  for (const t of svg.querySelectorAll('text')) {
    const b = t.getBBox()
    if (b.x < minX) { minX = b.x; worst = t.textContent }
  }
  return { minX: Math.round(minX), worst, viewBox: svg.getAttribute('viewBox') }
})

const cardText = () => page.evaluate(() => {
  const c = document.querySelector('section.card')
  return c ? c.textContent.replace(/\s+/g, ' ').trim() : '(no card)'
})

const startBeat = () => page.evaluate(() => {
  window.__beat = { frames: 0, worst: 0, last: performance.now() }
  const tick = () => {
    const now = performance.now()
    const gap = now - window.__beat.last
    window.__beat.last = now
    window.__beat.frames++
    if (gap > window.__beat.worst) window.__beat.worst = gap
    window.__beat.raf = requestAnimationFrame(tick)
  }
  window.__beat.raf = requestAnimationFrame(tick)
})
const readBeat = () => page.evaluate(() => {
  cancelAnimationFrame(window.__beat.raf)
  return { frames: window.__beat.frames, worst: window.__beat.worst }
})

await page.goto(url, { waitUntil: 'load' })

console.log('=== opening the object ===')
let t = Date.now()
await page.setInputFiles('input[type=file]', file)
try {
  await page.waitForSelector('[role=tab]', { timeout: 15 * 60 * 1000 })
} catch { await dump('the studio never reached the tab bar') }
console.log(`  tab bar in ${s(Date.now() - t)}`)

console.log('\n=== Composition, untouched (the default must not have changed) ===')
t = Date.now()
await page.click('[role=tab]:has-text("Composition")')
try {
  await page.waitForSelector('text=Cell type proportions, one row per sample', { timeout: 120_000 })
} catch { await dump('the default Composition title never appeared') }
await page.waitForSelector('svg[role=img]', { timeout: 120_000 }).catch(() => dump('no figure drew'))
console.log(`  drew in ${s(Date.now() - t)} — ${await rowCount()} rows, ${await rectCount()} segments`)
{
  const b = await labelBounds()
  console.log(`  labels: minX=${b.minX} in viewBox ${b.viewBox} (widest "${(b.worst || '').slice(0, 40)}")`)
  if (!(b.minX >= 0)) await dump(`a row label sits at x=${b.minX}, outside the viewBox — the PNG export would lose the axis`)
}
console.log(`  legend/controls: ${(await cardText()).slice(0, 260)}`)
await page.screenshot({ path: `${shots}/comp-default.png` })

console.log('\n=== the pooling refusal ===')
await pick('One row per', 'Group')
const refused = await page.locator('text=would pool cells across samples').count()
if (!refused) await dump('one row per Group was drawn instead of refused')
console.log(`  refused: "${(await page.textContent('.empty')).replace(/\s+/g, ' ').trim().slice(0, 200)}"`)
if (await page.locator('svg[role=img] g[clip-path]').count()) {
  await dump('the refusal still drew stacked rows')
}
await page.screenshot({ path: `${shots}/comp-refusal.png` })

console.log('\n=== the one-click fix ===')
t = Date.now()
await page.click('button:has-text("Break it down by sample as well")')
await page.waitForSelector('svg[role=img] g[clip-path]', { timeout: 120_000 })
  .catch(() => dump('the fix drew nothing'))
console.log(`  Group × Sample drew in ${s(Date.now() - t)} — ${await rowCount()} rows`)
{
  const b = await labelBounds()
  console.log(`  labels: minX=${b.minX} in viewBox ${b.viewBox} (widest "${(b.worst || '').slice(0, 40)}")`)
  if (!(b.minX >= 0)) await dump(`a row label sits at x=${b.minX}, outside the viewBox — the PNG export would lose the axis`)
}
console.log(`  title now: ${(await page.textContent('section.card h2')).trim()}`)
await page.screenshot({ path: `${shots}/comp-group-sample.png`, fullPage: false })

console.log('\n=== bars = Sample, rows = Cell type (sample structure is on screen) ===')
await pick('Bars show', 'Sample')
await pick('One row per', 'Cell type')
await page.waitForSelector('svg[role=img] g[clip-path]', { timeout: 120_000 })
  .catch(() => dump('Sample-by-Cell type drew nothing'))
console.log(`  ${await rowCount()} rows, ${await rectCount()} segments`)
console.log(`  title: ${(await page.textContent('section.card h2')).trim()}`)
{
  const b = await labelBounds()
  console.log(`  labels: minX=${b.minX} in viewBox ${b.viewBox} (widest "${(b.worst || '').slice(0, 40)}")`)
  if (!(b.minX >= 0)) await dump(`a row label sits at x=${b.minX}, outside the viewBox — the PNG export would lose the axis`)
}
await page.screenshot({ path: `${shots}/comp-sample-by-type.png` })

console.log('\n=== the big one: rows = Cell type × Sample ===')
await pick('Bars show', 'Group')
await startBeat()
t = Date.now()
await pick('One row per', 'Cell type × Sample')
await page.waitForSelector('svg[role=img] g[clip-path]', { timeout: 180_000 })
  .catch(() => dump('the product axis drew nothing'))
const bigMs = Date.now() - t
const beat = await readBeat()
console.log(`  drew in ${s(bigMs)} — ${await rowCount()} rows, ${await rectCount()} segments`)
console.log(`  frames during it: ${beat.frames}, worst gap ${beat.worst.toFixed(0)} ms`)
const cap = await page.locator('text=/Showing \\d+ of [\\d,]+ rows/').first().textContent()
  .catch(() => '')
console.log(`  cap notice: "${(cap || '(none)').replace(/\s+/g, ' ').trim()}"`)

console.log('\n=== narrowing with "limit to" ===')
const limits = await page.locator(sel('Limit to') + ' option').count()
console.log(`  the limit menu offers ${limits} choices`)
await page.selectOption(sel('Limit to'), { index: 1 })
await page.waitForTimeout(600)
console.log(`  after limiting: ${await rowCount()} rows`)
console.log(`  chose: "${await page.locator(sel('Limit to') + ' option').nth(1).textContent()}"`)
await page.screenshot({ path: `${shots}/comp-limited.png` })

console.log('\n=== exports, from the pairing the user actually asked for ===')
await pick('Bars show', 'Cell type')
await pick('One row per', 'Group × Sample')
await page.waitForSelector('svg[role=img] g[clip-path]', { timeout: 120_000 })
  .catch(() => dump('Cell type by Group × Sample drew nothing'))
console.log(`  ${await rowCount()} rows, ${await rectCount()} segments`)
{
  const b = await labelBounds()
  console.log(`  labels: minX=${b.minX} in viewBox ${b.viewBox} (widest "${(b.worst || '').slice(0, 40)}")`)
  if (!(b.minX >= 0)) await dump(`a row label sits at x=${b.minX}, outside the viewBox — the PNG export would lose the axis`)
}
const csv = page.waitForEvent('download', { timeout: 120_000 })
await page.click('button:has-text("CSV")')
const csvFile = await csv.catch(() => null)
if (!csvFile) await dump('the CSV button produced no download')
await csvFile.saveAs(`${shots}/${csvFile.suggestedFilename()}`)
console.log(`  CSV: ${csvFile.suggestedFilename()}`)
const png = page.waitForEvent('download', { timeout: 180_000 })
await page.click('button:has-text("PNG")')
const pngFile = await png.catch(() => null)
if (!pngFile) await dump('the PNG button produced no download')
await pngFile.saveAs(`${shots}/${pngFile.suggestedFilename()}`)
console.log(`  PNG: ${pngFile.suggestedFilename()}`)

console.log('\n=== the choice survives leaving the tab ===')
const before = (await page.textContent('section.card h2')).trim()
await page.click('[role=tab]:has-text("Overview")')
await page.waitForTimeout(800)
await page.click('[role=tab]:has-text("Composition")')
await page.waitForSelector('section.card h2', { timeout: 120_000 })
const after = (await page.textContent('section.card h2')).trim()
console.log(`  before: "${before}"`)
console.log(`  after:  "${after}"`)
if (before !== after) await dump('the pairing reset when the tab was left')
const stillLimited = await page.locator(sel('Limit to')).inputValue()
console.log(`  "limit to" still on option value ${stillLimited}, ${await rowCount()} rows`)

console.log('\n=== back to the default ===')
await pick('Bars show', 'Cell type')
await pick('One row per', 'Sample')
await page.waitForSelector('text=Cell type proportions, one row per sample', { timeout: 120_000 })
  .catch(() => dump('could not get back to the default pairing'))
console.log(`  ${await rowCount()} rows, ${await rectCount()} segments`)
await page.screenshot({ path: `${shots}/comp-back-to-default.png` })

console.log('\nALL STEPS COMPLETED')
await browser.close()
