import type { CellType, Dataset } from '../types.ts'
import { niceStep, pctTxt } from '../lib/chart.ts'
import { pal, type PaletteKey } from '../lib/palette.ts'
import { Card, Legend } from './Ui.tsx'

export default function Composition({ d, types, palKey }: {
  d: Dataset
  types: CellType[]
  palKey: PaletteKey
}) {
  return (
    <>
      <Card
        eyebrow="Composition"
        title="Cell type proportions, one bar per sample"
        sub={<>Horizontal, because the quantity being read is a percentage and percentages are read
          along a shared axis. {d.samples.length > 1
            ? 'Never pooled by group — cells from one animal are not independent observations, so each animal is its own row and the spread between animals is part of the result.'
            : 'This object contains one sample, so this is a description of it and not a comparison.'}</>}
      >
        <div className="mt-4">
          <StackedRows d={d} types={types} palKey={palKey} />
          <Legend items={types.map((t, i) => [pal(i, palKey), t.name])} />
        </div>
      </Card>

      {d.multi && (
        <Card
          eyebrow="Per cell type" title="Proportion by group"
          sub={<>One panel per cell type, each with its own y axis — a shared axis would flatten
            every population except the largest. {d.samples.length > d.conds.length
              ? 'Dots are the individual animals; if they overlap between groups, the difference in the bars is not evidence.'
              : 'One sample per group, so each bar is a single measurement with no spread to show.'}</>}
        >
          <div
            className="mt-4 grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))' }}
          >
            {types.map((t, ti) => <TypeFacet key={t.key} d={d} t={t} ti={ti} palKey={palKey} />)}
          </div>
          <Legend
            items={d.conds.map((c, i) => [pal(i, palKey), c])}
            note={d.samples.length > d.conds.length ? '· bar = mean · dots = individual samples' : undefined}
          />
        </Card>
      )}
    </>
  )
}

/** Horizontal 100% stacked bars — one row per sample, on a shared percentage axis. */
function StackedRows({ d, types, palKey }: { d: Dataset; types: CellType[]; palKey: PaletteKey }) {
  const rowH = 24, gap = 7, PL = 96, PR = 16, PT = 6, AX = 26
  const W = 760
  const H = PT + d.samples.length * (rowH + gap) + AX
  const X = (p: number) => PL + (W - PL - PR) * p

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cell type proportions per sample">
      <defs>
        {d.samples.map((_s, si) => (
          <clipPath key={si} id={`cRow${si}`}>
            <rect x={PL} y={PT + si * (rowH + gap)} width={W - PL - PR} height={rowH} rx={5} />
          </clipPath>
        ))}
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <g key={f}>
          <line className="axline" x1={X(f)} x2={X(f)} y1={PT} y2={H - AX + 2} opacity=".55" />
          <text className="axis" x={X(f)} y={H - 8} textAnchor="middle">{f * 100}%</text>
        </g>
      ))}
      {d.samples.map((sm, si) => {
        const y = PT + si * (rowH + gap)
        let acc = 0
        return (
          <g key={sm.id}>
            <text className="axis" x={PL - 16} y={y + rowH / 2 + 4} textAnchor="end"
              style={{ fontSize: 11.5, fill: 'var(--ink)', fontWeight: 550 }}>
              {sm.id.replace(/^(SVZ|TC)_/, '')}
            </text>
            <rect x={PL - 9} y={y + 3} width={4} height={rowH - 6} rx={2}
              fill={pal(d.conds.indexOf(sm.cond), palKey)}>
              <title>{sm.cond}</title>
            </rect>
            <g clipPath={`url(#cRow${si})`}>
              {types.map((t, ti) => {
                const p = d.prop[si][ti]
                const xa = X(acc), xb = X(acc + p)
                acc += p
                return (
                  <g key={t.key}>
                    <rect x={xa} y={y} width={Math.max(0, xb - xa)} height={rowH} fill={pal(ti, palKey)}>
                      <title>{t.name} — {(p * 100).toFixed(1)}%</title>
                    </rect>
                    {/* A number only where it fits; a clipped "1%" is worse than none. */}
                    {xb - xa > 30 && (
                      <text x={(xa + xb) / 2} y={y + rowH / 2 + 3.5} textAnchor="middle"
                        style={{ fontSize: 10, fill: '#fff', fontWeight: 650 }}>
                        {(p * 100).toFixed(0)}%
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </g>
        )
      })}
    </svg>
  )
}

/** One cell type: a bar per group, its own y axis, samples drawn on top. */
function TypeFacet({ d, t, ti, palKey }: { d: Dataset; t: CellType; ti: number; palKey: PaletteKey }) {
  const W = 210, H = 152, PL = 42, PB = 36, PT = 16, PR = 8
  const per = d.conds.map(c =>
    d.samples.map((s, si) => (s.cond === c ? d.prop[si][ti] : null))
      .filter((v): v is number => v !== null))
  const step = niceStep(Math.max(...per.flat(), 1e-4) / 2)
  const maxV = step * 2
  const Y = (v: number) => PT + (H - PT - PB) * (1 - v / maxV)
  const bw = (W - PL - PR) / d.conds.length

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${t.name} proportion by group`}>
        <text className="axis" x={PL} y={11} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--ink)' }}>
          <tspan fill={pal(ti, palKey)}>■ </tspan>{t.name}
        </text>
        {[0, 1, 2].map(k => (
          <g key={k}>
            <line className="axline" x1={PL} x2={W - PR} y1={Y(step * k)} y2={Y(step * k)} opacity=".4" />
            <text className="axis" x={PL - 5} y={Y(step * k) + 3.5} textAnchor="end">{pctTxt(step * k)}</text>
          </g>
        ))}
        {per.map((vals, ci) => {
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length
          const cx = PL + bw * (ci + 0.5)
          const col = pal(ci, palKey)
          const w = Math.min(46, bw * 0.56)
          const lab = d.conds[ci]
          const rotate = lab.length * 5.4 > bw
          return (
            <g key={lab}>
              <rect x={cx - w / 2} y={Y(mean)} width={w} height={Math.max(0, H - PB - Y(mean))}
                fill={col} opacity=".78" rx={2}>
                <title>{t.name} · {lab} — {pctTxt(mean)}</title>
              </rect>
              {vals.length > 1 && (
                <>
                  <line x1={cx} x2={cx} y1={Y(Math.min(...vals))} y2={Y(Math.max(...vals))}
                    stroke={col} strokeWidth={1.4} opacity=".85" />
                  {vals.map((v, k) => (
                    <circle key={k} cx={cx + (k - (vals.length - 1) / 2) * 4.6} cy={Y(v)} r={2.6}
                      fill="var(--surface)" stroke={col} strokeWidth={1.4} />
                  ))}
                </>
              )}
              {rotate ? (
                <text className="axis" transform={`rotate(-38 ${cx} ${H - PB + 12})`}
                  x={cx} y={H - PB + 12} textAnchor="end">{lab}</text>
              ) : (
                <text className="axis" x={cx} y={H - PB + 13} textAnchor="middle">{lab}</text>
              )}
            </g>
          )
        })}
        <line className="axline" x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} />
      </svg>
    </figure>
  )
}
