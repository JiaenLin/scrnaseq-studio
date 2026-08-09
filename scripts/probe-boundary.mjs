// The error boundary's only executable test.
//
//   node scripts/probe-boundary.mjs <url> <collection.zip> [shots-dir]
//
// A boundary nobody has watched catch anything is a claim, not a component, and
// it cannot be tested off the page: react-dom/server does not run error
// boundaries at all (the throw comes straight back out of renderToStaticMarkup),
// so the only renderer that exercises this code is a real one. Hence Chromium,
// and hence the ?crash= fault injector in App.tsx — see the comment there.
//
// What is being asserted, in the order it matters:
//
//   1. a view that throws during render leaves the app standing. The white page
//      the verifier hit had no tab bar on it; this checks the tab bar is still
//      there and still carries every tab.
//   2. the other tabs still draw. Not "the DOM is non-empty" — an actual figure.
//   3. THE EXPENSIVE ONE: a pass already running survives the crash. The whole
//      argument for putting the boundary below App rather than around it is that
//      the cache and the task registry are keyed by a Source that App holds, so
//      this arms the fault while a real whole-transcriptome pass is in flight,
//      kills the view watching it, and then goes back and finds the same pass
//      still counting up from where it was. If that number ever restarts at
//      zero, the boundary is in the wrong place.
//   4. Try again clears the card, so a transient bad frame is not a dead tab.
//
// Every failure prints the page text before giving up, because a probe that says
// "timed out" about an app that was fine is how hours go missing here.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, shots = '.'] = process.argv.slice(2)
if (!url || !file) {
  console.log('usage: node scripts/probe-boundary.mjs <url> <collection.zip> [shots-dir]')
  process.exit(2)
}

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
// A deliberate crash logs its own stack, and that is the boundary working. Only
// the unexpected ones are worth printing.
const expected = /Deliberate fault in the/
page.on('pageerror', e => { if (!expected.test(e.message)) console.log(`  [page error] ${e.message}`) })

let failed = 0
const text = async () => (await page.textContent('body')).replace(/\s{3,}/g, '\n')
const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await text()).slice(0, 3000))
  await page.screenshot({ path: `${shots}/boundary-fail.png` })
  await browser.close()
  process.exit(1)
}
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Arm or disarm the fault WITHOUT navigating: a reload would close the object. */
const arm = (tab) => page.evaluate((t) => {
  const u = new URL(window.location.href)
  if (t) u.searchParams.set('crash', t)
  else u.searchParams.delete('crash')
  window.history.replaceState(null, '', u)
}, tab)

const tabNames = () => page.$$eval('[role=tab]', els => els.map(e => e.textContent.trim()))

/**
 * How far the running pass has got, or null if none is running.
 *
 * Through page.$ rather than page.textContent, and the difference is not style:
 * textContent(selector) AUTO-WAITS for the element, so asking "is a pass
 * running?" about an object that answers inline costs the full 30 s default
 * timeout per call. Polling that in a loop is how this probe spent twenty
 * minutes looking exactly like an app that had hung. page.$ returns null now.
 */
const genesDone = async () => {
  // Every status node, not the first. Markers mounts a second one while it
  // reads the winning genes' values ("Reading 505 genes from the file…"), and
  // that one carries no count — so asking only the first returns null there,
  // which is indistinguishable from "no pass is running". That is the answer
  // that makes a poller wait forever on exactly the window it should measure.
  for (const el of await page.$$('[role=status]')) {
    const m = /([\d,]+) of ([\d,]+) genes/.exec((await el.textContent()) || '')
    if (m) return +m[1].replace(/,/g, '')
  }
  return null
}
/** Markers says it is finished by titling the card, never by removing role=status alone. */
const markersFinished = () => page.$('text=/genes across \\d+ clusters/')

console.log(`\n=== opening ${file} ===`)
await page.goto(url, { waitUntil: 'load' })
await page.setInputFiles('input[type=file]', file)
try {
  await page.waitForSelector('[role=tab]', { timeout: 15 * 60 * 1000 })
  await page.waitForSelector('svg[role=img]', { timeout: 10 * 60 * 1000 })
} catch { await dump('the studio never reached a drawn Overview') }
const tabsAtStart = await tabNames()
console.log(`  open, ${tabsAtStart.length} tabs, Overview drew a figure`)

// --- 3. start something expensive, so the crash has something to destroy ------
console.log('\n=== a real pass, then a crash on top of it ===')
await page.click('[role=tab]:has-text("Markers")')
// role=status mounted is the ONLY reliable "a pass is running" signal in this
// app. A small object finishes before the first poll and never shows one, which
// is not a failure — it just means the survival check has nothing to measure.
let before = null
for (let i = 0; i < 40; i++) {
  before = await genesDone()
  if (before) break
  if (await markersFinished()) break
  await page.waitForTimeout(1000)
}
console.log(before
  ? `  pass in flight at ${before.toLocaleString()} genes`
  : '  no pass to measure (this object answers Markers before the first poll)')

await arm('markers')
await page.click('[role=tab]:has-text("Overview")')
await page.click('[role=tab]:has-text("Markers")')
await page.waitForTimeout(300)

// --- 1. the app is still standing --------------------------------------------
const body = await text()
check('the boundary caught it', /could not be drawn/.test(body), body.match(/The .* view could not be drawn/)?.[0])
check('the message is shown verbatim', /Deliberate fault in the Markers view/.test(body))
const tabsAfter = await tabNames()
check('the tab bar survived', tabsAfter.length === tabsAtStart.length,
  `${tabsAfter.length} of ${tabsAtStart.length} tabs`)
check('the object is still named in the header',
  /could not be drawn/.test(body) && (await page.textContent('header')).trim().length > 0)
await page.screenshot({ path: `${shots}/boundary-caught.png` })

// --- 2. the neighbours still work --------------------------------------------
await page.click('[role=tab]:has-text("Cells")')
await page.waitForTimeout(2500)
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return 0
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let ink = 0
  for (let i = 3; i < px.length; i += 4000) if (px[i] > 0) ink++
  return ink
})
check('Cells still draws after the crash', painted > 0, `${painted} sampled pixels painted`)
await page.click('[role=tab]:has-text("Composition")')
await page.waitForSelector('svg[role=img]', { timeout: 120_000 }).catch(() => {})
check('Composition still draws after the crash', await page.$('svg[role=img]') !== null)
await page.screenshot({ path: `${shots}/boundary-neighbour-alive.png` })

// --- 4. Try again, on the tab that is still armed ----------------------------
await page.click('[role=tab]:has-text("Markers")')
await page.waitForTimeout(200)
check('re-entering the broken tab shows the card again, not a white page',
  /could not be drawn/.test(await text()))
await arm(null)
await page.click('button:has-text("Try again")')
await page.waitForTimeout(500)
check('Try again clears the card once the fault is gone',
  !/could not be drawn/.test(await text()))

// --- 3, concluded: is the four-minute pass still the same pass? ---------------
if (before) {
  let after = null, done = null
  for (let i = 0; i < 30; i++) {
    done = await markersFinished()
    after = await genesDone()
    if (done || after) break
    await page.waitForTimeout(1000)
  }
  if (done) {
    check('the pass ran to completion across the crash', true,
      (await done.textContent()).replace(/\s+/g, ' ').trim())
  } else {
    // The number going UP is the claim. A restart would show a small number
    // after a large one, and that is what a boundary above App would produce.
    check('the pass never restarted', after !== null && after >= before,
      `${before.toLocaleString()} genes before the crash, ${after?.toLocaleString() ?? 'none'} after`)
  }
}
await page.screenshot({ path: `${shots}/boundary-recovered.png` })

// --- the escape hatch, from a tab that is not Markers ------------------------
console.log('\n=== the escape button ===')
await arm('composition')
await page.click('[role=tab]:has-text("Composition")')
await page.waitForTimeout(300)
check('a second tab is caught too', /could not be drawn/.test(await text()))
await arm(null)
await page.click('button:has-text("Go to Overview")')
await page.waitForSelector('svg[role=img]', { timeout: 60_000 }).catch(() => {})
check('the escape button lands on a working Overview',
  await page.$('svg[role=img]') !== null && !/could not be drawn/.test(await text()))

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
await browser.close()
process.exit(failed ? 1 : 0)
