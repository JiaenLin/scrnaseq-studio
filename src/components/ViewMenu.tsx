import { useRef, useState } from 'react'
import { PALETTES, RAMPS, rampCss, type PaletteKey, type RampKey } from '../lib/palette.ts'
import Popover from './Popover.tsx'

/**
 * Figure style, for the whole studio, from wherever you are looking.
 *
 * These two selects were a card on Overview headed "Figure style", which put a
 * setting that repaints every figure in the app on the one tab that draws the
 * fewest of them: you chose a palette, walked to Markers to see it, and walked
 * back to change it. They are global, so they belong in the bar the whole app
 * shares — and having them there is also what keeps that bar from ever being
 * empty, which is what used to make it appear and disappear as you navigated.
 */
export default function ViewMenu({ palKey, rampKey, onPal, onRamp }: {
  palKey: PaletteKey
  rampKey: RampKey
  onPal: (k: PaletteKey) => void
  onRamp: (k: RampKey) => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={trigger} className="btn btn-sm" aria-haspopup="dialog" aria-expanded={open}
        title="Palette and expression scale, for every figure"
        onClick={() => setOpen(v => !v)}>
        Figure style
      </button>
      <Popover open={open} anchor={trigger} align="right" label="Figure style"
        width={290} onClose={() => setOpen(false)}>
        <div className="p-3">
          <label className="block">
            <span className="glabel">Clusters</span>
            <select className="sel mt-1 w-full" value={palKey} aria-label="Cluster palette"
              onChange={e => onPal(e.target.value as PaletteKey)}>
              {Object.entries(PALETTES).map(([k, p]) =>
                <option key={k} value={k}>{p.label}</option>)}
            </select>
            <span className="mt-1.5 flex gap-0.5">
              {PALETTES[palKey].cols.map(c => (
                <i key={c} className="sw" style={{ background: c, width: 15, height: 15 }} />
              ))}
            </span>
          </label>
          <label className="mt-3 block">
            <span className="glabel">Expression</span>
            <select className="sel mt-1 w-full" value={rampKey} aria-label="Expression ramp"
              onChange={e => onRamp(e.target.value as RampKey)}>
              {Object.entries(RAMPS).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
            <span className="mt-1.5 block h-[15px] w-full rounded-[--r-sm]"
              style={{ background: rampCss(rampKey) }} />
          </label>
        </div>
      </Popover>
    </>
  )
}
