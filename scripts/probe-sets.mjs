// Drive the Gene sets tab in a real browser, and measure what a user feels.
//
//   node scripts/probe-sets.mjs <url> <collection.zip> [shots-dir] [expected.json]
//
// Three things are being watched, and only one of them is the speed:
//
//   the tab stays alive     — a rAF loop counts frames while the score computes
//   the progress is honest  — the phase names the pass that is actually running
//   the numbers are right   — the per-identity table is compared, digit for
//                             digit, against the same score computed in Node
//
// Every assertion is on a string grepped from the source, and every miss prints
// the page text: a silent false negative looks exactly like a hang.

import fs from 'node:fs'
import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, shots = '.', expectedPath] = process.argv.slice(2)
const s = (ms) => `${(ms / 1000).toFixed(1)} s`
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))
page.on('console', m => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`) })

const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 4000))
  await page.screenshot({ path: `${shots}/probe-sets-fail.png` })
  await browser.close()
  process.exit(1)
}

const startBeat = () => page.evaluate(() => {
  window.__beat = { frames: 0, worst: 0, last: performance.now() }
  const tick = () => {
    const now = performance.now()
    const gap = now - window.__beat.last
    window.__beat.last = now
    window.__beat.frames++
    if (gap > window.__beat.worst) window.__beat.worst = gap
    window.__beat.raf = requestAnimationFrame(tick)
  }
  window.__beat.raf = requestAnimationFrame(tick)
})
const readBeat = () => page.evaluate(() => {
  cancelAnimationFrame(window.__beat.raf)
  return { frames: window.__beat.frames, worst: window.__beat.worst }
})

/** The per-identity table, as the page renders it. */
const readTable = () => page.evaluate(() => {
  const t = document.querySelector('table.t')
  if (!t) return null
  return [...t.querySelectorAll('tbody tr')].map(r =>
    [...r.querySelectorAll('td')].map(c => c.textContent.trim()))
})

await page.goto(url, { waitUntil: 'load' })

console.log('=== opening the object ===')
let t = Date.now()
await page.setInputFiles('input[type=file]', file)
try {
  await page.waitForSelector('[role=tab]', { timeout: 15 * 60 * 1000 })
} catch { await dump('the studio never reached the tab bar') }
console.log(`  tab bar in ${s(Date.now() - t)}`)

console.log('\n=== Gene sets ===')
t = Date.now()
await page.click('[role=tab]:has-text("Gene sets")')
try {
  await page.waitForSelector('text=Module score, per cell', { timeout: 60_000 })
} catch { await dump('the Gene sets card never appeared') }
console.log(`  card up in ${s(Date.now() - t)}`)

// --- the progress card, and whether it says what is actually happening -------
const t0 = Date.now()
let sawBins = false
let sawScore = false
let firstProgress = null
const phases = []
const watch = setInterval(async () => {
  try {
    const txt = await page.textContent('[role=status]')
    if (!txt) return
    if (firstProgress === null) firstProgress = Date.now() - t0
    if (/expression bins/.test(txt) && !sawBins) { sawBins = true; phases.push('expression bins') }
    if (/module score/.test(txt) && !sawScore) { sawScore = true; phases.push('module score') }
  } catch { /* the card is gone, which is the answer */ }
}, 120)

// --- ask the question ---------------------------------------------------------
// Typing into a control while the object is being read is the thing that felt
// worst before: every keystroke waited for the whole pass.
const want = expectedPath && fs.existsSync(expectedPath)
  ? JSON.parse(fs.readFileSync(expectedPath, 'utf8'))
  : null
const CUSTOM = want?.custom ?? 'MS4A1, CD79A, CD79B'
await page.click('button:has-text("My own genes")')
await startBeat()
const typed = Date.now()
await page.type('input[aria-label="Custom gene set"]', CUSTOM, { delay: 60 })
const typing = await readBeat()
const typedValue = await page.inputValue('input[aria-label="Custom gene set"]')
console.log(`  typing the list: ${CUSTOM.length} keystrokes in ${s(Date.now() - typed)}, `
  + `${typing.frames} frames, worst gap ${typing.worst.toFixed(0)} ms`)
check('every keystroke landed', typedValue === CUSTOM, typedValue)

// A list this object does not measure is a legitimate answer — "nothing to
// score" — and it renders no table and starts no pass. Waiting for one would
// then look exactly like a four-minute hang, and would be reported as one
// twenty minutes later. It cost this probe a whole run before it was checked.
const found = await page.evaluate(() => {
  const m = document.body.textContent.match(/(\d+) of (\d+) genes found in this object/)
  return m ? { used: +m[1], asked: +m[2] } : null
})
console.log(`  the object measures ${found?.used ?? '?'} of the ${found?.asked ?? '?'} typed genes`)
if (!found || found.used === 0) {
  await dump(`none of "${CUSTOM}" are measured here — pick genes this object carries`)
}

// --- while it computes, use the tab ------------------------------------------
// Measured only from here: everything above ran with the default set selected,
// and if that set matches nothing the page is idle, so a beautiful frame rate
// there would mean nothing at all.
const running = await page.waitForSelector('[role=status]', { timeout: 120_000 })
  .then(() => true).catch(() => false)
check('a pass is actually running before anything is measured', running)
if (!running) await dump('no progress card, so there is nothing to be responsive during')

await startBeat()
await page.waitForTimeout(4000)
const idle = await readBeat()
console.log(`  idle while scoring: ${idle.frames} frames in 4 s, worst gap ${idle.worst.toFixed(0)} ms`)

await startBeat()
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 220)
  await page.waitForTimeout(120)
}
const scrolled = await readBeat()
console.log(`  scrolling while scoring: ${scrolled.frames} frames, worst gap `
  + `${scrolled.worst.toFixed(0)} ms, scrollY=${await page.evaluate(() => window.scrollY)}`)
await page.evaluate(() => window.scrollTo(0, 0))

// NOT a tab switch here, however tempting.
//
// Leaving the tab unmounts GeneSets, and the set being scored is that
// component's own useState — so coming back selects the first built-in set
// again. On an object whose genes are Ensembl IDs that set matches nothing, the
// card correctly says there is nothing to score, and a probe waiting for a table
// waits for one that is never coming. It read as a fifteen-minute hang, and it
// was a probe changing the question and then complaining about the answer. The
// tab switch is worth testing and is tested below, once there is a result to
// come back to.

// The custom list is now the question being asked, and the built-in set's pass
// must have been abandoned rather than allowed to land on top of it.
try {
  await page.waitForSelector('text=Score by identity', { timeout: 20 * 60 * 1000 })
} catch { await dump('the custom set never produced a table') }
clearInterval(watch)
const customMs = Date.now() - t0
console.log(`  custom set scored in ${s(customMs)}`)
console.log(`  phases seen: ${phases.join(' → ') || '(none — too fast to catch)'}`)
check('the bar named the pass that was running, not a generic spinner',
  phases.length > 0 || customMs < 1500, phases.join(' → '))

/** The table, once it has settled on the expected number of rows. */
async function settled(rows) {
  for (let i = 0; i < 60; i++) {
    const got = await readTable()
    if (got && got.length === rows.length && JSON.stringify(got) === JSON.stringify(rows)) return got
    await page.waitForTimeout(500)
  }
  return readTable()
}

const customTable = await readTable()
check('the table has a row per identity', Array.isArray(customTable) && customTable.length > 0,
  `${customTable?.length ?? 0} rows`)
check('and the score is not flat — the figure says something',
  customTable?.some(r => r[2] !== '+0.00' && r[2] !== '-0.00'))
await page.screenshot({ path: `${shots}/sets-custom.png` })

// --- the typed set's numbers, BEFORE anything can change the question ---------
// Leaving this until after the tab switch below compared the wrong table for one
// run: the switch remounts the card and re-selects the first built-in set, so
// what is on screen afterwards is a different set's answer and is entirely
// correct for the set it belongs to.
if (want?.customRows) {
  const gotCustom = await settled(want.customRows)
  const sameCustom = JSON.stringify(gotCustom) === JSON.stringify(want.customRows)
  check('the typed set shows ITS numbers, not the abandoned pass\'s', sameCustom)
  if (!sameCustom) {
    console.log('    page:', JSON.stringify(gotCustom?.slice(0, 4)))
    console.log('    node:', JSON.stringify(want.customRows.slice(0, 4)))
  }
}

// --- the heaviest thing left on the main thread -------------------------------
// Cells paints one arc per cell. That is not a pass and cannot be handed to a
// worker without an OffscreenCanvas, so it is measured rather than claimed.
await startBeat()
const swap = Date.now()
await page.click('[role=tab]:has-text("Cells")')
await page.waitForTimeout(3000)
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return 'no canvas'
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let ink = 0
  for (let i = 3; i < px.length; i += 4000) if (px[i] > 0) ink++
  return `${c.width}x${c.height}, ${ink}/${Math.ceil(px.length / 4000)} sampled pixels painted`
})
const swapped = await readBeat()
console.log(`  Cells drew in ${s(Date.now() - swap)}: ${painted}`)
console.log(`  ${swapped.frames} frames during the switch, worst gap ${swapped.worst.toFixed(0)} ms`
  + ' (this is canvas painting, not the score)')
await page.click('[role=tab]:has-text("Gene sets")')
await page.waitForTimeout(800)

// --- the numbers -------------------------------------------------------------
// Only when a reference exists. On an object whose genes are Ensembl IDs there
// is no built-in set to compare against, and this file may carry a gene list
// alone — the responsiveness and cancellation checks above still stand.
if (want?.rows) {
  // Back to the built-in set the reference was computed for.
  await page.click('button:has-text("Built-in set")')
  await page.selectOption('select[aria-label="Gene set"]', want.setId)
  await page.waitForTimeout(300)
  try {
    await page.waitForSelector('text=Score by identity', { timeout: 20 * 60 * 1000 })
  } catch { await dump('the built-in set never produced a table') }
  const got = await settled(want.rows)
  const same = JSON.stringify(got) === JSON.stringify(want.rows)
  check(`the worker's numbers are Node's numbers, digit for digit (${want.setId})`, same)
  if (!same) {
    console.log('    page:', JSON.stringify(got?.slice(0, 4)))
    console.log('    node:', JSON.stringify(want.rows.slice(0, 4)))
  }
  await page.screenshot({ path: `${shots}/sets-builtin.png` })

  // Asked again, the answer must come back without re-reading the file.
  await page.click('[role=tab]:has-text("Cells")')
  await page.waitForTimeout(400)
  const back = Date.now()
  await page.click('[role=tab]:has-text("Gene sets")')
  await page.waitForSelector('text=Score by identity', { timeout: 60_000 })
    .catch(() => dump('the remembered answer did not come back'))
  console.log(`  the same set again, after a tab switch: ${s(Date.now() - back)} (remembered)`)
  check('a set already scored comes back without another pass', Date.now() - back < 8000)
  check('and it is still the same table', JSON.stringify(await readTable()) === JSON.stringify(want.rows))
}

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nGene sets: everything checked passed\n')
await browser.close()
process.exit(failed ? 1 : 0)
