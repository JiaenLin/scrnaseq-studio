// Drive the built studio in a real browser, and measure what a user feels.
//
//   node scripts/probe-studio.mjs <url> <collection.zip> [shots-dir]
//
// The assertions are on strings grepped from the source, and every miss prints
// the page text — a silent false negative looks exactly like a hang.

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
  await page.screenshot({ path: `${shots}/probe-fail.png`, fullPage: false })
  await browser.close()
  process.exit(1)
}

/**
 * Is the tab alive?
 *
 * A rAF loop counts frames. On a blocked main thread rAF does not fire at all,
 * so the frame count over a known wall-clock window is the answer, in the unit
 * the user experiences.
 */
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
  await page.waitForSelector('text=Overview', { timeout: 15 * 60 * 1000 })
  await page.waitForSelector('[role=tab]', { timeout: 60_000 })
} catch { await dump('the studio never reached the tab bar') }
const openMs = Date.now() - t
// The first tab is Overview and it draws the whole embedding; wait for its
// figure rather than for the chrome around it.
try {
  await page.waitForSelector('svg[role=img]', { timeout: 10 * 60 * 1000 })
} catch { await dump('Overview never drew a figure') }
const paintMs = Date.now() - t
console.log(`  tab bar in ${s(openMs)}, first figure painted in ${s(paintMs)}`)
console.log(`  header says: ${(await page.textContent('header')).replace(/\s+/g, ' ').trim().slice(0, 160)}`)
await page.screenshot({ path: `${shots}/studio-open.png` })

console.log('\n=== Markers ===')
t = Date.now()
await page.click('[role=tab]:has-text("Markers")')
try {
  await page.waitForSelector('text=Testing every gene in every cluster', { timeout: 60_000 })
} catch { await dump('Markers did not start a pass') }
console.log(`  progress card up in ${s(Date.now() - t)}`)

// --- while it computes, use the tab ------------------------------------------
await startBeat()
const t0 = Date.now()
await page.waitForTimeout(4000)
const idle = await readBeat()
console.log(`  idle while computing: ${idle.frames} frames in 4 s, worst gap ${idle.worst.toFixed(0)} ms`)

await startBeat()
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 220)
  await page.waitForTimeout(120)
}
const scrolled = await readBeat()
const y = await page.evaluate(() => window.scrollY)
console.log(`  scrolling while computing: ${scrolled.frames} frames, worst gap ${scrolled.worst.toFixed(0)} ms, scrollY=${y}`)
await page.evaluate(() => window.scrollTo(0, 0))

// A tab switch mid-pass: the pass must survive it, and coming back must not
// restart from zero.
const progressBefore = await page.textContent('[role=status]').catch(() => '')
await page.click('[role=tab]:has-text("Cells")')
await page.waitForTimeout(1500)
// Cells draws 292 495 points to a canvas, not an SVG — checking for the wrong
// element here read as a failure for one run and was not one.
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return 'no canvas'
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let ink = 0
  for (let i = 3; i < px.length; i += 4000) if (px[i] > 0) ink++
  return `canvas ${c.width}x${c.height}, ${ink} of ${Math.ceil(px.length / 4000)} sampled pixels painted`
})
console.log(`  switched to Cells mid-pass: ${painted}`)
await startBeat()
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 250)
  await page.waitForTimeout(120)
}
const cellScroll = await readBeat()
console.log(`  scrolling the Cells tab while computing: ${cellScroll.frames} frames, `
  + `worst gap ${cellScroll.worst.toFixed(0)} ms, scrollY=${await page.evaluate(() => window.scrollY)}`)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: `${shots}/studio-cells-midpass.png` })

await page.click('[role=tab]:has-text("Gene expression")')
await page.waitForSelector('input[aria-label="Search a gene or paste a gene list"]', { timeout: 60_000 })
    .catch(() => dump('the gene box never appeared'))
const typeT = Date.now()
await page.type('input[aria-label="Search a gene or paste a gene list"]', 'Sox2', { delay: 60 })
const typed = await page.inputValue('input[aria-label="Search a gene or paste a gene list"]')
console.log(`  typed "Sox2" in the gene box while computing: got "${typed}" in ${s(Date.now() - typeT)}`)
await page.screenshot({ path: `${shots}/studio-typing-midpass.png` })

await page.click('[role=tab]:has-text("Markers")')
const progressAfter = await page.textContent('[role=status]').catch(() => '')
console.log(`  back on Markers — progress before the detour: "${(progressBefore || '').replace(/\s+/g, ' ').trim().slice(0, 110)}"`)
console.log(`                    progress after:             "${(progressAfter || '').replace(/\s+/g, ' ').trim().slice(0, 110)}"`)
await page.screenshot({ path: `${shots}/studio-markers-progress.png` })

// --- and it finishes ---------------------------------------------------------
await startBeat()
try {
  await page.waitForSelector('text=/genes across \\d+ clusters/', { timeout: 40 * 60 * 1000 })
} catch { await dump('Markers never finished') }
const markersMs = Date.now() - t0
const tail = await readBeat()
console.log(`  Markers finished ${s(markersMs)} after the tab was opened`)
console.log(`  frames during the rest of the pass: ${tail.frames}, worst gap ${tail.worst.toFixed(0)} ms`)
const title = await page.textContent('h2, .eyebrow + *').catch(() => '')
console.log(`  title: ${(title || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`)
await page.waitForTimeout(3000)
await page.screenshot({ path: `${shots}/studio-markers-done.png`, fullPage: false })

// The cache: leaving and returning must not recompute.
await page.click('[role=tab]:has-text("Overview")')
await page.waitForTimeout(400)
t = Date.now()
await page.click('[role=tab]:has-text("Markers")')
await page.waitForSelector('text=/genes across \\d+ clusters/', { timeout: 60_000 })
  .catch(() => dump('coming back to Markers restarted the pass'))
console.log(`  leaving Markers and coming back: ${s(Date.now() - t)} (cached, not recomputed)`)

console.log('\nALL STEPS COMPLETED')
await browser.close()
