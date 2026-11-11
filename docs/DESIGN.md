# Studio's interface design

How the studio looks and where things sit. The root [DESIGN.md](../DESIGN.md) is the method (what is computed and
why); this file is the interface, and it is meant to be complete: a screen that is not built yet is built from this
page without guessing. `src/index.css` is the source of every value named here.

**The rule over all of it:** the design changes how things look and where they sit, never what the data says. Every
number is shown as recorded, every label keeps its words, and the Run card infers nothing.

**Status (W037, designer run 2).** Built to this page: the frame, the tokens, the default palette, Cells (with
Save), Differential expression (the table to the bottom edge, the volcano fitted with an inspector, Enrichment's
controls in the rail), Co-expression, Gene sets (one set and several), Gene expression (every control in the rail,
one Save, feature panels fitted, the violin's y axis titled), Composition and Markers (figures at their own
size, actions in the head line), Overview's counts and tables, the landing page's rows. "What is left" at the
end lists the rest in order. `docs/design/gallery.html` shows every screen before W037 and now.

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
  `.plots` = equal cells divided by hairlines, one per panel. Several panels: each block (its name `name  n = …`,
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
    16 px), then the status line (what was cut, how to open a gene).
  - Volcano: `.explorer.in-fill` = the figure in a `.fitbox` (fitted both ways from container units, at most
    1.25 times its own size), a status line (the caption), and an inspector: Gene (the row of the point under
    the pointer, else of the gene clicked last), Key (the three classes with n), Named on the figure (each
    clicked gene; pressing one removes its name).
  - Co-expression: `.split` = a reading column (`.read`: the sentence, both ends on one axis at the figure's own
    size, the note on what a ranking cannot claim) and the two tables as panes (`.tpane`: a name with its count,
    rows to the bottom edge).
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
  (`<Section>`: a title, a meta, its own actions at the right end, a hairline above).

**Composition** (a chart that is read row by row).
- Rail: `Bars show`, `One row per`, `Limit to`. Stage: a section per figure, each with its actions at the right
  end of its head line. The bars are drawn at their own size (rows at a fixed height, type that does not grow
  with the window); the per-type panels are a grid of panels at their own width, saved as one sheet from the
  head line (`Save all panels`), and one panel saves from a glyph in its own corner that is drawn only while
  the pointer or the keyboard is on that panel (`Figure compact`). Next: the key in an inspector with n per entry.

**Small multiples** (the violins, the feature plots, the per-type panels). One Save for the sheet at the head
line; a panel's own Save in its corner on hover or focus; panels at their own size and at most 1.25 times it
(violins), or fitted to the column up to the drawing's own 640 px (feature plots, whose names are drawn in the
canvas and must be large enough to read). A y axis says what it measures and in what: the violin's reads
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
- **Table** (`.t`): 12 px; head on `--bg`, 500, sticky; rows 28 px, hairlines, hover wash; numbers right-aligned
  and tabular; gene symbols mono. No frame and no radius around it (`.scrollx` is only its scroll).
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
- **Figure ink.** An SVG figure's ink is `--fig-ink`, `--fig-line`, `--fig-grid`, `--fig-plate`, `--fig-summary`
  and `--fig-label` (`lib/figure-ink.ts` names them): light on the dark ground, black and the print greys on the
  light one, and stamped to the light values while a figure is exported, so a saved figure is the same file from
  either theme. They were literals (`#000000`), so every SVG axis was invisible on the dark theme. A canvas that
  is saved as painted keeps the `PRINT_` literals until it is repainted on export.
- **Save.** One Save per figure, at the right end of the head line over it: the stage's head when the figure is
  the stage, a section's head in a document. Cells saves the whole figure (every panel with its name and n, and
  the key with n) repainted on white at 300 or 600 dpi. With no head line above (a view not rebuilt yet) the
  Save is a row over the figure. The per-panel Save buttons of the small multiples stay until those views are
  rebuilt.

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
- *Split panels centred in their cells.* Each name floated mid-stage over a band of empty paper; a title is
  looked for at the top.
- *A coloured paragraph in the rail, and a pill for the test's status.* A note is not an alarm, and the pill
  repeated the selected row under it.
- *A Save that floats over each figure.* It sat somewhere else on every view; the head line's right end is one
  place.
- *Collections as sixteen chips over the result.* Chosen rarely; one field and a list.
- *A set picker as a dropdown.* The names are what is chosen between; the list stays on the stage.
- *Literal black as figure ink.* Right on paper, invisible on the dark ground.

## What is left, in order

1. The key in an inspector for Composition, Markers and the Gene sets score map (they keep a legend under the
   figure); the feature plot and the score map as explorers (isolate, the pointer readout).
2. Canvas figures repainted in print ink on export from the dark theme (the feature plot does; the Gene sets
   score map is saved as painted, so its ink stays the `PRINT_` literals on screen in both themes).
3. Enrichment's term detail and the Coherence block as flat sections (they are still wells); Methods and the
   Overview's remaining sections read through once more at 1,280 and 1,920.
4. States seen on a large object: the row cut of the DE table and the label drop of a 300,000-cell embedding
   are designed and written, but the synthetic demos are too small to show them.
5. The rail on a 900 px window when Differential expression shows every note at once: it scrolls. A shorter
   wording of the notes is a wording change and is the PI's.

**Do not get wrong:** `Card` must keep rendering `<section class="card">` (two tests split the page on it); a
view's controls go through `<InRail>`, never by lifting its state into App; an action on a figure goes through
`<InHead>` (or `Figure`, which uses it), never positioned by hand; a figure that is one panel of several is
`Figure compact`, or every panel's Save lands in the head line; an SVG takes its ink from `lib/figure-ink.ts`
(custom properties), a canvas that is saved as painted takes the `PRINT_` literals; the key's swatch markup stays; a new
palette adds one check to the suite by itself (the suite loops over `PALETTES`); never quantise the screenshots (a
256-colour PNG moved one swatch to two different colours in run A's record).

## Checking a change

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
- Panel sizes in a 900 px tall window (canvas, CSS px; `Replicated cohort`, measured on the page):

  | window | one panel | two panels | two panels, both panes closed |
  |---|---|---|---|
  | 1,280 | 784 × 645 | 379 × 312 | 615 × 506 |
  | 1,440 | 887 × 730 | 459 × 378 | 695 × 572 |
  | 1,920 | 887 × 730 | 699 × 575 | 868 × 714 |

  Before W037 the split panels were about 545 px wide at 1,440 (a 1,180 px column); after run A, 375. The time
  course's four panels are 379 × 318 at 1,280 and 400 × 336 from 1,440 up (height-bound, two by two).
