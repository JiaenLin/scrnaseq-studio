// Embeddings and gene names, in a real browser.
//
//   node scripts/probe-names.mjs <url> <bundle-or-collection.zip> [--sets]
//
// Two claims, and both of them are about what the user sees rather than what a
// function returns:
//
//   1. Wherever cells are drawn, the user can choose which 2D embedding they are
//      drawn on — one control, remembered across tabs — and choosing a different
//      one draws different points. An object carrying one embedding shows no
//      control at all.
//   2. An object whose matrix is indexed by accessions is shown, and searched,
//      in symbols; the accession stays visible; and the built-in gene sets stop
//      reporting that they match nothing.
//
// Every selector here is a string grepped out of the source. When one misses,
// the page text is printed — a silent false negative looks exactly like a hang.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url, file, ...flags] = process.argv.slice(2)
const doSets = flags.includes('--sets')

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}
const claim = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n        ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
page.on('pageerror', e => { failed++; console.log(`  [page error] ${e.message}`) })

const dump = async (why) => {
  console.log(`\n!! ${why} — page text follows\n`)
  console.log((await page.textContent('body')).replace(/\s{3,}/g, '\n').slice(0, 4000))
  await browser.close()
  process.exit(1)
}

await page.goto(url, { waitUntil: 'load' })
console.log(`opening ${file}`)
const t0 = Date.now()
await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('[role=tab]', { timeout: 900_000 }).catch(() => dump('never opened'))
console.log(`opened in ${((Date.now() - t0) / 1000).toFixed(1)} s: `
  + `${(await page.textContent('header')).replace(/\s+/g, ' ').trim().slice(0, 110)}`)

/* ---------------- 1. the embedding switcher ---------------- */

console.log('\nTHE EMBEDDING IS THE USER\'S CHOICE, WHEREVER CELLS ARE DRAWN')
await page.click('[role=tab]:has-text("Cells")')
await page.waitForSelector('canvas', { timeout: 300_000 }).catch(() => dump('Cells drew nothing'))

const sel = 'label:has(.glabel:text-is("Embedding")) select'
const keys = await page.$$eval(`${sel} option`, os => os.map(o => o.textContent)).catch(() => [])
console.log(`  embeddings offered: ${keys.length ? keys.join(', ') : '(no control)'}`)

// The eyebrow names the embedding on screen, so it is the one thing that proves
// the figure and the control agree.
const eyebrow = async () => (await page.textContent('.eyebrow')).trim()
const shot = async () => page.$eval('canvas', c => c.toDataURL().length + ':'
  + c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice(0, 40_000)
    .reduce((a, b) => (a * 31 + b) % 1e9, 7))

if (keys.length < 2) {
  claim('an object with one embedding shows no menu', keys.length === 0,
    `a select with ${keys.length} option(s) was rendered`)
  check('and the figure still names it', (await eyebrow()).startsWith('Embedding ·'), true)
} else {
  check('the default is first and selected',
    await page.$eval(sel, s => s.value), keys[0])
  check('the figure names the default', await eyebrow(), `Embedding · ${keys[0]} from your file`)
  const before = await shot()

  await page.selectOption(sel, keys[1])
  await page.waitForFunction(
    k => document.querySelector('.eyebrow')?.textContent.includes(k), keys[1], { timeout: 120_000 },
  ).catch(() => dump(`switching to ${keys[1]} never took effect`))
  check('switching renames the figure', await eyebrow(), `Embedding · ${keys[1]} from your file`)
  const after = await shot()
  claim('and draws different points', before !== after, `both canvases hashed to ${before}`)

  // Remembered across tabs: the choice lives in App, not in the card.
  await page.click('[role=tab]:has-text("Overview")')
  await page.click('[role=tab]:has-text("Cells")')
  await page.waitForSelector('canvas')
  check('the choice survives leaving the tab', await eyebrow(),
    `Embedding · ${keys[1]} from your file`)

  // The feature plot is the other place cells are drawn, and it must be the
  // same choice — two views of the same cells under one control.
  await page.click('[role=tab]:has-text("Gene expression")')
  await page.click('button:has-text("Feature plot")')
  await page.waitForSelector('canvas', { timeout: 300_000 })
  const featureKeys = await page.$$eval(`${sel} option`, os => os.map(o => o.textContent))
  check('the same control is offered over the feature plot', featureKeys, keys)
  check('still on the chosen embedding', await page.$eval(sel, s => s.value), keys[1])

  // And it is absent where nothing is drawn on it.
  await page.click('button:has-text("Violin panel")')
  check('no embedding control over a violin panel',
    await page.$$eval(`${sel} option`, os => os.length).catch(() => 0), 0)

  await page.click('[role=tab]:has-text("Cells")')
  await page.waitForSelector('canvas')
  await page.selectOption(sel, keys[0])
  await page.waitForFunction(k => document.querySelector('.eyebrow')?.textContent.includes(k), keys[0])
  check('and it switches back', await eyebrow(), `Embedding · ${keys[0]} from your file`)
}

/* ---------------- 2. gene names ---------------- */

console.log('\nGENE IDENTIFIERS')
await page.click('[role=tab]:has-text("Gene expression")')
await page.waitForSelector('input[aria-label="Search a gene or paste a gene list"]', { timeout: 120_000 })
const box = 'input[aria-label="Search a gene or paste a gene list"]'

const notice = await page.textContent('body')
const renamed = notice.includes('the symbols shown come from')
  || /matrix is indexed by/.test(notice.replace(/\s+/g, ' '))
console.log(`  this object ${renamed ? 'carries both namings' : 'has one naming'}`)

const suggest = async (q) => {
  await page.fill(box, '')
  await page.fill(box, q)
  await page.waitForTimeout(120)
  return page.$$eval('.absolute button.mono', bs => bs.map(b => b.textContent.trim()))
}

if (!renamed) {
  const any = await page.$eval('.inp.mono', i => i.placeholder)
  check('an object with one naming looks exactly as it did',
    any, 'one gene, or paste a list…')
} else {
  check('the search box says so', await page.$eval('.inp.mono', i => i.placeholder),
    'symbol or accession…')

  // A query this object can actually answer, taken FROM the object rather than
  // assumed: the genes already selected at open are on screen as chips, so the
  // first of them is a name that exists here whatever the species.
  const chip = (await page.$$eval('span[title]', ss => ss.map(s => s.textContent.replace(/×$/, '').trim())))
    .find(Boolean)
  const query = process.env.PROBE_SYMBOL ?? chip ?? 'Sox2'
  const hits = await suggest(query)
  console.log(`  "${query}" suggests: ${JSON.stringify(hits.slice(0, 4))}`)
  claim('a symbol finds rows', hits.length > 0, 'the dropdown was empty')
  claim('and the accession is shown beside it',
    hits.some(h => /ENS[A-Z]*\d{6,}/.test(h)), JSON.stringify(hits.slice(0, 3)))

  // Now the other direction: take an accession off the dropdown and search it.
  const acc = (hits.join(' ').match(/ENS[A-Z]*\d{6,}/) ?? [])[0]
  if (acc) {
    const back = await suggest(acc)
    console.log(`  "${acc}" suggests: ${JSON.stringify(back.slice(0, 3))}`)
    claim('searching the accession finds the same row', back.length > 0, 'nothing came back')
    claim('and it is shown under its symbol',
      back.some(b => !b.startsWith('ENS')), JSON.stringify(back.slice(0, 3)))
  } else {
    claim('an accession was visible to search back with', false)
  }

  // Committing one, and drawing it: the name on screen must be a name the
  // object answers for, or the panel comes back empty.
  await page.fill(box, query)
  await page.waitForTimeout(200)
  await page.click('.absolute button.mono')
  await page.click('button:has-text("Feature plot")')
  await page.waitForSelector('figcaption', { timeout: 300_000 })
  const caps = await page.$$eval('figcaption', fs => fs.map(f => f.textContent.trim()))
  console.log(`  feature captions: ${JSON.stringify(caps.slice(0, 3))}`)
  claim('the feature plot is titled with the symbol and carries the accession',
    caps.some(c => /ENS[A-Z]*\d{6,}/.test(c) && !c.startsWith('ENS')), JSON.stringify(caps.slice(0, 2)))
}

/* ---------------- 3. the built-in gene sets ---------------- */

if (doSets) {
  console.log('\nTHE BUILT-IN GENE SETS FIND THEIR GENES')
  await page.click('[role=tab]:has-text("Gene sets")')
  await page.waitForSelector('text=/genes found in this object/', { timeout: 900_000 })
    .catch(() => dump('Gene sets never reported a count'))
  const line = (await page.textContent('text=/genes found in this object/')).replace(/\s+/g, ' ').trim()
  console.log(`  ${line}`)
  const [, found, asked] = line.match(/(\d+) of (\d+) genes found/) ?? []
  claim('the first set matches something', Number(found) > 0, line)
  claim('and most of it', Number(found) / Number(asked) > 0.5, line)
  const body = await page.textContent('body')
  claim('the tab no longer says nothing is measured',
    !body.includes('None of these genes are measured'), 'it still says it')

  // Every set, not just the first: the failure was systematic.
  const ids = await page.$$eval('select[aria-label="Gene set"] option', os => os.map(o => o.value))
  let empty = 0
  for (const id of ids) {
    await page.selectOption('select[aria-label="Gene set"]', id)
    await page.waitForSelector('text=/genes found in this object/', { timeout: 900_000 })
    const l = (await page.textContent('text=/genes found in this object/')).replace(/\s+/g, ' ')
    if (/^0 of/.test(l.trim())) { empty++; console.log(`    empty: ${id} — ${l.trim()}`) }
  }
  // Not "every set hits": a mouse neurogenesis signature genuinely does not
  // appear in human PBMCs, and reporting that is the right answer. The failure
  // being ruled out is the systematic one — every set empty because the object's
  // rows are accessions and the sets are symbols.
  claim(`the sets are not systematically empty (${empty} of ${ids.length} empty)`,
    empty < ids.length / 2, `${empty} of ${ids.length} matched nothing`)
}

console.log(failed ? `\n${failed} check(s) failed\n` : '\nPASS — every check held\n')
await browser.close()
process.exit(failed ? 1 : 0)
