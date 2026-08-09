// The module score exactly as it was before it moved into the worker, checked
// out of git on demand.
//
// It is NOT kept as a second copy in the tree. A frozen 200-line duplicate of
// score.ts beside score.ts is a thing somebody eventually "fixes", and the day
// it is fixed it stops being a baseline and the proof it exists for becomes a
// tautology. So it is written out of the commit named below, used, and deleted.
//
// BASE is the commit that last held the single-threaded implementation. If the
// history is ever rewritten this must be repointed, and the failure is loud —
// `git show` errors rather than quietly comparing something to itself.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const BASE = '0312473'
const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '.score-baseline.generated.ts')

/**
 * Write the old implementation somewhere its relative imports still resolve,
 * and hand back a module.
 */
export async function loadBaseline() {
  const src = execFileSync('git', ['show', `${BASE}:src/lib/score.ts`], {
    cwd: path.join(here, '..'), encoding: 'utf8', maxBuffer: 1 << 24,
  })
  if (!/export function moduleScore\b/.test(src)) {
    throw new Error(`${BASE}:src/lib/score.ts does not look like the baseline`)
  }
  fs.writeFileSync(out, src
    .replace("from './source.ts'", "from '../src/lib/source.ts'")
    .replace("from './demo.ts'", "from '../src/lib/demo.ts'"))
  process.on('exit', () => { try { fs.unlinkSync(out) } catch { /* already gone */ } })
  return import(`./${path.basename(out)}?t=${Date.now()}`)
}
