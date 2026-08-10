// The Control / Compare pickers, exercised the way a reader uses them.
//
//   node scripts/probe-picker.mjs <url> [shots-dir]
//
// Run against the time course, which has four levels — the object where pooling
// is a real analysis choice and where the list is long enough to be clipped.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
const ok = (b, m) => console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`)

const browser = await chromium.launch({ executablePath: EXE })
// 1010: the width the failures were reported at.
const page = await browser.newPage({ viewport: { width: 1010, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.getByText('Time course', { exact: true }).click()
await page.waitForSelector('[role="tablist"]')
await page.getByRole('tab', { name: 'Differential expression' }).click()
await page.waitForTimeout(400)

const list = () => page.locator('[role="listbox"]')
const openControl = async () => {
  await page.getByRole('button', { name: /^Control/ }).or(
    page.locator('button[aria-haspopup="listbox"]').first()).click()
  await page.waitForTimeout(250)
}

/* ---- 1. the list is whole ---------------------------------------------- */
await openControl()
ok(await list().count() === 1, 'the Control list opened')

const geom = await page.evaluate(() => {
  const m = document.querySelector('[role="listbox"]')
  const r = m.getBoundingClientRect()
  const opts = [...m.querySelectorAll('[role="option"]')]
  // Every option must be inside the panel AND inside the window.
  const cut = opts.filter(o => {
    const q = o.getBoundingClientRect()
    return q.bottom > r.bottom + 1 || q.bottom > window.innerHeight
  }).map(o => o.textContent.trim())
  // And nothing up the tree may be clipping the panel.
  let clippedBy = null
  for (let n = m.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const cr = n.getBoundingClientRect()
      if (r.bottom > cr.bottom + 1) clippedBy = n.className.toString().slice(0, 30)
      break
    }
  }
  const nameOf = (o) => o.querySelector('span:last-child').textContent.trim()
  return { n: opts.length, labels: opts.map(nameOf), cut, clippedBy,
    height: Math.round(r.height) }
})
ok(geom.n === 4, `all four levels are listed (${geom.labels.join(', ')})`)
ok(geom.cut.length === 0, `none is cut off${geom.cut.length ? ` — ${geom.cut.join(', ')}` : ''}`)
ok(geom.clippedBy === null, `no ancestor clips it${geom.clippedBy ? ` — .${geom.clippedBy}` : ''}`)
await page.screenshot({ path: `${shots}/picker-open.png`, clip: { x: 0, y: 0, width: 1010, height: 380 } })

/* ---- 2. the other side's levels are refused ---------------------------- */
const taken = await page.evaluate(() =>
  [...document.querySelectorAll('[role="option"]')]
    .filter(o => o.disabled).map(o => o.querySelector('span:last-child').textContent.trim()))
ok(taken.length >= 1, `the compare side's level is disabled here (${taken.join(', ') || 'none'})`)

/* ---- 3. pooling adds, and the last level cannot be removed ------------- */
// By index, not by accessible name. Matching on the name was silently finding
// nothing — the tick glyph was part of it, so `exact: 'X'` never matched the
// selected option and the removal assertion below proved precisely nothing.
const option = (i) => page.locator('[role="option"]').nth(i)
const trigger = () => page.locator('button[aria-haspopup="listbox"]').first()
const enabled = []
for (let i = 0; i < geom.n; i++) {
  if (await option(i).isEnabled()) enabled.push(i)
}
ok(enabled.length >= 2, `at least two levels are selectable (${enabled.length})`)

const before = (await trigger().textContent()).trim()
const second = enabled.find(i => geom.labels[i] !== before)
await option(second).click()
await page.waitForTimeout(250)
let text = (await trigger().textContent()).trim()
ok(text.includes('+'), `two levels pool into one label ("${before}" -> "${text}")`)

// Take one away: it must actually go.
await option(second).click()
await page.waitForTimeout(250)
const afterOne = (await trigger().textContent()).trim()
ok(!afterOne.includes('+'), `removing one actually removes it ("${afterOne}")`)

// Take the last away: it must refuse, and the label must not empty.
const lastIdx = geom.labels.indexOf(afterOne)
ok(lastIdx >= 0, `the label names a real level ("${afterOne}")`)
await option(lastIdx).click()
await page.waitForTimeout(250)
text = (await trigger().textContent()).trim()
ok(text === afterOne, `the last level refuses to be removed (still "${text}")`)

/* ---- 4. it closes, and Escape closes it ------------------------------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
ok(await list().count() === 0, 'Escape closes it')

await openControl()
await page.mouse.click(600, 700)
await page.waitForTimeout(250)
ok(await list().count() === 0, 'a click outside closes it')

/* ---- 5. the label survives, and Run is still reachable ---------------- */
const runs = await page.getByRole('button', { name: 'Run', exact: true }).count()
ok(runs <= 1, `at most one Run button (${runs})`)

if (errors.length) console.log(`\n  ERRORS\n   ${errors.join('\n   ')}`)
else console.log('\n  no page errors')

await browser.close()
