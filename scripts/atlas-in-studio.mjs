// The decisive test: a real 5.8 GB, 43-part collection, opened in the studio,
// which must present it as ONE dataset with all 292,495 cells.
import { chromium } from 'playwright-core'
const FILE = process.argv[2] ?? 'C:/Users/Lin/AppData/Local/Temp/loop/atlas_collection.zip'
const URL_ = process.argv[3] ?? 'http://localhost:4252/'
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a)
const b = await chromium.launch({ executablePath: 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe' })
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } })
const errs = []
p.on('pageerror', e => errs.push('PAGE: ' + e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') errs.push('CON: ' + m.text().slice(0, 200)) })
await p.goto(URL_, { waitUntil: 'networkidle' })
log('studio loaded; opening the 5.8 GB collection')
const t = Date.now()
await p.setInputFiles('input[type=file]', FILE)
// Say what it is doing while we wait, so a slow open is distinguishable from a
// stuck one.
const tick = setInterval(async () => {
  const txt = await p.locator('body').innerText().catch(() => '')
  log('   …', txt.replace(/s+/g, ' ').slice(0, 150))
}, 30000)
const ok = await Promise.race([
  p.waitForSelector('text=Overview', { timeout: 900000 }).then(() => 'OPENED'),
  p.waitForSelector('.note:not(.note-info) b', { timeout: 900000 }).then(() => 'REFUSED'),
]).catch(() => 'NEITHER')
clearInterval(tick)
log(`${ok} in ${((Date.now() - t) / 1000).toFixed(1)} s`)
if (ok !== 'OPENED') {
  log('page said:', (await p.locator('body').innerText()).replace(/\n+/g, ' ').slice(0, 400))
  await b.close(); process.exit(1)
}
const head = (await p.locator('.card').first().innerText()).replace(/\n+/g, ' · ')
log('OVERVIEW:', head.slice(0, 260))
const body = await p.locator('body').innerText()
log('shows total cells (292,495)?', body.includes('292,495') ? 'YES' : 'NO — ' + (body.match(/[\d,]{5,}\s*cells/i) || ['?'])[0])
log('part switcher present?', /viewing part|switch part|part \d+ of|choose a part/i.test(body) ? 'YES — DEFECT' : 'no')
const TABS = ['Overview', 'Cells', 'Composition', 'Markers', 'DEG table', 'Volcano',
              'Enrichment', 'Gene expression', 'Gene sets', 'Methods']
for (const tab of TABS) {
  const before = errs.length
  const t0 = Date.now()
  await p.click(`button:has-text("${tab}")`).catch(() => {})
  // Streaming views need time; wait for any progress indicator to clear.
  await p.waitForTimeout(2500)
  for (let i = 0; i < 60; i++) {
    const busy = await p.locator('text=/computing|scanning|reading|%/i').count().catch(() => 0)
    if (!busy) break
    await p.waitForTimeout(5000)
  }
  const txt = (await p.locator('main, body').first().innerText()).replace(/\s+/g, ' ')
  log(`  ${tab.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${errs.length > before ? 'ERROR ' + errs.slice(before)[0] : 'ok'} · ${txt.slice(120, 210)}`)
}
await p.screenshot({ path: 'C:/Users/Lin/AppData/Local/Temp/loop/atlas-studio.png' })
await p.close(); await b.close()
log(errs.length ? `ERRORS (${errs.length}): ${errs.slice(0, 4).join(' | ')}` : 'no console errors')
