import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseSets, type Collection } from '../lib/msigdb.ts'
import { lowerIndex } from '../lib/genes.ts'

/**
 * Paste your own gene sets in, in whatever you have them in.
 *
 * This replaced a file picker labelled "Add a GMT…", which was the one control
 * in the studio that asked the reader to go and produce a file in a format they
 * do not work in. Nobody keeps their signatures as tab-separated triples; they
 * keep them as the dict they built the analysis with, in a notebook, one
 * keystroke from the clipboard. So the control is a text box, and the parser
 * meets the input where it is — see `parseSets`.
 *
 * The thing that makes it usable is not the box, it is the panel underneath:
 * every set that was found, how many of its genes this object actually
 * measures, and which ones it does not, BEFORE anything is added. A silent
 * parse is the failure mode of every "paste your data here" box ever built —
 * it reads three sets out of your twelve and tells you it worked. This says
 * what it understood and lets the reader see it was wrong while it is still
 * one edit away from right.
 */
export default function SetEditor({ open, background, initial, onClose, onAdd }: {
  open: boolean
  /** The object's own gene names, to say what is measured before anything is added. */
  background: readonly string[]
  /**
   * A collection to open FOR EDITING, written back out as text.
   *
   * Without it the only thing to do with a collection already added was remove
   * it and paste the whole thing again — so fixing one typed symbol in a set of
   * ninety meant retyping ninety. `collectionToText` is the other half; the
   * parser reads its own output back.
   */
  initial?: { name: string; text: string } | null
  onClose: () => void
  onAdd: (c: Collection) => void
}) {
  const [text, setText] = useState('')
  const [name, setName] = useState('My sets')
  const box = useRef<HTMLTextAreaElement>(null)

  // Seeded when the dialog OPENS, not on every render: the fields are the
  // reader's while it is open, and re-seeding under them would undo typing.
  useEffect(() => {
    if (!open) return
    setText(initial?.text ?? '')
    setName(initial?.name ?? 'My sets')
    // `initial` is read once, on the transition to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose])

  /**
   * What the paste says, re-read on every keystroke.
   *
   * Cheap enough to do live — the input is a few hundred lines, not a matrix —
   * and being live is the point: the reader watches the count settle as they
   * finish pasting, rather than pressing Add and finding out.
   */
  const parsed = useMemo(() => {
    if (!text.trim()) return null
    try {
      return { ok: parseSets(text, name.trim() || 'My sets'), error: null as string | null }
    } catch (e) {
      return { ok: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, name])

  /** How much of each set this object can actually answer for. */
  const coverage = useMemo(() => {
    const c = parsed?.ok
    if (!c) return null
    const byLower = lowerIndex(background)
    const rows = c.sets.map(s => {
      const genes = Array.from(s.genes, i => c.symbols[i])
      const missing = genes.filter(g => !byLower.has(g.toLowerCase()))
      return { name: s.name, n: genes.length, missing }
    })
    return {
      rows,
      total: rows.reduce((a, r) => a + r.n, 0),
      found: rows.reduce((a, r) => a + (r.n - r.missing.length), 0),
    }
  }, [parsed, background])

  if (!open) return null

  const empty = !text.trim()
  const nSets = parsed?.ok?.sets.length ?? 0

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-6"
      style={{ background: 'color-mix(in srgb, var(--ink) 34%, transparent)' }}
      // A click on the backdrop closes; a click inside must not. Checking the
      // target rather than stopping propagation on the panel, because the panel
      // holds a textarea and swallowing its events breaks selection.
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Add your own gene sets"
        className="menu-in w-full max-w-[860px] rounded-[--r-md]"
        style={{ background: 'var(--surface)', border: '1px solid var(--line-2)',
                 boxShadow: 'var(--shadow-menu)', marginTop: '4vh' }}
      >
        <div className="flex items-start justify-between gap-4 border-b p-4"
          style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="eyebrow">Gene sets · your own</div>
            <h2 className="card-title">Paste your gene sets</h2>
            <p className="sub">
              A Python or R dict, JSON, a GMT, <span className="mono">Name: gene, gene</span>{' '}
              lines, or a plain list of genes for one set. Nothing is uploaded.
            </p>
          </div>
          <button className="btn btn-quiet" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="p-4">
          <label className="flex items-center gap-2">
            <span className="glabel flex-none">Collection name</span>
            <input className="inp" style={{ width: 240 }} value={name}
              aria-label="Collection name"
              onChange={e => setName(e.target.value)} />
            <span className="flex-1" />
            <label className="btn btn-quiet cursor-pointer">
              or read a file…
              <input
                type="file" accept=".gmt,.txt,.tsv,.json,.csv,.py,.R" className="sr-only"
                onChange={async e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setText(await f.text())
                  setName(f.name.replace(/\.[^.]+$/, '') || 'My sets')
                }}
              />
            </label>
          </label>

          <textarea
            ref={box}
            className="inp mono mt-2 block w-full"
            style={{ height: 240, resize: 'vertical', lineHeight: 1.45 }}
            spellCheck={false}
            // Not "Gene sets": the tab panel behind this dialog already has
            // that accessible name, so the two were indistinguishable to
            // anything matching on it — a screen reader included.
            aria-label="Your gene sets"
            placeholder={'pathway_genes = {\n    "TCA cycle": ["Cs", "Aco2", "Idh2", "Mdh2"],\n    "Glycolysis": ["Hk1", "Gpi1", "Aldoa", "Pkm"],\n}'}
            value={text}
            onChange={e => setText(e.target.value)}
          />

          {/* What was understood, before anything is added. */}
          {parsed?.error && (
            <p className="note note-warn mt-3 tx-small">{parsed.error}</p>
          )}
          {coverage && parsed?.ok && (
            <div className="panel mt-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="glabel">Understood</span>
                <span className="tx-small">
                  <b>{nSets}</b> set{nSets === 1 ? '' : 's'}
                </span>
                <span className="tx-small">
                  <b>{coverage.found}</b> of {coverage.total} genes are measured in this object
                </span>
                {coverage.found === 0 && (
                  <span className="tx-small" style={{ color: 'var(--warn)' }}>
                    none of them — check the species and capitalisation
                  </span>
                )}
              </div>
              <div className="scrollx mt-2" style={{ maxHeight: 190, border: 0 }}>
                <table className="t">
                  <thead><tr><th>Set</th><th className="num">Genes</th><th>Not in this object</th></tr></thead>
                  <tbody>
                    {coverage.rows.map(r => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td className="num">{r.n - r.missing.length} / {r.n}</td>
                        <td className="mono tx-micro" style={{ color: 'var(--ink-3)' }}>
                          {r.missing.length === 0 ? '—'
                            : r.missing.slice(0, 6).join(', ')
                              + (r.missing.length > 6 ? ` +${r.missing.length - 6}` : '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t p-4"
          style={{ borderColor: 'var(--line)' }}>
          <span className="tx-micro" style={{ color: 'var(--ink-3)' }}>
            Read in this page, like every other file this studio opens. Not kept between
            sessions.
          </span>
          <span className="flex items-center gap-2">
            <button className="btn btn-quiet" onClick={() => setText('')}
              disabled={empty}>Clear</button>
            <button
              className="btn btn-primary"
              disabled={!parsed?.ok}
              onClick={() => {
                if (!parsed?.ok) return
                onAdd(parsed.ok)
                setText('')
                onClose()
              }}
            >{nSets ? `Add ${nSets} set${nSets === 1 ? '' : 's'}` : 'Add'}</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
