// Figure palettes.
//
// A figure that has to be recoloured by hand before submission is a figure the
// studio half-finished, so palette choice is global and the options are the ones
// the journals' own figures use, as distributed in ggsci.

export interface Palette { label: string; cols: string[] }

export const PALETTES = {
  /**
   * The default. Ten colours found by search (not picked by eye) inside the
   * lightness band that works on the light and the dark ground alike, for a
   * scatter, where any two clusters can touch: so every pair is checked, not
   * only neighbours. dataviz's validate_palette.js, --pairs all, on #ffffff
   * and on #111317: every gate passes in both modes; the worst pair under
   * simulated colour-blindness is 7.5 (deutan), 15.4 for full colour vision,
   * and every colour is at least 3:1 on both grounds. 7.5 is inside the band
   * that needs a second cue, which every figure gives (names on the plot, a
   * named legend, the readout). The order is farthest-first, so the first k
   * colours are the best-separated k. docs/DESIGN.md, "Colour in figures".
   */
  studio: {
    label: 'Studio (colour-blind checked)',
    cols: ['#2A97FF', '#C81D01', '#0170A9', '#139D84', '#D47601',
           '#7B4FE0', '#B82189', '#B27CC1', '#1F7225', '#F64A79'],
  },
  npg: {
    label: 'Nature (npg)',
    cols: ['#E64B35', '#4DBBD5', '#00A087', '#3C5488', '#F39B7F',
           '#8491B4', '#91D1C2', '#DC0000', '#7E6148', '#B09C85'],
  },
  aaas: {
    label: 'Science (aaas)',
    cols: ['#3B4992', '#EE0000', '#008B45', '#631879', '#008280',
           '#BB0021', '#5F559B', '#A20056', '#808180', '#1B1919'],
  },
  lancet: {
    label: 'Lancet',
    cols: ['#00468B', '#ED0000', '#42B540', '#0099B4', '#925E9F',
           '#FDAF91', '#AD002A', '#ADB6B6', '#4A6990', '#1B1919'],
  },
  nejm: {
    label: 'NEJM',
    cols: ['#BC3C29', '#0072B5', '#E18727', '#20854E', '#7876B1',
           '#6F99AD', '#E9C46A', '#EE4C97', '#8C564B', '#BCBD22'],
  },
  jco: {
    label: 'JCO',
    cols: ['#0073C2', '#EFC000', '#868686', '#CD534C', '#7AA6DC',
           '#003C67', '#8F7700', '#3B3B3B', '#A73030', '#4A6990'],
  },
  /**
   * Okabe–Ito, the one palette here that is designed for colour vision
   * deficiency rather than for a journal's house style.
   *
   * Every option above is a journal palette, and none of them claims to be
   * distinguishable under deuteranopia or protanopia — several are not: npg
   * opens red against teal, lancet blue against red, jco has three greys.
   * Cluster colour is the primary encoding on every embedding this studio
   * draws, and roughly one man in twelve cannot read those pairs apart.
   *
   * Okabe & Ito 2008, "Color Universal Design", in the published order with
   * black last so the seven saturated hues are used first. Eight, not ten —
   * the set is eight, and padding it with two invented colours would give back
   * exactly the property it exists for. `pal` wraps, so a ninth cluster reuses
   * the first, which is true of every palette here past its own length.
   */
  okabe: {
    label: 'Okabe–Ito (colour-blind safe)',
    cols: ['#E69F00', '#56B4E9', '#009E73', '#F0E442',
           '#0072B2', '#D55E00', '#CC79A7', '#000000'],
  },
} satisfies Record<string, Palette>

/**
 * Continuous scales, in two families, interpolated in RGB through the anchors.
 *
 * TWO-COLOUR first, and the default. A scale a reader can describe in one
 * clause — pale to blue — is one they can read without going back to the bar
 * for every mark, and on a dot plot the reader is judging dozens at a glance.
 * The low end is a light neutral rather than white, because white is the page:
 * a white-low scale cannot distinguish "the lowest value here" from "nothing
 * drawn", and on these figures those are entirely different statements.
 *
 * VIRIDIS after, under SCpubr's own letters — its default is "G", mako, which
 * is the scale its framed bars are showing. All of them run light-to-dark here,
 * because on an expression figure it is the low end that should recede. They
 * are perceptually uniform and safe for colour-vision deficiency, and they are
 * the better choice when a reader has to judge magnitude rather than rank.
 */
export const RAMPS = {
  blue:    { label: 'Two-colour · blue', cols: ['#E8EBF0', '#1B3FA0'] },
  red:     { label: 'Two-colour · red', cols: ['#F0EAEA', '#8B1A1A'] },
  teal:    { label: 'Two-colour · teal', cols: ['#E6EFEE', '#0B4F4A'] },
  purple:  { label: 'Two-colour · purple', cols: ['#EDEAF2', '#4A1D77'] },
  mako:    { label: 'mako · SCpubr default',
             cols: ['#DEF5E5', '#78D6AE', '#38AAAC', '#357BA2', '#40498E', '#2C3142', '#0B0405'] },
  rocket:  { label: 'rocket',
             cols: ['#FAEBDD', '#F7B799', '#F1815C', '#DC4B41', '#AB1E4A', '#6D1D45', '#03051A'] },
  viridis: { label: 'viridis', cols: ['#FDE725', '#7AD151', '#22A884', '#2A788E', '#414487', '#440154'] },
  magma:   { label: 'magma', cols: ['#FCFDBF', '#FE9F6D', '#DE4968', '#8C2981', '#3B0F70', '#000004'] },
  seurat:  { label: 'Seurat · grey → blue', cols: ['#D9DCE3', '#7D8FD6', '#1E40C8'] },
  // Diverging, through a neutral. For a quantity with a meaningful zero — a
  // z-score, a log fold change — where the reader's first question is which
  // side of nothing a value is on. A sequential ramp answers that with a shade
  // and forces a trip to the legend; a diverging one answers it with a hue.
  rdbu:    { label: 'Diverging · blue–white–red',
             cols: ['#2166AC', '#67A9CF', '#D1E5F0', '#F7F7F7', '#FDDBC7', '#EF8A62', '#B2182B'] },
  prgn:    { label: 'Diverging · purple–white–green',
             cols: ['#762A83', '#AF8DC3', '#E7D4E8', '#F7F7F7', '#D9F0D3', '#7FBF7B', '#1B7837'] },
  brbg:    { label: 'Diverging · brown–white–teal',
             cols: ['#8C510A', '#D8B365', '#F6E8C3', '#F5F5F5', '#C7EAE5', '#5AB4AC', '#01665E'] },
} satisfies Record<string, Palette>

export type PaletteKey = keyof typeof PALETTES
export type RampKey = keyof typeof RAMPS

/** The two-colour family, so a menu can group them apart from the maps. */
export const TWO_COLOUR: RampKey[] = ['blue', 'red', 'teal', 'purple']

/** Scales built around a neutral middle, for a quantity with a real zero. */
export const DIVERGING: RampKey[] = ['rdbu', 'prgn', 'brbg']

/** Everything that is not diverging — a scale for a quantity that starts at 0. */
export const SEQUENTIAL: RampKey[] = (Object.keys(RAMPS) as RampKey[])
  .filter(k => !DIVERGING.includes(k))

/**
 * Limits that put zero in the middle — SCpubr's `enforce_symmetry`.
 *
 * A diverging scale only means anything if its neutral sits on the neutral
 * value. Given −0.4 … 3.1 it returns ±3.1, so white is 0 and a red dot is
 * genuinely above zero rather than merely above the middle of whatever range
 * the data happened to span.
 */
export function symmetricRange(lo: number, hi: number): [number, number] {
  const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1
  return [-m, m]
}

const hex = (s: string) => {
  // A colour here is a literal. A custom property (`var(--fig-label)`) cannot
  // be read by arithmetic: it parsed to NaN, and Markers' colour legend was a
  // flat black bar on screen and in every export. Loud, not wrong.
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new TypeError(`a colour to blend must be #rrggbb, got "${s}"`)
  return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16))
}

const blend = (a: number[], b: number[], f: number): number[] => {
  const t = Math.max(0, Math.min(1, f))
  return a.map((x, i) => Math.round(x + (b[i] - x) * t))
}
const css = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`

/** Linear RGB blend. `f` is clamped, so callers need not. */
export function mix(a: string, b: string, f: number): string {
  return css(blend(hex(a), hex(b), f))
}

/**
 * Category colour.
 *
 * Past the end of the palette, hues are generated on the golden angle rather
 * than wrapping round — a 23-arm design otherwise hands arms 1, 11 and 21 the
 * same colour, which the bulk studio shipped once and nobody caught by eye.
 */
export function pal(i: number, key: PaletteKey = 'npg'): string {
  const cols = PALETTES[key].cols
  if (i < cols.length) return cols[i]
  const h = (((i - cols.length) * 137.508) % 360) / 360
  const ch = (n: number) => {
    const k = (n + h * 12) % 12
    const v = 0.58 - 0.34 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return '#' + ch(0) + ch(8) + ch(4)
}

/** The ground a colour is drawn on. A figure is exported on 'light', always. */
export type Ground = 'light' | 'dark'

/**
 * "None of it", on the dark ground: one step above the paper (#111317).
 *
 * Every scale here runs light to dark, because on white it is the low end
 * that should recede. On the dark ground the same colours put the low end,
 * the near-white one, on top: a feature plot's cells with no expression were
 * the brightest thing on the screen. So on the dark ground a scale starts
 * from this grey and gets lighter as the value rises; low recedes on either
 * ground. The file a figure is saved to is always painted for white.
 */
export const ZERO_ON_DARK = '#2B3038'

const sample = (cols: string[], f: number): number[] => {
  const x = Math.max(0, Math.min(1, f)) * (cols.length - 1)
  const i = Math.min(cols.length - 2, Math.floor(x))
  return blend(hex(cols[i]), hex(cols[i + 1]), x - i)
}

/** Continuous ramp sampled at `f` in [0,1], for the ground it is drawn on. */
export function rampColor(f: number, key: RampKey = 'seurat', ground: Ground = 'light'): string {
  const cols = RAMPS[key].cols
  const t = Math.max(0, Math.min(1, f))
  if (ground === 'light') return css(sample(cols, t))
  const zero = hex(ZERO_ON_DARK)
  if (DIVERGING.includes(key)) {
    // The neutral middle is the ground's grey, not white; each side rises to
    // its own hue at a lightness that reads on the dark paper.
    const u = Math.abs(2 * t - 1)
    return css(blend(zero, hex(t < 0.5 ? cols[1] : cols[cols.length - 2]), Math.pow(u, 0.8)))
  }
  // The same colours, read from the other end, leaving the grey gradually.
  return css(blend(sample(cols, (1 - t) * litSpan(key)), zero, Math.pow(1 - t, 3)))
}

const lumOf = (c: number[]): number => {
  const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * How much of a scale is lighter than the dark ground's grey.
 *
 * mako, rocket and magma end in near-black, darker than the paper they would
 * be drawn on: read from that end, the lowest values were holes in the
 * ground and the scale got darker before it got lighter. The part of a scale
 * that is darker than the grey it starts from is left out on the dark ground.
 */
const spans = new Map<RampKey, number>()
function litSpan(key: RampKey): number {
  const known = spans.get(key)
  if (known !== undefined) return known
  const cols = RAMPS[key].cols
  const floor = lumOf(hex(ZERO_ON_DARK)) * 1.15
  let p = 1
  while (p > 0 && lumOf(sample(cols, p)) < floor) p -= 1 / 64
  spans.set(key, p)
  return p
}

/**
 * The ink for a label set ON a filled mark: black or white, whichever reads.
 *
 * The palette sits in a middle band of lightness so that it works on both
 * grounds, which is exactly where neither the light plate nor the dark one is
 * sure to reach 4.5:1 on it (the stacked bars' percentages measured 3.0 to
 * 3.6 on nine fills). Against any colour the contrasts with black and with
 * white multiply to 21, so the better of the two is always at least 4.58.
 */
export function inkOn(fill: string): '#000000' | '#ffffff' {
  const lin = hex(fill).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff'
}

/** Stops for a CSS gradient preview of a ramp, as it is drawn on that ground. */
export const rampCss = (key: RampKey, ground: Ground = 'light'): string =>
  `linear-gradient(90deg,${[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
    .map(f => rampColor(f, key, ground)).join(',')})`
