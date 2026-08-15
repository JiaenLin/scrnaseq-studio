// The gene-set library, as the app consumes it.
//
// This file used to BE the library: eighteen sets typed out by hand, with a
// comment explaining that an .h5ad carries no gene sets so the studio had to
// bring its own. The first half of that was true and the second half was a
// choice, and it was the wrong one — an over-representation test against
// eighteen sets somebody picked in advance cannot discover anything they did
// not already suspect, and the p-values it prints look exactly like real ones.
//
// It is MSigDB now, per species, fetched on demand. What is left here is the
// wiring: which collections are enabled, loading them, and folding them against
// the object to make the index ORA runs on.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  indexFor, isLoaded, loadCollection, loadManifest,
  type Collection, type Manifest, type SetIndex,
} from './msigdb.ts'
import type { Species } from './species.ts'

export type { SetIndex } from './msigdb.ts'

export interface LibraryState {
  /** What each species offers, or null until the manifest lands. */
  manifest: Manifest | null
  /**
   * The enabled collections, once every one of them has arrived.
   *
   * Collections, not a folded index: the background an enrichment is tested
   * against is the genes THAT CONTRAST tested, which differs between contrasts
   * on one object, so folding belongs to the caller. rnaseq-studio splits it
   * the same way — one `prepareSets` per bundle, one background per contrast.
   */
  collections: Collection[]
  /** How many of the requested collections have arrived. */
  done: number
  total: number
  loading: boolean
  error: string | null
}

/** The sources a species starts with, from the manifest's own `on` flags. */
export function defaultSources(manifest: Manifest | null, species: Species): string[] {
  return manifest?.species[species]?.sources.filter(s => s.on).map(s => s.source) ?? []
}

/**
 * Load the enabled collections for a species and fold them against an object.
 *
 * Two costs, deliberately separated. The DOWNLOAD belongs to the species and
 * the collection — mouse GO:BP is the same 1.4 MB whatever object is open — so
 * it is cached for the life of the tab, and switching back to a source you had
 * a minute ago costs nothing. The INDEX belongs to the object, because it is
 * the object's own gene list that decides which sets survive and how large each
 * one is; it is rebuilt when the object or the enabled sources change, and
 * costs about 55 ms on the full human default library.
 */
export function useGeneSets(
  /** null before an object is open — nothing is fetched until then. */
  species: Species | null,
  sources: readonly string[],
  /**
   * Collections the reader supplied, from their own GMT files.
   *
   * They sit beside the MSigDB ones and are never fetched, so they survive a
   * species switch — a lab's own signatures are the lab's, not a property of
   * whichever object happens to be open.
   */
  custom: readonly Collection[] = EMPTY,
): LibraryState {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [done, setDone] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Only the newest request may land: switching species while three files are
  // in flight must not fold the old species' sets into the new index.
  const token = useRef(0)

  useEffect(() => {
    loadManifest().then(setManifest, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const wanted = useMemo(() => {
    if (!species) return []
    const avail = manifest?.species[species]?.sources ?? []
    return avail.filter(s => sources.includes(s.source))
  }, [manifest, species, sources])

  // The identity of the request, so the effect does not re-fire on a new array
  // that names the same files.
  const key = `${species}|${wanted.map(w => w.file).join(',')}`

  useEffect(() => {
    if (!manifest) return
    const mine = ++token.current
    setError(null)
    if (!wanted.length) { setCollections([]); setDone(0); return }
    // Anything already cached is not a download, so adding one source to a
    // library that is already in hand does not redraw the card as "loading".
    const already = wanted.filter(w => isLoaded(w.file)).length
    setDone(already)
    let landed = already
    Promise.all(wanted.map(w => {
      const fresh = !isLoaded(w.file)
      return loadCollection(w.file).then(c => {
        if (fresh && token.current === mine) setDone(++landed)
        return c
      })
    })).then(
      cs => { if (token.current === mine) { setCollections(cs); setDone(cs.length) } },
      (e: unknown) => {
        if (token.current === mine) setError(e instanceof Error ? e.message : String(e))
      },
    )
    // `key` is the identity of `wanted`; depending on the array itself would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, key])

  const ready = wanted.length > 0 && collections.length === wanted.length

  // A custom collection needs no download, so it is available while MSigDB is
  // still in flight and remains available if MSigDB fails to load at all.
  const all = useMemo(
    () => (custom.length ? [...(ready ? collections : []), ...custom] : (ready ? collections : EMPTY)),
    [ready, collections, custom])

  return {
    manifest,
    collections: all,
    done,
    total: wanted.length,
    loading: wanted.length > 0 && !ready && !error,
    error,
  }
}

/** One frozen empty array, so a not-ready library is referentially stable. */
const EMPTY: Collection[] = []

/**
 * Fold the loaded collections against one contrast's tested genes.
 *
 * Separate from the hook because the background is per contrast, and memoised
 * on its own because folding the full human default library costs about 50 ms
 * and must not repeat on a threshold drag.
 */
export function useSetIndex(collections: Collection[], background: string[]): SetIndex | null {
  return useMemo(
    () => (collections.length ? indexFor(collections, background) : null),
    [collections, background])
}
