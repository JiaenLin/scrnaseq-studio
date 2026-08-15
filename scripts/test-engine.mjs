// The compute engine's failure handling, with a stubbed Worker.
//
// This is the path nothing else reaches: the demos run in-page, so a worker is
// only constructed for a streamed bundle, and the behaviour that matters is
// what happens when one DIES. Reported as "sometimes computing will fail" — and
// the reason it stayed failed is here rather than in any view: one error latched
// a `fatal` flag and every job asked for afterwards rejected against it, for the
// life of the page, with no worker ever replaced.

import { Engine } from '../src/lib/engine.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

/** A markers job with the buffers the engine transfers. */
const JOB = { kind: 'markers', owner: new Int32Array(2), size: new Int32Array(2), nGenes: 2 }

/** Every worker built during a test, so restarts are countable. */
const built = []

class FakeWorker {
  constructor() {
    this.listeners = new Map()
    this.posted = []
    this.dead = false
    built.push(this)
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }
  postMessage(m) { this.posted.push(m) }
  terminate() { this.dead = true }
  emit(type, ev) { for (const fn of this.listeners.get(type) ?? []) fn(ev) }
  /** What the engine asked this worker to do, by command. */
  cmds() { return this.posted.map(m => m.cmd) }
}

globalThis.Worker = FakeWorker
globalThis.URL = globalThis.URL ?? URL

const src = { genes: ['A', 'B'], names: { display: ['A', 'B'] } }
const plan = { nGenes: 2, nCells: 2 }
const newEngine = () => {
  built.length = 0
  return new Engine(src, new Blob([]), plan)
}
const settled = async (pr) => {
  try { return { ok: true, value: await pr } } catch (e) { return { ok: false, message: e.message } }
}

console.log('\nA WORKER IS MOUNTED ON CONSTRUCTION')
{
  const e = newEngine()
  check('one worker', built.length, 1)
  check('and it was told to mount the file', built[0].cmds(), ['mount'])
  e.close()
}

console.log('\nA DEAD WORKER IS REPLACED, NOT LATCHED')
{
  const e = newEngine()
  const first = built[0]
  const inflight = e.run(JOB, () => {})
  check('the job reached the worker', first.cmds().includes('run'), true)

  first.emit('error', { message: 'out of memory' })
  const r = await settled(inflight.promise)
  check('the job in flight fails, because its state died with the worker', r.ok, false)
  check('and says why', /out of memory/.test(r.message), true)

  // The point of the fix: a SECOND worker exists and the next job runs on it.
  check('a replacement worker was built', built.length, 2)
  check('and it was mounted on the same file', built[1].cmds(), ['mount'])
  const next = e.run(JOB, () => {})
  check('the next job goes to the new worker', built[1].cmds().includes('run'), true)
  // Before the fix this rejected immediately with the remembered fatal error.
  let rejected = false
  next.promise.catch(() => { rejected = true })
  await new Promise(r2 => setTimeout(r2, 10))
  check('and is NOT rejected out of hand', rejected, false)
  e.close()
}

console.log('\nA MESSAGE THAT CANNOT BE SENT IS NOT SILENCE')
{
  const e = newEngine()
  const job = e.run(JOB, () => {})
  built[0].emit('messageerror', {})
  const r = await settled(job.promise)
  check('messageerror fails the job rather than hanging it', r.ok, false)
  check('with a message a reader can act on',
    /could not be passed back/.test(r.message), true)
  e.close()
}

console.log('\nIT GIVES UP EVENTUALLY')
{
  const e = newEngine()
  // A worker that dies on mount every time must not be respawned forever.
  for (let i = 0; i < 6; i++) {
    const w = built[built.length - 1]
    w.emit('error', { message: `death ${i}` })
  }
  check('restarts are bounded', built.length <= 5, true)
  const r = await settled(e.run(JOB, () => {}).promise)
  check('and past the bound it latches, as it used to', r.ok, false)
  check('saying that retrying did not help', /restarts/.test(r.message), true)
  e.close()
}

console.log('\nCLOSING IS NOT A FAILURE TO RECOVER FROM')
{
  const e = newEngine()
  const before = built.length
  e.close()
  check('close terminates the worker', built[before - 1].dead, true)
  check('and does not spawn a replacement', built.length, before)
  const r = await settled(e.run(JOB, () => {}).promise)
  check('jobs after close fail', r.ok, false)
  check('saying the object was closed', /closed/.test(r.message), true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll engine tests passed\n')
process.exit(failed ? 1 : 0)
