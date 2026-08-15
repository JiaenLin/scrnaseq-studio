// The one thing a streaming view shows that an in-memory one never has to:
// how far through the object it is.

import type { CSSProperties } from 'react'
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
      <div className="tx-title" style={{ color: 'var(--ink)' }}>{title}</div>
      {/* scaleX, not width: on the atlas this bar is on screen for four
          minutes, and width re-runs layout and paint for every frame of it. */}
      <div className="mx-auto mt-3 h-1.5 w-[280px] overflow-hidden rounded-full"
        style={{ background: 'var(--line-2)' }}>
        <div className="bar-fill rounded-full"
          style={{ '--fill': pct / 100, background: 'var(--sel)' } as CSSProperties} />
      </div>
      {/* The bar, the count, the estimate. The three-sentence paragraph that
          used to sit under this was shown on EVERY compute — worth reading
          once, noise on the fiftieth run, and nothing the reader can act on. */}
      <div className="mono mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        {pass.total
          ? `${pass.phase ? pass.phase + ' · ' : ''}${pass.done.toLocaleString()} of ${pass.total.toLocaleString()} genes${left ? ` · ${left}` : ''}`
          : pass.queued ? 'waiting for the pass already running' : 'starting'}
      </div>
    </div>
  )
}

/**
 * A pass that failed, and the way to ask again.
 *
 * This used to be thrown into the render so the error boundary caught it, which
 * unmounts the whole view. But the common cause is not a damaged file — it is
 * the browser reclaiming a worker under memory pressure on an object of this
 * size, and the same pass usually succeeds on a second attempt. Losing the tab
 * and every control set on it is a large price for that.
 *
 * The engine now replaces a dead worker rather than latching, so "try again"
 * really is a fresh attempt on a live worker rather than a retry against the
 * same corpse. A file that is genuinely damaged reports the same message every
 * time, and nothing is hidden.
 */
export function Failed({ error, onRetry, what }: {
  error: Error
  onRetry: () => void
  /** What was being computed, in the reader's terms. */
  what: string
}) {
  return (
    <div className="note note-warn mt-3.5">
      <b>{what} did not finish.</b>{' '}
      <span style={{ color: 'var(--ink-2)' }}>{error.message}</span>
      <div className="mt-2.5">
        <button className="btn btn-primary" onClick={onRetry}>Try again</button>
      </div>
    </div>
  )
}
