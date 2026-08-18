// The order the groups are drawn in.
//
// A group's order in the object is the order the exporter wrote its categorical
// levels in, and that is the right default: `young_chow, young_hfd, old_chow,
// old_hfd` is a design, and sorting it alphabetically would destroy it. But it
// is not always the order the reader wants on the page — a control that was
// added to the object last still has to sit first on the axis, and a time
// course exported out of order is a figure that reads backwards.
//
// So the order is a VIEW setting, held in App beside the palette, and applied
// by rewriting one field: `Dataset.conds`. Everything downstream reads its
// groups from that array — the identity axis (chart.ts), the split panels
// (Cells, FeaturePlot), the composition table, the heatmaps — so one rewrite
// moves every figure at once and nothing else has to know this exists.
//
// Nothing is recomputed and no statistic moves. A group is identified by its
// NAME everywhere below `Source`, never by its position: `src.group(ti, cond)`
// takes the name, `d.cells[i].cond` holds the name, and the pseudobulk design
// is built from `samples[].cond`. That is what makes this safe to do by
// permuting one array — and it is why this file permutes that array rather
// than touching the cells.

import type { Source } from './source.ts'

/**
 * `all`, reordered to follow `order`.
 *
 * Names in `order` that this object does not have are ignored, and names the
 * object has that `order` does not mention keep their own relative order at the
 * end — so an order carried over from a different object degrades to "the ones
 * I recognise first", never to a group silently disappearing from the axis.
 *
 * Returns the ORIGINAL array when the result would equal it, so a source that
 * is not reordered stays referentially identical and every memo keyed on it
 * holds.
 */
export function orderedBy(all: readonly string[], order: readonly string[]): string[] {
  if (!order.length) return all as string[]
  const rank = new Map<string, number>()
  order.forEach((name, i) => { if (!rank.has(name)) rank.set(name, i) })
  const out = all
    .map((name, i) => ({ name, i, r: rank.get(name) ?? Infinity }))
    // Stable on the object's own order within each band, so the groups the
    // reader has not placed keep the arrangement the file gave them.
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.name)
  return out.every((name, i) => name === all[i]) ? (all as string[]) : out
}

/**
 * The same source with its groups in the reader's order.
 *
 * A shallow copy of the Source and of its Dataset — every accessor on it is a
 * closure over the values, not over `d.conds`, so they answer exactly as they
 * did. The copy matters for the caches keyed on `d` by identity (chart.ts holds
 * cells-by-sample in a WeakMap, several views memoise on `d`): a new `d` for a
 * new order is correct, and returning the SAME object when the order has not
 * changed is what keeps those caches from being rebuilt on every render.
 */
export function withCondOrder(src: Source, order: readonly string[]): Source {
  const conds = orderedBy(src.d.conds, order)
  if (conds === src.d.conds) return src
  return { ...src, d: { ...src.d, conds } }
}

/** `list` with the item at `from` moved to `to`. Out-of-range moves are no-ops. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list as T[]
  }
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}
