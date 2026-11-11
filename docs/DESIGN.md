# Studio's interface design

How the studio looks and where things sit. The root [DESIGN.md](../DESIGN.md) is the method (what is computed and
why); this file is the interface, and it is meant to be complete: a screen that is not built yet is built from this
page without guessing. `src/index.css` is the source of every value named here.

**The rule over all of it:** the design changes how things look and where they sit, never what the data says. Every
number is shown as recorded, every label keeps its words, and the Run card infers nothing.

**Status (W037, designer run 1).** Built to this page: the frame, the tokens, the default palette, Cells, Gene
expression, Differential expression, and the rail controls of Composition and Markers. Still in the old shape inside
the new frame (flat sections, their controls in rows above the figure): Co-expression, Gene sets, Enrichment's own
controls, the bodies of Markers and Composition, Overview, Methods, the landing page. "What is left" at the end lists
them in order.

## Direction: the instrument

The standard is the tools people use all day for dense, exact work, not a tidy viewer. Five commitments:

1. **The data is the only loud thing.** The figure sits on the paper (`--surface`), which is the lightest plane in
   both themes. Everything else is one tinted neutral (`--bg`) and hairlines. No cards, no filled plot grounds, no
   boxes inside boxes: a section is a block between hairlines.
2. **The window is the app.** A fixed frame; panes scroll on their own; the page does not scroll at 1,024 px and
   wider. A figure is fitted to the stage in both directions, so nothing is below the fold that could be on screen.
3. **One place per job, the same on every view.** The question on the left (the rail: what to compute, what to
   draw, how). The answer in the middle (the stage). The key on the right (the inspector: what the marks mean, n,
   what is selected). A control is never above a figure.
4. **Ink selects, blue acts.** A chosen thing is ink (an edge, a wash, a thumb). The one accent means "this does
   something" (the primary button, a link, the focus ring) and appears nowhere else.
5. **Nothing decorative, nothing that moves by itself.** No gradients, shadows on the page, icons for their own
   sake, or entrance animation. Press feedback and menu entry only.

## The frame

```
┌ identity bar 40 ─ ▪ scRNA-seq Studio / object name · demo ───────────── Group order · Figure style ┐
├ view bar 36 ─ ◧ Overview Cells Composition │ Markers DE Gene expr. Gene sets Co-expr. │ Methods ─ ◨ ┤
├ rail 232 ────────┬ stage (the paper; fills) ─────────────────────────┬ inspector 240 ─────────────┤
│ the question:    │ head line 40: what is drawn, n · view switch       │ the key: what the colours  │
│ contrast, test,  ├────────────────────────────────────────────────────┤ mean, with n; notes; what  │
│ cutoffs, what to │ the figure, fitted (or a document that scrolls)    │ is selected                │
│ draw and how     ├────────────────────────────────────────────────────┤                            │
│                  │ status line 28: caption · what is isolated         │                            │
└──────────────────┴────────────────────────────────────────────────────┴────────────────────────────┘
```

- `.app` is a grid, `100dvh` tall: the head (`.shell-head`: `.appbar` over `.viewbar`), then `.work` (rail | stage).
  Chrome (`--bg`): both bars, the rail, the inspector. Paper (`--surface`): the stage. Panes meet at 1 px `--line`.
- **Identity bar.** The mark (closes the object), the product name once and quietly, the object's name at 600, the
  demo badge; on the right the two settings that restyle every figure (Group order, Figure style).
- **View bar.** The views as one tablist and one tab stop (arrows, Home, End). Groups (object / analysis /
  document) are divided by a 16 px hairline. The chosen tab is ink with a 2 px rule sitting on the bar's hairline.
  At either end, a pane toggle (`.btn-icon`, `aria-pressed`): the rail on the left, the inspector on the right,
  shown only when the view has that pane. Keys `[` and `]`. State is remembered in `localStorage` (the page works
  without it). Closing a pane gives its width to the figure at once; it does not animate.
- **Rail** (`aside.rail`, 232 px). Every control of the view, in groups (`.rail-group`, 20 px apart, a 600 label
  over its controls). Order: the contrast (cell type, control, vs, Run, the test's status); the gene-set library;
  the embedding; then the view's own groups. A view writes its own groups with `<InRail>` (`components/Rail.tsx`):
  a portal into the rail's slot, so the view keeps the state its controls change; on the server it renders in place,
  so every label is still in the markup the tests read. A view that has groups of its own is named in `OWN_RAIL`
  (`App.tsx`). A view with nothing to choose has no rail and its sections are a centred reading column.
- **Stage** (`main.stage`). Either *fitted* (`data-fit`: no scroll; `.explorer` fills it) or a *document* (scrolls;
  sections `.card` or a `.stage-head` over a `.stage-body`). A section's hairline runs the stage's width; its
  content keeps `--measure` (1,180 px).
- **Inspector** (`aside.inspector`, 240 px, fitted views). Sections divided by hairlines. Closed, the key moves
  into the stage's head line: colour is never left without its key.
- **Widths.** 1,100 px and up: three panes. 1,024 to 1,099: the inspector goes under the figure. Below 1,024 the
  frame lets go: one scrolling column (rail, stage, inspector), the head sticky.
- **Nothing moves when data arrives.** Every pane's size comes from tokens and the window, never from data. A
  fitted figure is measured before paint, so its first frame is its final size.

## Layout, by kind of screen

**Explorer** (Cells; to build the same way: the feature plot, the gene-set score map, the co-expression map).
- Rail: what colours the cells (`.opt` rows), panels (a switch), then view-specific choices.
- Stage: head line = the count at 600 (`34,367 cells`) and what is drawn (`Embedding · X_umap from your file`);
  `.plots` = equal cells divided by hairlines, one per panel, the canvas centred in its cell with its name directly
  above it (`name  n = …`); status line = the caption on the left, the isolated entry and `Show all` on the right.
- Fit: `fitPanels(n, W, H, aspect)` (`lib/fit-panels.ts`) tries every column count and takes the one that draws
  each panel largest at the embedding's own aspect (equal units on both axes); fewer rows win unless another
  layout is more than 15% larger, because compared panels are read side by side. Measured
  panel sizes are in "Checking a change".
- Inspector: the key as rows (swatch, name, n right-aligned in tabular numerals). A row is a button: pressing it
  isolates that entry (its cells in colour on top, the rest in `--line-2` underneath, the other rows dimmed, the
  status line says `Only X: n of N cells`); the row again, Escape or `Show all` undoes it. A continuous colour shows
  `low ▬ high`. Notes about the data (the uncalled cells) are a section under the key.
- The pointer readout (`.tip`) follows the pointer and gives the record's own values.

**Table-led analysis** (Differential expression; to build the same way: Markers, Co-expression, Gene sets,
Enrichment).
- Rail: the question, top to bottom in the order it is asked. DE: Contrast, Test (`.opt` rows, with the test's
  settings as a hint line), Cutoffs (a label and its value on one line, the slider under it at full width; `cut on`
  as a segmented control; Reset; the limits of a cutoff said in a hint under it; `What gets tested`).
- Stage: head line = the view switch (a segmented control: Table / Volcano / Enrichment) and the contrast's name.
  Body = the title (the count: `12 differentially expressed genes`), one sentence, then the table to the bottom
  edge, or the figure. A table's toolbar (filter field on the left, `Significant only`, the row count, CSV on the
  right) is one 24 px row directly over it.
- A first step that has not been taken is an empty state (`.empty`: the instruction as a title, one sentence of
  why), never a warning note. `.note` is only for something about the data that limits a claim.
- Next (not built): the table fills the stage to its bottom edge with its head sticky under the head line, rows
  28 px; the volcano is a fitted view with an inspector (the hovered or pinned gene's row, the legend, Labels).

**Composition** (a chart that is read row by row).
- Rail: `Bars show`, `One row per`, `Limit to`. Stage: a section per figure. Next: bars at a fixed row height
  (24 px, 4 px apart) and the figure at its own width so its type does not grow with the window; the key in an
  inspector with n per entry; the per-type panels as a second section.

**Prose** (Overview, Methods). No controls of their own: a reading column. Sections are hairline blocks; a
section's eyebrow, title and one-line sub sit over its content. Methods prose runs at 68 characters. Stats are a
hairline grid, not boxes. Provenance and the Run card are tables with a fixed first column.

**Landing.** One centred column (560 px): what the studio is in one sentence, the drop target (the only dashed
edge in the app, because it is the only thing you drop onto), the input format as a table, the demos as rows.

## Tokens

Never type a colour, a size, a radius or a shadow at the point of use. A canvas painter reads the same tokens
through `getComputedStyle`.

**Colour.** Light and dark follow the system. Measured by `scripts/measure-design.mjs` on the running app.

| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#f5f6f7` | `#0d0f12` | chrome: bars, rail, inspector, a table's head |
| `--surface` | `#ffffff` | `#111317` | the paper: the stage, a field, a menu |
| `--sunk` | `#eef0f2` | `#1a1d23` | a well of secondary controls inside a section |
| `--line` | `#e2e5e9` | `#24282f` | hairlines between panes, sections and rows |
| `--line-2` | `#cfd4da` | `#343943` | the quiet edge of a control known by its label (button, chip) |
| `--ctl` | `#7f8793` | `#6f7785` | the edge of a control known only by its edge (field, select, switch track): 3:1 or more on every ground |
| `--ink` / `--ink-2` / `--ink-3` | `#15181d` / `#474e5a` / `#626b79` | `#e7e9ec` / `#b0b6c0` / `#8a919d` | primary / secondary / tertiary text; `--ink` is also selection (`--sel`) |
| `--hover` / `--press` | ink at 6% / 10% | same | the wash under a hovered / chosen row; translucent so it reads alike on chrome and paper |
| `--accent` / `--accent-ink` / `--accent-soft` | `#2857d6` / `#1f49b8` / `#e9effd` | `#7ea2ff` / `#a3bdff` / `#17233f` | "act": primary button, link, focus ring, the from-your-file badge |
| `--warn` / `--good` / `--bad` | `#94480a` / `#0b6e4f` / `#b3261e` | `#f0b340` / `#3fcf9a` / `#ff7b72` | status, always with words |
| `--up` / `--down` | `#b3261e` / `#1d5fd0` | `#ff7b72` / `#6ea8ff` | direction of change, as text |

Every text token is at least 4.5:1 on every ground it sits on (the lowest: `--ink-3`, 4.68:1 light and 4.91:1
dark, on `--accent-soft`). `--ctl` is at least 3.18:1 light and 3.74:1 dark. Figure ink (`--fig-*`) is a separate
system: a figure leaves for a white page and is forced to the light values on export.

**Type.** The system face (`system-ui`) and one mono for identifiers that must align (gene symbols in a table, file
names). Numbers are tabular (`.num`), never mono. Five sizes, whole pixels: `--t-micro` 11 (badges, hints under a
control), `--t-small` 12 (labels, tables, legends, status lines, secondary text), `--t-body` 13 (body, controls,
tabs), `--t-title` 15 (a section's title, an empty state's title), `--t-stat` 20 (a stat value only). Three weights:
400 text, 500 the face of a control (never changes on select), 600 the one emphasis (titles, group labels, the
object's name, the count in a head line). Sentence case as written; no uppercase, no tracking.

**Space.** 4 px steps: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32. Pane padding 12; a stage
head's side padding 16; a section 24; groups in the rail 20 apart, controls in a group 8 apart, a label 4 over its
control.

**Control height.** `--h-md` 28 (the rail, buttons, fields); `--h-sm` 24 (a stage head, a table's toolbar, chips,
segments). Controls in one row share one height.

**Radius.** `--r-sm` 4 (swatch, badge, a segment's thumb), `--r-md` 6 (a control, a well, a note), `--r-lg` 8 (a
floating surface). Nothing on the page itself is rounded.

**Elevation.** Two levels: flat (a hairline), and floating (`--shadow-menu`: menus, popovers, the readout).

**Frame.** `--bar-h` 40, `--tabs-h` 36, `--rail-w` 232, `--inspector-w` 240, `--head-h` 40, `--foot-h` 28,
`--measure` 1,180.

## Components

- **Rail controls** (`components/Rail.tsx`). `RailGroup` (a named task). `Opts` (one of many: full-width 28 px
  rows; chosen = `--press` wash, an ink edge on the left, ink text). `Toggle` (on/off: the words flush with the
  labels, a switch at the right edge). `Field` (a label over a full-width control). `Steps` (one of a few numbers:
  a segmented control). Use `Opts`, not a segmented control, when labels are words: three or four do not fit 208 px.
- **Buttons.** `.btn` (an action; 28 px; quiet edge). `.btn-primary` (one per view: Run, Open a bundle).
  `.btn-quiet` (a secondary action at 24 px: Save, CSV, Reset, Clear). `.btn-icon` (a glyph only; always
  `aria-label` and `title`). Press is `scale(0.97)`.
- **Chip** (`.chip`): a toggle among several that can be on together; always `aria-pressed`; on = ink edge, ink
  label, wash. Never an action.
- **Segmented control** (`.seg`): one of a few. A `--press` track and a paper thumb on the chosen one.
- **Field** (`.inp`, `.sel`): paper ground, `--ctl` edge, 28 px; focus = accent edge and a 3 px `--accent-soft` ring.
- **Switch** (`.switch`): 28 × 16; off track `--ctl`, on track ink.
- **Badge** (`.badge-file`, `-here`, `-none`): provenance, 11 px. **Note** (`.note`): a limit on a claim.
- **Empty** (`.empty`): words where the figure will be; no box.
- **Table** (`.t`): 12 px; head on `--bg`, 500, sticky; rows 28 px, hairlines, hover wash; numbers right-aligned
  and tabular; gene symbols mono.
- **Key** (`.lg-row`): keep the markup `<span><i class="sw" style="background:…"></i>name</span>`; the sentinel
  tests read legends by it.
- **Readout** (`.tip`): floats 14 px from the pointer, flips near the right edge, never takes the pointer.
- **Focus.** `:focus-visible` is a 2 px accent ring, offset 1 (inset on tabs).

## Charts

- **Ground.** The plot's ground is the paper. Never a fill, a frame or a rounded corner.
- **Categorical colour.** The default palette is `studio` (`lib/palette.ts`): ten colours found by search (not by
  eye) inside the lightness band that works on both grounds, for a scatter, where any two clusters can touch.
  dataviz `validate_palette.js --pairs all`, on `#ffffff` (light) and `#111317` (dark): every gate passes in both
  modes (band, chroma, contrast 3:1 or more on both grounds); the worst pair under simulated colour-blindness is
  ΔE 7.5 (deutan, pink against teal), 15.4 for full colour vision. 7.5 is in the band that is legal only with a
  second cue, and every figure gives one: names on the plot, a named key with n, the readout, isolate. The first
  nine colours measure 7.6 (green against red); the first two, which two groups get, 31.0 (blue against red). The
  order is farthest-first. The search's best set reached 8.1 on the light ground alone but left the dark band by
  0.001 of lightness on two colours; moving them inside costs the 0.6. Ten colours, all pairs, both grounds: about
  8 is the ceiling. Past ten, colours are generated (as before) and the key is the
  only cue: say so in the key. `npg` and the journal palettes stay as choices in Figure style; `npg` fails four
  gates on nine types (CVD ΔE 4.8, normal 7.5) and Okabe-Ito has eight colours.
- **Magnitude.** One hue, light to dark (the reader's choice in Figure style); z-scores and signed scores on a
  diverging scale with a neutral middle. Never a rainbow.
- **Marks on an embedding.** Radius from the panel and the count: `min(3, max(0.7, (w / 760) · k))` CSS px with
  `k = clamp(0.8, (30,000 / cells)^0.25, 3.4)`, so ink density holds from 240 cells to 300,000 and from 1,280 to
  2,560 px. A 12 px clear margin inside the canvas, so no point is cut by an edge.
- **Names on an embedding.** Sized from the panel (`w / 52`, 11 to 14 px), 600, haloed in the ground colour at a
  little over a quarter of the type's height with round joins. A name that would overlap another is dropped, never
  cut (`lib/canvas-label.ts`); the cluster keeps its colour and its key entry. Panels under 280 px carry no names.
- **Axes.** An embedding names its two dimensions by its key, once per figure (the bottom-left panel). Every other
  axis carries its quantity and unit. Grid lines are `--fig-grid`, behind the data.
- **Small multiples.** One shared range, said in the status line. A panel's name and n sit directly above it.
- **A figure's type does not grow with the window.** An SVG figure is drawn at its own size and at most 1.25 times
  it (the volcano does this); wider than that, the space goes to more panels or stays empty.
- **Legend.** Always names what is plotted and gives n. Text wears ink, never the series colour.
- **Save.** One Save per figure, in the figure's head. (Not built for Cells; the per-panel Save buttons of the
  small multiples stay until each view is rebuilt.)

## States (every panel has all five)

- **Empty** (the reader has not asked yet): `.empty` in the place the figure will take. The instruction is the
  title and names where the control is ("in the controls on the left").
- **Loading**: the determinate bar when the size is known, the sliding bar when it is not, in the figure's own
  place; the frame and the rail do not move. Text says what is running and on how many cells.
- **Error**: what happened, in words; what to do (Try again, or go to a view that cannot be broken by the same
  thing). The boundary takes the view, never the app.
- **No data** (this object cannot answer): say why in one sentence and offer the views that can; the tab is
  disabled with the reason in its title.
- **Large data**: say what was drawn and what was not (names dropped, panels without names, rows cut at N with
  the total), in the status line or under the table.

## Keyboard

Tab order: the mark, Group order, Figure style, the rail toggle, the chosen tab, the inspector toggle, the rail's
controls top to bottom, the stage (a document view is a stop, so the keyboard can scroll it), the key. The views
are one stop and so is the key: arrows move within each (Home and End too, for the views). `[` and `]` toggle the
panes (not while typing in a field). Escape closes a menu, then clears an isolated key entry. Nothing a key
triggers is animated.

## Motion

`--d-press` 140 ms (press, hover, colour), `--d-menu` 170 ms (a menu's entry: opacity and a 3% scale from its
trigger, a transition so a second toggle retargets), `--d-panel` 220 ms (the determinate bar). Ease-out
(`--ease-out`), never ease-in. Panes, tabs and anything from the keyboard do not animate. Under reduced motion,
movement stops and colour changes stay.

## Rejected, and why

- *Cards on a grey page* (run A's surface). Every figure sat in a box in a box and the chrome outweighed the data.
- *A page that scrolls with a figure sized by width* (run A). Split panels were 375 px with a third of the window
  empty; the rail ended mid-page on a long view.
- *A filled plot ground.* It costs every mark contrast and is not what a paper prints.
- *A top toolbar with a docked bottom panel.* Height is the scarce dimension; an embedding is about square.
- *A second, vertical navigation rail for the views.* Two left columns take 450 px from the figure at 1,280.
- *One bar for identity and views.* Nine views and an object's name do not fit 1,440 px.
- *Black-filled chosen states* (segments, chips). Three in a row were the heaviest marks on the screen.
- *Slate and indigo at 14 px with 32 px controls.* It reads as a web page; the work is dense.
- *3:1 edges on everything.* Right for a field (the edge is all there is); loud on a button, which has a label.
- *Changing the layout by itself* (closing the key when the view is split). The reader closes it with one key.
- *A palette picked by eye, or npg kept as the default.* The validator is the judge; npg fails it.
- *A dark-only palette variant.* One set that passes on both grounds keeps a colour's meaning across themes and
  exports; revisit only if a set with a larger margin on dark is wanted.
- *Motion on pane toggles and tab changes.* Used hundreds of times a day; the figure re-fits at once.

## What is left, in order

1. Co-expression and Gene sets: controls into the rail (`Opts` for the four-way choices, `Field` and `Steps` for
   the rest), the result as a table-led stage; their maps as explorers.
2. Enrichment: its collections and options into the rail under Cutoffs; the bar chart at its own size.
3. DE: the table to the stage's bottom edge; the volcano fitted with an inspector; its Labels control into the rail.
4. Markers and Composition bodies: figures at their own size, the key in an inspector, one Save per figure.
5. Gene expression: `Show cells` into the rail's Figure group; the feature plot as an explorer; the violin's y
   axis titled with its quantity and unit.
6. Overview, Methods, the landing page: the prose layout above; stats as a hairline grid.
7. Save for the Cells figure; states audited view by view; the before-and-after gallery.

**Do not get wrong:** `Card` must keep rendering `<section class="card">` (two tests split the page on it); a
view's controls go through `<InRail>`, never by lifting its state into App; the key's swatch markup stays; a new
palette adds one check to the suite by itself (the suite loops over `PALETTES`); never quantise the screenshots (a
256-colour PNG moved one swatch to two different colours in run A's record).

## Checking a change

- `CHROME=<chrome> node scripts/shot-design.mjs <url> docs/design/after` captures every screen at 1,280, 1,440 and
  1,920 px in both themes (synthetic objects only), growing the window to take a whole document view.
- `CHROME=<chrome> AXE=<axe.min.js> node scripts/measure-design.mjs <url>` prints the contrast of every text token
  on every ground, the edges, axe-core's WCAG 2 AA result on Cells and Overview, the tab order, and the scatter's
  interaction time (production build, compared only with a run taken at the same time).
- Panel sizes in a 900 px tall window (canvas, CSS px; `Replicated cohort`, measured on the page):

  | window | one panel | two panels | two panels, both panes closed |
  |---|---|---|---|
  | 1,280 | 784 × 645 | 379 × 312 | 615 × 506 |
  | 1,440 | 887 × 730 | 459 × 378 | 695 × 572 |
  | 1,920 | 887 × 730 | 699 × 575 | 868 × 714 |

  Before W037 the split panels were about 545 px wide at 1,440 (a 1,180 px column); after run A, 375. The time
  course's four panels are 379 × 318 at 1,280 and 400 × 336 from 1,440 up (height-bound, two by two).
