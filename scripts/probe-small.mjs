// A small object must not have gained a wait.
//
//   node scripts/probe-small.mjs <url> <bundle.zip>
//
// The claim under test is that an object held in memory computes in the render
// exactly as it always did: no worker, no progress card, not even for a frame.
// So this watches the DOM for the progress card from before the tab is clicked
// until after the result is on screen, and reports whether it ever existed.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file] = process.argv.slice(2)

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))

const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 3000))
  await browser.close()
  process.exit(1)
}

await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 120_000 }).catch(() => dump('never opened'))
console.log(`opened: ${(await page.textContent('header')).replace(/\s+/g, ' ').trim().slice(0, 90)}`)

// A MutationObserver, not a poll: a progress card that exists for one frame is
// exactly the thing being ruled out, and a poll would miss it.
await page.evaluate(() => {
  window.__sawProgress = 0
  window.__sawWorker = 0
  const RealWorker = window.Worker
  window.Worker = function (...a) { window.__sawWorker++; return new RealWorker(...a) }
  new MutationObserver(() => {
    if (document.querySelector('[role=status]')) window.__sawProgress++
  }).observe(document.body, { childList: true, subtree: true })
})

const t = Date.now()
await page.click('[role=tab]:has-text("Markers")')
await page.waitForSelector('text=/genes across \\d+ clusters/', { timeout: 120_000 })
  .catch(() => dump('Markers never produced a result'))
const ms = Date.now() - t
const seen = await page.evaluate(() => ({ p: window.__sawProgress, w: window.__sawWorker }))

console.log(`Markers drew in ${ms} ms`)
console.log(`progress card appeared: ${seen.p === 0 ? 'never' : `${seen.p} times`}`)
console.log(`workers created: ${seen.w}`)
console.log(`title: ${(await page.textContent('.eyebrow + *').catch(() => '')).trim().slice(0, 80)}`)

const ok = seen.p === 0 && seen.w === 0
console.log(ok ? '\nPASS — computed inline, no worker, no progress card'
  : '\nFAIL — a small object took the streaming path')
await browser.close()
process.exit(ok ? 0 : 1)
