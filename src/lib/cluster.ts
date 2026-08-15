// Hierarchical clustering, for ordering the rows and columns of a matrix figure.
//
// A dot plot or heatmap drawn in the order the object happens to store its
// clusters is a figure the reader has to sort by eye. Every published version of
// this figure — Seurat's DoHeatmap, scanpy's rank_genes_groups_dotplot, the
// pheatmap output people paste into papers — is clustered on both axes, because
// the point of the figure is which populations resemble each other and that is
// exactly what the ordering encodes.
//
// Average linkage (UPGMA) over correlation distance, which is what pheatmap and
// ComplexHeatmap default to for expression. Correlation rather than Euclidean
// because the question is "does this cluster have the same PROFILE across
// genes", not "the same magnitude" — two populations expressing the same
// programme at different depths should sit together, and Euclidean distance
// separates them by library size.

export interface Dendro {
  /** Leaf order, as indices into the input rows. */
  order: number[]
  /** Every merge, in the order they happened. */
  merges: Merge[]
  /** Height of the tallest merge, for scaling the drawing. */
  height: number
}

export interface Merge {
  /** The two nodes joined: an index < n is a leaf, otherwise merge n-… */
  a: number
  b: number
  /** Distance at which they joined. */
  height: number
  /** Leaves under this node, in order. */
  leaves: number[]
}

/**
 * 1 − Pearson correlation, over a matrix given as rows of equal length.
 *
 * A row with no variance has no correlation with anything — every published
 * implementation has to decide what to do with it, and returning the maximum
 * distance is the honest answer: a cell type expressing nothing in the panel
 * genuinely resembles nothing in it, and putting it at the edge of the figure
 * rather than beside an arbitrary neighbour is what a reader should see.
 */
export function correlationDistance(rows: readonly number[][]): number[][] {
  const n = rows.length
  const m = rows[0]?.length ?? 0
  const mean = rows.map(r => r.reduce((a, b) => a + b, 0) / (m || 1))
  const sd = rows.map((r, i) => {
    let ss = 0
    for (const v of r) ss += (v - mean[i]) ** 2
    return Math.sqrt(ss)
  })
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dot = 0
      for (let k = 0; k < m; k++) dot += (rows[i][k] - mean[i]) * (rows[j][k] - mean[j])
      const denom = sd[i] * sd[j]
      // 2 is the maximum of 1 − r, reached at r = −1; a flat row gets it too.
      const dist = denom > 1e-12 ? 1 - dot / denom : 2
      d[i][j] = dist
      d[j][i] = dist
    }
  }
  return d
}

/** Straight Euclidean distance, for matrices where magnitude is the point. */
export function euclideanDistance(rows: readonly number[][]): number[][] {
  const n = rows.length
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let ss = 0
      for (let k = 0; k < rows[i].length; k++) ss += (rows[i][k] - rows[j][k]) ** 2
      const dist = Math.sqrt(ss)
      d[i][j] = dist
      d[j][i] = dist
    }
  }
  return d
}

/**
 * Average-linkage agglomerative clustering over a distance matrix.
 *
 * O(n³) by the naive route, which is the right trade here: this runs over cell
 * types and genes — tens of rows, a few hundred at the very worst — not over
 * cells. A nearest-neighbour-chain implementation would be faster and much
 * harder to check, and the thing that matters about this function is that its
 * answer is right.
 *
 * At each step the closest pair merges, and the merged node's distance to every
 * other is the SIZE-WEIGHTED mean of its two children's — that weighting is
 * what makes it UPGMA rather than WPGMA, and it is the one detail that is easy
 * to get wrong and impossible to see in the output.
 */
export function hclust(dist: number[][]): Dendro {
  const n = dist.length
  if (n === 0) return { order: [], merges: [], height: 0 }
  if (n === 1) return { order: [0], merges: [], height: 0 }

  // Working copy, so the caller's matrix is not consumed.
  const d = dist.map(row => [...row])
  const active: number[] = []
  const size: number[] = []
  const leavesOf = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    active.push(i)
    size.push(1)
    leavesOf.set(i, [i])
  }

  const merges: Merge[] = []
  let next = n
  let height = 0

  while (active.length > 1) {
    let best = Infinity, bi = 0, bj = 1
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const v = d[active[x]][active[y]]
        if (v < best) { best = v; bi = x; bj = y }
      }
    }
    const a = active[bi], b = active[bj]
    const la = leavesOf.get(a) ?? [], lb = leavesOf.get(b) ?? []

    /**
     * Which child goes on the left.
     *
     * The tighter cluster first, so a big diffuse group does not push a small
     * distinct one into the middle of the figure. Any consistent rule gives a
     * valid dendrogram — this one keeps related things adjacent, which is what
     * the ordering is for.
     */
    const flip = la.length > lb.length
    const leaves = flip ? [...lb, ...la] : [...la, ...lb]

    height = Math.max(height, best)
    merges.push({ a, b, height: best, leaves })
    leavesOf.set(next, leaves)
    size[next] = size[a] + size[b]

    // The new node's distance to everything still active: the mean of its
    // children's, weighted by how many leaves each carries.
    d[next] = []
    for (const other of active) {
      if (other === a || other === b) continue
      const v = (size[a] * d[a][other] + size[b] * d[b][other]) / (size[a] + size[b])
      d[next][other] = v
      d[other][next] = v
    }
    active.splice(bj, 1)
    active.splice(bi, 1)
    active.push(next)
    next++
  }

  return { order: leavesOf.get(next - 1) ?? [], merges, height }
}

/** Rows clustered and ordered in one call. `null` when there is nothing to do. */
export function orderRows(
  rows: readonly number[][],
  metric: 'correlation' | 'euclidean' = 'correlation',
): Dendro | null {
  if (rows.length < 3) return null
  const d = metric === 'euclidean' ? euclideanDistance(rows) : correlationDistance(rows)
  return hclust(d)
}

/**
 * The dendrogram as line segments, in a box `span` long and `depth` deep.
 *
 * `span` runs along the axis the leaves sit on and `depth` away from it, so one
 * function draws both the tree above the columns and the one beside the rows —
 * the caller swaps x and y. Positions are returned in leaf-slot units: slot i is
 * at `(i + 0.5) * span / leaves`, which is where a column's centre is.
 */
export function dendroLines(
  tree: Dendro, span: number, depth: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const n = tree.order.length
  if (n < 2 || !tree.merges.length) return []
  const slotOf = new Map<number, number>()
  tree.order.forEach((leaf, i) => slotOf.set(leaf, i))

  // Where each node sits along the axis: a leaf at its slot, an internal node
  // at the midpoint of the two it joined.
  const pos = new Map<number, number>()
  const at = new Map<number, number>()
  for (const [leaf, i] of slotOf) {
    pos.set(leaf, ((i + 0.5) * span) / n)
    at.set(leaf, 0)
  }
  const out: { x1: number; y1: number; x2: number; y2: number }[] = []
  const scale = tree.height > 0 ? depth / tree.height : 0
  let next = n

  for (const m of tree.merges) {
    const pa = pos.get(m.a) ?? 0, pb = pos.get(m.b) ?? 0
    const ha = at.get(m.a) ?? 0, hb = at.get(m.b) ?? 0
    const h = m.height * scale
    // Two uprights and the crossbar joining them — the shape every dendrogram
    // is drawn as, and the reason the height axis has to be shared.
    out.push({ x1: pa, y1: ha, x2: pa, y2: h })
    out.push({ x1: pb, y1: hb, x2: pb, y2: h })
    out.push({ x1: pa, y1: h, x2: pb, y2: h })
    pos.set(next, (pa + pb) / 2)
    at.set(next, h)
    next++
  }
  return out
}
