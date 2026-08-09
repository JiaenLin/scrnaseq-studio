// A small object must not have learned to wait.
//
//   node scripts/probe-sets-inline.mjs <url> <bundle.zip> [shots-dir]
//
// The score now has a worker behind it, and the failure that would be easy to
// miss is not a wrong number — it is a 2 638-cell object gaining a progress card
// it never needed, for a tenth of a second, every time the set changes. That
// flash is what "the engine decides, not the view" is supposed to prevent, and
// the only way to know it is prevented is to watch for the card and never see it.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, shots = '.'] = process.argv.slice(2)
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))

const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 3000))
  await page.screenshot({ path: `${shots}/probe-inline-fail.png` })
  await browser.close()
  process.exit(1)
}

await page.goto(url, { waitUntil: 'load' })

// A MutationObserver, not a poll: a card that appears and vanishes between two
// polls is exactly the flash being looked for, and polling would miss it.
await page.evaluate(() => {
  window.__cards = 0
  new MutationObserver(() => {
    if (document.querySelector('[role=status]')) window.__cards++
  }).observe(document.body, { childList: true, subtree: true })
})
const cards = () => page.evaluate(() => window.__cards)

await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 5 * 60 * 1000 })
  .catch(() => dump('the studio never reached the tab bar'))
await page.click('[role=tab]:has-text("Gene sets")')

const t = Date.now()
await page.waitForSelector('text=Score by identity', { timeout: 60_000 })
  .catch(() => dump('the score never appeared on a small object'))
console.log(`  first set scored in ${Date.now() - t} ms`)
check('the figure was there without a progress card', await cards() === 0, `${await cards()} seen`)

// Every built-in set in turn: each is a fresh whole-transcriptome accumulation,
// and each must land inside a render.
const ids = await page.$$eval('select[aria-label="Gene set"] option', o => o.map(x => x.value))
const rows = []
let scoredSets = 0
for (const id of ids) {
  const t0 = Date.now()
  await page.selectOption('select[aria-label="Gene set"]', id)
  // A set this object does not measure renders no table — correctly. Waiting for
  // one would be waiting for something that is never coming, and would be
  // reported as a hang; the count the card prints says which case this is.
  const found = await page.evaluate(() => {
    const m = document.body.textContent.match(/(\d+) of (\d+) genes found in this object/)
    return m ? +m[1] : -1
  })
  if (found === 0) { rows.push(`${id}: not measured here, no table — correct`); continue }
  await page.waitForSelector('text=Score by identity', { timeout: 60_000 })
    .catch(() => dump(`${id} matched ${found} genes but never produced a table`))
  const table = await page.evaluate(() => {
    const r = document.querySelector('table.t tbody tr')
    return r ? [...r.querySelectorAll('td')].map(c => c.textContent.trim()) : null
  })
  scoredSets++
  rows.push(`${id}: ${found} genes, ${Date.now() - t0} ms, first row ${JSON.stringify(table)}`)
}
console.log('  ' + rows.join('\n  '))
check('several sets actually scored, so this measured something', scoredSets >= 3, `${scoredSets} sets`)
check('no progress card appeared for any built-in set', await cards() === 0, `${await cards()} seen`)

// And a custom list, which is the path that re-plans on every keystroke.
await page.click('button:has-text("My own genes")')
await page.click('button:has-text("Load example")')
await page.waitForSelector('text=Score by identity', { timeout: 60_000 })
  .catch(() => dump('the example custom set never scored'))
check('nor for a pasted list', await cards() === 0, `${await cards()} seen`)

const scored = await page.evaluate(() =>
  (document.body.textContent.match(/(\d+) of (\d+) genes found in this object/) || [])[0])
console.log(`  ${scored}`)
check('and it actually scored something', /^[1-9]/.test(scored ?? ''), scored)
await page.screenshot({ path: `${shots}/sets-inline.png` })

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nThe small object never waited\n')
await browser.close()
process.exit(failed ? 1 : 0)
