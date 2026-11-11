// How the panels of a figure share the stage (src/lib/fit-panels.ts,
// docs/DESIGN.md "Explorer").
//
// What this pins: the layout is chosen from the box and the embedding's own
// aspect, never from the data; every panel fits inside its cell with its name
// and its clear margin; panels that are compared stay side by side unless
// stacking them draws them clearly larger; and a box with no room yet still
// comes back with a layout (a 900 px window crashed the view on its first
// frame when it did not).

import { EDGE, NAME, fitPanels } from '../src/lib/fit-panels.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

/** A panel, its name and its margins are inside its cell of the grid. */
const inside = (n, W, H, f) => {
  const cw = (W - (f.cols - 1)) / f.cols, ch = (H - (f.rows - 1)) / f.rows
  const top = n > 1 ? NAME : EDGE
  return f.w + 2 * EDGE <= cw + 1e-9 && f.h + top + EDGE <= ch + 1e-9
}

console.log('\nONE PANEL')
{
  const a = 0.823
  const f = fitPanels(1, 968, 756, a)
  check('one panel is one cell', [f.cols, f.rows], [1, 1])
  check('it fits inside the stage with its clear margin', inside(1, 968, 756, f), true)
  check('height is the width at the embedding\'s own aspect', f.h, Math.floor(f.w * a))
  check('a wide, short stage binds on height', fitPanels(1, 1600, 500, a).w, Math.floor((500 - 2 * EDGE) / a))
  check('a narrow, tall stage binds on width', fitPanels(1, 500, 1600, a).w, 500 - 2 * EDGE)
}

console.log('\nTWO PANELS')
{
  const a = 0.823
  const f = fitPanels(2, 968, 756, a)
  check('two panels on a wide stage sit side by side', [f.cols, f.rows], [2, 1])
  check('each fits its cell with its name above it', inside(2, 968, 756, f), true)
  // Stacking is 8% larger here: not enough to send the eye down the page.
  const g = fitPanels(2, 808, 756, a)
  const stacked = Math.floor(Math.min(808 - 2 * EDGE, ((756 - 1) / 2 - NAME - EDGE) / a))
  check('a few percent gained by stacking does not stack them',
    [g.cols, g.rows, stacked > g.w, stacked <= g.w * 1.15], [2, 1, true, true])
  const t = fitPanels(2, 420, 1200, a)
  check('a tall, narrow stage does stack them (more than 15% larger)', [t.cols, t.rows], [1, 2])
  check('and stacked panels still fit their cells', inside(2, 420, 1200, t), true)
}

console.log('\nMORE PANELS')
{
  const a = 0.84
  const f = fitPanels(4, 968, 756, a)
  check('four panels on the reference stage are two by two', [f.cols, f.rows], [2, 2])
  check('and fit', inside(4, 968, 756, f), true)
  check('four panels on a very wide stage run in one row', fitPanels(4, 2400, 500, a).rows, 1)
  for (const n of [3, 5, 6, 7, 9, 12]) {
    const p = fitPanels(n, 1688, 756, a)
    check(`${n} panels: every one has a cell`, p.cols * p.rows >= n, true)
    check(`${n} panels: no layout draws them more than 15% larger`,
      Array.from({ length: n }, (_, k) => k + 1).every(cols => {
        const rows = Math.ceil(n / cols)
        const w = Math.floor(Math.min((1688 - (cols - 1)) / cols - 2 * EDGE,
          ((756 - (rows - 1)) / rows - NAME - EDGE) / a))
        return w <= p.w * 1.15
      }), true)
    check(`${n} panels: each fits its cell`, inside(n, 1688, 756, p), true)
  }
}

console.log('\nNO ROOM YET')
{
  const z = fitPanels(2, 400, 0, 0.8)
  check('a box with no height still returns a layout', typeof z?.cols, 'number')
  check('whose panels have no size, never a negative one', [z.w, z.h], [0, 0])
  const y = fitPanels(1, 0, 0, 0.8)
  check('and so does a box with nothing at all', [y.cols, y.rows, y.w, y.h], [1, 1, 0, 0])
}

console.log('\nTHE SAME BOX, THE SAME LAYOUT')
{
  const a = fitPanels(3, 1200, 700, 0.9), b = fitPanels(3, 1200, 700, 0.9)
  check('nothing but the box and the aspect decides', a, b)
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll panel-fit tests passed')
process.exit(failed ? 1 : 0)
