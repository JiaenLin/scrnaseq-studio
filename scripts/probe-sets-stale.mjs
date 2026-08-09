// The one failure that would be worse than being slow: a score for a gene set
// the user has moved on from, shown under the name of the set they are looking
// at now.
//
//   node scripts/probe-sets-stale.mjs <url> <collection.zip> [shots-dir] [watch-seconds]
//
// The shape of the trap: score set A, ask for set B, and change your mind back
// to A while B is still reading the file. A comes back from the cache at once —
// and then B finishes. If B has anywhere to land, the table on screen becomes B's
// numbers under A's name, silently, and looks entirely plausible.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, shots = '.', watchArg = '90'] = process.argv.slice(2)
const watchFor = Number(watchArg) * 1000
const s = (ms) => `${(ms / 1000).toFixed(1)} s`
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
  await page.screenshot({ path: `${shots}/probe-stale-fail.png` })
  await browser.close()
  process.exit(1)
}

const readTable = () => page.evaluate(() => {
  const t = document.querySelector('table.t')
  if (!t) return null
  return [...t.querySelectorAll('tbody tr')].map(r =>
    [...r.querySelectorAll('td')].map(c => c.textContent.trim()))
})

await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 15 * 60 * 1000 })
  .catch(() => dump('the studio never reached the tab bar'))
await page.click('[role=tab]:has-text("Gene sets")')
await page.waitForSelector('text=Module score, per cell', { timeout: 60_000 })
  .catch(() => dump('the Gene sets card never appeared'))

const options = await page.$$eval('select[aria-label="Gene set"] option', os => os.map(o => o.value))
const A = options[0]
const B = options.find(v => v !== A)
console.log(`  A = ${A}   B = ${B}`)

console.log('\n=== score A all the way through ===')
let t = Date.now()
await page.waitForSelector('text=Score by identity', { timeout: 30 * 60 * 1000 })
  .catch(() => dump('set A never produced a table'))
const tableA = await readTable()
console.log(`  A scored in ${s(Date.now() - t)}, ${tableA.length} rows`)
check('A produced a table with numbers in it',
  tableA.some(r => r[2] !== '+0.00' || r[3] !== '+0.00'))

console.log('\n=== ask for B, change your mind back to A mid-pass ===')
await page.selectOption('select[aria-label="Gene set"]', B)
// The progress card is proof B's pass actually started; without it this test
// would pass by asking nothing.
const started = await page.waitForSelector('[role=status]', { timeout: 60_000 })
  .then(() => true).catch(() => false)
check('B started a pass (so there is something to go stale)', started)
await page.selectOption('select[aria-label="Gene set"]', A)

t = Date.now()
await page.waitForSelector('text=Score by identity', { timeout: 60_000 })
  .catch(() => dump('A did not come back from the cache'))
const backMs = Date.now() - t
const backTable = await readTable()
check('A came back at once, from the cache', backMs < 10_000, s(backMs))
check('and it is the same table A produced the first time',
  JSON.stringify(backTable) === JSON.stringify(tableA))

console.log(`\n=== watch for ${watchArg} s: B must never land ===`)
let changed = null
const deadline = Date.now() + watchFor
while (Date.now() < deadline) {
  await page.waitForTimeout(1000)
  const now = await readTable()
  if (JSON.stringify(now) !== JSON.stringify(tableA)) {
    changed = now
    break
  }
}
check(`the abandoned pass never overwrote the table (${watchArg} s)`, changed === null)
if (changed) {
  console.log('    was:', JSON.stringify(tableA.slice(0, 3)))
  console.log('    became:', JSON.stringify(changed.slice(0, 3)))
}
const heading = await page.textContent('figcaption')
check('and the figure is still named for the set on screen',
  /on the embedding/.test(heading ?? ''), heading)
await page.screenshot({ path: `${shots}/sets-stale.png` })

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nNo stale answer ever reached the page\n')
await browser.close()
process.exit(failed ? 1 : 0)
