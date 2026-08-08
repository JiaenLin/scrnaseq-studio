// The one thing a streaming view shows that an in-memory one never has to:
// how far through the object it is.

import type { Pass } from '../lib/compute.ts'

/** What is happening, and how far in. Honest about the total. */
export default function Progress({ pass, title }: { pass: Pass; title: string }) {
  const pct = pass.total ? Math.min(100, (100 * pass.done) / pass.total) : 0
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
          ? `${pass.phase ? pass.phase + ' · ' : ''}${pass.done.toLocaleString()} of ${pass.total.toLocaleString()} genes`
          : 'starting'}
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
        Every gene is tested. Nothing is sampled and nothing is skipped, so this
        reads the whole object once.
      </p>
    </div>
  )
}
