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
//
// The rule that costs the most to get wrong: leaving a view NEVER ends a pass,
// and never discards an answer. Markers on the atlas is four minutes; opening
// the DEG table used to cancel it outright, because the registry below held one
// running pass per object and treated any other question as a supersession. It
// now holds one per SLOT — per question, not per object — so the only thing that
// can end a pass is a newer version of the same question. Everything else waits
// its turn and keeps its result.

import { useEffect, useMemo, useRef, useState } from 'react'
import { isSuperseded, runJob, type Running } from './engine.ts'
import type { Job, ResultOf } from './jobs.ts'
import { makeCache, type ResultCache } from './result-cache.ts'
import type { Source } from './source.ts'

/** Progress of a pass, or null when there is nothing running. */
export interface Pass {
  phase: string
  done: number
  total: number
  /** performance.now() when this pass started, so a view can say how long is left. */
  startedAt: number
  /**
   * Asked for, but the object's reader is busy with an earlier question.
   *
   * The worker reads the file one pass at a time, so a second question waits.
   * Saying so is the whole point: a bar that sits at "starting" for four minutes
   * is indistinguishable from a hang, and the honest reading is that the studio
   * is still finishing what it was told to do first.
   */
  queued?: boolean
}

export type Report = (phase: string, done: number, total: number) => void

/* ---------------- the answers already in hand ---------------- */

/**
 * Results, remembered per open object.
 *
 * The lifetime is the object's. The Source is the key of a WeakMap, so closing
 * one drops every answer that belonged to it: nothing here outlives the object
 * it describes, and no answer can be found under an object it was not computed
 * for. What the answers cost, and which one goes when there are too many, is
 * result-cache.ts.
 */
const CACHE = new WeakMap<Source, ResultCache>()

function cacheFor(src: Source): ResultCache {
  let m = CACHE.get(src)
  if (!m) { m = makeCache(); CACHE.set(src, m) }
  return m
}

const cacheGet = (src: Source, key: string) => cacheFor(src).get(key)
const cachePut = (src: Source, key: string, value: unknown) => cacheFor(src).put(key, value)

/**
 * A cached answer, read during render.
 *
 * Pure — it creates nothing and reorders nothing — so it is safe where `cacheGet`
 * would not be, and it is what makes a return to a tab instant rather than
 * instant-after-one-empty-frame. The effect still calls `cacheGet` afterwards,
 * which is what marks the answer as wanted and so keeps the thing on screen out
 * of reach of eviction.
 */
const cachePeek = (src: Source, key: string) => CACHE.get(src)?.peek(key) ?? null

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
    const cached = cacheGet(src, key)
    if (cached) {
      setDone({ key, value: cached.value as T })
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
      cachePut(src, key, value)
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
  if (done?.key === key) return { value: done.value, pass }
  const hit = cachePeek(src, key)
  return { value: hit ? (hit.value as T) : null, pass: hit ? null : pass }
}

/* ---------------- the running computations, per object ---------------- */

/**
 * A pass in flight.
 *
 * It belongs to the QUESTION, not to the view that asked it. A four-minute run
 * that is thrown away because the user glanced at another tab is a four-minute
 * run the user pays for twice, so unmounting only stops listening.
 *
 * What ends a pass is a NEWER VERSION OF THE SAME QUESTION — and then it is
 * cancelled outright, never left to finish behind its replacement. That is what
 * `slot` names. Changing the contrast replaces the contrast pass, because nobody
 * will ever want the old one again. Opening the DEG table replaces nothing: the
 * markers pass answers a different question, one the user asked for and has not
 * withdrawn, and cancelling it is how this app used to lose four minutes of work
 * to a tab click. Different slots therefore run side by side; the worker takes
 * them in the order they were asked.
 *
 * There are as many slots as there are job kinds, so this is bounded at four
 * passes per object with no bookkeeping to get wrong.
 */
interface Task {
  slot: string
  key: string
  running: Running<unknown>
  pass: Pass
  /** Views currently watching. A task with none still runs; it just has no audience. */
  listeners: Set<(t: Task) => void>
  value: unknown
  error: Error | null
}

const TASKS = new WeakMap<Source, Map<string, Task>>()

function tasksFor(src: Source): Map<string, Task> {
  let m = TASKS.get(src)
  if (!m) { m = new Map(); TASKS.set(src, m) }
  return m
}

/**
 * Forget a slot's task, so the next ask builds a fresh one.
 *
 * A task that settled with an error keeps that error, and `taskFor` returns the
 * live task whenever the key matches — so without this, retrying the same
 * question hands back the same failure without going near the worker.
 */
function dropTask(src: Source, slot: string) {
  const all = TASKS.get(src)
  const live = all?.get(slot)
  if (!live) return
  live.running.cancel()
  all?.delete(slot)
}

function taskFor(src: Source, slot: string, key: string, make: () => Job): Task | null {
  const all = tasksFor(src)
  const live = all.get(slot)
  if (live) {
    if (live.key === key) return live
    // The same question, asked again with different terms. Abandon the old one —
    // do not queue behind it, and do not let it come back later and land on top
    // of the new answer.
    live.running.cancel()
    all.delete(slot)
  }
  const startedAt = performance.now()
  const task: Task = {
    slot, key,
    // The reader is single-file, so anything asked while another pass is live
    // waits its turn. The bar says so rather than sitting at "starting".
    pass: { phase: '', done: 0, total: 0, startedAt, queued: all.size > 0 },
    listeners: new Set(), value: undefined, error: null,
    running: { promise: Promise.resolve(), cancel: () => {} },
  }
  // The clock starts when the PASS does, not when it was asked for. The worker's
  // first message is the one it posts on picking the job up, so a job that
  // waited behind another does not report the wait as elapsed work — which would
  // overstate what is left by exactly the time it spent queued, and the estimate
  // is only worth showing if it is honest.
  let began = startedAt
  const running = runJob(src, make() as never, (phase, done, total) => {
    if (task.pass.queued) began = performance.now()
    task.pass = { phase, done, total, startedAt: began }
    for (const l of task.listeners) l(task)
  })
  if (!running) return null
  task.running = running
  all.set(slot, task)
  running.promise.then(value => {
    if (all.get(slot) !== task) return
    all.delete(slot)
    // Stored before anyone is told, so that a listener which re-reads the cache
    // on the same tick finds the answer rather than starting the pass again.
    cachePut(src, key, value)
    task.value = value
    for (const l of task.listeners) l(task)
  }, (e: unknown) => {
    // Superseded means this task was replaced above; it has already been taken
    // out of the registry and there is nobody it should report to.
    if (isSuperseded(e)) return
    if (all.get(slot) !== task) return
    all.delete(slot)
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
 * switch never re-reads the file — and once an answer is in hand it is returned
 * in the effect that follows the render, with no pass and no progress bar, for
 * as long as the object stays open.
 *
 * `slot` says which question this is, independently of its terms. It is what
 * decides whether a pass in flight is superseded: a new key in the SAME slot
 * replaces it, a different slot leaves it alone to finish. Cell markers and a
 * group contrast are different slots and so cannot cancel each other, which is
 * the difference between switching tabs and losing four minutes.
 *
 * The value returned is only ever the one stored under the key being rendered —
 * so a late answer to a question the user has moved on from has nowhere to
 * appear, whatever order the messages arrive in.
 */
export function useJob<K extends Job['kind']>(
  src: Source,
  slot: string,
  key: string,
  enabled: boolean,
  inline: () => ResultOf[K],
  job: () => Extract<Job, { kind: K }>,
): {
  value: ResultOf[K] | null
  pass: Pass | null
  /** The pass failed. The card shows this and offers `retry` — see below. */
  failed: Error | null
  /** Discard the failure and ask again. */
  retry: () => void
} {
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
  const [failed, setFailed] = useState<Error | null>(null)
  /** Bumped by `retry`, to re-run the effect on the same key. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setFailed(null)
    if (!enabled || !src.remote) { setPass(null); return }
    const cached = cacheGet(src, key)
    if (cached) {
      setDone({ key, value: cached.value as ResultOf[K] })
      setPass(null)
      return
    }
    setDone(null)
    const task = taskFor(src, slot, key, jobRef.current as () => Job)
    if (!task) return
    const settle = (t: Task) => {
      if (t.error) {
        setPass(null)
        /**
         * Reported, not thrown.
         *
         * This used to rethrow into the render so the error boundary caught it,
         * which unmounts the whole view — for a pass that may well succeed on a
         * second attempt, because the common cause is the browser reclaiming a
         * worker under memory pressure rather than anything wrong with the
         * file. The reader lost the tab and every control they had set on it.
         *
         * The card shows the message and a way to try again instead. A file
         * that is genuinely damaged says so every time and nothing is hidden;
         * a transient failure costs one click.
         */
        setFailed(t.error)
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
  }, [src, slot, key, enabled, attempt])

  const retry = () => {
    // Drop the failed task so taskFor builds a fresh one rather than handing
    // back the one that is already holding an error.
    dropTask(src, slot)
    setFailed(null)
    setAttempt(a => a + 1)
  }

  if (!enabled) return { value: null, pass: null, failed: null, retry }
  if (!src.remote) return { value: memo, pass: null, failed: null, retry }
  // Both readings are keyed, and only this key's answer can come out of either:
  // `done` carries the key it was settled under, and `peek` is a lookup by key.
  // A late answer to a withdrawn question has nowhere to appear in either.
  if (done?.key === key) return { value: done.value, pass, failed, retry }
  const hit = cachePeek(src, key)
  return {
    value: hit ? (hit.value as ResultOf[K]) : null,
    pass: hit ? null : pass,
    failed,
    retry,
  }
}
