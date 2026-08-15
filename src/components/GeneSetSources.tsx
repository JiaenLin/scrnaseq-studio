import { useMemo } from 'react'
import type { LibraryState, SetIndex } from '../lib/genesets.ts'
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
  lib, species, sources, onSources, index, background, detected,
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
  /** The object's own gene names, for the coverage figure below. */
  background: readonly string[]
  /** What the object's names say it is, for the species check. */
  detected: Detection | null
}) {
  const avail = lib.manifest?.species[species]?.sources ?? []

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
              + (s.projected ? ' · human sets mapped through orthologs, not a mouse annotation' : '')
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

      {covered !== null && (
        <p className="mt-1 tx-micro" style={{ color: 'var(--ink-3)' }}>
          These collections annotate {(covered * 100).toFixed(0)}% of the genes this object
          measures. That fraction is the annotated background, and turning more collections on
          raises it.
        </p>
      )}

      {chosen.some(s => s.projected) && (
        <p className="mt-1 tx-micro" style={{ color: 'var(--ink-3)' }}>
          {chosen.filter(s => s.projected).map(s => s.source).join(', ')} is human sets mapped
          through orthologs, not a {lib.manifest?.species[species]?.label.toLowerCase() ?? species}{' '}
          annotation — MSigDB publishes no native one. Read it as a weaker claim than the rest.
        </p>
      )}

      {wrongSpecies && detected && (
        <p className="mt-1.5 tx-micro" style={{ color: 'var(--warn)' }}>
          <b>These sets are for {lib.manifest?.species[species]?.label ?? species}, and this
          object looks like {detected.species}</b> — {detected.why}. Matching ignores case, so
          results will still appear; they will be answering a question about a different species.
        </p>
      )}
    </div>
  )
}
