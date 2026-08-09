// Screenshots of the two changes on a real object, for the record.
//   node scripts/shot-names.mjs <url> <file.zip> <out-prefix>
import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, out] = process.argv.slice(2)

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))
await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 900_000 })

const sel = 'label:has(.glabel:text-is("Embedding")) select'
await page.click('[role=tab]:has-text("Cells")')
await page.waitForSelector('canvas', { timeout: 300_000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}-umap.png` })
const keys = await page.$$eval(`${sel} option`, os => os.map(o => o.textContent))
console.log(`embeddings: ${keys.join(', ')}`)
if (keys.length > 1) {
  await page.selectOption(sel, keys[1])
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}-${keys[1]}.png` })
  await page.selectOption(sel, keys[0])
}

// Markers: the table that used to be a column of accessions.
await page.click('[role=tab]:has-text("Markers")')
await page.waitForSelector('table', { timeout: 900_000 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}-markers.png` })
const firstGenes = await page.$$eval('table tbody tr td:nth-child(2)',
  ts => ts.slice(0, 8).map(t => t.textContent.trim()))
console.log(`marker table gene column: ${JSON.stringify(firstGenes)}`)

await page.click('[role=tab]:has-text("Gene expression")')
await page.fill('input[aria-label="Search a gene or paste a gene list"]', 'Sox2')
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}-search.png` })

await page.click('[role=tab]:has-text("Gene sets")')
await page.waitForSelector('text=/genes found in this object/', { timeout: 900_000 })
await page.waitForSelector('canvas', { timeout: 900_000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}-sets.png` })
console.log((await page.textContent('text=/genes found in this object/')).replace(/\s+/g, ' ').trim())

await browser.close()
