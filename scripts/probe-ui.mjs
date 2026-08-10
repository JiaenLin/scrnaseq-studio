// Walk every tab of a demo object and measure the interface, not the numbers.
//
//   node scripts/probe-ui.mjs <url> [demo] [shots-dir]
//
// What it answers, in the order the plan asks for it:
//   1. does the page jump vertically when you change tabs?
//   2. how many distinct font sizes and radii are actually rendered?
//   3. how many words of prose are on screen?
//   4. does anything overflow the viewport horizontally?
//
// The counts come from getComputedStyle over the live DOM, so they measure the
// page rather than the source — a token nothing uses does not count as a fix.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', demo = 'cohort', shots = '.'] = process.argv.slice(2)

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(url, { waitUntil: 'networkidle' })

// The demo buttons carry their title as text; pick by the one asked for.
const LABEL = { cohort: 'Replicated cohort', course: 'Time course', wt: 'Wild type only' }
await page.getByText(LABEL[demo], { exact: true }).click()
await page.waitForSelector('[role="tablist"]', { timeout: 20000 })

/** Every distinct rendered font size, radius and colour on screen right now. */
const styles = () => page.evaluate(() => {
  const sizes = new Map(), fig = new Map(), radii = new Map()
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length) continue
    const cs = getComputedStyle(el)
    // Only where the element actually paints text of its own.
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    // Figure type is a separate, deliberate system — counted apart so a
    // deliberate axis size is never confused with an ad-hoc interface one.
    const inFigure = el.closest('svg') !== null
    if (own) {
      const m = inFigure ? fig : sizes
      m.set(cs.fontSize, (m.get(cs.fontSize) ?? 0) + 1)
    }
    if (inFigure) continue
    const r = cs.borderTopLeftRadius
    if (r !== '0px' && cs.borderTopLeftRadius === cs.borderBottomRightRadius) {
      radii.set(r, (radii.get(r) ?? 0) + 1)
    }
  }
  const num = s => parseFloat(s)
  const out = m => [...m.entries()].sort((a, b) => num(a[0]) - num(b[0]))
  return { sizes: out(sizes), fig: out(fig), radii: out(radii) }
})

/** Words of running prose — paragraphs and captions, not labels or numbers. */
const words = () => page.evaluate(() => {
  const sel = 'p, figcaption, .sub, .note, .empty, li'
  let n = 0
  for (const el of document.querySelectorAll(sel)) {
    if (!el.getClientRects().length) continue
    if (el.querySelector(sel)) continue // count the leaf, not its parent
    n += (el.textContent.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length
  }
  return n
})

const tabs = await page.$$eval('[role="tab"]', els =>
  els.map(e => ({ label: e.textContent.trim(), disabled: e.disabled })))

console.log(`\n${demo.toUpperCase()} — ${tabs.length} tabs\n`)

let jumped = 0, totalWords = 0
const allSizes = new Map(), allFig = new Map(), allRadii = new Map()
let lastMainTop = null

for (const { label, disabled } of tabs) {
  if (disabled) {
    console.log(`  ${label.padEnd(24)} disabled`)
    continue
  }
  await page.getByRole('tab', { name: label, exact: true }).click()
  await page.waitForTimeout(450)

  // Where the content starts, measured from the TOP of the document — a jump
  // caused by a bar appearing is a different thing from one caused by scroll.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(120)
  const top = await page.evaluate(() => Math.round(
    document.querySelector('main').getBoundingClientRect().top))
  const jump = lastMainTop === null ? 0 : Math.abs(top - lastMainTop)
  if (jump > 2) jumped++
  lastMainTop = top

  const w = await words()
  totalWords += w
  const { sizes, fig, radii } = await styles()
  for (const [k, v] of sizes) allSizes.set(k, (allSizes.get(k) ?? 0) + v)
  for (const [k, v] of fig) allFig.set(k, (allFig.get(k) ?? 0) + v)
  for (const [k, v] of radii) allRadii.set(k, (allRadii.get(k) ?? 0) + v)

  const wide = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)

  console.log(`  ${label.padEnd(24)} main@${String(top).padStart(4)}`
    + `${jump > 2 ? `  JUMPED ${jump}px` : ''}`
    + `  ${String(w).padStart(4)} words`
    + `  ${String(sizes.length).padStart(2)} sizes`
    + `${wide > 0 ? `  H-OVERFLOW ${wide}px` : ''}`)

  await page.screenshot({ path: `${shots}/ui-${demo}-${label.replace(/\W+/g, '-').toLowerCase()}.png` })
}

const num = s => parseFloat(s)
const fmt = m => [...m.entries()].sort((a, b) => num(a[0]) - num(b[0]))
  .map(([k, v]) => `${k}×${v}`).join(' ')

console.log(`\n  interface type (${allSizes.size})  ${fmt(allSizes)}`)
console.log(`  figure type    (${allFig.size})  ${fmt(allFig)}`)
console.log(`  radii          (${allRadii.size})  ${fmt(allRadii)}`)
console.log(`  prose        ${totalWords} words over ${tabs.filter(t => !t.disabled).length} tabs`)
console.log(`  tab jumps    ${jumped}`)
if (errors.length) console.log(`\n  ERRORS\n${errors.map(e => '   ' + e).join('\n')}`)

await browser.close()
