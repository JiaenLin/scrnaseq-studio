// Nothing may paint outside the box that owns it.
//
//   node scripts/probe-longnames.mjs <url> [shots-dir]
//
// Four overlaps were reported off one real object, and none of them shows on a
// demo: the demo cell types are "qNSC" and the demo groups are "0 h". Real ones
// are "Cardiomyocyte/Working cardiomyocyte EXCLUDED" and "young_chow", and real
// MSigDB names run to 76 characters. So this stamps those onto a demo and
// measures geometry — `svg { overflow: visible }` is set globally, so a chart
// that overflows does not clip, it paints on its neighbour.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
const ok = (b, m) => console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`)

const LONG_TYPE = 'Cardiomyocyte/Working cardiomyocyte EXCLUDED'

const browser = await chromium.launch({ executablePath: EXE })
// 1010: the width the reports came from.
const page = await browser.newPage({ viewport: { width: 1010, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByText('Replicated cohort', { exact: true }).click()
await page.waitForSelector('[role="tablist"]')

/* ---- 1. the control bar keeps Run reachable --------------------------- */
console.log('\nCONTROL BAR, with long names')
{
  await page.getByRole('tab', { name: 'Differential expression' }).click()
  await page.waitForTimeout(500)
  // Wear a long cell-type name, as a real annotation would.
  await page.evaluate((name) => {
    const sel = document.querySelector('select.sel')
    if (sel?.options.length) sel.options[sel.selectedIndex].textContent = name
  }, LONG_TYPE)
  await page.waitForTimeout(200)

  const geo = await page.evaluate(() => {
    const bar = document.querySelector('header .wrap:last-of-type')
      ?? [...document.querySelectorAll('header .wrap')].pop()
    const r = bar.getBoundingClientRect()
    const run = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Run')
    const style = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Figure style')
    const box = (el) => el && el.getBoundingClientRect()
    const scroller = document.querySelector('header .wrap div.overflow-x-auto')
    return {
      barRight: Math.round(r.right),
      run: run ? { left: Math.round(box(run).left), right: Math.round(box(run).right) } : null,
      style: style ? { right: Math.round(box(style).right) } : null,
      scrolls: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
    }
  })
  // Run only exists on a streamed object — an in-memory demo is always armed —
  // so its absence here is correct. What must hold either way is that the row
  // fits, because Run was the first thing pushed out when it did not.
  if (geo.run) {
    ok(geo.run.right <= geo.barRight + 1,
      `Run is inside the bar (ends at ${geo.run.right}, bar ends at ${geo.barRight})`)
  } else {
    console.log('  --    no Run button on an in-memory demo, as expected')
  }
  ok(geo.scrolls <= 0, `the control row does not overflow (${geo.scrolls}px of hidden scroll)`)
  ok(geo.style.right <= geo.barRight + 1, 'Figure style is inside the bar too')
  await page.screenshot({ path: `${shots}/long-bar.png`, clip: { x: 0, y: 0, width: 1010, height: 140 } })
}

/* ---- 2. composition facets do not paint on each other ----------------- */
console.log('\nCOMPOSITION FACETS')
{
  await page.getByRole('tab', { name: 'Composition' }).click()
  await page.waitForTimeout(900)
  const spill = await page.evaluate(() => {
    const out = []
    for (const svg of document.querySelectorAll('figure svg')) {
      const vb = svg.viewBox.baseVal
      if (!vb || !vb.width) continue
      const box = svg.getBBox()          // the ink, in viewBox units
      const over = {
        bottom: +(box.y + box.height - vb.height).toFixed(1),
        right: +(box.x + box.width - vb.width).toFixed(1),
        left: +(0 - box.x).toFixed(1),
      }
      // 1 unit of slack for stroke widths and rounding.
      if (over.bottom > 1 || over.right > 1 || over.left > 1) {
        out.push(`${svg.getAttribute('aria-label')?.slice(0, 40)}: `
          + `bottom+${over.bottom} right+${over.right} left+${over.left}`)
      }
    }
    return { out, n: document.querySelectorAll('figure svg').length }
  })
  // A check that inspected nothing would pass; say how many it saw.
  ok(spill.n >= 4, `${spill.n} facet charts on screen to inspect`)
  ok(spill.out.length === 0, `none paints outside its own box ${spill.out.join(' | ')}`)
  await page.screenshot({ path: `${shots}/long-composition.png` })
}

/* ---- 3. the enrichment bars keep the START of every name -------------- */
console.log('\nENRICHMENT BARS, with real MSigDB names')
{
  await page.getByRole('tab', { name: 'Differential expression' }).click()
  await page.getByRole('button', { name: 'Enrichment', exact: true }).click()
  await page.waitForFunction(
    () => /MSigDB \d{4}\./.test(document.body.textContent ?? ''), null, { timeout: 90000 })
  // Open the thresholds right up so there is something to draw, and drop the
  // minimum set size — the demos measure 72 genes, so few sets reach ten of them.
  await page.locator('input[aria-label="Fold change threshold"]').fill('0')
  await page.locator('input[aria-label="Adjusted p-value threshold"]').fill('0')
  await page.locator('input[aria-label="Minimum set size"]').fill('2')
  await page.waitForTimeout(2000)

  const bars = await page.evaluate(() => {
    const svg = [...document.querySelectorAll('svg')]
      .find(s => s.getAttribute('aria-label') === 'Enriched gene sets')
    if (!svg) return null
    const vb = svg.viewBox.baseVal
    const labels = [...svg.querySelectorAll('text')].filter(t => t.getAttribute('text-anchor') === 'end')
    const off = labels.filter(t => t.getBBox().x < -0.5)
      .map(t => t.textContent.trim().slice(0, 40))
    const longest = labels.reduce((a, t) => Math.max(a, t.textContent.trim().length), 0)
    const ellipsed = labels.filter(t => t.textContent.includes('…')).length
    const titled = labels.filter(t => t.querySelector('title')).length
    return { n: labels.length, off, longest, ellipsed, titled, vbw: vb.width }
  })
  ok(bars !== null && bars.n > 0, `${bars?.n ?? 0} bar labels drawn`)
  if (bars?.n) {
    ok(bars.off.length === 0,
      `no label runs off the left edge${bars.off.length ? ` — ${bars.off.join(' | ')}` : ''}`)
    ok(bars.titled === bars.n, `every label carries the full name as a tooltip (${bars.titled}/${bars.n})`)
    console.log(`        longest drawn label ${bars.longest} chars, ${bars.ellipsed} ellipsed`)
  }
  await page.screenshot({ path: `${shots}/long-enrichment.png` })
}

/* ---- 4. the results table is gone, the detail card is not ------------- */
console.log('\nENRICHMENT PRESENTATION')
{
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('th')].map(t => t.textContent.trim()))
  ok(!heads.includes('Genes'), `no results table with a Genes column (headers: ${heads.join(', ') || 'none'})`)
  const detail = await page.getByText(/Rank of/).count()
  ok(detail > 0, 'the per-term member table is there')
}

/* ---- 5. Gene sets computes nothing until asked -------------------------- */
console.log('')
console.log('GENE SETS DOES NOT COMPUTE ON ARRIVAL')
{
  await page.getByRole('tab', { name: 'Gene sets' }).click()
  await page.waitForTimeout(2500)
  const body = async () => (await page.evaluate(() => document.body.textContent ?? ''))
  ok(/Pick a set above to score it/.test(await body()),
    'opening the tab picks nothing and scores nothing')
  ok(!/Scoring .* across every cell/.test(await body()),
    'and no pass is running')

  // Choosing one either scores it (an in-memory demo answers instantly) or
  // offers to (a streamed object asks first). What must hold in both is that
  // nothing ran before a set was chosen.
  const first = page.locator('[aria-pressed]').filter({ hasText: /Adipogenesis/i }).first()
  if (await first.count()) {
    await first.click()
    await page.waitForTimeout(2500)
    const t = await body()
    ok(/on the embedding/.test(t) || /Score this set/.test(t),
      'choosing a set then scores it, or offers to')
  } else {
    ok(false, 'no set rows found to choose')
  }
  await page.screenshot({ path: `${shots}/genesets-gate.png` })
}

if (errors.length) console.log(`\n  ERRORS\n   ${errors.slice(0, 5).join('\n   ')}`)
else console.log('\n  no page errors')

await browser.close()
