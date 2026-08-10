// The header, under the conditions that break it.
//
//   node scripts/probe-header.mjs <url> [shots-dir]
//
// Two failures seen on a real atlas and not on any demo:
//   1. the Figure style menu was clipped by the control bar's scroll container
//   2. a long object name inverted the header's hierarchy and wrapped
//
// So this stamps the atlas's own name and source onto a demo and looks.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
const ok = (b, m) => console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`)

const NAME = 'developing_mouse_nervous_system'
const SOURCE = 'developing_mouse_nervous_system.h5ad · developing_mouse_nervous_system '
  + '(AnnData, converted in scRNA-seq Lab)'

const browser = await chromium.launch({ executablePath: EXE })

// 1010 is where the reported screenshots were taken: 2010 device pixels at 2x.
// It is the width that actually hurts — eight tabs and five bar controls.
for (const width of [1010, 1440, 1920]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByText('Replicated cohort', { exact: true }).click()
  await page.waitForSelector('[role="tablist"]')

  // Wear the atlas's identity: the demo labels are prose, the real ones are
  // long unbroken snake_case, which is what actually stresses the layout.
  await page.evaluate(([name, source]) => {
    const head = document.querySelector('header')
    for (const el of head.querySelectorAll('*')) {
      const t = el.textContent
      if (t.startsWith('Adult SVZ neural stem') && el.children.length <= 1) {
        el.childNodes[0].nodeValue = name
      }
      if (t.startsWith('SVZ_NSC_reactivation') && !el.children.length) el.textContent = source
    }
  }, [NAME, SOURCE])
  await page.waitForTimeout(150)

  console.log(`\n${width}px viewport`)

  const head = await page.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect()
    const main = document.querySelector('main').getBoundingClientRect()
    return { height: Math.round(h.height), mainTop: Math.round(main.top) }
  })
  // 139, measured, not guessed: identity 42 + tab row 53 (an 18px group label
  // over a 35px tab) + bar 43 + one hairline. Each row is doing a job, so the
  // budget is what they add up to. A pixel over means a row grew and someone
  // should say why — it is a regression guard, not a target to design toward.
  ok(head.height <= 140, `header is ${head.height}px tall`)

  // Nothing in the header may overflow it horizontally.
  const spill = await page.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect()
    const out = []
    for (const el of document.querySelectorAll('header *')) {
      const r = el.getBoundingClientRect()
      if (!r.width) continue
      if (r.right > h.right + 1 || r.left < h.left - 1) {
        out.push(`${el.className.toString().split(' ')[0] || el.tagName} "${el.textContent.trim().slice(0, 24)}"`)
      }
    }
    return out
  })
  ok(spill.length === 0, `nothing spills out of the header${spill.length ? `\n        ${spill.join('\n        ')}` : ''}`)

  await page.screenshot({ path: `${shots}/header-${width}.png`, clip: { x: 0, y: 0, width, height: head.mainTop } })

  // The Figure style menu must be fully visible, not clipped by the bar.
  await page.getByRole('button', { name: 'Figure style' }).click()
  await page.waitForTimeout(300)
  const menu = await page.evaluate(() => {
    const m = document.querySelector('[role="dialog"][aria-label="Figure style"]')
    if (!m) return null
    const r = m.getBoundingClientRect()
    // Walk up for any ancestor that clips, and measure how much is lost.
    let clip = null
    for (let n = m.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const cr = n.getBoundingClientRect()
        if (r.bottom > cr.bottom + 1) {
          clip = { by: n.className.toString().split(' ').slice(0, 2).join('.'), lost: Math.round(r.bottom - cr.bottom) }
        }
        break
      }
    }
    return { h: Math.round(r.height), bottom: Math.round(r.bottom), clip }
  })
  ok(menu !== null, 'the Figure style menu opened')
  if (menu) {
    ok(menu.clip === null,
      `it is not clipped${menu.clip ? ` — ${menu.clip.lost}px lost to .${menu.clip.by}` : ''}`)
    ok(menu.bottom < 900, `it fits on screen (bottom at ${menu.bottom}px)`)
  }
  await page.screenshot({ path: `${shots}/header-menu-${width}.png`, clip: { x: 0, y: 0, width, height: Math.min(520, 900) } })
  await page.close()
}

await browser.close()
