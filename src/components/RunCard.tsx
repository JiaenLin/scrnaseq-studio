import type { ReactNode } from 'react'
import type { Source } from '../lib/source.ts'
import { FOLD, IDENTITY, notesSpeakOf, runView, valueText, type RunLeftOut, type RunRecordView } from '../lib/run.ts'
import { Card, Mono } from './Ui.tsx'

/**
 * The run that produced this object, as the bundle holds it.
 *
 * On Overview, beside the provenance table, because it answers the question
 * that table cannot: which tool, at which version and commit, in which run.
 * Every word under a record is the record's own — see lib/run.ts, which also
 * says how a section written by today's lab (six named fields per record) is
 * told from an earlier one (the record, copied). The card adds what kind of
 * entry each record is and how many records are not listed. It gives no reason
 * the bundle does not give: where a note of the bundle names what is not
 * listed, it points at the notes, which Overview shows in the next card.
 */
export default function RunCard({ src }: { src: Source }) {
  const v = runView(src.meta)
  const n = v.kind === 'section' ? v.records.length : 0
  const s = n === 1 ? '' : 's'
  const notes = src.meta.notes
  return (
    <Card
      eyebrow="Run" title="The run that produced this object"
      sub={n === 0 || v.kind !== 'section' ? undefined
        : v.form === 'fields'
          ? `${n} record${s} listed from the object's uns. Of ${n === 1 ? 'it' : 'each'}, this bundle holds up to six fields as recorded: `
            + 'tool, version, commit, stage, run_key and job.'
          : `${n} record${s} from the object's uns, as the lab's converter carried ${n === 1 ? 'it' : 'them'}. `
            + 'Each field is shown under its own name, as recorded; nothing here is inferred.'}
    >
      {v.kind === 'demo' ? (
        <Said>A built-in demo object, generated in this browser: no run produced it.</Said>
      ) : v.kind === 'absent' ? (
        <Said>
          This bundle carries no run section, so it cannot say which run produced the object. The
          lab&rsquo;s converter writes one from an .h5ad&rsquo;s uns; an older bundle, another
          exporter&rsquo;s, or one from an .rds has none.
        </Said>
      ) : v.kind === 'malformed' ? (
        <Said>
          This bundle&rsquo;s run section is not in the shape the lab writes ({v.why}), so none of
          it is shown.
        </Said>
      ) : (
        <>
          {v.records.length === 0 && (!v.leftOut?.count ? (
            <Said>
              This bundle lists no run record, so it cannot say which run produced the object.
              <Why when={notesSpeakOf(notes, [])} />
            </Said>
          ) : v.leftOut.count === 1 ? (
            <Said>
              This bundle does not list the 1 run record the converter found in the
              object: <Paths l={v.leftOut} />.
              <Why when={notesSpeakOf(notes, v.leftOut.paths)} />
            </Said>
          ) : (
            <Said>
              This bundle lists none of the {v.leftOut.count} run records the converter found in
              the object: <Paths l={v.leftOut} />.
              <Why when={notesSpeakOf(notes, v.leftOut.paths)} />
            </Said>
          ))}
          {v.records.map((r, i) => <Record key={`${i}:${r.path}`} r={r} notes={notes} />)}
          {v.records.length > 0 && v.leftOut && v.leftOut.count > 0 && (
            <Said>
              {v.leftOut.count} more record{v.leftOut.count === 1 ? '' : 's'} the converter
              found {v.leftOut.count === 1 ? 'is' : 'are'} not listed here: <Paths l={v.leftOut} />.
              <Why when={notesSpeakOf(notes, v.leftOut.paths)} />
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

/** A sentence of the card's own (`section`), or one about the record it sits under. */
const Said = ({ children, of = 'section' }: { children: ReactNode; of?: 'section' | 'record' }) => (
  <p className="mt-3 tx-small" data-run-of={of} style={{ color: 'var(--ink-2)' }}>{children}</p>
)

/**
 * Where the reason is, when the bundle gives one: its notes, which Overview
 * shows in the card after this one. Said only when a note names what the
 * sentence before it is about (lib/run.ts, notesSpeakOf); the card itself
 * states no reason.
 */
const Why = ({ when }: { when: boolean }) => (
  when ? <span data-run-why=""> The converter&rsquo;s notes, in the next card, say why.</span> : null
)

/** The records the converter did not list, as it named them, and a count of the rest. */
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

const KIND: Record<Exclude<RunRecordView['kind'], 'fields'>, [string, 'file' | 'none']> = {
  copied: ['copied', 'file'],
  value: ['copied', 'file'],
  text: ['as text', 'file'],
  named: ['named, not copied', 'none'],
  empty: ['no content', 'none'],
}

function Record({ r, notes }: { r: RunRecordView; notes: readonly string[] }) {
  // A record listed by its named fields says how many of the six the bundle holds: the rows below it.
  const [label, tone] = r.kind === 'fields' ? [`${r.fields.length} of ${IDENTITY.length} fields`, 'file'] : KIND[r.kind]
  return (
    <div className="mt-3.5" data-run-record={r.path} data-run-kind={r.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Mono>{r.path}</Mono>
        <span className={`badge badge-${tone}`}>{label}</span>
      </div>
      {r.kind === 'copied' && r.fields.length === 0 ? (
        <Said of="record">An empty record: the entry holds no fields.</Said>
      ) : r.kind === 'copied' || r.kind === 'fields' ? (
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
        <Said of="record">The converter named this record instead of copying it: <Mono>{r.sentence}</Mono></Said>
      ) : r.kind === 'empty' ? (
        <Said of="record">Listed with no content.<Why when={notesSpeakOf(notes, [r.path])} /></Said>
      ) : (
        <div className="mt-1.5 tx-small"><Value v={r.kind === 'text' ? r.text : r.value} /></div>
      )}
    </div>
  )
}

/**
 * A value as recorded: inline when short, folded behind a disclosure when long — never cut.
 * An empty string is the app's mark for no value, with what it is in its title, never a blank;
 * a string of spaces only is shown quoted, so that it can be seen.
 */
function Value({ v }: { v: unknown }) {
  if (v === '') return <span title="An empty string, as recorded" data-run-empty="">—</span>
  const text = typeof v === 'string' && v.trim() === '' ? JSON.stringify(v) : valueText(v)
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
