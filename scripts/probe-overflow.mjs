// Every label in the studio: does it leave its box, and does it hit a neighbour?
//
//   node scripts/probe-overflow.mjs <url> [shots-dir]
//
// src/index.css sets `svg { overflow: visible }` globally. That is right for
// figures — a legend may sit slightly proud of its plot — and it means a chart
// that under-reserves does not clip, it PAINTS on whatever is beside it.
//
// TWO failures, not one, and the first version of this probe only caught the
// first. Comparing the root SVG's getBBox against its viewBox finds ink that
// has left the box; it cannot see two labels sitting on top of each other
// INSIDE it, because their union is still inside. An adversarial review found
// 41 overlapping pairs in a chart this probe had just called clean.
//
// So every <text> is measured on its own, and rotated text is measured as a
// true quad: getBBox is in the element's own coordinate system, so the corners
// are pushed through getScreenCTM to get what is actually on screen. Overlap is
// then separating-axis penetration between those quads.

import { chromium } from 'playwright-core'

const EXE = 'C:/Users/Lin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const [url = 'http://localhost:4430', shots = '.'] = process.argv.slice(2)
let failed = 0
const ok = (b, m) => { if (!b) failed++; console.log(`  ${b ? 'ok  ' : 'FAIL'}  ${m}`) }
const NL = String.fromCharCode(10)

const LONG = 'Cardiomyocyte/Working cardiomyocyte EXCLUDED'

const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))

const audit = () => page.evaluate(() => {
  /** A text element's four corners, in screen pixels. */
  const quad = (el) => {
    const b = el.getBBox()
    const m = el.getScreenCTM()
    if (!m) return null
    const pt = (x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(m)
      return [p.x, p.y]
    }
    return [pt(b.x, b.y), pt(b.x + b.width, b.y),
      pt(b.x + b.width, b.y + b.height), pt(b.x, b.y + b.height)]
  }
  /** Separating-axis penetration depth between two convex quads, 0 if apart. */
  const hit = (A, B) => {
    let min = Infinity
    for (const poly of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4]
        const nx = -(y2 - y1), ny = x2 - x1
        const len = Math.hypot(nx, ny) || 1
        const ax = nx / len, ay = ny / len
        const proj = q => q.map(([x, y]) => x * ax + y * ay)
        const a = proj(A), b = proj(B)
        const overlap = Math.min(Math.max(...a), Math.max(...b))
          - Math.max(Math.min(...a), Math.min(...b))
        if (overlap <= 0) return 0
        min = Math.min(min, overlap)
      }
    }
    return min
  }

  const spill = [], clash = []
  let charts = 0, labels = 0
  for (const svg of document.querySelectorAll('svg')) {
    const vb = svg.viewBox?.baseVal
    if (!vb || !vb.width || !svg.getClientRects().length) continue
    charts++
    const name = (svg.getAttribute('aria-label') ?? 'svg').slice(0, 40)

    // 1. ink outside the viewBox
    let box
    try { box = svg.getBBox() } catch { box = null }
    if (box && box.width) {
      const over = {
        top: +(vb.y - box.y).toFixed(1),
        left: +(vb.x - box.x).toFixed(1),
        right: +(box.x + box.width - (vb.x + vb.width)).toFixed(1),
        bottom: +(box.y + box.height - (vb.y + vb.height)).toFixed(1),
      }
      const bad = Object.entries(over).filter(([, v]) => v > 2)
      if (bad.length) spill.push(`${name}: ${bad.map(([k, v]) => `${k}+${v}`).join(' ')}`)
    }

    // 2. labels on top of each other, measured as true quads
    const texts = [...svg.querySelectorAll('text')].filter(t => {
      if (!t.textContent.trim()) return false
      const r = t.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    labels += texts.length
    const quads = texts.map(quad)
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (!quads[i] || !quads[j]) continue
        const d = hit(quads[i], quads[j])
        // 1.5 px of slack: adjacent glyph boxes routinely share a hairline.
        if (d > 1.5) {
          clash.push(`${name}: "${texts[i].textContent.trim().slice(0, 18)}" >< `
            + `"${texts[j].textContent.trim().slice(0, 18)}" ${d.toFixed(1)}px`)
        }
      }
    }
  }
  return { spill, clash, charts, labels }
})

/** Canvas labels, captured by hooking fillText — getBBox cannot see them. */
const hookCanvas = () => page.evaluate(() => {
  window.__canvasLabels = []
  const proto = CanvasRenderingContext2D.prototype
  if (proto.__hooked) return
  proto.__hooked = true
  const orig = proto.fillText
  proto.fillText = function (text, x, y, ...rest) {
    try {
      window.__canvasLabels.push({
        text: String(text), x, y, align: this.textAlign, font: this.font,
        w: this.measureText(String(text)).width,
        cw: this.canvas.width, ch: this.canvas.height,
      })
    } catch { /* never break a render to measure it */ }
    return orig.call(this, text, x, y, ...rest)
  }
})

const canvasAudit = () => page.evaluate(() => {
  const L = window.__canvasLabels ?? []
  // Only the label passes, not tick text: a label is drawn centred on a point.
  const boxes = L.filter(l => l.align === 'center' && l.w > 0).map(l => ({
    ...l, x0: l.x - l.w / 2, x1: l.x + l.w / 2,
  }))
  const outside = boxes.filter(b => b.x0 < -1 || b.x1 > b.cw + 1)
    .map(b => `"${b.text.slice(0, 22)}" ${b.w.toFixed(0)}px on a ${b.cw}px canvas`)
  const over = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.cw !== b.cw || Math.abs(a.y - b.y) > 12) continue
      const d = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
      if (d > 2) over.push(`"${a.text.slice(0, 16)}" >< "${b.text.slice(0, 16)}" ${d.toFixed(0)}px`)
    }
  }
  return { n: boxes.length, outside, over }
})

async function walk(what) {
  const tabs = await page.$$eval('[role="tab"]',
    els => els.filter(e => !e.disabled).map(e => e.textContent.trim()))
  let charts = 0, labels = 0
  const spill = [], clash = []
  for (const t of tabs) {
    await page.getByRole('tab', { name: t, exact: true }).click()
    await page.waitForTimeout(1100)
    const a = await audit()
    charts += a.charts; labels += a.labels
    spill.push(...a.spill.map(s => `${t} · ${s}`))
    clash.push(...a.clash.map(s => `${t} · ${s}`))
  }
  const show = (list, n = 6) => list.slice(0, n).map(s => `${NL}          ${s}`).join('')
    + (list.length > n ? `${NL}          …and ${list.length - n} more` : '')
  ok(spill.length === 0, `${what}: ${charts} charts, ${labels} labels — `
    + `${spill.length} paint outside their box${spill.length ? show(spill) : ''}`)
  ok(clash.length === 0, `${what}: ${clash.length} label pairs overlap${clash.length ? show(clash) : ''}`)
  return { charts, labels }
}

await page.goto(url, { waitUntil: 'networkidle' })
await hookCanvas()
await page.getByText('Time course', { exact: true }).click()
await page.waitForSelector('[role="tablist"]')
await hookCanvas()

console.log(`${NL}EVERY TAB, AS SHIPPED`)
const a1 = await walk('as shipped')
ok(a1.labels >= 100, `enough labels were actually measured (${a1.labels})`)

console.log(`${NL}EVERY PLOT TYPE AND GROUPING ON GENE EXPRESSION`)
await page.getByRole('tab', { name: 'Gene expression' }).click()
await page.waitForTimeout(700)
for (const mode of ['Across cell types', 'Across groups', 'Cell type × group']) {
  const mb = page.getByRole('button', { name: mode, exact: true })
  if (!(await mb.count())) continue
  await mb.click()
  await page.waitForTimeout(400)
  // The plot type must be re-selected inside the loop: leaving it on Feature
  // is why the first version of this probe reported "nothing SVG on screen"
  // for two of these and printed it as a skip rather than as no coverage.
  for (const plot of ['Violin panel', 'Dot plot']) {
    const pb = page.getByRole('button', { name: plot, exact: true })
    if (!(await pb.count())) continue
    await pb.click()
    await page.waitForTimeout(1500)
    const a = await audit()
    ok(a.spill.length === 0 && a.clash.length === 0,
      `${plot} / ${mode}: ${a.charts} charts, ${a.labels} labels, `
      + `${a.spill.length} spill, ${a.clash.length} overlap`
      + (a.spill.length ? `${NL}          ${a.spill.slice(0, 3).join(`${NL}          `)}` : '')
      + (a.clash.length ? `${NL}          ${a.clash.slice(0, 3).join(`${NL}          `)}` : ''))
  }
}

/**
 * Cluster names on the embeddings.
 *
 * They are only drawn when the panel is wide enough to hold them — Cells passes
 * `labels={panels.length <= 2}` — and this demo opens SPLIT BY GROUP, four
 * panels across. So the first version of this section reported "0 canvas
 * labels" and counted its two follow-up checks as passes: nothing was drawn,
 * therefore nothing was wrong. Un-split first, and fail loudly on a zero.
 */
async function canvas(what) {
  await page.getByRole('tab', { name: 'Cells' }).click()
  await page.waitForTimeout(900)
  const split = page.getByRole('button', { name: 'Split by group', exact: true })
  if (await split.count() && await split.getAttribute('aria-pressed') === 'true') {
    await split.click()
  }
  await page.waitForTimeout(1600)
  const c = await canvasAudit()
  ok(c.n > 0, `${what}: ${c.n} canvas labels captured`)
  ok(c.outside.length === 0, `${what}: none wider than its canvas`
    + (c.outside.length ? `${NL}          ${c.outside.slice(0, 4).join(`${NL}          `)}` : ''))
  ok(c.over.length === 0, `${what}: ${c.over.length} overlap each other`
    + (c.over.length ? `${NL}          ${c.over.slice(0, 4).join(`${NL}          `)}` : ''))
}

console.log(`${NL}CANVAS LABELS (cluster names on the embeddings)`)
await canvas('as shipped')

console.log(`${NL}AFTER RENAMING A CLUSTER TO ${LONG.length} CHARACTERS`)
await page.getByRole('tab', { name: 'Markers' }).click()
await page.waitForTimeout(1300)
const rename = page.locator('input.inp').first()
if (await rename.count()) {
  await rename.fill(LONG)
  await rename.blur()
  await page.waitForTimeout(1300)
  await walk('long names')
  await page.evaluate(() => { window.__canvasLabels = [] })
  await canvas('long names')
} else ok(false, 'could not find a rename field on Markers')
await page.screenshot({ path: `${shots}/overflow-long.png`, fullPage: true })

if (errors.length) console.log(`${NL}  ERRORS: ${errors.slice(0, 5).join(' | ')}`)
console.log(`${NL}  ${failed === 0 ? 'all clear' : `${failed} failing check(s)`}`)
await browser.close()
process.exit(failed ? 1 : 0)
