// Every chart in the studio, checked for ink outside its own box.
//
//   node scripts/probe-overflow.mjs <url> [shots-dir]
//
// src/index.css sets `svg { overflow: visible }` globally. That is right for
// figures — a legend or an axis label may sit slightly proud of the plot — and
// it means a chart that under-reserves a margin does not clip, it PAINTS: over
// the panel beside it, over the caption beneath it, over the next row of a
// grid. Four separate reports of "text overlapping" were all this one mechanism.
//
// So this walks every tab, on every plot type, and compares each SVG's rendered
// ink (getBBox) against its own viewBox. Then it RENAMES a cluster to something
// the length of a real annotation — the rename propagates to every tab — and
// walks the whole thing again.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
let failed = 0
const ok = (b, m) => { if (!b) failed++; console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`) }

// What a real annotation looks like. 43 characters, a slash, mixed case.
const LONG = 'Cardiomyocyte/Working cardiomyocyte EXCLUDED'

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))

/** Every visible SVG whose ink exceeds its viewBox, with how far by. */
const spills = () => page.evaluate(() => {
  const out = []
  let checked = 0
  for (const svg of document.querySelectorAll('svg')) {
    const vb = svg.viewBox?.baseVal
    if (!vb || !vb.width || !svg.getClientRects().length) continue
    let box
    try { box = svg.getBBox() } catch { continue }
    if (!box.width) continue
    checked++
    const over = {
      top: +(vb.y - box.y).toFixed(1),
      left: +(vb.x - box.x).toFixed(1),
      right: +(box.x + box.width - (vb.x + vb.width)).toFixed(1),
      bottom: +(box.y + box.height - (vb.y + vb.height)).toFixed(1),
    }
    // 2 units of slack: stroke widths straddle their path, and a rounded rect's
    // bbox includes its stroke.
    const bad = Object.entries(over).filter(([, v]) => v > 2)
    if (bad.length) {
      out.push({
        label: (svg.getAttribute('aria-label') ?? svg.getAttribute('role') ?? 'svg').slice(0, 44),
        over: bad.map(([k, v]) => `${k}+${v}`).join(' '),
      })
    }
  }
  return { out, checked }
})

async function walk(what) {
  const tabs = await page.$$eval('[role="tab"]',
    els => els.filter(e => !e.disabled).map(e => e.textContent.trim()))
  let total = 0, bad = 0
  for (const t of tabs) {
    await page.getByRole('tab', { name: t, exact: true }).click()
    await page.waitForTimeout(1100)
    const { out, checked } = await spills()
    total += checked
    bad += out.length
    if (out.length) {
      console.log(`  FAIL  ${what} · ${t}`)
      for (const s of out) console.log(`          ${s.label}: ${s.over}`)
    }
  }
  ok(bad === 0, `${what}: ${total} charts inspected, ${bad} paint outside their box`)
  return total
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.getByText('Time course', { exact: true }).click()
await page.waitForSelector('[role="tablist"]')

console.log('')
console.log('EVERY TAB, AS SHIPPED')
const n1 = await walk('as shipped')
ok(n1 >= 8, `enough charts were actually inspected (${n1})`)

// Gene expression draws three different plots; the walk above only saw one.
console.log('')
console.log('EVERY PLOT TYPE ON GENE EXPRESSION')
await page.getByRole('tab', { name: 'Gene expression' }).click()
await page.waitForTimeout(600)
for (const plot of ['Violin panel', 'Dot plot', 'Feature plot']) {
  const btn = page.getByRole('button', { name: plot, exact: true })
  if (!(await btn.count())) continue
  await btn.click()
  await page.waitForTimeout(1400)
  const { out, checked } = await spills()
  // The feature plot draws to a canvas, so an SVG sweep cannot see it. Say
  // that rather than print a green line for having inspected nothing.
  if (!checked) console.log(`  --    ${plot}: canvas, not SVG — not covered by this check`)
  else {
    ok(out.length === 0, `${plot}: ${checked} charts, ${out.length} spill`
      + (out.length ? ` — ${out.map(s => `${s.label} ${s.over}`).join(' | ')}` : ''))
  }
}
// And across groups, where the labels get longer.
for (const mode of ['Across groups', 'Cell type × group']) {
  const btn = page.getByRole('button', { name: mode, exact: true })
  if (!(await btn.count())) continue
  await btn.click()
  await page.waitForTimeout(1400)
  const { out, checked } = await spills()
  if (!checked) console.log(`  --    grouped by "${mode}": nothing SVG on screen to inspect`)
  else {
    ok(out.length === 0, `grouped by "${mode}": ${checked} charts, ${out.length} spill`
      + (out.length ? ` — ${out.map(s => `${s.label} ${s.over}`).join(' | ')}` : ''))
  }
}
await page.screenshot({ path: `${shots}/overflow-expr.png` })

// Now make a cluster name as long as a real one. The rename on Markers
// propagates to every tab, which is exactly the blast radius being tested.
console.log('')
console.log(`AFTER RENAMING A CLUSTER TO ${LONG.length} CHARACTERS`)
await page.getByRole('tab', { name: 'Markers' }).click()
await page.waitForTimeout(1200)
const rename = page.locator('input.inp').first()
if (await rename.count()) {
  await rename.fill(LONG)
  await rename.blur()
  await page.waitForTimeout(1200)
  const n2 = await walk('long names')
  ok(n2 >= 8, `enough charts inspected again (${n2})`)
} else {
  ok(false, 'could not find a rename field on Markers')
}
await page.screenshot({ path: `${shots}/overflow-long.png`, fullPage: true })

if (errors.length) console.log(`${String.fromCharCode(10)}  ERRORS: ${errors.slice(0, 5).join(' | ')}`)
console.log(`${String.fromCharCode(10)}  ${failed === 0 ? 'all clear' : `${failed} failing check(s)`}`)
await browser.close()
process.exit(failed ? 1 : 0)
