import { useRef, useState } from 'react'
import {
  DIVERGING, PALETTES, RAMPS, rampCss, SEQUENTIAL, type PaletteKey, type RampKey,
} from '../lib/palette.ts'
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
export default function ViewMenu({ palKey, rampKey, rampDiv, onPal, onRamp, onRampDiv }: {
  palKey: PaletteKey
  rampKey: RampKey
  /**
   * The scale for SIGNED quantities — z-scores, module scores, log fold
   * changes. A separate setting rather than one ramp for everything, because
   * the two are answering different questions: a sequential ramp says how much,
   * a diverging one says which side of zero. Choosing viridis for a z-score
   * would hide the sign, and choosing blue-white-red for an expression level
   * would invent a midpoint the quantity does not have.
   *
   * It existed already, as state in App, and the only control for it was inside
   * the dot plot's own toolbar — so every other figure that draws a z-score was
   * fixed at blue-white-red with nothing on the page to say otherwise.
   */
  rampDiv: RampKey
  onPal: (k: PaletteKey) => void
  onRamp: (k: RampKey) => void
  onRampDiv: (k: RampKey) => void
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
            {/* SEQUENTIAL, not every ramp. This select used to list the
                diverging scales too, which let a reader put blue-white-red on a
                feature plot — a quantity that starts at zero and has no other
                side, drawn on a scale whose whole point is that it does. */}
            <select className="sel mt-1 w-full" value={rampKey} aria-label="Expression ramp"
              onChange={e => onRamp(e.target.value as RampKey)}>
              {SEQUENTIAL.map(k => <option key={k} value={k}>{RAMPS[k].label}</option>)}
            </select>
            <span className="mt-1.5 block h-[15px] w-full rounded-[--r-sm]"
              style={{ background: rampCss(rampKey) }} />
          </label>
          <label className="mt-3 block">
            <span className="glabel">Scaled &amp; signed</span>
            <select className="sel mt-1 w-full" value={rampDiv} aria-label="Diverging ramp"
              onChange={e => onRampDiv(e.target.value as RampKey)}>
              {DIVERGING.map(k => <option key={k} value={k}>{RAMPS[k].label}</option>)}
            </select>
            <span className="mt-1.5 block h-[15px] w-full rounded-[--r-sm]"
              style={{ background: rampCss(rampDiv) }} />
            <span className="mt-1 block tx-micro" style={{ color: 'var(--ink-3)' }}>
              z-scores and module scores — the dot plot, both gene-set heatmaps.
            </span>
          </label>
        </div>
      </Popover>
    </>
  )
}
