// The MSigDB library, driven in a real browser.
//
//   node scripts/probe-genesets.mjs <url> [shots-dir]
//
// What the node tests cannot reach: that the assets are actually served, that
// the species is detected from the object rather than defaulted, that switching
// it reloads the right library, and that a collection toggled on is fetched.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
const ok = (b, m) => console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`)

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
const fetched = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('response', r => {
  if (r.url().includes('/genesets/')) {
    fetched.push({ file: r.url().split('/').pop(), status: r.status() })
  }
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.getByText('Time course', { exact: true }).click()
await page.waitForSelector('[role="tablist"]')
await page.getByRole('tab', { name: 'Differential expression' }).click()
await page.getByRole('button', { name: 'Enrichment', exact: true }).click()
// The library is a few MB the first time.
await page.waitForFunction(
  () => /MSigDB \d{4}\.\d+\./.test(document.body.textContent ?? ''), null, { timeout: 90000 })

console.log('\nLIBRARY')
const bad = fetched.filter(f => f.status >= 400)
ok(bad.length === 0, `${fetched.length} asset requests, none failed`
  + (bad.length ? ` — ${bad.map(b => `${b.file} ${b.status}`).join(', ')}` : ''))
ok(fetched.some(f => f.file === 'manifest.json'), 'the manifest was fetched')

const detected = await page.locator('select[aria-label="Species for the gene set library"]').inputValue()
ok(detected === 'mouse', `species detected as ${detected} from a mouse demo`)
ok(fetched.every(f => f.file === 'manifest.json' || f.file.startsWith('mouse.')),
  `only mouse collections were downloaded (${fetched.filter(f => f.file.endsWith('.gs')).map(f => f.file).join(', ')})`)

// Read the expected release from the manifest rather than pinning a string:
// this must keep passing across MSigDB releases, and check that the screen
// agrees with the assets — not that either equals a version I typed once.
const MANIFEST = await (await fetch(`${url.replace(/\/$/, '')}/genesets/manifest.json`)).json()
const status = await page.locator('.panel p').first().textContent()
ok((status ?? '').includes(`MSigDB ${MANIFEST.species.mouse.release}`),
  `the release on screen is the one in the assets (${MANIFEST.species.mouse.release}) — `
  + `"${status?.trim().slice(0, 88)}…"`)
const surviving = Number((status ?? '').match(/of which\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0)
ok(surviving > 100, `${surviving.toLocaleString()} sets contain a gene this contrast tested`)

// The headline count must be sets, not the toy 18.
const head = await page.locator('h2').first().textContent()
ok(/enriched set/.test(head ?? ''), `headline reads "${head?.trim()}"`)
await page.screenshot({ path: `${shots}/genesets-enrichment.png` })

console.log('\nTOGGLING A COLLECTION FETCHES IT')
{
  const before = fetched.length
  await page.getByRole('button', { name: /^GO:MF/ }).click()
  await page.waitForTimeout(4000)
  const got = fetched.slice(before).filter(f => f.file.endsWith('.gs'))
  ok(got.some(f => f.file.includes('go-mf')), `turning GO:MF on fetched it (${got.map(f => f.file).join(', ') || 'nothing'})`)
  ok(got.every(f => f.status < 400), 'and it arrived')
}

console.log('\nSWITCHING SPECIES LOADS THE OTHER LIBRARY')
{
  const before = fetched.length
  await page.selectOption('select[aria-label="Species for the gene set library"]', 'human')
  await page.waitForTimeout(8000)
  const got = fetched.slice(before).filter(f => f.file.endsWith('.gs'))
  ok(got.length > 0 && got.every(f => f.file.startsWith('human.')),
    `human collections fetched (${got.length} files)`)
  const s2 = await page.locator('.panel p').first().textContent()
  ok((s2 ?? '').includes(`MSigDB ${MANIFEST.species.human.release}`),
    `and the release on screen is the human one (${MANIFEST.species.human.release})`)
  // A mouse object against the human library does NOT come back empty, and that
  // is the whole hazard: matching ignores case, so Gfap hits GFAP and the page
  // fills with plausible results. On this demo the human library even leaves
  // MORE sets standing than the mouse one, so no count can warn anybody. The
  // only thing that can is the case-sensitive spelling check.
  const survived = Number((s2 ?? '').match(/of which\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? -1)
  ok(survived > 0, `the wrong library still leaves ${survived.toLocaleString()} sets `
    + `(vs ${surviving.toLocaleString()}) — a count cannot catch this`)
  // The check is a disagreement with what the object's own names say, not a
  // coverage ratio: a ratio measured how much of the transcriptome the enabled
  // collections annotate, which on a real mouse object with Hallmark alone is
  // 12.5% and says nothing about species at all.
  const warn = await page.getByText(/this object looks like/).count()
  ok(warn === 1, 'the species check notices the object disagrees with the choice')
  const msg = await page.getByText(/this object looks like/).textContent()
  ok(/looks like mouse/.test(msg ?? ''), `and says which — "${msg?.trim().slice(0, 96)}…"`)
  // And the coverage line is present, labelled as coverage.
  const cov = await page.getByText(/annotate \d+% of the genes/).count()
  ok(cov === 1, 'coverage is reported separately, as coverage')
  await page.screenshot({ path: `${shots}/genesets-wrong-species.png` })
}

console.log('\nGENE SETS TAB')
{
  await page.selectOption('select[aria-label="Species for the gene set library"]', 'mouse')
  await page.waitForTimeout(3000)
  await page.getByRole('tab', { name: 'Gene sets' }).click()
  await page.waitForTimeout(3000)
  const search = page.locator('input[aria-label="Search gene sets"]')
  ok(await search.count() === 1, 'the searchable picker replaced the dropdown')
  ok(await page.locator('select[aria-label="Gene set"]').count() === 0,
    'and no 20 000-item <select> is rendered')
  await search.fill('mitotic cell cycle')
  await page.waitForTimeout(600)
  const rows = await page.locator('[aria-pressed]').filter({ hasText: /mitotic/i }).count()
  ok(rows > 0, `searching "mitotic cell cycle" finds ${rows} sets`)
  await page.screenshot({ path: `${shots}/genesets-picker.png` })
}

if (errors.length) console.log(`\n  ERRORS\n   ${errors.slice(0, 6).join('\n   ')}`)
else console.log('\n  no page errors')

await browser.close()
