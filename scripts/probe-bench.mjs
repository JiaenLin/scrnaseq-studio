// Drive bench.html in a real browser.
//
//   node scripts/probe-bench.mjs <url> <collection.zip> <step...>
//
// Steps: shapeA, shapeB, oldPath, compare. The file is opened first, always.
// Everything is driven through window.bench rather than by clicking, so a step
// finishes when its promise settles — no polling for text that may never appear.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, ...steps] = process.argv.slice(2)
const TIMEOUT = 45 * 60 * 1000

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage()
page.on('console', m => console.log(`  [page] ${m.text()}`))
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))

await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('#file', file)

console.log('=== open ===')
let t = Date.now()
const shape = await page.evaluate(
  () => window.bench.open(document.getElementById('file').files[0]))
console.log(`  ${JSON.stringify(shape)} in ${((Date.now() - t) / 1000).toFixed(1)} s`)

for (const step of steps) {
  console.log(`\n=== ${step} ===`)
  t = Date.now()
  if (step === 'compare') {
    const verdict = await page.evaluate(async () => {
      const a = await window.bench.shapeA()
      const b = await window.bench.oldPath()
      return window.bench.compare(a, b)
    }, { timeout: TIMEOUT })
    console.log(`  NUMBERS: ${verdict}`)
  } else {
    await page.evaluate(s => window.bench[s](), step, { timeout: TIMEOUT })
  }
  console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`)
}

console.log('\n---- log ----')
console.log(await page.textContent('#log'))
await browser.close()
