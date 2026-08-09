// Do the RESULT TABLES speak in symbols?
//
//   node scripts/probe-tables.mjs <url> <file.zip>
//
// The gene column of the marker table is where an accession-indexed object is
// most obviously unreadable, and it is also the place a rename is most likely to
// go wrong: those rows come back from a worker by INDEX and are named at the
// last moment. So this opens an object, runs Markers, and reads the column.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file] = process.argv.slice(2)

let failed = 0
const claim = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n        ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
page.on('pageerror', e => { failed++; console.log(`  [page error] ${e.message}`) })
const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 3000))
  await browser.close()
  process.exit(1)
}

await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 900_000 }).catch(() => dump('never opened'))

// The Markers card shows its genes as the axis labels of the one-vs-rest dot
// plot; the per-cluster tables are behind a chip. Those labels ARE the rows that
// came back from the worker by index, which is the path a rename can break.
await page.click('[role=tab]:has-text("Markers")')
await page.waitForFunction(
  () => /[1-9]\d* genes across \d+ clusters/.test(document.body.innerText),
  null, { timeout: 1_500_000 },
).catch(() => dump('Markers never produced a gene'))
const labels = await page.$$eval('svg text', ts => ts.map(t => t.textContent.trim()).filter(Boolean))
const genes = labels.filter(l => /^[A-Za-z][\w.-]*( \(\w+\))?$/.test(l)).slice(0, 14)
console.log(`  marker gene labels: ${JSON.stringify(genes.slice(0, 10))}`)
claim('markers came back with names at all', genes.length > 0, JSON.stringify(labels.slice(0, 10)))
claim('and not as bare accessions',
  !genes.some(g => /^ENS[A-Z]*\d{6,}$/.test(g)), JSON.stringify(genes.slice(0, 6)))

// The per-cluster list, behind a chip — the actual table.
await page.click('.chip:has-text("genes"), button:has-text("genes")').catch(() => {})
await page.waitForTimeout(600)
const cells = await page.$$eval('table tbody tr td',
  ts => ts.slice(0, 24).map(t => t.textContent.trim())).catch(() => [])
if (cells.length) {
  console.log(`  per-cluster table: ${JSON.stringify(cells.slice(0, 8))}`)
  claim('the table is not a column of bare accessions',
    !cells.some(c => /^ENS[A-Z]*\d{6,}$/.test(c)), JSON.stringify(cells.slice(0, 6)))
}

await browser.close()
console.log(failed ? `\n${failed} check(s) failed\n` : '\nPASS\n')
process.exit(failed ? 1 : 0)
