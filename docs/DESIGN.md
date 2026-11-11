# Studio's interface design

How the studio looks and where things sit. The root [DESIGN.md](../DESIGN.md) is the method (what is computed and
why); this file is the interface, and it is meant to be complete: a screen that is not built yet is built from this
page without guessing. `src/index.css` is the source of every value named here.

**The rule over all of it:** the design changes how things look and where they sit, never what the data says. Every
number is shown as recorded, every label keeps its words, and the Run card infers nothing.

**Status (W037, designer run 3).** Every screen is built to this page. Run 3 closed an independent design review of
run 2 (thirteen faults that had to go, then the rest in order): Save writes the figure on every path, in print ink on
white from either theme; the dark theme reaches canvases, scales and exports; every figure is drawn at the width it
has, one to one, so nothing is cut at 1,280 px and no figure text is under 10 px; the DE table works by keyboard.
"What is left" at the end lists the rest in order. `docs/design/gallery.html` shows every screen before W037 and now.

**Designer run 4** closed a second review, which found no screen broken and three things wrong with figures: a name
cut inside a word, saved figures that did not stand alone, and a stated width that was true at one window only. The
rules it added are under Charts: *Names under an axis*, *A saved figure's foot* and *Save* (the print scale).

**Designer run 5 (W051)** was a pass over every word and every element, measured first. `scripts/inventory-design.mjs`
walks the built app (153 states) and `scripts/inventory-report.mjs` writes [design/COPY.md](design/COPY.md) (the copy
deck, with every changed string before and after) and [design/ELEMENTS.md](design/ELEMENTS.md) (every control's box
and states). The standard it was brought to is **Words**, below; `scripts/test-copy.mjs` holds it in `npm test`. No
screen was redesigned, and no number, label's meaning or Run-card field changed.

## Direction: the instrument

The standard is the tools people use all day for dense, exact work, not a tidy viewer. Five commitments:

1. **The data is the only loud thing.** The figure sits on the paper (`--surface`), which is the lightest plane in
   both themes. Everything else is one tinted neutral (`--bg`) and hairlines. No cards, no filled plot grounds, no
   boxes inside boxes: a section is a block between hairlines.
2. **The window is the app.** A fixed frame; panes scroll on their own; the page does not scroll at 1,024 px and
   wider. A figure is fitted to the stage in both directions, so nothing is below the fold that could be on screen.
3. **One place per job, the same on every view.** The question on the left (the rail: what to compute, what to
   draw, how). The answer in the middle (the stage). The key on the right (the inspector: what the marks mean, n,
   what is selected). A control is never above a figure. The actions on a figure or a table (Save, CSV) are at
   the right end of the head line over it, on every view.
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
  At either end, a pane toggle (`.btn-icon`, `aria-pressed`): the rail on the left, the inspector on the right
  (Cells, and the volcano, whose key pane closes the same way). The right one is shown only when the view has that
  pane; the left one's place is always kept (`.btn-icon-slot` on a view with no rail), so the tabs start at the same
  x on every view (they started 32 px further left on Overview and jumped on the first click). Keys `[` and `]`. State is remembered in `localStorage` (the page works
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
  frame lets go: one scrolling column (rail, stage, inspector), the head sticky. A filled view (`.fill`) lets go
  with it: its panes become blocks, in reading order (the list, then the result; the figure, its caption, then
  the key), and a list keeps 40% of the window's height. Looked at 900 px and at 2,560 px (a sentence keeps
  its measure; a fitted figure stops at 1.25 times its own size and the rest stays paper).
- **Nothing moves when data arrives.** Every pane's size comes from tokens and the window, never from data. A
  fitted figure is measured before paint, so its first frame is its final size.

## Layout, by kind of screen

**Explorer** (Cells; to build the same way: the feature plot, the gene-set score map, the co-expression map).
- Rail: what colours the cells (`.opt` rows), panels (a switch), then view-specific choices.
- Stage: head line = the count at 600 (`34,367 cells`) and what is drawn (`Embedding · X_umap from your file`);
  `.plots` = equal cells divided by hairlines, one per panel. The painter lists the theme among its inputs
  (`useDark`, `lib/theme.ts`), so a system theme switch repaints the canvases at once. Several panels: each block (its name `name  n = …`,
  then its plot) hangs from the top of its cell, centred across, so the names run on one line under the head
  line and the slack is under the plots; one panel has no name and is centred both ways. Status line = the
  caption on the left, the isolated entry and `Show all` on the right. Save at the head line's right end.
- Fit: `fitPanels(n, W, H, aspect)` (`lib/fit-panels.ts`) tries every column count and takes the one that draws
  each panel largest at the embedding's own aspect (equal units on both axes); fewer rows win unless another
  layout is more than 15% larger, because compared panels are read side by side. Measured
  panel sizes are in "Checking a change".
- Inspector: the key as rows (swatch, name, n right-aligned in tabular numerals). A row is a button: pressing it
  isolates that entry (its cells in colour on top, the rest in `--line-2` underneath, the other rows dimmed, the
  status line says `Only X: n of N cells`); the row again, Escape or `Show all` undoes it. A continuous colour shows
  `low ▬ high`. Notes about the data (the uncalled cells) are a section under the key.
- The pointer readout (`.tip`) follows the pointer and gives the record's own values.

**Table-led analysis** (Differential expression, Co-expression; to build the same way: Markers).
- Rail: the question, top to bottom in the order it is asked. DE: Contrast, Test (`.opt` rows, with the test's
  settings as a hint line), Cutoffs (a label and its value on one line, the slider under it at full width; `cut on`
  as a segmented control; Reset; the limits of a cutoff said in a hint under it; `What gets tested`), then the
  view's own (Labels for the volcano; Enrichment's options, then the library). Co-expression: Seed, Correlate
  over, Rank by, Scope, Ranked genes. A setting of a chosen option is a field under it (`Pools`, `never
  spanning`), not a second list of rows.
- Stage: `<Stage>` (`components/Stage.tsx`). Head line = the view switch if there is one, what is drawn (a title
  at 600, a meta), and at the right end the actions (`.stage-actions`). With `fit` the stage does not scroll
  (`.fill`): the table runs to the bottom edge with its head sticky, or the figure is fitted.
  - DE table: `.lead` (the count as the title, one sentence), `.ttools` (one 24 px row: filter, `Significant
    only`, the row count), `.tpane-body.edge` (the rows, edge to edge, first and last cells on the head line's
    16 px), then the status line (what was cut, how to open a gene). By keyboard: the row pane is one tab stop
    (`.rows-kbd`, a named region): arrows, Page Up and Down, Home and End move a row cursor and scroll with it,
    Enter opens the gene; every sortable header is a button (`.th-sort`) inside its `th[aria-sort]`.
  - Volcano: `.explorer.in-fill` = the figure in a `.fitbox` (fitted both ways from container units, at most
    1.25 times its own size), a status line (the caption), and an inspector: Gene (the row of the point under
    the pointer, else of the gene clicked last), Key (the three classes with n), Named on the figure (each
    clicked gene; pressing one removes its name).
  - Co-expression: `.split` = a reading column (`.read`: the sentence, both ends on one axis at the figure's own
    size, the note on what a ranking cannot claim) and the two tables as panes (`.tpane`: a name with its count,
    rows to the bottom edge). The reading column keeps at least 440 px (the tables give way first) and the bars
    are drawn at the width the column has, up to 650 px, one to one: at a fixed 520 px they were cut by 200 px
    at 1,280, so every bar from r = 1.00 to 0.23 ended at the same edge.
  - Enrichment is a document: the count as the title, the sentence, the bars at their own size.
- A first step that has not been taken is an empty state (`.empty`: the instruction as a title, one sentence of
  why), never a warning note. `.note` is only for something about the data that limits a claim.

**List-led** (Gene sets: something is chosen from many, then drawn).
- Rail: the library (species), Collections (one field that names what is on and how many, a list behind it with
  every collection and its size; never sixteen chips), Your sets, then the options of what is drawn (Score per
  cell, Genes of the set).
- Stage: head line = the switch (One set / Several sets), the title, one sentence. Body `.split.split-list` = the
  list on the left as a pane (search field, then `.set-row` rows to the bottom edge: name, source, size; chosen =
  wash and an ink edge; several = a check box per row) and the result on the right as a document of sections
  (`<Section>`: a title, a meta, its own actions at the right end, a hairline above; one line, a long title gives
  way with an ellipsis and its full text as its `title`, the actions never drop under it). The score map and its
  table share a row (`.sect-pair`): the table takes what its columns need (at most 420 px), the map takes the
  rest and is fitted between 280 and 560 px, painted by the feature plot's painter with its type in CSS pixels.

**Composition** (a chart that is read row by row).
- Rail: `Bars show`, `One row per`, `Limit to`. Stage: a section per figure, each with its actions at the right
  end of its head line. The bars are drawn at their own size (rows at a fixed height, type that does not grow
  with the window); the per-type panels are a grid of panels at their own width, saved as one sheet from the
  head line (`Save all panels`), and one panel saves from a glyph in its own corner that is drawn only while
  the pointer or the keyboard is on that panel (`Figure compact`). A group (a condition) is a grey
  (`groupInk`, `--fig-g1` to `-g4`), never a palette colour: a hue on this view always means a cell type, and
  the group's name is on the axis. A percentage on a segment is black or white, whichever reads on that fill
  (`inkOn`, at least 4.58:1 on any colour). Next: the key in an inspector with n per entry.

**Small multiples** (the violins, the feature plots, the per-type panels). One Save for the sheet at the head
line (`Save all panels`: the same menu of formats as any figure; `Figure sheet` for SVG panels, a `redraw` that
composes every panel for canvas ones); a panel's own Save in its corner on hover or focus. A violin panel is
drawn one to one at the width its column has (300 px to 1.25 times its own size); a column narrower than 300 px
means fewer columns, never a smaller drawing. Feature plots are fitted to the column up to the drawing's own
640 px, with their type set in CSS pixels whatever the panel's size. A y axis says what it measures and in what:
the violin's reads
`Expression · <the object's own record of its scale>`, or `Expression ÷ mean of <control>` when relative.

**Prose** (Overview, Methods). No controls of their own: a reading column. Sections are hairline blocks; a
section's eyebrow, title and one-line sub sit over its content. Methods prose runs at 68 characters. Stats are a
hairline grid (`.stats`: a rule above and below, hairlines between), not boxes. Provenance and the Run card are
tables with a fixed first column and no frame.

**Landing.** One centred column (560 px): what the studio is in one sentence, the drop target (the only dashed
edge in the app, because it is the only thing you drop onto), the input format as a table, the demos as rows
between hairlines (`.demo-row`). No wells.

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
system: a figure leaves for a white page and is forced to the light values on export. The dark theme is every
token on `:root:not([data-theme='light'])`, so the one attribute export stamps returns all of them to light at
once; there is no second list of "the tokens figures use" to fall behind.

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
- **Hint** (`.hint`, in the rail): what a control does or cannot do, in `--ink-3` at 11 px; its one consequence
  in 600 (`--ink-2`). A hint is never coloured: a caution about a cutoff is a note, not an alarm, and an orange
  paragraph was the loudest thing on the screen. `--warn` is for a state that stops the reader.
- **Status line** (`.rail-status`): the state of what the rail has set up, as words with a 6 px dot (grey, green
  when ready, `--warn` with warn text when it stops the reader). Not drawn when it would only repeat the control
  under it. It replaced a coloured pill.
- **Stage, Section, InHead** (`components/Stage.tsx`). `<Stage head fit>` is a view's head line and body;
  `<Section title meta>` is a block of a document with its own head line; both own an action slot at the right
  end, and `<InHead>` (which `Figure` uses for Save) puts an action there: a portal like `<InRail>`, in place on
  the server and where no head line is above.
- **Icon** (`.ico`, `DownIcon`): a drawn 12 px glyph in the label's ink. Never a character from a symbol font:
  U+2B73 came from whatever fallback the machine had and read as three bars.
- **Empty** (`.empty`): words where the figure will be; no box.
- **Table** (`.t`): 12 px; head on `--bg`, 500, sticky; rows 28 px, hairlines, hover wash; gene symbols mono. A
  numeric column is `.num` on its `th` and every `td`: right-aligned, tabular, in the interface's face at the
  table's size (never mono, never a second size inside one row). No frame and no radius around it (`.scrollx`
  is only its scroll).
- **A figure wider than its stage** (`.figscroll`): fitted first (Markers' columns run from 21 px down to 15);
  past that it scrolls sideways with a bar that is always drawn, is a tab stop with a name, and a line under it
  says so. The saved file always has all of it.
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
  diverging scale with a neutral middle. Never a rainbow. **Low recedes on either ground:** on the dark paper a
  scale starts from one grey a step above it (`ZERO_ON_DARK`, `#2B3038`) and gets lighter as the value rises
  (`rampColor(f, key, 'dark')`: the same colours read from the other end, the part darker than that grey left
  out; a diverging scale's middle is that grey, not white). The light-to-dark scale on the dark ground made
  absence the brightest thing on screen. A canvas takes the ground from `useDark()`; an SVG mark carries both
  values (`onGround(light, dark)` with `.gfill` or `.gstop`), so the screen follows the theme and the saved file
  gets the light one. A key (`rampCss`, `ColorBar`) shows the scale as the marks wear it.
- **A colour that is blended is a literal.** `mix()` refuses anything that is not `#rrggbb`: a custom property
  handed to it drew Markers' colour legend as a flat black bar.
- **Marks on an embedding.** Radius from the panel and the count: `min(3, max(0.7, (w / 760) · k))` CSS px with
  `k = clamp(0.8, (30,000 / cells)^0.25, 3.4)`, so ink density holds from 240 cells to 300,000 and from 1,280 to
  2,560 px. A 12 px clear margin inside the canvas, so no point is cut by an edge.
- **Names on an embedding.** Sized from the panel (`w / 52`, 11 to 14 px), 600, haloed in the ground colour at a
  little over a quarter of the type's height with round joins. A name that would overlap another is dropped, never
  cut (`lib/canvas-label.ts`); the cluster keeps its colour and its key entry. Panels under 280 px carry no names.
- **Axes.** An embedding names its two dimensions by its key, once per figure (the bottom-left panel). Every other
  axis carries its quantity and unit. Grid lines are `--fig-grid`, behind the data.
- **Small multiples.** One shared range, said in the status line. A panel's name and n sit directly above it.
- **A figure's type does not grow or shrink with the window.** A figure is drawn one to one at the width it has
  been given (`useWidth`, `lib/use-width.ts`: the violins, the co-expression bars, Markers' dot plot, the score
  map), so its marks take the room there is and its type stays the size it was set in; or, where it is fitted
  both ways (the volcano), at its own size and at most 1.25 times it. Never scaled down into a column, never
  cut by one. Figure text is `FIG_TYPE` (10.5 ticks, 11.5 labels and titles) and never under 10 px on screen.
- **Legend.** Always names what is plotted and gives n. Text wears ink, never the series colour.
- **Names under an axis.** A category's name is never cut inside a word, and is never under 11 px
  (`FIG_TYPE.name`). In order: it fits on one line; it wraps at a space or at the punctuation of a compound name
  ("Cardiomyocyte/Working cardiomyocyte"); the figure takes more width (a column goes first: the violins grouped by
  cell type and group take the width at which every cell type sits upright under its block, `bandNeed`); the whole
  row is turned to one angle, never half of it (`bandNames`, `axisTicks`). Only where a box cannot grow (a panel's
  title, a row label) does a single token wider than its line keep its first letters and an ellipsis, with the whole
  name in the element's `<title>` (`wrapAll`). Run 3's full-size type made the old wrap cut six of nine cell types at
  1,280 px ("Oligode / ndrocyt / e"); `scripts/test-names.mjs` holds the rule.
- **A saved figure's foot (its legend).** A saved figure stands alone on a page, so every figure declares a foot
  (`<Figure foot>`, `lib/figure-foot.ts`): what is plotted, the key with n, what a mark means. Every Save writes it
  under the drawing in print ink, at the figure's own width, in all three formats; a sheet gets one foot and a panel
  saved from its corner carries the sheet's; a drawing that knows its own n says so on itself (`data-foot`). The
  same words are on screen where the layout has room (the legend line under the figure). Exempt only a figure whose
  own drawing holds the key and n (Cells' painted key). From run 5: the volcano's foot names its contrast, its cell
  type, its test and its two cutoffs (they were in the file's name only); the dot plot's has a title line; a list of
  groups with their n is wrapped between entries, so a name is never parted from its count (`wrapSpaces`); one panel
  saved alone from a sheet carries the sheet's `panel` foot (its key and what a bar is: the whole sheet's legend was
  as tall as a 1.8 in panel's plot), and a feature panel its own group's n; a sentence about a mean is not written
  for a group of one sample. **Cells the annotator did not call** are named in every file that draws or leaves them
  out: Cells' key has a row "Not called" with its count and the annotator's labels (the key then sums to the panels'
  n), and Composition's and Markers' feet carry the sentence their screens show, from one function
  (`notCalledNote`, `lib/sentinels.ts`). An axis carries its quantity on screen
  too: Composition's panels say "Share of sample", the co-expression axis names its seed, the score violins say
  "Module score". Ticks are round numbers inside the range (`breaksOf`), never fractions of the largest value.
- **Figure ink.** An SVG figure's ink is `--fig-ink`, `--fig-line`, `--fig-grid`, `--fig-plate`, `--fig-summary`
  and `--fig-label` (`lib/figure-ink.ts` names them): light on the dark ground, black and the print greys on the
  light one, and stamped to the light values while a figure is exported, so a saved figure is the same file from
  either theme. They were literals (`#000000`), so every SVG axis was invisible on the dark theme. While a
  figure is read for export nothing is in transition (`:root[data-exporting]`): a colour in transition reads as
  the value it is leaving, and under reduced motion every element had a 120 ms transition on every property, so
  figures saved from dark kept light ink on a white page. A file saved from dark is byte for byte the file saved
  from light (`npm run test:export`). Every canvas figure is repainted for export in print ink on white
  (`redraw`): Cells, the feature plots, the score map.
- **Save.** One Save per figure, at the right end of the head line over it, and the last action there on every
  view (CSV, then Save). Always a menu of formats: SVG where the figure is one, PNG at 300 and 600 dpi; the PNG
  carries its resolution (a pHYs chunk). **The print scale:** every figure is saved at 120 CSS px to the inch
  (`PRINT_PX_PER_IN`), so type set at 10.5 px prints at 6.3 pt and 11.5 px at 6.9 pt in every file, whatever the
  window. The file's width is the drawing's own width at that scale, to 0.1 in (a 420 px drawing is one column,
  3.5 in; an 840 px one is two, 7 in). Past 840 px a figure is set at 7 in while its smallest type stays at 5 pt
  or more (to 1,058 px); wider than that it keeps 5 pt and is wider than the page. The menu states the width
  once, under the formats, with the column it fits and the size its type prints at, and reads it from the function
  that sizes the file (`printSize`), so the words and the file cannot disagree; the SVG's root carries the same
  width in inches. It said "3.5 in wide" on every figure: true at one window, with type from 2.3 to 12.6 pt.
  Rejected: size classes (a 210 px panel still printed 12.6 pt type), and re-laying a figure out at a print width
  on Save (the right end state: it needs every figure to draw at a width it is handed, not the one it measures). What is saved is the figure's own drawing, chosen by `lib/figure-pick.ts`:
  never an icon or a glyph in its box, never an SVG when the figure brings its own painter. Cells saves the whole
  figure (every panel with its name and n, the axis glyph, the key with n; an isolated entry is isolated in the
  key too) repainted on white. A figure that drops ticks, a legend or cells in its file is a wrong figure.

## Words

Run 5 measured every word before changing one ([design/COPY.md](design/COPY.md): 1,319 distinct strings, 7,971 words,
on 153 states) and then wrote this. The numbers below are `scripts/copy-standard.mjs`; `scripts/test-copy.mjs` fails
`npm test` when a string is over its budget or uses a retired term. **The reader is a scientist with a figure in
mind:** they scan for the control or the number they came for, read a sentence only when a result surprises them,
and take a saved figure away from every word on the screen. So: fewer words is the default, a sentence that changes
nothing the reader will do goes, and the reasoning behind a method lives in Methods (and the root DESIGN.md), not
beside the control.

**Word budgets, per string.** A word is a run of characters holding a letter or a digit. A slot the data fills (a
number, a gene, a cell type) counts as none: the budget is for what the app says.

| kind | words | why this number |
|---|---:|---|
| tab | 2 | a noun, found by position after the first visit |
| button, segment, option, chip, label, table header | 3 | a verb and its object, or a name; three words is the most read in one fixation |
| menu item | 4 | a name chosen among others in a column |
| picker's face | 5 | a name the reader chose, with one qualifier ("cell_type from the file") |
| badge | 3 | a state, never a sentence ("from your file") |
| title (a section, a stage, a panel) | 8 | one line at 15 px in the narrowest stage |
| placeholder | 6 | it vanishes on the first key: an example, not an instruction |
| accessible name | 8 | heard in full before the next key press |
| status line, head line | 14 | one line of the head at 1,280 px; it is re-read every time the figure changes |
| tooltip | 16 | one sentence; it is gone when the pointer moves, so it cannot hold a reason and its consequence |
| help line under a control | 20 | three lines of the 208 px rail; a fourth pushes the next control off a 900 px window |
| legend line under a figure | 24 | what a mark means and n, in one line of a 900 px stage (a list of groups with their n is data) |
| note (a limit on a claim) | 30 | two sentences: the limit, and what to read instead |
| empty state | 12 + 24 | the instruction is the title; one more sentence only if it says what will be drawn |
| error | 30 | what happened, then what to do (below) |
| readout | 12 | read while the pointer moves |
| text on a figure | 8 | an axis title or one annotation |
| a saved figure's legend | 45 | beside its key and n: a journal's legend for one panel runs two to three lines |
| a paragraph of prose (Overview, a note under a result) | 40 | past that it is a method, and belongs in Methods |
| a paragraph of Methods | 200 | a paper's methods paragraph; the one place a reader came to read; a longer one is two |

**One screen at rest** (1,440 by 900, the app's own words in view): 160 on a view that is a figure, 220 on one that
holds a table or a list, 520 on Methods. At the base the worst were Differential expression (312), Co-expression
(308) and the enrichment (245).

**One term per concept.** The left column is the only word the interface uses.

| concept | term | retired |
|---|---|---|
| a file leaving the app | **Save** (a figure, the pseudobulk counts), **CSV** (a table, named by its format) | download, export ("exported from" and the exporter's own file names stay: they name the lab's tool) |
| the experimental factor | **group** | condition |
| one biological unit | **sample** | animal, mouse, replicate (as a noun for a sample) |
| the annotation a view splits by | **cell type** | cluster (it stays for ordering a heat map, "Cluster", and where a message names the bundle's own field, `cluster.u16`), population, identity |
| a named list of genes | **gene set** (a "set" after first use) | signature, pathway (unless it is the collection's own word), module (except "module score", the method's name) |
| a cell the annotator gave no cell type | **Not called** as a key's row and a table's row ("Cells not called"); in a sentence, "cells the annotator did not call", then the annotator's own labels with their counts | sentinel, uncalled, unassigned, "Grey:" as their name |
| an adjusted p-value | **padj** where it is the column or its cutoff (a table's head, the rail, a readout, the CSV: the name the reader will search for); "adjusted p" spelled out on an axis and in a sentence of Methods | adj. p, p adjusted, p_adj, q (FDR stays the name of the Benjamini-Hochberg cutoff) |
| the thing that is open | **object** (what was analysed), **bundle** (the file it came in) | dataset, file (for the object), data |
| this application | no subject, or **this app** | the studio, Studio (except the product's name on the landing page and in Methods) |
| the left pane | **on the left** | the controls on the left, the rail, the sidebar |
| choosing from a list | **Choose** | pick, select (for a list) |
| acting on a mark or a row | **Select** (it works by keyboard too) | click, tap, press (for a mark); hover is "point at" |
| starting a computation | the verb of the result: **Run** (a test), **Find markers**, **Score**, **Correlate** | compute, calculate, go |
| a fraction of cells with a count above zero | **detected in** n% | expressed in, pct, positive (except "positive cells drawn last") |

**Sentence case, and punctuation.** Every label, title, button and head is sentence case; a method, a tool or a person
keeps its capitals (Wilcoxon, Bonferroni, Seurat, MSigDB). A fragment (a label, a title, a tooltip of one clause)
has no full stop; a sentence has one. No exclamation mark, no "please", no "simply". No dash joining two clauses:
write two sentences, or use a colon when the second half is the content of the first. The em dash has one meaning
in this app, in a table cell: no value. An ellipsis only on a control that opens a file picker and on a busy button.

**Numbers.**

| quantity | written | example |
|---|---|---|
| a count | whole, thousands separated | 34,367 cells |
| n | "n = " with spaces, what is counted at first use; in a key "(n = 6,065)" | n = 34,367 cells |
| a share | whole percent; one decimal under 10% in a table | 92%, 0.4% |
| one cell's QC value in the readout | two decimals (it showed the float's seven significant digits) | 3.14 |
| expression (log-normalized mean), log₂ fold change, r, a module score, a z-score | two decimals | 2.46, −0.61 |
| a coordinate on an embedding | two decimals (the sixth decimal of a UMAP is not information) | 4.21, −7.03 |
| p, adj. p | two significant digits; under 0.001 as 1.4e-5; an underflow as < 1e-308 | 0.021, 1.4e-5 |
| a negative number | the minus sign (U+2212), never a hyphen, never a dash | −1.18 |
| a range | "a to b" in a sentence, an en dash in a label | 10 to 500 genes, 10–500 |
| a unit | a space before it, except % and × | 7 in, 300 dpi, 6.3 pt, 2.2× |

A number rounded on screen is whole in the file made for numbers: every table's CSV writes full precision, and a
readout's values are the columns of the CSV saved from that view (the embedding's coordinates are in the bundle's
`embed.f32`, which the app never changes).

**Names.** A gene is written as the object writes it (Gfap, ASCL1), in mono where symbols align. A gene set keeps
its source's capitals: the collection's prefix goes, an underscore becomes a space, the first word takes a capital,
and a word is lower-cased only if it is a dictionary word. A token with a digit or from the acronym list
(`ACRONYMS`: DNA, RNA, E2F, MYC, G2M, KRAS, TNFA, NFKB, MTORC1, IL2, IL6, JAK, STAT3, STAT5, UV, TGF, PI3K, AKT,
MTOR, P53, WNT …) stays as the source has it: "E2F targets", "DNA repair", "TNFA signaling via NFKB", never "E2f
targets" or "Dna repair". The source's own name is in the element's title and in every CSV. A cell type, a group
and a sample are the object's own strings, never re-cased, never abbreviated except by an ellipsis with the whole
name in the title.

**An error says what happened, then what to do.** First sentence: what the reader was doing and what did not
happen, in their words ("That file did not open"). Second: the cause the app knows, without a code name. Third:
one action that works (a button where there is one). The technical message comes last, in mono, for a bug report.
Never only "Something went wrong"; never a cause the app is guessing.

**On screen, or in the saved figure.** Each fact has one place per medium.

| | on screen | in the saved file |
|---|---|---|
| what is plotted (quantity, cell type, contrast) | the head line, once | the legend's first line, bold |
| the test and its cutoffs | the rail (where they are set) | the legend, when a line or a colour on the figure comes from them |
| the key and n | the key pane, or the line under the figure when there is no pane | always, under the drawing |
| what a mark means | the line under the figure | always |
| cells left out (cells not called; cells too few to pool) | one sentence where the count is shown | the same sentence, always |
| how to use the figure (select, point at, on the left) | a tooltip or the empty state | never |
| the app's name, the theme, the window | never | never |

Nothing is said twice on one screen: a tooltip does not repeat its control's label, a help line does not restate the
option chosen, a legend line does not repeat the key pane's n. Nothing needed is missing from a file: the test is
`npm run test:export` (every file holds a title, a key or its n) and the lab fixture's check (a file from an object
with cells not called names them and their count).

**Elements, measured** ([design/ELEMENTS.md](design/ELEMENTS.md)). One box per kind: a control is 28 px in the rail
and 24 px in a head line or a toolbar, with 13 px type at 28 and 12 px at 24; a row (table, option, picker option)
is 28 px; radius 6 on a control and 4 on a thumb, a swatch or a badge. The differences that have a reason are named
in ELEMENTS.md; any other is a defect.

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

From run 4: a menu and a list are walked with the arrow keys, Home and End (`Popover`, roles `menu` and
`listbox`); Tab still reaches every item. Escape closes the topmost open thing and nothing under it (a Save menu
over an isolated key entry closes the menu; the next Escape clears the entry). A view opened from inside another
(a gene from the DE table) takes the focus with it: the stage is focused, so the next Tab starts in the new view.

## Motion

`--d-press` 140 ms (press, hover, colour), `--d-menu` 170 ms (a menu's entry: opacity and a 3% scale from its
trigger, a transition so a second toggle retargets), `--d-panel` 220 ms (the determinate bar). Ease-out
(`--ease-out`), never ease-in. Panes, tabs and anything from the keyboard do not animate. Under reduced motion,
movement stops and colour changes stay: the three tokens become 120 ms and nothing else gets a transition (a
forced duration on every element gave one to everything, the property defaulting to `all`).

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
- *Split panels centred in their cells.* Each name floated mid-stage over a band of empty paper; a title is
  looked for at the top.
- *A coloured paragraph in the rail, and a pill for the test's status.* A note is not an alarm, and the pill
  repeated the selected row under it.
- *A Save that floats over each figure.* It sat somewhere else on every view; the head line's right end is one
  place.
- *Collections as sixteen chips over the result.* Chosen rarely; one field and a list.
- *A set picker as a dropdown.* The names are what is chosen between; the list stays on the stage.
- *Literal black as figure ink.* Right on paper, invisible on the dark ground.
- *Saving the first `svg` in a figure's box.* It was the axis glyph in Cells and the button's own icon in every
  small multiple.
- *One scale direction on both grounds.* Light to dark is right on white and puts absence on top on dark.
- *A figure drawn at a fixed size and scaled or clipped into its column.* 7.6 px type, or bars that all end at
  the column's edge.
- *Groups in the first two palette colours.* They are the first two cell types' colours on the same figure.
- *A Save that writes at once beside Saves that open a menu.* One glyph, one word, one behaviour.

## What is left, in order

1. One place for the key pane: in Cells it is a full-height pane beside the head line, in the volcano it sits
   under the head line (both now close with `]`), so Save is at a different x on the two. The head line should
   span the stage on both. The key in an inspector for Composition, Markers and the score map; the feature plot
   and the score map as explorers (isolate, the pointer readout; today only Cells has a readout).
2. Done in run 4 (round ticks on the volcano, the score violin and the dot plot's bar; n and keys in every saved
   file). Still dividing the range: Overview's QC violins. A figure wider than two columns is saved wider than a
   page (it says so); the end state is a figure laid out at a print width on Save. Volcano points have no
   keyboard route. Between 901 and 1,279 px Gene sets and Co-expression lose the right edge of their last table
   column, and axe reports one scroll region there that cannot take focus (1,100 px).
3. The score map is on the reader's sequential scale; a module score is signed and belongs on a diverging scale
   with zero in the middle (this page's own rule). It changes how the map reads, so it is the PI's.
4. Done in run 5: a gene-set name keeps its acronyms ("DNA repair", "E2F targets"; `properName`, a list and a rule,
   so a rare acronym outside the list is still lower-cased: say which when one is seen). Gene search has no
   suggestions; Co-expression's seed shows as a placeholder after a run.
5. Enrichment's term detail and the Coherence block as flat sections (still wells); the rail on a 900 px window
   when Differential expression shows every note (it scrolls); the lab bundle's Overview selects on the stage.
6. States seen on a large object (the DE table's row cut, the label drop of a 300,000-cell embedding): designed
   and written, never seen, because the synthetic demos are small.
7. Cells the annotator did not call (the lab's EXCLUDED and UNRESOLVED) are said on the screen but not in the saved
   files: Cells draws them grey with no key entry (its key counts the called cells, its panels' n every cell);
   Composition's foot counts the called cells only ("8 rows, 224 cells" on the lab fixture's 240); Markers' foot says
   "each cell type against the rest" over 224 cells, not that the 16 are on neither side. Every number is true; the
   cut is not named. `npm run test:export` saves from the replicated demo, which has no such cells.

7. Done in run 5 (it was the verifier's item): a saved Cells, Composition or Markers figure names the cells the
   annotator did not call. Left from run 5, in order: the n line on screen still wraps where the browser likes (the
   saved file does not part a name from its count; the screen can); Methods' reading notes were shortened and
   re-termed but not re-argued, and its longest paragraph is 196 words of a 200 budget; the offline-conversion
   dialog and the messages of a malformed bundle were read in the source, not seen; the screen budget counts words,
   not lines, so a 12 px rail hint of 20 words still takes three lines of a 208 px rail.

**Do not get wrong:** `Card` must keep rendering `<section class="card">` (two tests split the page on it); a
view's controls go through `<InRail>`, never by lifting its state into App; an action on a figure goes through
`<InHead>` (or `Figure`, which uses it), never positioned by hand; a figure that is one panel of several is
`Figure compact`, or every panel's Save lands in the head line; an SVG takes its ink from `lib/figure-ink.ts`
(custom properties), a canvas that is saved as painted takes the `PRINT_` literals; the key's swatch markup stays; a new
palette adds one check to the suite by itself (the suite loops over `PALETTES`); never quantise the screenshots (a
256-colour PNG moved one swatch to two different colours in run A's record). From run 3: a decorative `svg`
inside a figure's box is `aria-hidden` (that is how Save tells it from the drawing); a sheet is saved with
`Figure sheet` and `sheetSvgs`, never `querySelectorAll('svg')`; a colour handed to `mix` or to a colour bar's
ends is a literal; a canvas painter lists `useDark()` among its inputs; a data colour that differs by ground is
`onGround`, never a dark value baked into an SVG (the file would carry it); a figure is drawn at `useWidth`'s
width, not scaled into its column; a numeric column is `.num` on the head and the cells. From run 4: a name on
an axis goes through `lib/labels.ts` (`axisTicks`, `bandNames`, `wrapAll`), never a hand-rolled `slice` into
lines; a new figure declares a `foot` (the suite counts every `<Figure`); nothing passes a print width to
`Figure` (it is counted from the drawing); a number in a foot is wrapped at spaces only ("4,598" is one word);
before a change to `lib/labels.ts`, `lib/download.ts`, `Figure.tsx`, `Popover.tsx` or `svg-parts.tsx`, list the
figures that use it and look at each at 1,280 and 1,440. From run 5: the "Not called" row's swatch is `sw sw-off`,
not `sw` (the sentinel tests read a cell type's entry by `<span><i class="sw" …>`, and a cell not called is not
one); the sentence about cells not called comes from `notCalledNote`, never typed twice; a string a reader sees
uses the terms of **Words** (the check fails on "cluster", "condition", "animal", "signature", "download", a dash
between clauses); a figure's text takes figure ink (`AXIS_INK`), never `--ink-3`.

## Checking a change

- **Words and elements.** `node scripts/test-copy.mjs` (in `npm test`) reads every string from the source through the
  TypeScript parser, and the measured inventory (`docs/design/inventory/after.json`), and fails when a string is over
  its kind's budget, a screen at rest is over its budget, a retired term is used, a saved figure has no legend, or the
  lab fixture's files do not name the cells not called. `--list` prints every string, the furthest over first. After
  a change to any string or control: `npm run build`, serve it, then
  `CHROME=<chrome> node scripts/inventory-design.mjs <url> docs/design/inventory/after.json` and
  `node scripts/inventory-report.mjs` (COPY.md and ELEMENTS.md are generated; the designer's reading of the boxes is
  `docs/design/inventory/elements-notes.md`). `node scripts/copy-changes.mjs <base src>` lists what a change did to
  each string. A new string over its budget on purpose is named in `EXCEPTIONS` (`scripts/copy-standard.mjs`) with
  its reason; there is one (the Markers button, whose count a data-level check reads).

- `CHROME=<chrome> node scripts/shot-design.mjs <url> docs/design/after` captures every screen at 1,280, 1,440 and
  1,920 px in both themes (synthetic objects only), growing the window to take a whole document view.
- `CHROME=<chrome> AXE=<axe.min.js> node scripts/measure-design.mjs <url>` prints the contrast of every text token
  on every ground, the edges, axe-core's WCAG 2 AA result on Cells, Overview, Differential expression, Gene sets
  and Co-expression, the tab order of each of those views as it opens, and the scatter's interaction time
  (production build, compared only with a run taken at the same time).
- `scripts/shot-design.mjs` takes a fifth argument, a list of screen names, and then walks only the blocks that
  hold them. `docs/design/gallery.html` reads `docs/design/gallery/before` (the studio at `099a085`, 1,440 px,
  full colour) and `docs/design/after`.
- `node scripts/test-fit-panels.mjs` (in `npm test`) pins how panels share the stage.
- `node scripts/test-names.mjs` (in `npm test`) pins that no name is cut inside a word: the wrap, a row of names
  under bands at every band width, and the widths the reviewer measured.
- `node scripts/test-export.mjs` (in `npm test`) pins what a Save writes and in what ink, as rules: which drawing
  is saved, the light stamp and its transitions, literals in blends, scales on the dark ground, label ink on
  fills, the PNG's resolution, the print scale (a file is the width its menu states, its type between 5 and 8.5 pt),
  and the foot (laid out inside the figure's width; every `<Figure` has one or draws its own key and n). `CHROME=<chrome> npm run test:export -- <url>` (needs `playwright-core`) writes
  every Save in both themes and measures each file: it holds the figure's marks, no colour of the dark theme,
  and the file from dark is byte for byte the file from light; and, at 1,280, 1,440 and 1,920 px, that each file
  is the width its menu stated, holds an n, and that no cell type under the grouped violin is cut inside a word.
- Panel sizes in a 900 px tall window (canvas, CSS px; `Replicated cohort`, measured on the page):

  | window | one panel | two panels | two panels, both panes closed |
  |---|---|---|---|
  | 1,280 | 784 × 645 | 379 × 312 | 615 × 506 |
  | 1,440 | 887 × 730 | 459 × 378 | 695 × 572 |
  | 1,920 | 887 × 730 | 699 × 575 | 868 × 714 |

  Before W037 the split panels were about 545 px wide at 1,440 (a 1,180 px column); after run A, 375. The time
  course's four panels are 379 × 318 at 1,280 and 400 × 336 from 1,440 up (height-bound, two by two).
