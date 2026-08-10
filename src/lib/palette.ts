// Figure palettes.
//
// A figure that has to be recoloured by hand before submission is a figure the
// studio half-finished, so palette choice is global and the options are the ones
// the journals' own figures use, as distributed in ggsci.

export interface Palette { label: string; cols: string[] }

export const PALETTES = {
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

const hex = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16))

/** Linear RGB blend. `f` is clamped, so callers need not. */
export function mix(a: string, b: string, f: number): string {
  const t = Math.max(0, Math.min(1, f))
  const [r1, g1, b1] = hex(a)
  const [r2, g2, b2] = hex(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`
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

/** Continuous ramp sampled at `f` in [0,1]. */
export function rampColor(f: number, key: RampKey = 'seurat'): string {
  const cols = RAMPS[key].cols
  const x = Math.max(0, Math.min(1, f)) * (cols.length - 1)
  const i = Math.min(cols.length - 2, Math.floor(x))
  return mix(cols[i], cols[i + 1], x - i)
}

/** Five stops, for a CSS gradient preview of a ramp. */
export const rampCss = (key: RampKey): string =>
  `linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(f => rampColor(f, key)).join(',')})`
