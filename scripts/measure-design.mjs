// Measure the interface, not the numbers: the contrast of every text token on
// every surface it sits on, in both themes; an automated accessibility pass
// (axe-core) on the explorer; the explorer's tab order; and the scatter's
// interaction time on the largest demo.
//
//   CHROME=<a Chrome or Chromium binary> AXE=<path to axe.min.js> \
//     node scripts/measure-design.mjs <url> [what=contrast,axe,tabs,speed] [reps=9]
//
// Synthetic objects only (the in-browser demos). Speed is meaningful only on a
// production build (`vite build` then `vite preview`), and only relative to a
// run taken on the same machine at the same time.

import { chromium } from 'playwright-core'
import fs from 'node:fs'

const [url = 'http://localhost:4432', what = 'contrast,axe,tabs,speed', reps = '9'] = process.argv.slice(2)
const WHAT = new Set(what.split(','))
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true })

async function openDemo(page, label = 'Replicated cohort') {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByText(label, { exact: true }).click()
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 })
  await page.getByRole('tab', { name: 'Cells', exact: true }).click()
  await page.waitForSelector('main canvas', { timeout: 60_000 })
  await page.waitForTimeout(500)
}

// Text tokens against the surfaces the stylesheet puts them on. A translucent
// surface is composited over --surface, which is what it sits on in the app.
const FG = ['--ink', '--ink-2', '--ink-3', '--accent', '--accent-ink', '--warn', '--good', '--bad', '--up', '--down', '--text-on-accent']
const BG = ['--bg', '--surface', '--sunk', '--accent-soft', '--warn-soft', '--good-soft', '--sel', '--accent']

for (const T of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: T, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await openDemo(page)

  if (WHAT.has('contrast')) {
    const rows = await page.evaluate(([FG, BG]) => {
      // A token's value as the root computes it (var() substituted), painted
      // into one pixel so any syntax (hex, rgba, color-mix) reads alike.
      const read = (_prop, v) => {
        const val = getComputedStyle(document.documentElement).getPropertyValue(v).trim()
        if (!val) return null
        const g = document.createElement('canvas'); g.width = g.height = 1
        const x = g.getContext('2d'); x.fillStyle = val; x.fillRect(0, 0, 1, 1)
        const [r, gg, bb, a] = x.getImageData(0, 0, 1, 1).data
        return [r, gg, bb, a / 255]
      }
      const over = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1)
      const lum = c => {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
      }
      const surface = read('backgroundColor', '--surface')
      const out = []
      for (const b of BG) {
        let bg = read('backgroundColor', b); if (!bg) continue
        if (bg[3] < 1) bg = over(bg, surface)
        for (const f of FG) {
          let fg = read('color', f); if (!fg) continue
          if (fg[3] < 1) fg = over(fg, bg)
          const [l1, l2] = [lum(fg), lum(bg)].sort((p, q) => q - p)
          out.push([f, b, +((l1 + 0.05) / (l2 + 0.05)).toFixed(2), fg.slice(0, 3).map(Math.round).join(','), bg.slice(0, 3).map(Math.round).join(',')])
        }
      }
      return out
    }, [FG, BG])
    // Only the pairs the stylesheet actually uses are graded; the rest are listed.
    console.log(`\nCONTRAST ${T} (fg on bg: ratio; AA body 4.5, large/UI 3.0)`)
    for (const [f, b, r, fc, bc] of rows) console.log(`  ${r < 4.5 ? (r < 3 ? 'FAIL' : 'LOW ') : 'ok  '} ${f.padEnd(16)} on ${b.padEnd(14)} ${String(r).padEnd(6)} rgb(${fc}) on rgb(${bc})`)
    // The lowest ratio of each text token over the grounds text sits on.
    const GROUNDS = ['--bg', '--surface', '--sunk', '--accent-soft', '--warn-soft', '--good-soft']
    console.log(`\nLOWEST ${T} (each text token over ${GROUNDS.join(' ')})`)
    for (const f of FG.filter(x => x !== '--text-on-accent')) {
      const rs = rows.filter(r => r[0] === f && GROUNDS.includes(r[1]))
      if (rs.length) { const m = rs.sort((p, q) => p[2] - q[2])[0]; console.log(`  ${m[2] < 4.5 ? 'FAIL' : 'ok  '} ${f.padEnd(14)} ${m[2]} on ${m[1]}`) }
    }
    for (const [f, b] of [['--text-on-accent', '--accent'], ['--surface', '--sel']]) {
      const m = rows.find(r => r[0] === f && r[1] === b) ?? (f === '--surface' ? rows.find(r => r[0] === '--ink' && r[1] === '--surface') : null)
      if (m) console.log(`  ${m[2] < 4.5 ? 'FAIL' : 'ok  '} ${f.padEnd(14)} ${m[2]} on ${b}`)
    }
    // Edges. A control known only by its edge (a field, a checkbox, a switch's
    // track) needs 3:1 against its ground (WCAG 1.4.11): that edge is --ctl.
    // --line-2 and --line are the quiet edge of a labelled control and the
    // hairline between panes; they are listed, not graded.
    const edges = await page.evaluate(() => {
      const read = v => {
        const val = getComputedStyle(document.documentElement).getPropertyValue(v).trim()
        if (!val) return null
        const g = document.createElement('canvas'); g.width = g.height = 1
        const x = g.getContext('2d'); x.fillStyle = val; x.fillRect(0, 0, 1, 1)
        return [...x.getImageData(0, 0, 1, 1).data]
      }
      const lum = c => {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
      }
      const out = []
      for (const e of ['--ctl', '--line-2', '--line']) for (const b of ['--bg', '--surface', '--sunk']) {
        const ec = read(e), bc = read(b); if (!ec || !bc) continue
        const [l1, l2] = [lum(ec), lum(bc)].sort((p, q) => q - p)
        out.push([e, b, +((l1 + 0.05) / (l2 + 0.05)).toFixed(2)])
      }
      return out
    })
    console.log(`\nEDGES ${T} (--ctl needs 3.0)`)
    for (const [e, b, r] of edges) console.log(`  ${e === '--ctl' ? (r < 3 ? 'FAIL' : 'ok  ') : '    '} ${e.padEnd(9)} on ${b.padEnd(10)} ${r}`)
  }

  if (WHAT.has('axe')) {
    await page.addScriptTag({ content: fs.readFileSync(process.env.AXE, 'utf8') })
    for (const tab of ['Cells', 'Overview']) {
      await page.getByRole('tab', { name: tab, exact: true }).click(); await page.waitForTimeout(600)
      const r = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })
        return res.violations.map(v => [v.id, v.impact, v.nodes.length,
          v.nodes.slice(0, 4).map(n => `${n.target.join(' ')} ${(n.any[0]?.data?.contrastRatio ?? '')}`)])
      })
      console.log(`\nAXE ${T} ${tab}: ${r.length} rule(s) violated`)
      for (const [id, imp, n, eg] of r) console.log(`  ${id} (${imp}) ${n} node(s): ${eg.join(' | ').slice(0, 300)}`)
    }
    await page.getByRole('tab', { name: 'Cells', exact: true }).click(); await page.waitForTimeout(400)
  }

  if (WHAT.has('tabs') && T === 'light') {
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
    await page.mouse.click(2, 2)
    const seen = []
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab')
      const d = await page.evaluate(() => {
        const e = document.activeElement
        if (!e || e === document.body) return null
        const cs = getComputedStyle(e)
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
        const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 34)
        const where = e.closest('header') ? 'header' : e.closest('aside') ? 'aside' : e.closest('main') ? 'main' : 'other'
        return `${where}:${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''} "${name}"${ring ? '' : ' (NO VISIBLE FOCUS)'}`
      })
      if (!d || seen.includes(d)) break
      seen.push(d)
    }
    console.log(`\nTAB ORDER light, Cells (${seen.length} stops):`)
    seen.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)} ${s}`))
  }

  if (WHAT.has('speed') && T === 'light') {
    // The largest demo, by its own cell count.
    const sizes = {}
    for (const label of ['Replicated cohort', 'Time course', 'Wild type only']) {
      await openDemo(page, label)
      sizes[label] = await page.evaluate(() => {
        const m = /([\d,]+) cells/.exec(document.querySelector('main')?.textContent ?? '')
        return m ? +m[1].replace(/,/g, '') : 0
      })
    }
    const biggest = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0]
    await openDemo(page, biggest)
    // One click, timed to the end of its synchronous work (React flushes a
    // discrete event's effects, the canvas paint included, inside the click)
    // and to the next painted frame.
    const time = async name => page.evaluate(async name => {
      const b = [...document.querySelectorAll('main button, aside button')]
        .find(x => x.textContent.trim() === name)
      if (!b) return null
      const t0 = performance.now()
      b.click()
      // React flushes a click's render, commit and effects (the canvas paint)
      // in a microtask after the event; a macrotask later all of it has run.
      await new Promise(r => setTimeout(r, 0))
      const t1 = performance.now()
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      return [t1 - t0, performance.now() - t0]
    }, name)
    const res = {}
    for (const name of ['Group', 'Sample', 'Cell type', 'Split by group']) res[name] = []
    for (let i = 0; i < +reps; i++) {
      for (const name of ['Group', 'Sample', 'Cell type', 'Split by group', 'Split by group']) {
        const r = await time(name); if (r) res[name].push(r)
        await page.waitForTimeout(120)
      }
    }
    const med = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] }
    // The pointer readout, where there is one: a move over the first panel to
    // the next painted frame. The first move builds the panel's grid.
    const hover = await page.evaluate(async n => {
      const cv = document.querySelector('main canvas')
      const host = cv?.parentElement
      if (!host || !document.querySelector('main .relative > canvas')) return null
      const r = cv.getBoundingClientRect(), out = []
      for (let k = 0; k < n; k++) {
        const t0 = performance.now()
        host.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
          clientX: r.left + r.width * (0.2 + 0.6 * ((k * 0.37) % 1)), clientY: r.top + r.height * (0.25 + 0.5 * ((k * 0.61) % 1)) }))
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)))
        out.push(performance.now() - t0)
      }
      return out
    }, 3 * +reps)
    console.log(`\nSPEED on "${biggest}" (${sizes[biggest]} cells; sizes ${JSON.stringify(sizes)}); median of ${reps}+, ms`)
    if (hover) console.log(`  pointer readout  first ${hover[0].toFixed(1)}  then median ${med(hover.slice(1)).toFixed(1)} to-next-frame (n=${hover.length - 1}, max ${Math.max(...hover.slice(1)).toFixed(1)})`)
    else console.log('  pointer readout: none on this build')
    for (const [k, v] of Object.entries(res)) {
      if (!v.length) { console.log(`  ${k}: not found`); continue }
      console.log(`  ${k.padEnd(15)} work ${med(v.map(x => x[0])).toFixed(1)}  to-next-frame ${med(v.map(x => x[1])).toFixed(1)}  (n=${v.length}, max ${Math.max(...v.map(x => x[1])).toFixed(1)})`)
    }
  }
  await ctx.close()
}
await browser.close()
