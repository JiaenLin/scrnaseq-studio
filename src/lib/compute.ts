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
import { isSuperseded, runJob, type Running } from './engine.ts'
import type { Job, ResultOf } from './jobs.ts'
import type { Source } from './source.ts'

/** Progress of a pass, or null when there is nothing running. */
export interface Pass {
  phase: string
  done: number
  total: number
  /** performance.now() when this pass started, so a view can say how long is left. */
  startedAt: number
}

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
    const startedAt = performance.now()
    setDone(null)
    setPass({ phase: '', done: 0, total: 0, startedAt })
    runRef.current(
      (phase, d, total) => { if (!dead) setPass({ phase, done: d, total, startedAt }) },
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

/* ---------------- the one running computation, per object ---------------- */

/**
 * A pass in flight.
 *
 * It belongs to the QUESTION, not to the view that asked it. A four-minute run
 * that is thrown away because the user glanced at another tab is a four-minute
 * run the user pays for twice, so unmounting only stops listening. What ends a
 * pass is a different question being asked of the same object — and then it is
 * cancelled outright, never left to finish behind the new one.
 *
 * At most one exists per object, which is also all the file can serve at once.
 */
interface Task {
  key: string
  running: Running<unknown>
  pass: Pass
  /** Views currently watching. A task with none still runs; it just has no audience. */
  listeners: Set<(t: Task) => void>
  value: unknown
  error: Error | null
}

const TASKS = new WeakMap<Source, Task>()

function taskFor(src: Source, key: string, make: () => Job): Task | null {
  const live = TASKS.get(src)
  if (live) {
    if (live.key === key) return live
    // A different question. Abandon the old one — do not queue behind it, and do
    // not let it come back later and land on top of the new answer.
    live.running.cancel()
    TASKS.delete(src)
  }
  const startedAt = performance.now()
  const task: Task = {
    key, pass: { phase: '', done: 0, total: 0, startedAt },
    listeners: new Set(), value: undefined, error: null,
    running: { promise: Promise.resolve(), cancel: () => {} },
  }
  const running = runJob(src, make() as never, (phase, done, total) => {
    task.pass = { phase, done, total, startedAt }
    for (const l of task.listeners) l(task)
  })
  if (!running) return null
  task.running = running
  TASKS.set(src, task)
  running.promise.then(value => {
    if (TASKS.get(src) !== task) return
    TASKS.delete(src)
    cacheFor(src).set(key, value)
    task.value = value
    for (const l of task.listeners) l(task)
  }, (e: unknown) => {
    // Superseded means this task was replaced above; it has already been taken
    // out of the registry and there is nobody it should report to.
    if (isSuperseded(e)) return
    if (TASKS.get(src) !== task) return
    TASKS.delete(src)
    task.error = e instanceof Error ? e : new Error(String(e))
    for (const l of task.listeners) l(task)
  })
  return task
}

/**
 * A whole-transcriptome computation, run wherever it belongs.
 *
 * This is the hook the heavy views use. It has two paths and the OBJECT decides
 * which, not the view:
 *
 *   in memory (`src.remote === null`) — a demo object or a plain bundle, where
 *     the matrix is already here. `inline()` runs in a useMemo during render,
 *     exactly as it did before any of this existed: the figure is on screen in
 *     the first frame, with no "computing…" and no extra render. A 2 638-cell
 *     object must not pay for an atlas, and this is where that promise is kept.
 *
 *   in the file (`src.remote` set) — a collection. `job()` is built, handed to
 *     the worker, and `pass` says how far it has got. The page does no numerical
 *     work at all.
 *
 * `key` is the whole of what the answer depends on, and everything follows from
 * it. Answers are remembered per object under it, so a threshold slider or a tab
 * switch never re-reads the file. A different key cancels the running pass
 * before asking. And the value returned is only ever the one stored under the
 * key being rendered — so a late answer to a question the user has moved on from
 * has nowhere to appear, whatever order the messages arrive in.
 */
export function useJob<K extends Job['kind']>(
  src: Source,
  key: string,
  enabled: boolean,
  inline: () => ResultOf[K],
  job: () => Extract<Job, { kind: K }>,
): { value: ResultOf[K] | null; pass: Pass | null } {
  // Held in refs so a render caused by progress cannot restart the job.
  const inlineRef = useRef(inline)
  const jobRef = useRef(job)
  inlineRef.current = inline
  jobRef.current = job

  const memo = useMemo(
    () => (enabled && !src.remote ? inlineRef.current() : null),
    // The key is the whole of what the answer depends on; that is its job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src, key, enabled])

  const [done, setDone] = useState<{ key: string; value: ResultOf[K] } | null>(null)
  const [pass, setPass] = useState<Pass | null>(null)

  useEffect(() => {
    if (!enabled || !src.remote) { setPass(null); return }
    const cached = cacheFor(src).get(key)
    if (cached !== undefined) {
      setDone({ key, value: cached as ResultOf[K] })
      setPass(null)
      return
    }
    setDone(null)
    const task = taskFor(src, key, jobRef.current as () => Job)
    if (!task) return
    const settle = (t: Task) => {
      if (t.error) {
        setPass(null)
        // Rethrow where React can show it rather than swallowing a damaged file.
        setDone(() => { throw t.error })
      } else if (t.value !== undefined) {
        setPass(null)
        setDone({ key, value: t.value as ResultOf[K] })
      } else {
        setPass(t.pass)
      }
    }
    task.listeners.add(settle)
    settle(task)
    // Only stop listening. Ending the pass is `taskFor`'s decision, and it makes
    // it on the evidence that matters: whether the question has changed.
    return () => { task.listeners.delete(settle) }
  }, [src, key, enabled])

  if (!enabled) return { value: null, pass: null }
  if (!src.remote) return { value: memo, pass: null }
  return { value: done?.key === key ? done.value : null, pass }
}
