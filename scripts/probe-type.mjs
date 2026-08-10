// Every distinct way text is styled in the studio, counted.
//
//   node scripts/probe-type.mjs <url> [demo]
//
// A type system is not "how many sizes" — it is how many (size, weight, colour)
// COMBINATIONS a reader has to learn. Five sizes used at four weights in six
// greys is thirty things to tell apart. This lists them, with where each one
// appears and how rare it is, so the one-off can be found and removed.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', demo = 'cohort'] = process.argv.slice(2)
const LABEL = { cohort: 'Replicated cohort', course: 'Time course', wt: 'Wild type only' }

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByText(LABEL[demo], { exact: true }).click()
await page.waitForSelector('[role="tablist"]')

const styles = () => page.evaluate(() => {
  const seen = new Map()
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('svg')) continue
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
    const cs = getComputedStyle(el)
    const key = [
      cs.fontSize,
      cs.fontWeight,
      cs.color,
      cs.textTransform === 'uppercase' ? 'UPPER' : '',
      cs.fontFamily.includes('mono') || cs.fontFamily.includes('Consolas') ? 'mono' : '',
    ].filter(Boolean).join(' / ')
    const at = seen.get(key) ?? { n: 0, sample: '', where: new Set() }
    at.n++
    if (!at.sample) at.sample = el.textContent.trim().slice(0, 30)
    at.where.add((el.className.toString().split(' ')[0] || el.tagName.toLowerCase()).slice(0, 18))
    seen.set(key, at)
  }
  return [...seen.entries()].map(([k, v]) => [k, v.n, v.sample, [...v.where].slice(0, 3).join(',')])
})

const tabs = await page.$$eval('[role="tab"]',
  els => els.filter(e => !e.disabled).map(e => e.textContent.trim()))

const all = new Map()
for (const t of tabs) {
  await page.getByRole('tab', { name: t, exact: true }).click()
  await page.waitForTimeout(450)
  for (const [k, n, sample, where] of await styles()) {
    const at = all.get(k) ?? { n: 0, sample, where, tabs: new Set() }
    at.n += n
    at.tabs.add(t.split(' ')[0])
    all.set(k, at)
  }
}

const rows = [...all.entries()].sort((a, b) => b[1].n - a[1].n)
console.log(`\n${rows.length} distinct text styles across ${tabs.length} tabs\n`)
console.log('  count  style'.padEnd(62) + 'where / sample')
for (const [k, v] of rows) {
  const rare = v.n <= 3 ? '  <-- one-off' : ''
  console.log(`  ${String(v.n).padStart(5)}  ${k.padEnd(52)}${v.where}  "${v.sample}"${rare}`)
}

// Greys are the other half of the mess: six near-identical ink values read as
// carelessness even when every size is on the scale.
const inks = new Map()
for (const [k, v] of rows) {
  const c = k.split(' / ').find(p => p.startsWith('rgb'))
  inks.set(c, (inks.get(c) ?? 0) + v.n)
}
console.log(`\n  ${inks.size} distinct text colours:`)
for (const [c, n] of [...inks.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${c.padEnd(22)} x${n}`)
}

await browser.close()
