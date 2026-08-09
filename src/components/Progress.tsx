// The one thing a streaming view shows that an in-memory one never has to:
// how far through the object it is.

import type { Pass } from '../lib/compute.ts'

/**
 * Roughly how much longer, from the rate so far.
 *
 * Not shown before a tenth of the way in: until then the estimate swings by
 * minutes between updates, and a number that behaves like that is worse than no
 * number. It says "about", and it never says "nearly done" — the bar and the
 * gene count are the honest parts; this exists so that four minutes is a known
 * quantity rather than an open one.
 */
function remaining(pass: Pass): string | null {
  const frac = pass.total ? pass.done / pass.total : 0
  if (frac < 0.1) return null
  const secs = (((performance.now() - pass.startedAt) / 1000) * (1 - frac)) / frac
  if (secs < 45) return 'under a minute left'
  return `about ${Math.round(secs / 60)} min left`
}

/** What is happening, and how far in. Honest about the total. */
export default function Progress({ pass, title }: { pass: Pass; title: string }) {
  const pct = pass.total ? Math.min(100, (100 * pass.done) / pass.total) : 0
  const left = remaining(pass)
  return (
    <div className="empty" role="status" aria-live="polite">
      <div className="mb-[5px] text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </div>
      <div className="mx-auto mt-3 h-1.5 w-[280px] overflow-hidden rounded-full"
        style={{ background: 'var(--line-2)' }}>
        <div className="h-full rounded-full"
          style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width 200ms linear' }} />
      </div>
      <div className="mono mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        {pass.total
          ? `${pass.phase ? pass.phase + ' · ' : ''}${pass.done.toLocaleString()} of ${pass.total.toLocaleString()} genes${left ? ` · ${left}` : ''}`
          : pass.queued ? 'waiting for the pass already running' : 'starting'}
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        {pass.queued && !pass.total
          ? `The object is read one pass at a time, and an earlier question is
             still using it. This one starts as soon as that finishes — neither is
             abandoned, and neither will be recomputed.`
          : `Every gene is tested. Nothing is sampled and nothing is skipped, so this
             reads the whole object once. It runs off the page, so everything else
             here keeps working while it does.`}
      </p>
    </div>
  )
}
