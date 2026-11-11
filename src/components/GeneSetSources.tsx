import { useMemo, useRef, useState } from 'react'
import { InRail, RailGroup } from './Rail.tsx'
import Popover from './Popover.tsx'
import type { LibraryState, SetIndex } from '../lib/genesets.ts'
import { collectionToText, type Collection } from '../lib/msigdb.ts'
import SetEditor from './SetEditor.tsx'
import type { Detection, Species } from '../lib/species.ts'

/**
 * Which MSigDB collections are in play, and what state the library is in.
 *
 * The collections are a parameter of the analysis, like the thresholds beside
 * them — turning GO:BP off changes what is tested and therefore what the
 * Benjamini–Hochberg correction is applied across — so they live on the card
 * that runs the test, not in the app's own bar. The SPECIES does live in the
 * bar, because it is a fact about the object rather than a choice about the
 * analysis.
 *
 * A collection that is off has not been downloaded. Its size is on the chip, so
 * the cost of turning it on is stated before it is paid rather than discovered
 * as a pause.
 */
export default function GeneSetSources({
  lib, species, sources, onSources, customSets, onCustomSets, index, background, detected,
}: {
  lib: LibraryState
  species: Species
  sources: readonly string[]
  onSources: (next: string[]) => void
  /** Collections read from the reader's own GMT files. */
  customSets: readonly Collection[]
  onCustomSets: (next: Collection[]) => void
  /**
   * The library folded against a background, when the caller has one.
   *
   * Enrichment does — it is what its test runs on — and the count of sets that
   * survived is the honest headline: 12 599 sets in the collection is not the
   * number anything was tested against. Gene sets has no background of its own
   * and passes null.
   */
  index?: SetIndex | null
  /** The object's own gene names, for the coverage figure below. */
  background: readonly string[]
  /** What the object's names say it is, for the species check. */
  detected: Detection | null
}) {
  const avail = lib.manifest?.species[species]?.sources ?? []
  const [gmtError, setGmtError] = useState<string | null>(null)
  /** The editor: closed, open on nothing, or open on a collection being edited. */
  const [edit, setEdit] = useState<{ of: Collection | null } | null>(null)

  /**
   * Gene sets the reader supplies.
   *
   * The one thing this studio could not do with gene sets: a lab with its own
   * signatures had to either find them in MSigDB or go elsewhere. Pasting them
   * into Gene sets scores a module, which is a different question — it says how
   * strongly each CELL expresses the signature, not whether a DE list is
   * enriched for it.
   *
   * Reading, parsing and showing what was understood all live in SetEditor now.
   * They were here as a file-input handler that could only take a GMT and could
   * only report a failure after the fact, which is the shape this control had
   * to lose: the parse is live, and what it found is on screen before anything
   * is added.
   */

  /**
   * How much of this object any enabled set covers.
   *
   * This is COVERAGE, and it used to be presented as a species check — "only
   * 12.5% of this object's genes are spelled the way the Mouse library spells
   * them", on an object that is unmistakably mouse. It was measuring the wrong
   * thing entirely: with Hallmark alone enabled the library holds 4 291 symbols
   * and the object measures 34 290, so 12.5% is arithmetic, not a diagnosis.
   * Turn on the six default collections and the same object reads 58.8%.
   *
   * Which species the sets are for is a different question with a better
   * answer, one line down: the object's own names already settle it.
   */
  const covered = useMemo(() => {
    if (!lib.collections.length) return null
    const syms = new Set<string>()
    for (const c of lib.collections) for (const g of c.symbols) syms.add(g.toUpperCase())
    if (!background.length) return null
    let hit = 0
    for (const g of background) if (syms.has(g.toUpperCase())) hit++
    return hit / background.length
  }, [lib.collections, background])

  /**
   * The species check that is actually a species check.
   *
   * Not a ratio: a disagreement between what the reader has chosen and what the
   * object's own gene names say. On the object that prompted this, detection
   * read ENSMUSG accessions at 100% confidence while a coverage ratio was
   * calling it 12.5% — one of those is evidence about a species and the other
   * is evidence about a collection.
   *
   * Only raised when detection had something real to go on. An object whose
   * symbols were upper-cased upstream genuinely looks human, and shouting at
   * someone who has correctly overridden that is worse than staying quiet.
   */
  const wrongSpecies = detected
    && detected.species !== species
    && (detected.from === 'accession' || (detected.from === 'symbols' && detected.support > 0.8))
  /**
   * The last collection standing, which may not be switched off.
   *
   * Never all off: the card below would have nothing to test against and the
   * only way back would be this row, which is easy to scroll past.
   *
   * A collection of the reader's OWN counts as one standing. It did not, and
   * that made the guard wrong in exactly the case it should have relaxed for:
   * somebody who has just pasted their own sets and wants to test against
   * those alone found the last MSigDB chip refusing to turn off, with no
   * explanation — the click simply did nothing. Their sets were right there,
   * and the library would not have been empty.
   */
  const lastStanding = (name: string) =>
    sources.length === 1 && sources[0] === name && customSets.length === 0

  const toggle = (name: string) => {
    const on = sources.includes(name)
    if (on && lastStanding(name)) return
    onSources(on ? sources.filter(s => s !== name) : [...sources, name])
  }

  const chosen = avail.filter(s => sources.includes(s.source))
  const nSets = chosen.reduce((a, s) => a + s.nSets, 0)
  /** Sets the reader brought. Always on — they are not downloaded, they are given. */
  const mine = customSets.reduce((a, c) => a + c.sets.length, 0)

  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
    <InRail>
      {/* One control for which collections are on. They were sixteen chips in
          a well over the result; chosen rarely, so they are one field in the
          rail and a list behind it that names every collection with its size. */}
      <RailGroup label="Collections">
        <button ref={trigger} className="sel w-full text-left" aria-haspopup="listbox"
          aria-expanded={open}
          title={chosen.map(c => c.source).join(', ') || 'No collection selected.'}
          onClick={() => setOpen(v => !v)}>
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {chosen.map(c => c.source).join(', ') || 'none'}
            </span>
            <span className="num flex-none" style={{ color: 'var(--ink-3)' }}>
              {chosen.length}/{avail.length}
            </span>
          </span>
        </button>
        <Popover open={open} anchor={trigger} role="listbox" label="Collections"
          width={272} onClose={() => setOpen(false)}>
          <div className="p-1.5">
            {avail.map(s => {
              const on = sources.includes(s.source)
              return (
                <button
                  key={s.source} role="option" aria-selected={on}
                  className="flex w-full items-center gap-2 rounded-[--r-md] px-2 py-1.5 text-left tx-small hover:bg-[var(--sunk)]"
                  // Says no rather than doing nothing. A row that silently
                  // ignores the click is indistinguishable from one that is
                  // broken, which is how the guard above was reported.
                  disabled={lastStanding(s.source)}
                  style={{ opacity: lastStanding(s.source) ? 0.5 : 1 }}
                  title={lastStanding(s.source)
                    ? 'The only collection left: turn another on, or add your own, before turning this off'
                    : `${s.nSets.toLocaleString()} sets · ${(s.bytes / 1e6).toFixed(2)} MB`
                    + (s.projected ? ' · human sets mapped through orthologs, not a mouse annotation' : '')
                    + (s.derived ? ` · assembled from ${s.derived.join(', ')}` : '')
                    + (on ? '' : ', not loaded yet')}
                  onClick={() => toggle(s.source)}
                >
                  <span
                    aria-hidden
                    className="grid h-[14px] w-[14px] flex-none place-items-center rounded-[--r-sm] tx-micro"
                    style={{
                      background: on ? 'var(--sel)' : 'transparent',
                      color: 'var(--surface)',
                      border: `1.5px solid ${on ? 'var(--sel)' : 'var(--ctl)'}`,
                    }}
                  >{on ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1 truncate">{s.source}</span>
                  <span className="num flex-none" style={{ color: 'var(--ink-3)' }}>
                    {s.nSets.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        </Popover>
      <p className="hint m-0">
        {lib.error
          ? <span style={{ color: 'var(--warn)' }}>Could not load the gene sets:  {lib.error}</span>
          : lib.loading
            ? `Loading ${lib.total - lib.done} of ${lib.total} collection${lib.total === 1 ? '' : 's'}…`
            : !chosen.length
              ? (customSets.length
                // "No collection selected" was counting MSigDB and nothing
                // else, so a reader who had turned every MSigDB collection off
                // in order to test against their OWN sets was told there was
                // nothing selected while their sets sat enabled beside the
                // sentence.
                ? <>Your own sets only: <b>{mine.toLocaleString()}</b> set
                    {mine === 1 ? '' : 's'} in {customSets.length} collection
                    {customSets.length === 1 ? '' : 's'}. No MSigDB collection is on.</>
                : 'No collection selected.')
              : index
                ? <>
                    MSigDB {index.release} · {nSets.toLocaleString()} sets, of which{' '}
                    <b>{index.sets.length.toLocaleString()}</b> contain a gene this contrast
                    tested: the ones tested and corrected across.
                  </>
                : <>MSigDB · {nSets.toLocaleString()} sets in {chosen.length} collection
                    {chosen.length === 1 ? '' : 's'}
                    {mine > 0 && <>, and {mine.toLocaleString()} of your own</>}.</>}
      </p>

      {covered !== null && (
        <p className="hint m-0">
          These collections annotate {(covered * 100).toFixed(0)}% of the genes this object
          measures. That fraction is the annotated background.
        </p>
      )}

      {/*
        An assembled collection says what it was assembled FROM, and what
        having it on beside those costs.

        Without the first sentence "Metabolic" sits in that row looking like a
        database beside KEGG and Reactome, and a hit in it reads as a second,
        independent line of evidence for a pathway one of them already carries.
        Without the second, the reader is not told that the overlap is now
        tested twice — which is the price of the collection being a collection
        rather than a fold of the others, and not a price to charge silently.
      */}
      {chosen.filter(s => s.derived?.length).map(s => {
        // Only the parents actually switched on can be double-tested. A parent
        // that is off contributes nothing to overlap with, so naming it here
        // would be a warning about a thing that is not happening.
        const overlapping = s.derived!.filter(name => sources.includes(name))
        return (
          <p key={s.source} className="hint m-0">
            <b>{s.source}</b> is assembled from{' '}
            {s.derived!.join(', ')}: {s.nSets.toLocaleString()} sets under their own ids.
            {overlapping.length > 0 && (
              <>
                {' '}
                <span style={{ color: 'var(--warn)' }}>
                  {overlapping.join(', ')} {overlapping.length === 1 ? 'is' : 'are'} on too: a term in
                  both is tested twice.
                </span>
              </>
            )}
          </p>
        )
      })}

      {chosen.some(s => s.projected) && (
        <p className="hint m-0">
          {chosen.filter(s => s.projected).map(s => s.source).join(', ')} is human sets mapped
          through orthologs, not a {lib.manifest?.species[species]?.label.toLowerCase() ?? species}{' '}
          annotation. Read it as a weaker claim.
        </p>
      )}

      </RailGroup>

      {/* The reader's own sets, in a group of their own: the one thing a lab
          with its own signatures needs is visible before they go looking. */}
      <RailGroup label="Your sets">
        <button className="btn w-full" onClick={() => { setEdit({ of: null }) }}>
          + Paste or upload
        </button>

        {customSets.map(c => (
          // Two targets, because they are two different acts. Clicking the name
          // used to REMOVE the collection — a destructive action on the whole
          // chip, one stray click from losing a paste with no way back, and no
          // way at all to change a set once added. The name opens it for
          // editing now; the × is its own button and says so.
          <span key={c.source} className="chip-own">
            <button
              className="chip-own-name"
              title={`${c.sets.length.toLocaleString()} of your sets: select to edit them`}
              onClick={() => setEdit({ of: c })}
            >
              {c.source}
              <span className="ml-1.5 opacity-70">{c.sets.length.toLocaleString()}</span>
            </button>
            <button
              className="chip-own-x" aria-label={`Remove ${c.source}`}
              title={`Remove ${c.source}`}
              onClick={() => onCustomSets(customSets.filter(x => x.source !== c.source))}
            >×</button>
          </span>
        ))}

        {!customSets.length && (
          <span className="hint">
            Paste a Python dict, a GMT, or one <span className="mono">Name: a, b, c</span> per
            line. They are tested as MSigDB&rsquo;s are.
          </span>
        )}
      </RailGroup>
    </InRail>

      <SetEditor
        open={edit !== null} background={background}
        initial={edit?.of
          ? { name: edit.of.source, text: collectionToText(edit.of) }
          : null}
        onClose={() => setEdit(null)}
        onAdd={c => {
          setGmtError(null)
          // Same name replaces rather than duplicates, so editing a set and
          // adding it again does not leave the old version enabled beside it.
          // Renaming while editing therefore ADDS: the old name is still a
          // collection somebody chose, and silently dropping it because a field
          // changed would be the destructive click this control just lost.
          onCustomSets([...customSets.filter(x => x.source !== c.source), c])
        }}
      />

      {/* What limits every result under it stays on the stage, as a note. */}
      {gmtError && (
        <p className="note note-warn mb-3">{gmtError}</p>
      )}
      {wrongSpecies && detected && (
        <p className="note note-warn mb-3">
          <b>These sets are for {lib.manifest?.species[species]?.label ?? species}, and this
          object looks like {detected.species}</b> ({detected.why}). Matching ignores case, so
          results will still appear; they will be answering a question about a different species.
        </p>
      )}
    </>
  )
}
