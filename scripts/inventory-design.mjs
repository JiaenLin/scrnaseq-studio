// The inventory: every word and every element of the studio, measured from the
// running app (docs/design/COPY.md, docs/design/ELEMENTS.md).
//
//   CHROME=<a Chrome or Chromium binary> node scripts/inventory-design.mjs <url> <out.json>
//   node scripts/inventory-report.mjs   (writes the two documents from the JSON)
//
// It walks every view and state a reader can reach on the synthetic demos and
// the committed synthetic lab bundle (testdata/lab/family-2x2.zip): each tab,
// each option of each rail control, every menu, picker and popover opened, one
// key entry isolated, a volcano point pinned, the error boundary, a file that
// is not a bundle, a gene that is not in the object, and every figure saved
// once (the SVG's own text, or what a canvas figure paints into its PNG).
//
// For every piece of text it records where it is, what kind of element holds
// it, its words, its characters and its type size; for every control, its box
// (height, padding, radius, edge, type), its states and the gap to the control
// before it. Nothing here is typed by hand: a string that is not on a screen
// this script reaches is not in the inventory, and the report says which
// states were walked.
//
// Needs `playwright-core` on the module path, like scripts/shot-design.mjs.

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { words, shapeOf } from './copy-standard.mjs'

const [url = 'http://localhost:4173', outFile = 'docs/design/inventory/after.json'] = process.argv.slice(2)
const LAB = path.resolve('testdata/lab/family-2x2.zip')
const W = 1440, H = 900

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true })
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, colorScheme: 'light', reducedMotion: 'reduce', deviceScaleFactor: 1,
  acceptDownloads: true,
})
// What a canvas figure writes into its file: the painted key, names and foot.
await ctx.addInitScript(() => {
  window.__painted = null
  const orig = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...r) {
    if (window.__painted) window.__painted.push({ t: String(t), x: Math.round(x), y: Math.round(y), font: this.font })
    return orig.call(this, t, x, y, ...r)
  }
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))

const states = []     // { name, view, words: {app, data}, texts: [...] }
const elements = []   // { view, state, kind, sig, ... }
const saved = []      // { state, figure, format, title, key, notes, own }
const stateStyles = {} // kind -> { hover, focus }

const settle = async (ms = 450) => {
  await page.waitForTimeout(ms)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Runs in the page: every visible piece of text and every control, as drawn. */
const collect = () => page.evaluate(() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim()
  const vis = el => {
    if (!el.getClientRects().length) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none'
  }
  const inView = el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  }
  const where = el => el.closest('.menu-in') ? 'menu' : el.closest('.tip') ? 'readout'
    : el.closest('dialog') ? 'dialog' : el.closest('aside.rail') ? 'rail' : el.closest('aside.inspector') ? 'key pane'
      : el.closest('.stage-head, .sect-head') ? 'head line' : el.closest('.stage-foot') ? 'status line'
        : el.closest('.viewbar, [role="tablist"]') ? 'tabs' : el.closest('.appbar') ? 'bar'
          : el.closest('main') ? 'stage' : 'page'
  const cls = el => (el.className?.baseVal ?? el.className ?? '').toString()
  const chain = el => {
    const out = []
    for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      out.push(e.tagName.toLowerCase() + (cls(e) ? '.' + cls(e).split(/\s+/).filter(c => !/[[:]/.test(c)).slice(0, 3).join('.') : ''))
    }
    return out.join(' < ')
  }
  const numeric = s => !/[A-Za-zÀ-ɏ]/.test(s.replace(/\b(e|E)[-+]?\d+/g, ''))
  const ownText = el => [...el.childNodes].filter(n => !(n.nodeType === 1 && n.tagName.toLowerCase() === 'title')).map(n => n.textContent).join('')
  const kindOf = el => {
    const svg = el.closest('svg')
    if (svg && !el.closest('button, .ico')) {
      if (el.closest('[data-foot]')) return 'figure legend'
      const t = norm(ownText(el))
      // A name the figure had to wrap or shorten carries its whole form in a <title>: the object's word, not the app's.
      return numeric(t) || el.querySelector(':scope > title') ? 'tick' : 'figure text'
    }
    // What the lab's converter wrote into the bundle, shown as it wrote it: not this app's words.
    if (/conversion/i.test(el.closest('.card, section')?.querySelector('.eyebrow, .card-title, h2, h3')?.textContent ?? '') && el.closest('li, td, dd')) return 'value'
    if (el.closest('.demo-row')) return /tx-micro/.test(cls(el)) ? 'menu item note' : el.closest('.badge') ? 'badge' : 'menu item'
    if (/tx-micro/.test(cls(el)) && el.closest('label') && !el.closest('button')) return 'help'
    if (el.closest('.tip')) return 'readout'
    if (el.closest('.menu-foot')) return 'menu note'
    if (el.closest('[role="tab"]')) return 'tab'
    if (el.closest('[role="menuitem"], [role="option"]')) return /tx-micro|sub/.test(cls(el)) ? 'menu item note' : 'menu item'
    if (el.closest('.lg-row')) return 'key entry'
    if (el.closest('.opt')) return 'option'
    if (el.closest('.chip')) return 'chip'
    if (el.closest('.seg')) return 'segment'
    if (el.closest('button[aria-haspopup="listbox"]')) return 'picker'
    if (el.closest('button, a.btn, [role="button"], summary')) return 'button'
    if (el.closest('th')) return 'table header'
    if (el.closest('td')) return 'table cell'
    if (el.closest('.badge, [class*="badge-"]')) return 'badge'
    if (el.closest('.empty')) return el.closest('.tx-title, h1, h2, h3, strong, b') || /tx-title|font-semibold/.test(cls(el)) ? 'empty state title' : 'empty state'
    if (el.closest('.note')) return 'note'
    if (el.closest('.rail-status')) return 'status'
    if (el.closest('.rail-label, label, .tx-label, dt')) return 'label'
    if (el.closest('h1, h2, h3, .stage-title, .card-title, .tpane-name, .plot-name, .appmark')) return 'title'
    if (el.closest('.stage-meta, .stage-foot, .figscroll-note')) return 'status'
    if (el.closest('.legend, .tnote, figcaption')) return 'legend'
    if (el.closest('aside.rail')) return 'help'
    if (el.closest('a')) return 'link'
    if (el.closest('.stats, dd')) return 'value'
    return 'text'
  }
  const texts = []
  const push = (el, text, kind, src) => {
    const t = norm(text)
    if (!t) return
    const cs = getComputedStyle(el)
    texts.push({
      where: where(el), kind, src, text: t, px: Math.round(parseFloat(cs.fontSize) * 10) / 10, wt: cs.fontWeight,
      inView: inView(el), at: chain(el), numeric: numeric(t),
    })
  }
  const walk = el => {
    if (!vis(el)) return
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return
    if (tag === 'title' && el.closest('svg')) return
    const title = el.getAttribute('title')
    if (title) push(el, title, 'tooltip', 'title')
    const ph = el.getAttribute('placeholder')
    if (ph) push(el, ph, 'placeholder', 'placeholder')
    const al = el.getAttribute('aria-label')
    if (al && norm(al) !== norm(el.innerText ?? el.textContent) && !el.closest('svg[aria-hidden]')) push(el, al, 'accessible name', 'aria-label')
    if (tag === 'text') { push(el, ownText(el), kindOf(el), 'text'); return }
    if (tag === 'select') { push(el, el.selectedOptions[0]?.textContent, 'picker', 'text'); return }
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (direct) { push(el, el.innerText ?? el.textContent, kindOf(el), 'text'); return }
    for (const c of el.children) walk(c)
  }
  walk(document.body)
  // An SVG mark's own tooltip (<title>), one per distinct sentence shape.
  const seen = new Set()
  for (const t of document.querySelectorAll('svg title')) {
    const s = norm(t.textContent), k = s.replace(/[-−]?\d[\d,.]*(e[-+]?\d+)?/g, '#')
    if (!s || seen.has(k) || !vis(t.parentElement)) continue
    seen.add(k)
    texts.push({ where: where(t), kind: 'tooltip', src: 'svg title', text: s, px: 0, wt: '', inView: true, at: chain(t.parentElement), numeric: numeric(s) })
  }

  // Every control, as drawn.
  const KINDS = {
    'button': 'button.btn:not(.btn-primary):not(.btn-quiet):not(.btn-icon)',
    'primary button': '.btn-primary',
    'quiet button': '.btn-quiet',
    'icon button': '.btn-icon',
    'tab': '[role="tab"]',
    'segment': '.seg > button, .seg > label',
    'segmented control': '.seg',
    'chip': '.chip',
    'option row': '.opt',
    'picker': 'button[aria-haspopup="listbox"], select, .sel',
    'menu': '.menu-in',
    'menu item': '.menu-in [role="menuitem"], .menu-in [role="option"]',
    'table head cell': 'table th',
    'table row': 'table tbody tr',
    'key row': '.lg-row',
    'input': 'input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea',
    'switch': '.switch',
    'checkbox': 'input[type="checkbox"], input[type="radio"]',
    'badge': '.badge, [class*="badge-"]',
    'readout': '.tip',
    'note': '.note',
    'card': '.card',
    'section head': '.sect-head',
    'stage head': '.stage-head',
    'status line': '.stage-foot',
    'rail group': '.rail-group',
    'rail label': '.rail-label',
    'swatch': '.sw',
    'divider': 'hr, .gsep',
    'empty state': '.empty',
  }
  const px = v => Math.round(parseFloat(v) * 10) / 10 || 0
  const els = []
  for (const [kind, sel] of Object.entries(KINDS)) {
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue
      const cs = getComputedStyle(el), r = el.getBoundingClientRect()
      const prev = el.previousElementSibling
      let gap = null
      if (prev && vis(prev)) {
        const p = prev.getBoundingClientRect()
        gap = Math.abs(p.top - r.top) < 4 ? `${Math.round(r.left - p.right)} across` : `${Math.round(r.top - p.bottom)} down`
      }
      const on = ['aria-selected', 'aria-pressed', 'aria-checked', 'aria-current'].some(a => el.getAttribute(a) === 'true') || el.checked === true
      els.push({
        kind, where: where(el), h: Math.round(r.height * 10) / 10, w: Math.round(r.width),
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px).join(' '),
        radius: px(cs.borderTopLeftRadius), font: px(cs.fontSize), wt: cs.fontWeight,
        edge: `${px(cs.borderTopWidth)} ${px(cs.borderRightWidth)} ${px(cs.borderBottomWidth)} ${px(cs.borderLeftWidth)}`,
        edgeInk: cs.borderTopWidth !== '0px' ? cs.borderTopColor : cs.borderBottomWidth !== '0px' ? cs.borderBottomColor : cs.borderLeftWidth !== '0px' ? cs.borderLeftColor : '',
        bg: cs.backgroundColor, ink: cs.color, shadow: cs.boxShadow === 'none' ? '' : 'shadow',
        state: el.disabled || el.getAttribute('aria-disabled') === 'true' ? 'disabled' : on ? 'selected' : 'default',
        gap, cls: cls(el).split(/\s+/).filter(c => !/[[:]/.test(c)).slice(0, 4).join(' '),
        text: norm(el.innerText ?? el.textContent).slice(0, 40),
      })
    }
  }
  // The object's own names (genes, cell types, groups, samples, gene sets): data, not the app's words.
  const names = []
  for (const el of document.querySelectorAll('td.mono, td .mono, .mono, .lg-row, [role="option"], .set-row, tbody th, svg text:has(> title)')) {
    const t = norm(el.tagName.toLowerCase() === 'text' ? el.querySelector('title').textContent : el.innerText ?? el.textContent).replace(/\s*[\d,]+$/, '')
    if (t && t.length < 80) names.push(t)
  }
  return { texts, els, names }
})

const DATA_KINDS = new Set(['table cell', 'tick', 'key entry', 'value'])
const dataNames = new Set()
// Words of a name that are also the app's words stay words.
const COMMON = new Set(['cell', 'cells', 'type', 'types', 'the', 'of', 'and', 'in', 'to', 'by', 'all', 'group', 'groups', 'sample', 'samples', 'gene', 'genes', 'set', 'sets', 'vs', 'only', 'response', 'process', 'signaling', 'pathway', 'up', 'down', 'early', 'late', 'a', 'an', 'none', 'any', 'every', 'own', 'pick', 'one', 'reference', 'my'])

async function capture(name) {
  const view = name.split(/ \/ | > /)[0]
  const { texts, els, names } = await collect()
  for (const t of texts) { t.words = words(t.text); t.chars = t.text.length }
  for (const n of names) { dataNames.add(n); for (const w of n.split(/[\s,]+/)) if (/[A-Za-z]/.test(w) && w.length > 1 && !COMMON.has(w.toLowerCase())) dataNames.add(w) }
  states.push({ name, view, texts })
  for (const e of els) elements.push({ view, state: name, ...e })
}

/** hover and focus of the first control of each kind, once per kind. */
async function probeStates(kindSel) {
  for (const [kind, sel] of Object.entries(kindSel)) {
    if (stateStyles[kind]) continue
    const loc = page.locator(sel).locator('visible=true').first()
    if (!await loc.count()) continue
    const read = () => loc.evaluate(el => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, ink: cs.color, edge: cs.borderTopColor, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`, shadow: cs.boxShadow }
    })
    try {
      const rest = await read()
      await loc.hover({ timeout: 1500, force: true }); await page.waitForTimeout(220)
      const hover = await read()
      await page.mouse.move(2, 2)
      await page.keyboard.press('Shift')
      await loc.evaluate(el => el.focus({ focusVisible: true })); await page.waitForTimeout(220)
      const focus = await read()
      await loc.evaluate(el => el.blur())
      stateStyles[kind] = { rest, hover, focus }
    } catch { /* not hoverable here: tried again on the next view */ }
  }
}
const PROBE = {
  'button': 'button.btn:not(.btn-primary):not(.btn-quiet):not(.btn-icon):not([disabled])',
  'primary button': '.btn-primary:not([disabled])', 'quiet button': '.btn-quiet:not([disabled])',
  'icon button': '.btn-icon:not([disabled])', 'tab': '[role="tab"]:not([disabled]):not([aria-selected="true"])',
  'segment': '.seg > button:not([aria-pressed="true"]):not([aria-checked="true"])', 'chip': '.chip:not([disabled])',
  'option row': '.opt:not([aria-checked="true"]):not([aria-pressed="true"])',
  'picker': 'button[aria-haspopup="listbox"]:not([disabled])', 'menu item': '.menu-in [role="menuitem"], .menu-in [role="option"]:not([disabled])',
  'table row': 'main table tbody tr', 'key row': 'button.lg-row', 'input': 'input[type="text"], input[type="search"], input:not([type])',
  'switch': '.switch', 'table head cell': 'table th button, table th',
}

const label = async loc => (await loc.evaluate(el => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim())).slice(0, 36)

/** Open every menu, picker and popover on the screen, one at a time. */
async function popovers(name, scope = 'body') {
  const q = `${scope} button[aria-haspopup]:not([disabled])`
  const n = await page.locator(q).locator('visible=true').count()
  for (let i = 0; i < n; i++) {
    const b = page.locator(q).locator('visible=true').nth(i)
    if (!await b.count()) break
    const kind = await b.getAttribute('aria-haspopup')
    const l = await label(b)
    try { await b.click({ timeout: 2000 }) } catch { continue }
    await settle(300)
    await capture(`${name} > ${kind === 'listbox' ? 'picker' : 'menu'}: ${l}`)
    await probeStates(PROBE)
    await page.keyboard.press('Escape'); await settle(200)
  }
}

/** Each option of each rail control, one at a time from the state the view is in, then put back. */
async function sweepRail(name, { skip = /$^/ } = {}) {
  const q = 'aside.rail .opt, aside.rail .seg > button, aside.rail .chip, aside.rail .switch, aside.rail input[type="checkbox"]'
  const n = await page.locator(q).locator('visible=true').count()
  for (let i = 0; i < n; i++) {
    const b = page.locator(q).locator('visible=true').nth(i)
    if (!await b.count()) break
    const l = await label(b)
    if (skip.test(l)) continue
    const on = await b.evaluate(el => ['aria-checked', 'aria-pressed', 'aria-selected'].some(a => el.getAttribute(a) === 'true') || el.checked === true)
    const single = await b.evaluate(el => el.matches('.opt, .seg > button') && !el.matches('.chip'))
    if (on && single) continue
    // The one that was chosen in this control, to return to.
    const backIdx = single ? await b.evaluate(el => {
      const sibs = [...el.parentElement.children]
      return sibs.findIndex(s => ['aria-checked', 'aria-pressed', 'aria-selected'].some(a => s.getAttribute(a) === 'true'))
    }) : -1
    try { await b.click({ timeout: 2000 }) } catch { continue }
    await settle(900)
    await capture(`${name} / ${l}`)
    if (single && backIdx >= 0) await b.evaluate((el, k) => el.parentElement.children[k]?.click(), backIdx)
    else if (!single) { try { await b.click({ timeout: 2000 }) } catch { /* gone */ } }
    await settle(500)
  }
}

/** Save the figure in the head line once (SVG where offered) and read the file's own words. */
async function save(name) {
  const btns = page.locator('button[aria-haspopup="menu"]').locator('visible=true')
  const n = await btns.count()
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i)
    const title = (await b.getAttribute('title')) || (await b.getAttribute('aria-label')) || ''
    if (!/^(Download|Save)/.test(title)) continue
    if (i > 1 && /fig-corner/.test(await b.getAttribute('class') || '')) continue   // one panel of a sheet is enough
    await b.click({ force: true }); await settle(300)
    if (i === 0) await capture(`${name} > menu: Save`)
    const svgItem = page.locator('.menu-in [role="menuitem"]', { hasText: 'SVG' })
    const item = await svgItem.count() ? svgItem.first() : page.locator('.menu-in [role="menuitem"]', { hasText: '300' }).first()
    if (!await item.count()) { await page.keyboard.press('Escape'); continue }
    await page.evaluate(() => { window.__painted = [] })
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }).catch(() => null), item.click()])
    if (!dl) continue
    const file = path.join(os.tmpdir(), `inv-${Date.now()}-${dl.suggestedFilename()}`)
    await dl.saveAs(file)
    const painted = await page.evaluate(() => { const p = window.__painted; window.__painted = null; return p })
    const rec = { state: name, figure: title.replace(/^(Download|Save) /, ''), file: dl.suggestedFilename(), format: file.endsWith('.svg') ? 'SVG' : 'PNG', own: [], foot: [] }
    if (rec.format === 'SVG') {
      const xml = fs.readFileSync(file, 'utf8')
      const un = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
      const footAt = xml.indexOf('<g data-foot')
      const body = footAt < 0 ? xml : xml.slice(0, footAt), foot = footAt < 0 ? '' : xml.slice(footAt)
      for (const m of body.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) { const t = un(m[1]); if (t) rec.own.push(t) }
      for (const m of foot.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
        const t = un(m[2]); if (t) rec.foot.push({ t, bold: /font-weight="600"/.test(m[1]), x: +(m[1].match(/\bx="([\d.]+)"/)?.[1] ?? 0), y: +(m[1].match(/\by="([\d.]+)"/)?.[1] ?? 0) })
      }
    } else {
      // A canvas figure: what it painted, top to bottom (names, key, foot).
      for (const p of painted ?? []) rec.own.push(p.t)
    }
    fs.rmSync(file, { force: true })
    saved.push(rec)
    await settle(300)
  }
}

const tab = async name => {
  await page.getByRole('tab', { name, exact: true }).click()
  await settle(800)
}
const open = async (demo, q = '') => {
  await page.goto(url + q, { waitUntil: 'networkidle' })
  await page.getByText(demo, { exact: true }).click()
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 })
  await settle(800)
}
const step = async (what, fn) => {
  try { await fn() } catch (e) { errors.push(`${what}: ${String(e.message).split('\n')[0]}`) }
}

// ───────────────────────── the walk ─────────────────────────

await page.goto(url, { waitUntil: 'networkidle' }); await settle()
await capture('Landing'); await probeStates(PROBE)
await step('landing, not a bundle', async () => {
  const bad = path.join(os.tmpdir(), 'not-a-bundle.txt')
  fs.writeFileSync(bad, 'gene,value\nA,1\n')
  await page.setInputFiles('input[type=file]', bad); await settle(1200)
  await capture('Landing / a file that is not a bundle')
})

await open('Replicated cohort')
await step('overview', async () => { await tab('Overview'); await capture('Overview'); await probeStates(PROBE); await popovers('Overview', 'main') })

await step('cells', async () => {
  await tab('Cells'); await capture('Cells'); await probeStates(PROBE)
  await popovers('Cells'); await save('Cells')
  // The pointer readout.
  const cv = page.locator('main canvas').first()
  const box = await cv.boundingBox()
  if (box) {
    for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.45], [0.6, 0.55], [0.35, 0.6], [0.55, 0.4]]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy); await settle(200)
      if (await page.locator('.tip').locator('visible=true').count()) break
    }
    await capture('Cells / pointer on a cell'); await page.mouse.move(2, 2)
  }
  const entry = page.locator('aside.inspector button.lg-row').nth(3)
  if (await entry.count()) {
    await entry.click(); await settle(); await capture('Cells / one key entry isolated'); await probeStates(PROBE)
    await page.keyboard.press('Escape'); await settle()
  }
  await sweepRail('Cells')
  await page.keyboard.press(']'); await settle(); await capture('Cells / key pane closed')
  await page.keyboard.press('['); await settle(); await capture('Cells / both panes closed')
  await page.keyboard.press('['); await page.keyboard.press(']'); await settle()
})

await step('composition', async () => {
  await tab('Composition'); await capture('Composition'); await probeStates(PROBE)
  await popovers('Composition', 'main, aside.rail'); await save('Composition'); await sweepRail('Composition')
})

await step('markers', async () => {
  await tab('Markers'); await capture('Markers / before a run')
  const find = page.getByRole('button', { name: /^(Find|Run)/ }).first()
  if (await find.count()) { await find.click(); await page.waitForTimeout(60); await capture('Markers / running') }
  await page.waitForSelector('main svg[role="img"]', { timeout: 120_000 }).catch(() => {})
  await settle(900); await capture('Markers'); await probeStates(PROBE)
  await popovers('Markers', 'main, aside.rail'); await save('Markers'); await sweepRail('Markers')
})

await step('differential expression', async () => {
  await tab('Differential expression'); await capture('Differential expression / before a run'); await probeStates(PROBE)
  const pickers = page.locator('aside.rail > .rail-group button[aria-haspopup="listbox"]')
  for (let i = 0; i < await pickers.count(); i++) {
    await pickers.nth(i).click(); await settle(300)
    await capture(`Differential expression > picker: ${await label(pickers.nth(i))}`); await probeStates(PROBE)
    await page.locator('[role="option"]:not([disabled])').first().click()
    await page.keyboard.press('Escape'); await settle(300)
  }
  await capture('Differential expression / a contrast chosen')
  await sweepRail('Differential expression / before a run', { skip: /^$/ })
  const run = page.getByRole('button', { name: 'Run', exact: true })
  if (await run.count()) { await run.click(); await page.waitForTimeout(60); await capture('Differential expression / running') }
  await page.waitForSelector('main table', { timeout: 180_000 }).catch(() => {})
  await settle(900); await capture('Differential expression'); await probeStates(PROBE)
  await popovers('Differential expression', 'main')
  for (const name of ['Volcano', 'Enrichment']) {
    const b = page.getByRole('button', { name, exact: true })
    if (!await b.count()) continue
    await b.first().click(); await settle(2500); await capture(`Differential expression / ${name}`); await probeStates(PROBE)
    await popovers(`Differential expression / ${name}`, 'main'); await save(`Differential expression / ${name}`)
    if (name === 'Volcano') {
      const pt = page.locator('main svg[role="img"] circle[data-gene]').first()
      if (await pt.count()) {
        await pt.hover({ force: true }); await settle(300); await capture('Differential expression / Volcano / pointer on a gene')
        await pt.click({ force: true }); await settle(400); await capture('Differential expression / Volcano / a gene pinned')
      }
    } else {
      const row = page.locator('main table tbody tr, main svg[role="img"] [data-term]').first()
      if (await row.count()) { await row.click({ force: true }); await settle(600); await capture('Differential expression / Enrichment / a term opened') }
      await sweepRail('Differential expression / Enrichment')
    }
  }
})

await step('gene expression', async () => {
  await tab('Gene expression'); await capture('Gene expression / before a gene'); await probeStates(PROBE)
  const q = page.locator('input[aria-label="Search a gene or paste a gene list"]')
  await q.fill('Zzzz9'); await q.press('Enter'); await settle(900); await capture('Gene expression / a gene that is not in the object')
  await q.fill('Gfap, Ascl1, Mki67, Dcx, Plp1, Cx3cr1'); await q.press('Enter'); await settle(2500)
  for (const name of ['Violin panel', 'Dot plot', 'Feature plot']) {
    const b = page.getByRole('button', { name, exact: true })
    if (!await b.count()) continue
    await b.first().click(); await settle(1500); await capture(`Gene expression / ${name}`); await probeStates(PROBE)
    await popovers(`Gene expression / ${name}`, 'main, aside.rail'); await save(`Gene expression / ${name}`)
    await sweepRail(`Gene expression / ${name}`, { skip: /^(Violin panel|Dot plot|Feature plot)$/ })
  }
})

await step('gene sets', async () => {
  await tab('Gene sets'); await settle(1500); await capture('Gene sets / before a score'); await probeStates(PROBE)
  await popovers('Gene sets', 'main, aside.rail')
  const first = page.locator('main [role="option"], main button.set-row').first()
  if (await first.count()) {
    await first.click(); await settle(500); await capture('Gene sets / a set chosen')
    const score = page.getByRole('button', { name: /^Score/ })
    if (await score.count()) await score.first().click()
    await page.waitForSelector('main canvas', { timeout: 120_000 }).catch(() => {})
    await settle(1500); await capture('Gene sets'); await probeStates(PROBE)
    await popovers('Gene sets / one set scored', 'main'); await save('Gene sets / one set scored')
    await sweepRail('Gene sets', { skip: /^(One set|Several sets)$/ })
  }
  const many = page.getByRole('button', { name: 'Several sets', exact: true })
  if (await many.count()) {
    await many.click(); await settle(600); await capture('Gene sets / Several sets, before a score')
    const rows = page.locator('main [role="option"], main button.set-row')
    for (let i = 0; i < 4 && i < await rows.count(); i++) { await rows.nth(i).click(); await settle(150) }
    const run = page.getByRole('button', { name: /^Score/ })
    if (await run.count()) await run.first().click()
    await page.waitForSelector('main svg[role="img"]', { timeout: 120_000 }).catch(() => {})
    await settle(1500); await capture('Gene sets / Several sets'); await save('Gene sets / Several sets')
    await sweepRail('Gene sets / Several sets', { skip: /^(One set|Several sets)$/ })
  }
})

await step('co-expression', async () => {
  await tab('Co-expression'); await capture('Co-expression / before a run'); await probeStates(PROBE)
  await popovers('Co-expression', 'main, aside.rail')
  const seed = page.locator('input[aria-label="Seed gene"]')
  if (await seed.count()) {
    await seed.fill('Zzzz9'); await seed.press('Enter'); await settle(700); await capture('Co-expression / a gene that is not in the object')
    await seed.fill('Gfap'); await settle(400); await seed.press('Enter'); await settle(1200)
    const go = page.getByRole('button', { name: 'Correlate', exact: true })
    if (await go.count()) { await go.click(); await page.waitForTimeout(60); await capture('Co-expression / running') }
    await page.waitForSelector('main table', { timeout: 180_000 }).catch(() => {})
    await settle(900); await capture('Co-expression'); await probeStates(PROBE)
    await popovers('Co-expression / a result', 'main'); await save('Co-expression'); await sweepRail('Co-expression')
  }
})

await step('methods', async () => { await tab('Methods'); await capture('Methods'); await popovers('Methods', 'main') })

await step('the error boundary', async () => {
  await open('Replicated cohort', `${url.includes('?') ? '&' : '?'}crash=coexpr`)
  await tab('Co-expression'); await capture('A view that failed to draw')
})

await step('wild type only', async () => {
  await open('Wild type only')
  for (const t of await page.getByRole('tab').all()) {
    const name = (await t.innerText()).trim()
    if (await t.isDisabled()) continue
    await t.click(); await settle(900); await capture(`Wild type only: ${name}`)
  }
})

await step('time course', async () => {
  await open('Time course')
  for (const t of await page.getByRole('tab').all()) {
    const name = (await t.innerText()).trim()
    if (await t.isDisabled()) continue
    await t.click(); await settle(900); await capture(`Time course: ${name}`)
    if (name === 'Cells') {
      const split = page.getByRole('button', { name: 'Split by group', exact: true })
      if (await split.count() && await split.getAttribute('aria-pressed') !== 'true') { await split.click(); await settle() }
      await capture('Time course: Cells / Split by group'); await save('Time course: Cells')
    }
    if (name === 'Composition') await save('Time course: Composition')
  }
})

await step('the lab bundle', async () => {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', LAB)
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 })
  await settle(900)
  for (const t of await page.getByRole('tab').all()) {
    const name = (await t.innerText()).trim()
    if (await t.isDisabled()) continue
    await t.click(); await settle(900)
    if (name === 'Markers') {
      const find = page.getByRole('button', { name: /^(Find|Run)/ }).first()
      if (await find.count()) await find.click()
      await page.waitForSelector('main svg[role="img"]', { timeout: 60_000 }).catch(() => {})
      await settle(900)
    }
    await capture(`Lab bundle: ${name}`)
    if (['Cells', 'Composition', 'Markers'].includes(name)) await save(`Lab bundle: ${name}`)
  }
})

await browser.close()

// ───────────────────────── out ─────────────────────────

// One row per distinct string (its numbers and the object's names set aside), with where it was first seen.
const strings = new Map()
const rest = []
for (const s of states) {
  let app = 0, data = 0
  for (const t of s.texts) {
    const shape = shapeOf(t.text, dataNames)
    const own = words(shape.replace(/‹name›|#/g, ' '))
    t.data = DATA_KINDS.has(t.kind) || own === 0
    // A table's cell, a key's entry, a tick and a value are data whole: "higher in Reactivated" in 70 rows is not 140 of the app's words.
    if (t.inView && t.src === 'text') { if (DATA_KINDS.has(t.kind)) data += t.words; else { app += own; data += t.words - own } }
    const k = `${t.kind}|${t.where}|${shape}`
    const row = strings.get(k)
    if (row) { row.n++; if (!row.views.includes(s.view)) row.views.push(s.view) }
    else strings.set(k, { kind: t.kind, where: t.where, src: t.src, text: t.text, shape, words: t.words, own, chars: t.chars, px: t.px, wt: t.wt, data: t.data, state: s.name, views: [s.view], n: 1, at: t.at })
  }
  rest.push({ state: s.name, view: s.view, app, data, texts: s.texts.length })
}
// One row per distinct box of each kind of control in each view.
const boxes = new Map()
for (const e of elements) {
  const sig = `${e.h}|${e.pad}|${e.radius}|${e.font}|${e.wt}|${e.edge}`
  const k = `${e.view}|${e.kind}|${e.where}|${e.state}|${sig}`
  const row = boxes.get(k)
  if (row) { row.n++; if (e.gap) row.gaps[e.gap] = (row.gaps[e.gap] ?? 0) + 1 }
  else boxes.set(k, { view: e.view, kind: e.kind, where: e.where, state: e.state, h: e.h, pad: e.pad, radius: e.radius, font: e.font, wt: e.wt, edge: e.edge, edgeInk: e.edgeInk, bg: e.bg, ink: e.ink, shadow: e.shadow, cls: e.cls, text: e.text, n: 1, gaps: e.gap ? { [e.gap]: 1 } : {} })
}
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify({
  measured: 'the built app (vite preview), headless Chromium, light theme', window: `${W} x ${H}`,
  states: rest, strings: [...strings.values()], boxes: [...boxes.values()], saved, stateStyles, errors,
}, null, 1))
console.log(`${states.length} states, ${states.reduce((a, s) => a + s.texts.length, 0)} texts (${strings.size} distinct), ${elements.length} controls (${boxes.size} distinct boxes), ${saved.length} files saved`)
console.log(errors.length ? `problems:\n${errors.join('\n')}` : 'no problem on the walk')
