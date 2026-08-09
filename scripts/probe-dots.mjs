// After the pass finishes, how long until the dot plot has dots — and is the
// page blocked while it waits?
//
//   node scripts/probe-dots.mjs <url> <collection.zip> [shots-dir]
//
// Markers reads the winning genes' values before it can draw them. That read is
// separate from the statistical pass and is easy to forget about; this measures
// it on its own.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, shots = '.'] = process.argv.slice(2)
const s = (ms) => `${(ms / 1000).toFixed(1)} s`

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))

await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 15 * 60 * 1000 })
await page.click('[role=tab]:has-text("Markers")')

console.log('waiting for the pass to finish…')
await page.waitForSelector('text=/genes across \\d+ clusters/', { timeout: 40 * 60 * 1000 })
const t = Date.now()
console.log(`pass finished. circles now: ${await page.evaluate(() => document.querySelectorAll('circle').length)}`)
console.log(`legend says: ${(await page.textContent('.legend')).replace(/\s+/g, ' ').trim().slice(0, 90)}`)

await page.evaluate(() => {
  window.__b = { frames: 0, worst: 0, last: performance.now() }
  const tick = () => {
    const now = performance.now()
    const gap = now - window.__b.last
    window.__b.last = now
    window.__b.frames++
    if (gap > window.__b.worst) window.__b.worst = gap
    window.__b.raf = requestAnimationFrame(tick)
  }
  window.__b.raf = requestAnimationFrame(tick)
})

// The dot plot is drawn when the circles arrive, not when the title does.
await page.waitForFunction(() => document.querySelectorAll('circle').length > 100,
  null, { timeout: 20 * 60 * 1000, polling: 500 })
const drewMs = Date.now() - t
const b = await page.evaluate(() => {
  cancelAnimationFrame(window.__b.raf)
  return { frames: window.__b.frames, worst: window.__b.worst }
})
const n = await page.evaluate(() => document.querySelectorAll('circle').length)
console.log(`dots appeared ${s(drewMs)} after the title — ${n.toLocaleString()} circles`)
console.log(`while it read them: ${b.frames} frames in ${s(drewMs)} `
  + `(${(b.frames / (drewMs / 1000)).toFixed(0)} fps), worst gap ${b.worst.toFixed(0)} ms`)
await page.screenshot({ path: `${shots}/studio-dots.png` })
await browser.close()
