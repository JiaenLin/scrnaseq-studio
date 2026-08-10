// The claims the tab walk cannot make: dark mode, reduced motion, the inner
// views of Differential expression, and that a fault in one of them costs only
// that one.
//
//   node scripts/probe-ui-modes.mjs <url> [shots-dir]

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
const ok = (b, msg) => console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${msg}`)

const browser = await chromium.launch({ executablePath: EXE })

async function open(opts) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, ...opts })
  page.on('pageerror', e => console.log(`  [page error] ${e.message}`))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByText('Replicated cohort', { exact: true }).click()
  await page.waitForSelector('[role="tablist"]')
  return page
}

/* ---------------- 1. the three views are one computation ---------------- */
console.log('\nDIFFERENTIAL EXPRESSION — three views, one pass')
{
  const page = await open({})
  await page.getByRole('tab', { name: 'Differential expression' }).click()
  await page.waitForTimeout(400)

  const strips = () => page.evaluate(() => ({
    // The Test picker and the threshold strip must appear exactly once.
    test: document.body.textContent.split('Wilcoxon · per cell').length - 1,
    padj: document.querySelectorAll('input[aria-label="Adjusted p-value threshold"]').length,
    lfc: document.querySelectorAll('input[aria-label="Fold change threshold"]').length,
  }))
  const s = await strips()
  ok(s.padj === 1 && s.lfc === 1, `one threshold pair on Table (padj ${s.padj}, lfc ${s.lfc})`)

  // A threshold set on one view must still be set on the next.
  await page.locator('input[aria-label="Fold change threshold"]').fill('1.5')
  await page.waitForTimeout(200)
  const before = await page.locator('input[aria-label="Fold change threshold"]').inputValue()

  for (const view of ['Volcano', 'Enrichment', 'Table']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await page.waitForTimeout(500)
    const t = await strips()
    ok(t.padj === 1 && t.lfc === 1, `one threshold pair on ${view}`)
  }
  const after = await page.locator('input[aria-label="Fold change threshold"]').inputValue()
  ok(before === after, `the threshold survives the round trip (${before} → ${after})`)
  await page.screenshot({ path: `${shots}/modes-de-table.png` })
  await page.close()
}

/* ---------------- 2. a fault in one view costs one view ---------------- */
console.log('\nBOUNDARY — a crash in the DE tab does not take the app')
{
  const page = await open({})
  await page.getByRole('tab', { name: 'Differential expression' }).click()
  await page.waitForTimeout(300)
  await page.evaluate(() => history.replaceState({}, '', '?crash=de'))
  // Force a re-render by touching a control the tab reads.
  await page.getByRole('button', { name: 'Volcano', exact: true }).click()
  await page.waitForTimeout(500)
  const text = await page.textContent('body')
  ok(text.includes('could not be drawn'), 'the boundary caught it')
  ok((await page.$$('[role="tab"]')).length === 8, 'all eight tabs are still there')
  await page.getByRole('tab', { name: 'Markers' }).click()
  await page.waitForTimeout(400)
  ok(!(await page.textContent('body')).includes('could not be drawn'), 'Markers is unaffected')
  await page.close()
}

/* ---------------- 3. dark mode ---------------- */
console.log('\nDARK MODE')
{
  const page = await open({ colorScheme: 'dark' })
  const bg = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor)
  ok(bg === 'rgb(11, 17, 32)', `body takes the dark ground (${bg})`)

  // Contrast of the selected tab against its own ground, both themes.
  const tabInk = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="tab"]')].find(e => e.ariaSelected === 'true')
    return getComputedStyle(t).color
  })
  ok(tabInk === 'rgb(226, 232, 240)', `the active tab is ink, not accent (${tabInk})`)

  // A menu shadow has to be visible against a near-black card, which means it
  // must not be the slate-tinted light-mode value. Compared as a value, not as
  // a string: the browser rewrites rgba() to #rrggbbaa and either spelling is
  // the same colour.
  const shadow = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--shadow-menu').trim())
  const black = /#000000(80|cc)?\b|rgba\(0,\s*0,\s*0/.test(shadow)
  ok(black && !shadow.includes('15, 23, 42'), `the menu shadow is dark-aware (${shadow})`)

  /**
   * Anything that paints its own text must be legible on its own ground.
   *
   * This exists because the flat-ink logo shipped white-on-near-white the
   * moment the page went dark: --ink inverts between themes and `text-white`
   * does not, so the pair only worked in one of them. A ratio is the only way
   * to catch that without looking at every element in both themes.
   */
  const contrast = () => page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    /**
     * What the browser actually paints behind this text.
     *
     * The soft badge grounds are rgba at 12–15% — reading one as an opaque
     * colour compares the label against pure emerald instead of emerald over a
     * near-black card, which is a different colour and the wrong answer. So the
     * layers are composited the way the compositor does it: collect every
     * translucent background up the tree, then paint them back to front.
     */
    const ground = (el) => {
      const layers = []
      for (let n = el; n; n = n.parentElement) {
        const [r, g, b, a = 1] = getComputedStyle(n).backgroundColor.match(/[\d.]+/g).map(Number)
        if (a === 0) continue
        layers.push([r, g, b, a])
        if (a === 1) break
      }
      let out = [255, 255, 255]
      for (const [r, g, b, a] of layers.reverse()) {
        out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]
      }
      return `rgb(${out.join(', ')})`
    }
    const bad = []
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue
      if (el.closest('svg')) continue           // figure ink has its own rules
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      if (!text) continue
      const cs = getComputedStyle(el)
      if (parseFloat(cs.opacity) < 0.5) continue // deliberately dimmed = disabled
      const a = lum(cs.color), b = lum(ground(el))
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      if (ratio < 2.5) {
        bad.push(`${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} `
          + `"${el.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}:1`)
      }
    }
    return bad
  })

  for (const tab of ['Overview', 'Cells', 'Markers', 'Differential expression']) {
    await page.getByRole('tab', { name: tab }).click()
    await page.waitForTimeout(400)
    const bad = await contrast()
    ok(bad.length === 0, `${tab}: every label is legible on its own ground`
      + (bad.length ? `\n        ${bad.join('\n        ')}` : ''))
  }
  await page.screenshot({ path: `${shots}/modes-dark.png` })
  await page.close()
}

/* ---------------- 4. dark-mode export still lands on white ---------------- */
console.log('\nEXPORT FROM DARK MODE')
{
  const page = await open({ colorScheme: 'dark' })
  await page.getByRole('tab', { name: 'Markers' }).click()
  await page.waitForTimeout(1200)
  // forceLightFigures stamps data-theme while it reads the computed colours.
  const ink = await page.evaluate(() => {
    const root = document.documentElement
    const dark = getComputedStyle(root).getPropertyValue('--fig-ink').trim()
    root.setAttribute('data-theme', 'light')
    const light = getComputedStyle(root).getPropertyValue('--fig-ink').trim()
    root.removeAttribute('data-theme')
    return { dark, light }
  })
  ok(ink.dark !== ink.light, `figure ink differs by theme (${ink.dark} vs ${ink.light})`)
  // #000 and #000000 are the same colour; the browser picks the short form.
  const isBlack = (v) => /^#0{3,6}$/.test(v) || v === 'rgb(0, 0, 0)'
  ok(isBlack(ink.light), `and the export stamp forces it black (${ink.light})`)
  await page.close()
}

/* ---------------- 5. reduced motion keeps the feedback ---------------- */
console.log('\nREDUCED MOTION — gentler, not none')
{
  const page = await open({ reducedMotion: 'reduce' })
  const btn = await page.evaluate(() => {
    const b = document.querySelector('.btn')
    const cs = getComputedStyle(b)
    return { transition: cs.transitionProperty, duration: cs.transitionDuration }
  })
  ok(btn.transition.includes('transform'), 'a button still transitions its press')
  ok(parseFloat(btn.duration) > 0, `and the duration is not zeroed (${btn.duration})`)

  const focus = await page.evaluate(() => {
    // The focus ring must survive: it is how a keyboard user knows where they are.
    for (const r of [...document.styleSheets].flatMap(s => {
      try { return [...s.cssRules] } catch { return [] }
    })) {
      if (r.selectorText === ':focus-visible') return r.style.outline
    }
    return null
  })
  ok(focus !== null && focus !== '', `the focus ring is intact (${focus})`)
  await page.close()
}

await browser.close()
