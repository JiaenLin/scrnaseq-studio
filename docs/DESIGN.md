# Studio's interface design

How the studio looks and where things sit. The root [DESIGN.md](../DESIGN.md) is the method (what is computed and
why); this file is the interface. **Status:** the tokens, the shell and the Cells explorer follow it (W037 run A).
The other views still sit in a reading column inside the new shell, each still with its own controls in its card;
[design/AUDIT.md](design/AUDIT.md) lists what is left, in order.

The rule over all of it: the design changes how things look and where they sit, never what the data says. Every
number is shown as recorded, every label keeps its words, and the Run card infers nothing.

## Layout: the plot-first workspace

```
┌ identity bar (48) ─ sc · scRNA-seq Studio / object name · demo ──────── Group order · Figure style ┐
├ view tabs (40) ─ Overview Cells Composition │ Markers DE Gene expression Gene sets Co-expression │ Methods ┤
├ rail (272) ──────┬ stage (fills) ─────────────────────────────────────┬ inspector (296) ──────────┤
│ Contrast         │  figure, sized to the stage                         │ what the colours mean,    │
│ Gene sets        │                                                     │ with n; notes; details of │
│ Embedding        │                                                     │ what is under the pointer │
│ the view's own   │                                                     │                           │
└──────────────────┴─────────────────────────────────────────────────────┴───────────────────────────┘
```

- **Chosen:** a plot-first workspace. A control rail on the left holds every control of the view, grouped by task
  (the contrast; the gene-set library; the embedding; then the view's own). The stage in the middle belongs to the
  figure. An inspector on the right holds what the figure means (legend with counts, notes, the readout).
- **Why.** The studio's work is: choose what to look at, look at it, read what it means, export it. The rail
  matches the first step, the stage the second, the inspector the third. One place per step means a reader learns
  it once for all ten views. The figure gets the width a wide screen has; at 1,920 px the old 1,180 px column left
  740 px empty.
- **Rejected:**
  - *A top toolbar with a docked bottom panel* (an IDE). Height is the scarce dimension on a laptop, and an
    embedding is about square, so a bottom dock takes space from the figure. Kept as an option inside one view (a
    DE table under its volcano), not as the shell.
  - *A tabbed workspace of cards in a centred column* (what the studio was). Controls ended up in three places
    (a bar under the tabs, each card's header, inline above figures), and the figure was a fixed size.
  - *A notebook* (one long scroll). Right for Methods and Overview, which stay as a reading column inside the
    stage. Wrong for exploring, where the controls must stay within reach of the figure.
- **Widths.** 1,280 px and up: three columns. 1,024 to 1,279: the inspector folds under the figure. Below 1,024:
  one column (rail, stage, inspector). A view with nothing to choose (Overview, Composition) has no rail.
- **Nothing moves when data arrives.** Every column's width comes from tokens and the window, never from data. The
  rail is sticky under the head and scrolls on its own.

## Tokens (src/index.css, `:root`; the only source)

Never type a colour, size, radius or shadow at the point of use; ask for a token. A canvas painter reads the same
tokens through `getComputedStyle` (Cells does this).

**Colour.** Light and dark follow the system (`prefers-color-scheme`). Every text token is at least 4.5:1 on every
surface it can sit on, in both themes, measured with `scripts/measure-design.mjs`.

| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#f6f7f9` | `#0b0f19` | the stage behind panels |
| `--surface` | `#ffffff` | `#111827` | head, rail, cards, inspector, menus |
| `--sunk` | `#eef1f5` | `#1a2333` | a plot's ground, panels inside a card, a chosen row |
| `--line` / `--line-2` | `#dfe3ea` / `#c5ccd6` | `#263044` / `#364156` | hairlines / control borders |
| `--ink` | `#0f172a` | `#e5e9f0` | primary text, the selected state (`--sel`) |
| `--ink-2` | `#424e60` | `#aab6c6` | secondary text, labels of values, tabs at rest |
| `--ink-3` | `#5d6b7e` | `#8a97ab` | tertiary text: eyebrows, footnotes (min 4.79:1 light, 5.15:1 dark) |
| `--accent` | `#4f46e5` | `#8b93f8` | "press this": the primary button, links, focus ring |
| `--text-on-accent` | `#ffffff` | `#0b0f19` | text on an accent fill (6.3:1 and 7.0:1) |
| `--warn` / `--good` / `--bad` | `#a14a07` / `#047857` / `#b91c1c` | `#f5b83d` / `#34d399` / `#f87171` | status, always with words |
| `--up` / `--down` | red / blue | lighter pair | direction of change, as text |

Soft fills (`--accent-soft`, `--warn-soft`, `--good-soft`) are opaque in both themes. Figure ink (`--fig-*`) is a
separate system: a figure leaves for a white page and is forced to the light values on export.

**Type.** One family (`system-ui`) plus one mono for identifiers that must align (gene symbols in tables, file
names). Numbers use tabular numerals (`.num`), never mono. Five sizes: `--t-micro` 11 (badges, axis ticks),
`--t-small` 12.5 (labels, secondary text, tables, legends), `--t-body` 14 (body, controls, tabs), `--t-title` 16
(card titles), `--t-stat` 22 (a stat value only). Weights: 400 text, 500 the control face (buttons, tabs, chips,
options; never changes on select), 600 the one emphasis (titles, group labels, the object name). Labels are
sentence case as written in the source; no uppercase transform, no tracking.

**Space.** A 4 px scale, `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 24 · `--s6` 32. Tailwind utilities on
the same steps (`gap-2` = 8). A value off the scale is a defect.

**Control height.** `--h-sm` 28 (chips, segments, small buttons, rail options), `--h-md` 32 (buttons, selects,
inputs). Controls in one row share one height.

**Radius.** `--r-lg` 10 (cards, inspector, dialogs), `--r-md` 6 (controls, panels, menus, plot grounds), `--r-sm` 4
(badges, swatches). A container is rounder than what it holds. Pills (chips, switches) are fully round.

**Elevation.** Two levels only: flat (a 1 px `--line`) for everything on the page, and floating (`--shadow-menu`)
for menus, popovers and the pointer readout.

**Layout.** `--bar-h` 48, `--tabs-h` 40, `--chrome-h` their sum, `--rail-w` 272, `--inspector-w` 296.

## Components

- **Rail.** `aside.rail`, groups `.rail-group` with a `.rail-label` (600, ink) over their controls, 24 px apart. A
  labelled control is `.pick` (label over a full-width control). One-of-many choices are `.opt` rows (chosen = sunk
  fill and an ink edge, never colour alone). An on/off setting is an `.opt.opt-toggle` with a `.switch`. The
  view's one primary action (Run) is a full-width `.btn-primary` at the end of the group it completes.
- **Inspector.** `aside.inspector`, sections `.ins-section` divided by a hairline. A legend is `.lg-row`s: swatch and
  name on the left, the count of cells on the right in `.num`. Keep the swatch markup
  `<span><i class="sw" style="background:…"></i>name</span>`: the sentinel tests read legends by it.
- **Buttons.** One primary per view. `.btn` for actions, `.chip` for a toggle in a card (always `aria-pressed`),
  `.seg` for one-of-few in a card, `.opt` for one-of-many in the rail. Never use a chip for an action.
- **Notes.** `.note` (warn colour) only for something about the data that limits a claim. A first step the reader
  has not taken yet is an empty state, not a warning.
- **Tables.** Sentence-case heads in `--ink-2` 600, numbers right-aligned in `.num`, sticky heads.
- **Readout.** `.tip` follows the pointer, offset 14 px, flips left near the right edge, never takes the pointer.
  It shows the record's own values (the type as named, group, sample, `% mito` to float32 precision).
- **Focus.** `:focus-visible` is a 2 px accent ring, offset 2 (inset on tabs). The view tabs are one tab stop;
  arrows, Home and End move between them.

## Charts

- A figure is sized by the stage, not by a constant. An embedding keeps equal units on both axes (its own
  aspect) and is fitted to the stage's width and the window's height. Backing store at 2× the CSS size, so marks
  and labels keep the sizes the painters were calibrated for.
- Axes are named. An embedding names its two dimensions by the embedding's key (`X_umap 1`, `X_umap 2`); it has
  no units. Other axes carry their quantity and unit.
- A legend names what is plotted and gives n for every entry. A continuous scale shows its ends.
- Categorical colour: run `dataviz`'s `validate_palette.js` on the palette with `--pairs all` for a scatter (any
  two clusters can touch), in both modes. **Open:** the default `npg` fails (worst pair ΔE 4.8 protan; qNSC and
  Endothelial both red at ΔE 7.5 for full colour vision); Okabe–Ito passes CVD but has 8 colours. Run B decides.
- One Save per figure, in the figure's header; a small multiple saves as one figure or from the inspector.

## States (run B designs them for every view)

Empty (what to do next, with the control named where it is), loading (in the figure's own frame, never moving
the frame), error (what happened and what to do), no data (why this object cannot answer), large data (what was
drawn and what was not).

## Motion (run C)

Durations stay within the existing tokens (`--d-press` 140, `--d-menu` 170, `--d-panel` 220 ms), ease-out on
entry, transitions not keyframes, no animation on keyboard navigation, and movement off under reduced motion.

## Checking a change

- `CHROME=<chrome> node scripts/shot-design.mjs <url> docs/design/after` captures every screen at 1,280, 1,440
  and 1,920 px in both themes (synthetic objects only).
- `CHROME=<chrome> AXE=<axe.min.js> node scripts/measure-design.mjs <url>` prints token contrast, axe-core's
  WCAG 2 AA result on Cells and Overview, the tab order, and the scatter's interaction time (production build).
