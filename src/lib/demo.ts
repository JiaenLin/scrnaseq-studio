// The demo objects.
//
// Until the h5ad/rds readers land this module stands in for a real file, in
// exactly the shape the reader will produce: cells carrying obs columns, an
// embedding, and a gene-major expression lookup.
//
// Three shapes are provided on purpose. A replicated cohort is the easy case; a
// time course with one sample per point and a single wild-type object are the
// ones that break an interface built only for the easy case, and both are common.

import type { Cell, CellType, Dataset, DatasetSpec } from '../types.ts'

/* ---------- deterministic randomness ---------- */

/** mulberry32 — seeded, so the demo object is identical on every reload. */
export function rng(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Deterministic uniform in [0,1) for an (integer, integer) pair.
 *
 * Used to give every (gene, cell) its own value: seeding per cell alone would
 * make every feature plot share one dropout mask, which looks obviously fake.
 */
export function hashU(a: number, b: number): number {
  let x = (a ^ Math.imul(b | 0, 2654435761)) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 2246822507)
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

/* ---------- clusters ---------- */

const RAW_TYPES: Omit<CellType, 'key'>[] = [
  { name: 'qNSC',            cx: -3.6, cy:  2.6, sd: 0.85, base: 2680, resp: -0.52, mk: ['Gfap', 'Aqp4', 'Id3', 'Hopx', 'Thbs4'] },
  { name: 'aNSC',            cx: -1.5, cy:  3.4, sd: 0.62, base:  560, resp:  1.75, mk: ['Ascl1', 'Egfr', 'Ccnd2', 'Mcm2', 'Sox2'] },
  { name: 'TAP',             cx:  0.6, cy:  2.7, sd: 0.70, base:  640, resp:  2.10, mk: ['Mki67', 'Top2a', 'Cenpf', 'Ube2c', 'Ccnb1'] },
  { name: 'Neuroblast',      cx:  2.7, cy:  1.2, sd: 1.05, base: 2100, resp:  0.53, mk: ['Dcx', 'Dlx2', 'Sp8', 'Nrxn3', 'Tubb3'] },
  { name: 'Astrocyte',       cx: -4.2, cy: -1.4, sd: 0.95, base: 1760, resp: -0.06, mk: ['Slc1a3', 'Agt', 'Mt1', 'Ntsr2', 'Clu'] },
  { name: 'Oligodendrocyte', cx: -0.8, cy: -3.2, sd: 0.90, base: 1470, resp: -0.03, mk: ['Plp1', 'Mbp', 'Mog', 'Cnp', 'Sox10'] },
  { name: 'Microglia',       cx:  3.4, cy: -2.9, sd: 0.72, base: 1210, resp: -0.03, mk: ['Cx3cr1', 'C1qa', 'Ctss', 'P2ry12', 'Hexb'] },
  { name: 'Endothelial',     cx:  5.2, cy: -0.4, sd: 0.58, base:  740, resp: -0.04, mk: ['Cldn5', 'Pecam1', 'Flt1', 'Rgs5', 'Ly6c1'] },
  // Deliberately rare: a real object always has one population too thin to test,
  // and the statistics gate has to be reachable in the demo.
  { name: 'Pericyte',        cx:  4.6, cy:  2.2, sd: 0.34, base:   30, resp: -0.30, mk: ['Pdgfrb', 'Kcnj8', 'Anpep', 'Vtn', 'Higd1b'] },
]

/** Fresh cluster list. `key` is the identity results attach to; `name` is display only. */
export const makeTypes = (): CellType[] => RAW_TYPES.map(t => ({ ...t, key: t.name }))

/* ---------- genes ---------- */

export const HOUSE = ['Actb', 'Gapdh', 'Rpl13a', 'Hprt', 'Tbp', 'B2m']

// Near-miss names (Sox2 / Sox21 / Sox11 / Sox10 / Sox9) are here so that
// exact-match-ranks-first is something you can check rather than assert.
const EXTRA = ['Nes', 'Vim', 'Ccnd1', 'Cdk1', 'Pcna', 'Mcm5', 'Sox11', 'Sox9', 'Sox21',
               'Ascl2', 'Notch1', 'Hes1', 'Hes5', 'Cdkn1a', 'Cdkn1b', 'Nr4a2', 'Egr1',
               'Fos', 'Jun', 'Sparcl1', 'S100b']

export const GENES: string[] =
  [...new Set([...RAW_TYPES.flatMap(t => t.mk), ...HOUSE, ...EXTRA])].sort()

/** Genes reported in the file header; only GENES have simulated values. */
export const N_GENES = 18412

/** gene -> [cluster index, rank within that cluster's markers] */
export const MARKER_OF: Record<string, [number, number]> = {}
RAW_TYPES.forEach((t, ti) => t.mk.forEach((g, r) => { MARKER_OF[g] = [ti, r] }))

/** log2 change per unit of activation; anything unlisted is flat. */
export const RESP: Record<string, number> = {
  Ascl1: 2.94, Egfr: 2.61, Ccnd2: 2.08, Mcm2: 1.87, Sox2: 1.12, Mki67: 1.71,
  Top2a: 2.42, Cenpf: 1.96, Ube2c: 1.74, Ccnb1: 1.52, Pcna: 1.58, Mcm5: 1.44,
  Cdk1: 1.81, Ccnd1: 1.19, Nes: 0.86, Vim: 0.98, Sox11: 1.02, Ascl2: 0.44,
  Egr1: 0.71, Fos: 0.64, Jun: 0.52,
  Gfap: -1.58, Aqp4: -1.31, Id3: -2.35, Hopx: -2.02, Thbs4: -1.94, Clu: -0.87,
  Sparcl1: -0.79, S100b: -1.04, Notch1: -0.68, Hes1: -1.11, Hes5: -1.28,
  Cdkn1a: -1.22, Cdkn1b: -0.91, Sox9: -0.58, Nr4a2: -0.74,
  Dcx: 1.34, Dlx2: 1.24, Sp8: 1.05, Nrxn3: 1.11, Tubb3: 0.92,
}

/** Mean normalized expression of a gene in one cluster at activation `a`. */
export function meanExpr(g: string, ti: number, a: number): number {
  let m: number
  if (HOUSE.includes(g)) m = 2.9 + (hash(g) % 7) / 10
  else if (MARKER_OF[g]?.[0] === ti) m = 2.85 - MARKER_OF[g][1] * 0.26
  else if (MARKER_OF[g]) m = 0.08 + (hash(g) % 5) / 60
  else m = 0.3 + (hash(g) % 9) / 22
  return Math.max(0.02, m * Math.pow(2, (RESP[g] ?? 0) * a * 0.45))
}

/** One cell's value for one gene: zero-inflated around the cluster mean. */
export function cellExpr(geneHash: number, cellIndex: number, mean: number): number {
  const u = hashU(geneHash, cellIndex)
  if (u < Math.exp(-mean * 1.15)) return 0
  return mean * (0.35 + hashU(geneHash ^ 0x9e3779b9, cellIndex) * 1.5)
}

/** Fraction of cells detecting a gene, from its mean. */
export const pctFromMean = (m: number): number => Math.min(0.99, 1 - Math.exp(-m * 1.15))

/* ---------- datasets ---------- */

export const DATASETS: Record<string, DatasetSpec> = {
  cohort: {
    label: 'Adult SVZ neural stem cell reactivation — quiescent vs reactivated, 8 animals',
    file: 'SVZ_NSC_reactivation_harmony_leiden.h5ad · 1.4 GB · AnnData 0.10.8',
    conds: ['Quiescent', 'Reactivated'],
    act: { Quiescent: 0, Reactivated: 1 },
    samples: [
      ...[1, 2, 3, 4].map(i => ({ id: `SVZ_Q${i}`, cond: 'Quiescent' })),
      ...[1, 2, 3, 4].map(i => ({ id: `SVZ_R${i}`, cond: 'Reactivated' })),
    ],
  },
  course: {
    label: 'SVZ reactivation time course after AraC ablation — 0, 6, 24 and 72 hours',
    file: 'SVZ_timecourse_4tp.h5ad · 0.8 GB · AnnData 0.10.8',
    conds: ['0 h', '6 h', '24 h', '72 h'],
    act: { '0 h': 0, '6 h': 0.35, '24 h': 0.78, '72 h': 1 },
    samples: [
      { id: 'TC_0h', cond: '0 h' }, { id: 'TC_6h', cond: '6 h' },
      { id: 'TC_24h', cond: '24 h' }, { id: 'TC_72h', cond: '72 h' },
    ],
  },
  wt: {
    label: 'Adult SVZ wild-type reference — single animal, no comparison',
    file: 'SVZ_WT_reference.h5ad · 0.4 GB · AnnData 0.10.8',
    conds: ['Wild type'],
    act: { 'Wild type': 0 },
    samples: [{ id: 'SVZ_WT', cond: 'Wild type' }],
  },
}

export type DatasetKey = keyof typeof DATASETS

export function buildDataset(key: string, types: CellType[]): Dataset {
  const spec = DATASETS[key] ?? DATASETS.cohort
  const { conds, samples } = spec
  const R = rng(20260801)
  const gauss = () => {
    let u = 0, v = 0
    while (!u) u = R()
    while (!v) v = R()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  // Per-animal capture efficiency per cluster. Real datasets never split evenly,
  // and that between-animal spread is what the composition panel exists to show.
  const cap: Record<string, number> = {}
  types.forEach((_, ti) => samples.forEach(s => { cap[`${ti}|${s.id}`] = 0.55 + R() * 0.9 }))

  const cells: Cell[] = []
  types.forEach((t, ti) => {
    conds.forEach(cond => {
      const a = spec.act[cond]
      const pool = samples.filter(s => s.cond === cond)
      const total = Math.round((t.base * Math.pow(2, t.resp * a) * pool.length) / 3)
      const w = pool.map(s => cap[`${ti}|${s.id}`])
      const sum = w.reduce((x, y) => x + y, 0)
      const per = w.map(x => Math.round((total * x) / sum))
      per[per.length - 1] += total - per.reduce((x, y) => x + y, 0)
      const dx = a * 0.45, dy = a * -0.12
      pool.forEach((s, pi) => {
        for (let k = 0; k < per[pi]; k++) {
          const depth = 900 + Math.exp(1.15 + 0.55 * gauss()) * 1400
          cells.push({
            t: ti, s: s.id, cond, a,
            x: t.cx + dx + gauss() * t.sd,
            y: t.cy + dy + gauss() * t.sd,
            counts: Math.round(depth),
            genes: Math.round(Math.min(depth * 0.42, 900 + depth * 0.18) + gauss() * 120),
            mito: Math.max(0.2, (ti === 4 ? 4.4 : 2.9) + gauss() * 1.5),
          })
        }
      })
    })
  })

  const grid = types.map((_, ti) =>
    samples.map(s => cells.reduce((n, c) => n + (c.t === ti && c.s === s.id ? 1 : 0), 0)))
  const prop = samples.map((_, si) => {
    const tot = types.reduce((a, _t, ti) => a + grid[ti][si], 0) || 1
    return types.map((_t, ti) => grid[ti][si] / tot)
  })
  const nPerCond: Record<string, number> = {}
  conds.forEach(c => { nPerCond[c] = cells.reduce((n, x) => n + (x.cond === c ? 1 : 0), 0) })

  return {
    ...spec, key, cells, grid, prop, nPerCond,
    nCells: cells.length, multi: conds.length > 1,
  }
}
