// Putting the parts' categories back together.
//
// A part is written with the levels it actually uses and no others, so its
// codes are dense: part A's cluster 0 may be "Radial glia" while part B's
// cluster 0 is "Blood". Concatenating the code arrays without remapping would
// relabel a third of the atlas and every figure would still render — which is
// why this is the one step in the whole reader that is tested on its own.
//
// The union also has to be ORDERED, not just correct. Cluster order picks the
// colours and fills the cell-type menu; condition order is worse, because for a
// developmental object the groups are e7.0 … e18.0 and a shuffled list makes
// "control vs compare" read as nonsense. Each part's list is a subsequence of
// the original object's, so the original order can be recovered: treat every
// consecutive pair as "this came before that" and sort the result.
//
// Some pairs get no such evidence. Split an object by donor and every part
// holds one timepoint, so no part ever says e8.0 comes before e8.5 — the
// original order is simply not in the file any more. Those ties are broken the
// way a person sorts a list, digits compared as numbers, which puts e7.0, e8.0,
// e8.5, e10.0 in the order they were collected in rather than in the order the
// lab happened to emit the parts. It is a guess, but a stable and legible one;
// wherever any part does order two levels, that evidence wins over it.

/**
 * Compare two level names the way a person would sort them.
 *
 * Digit runs compare as numbers, so e10.0 lands after e8.5 rather than between
 * e1 and e2. Intl.Collator with numeric ordering is exactly this and is in every
 * browser; the tie-break on the raw string keeps the result total.
 */
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const byName = (a: string, b: string) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)

export interface LevelUnion {
  /** The merged level names. */
  levels: string[]
  /** maps[p][localCode] -> index into `levels`. */
  maps: Int32Array[]
}

/**
 * Merge each part's levels into one list.
 *
 * `known` is the order the whole object had, when the writer recorded it. Use
 * it and there is nothing to infer: the union is that list, restricted to what
 * the parts actually carry, so a cell type keeps the colour it had unsplit.
 * Without it the order is reconstructed from the parts, which is a guess — a
 * good one, but a guess, and a wrong guess repaints every cluster.
 */
export function unionLevels(perPart: string[][], known?: string[]): LevelUnion {
  if (known?.length) {
    const present = new Set<string>()
    for (const part of perPart) for (const name of part) present.add(name)
    const levels = known.filter(name => present.has(name))
    // Anything a part has that the recorded order does not mention still has to
    // appear; dropping a level would drop its cells.
    for (const name of present) if (!levels.includes(name)) levels.push(name)
    const at = new Map(levels.map((name, i) => [name, i]))
    return {
      levels,
      maps: perPart.map(part => Int32Array.from(part, name => at.get(name) ?? -1)),
    }
  }
  return inferLevels(perPart)
}

function inferLevels(perPart: string[][]): LevelUnion {
  const index = new Map<string, number>()   // name -> first-appearance rank
  for (const part of perPart) {
    for (const name of part) if (!index.has(name)) index.set(name, index.size)
  }
  const names = [...index.keys()]
  const n = names.length

  // after[a] = the levels some part places directly after a.
  const after: Set<number>[] = names.map(() => new Set())
  const indeg = new Int32Array(n)
  for (const part of perPart) {
    for (let i = 0; i + 1 < part.length; i++) {
      const a = index.get(part[i])!
      const b = index.get(part[i + 1])!
      if (a === b || after[a].has(b)) continue
      after[a].add(b)
      indeg[b]++
    }
  }

  // Kahn's algorithm. Among the levels nothing orders, take them by name — the
  // result is then the same whatever order the parts arrive in, which matters
  // because the lab emits them largest-first, not object-order.
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i)
  const order: number[] = []
  const placed = new Uint8Array(n)
  while (ready.length) {
    ready.sort((a, b) => byName(names[a], names[b]))
    const k = ready.shift()!
    order.push(k)
    placed[k] = 1
    for (const j of after[k]) if (--indeg[j] === 0) ready.push(j)
  }
  // A cycle means two parts disagree about the order (possible if the object's
  // categories were not a single ordered list). Nothing is dropped: the rest go
  // on the end in first-appearance order, which is still every level, once.
  for (let i = 0; i < n; i++) if (!placed[i]) order.push(i)

  const rank = new Int32Array(n)
  order.forEach((orig, at) => { rank[orig] = at })
  const levels = order.map(i => names[i])

  const maps = perPart.map(part => {
    const m = new Int32Array(part.length)
    for (let i = 0; i < part.length; i++) m[i] = rank[index.get(part[i])!]
    return m
  })
  return { levels, maps }
}
