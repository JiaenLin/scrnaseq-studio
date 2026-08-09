// Drive the three contrast tabs in a real browser, on the real atlas.
//
//   node scripts/probe-de-views.mjs <url> <collection.zip> [shots-dir]
//
// What is being checked is not "does it finish" — the bench proves the numbers.
// It is the four things a user feels: the tab stays alive while it computes, the
// progress is honest, changing the question abandons the old one instead of
// queueing behind it, and a small object never sees any of this machinery.
//
// Every assertion is on a string grepped from the source, and every miss prints
// the page text. A silent false negative looks exactly like a hang.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, collection, shots = '.'] = process.argv.slice(2)
const s = (ms) => `${(ms / 1000).toFixed(1)} s`

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log(`  [page error] ${e.message}`))
page.on('console', m => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`) })

let failed = 0
const bad = (why) => { failed++; console.log(`  !! ${why}`) }

const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 4000))
  await page.screenshot({ path: `${shots}/probe-de-fail.png` })
  await browser.close()
  process.exit(1)
}

/** rAF frames over a known window: on a blocked main thread rAF does not fire. */
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

/** The progress card, as the user reads it: its title and how many genes in. */
const status = () => page.evaluate(() => {
  const el = document.querySelector('[role=status]')
  if (!el) return null
  const text = el.textContent.replace(/\s+/g, ' ').trim()
  const m = text.match(/([\d,]+) of ([\d,]+) genes/)
  return {
    text,
    done: m ? +m[1].replace(/,/g, '') : 0,
    total: m ? +m[2].replace(/,/g, '') : 0,
  }
})

/**
 * Wait until the pass has reported once, so `total` is a real number.
 *
 * A tab that mounts into a pass already in flight paints once before its effect
 * subscribes, so there is a frame with no card at all — polling rather than
 * reading once is what tells a mount apart from a finished pass.
 */
const firstReport = async (limitMs = 60_000) => {
  const until = Date.now() + limitMs
  while (Date.now() < until) {
    const st = await status()
    if (st && st.total > 0) return st
    await page.waitForTimeout(200)
  }
  return null
}

const settings = () => page.evaluate(() => {
  const sel = [...document.querySelectorAll('select.sel')]
  return { ct: sel[0]?.value, ctrl: sel[1]?.value, cs: sel[2]?.value }
})

// The contrast this drives. Measured from the object rather than guessed: the
// studio opens on the first cell type and the two extreme timepoints, and in
// this atlas almost no cell type exists at both e7.0 and e18.0 — that contrast
// is correctly empty, and an empty contrast never starts a pass, so it cannot
// test anything below. These two stages share the large neuronal populations.
const CTRL = 'e15.0'
const CS = 'e18.0'
const TYPE = 'Cortical or hippocampal glutamatergic'   // 4 123 vs 4 515 cells
const OTHER = 'Forebrain GABAergic'                    //   686 vs 3 557 cells

// ---------------------------------------------------------------------------
console.log('=== opening the atlas ===')
await page.goto(url, { waitUntil: 'load' })
let t = Date.now()
await page.setInputFiles('input[type=file]', collection)
try {
  await page.waitForSelector('[role=tab]', { timeout: 20 * 60 * 1000 })
} catch { await dump('the studio never reached the tab bar') }
console.log(`  open in ${s(Date.now() - t)}`)
let start = await settings()
console.log(`  opens on: cell type "${start.ct}" · control "${start.ctrl}" · compare "${start.cs}"`)
if (!start.ctrl || start.ctrl === start.cs) {
  await dump('this object has no usable contrast, so nothing below can be tested')
}

// An empty contrast must say so rather than sit behind a bar that never moves.
console.log('\n=== a contrast with no cells on one side ===')
await page.click('[role=tab]:has-text("DEG table")')
const said = await page.waitForSelector(`text=/No .* cells in one of these groups/`, { timeout: 60_000 })
  .then(h => h.textContent(), () => null)
const emptyStatus = await status()
console.log(`  progress card: ${emptyStatus ? 'SHOWN' : 'none'}`)
console.log(`  page says: "${(said ?? '(never said anything)').replace(/\s+/g, ' ').trim()}"`)
if (!said) bad('an empty contrast neither computed nor explained itself')
if (emptyStatus) bad('an empty contrast started a pass over the file')

await page.selectOption('select.sel >> nth=1', CTRL)
await page.selectOption('select.sel >> nth=2', CS)
await page.selectOption('select.sel >> nth=0', TYPE)
start = await settings()
console.log(`\n  driving: cell type "${start.ct}" · control "${start.ctrl}" · compare "${start.cs}"`)

// ---------------------------------------------------------------------------
console.log('\n=== DEG table starts a pass ===')
t = Date.now()
try {
  // The exact sentence Stats.tsx builds in `testing`.
  await page.waitForSelector(`text=Testing every gene in ${start.ct}: ${start.cs} against ${start.ctrl}`,
    { timeout: 60_000 })
} catch { await dump('the DEG table never showed a progress card') }
console.log(`  progress card up in ${s(Date.now() - t)}`)
const first = await firstReport()
if (!first) await dump('the pass never reported any progress')
console.log(`  says: "${first.text.slice(0, 140)}"`)
if (first.total !== 31053) bad(`the total should be every gene in the object, got ${first.total}`)

// --- the tab stays alive -----------------------------------------------------
await startBeat()
await page.waitForTimeout(4000)
const idle = await readBeat()
console.log(`  idle while computing: ${idle.frames} frames in 4 s, worst gap ${idle.worst.toFixed(0)} ms`)
if (idle.frames < 60) bad(`only ${idle.frames} frames in 4 s — the tab is blocked`)

await startBeat()
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(100) }
const scrolled = await readBeat()
console.log(`  scrolling while computing: ${scrolled.frames} frames, worst gap ${scrolled.worst.toFixed(0)} ms, `
  + `scrollY=${await page.evaluate(() => window.scrollY)}`)
await page.evaluate(() => window.scrollTo(0, 0))

await page.click('[role=tab]:has-text("Gene expression")')
await page.waitForSelector('input[aria-label="Search a gene or paste a gene list"]', { timeout: 60_000 })
  .catch(() => dump('the gene box never appeared'))
const typeT = Date.now()
await page.type('input[aria-label="Search a gene or paste a gene list"]', 'Sox2', { delay: 60 })
const typed = await page.inputValue('input[aria-label="Search a gene or paste a gene list"]')
console.log(`  typed "Sox2" while computing: got "${typed}" in ${s(Date.now() - typeT)}`)
if (typed !== 'Sox2') bad(`the gene box swallowed keystrokes: "${typed}"`)

// --- the volcano and enrichment join the pass, they do not start their own ---
console.log('\n=== the other two tabs join the same pass ===')
await page.click('[role=tab]:has-text("DEG table")')
const beforeHop = await firstReport()
await page.click('[role=tab]:has-text("Volcano")')
await page.waitForTimeout(1200)
const onVolcano = await firstReport()
await page.click('[role=tab]:has-text("Enrichment")')
await page.waitForTimeout(1200)
const onEnrich = await firstReport()
console.log(`  DEG table ${beforeHop?.done} → Volcano ${onVolcano?.done} → Enrichment ${onEnrich?.done} genes`)
if (!onVolcano || !onEnrich) bad('a contrast tab lost the running pass')
else if (onVolcano.done < beforeHop.done || onEnrich.done < onVolcano.done) {
  bad('the gene count went backwards — a tab switch restarted the pass')
}
await page.screenshot({ path: `${shots}/de-progress.png` })

// --- changing the question abandons the old one ------------------------------
console.log('\n=== changing the cell type mid-pass ===')
await page.click('[role=tab]:has-text("DEG table")')
const stale = await firstReport()
if (!stale) await dump('the pass ended before the cell type could be changed')
const types = await page.evaluate(() =>
  [...document.querySelectorAll('select.sel')][0].options.length)
const other = OTHER
t = Date.now()
await page.selectOption('select.sel >> nth=0', other)
let restarted = null
for (let i = 0; i < 120; i++) {
  const st = await status()
  if (st && st.text.includes(`Testing every gene in ${other}`)) { restarted = st; break }
  await page.waitForTimeout(250)
}
if (!restarted) await dump(`switching to "${other}" never started a new pass`)
console.log(`  ${types} cell types; switched to "${other}" — new pass titled in ${s(Date.now() - t)}`)
console.log(`  the abandoned pass was at ${stale.done} genes; the new one begins at ${restarted.done}`)
if (restarted.done > stale.done) {
  bad('the new pass began where the old one left off — it queued behind it instead of replacing it')
}
// It must be running, not stalled behind the old job.
await page.waitForTimeout(4000)
const moving = await status()
if (moving && moving.done <= restarted.done) {
  bad(`the new pass is not moving (${restarted.done} → ${moving.done}) — the old one still holds the worker`)
} else if (moving) {
  console.log(`  and it is moving: ${restarted.done} → ${moving.done} genes in 4 s`)
}

// Back to where we started, so the run below is the contrast we named.
await page.selectOption('select.sel >> nth=0', start.ct)
await page.waitForTimeout(500)

// --- and it finishes ---------------------------------------------------------
console.log('\n=== the answer lands ===')
const t0 = Date.now()
await startBeat()
try {
  await page.waitForSelector('text=/differentially expressed genes/', { timeout: 40 * 60 * 1000 })
} catch { await dump('the DEG table never finished') }
const tail = await readBeat()
console.log(`  finished in ${s(Date.now() - t0)}; ${tail.frames} frames during the rest of the pass, `
  + `worst gap ${tail.worst.toFixed(0)} ms`)
const heading = (await page.textContent('h2')).replace(/\s+/g, ' ').trim()
const eyebrow = (await page.textContent('.eyebrow')).replace(/\s+/g, ' ').trim()
console.log(`  heading: "${heading}"`)
console.log(`  eyebrow: "${eyebrow}"`)
const now = await settings()
if (!eyebrow.includes(now.ct) || !eyebrow.includes(now.cs) || !eyebrow.includes(now.ctrl)) {
  bad(`the result is labelled "${eyebrow}" but the selection is ${now.cs} vs ${now.ctrl} · ${now.ct}`)
}
const rowCount = await page.evaluate(() => document.querySelectorAll('table.t tbody tr').length)
console.log(`  ${rowCount} rows drawn`)
await page.screenshot({ path: `${shots}/de-table.png` })

// --- the answer on screen must belong to the question on screen --------------
//
// The one failure that matters. Ask for A, change to B while A is still
// running, change back to A: B's pass is abandoned mid-flight and A is answered
// from its cache. The heading must be A's — not B's, and not a number from
// whichever pass happened to finish last. It is compared against the number A
// gave when it ran alone, two paragraphs above.
console.log('\n=== switching away and back mid-pass ===')
const truth = heading
await page.selectOption('select.sel >> nth=0', OTHER)
if (!await firstReport(30_000)) bad(`switching to "${OTHER}" started nothing`)
await page.waitForTimeout(6000)
const midB = await status()
await page.selectOption('select.sel >> nth=0', TYPE)
const backA = await firstReport(8000)
console.log(`  ${OTHER} reached ${midB?.done ?? 0} genes and was abandoned; back on ${TYPE}: `
  + (backA ? `a new pass from ${backA.done}` : 'answered from the cache, no pass'))
try {
  await page.waitForSelector('text=/differentially expressed genes/', { timeout: 20 * 60 * 1000 })
} catch { await dump('the returned-to contrast never finished') }
await page.waitForTimeout(500)
const after = (await page.textContent('h2')).replace(/\s+/g, ' ').trim()
const eyebrowAfter = (await page.textContent('.eyebrow')).replace(/\s+/g, ' ').trim()
console.log(`  heading: "${after}"  (alone it was "${truth}")`)
console.log(`  eyebrow: "${eyebrowAfter}"`)
if (after !== truth) bad(`the answer changed under the same question: "${truth}" then "${after}"`)
if (!eyebrowAfter.includes(TYPE)) bad(`the result is labelled "${eyebrowAfter}", not ${TYPE}`)

// --- the threshold sliders filter, they do not recompute ---------------------
console.log('\n=== moving a threshold must not re-read the file ===')
await page.evaluate(() => {
  const el = document.querySelector('input[aria-label="Fold change threshold"]')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, '1.5')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(1200)
const afterSlider = await status()
const stillThere = await page.$('text=/differentially expressed genes/')
console.log(`  progress card after moving |log2FC|: ${afterSlider ? 'SHOWN' : 'none'}; `
  + `table still rendered: ${!!stillThere}`)
if (afterSlider) bad('moving a threshold restarted the computation')
const heading2 = (await page.textContent('h2')).replace(/\s+/g, ' ').trim()
console.log(`  heading now: "${heading2}"`)

// Dragging it, not nudging it once: every tick re-filters and re-sorts the rows
// on the main thread, which is the one heavy thing left in these views.
await startBeat()
const dragT = Date.now()
for (let i = 0; i <= 20; i++) {
  await page.evaluate(v => {
    const el = document.querySelector('input[aria-label="Adjusted p-value threshold"]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, (i % 10) + 1)
}
const drag = await readBeat()
console.log(`  21 padj-slider ticks in ${s(Date.now() - dragT)}: ${drag.frames} frames, `
  + `worst gap ${drag.worst.toFixed(0)} ms`)
if (drag.worst > 250) bad(`dragging the padj slider stalls the tab for ${drag.worst.toFixed(0)} ms`)

// --- the volcano and enrichment are instant off the cache --------------------
console.log('\n=== the other two tabs read the cached answer ===')
// Back to the default cutoffs first, so enrichment is asked about the whole
// significant list rather than the handful the dragged slider left.
await page.click('button:has-text("Reset")')
await page.waitForTimeout(400)
console.log(`  after Reset: "${(await page.textContent('h2')).replace(/\s+/g, ' ').trim()}"`)
t = Date.now()
await page.click('[role=tab]:has-text("Volcano")')
await page.waitForSelector('svg[aria-label^="Volcano plot"]', { timeout: 60_000 })
  .catch(() => dump('the volcano never drew'))
const volcanoMs = Date.now() - t
const volcanoStatus = await status()
const points = await page.evaluate(() =>
  document.querySelectorAll('svg[aria-label^="Volcano plot"] circle').length)
console.log(`  Volcano in ${s(volcanoMs)}, ${points} points, progress card: ${volcanoStatus ? 'SHOWN' : 'none'}`)
if (volcanoStatus) bad('the volcano recomputed instead of reading the cache')
await page.screenshot({ path: `${shots}/de-volcano.png` })

await startBeat()
await page.waitForTimeout(2500)
const volcanoBeat = await readBeat()
console.log(`  volcano idle: ${volcanoBeat.frames} frames in 2.5 s, worst gap ${volcanoBeat.worst.toFixed(0)} ms`)
if (volcanoBeat.frames < 30) bad(`the volcano itself blocks the tab (${volcanoBeat.frames} frames in 2.5 s)`)

t = Date.now()
await page.click('[role=tab]:has-text("Enrichment")')
await page.waitForSelector('text=/enriched set/', { timeout: 5 * 60 * 1000 })
  .catch(() => dump('enrichment never produced a result'))
const enrichMs = Date.now() - t
const enrichStatus = await status()
console.log(`  Enrichment in ${s(enrichMs)}, progress card: ${enrichStatus ? 'SHOWN' : 'none'}`)
if (enrichStatus) bad('enrichment recomputed the contrast instead of following it')
const enrichHead = (await page.textContent('h2')).replace(/\s+/g, ' ').trim()
const enrichSub = (await page.textContent('.sub, p')).replace(/\s+/g, ' ').trim()
console.log(`  says: "${enrichHead}"`)
console.log(`  over: "${enrichSub.slice(0, 120)}"`)
await page.screenshot({ path: `${shots}/de-enrichment.png` })

// --- the pseudobulk branch reads summed counts, never the matrix -------------
//
// It has nothing per-gene to do: the summed counts came in with the object and
// the design is counted off the cell metadata, so there is nothing here for a
// worker to take. What must be true is that it is instant and that it starts no
// pass — and, where it is refused, that it says why.
const pbBranch = async (p, where) => {
  console.log(`\n=== the pseudobulk branch (${where}) ===`)
  await p.click('[role=tab]:has-text("DEG table")')
  await p.waitForTimeout(300)
  const btn = await p.$('.seg button:has-text("Pseudobulk")')
  const off = await btn.isDisabled()
  if (off) {
    const why = (await btn.getAttribute('title')) ?? ''
    console.log(`  offered: no — "${why.replace(/\s+/g, ' ').trim()}"`)
    if (!why.trim()) bad('pseudobulk is refused without saying why')
    return
  }
  const t3 = Date.now()
  await p.click('.seg button:has-text("Pseudobulk")')
  await p.waitForTimeout(1200)
  const pbStatus = await p.evaluate(() => !!document.querySelector('[role=status]'))
  const pbText = (await p.textContent('main')).replace(/\s+/g, ' ').trim()
  const pbSays = ['matrix is here', 'Not enough samples', 'carries no raw counts']
    .find(k => pbText.includes(k)) ?? '(nothing recognisable)'
  console.log(`  offered: yes — rendered in ${s(Date.now() - t3)}, panel says: ${pbSays}`)
  console.log(`  progress card: ${pbStatus ? 'SHOWN' : 'none'}`)
  if (pbStatus) bad('the pseudobulk branch started a pass over the matrix')
  if (pbSays === '(nothing recognisable)') bad('the pseudobulk panel said nothing recognisable')
  await p.screenshot({ path: `${shots}/de-pseudobulk-${where}.png` })
  await p.click('.seg button:has-text("Wilcoxon")')
  await p.waitForTimeout(600)
  const back = await p.evaluate(() => !!document.querySelector('[role=status]'))
  console.log(`  back on Wilcoxon: progress card ${back ? 'SHOWN (recomputing)' : 'none (cached)'}`)
  if (back) bad('leaving and returning to Wilcoxon re-read the file')
}
await pbBranch(page, 'atlas')

// ---------------------------------------------------------------------------
// An object whose matrix is already in memory must take the path it always
// took: computed during render, no worker, no progress card, no extra frame.
// The demo object is the one that can prove it — the small pbmc3k file is a
// one-part COLLECTION, so it is remote by construction, and it carries a single
// condition, so it has no contrast to run at all.
console.log('\n=== an in-memory object must not gain any of this ===')
const page2 = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page2.on('pageerror', e => console.log(`  [page error] ${e.message}`))
await page2.goto(url, { waitUntil: 'load' })
await page2.click('button:has-text("Replicated cohort")')
await page2.waitForSelector('[role=tab]', { timeout: 60_000 })
const small = await page2.evaluate(() => {
  const sel = [...document.querySelectorAll('select.sel')]
  return { ct: sel[0]?.value, ctrl: sel[1]?.value, cs: sel[2]?.value }
})
console.log(`  opened the demo: cell type "${small.ct}" · control "${small.ctrl}" · compare "${small.cs}"`)
if (!small.ctrl || small.ctrl === small.cs) {
  bad('the demo object lost its contrast — nothing below can be tested')
} else {
  // Installed BEFORE the click: an inline computation runs during render, so
  // there must not be even one frame in which a progress card existed.
  await page2.evaluate(() => {
    window.__sawStatus = false
    new MutationObserver(() => {
      if (document.querySelector('[role=status]')) window.__sawStatus = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  for (const [name, ready] of [
    ['DEG table', 'text=/differentially expressed genes/'],
    ['Volcano', 'svg[aria-label^="Volcano plot"]'],
    ['Enrichment', 'text=/enriched set/'],
  ]) {
    const t2 = Date.now()
    await page2.click(`[role=tab]:has-text("${name}")`)
    await page2.waitForSelector(ready, { timeout: 60_000 })
      .catch(async () => {
        failed++
        console.log(`  !! ${name} never rendered — page text follows`)
        console.log((await page2.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 1500))
      })
    console.log(`  ${name} rendered in ${s(Date.now() - t2)}`)
  }
  const flashed = await page2.evaluate(() => window.__sawStatus)
  console.log(`  a "computing…" card ever appeared on any of the three: ${flashed}`)
  if (flashed) bad('an in-memory object flashed a progress card where it used to be instant')
  const workers = await page2.evaluate(() => performance.getEntriesByType('resource')
    .filter(r => r.name.includes('engine-worker')).length)
  console.log(`  compute workers created for the demo: ${workers}`)
  if (workers) bad('an in-memory object created a compute worker')
  await page2.screenshot({ path: `${shots}/de-small.png` })
  // The demo has four samples a side, so this is where the pseudobulk panel is
  // actually offered and can be seen rather than only refused.
  await pbBranch(page2, 'demo')
}

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
await browser.close()
process.exit(failed ? 1 : 0)
