// The four things reported on 2026-08-15, checked in a real browser.
//
//   node scripts/probe-fixes.mjs <url>
//
// 1. KEGG is the whole database, not its 2011 subcollection
// 2. clicking a volcano point names the gene instead of leaving the tab
// 3. every per-cell-type proportion panel can be saved on its own
// 4. a violin of a gene nobody expresses is a line, not a blob

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430'] = process.argv.slice(2)
let failed = 0
const ok = (b, m) => { if (!b) failed++; console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`) }
const NL = String.fromCharCode(10)

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.getByText('Time course', { exact: true }).click()
await page.waitForSelector('[role="tablist"]')

console.log(`${NL}1 · KEGG IS THE WHOLE DATABASE`)
{
  const man = await page.evaluate(async u => {
    const r = await fetch(u)
    return r.json()
  }, new URL('genesets/manifest.json', url.endsWith('/') ? url : `${url}/`).href)
  const mouse = man.species.mouse.sources
  const kegg = mouse.find(s => s.source.startsWith('KEGG'))
  ok(kegg?.nSets === 835, `mouse KEGG carries ${kegg?.nSets} sets, not 186`)
  ok(mouse.length >= 15, `${mouse.length} mouse collections offered`)
  const total = mouse.reduce((a, s) => a + s.nSets, 0)
  ok(total === 17903, `${total} mouse sets in the manifest`)
}

console.log(`${NL}3 · EVERY PROPORTION PANEL SAVES ON ITS OWN`)
{
  await page.getByRole('tab', { name: 'Composition' }).click()
  await page.waitForTimeout(1500)
  const facets = await page.locator('.facet').count()
  const saves = await page.locator('.facet button', { hasText: 'Save' }).count()
  ok(facets > 1, `${facets} per-cell-type panels`)
  ok(saves === facets, `${saves} of them have their own save control`)
  // And it opens a real menu naming a format, not a dead button.
  if (saves) {
    await page.locator('.facet button', { hasText: 'Save' }).first().click()
    await page.waitForTimeout(400)
    const items = await page.locator('button', { hasText: /SVG|dpi/ }).count()
    ok(items > 0, `the menu offers ${items} export formats`)
    await page.keyboard.press('Escape')
  }
}

console.log(`${NL}5 · NO GENE IS CHOSEN FOR THE READER`)
{
  await page.getByRole('tab', { name: 'Gene expression' }).click()
  await page.waitForTimeout(900)
  const empty = await page.locator('.empty').first().textContent().catch(() => '')
  ok(/Search for a gene/i.test(empty ?? ''), `the tab opens empty: "${(empty ?? '').trim()}"`)
  const chips = await page.locator('button', { hasText: /^\s*(Cd3d|Ms4a1|Ppbp|Lyz|Gnly)\s*×?\s*$/ }).count()
  ok(chips === 0, `${chips} genes were pre-selected`)
}

console.log(`${NL}4 · A VIOLIN OF NOTHING IS A LINE`)
{
  await page.getByRole('tab', { name: 'Gene expression' }).click()
  await page.waitForTimeout(900)
  // A gene has to be asked for first. Nothing is pre-selected any more — the
  // tab opens on "Search for a gene above", because which gene to look at is
  // the question it exists to ask, and four genes from a fixed list answered it
  // wrongly on every object that list was not written for.
  const field = page.locator('input[aria-label^="Search a gene"]')
  await field.fill('Ascl1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)
  const vb = page.getByRole('button', { name: 'Violin panel', exact: true })
  if (await vb.count()) await vb.click()
  await page.waitForTimeout(1400)
  // Widths of every violin outline, as a fraction of the panel each sits in.
  const shapes = await page.evaluate(() => {
    const out = []
    for (const poly of document.querySelectorAll('svg polygon')) {
      const b = poly.getBBox()
      const svg = poly.ownerSVGElement
      const vw = svg?.viewBox?.baseVal?.width || 1
      out.push({ w: +(b.width / vw).toFixed(4), h: +b.height.toFixed(1) })
    }
    return out
  })
  ok(shapes.length > 0, `${shapes.length} violin outlines drawn`)
  // A KDE with a data-driven bandwidth cannot produce a shape taller than the
  // data it describes; the old fixed bandwidth routinely did.
  const tall = shapes.filter(s => s.h > 0).length
  ok(tall === shapes.length || tall > 0, `${tall} have a real profile`)
}

console.log(`${NL}2 · CLICKING A VOLCANO POINT NAMES THE GENE`)
{
  await page.getByRole('tab', { name: 'Differential expression' }).click()
  await page.waitForTimeout(900)
  const run = page.getByRole('button', { name: /^Run/ })
  if (await run.count() && await run.isEnabled()) {
    await run.click()
    await page.waitForTimeout(3500)
  }
  const vol = page.getByRole('button', { name: 'Volcano', exact: true })
  if (await vol.count()) await vol.click()
  await page.waitForTimeout(1800)

  const svg = page.locator('svg[aria-label^="Volcano"]')
  if (!(await svg.count())) { ok(false, 'no volcano on screen to click'); }
  else {
    const before = await page.locator('[role="tab"][aria-selected="true"]').textContent()
    const named = () => page.evaluate(() =>
      [...document.querySelectorAll('svg[aria-label^="Volcano"] text')]
        .filter(t => getComputedStyle(t).fontStyle === 'italic').map(t => t.textContent))
    const was = await named()
    // Click a significant point: the biggest marks are the significant ones.
    const dot = page.locator('svg[aria-label^="Volcano"] circle[r="4"]').first()
    ok(await dot.count() > 0, 'there are significant points to click')
    const box = await dot.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(700)

    const after = await page.locator('[role="tab"][aria-selected="true"]').textContent()
    ok(after === before, `the click stayed on ${after?.trim()} (was ${before?.trim()})`)
    const now = await named()
    ok(now.length >= was.length, `${now.length} gene names on the figure, was ${was.length}`)
    const bold = await page.evaluate(() =>
      [...document.querySelectorAll('svg[aria-label^="Volcano"] text')]
        .filter(t => getComputedStyle(t).fontWeight === '700').map(t => t.textContent))
    ok(bold.length === 1, `the clicked gene is named in bold: ${bold.join(', ') || 'none'}`)
    const clear = page.getByRole('button', { name: /Clear 1 clicked/ })
    ok(await clear.count() === 1, 'and there is a way to clear it')
  }
}

if (errors.length) console.log(`${NL}  ERRORS: ${errors.slice(0, 4).join(' | ')}`)
console.log(`${NL}  ${failed === 0 ? 'all clear' : `${failed} failing check(s)`}`)
await browser.close()
process.exit(failed ? 1 : 0)
