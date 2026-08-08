// Running the whole-transcriptome views against either kind of object.
//
// For an object held in memory nothing changes: the answer is computed during
// render, in a useMemo, exactly as it always was — no spinner, no frame where
// the figure is missing. For a collection the same computation streams off the
// file, and this reports how far it has got.
//
// Results are remembered per object, so moving a threshold slider, or switching
// between the DEG table and the volcano, never re-reads the file. Only changing
// what is being compared does.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Source } from './source.ts'

/** Progress of a pass, or null when there is nothing running. */
export interface Pass { phase: string; done: number; total: number }

export type Report = (phase: string, done: number, total: number) => void

const CACHE = new WeakMap<Source, Map<string, unknown>>()

function cacheFor(src: Source): Map<string, unknown> {
  let m = CACHE.get(src)
  if (!m) { m = new Map(); CACHE.set(src, m) }
  return m
}

/**
 * A computation that may have to read the file.
 *
 * `key` identifies the question being asked — everything the answer depends on,
 * and nothing else, so the sliders that only filter the answer do not re-ask it.
 */
export function useCompute<T>(
  src: Source,
  key: string,
  enabled: boolean,
  sync: () => T,
  run: (report: Report, cancelled: () => boolean) => Promise<T>,
): { value: T | null; pass: Pass | null } {
  // Held in refs so that a render caused by progress does not restart the pass.
  const runRef = useRef(run)
  const syncRef = useRef(sync)
  runRef.current = run
  syncRef.current = sync

  const memo = useMemo(
    () => (enabled && !src.lazy ? syncRef.current() : null),
    // The key is the whole of what the answer depends on; that is its job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src, key, enabled])

  const [done, setDone] = useState<{ key: string; value: T } | null>(null)
  const [pass, setPass] = useState<Pass | null>(null)

  useEffect(() => {
    if (!enabled || !src.lazy) { setPass(null); return }
    const cached = cacheFor(src).get(key)
    if (cached !== undefined) {
      setDone({ key, value: cached as T })
      setPass(null)
      return
    }
    let dead = false
    setDone(null)
    setPass({ phase: '', done: 0, total: 0 })
    runRef.current(
      (phase, d, total) => { if (!dead) setPass({ phase, done: d, total }) },
      () => dead,
    ).then(value => {
      if (dead) return
      cacheFor(src).set(key, value)
      setDone({ key, value })
      setPass(null)
    }).catch((e: unknown) => {
      if (dead) return
      setPass(null)
      // Rethrow where React can show it rather than swallowing a damaged file.
      setDone(() => { throw e instanceof Error ? e : new Error(String(e)) })
    })
    return () => { dead = true }
  }, [src, key, enabled])

  if (!enabled) return { value: null, pass: null }
  if (!src.lazy) return { value: memo, pass: null }
  return { value: done?.key === key ? done.value : null, pass }
}
