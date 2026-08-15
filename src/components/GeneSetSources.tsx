import { useMemo } from 'react'
import type { LibraryState, SetIndex } from '../lib/genesets.ts'
import { matchRate, type Species } from '../lib/species.ts'

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
  lib, species, sources, onSources, index, background,
}: {
  lib: LibraryState
  species: Species
  sources: readonly string[]
  onSources: (next: string[]) => void
  /**
   * The library folded against a background, when the caller has one.
   *
   * Enrichment does — it is what its test runs on — and the count of sets that
   * survived is the honest headline: 12 599 sets in the collection is not the
   * number anything was tested against. Gene sets has no background of its own
   * and passes null.
   */
  index?: SetIndex | null
  /** The object's own gene names, for the spelling check below. */
  background: readonly string[]
}) {
  const avail = lib.manifest?.species[species]?.sources ?? []

  /**
   * Does this library spell genes the way this object does?
   *
   * It has to be asked, because getting it wrong is not visible in the results.
   * Matching is deliberately case-insensitive — exporters upper-case things —
   * so a mouse object run against the human library still matches most of its
   * genes and comes back with a full page of enrichments. On the time-course
   * demo the human library leaves MORE sets standing than the mouse one, so
   * the count cannot warn anybody either.
   *
   * Compared case-sensitively the two separate completely: 98.6% against the
   * library built for the object, 0% against the other one. That is the number
   * worth showing, and it is the only thing here that can catch a wrong pick.
   */
  const fit = useMemo(() => {
    if (!lib.collections.length) return null
    const syms = new Set<string>()
    for (const c of lib.collections) for (const g of c.symbols) syms.add(g)
    return matchRate(background, syms)
  }, [lib.collections, background])
  const toggle = (name: string) => {
    const on = sources.includes(name)
    // Never all off: the card below would have nothing to test against and the
    // only way back would be this row, which is easy to scroll past.
    if (on && sources.length === 1) return
    onSources(on ? sources.filter(s => s !== name) : [...sources, name])
  }

  const chosen = avail.filter(s => sources.includes(s.source))
  const nSets = chosen.reduce((a, s) => a + s.nSets, 0)

  return (
    <div className="panel mb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="glabel">Collections</span>
        {avail.map(s => (
          <button
            key={s.source} className="chip" aria-pressed={sources.includes(s.source)}
            title={`${s.nSets.toLocaleString()} sets · ${(s.bytes / 1e6).toFixed(2)} MB`
              + (sources.includes(s.source) ? '' : ' — not downloaded yet')}
            onClick={() => toggle(s.source)}
          >
            {s.source}
            <span className="ml-1.5 opacity-60">{s.nSets.toLocaleString()}</span>
          </button>
        ))}
      </div>

      <p className="mt-2 tx-micro" style={{ color: 'var(--ink-3)' }}>
        {lib.error
          ? <span style={{ color: 'var(--warn)' }}>Could not load the gene sets — {lib.error}</span>
          : lib.loading
            ? `Loading ${lib.total - lib.done} of ${lib.total} collection${lib.total === 1 ? '' : 's'}…`
            : !chosen.length
              ? 'No collection selected.'
              : index
                ? <>
                    MSigDB {index.release} · {nSets.toLocaleString()} sets, of which{' '}
                    <b>{index.sets.length.toLocaleString()}</b> contain a gene this contrast
                    tested. Those are the ones tested, and the ones corrected across.
                  </>
                : <>MSigDB · {nSets.toLocaleString()} sets in {chosen.length} collection
                    {chosen.length === 1 ? '' : 's'}.</>}
      </p>

      {fit !== null && fit < 0.25 && (
        <p className="mt-1.5 tx-micro" style={{ color: 'var(--warn)' }}>
          <b>These sets may be for the wrong organism.</b> Only{' '}
          {(fit * 100).toFixed(1)}% of this object&rsquo;s genes are spelled the way the{' '}
          {lib.manifest?.species[species]?.label ?? species} library spells them. Matching
          ignores case, so results will still appear — they will just be answering a
          question about a different species.
        </p>
      )}
    </div>
  )
}
