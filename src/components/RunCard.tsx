import type { ReactNode } from 'react'
import type { Source } from '../lib/source.ts'
import { FOLD, runView, valueText, type RunLeftOut, type RunRecordView } from '../lib/run.ts'
import { Card, Mono } from './Ui.tsx'

/**
 * The run that produced this object, as the object records it.
 *
 * On Overview, beside the provenance table, because it answers the question
 * that table cannot: which tool, at which version and commit, in which run.
 * Every word under a record is the record's own — see lib/run.ts. The card
 * adds only what kind of entry each record is, and what the converter said
 * about the ones it could not carry.
 */
export default function RunCard({ src }: { src: Source }) {
  const v = runView(src.meta)
  const n = v.kind === 'section' ? v.records.length : 0
  return (
    <Card
      eyebrow="Run" title="The run that produced this object"
      sub={n > 0
        ? `${n} record${n === 1 ? '' : 's'} from the object's uns, as the lab's converter carried ${n === 1 ? 'it' : 'them'}. `
          + 'Each field is shown under its own name, as recorded; nothing here is inferred.'
        : undefined}
    >
      {v.kind === 'demo' ? (
        <Said>A built-in demo object, generated in this browser: no run produced it.</Said>
      ) : v.kind === 'absent' ? (
        <Said>
          This bundle carries no run section, so it cannot say which run produced the object. The
          lab&rsquo;s converter writes one from what an .h5ad&rsquo;s uns records; a bundle written
          before it did, by an exporter that does not, or from an .rds has none.
        </Said>
      ) : v.kind === 'malformed' ? (
        <Said>
          This bundle&rsquo;s run section is not in the shape the lab writes ({v.why}), so none of
          it is shown.
        </Said>
      ) : (
        <>
          {v.records.length === 0 && (v.leftOut?.count ? (
            <Said>
              None of the {v.leftOut.count} run record{v.leftOut.count === 1 ? '' : 's'} the
              converter found in the object was copied into this bundle: <Paths l={v.leftOut} />.
            </Said>
          ) : (
            <Said>The object carries no run record: the converter found none where it looked.</Said>
          ))}
          {v.records.map((r, i) => <Record key={`${i}:${r.path}`} r={r} />)}
          {v.records.length > 0 && v.leftOut && v.leftOut.count > 0 && (
            <Said>
              {v.leftOut.count} more record{v.leftOut.count === 1 ? '' : 's'} the converter found,
              left out of this bundle over its budget: <Paths l={v.leftOut} />.
            </Said>
          )}
          {v.searched && (
            <p className="mt-3 tx-micro" style={{ color: 'var(--ink-3)' }}>
              Where the converter looked: {v.searched}
            </p>
          )}
        </>
      )}
    </Card>
  )
}

const Said = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 tx-small" style={{ color: 'var(--ink-2)' }}>{children}</p>
)

/** The records the converter left out, as it named them, and a count of the rest. */
function Paths({ l }: { l: RunLeftOut }) {
  const rest = l.count - l.paths.length
  return (
    <>
      {l.paths.map((p, i) => (
        <span key={`${i}:${p}`}>{i === 0 ? '' : ', '}<Mono>{p}</Mono></span>
      ))}
      {rest > 0 && <>{l.paths.length ? ', and ' : ''}{rest} more</>}
    </>
  )
}

const KIND: Record<RunRecordView['kind'], [string, 'file' | 'none']> = {
  copied: ['copied', 'file'],
  value: ['copied', 'file'],
  text: ['as text', 'file'],
  named: ['named, not copied', 'none'],
  empty: ['no content', 'none'],
}

function Record({ r }: { r: RunRecordView }) {
  const [label, tone] = KIND[r.kind]
  return (
    <div className="mt-3.5" data-run-record={r.path} data-run-kind={r.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Mono>{r.path}</Mono>
        <span className={`badge badge-${tone}`}>{label}</span>
      </div>
      {r.kind === 'copied' && r.fields.length === 0 ? (
        <Said>An empty record: the entry holds no fields.</Said>
      ) : r.kind === 'copied' ? (
        <div className="scrollx mt-1.5">
          <table className="t">
            <tbody>
              {r.fields.map(f => (
                <tr key={f.key}>
                  <td className="mono whitespace-nowrap" style={{ width: '1%' }}>{f.key}</td>
                  <td style={{ color: 'var(--ink-2)' }}><Value v={f.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : r.kind === 'named' ? (
        <Said>The converter named this record instead of copying it: <Mono>{r.sentence}</Mono></Said>
      ) : r.kind === 'empty' ? (
        <Said>Listed with no content: the converter could not read it.</Said>
      ) : (
        <div className="mt-1.5 tx-small"><Value v={r.kind === 'text' ? r.text : r.value} /></div>
      )}
    </div>
  )
}

/** A value as recorded: inline when short, folded behind a disclosure when long — never cut. */
function Value({ v }: { v: unknown }) {
  const text = valueText(v)
  if (text.length <= FOLD) return <span className="mono" style={{ overflowWrap: 'anywhere' }}>{text}</span>
  const size = typeof v === 'string' ? `${v.length.toLocaleString('en-US')} characters`
    : Array.isArray(v) ? `${v.length.toLocaleString('en-US')} items`
      : `${Object.keys(v as object).length.toLocaleString('en-US')} entries`
  return (
    <details>
      <summary className="tx-small" style={{ cursor: 'pointer' }}>{size}</summary>
      <pre className="mono tx-micro mt-1"
        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto' }}>
        {typeof v === 'string' ? v : JSON.stringify(v, null, 1)}
      </pre>
    </details>
  )
}
