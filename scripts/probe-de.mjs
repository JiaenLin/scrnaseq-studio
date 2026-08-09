// Prove the contrast tabs report the same numbers in a real browser.
//
//   node scripts/probe-de.mjs <url> <collection.zip> [step...]
//
// Steps: compare (default), compare:<control>:<compare>, race. The file is
// opened first, always. Everything
// is driven through window.benchDE, so a step finishes when its promise settles
// rather than when some text appears — a poll that never matches looks exactly
// like a hang, and this project has paid for that mistake already.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, ...rest] = process.argv.slice(2)
const steps = rest.length ? rest : ['compare']
const TIMEOUT = 60 * 60 * 1000

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage()
page.on('console', m => console.log(`  [page] ${m.text()}`))
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))

await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('#file', file)

console.log('=== open ===')
let t = Date.now()
const shape = await page.evaluate(
  () => window.benchDE.open(document.getElementById('file').files[0]),
  { timeout: TIMEOUT })
console.log(`  ${shape.cells.toLocaleString()} cells, ${shape.genes.toLocaleString()} genes, `
  + `${shape.clusters} clusters in ${((Date.now() - t) / 1000).toFixed(1)} s`)
console.log(`  conditions (${shape.conds.length}): ${shape.conds.join(', ')}`)

let bad = false
for (const step of steps) {
  console.log(`\n=== ${step} ===`)
  t = Date.now()
  const [name, ...args] = step.split(':')
  const r = await page.evaluate(
    ([n, a]) => window.benchDE[n](...a), [name, args], { timeout: TIMEOUT })
  console.log(`  -> ${JSON.stringify(r)}`)
  if (name === 'compare' && !String(r.verdict).startsWith('IDENTICAL')) bad = true
  if (name === 'race' && r !== true) bad = true
  console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`)
}

console.log('\n---- log ----')
console.log(await page.textContent('#log'))
await browser.close()
if (bad) { console.log('\nFAILED'); process.exit(1) }
console.log('\nALL STEPS COMPLETED')
