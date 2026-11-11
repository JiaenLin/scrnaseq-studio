# The audit against W037's rubric, and what is left

Taken 2026-11-11 by looking at `before/` (the studio at `099a085`, its own synthetic demos and the committed
synthetic `testdata/lab/family-2x2.zip`; 1,280, 1,440 and 1,920 px; light and dark), plus the measurements named.
File names drop the width and theme when the defect shows at every one. **A** = fixed in run A, **B** / **C** =
left for that run.

## 1. Layout (5)
1. Every view is a centred 1,180 px column; at 1,920 px 740 px is empty margin and each embedding panel is 545 px
   (`cells-1920-light`). **A** for Cells; the shell is full width; the other views keep a reading column (**B**).
2. Controls live in three places: a bar under the tabs, each card's header, and inline above figures
   (`cells-1440-light`, `expr-violin`, `coexpr`). **A**: the bar is gone and its controls are in the rail, with
   Cells' own. **B**: every other view's card-header controls move to the rail.
3. The control bar is a 42 px band that is empty on Cells, Overview, Composition and Markers but for two buttons
   at its far end (`cells-1440-light`, `overview-1280-light`). **A**.
4. Legend, n and caption sit under the figure in 11 px type (`cells-1280-light`). **A** (inspector).
5. Figures are fixed pixel sizes: the embedding 700 × 500, the dot plot about 230 px wide in a 1,140 px card, the
   feature plots with blank right halves (`expr-dot`, `expr-feature`). **A** for the embedding; **B** the rest.

## 2. Hierarchy and type (3)
1. Uppercase, tracked micro-labels on every eyebrow, control label and table head (`cells-1440-light`, `de`,
   `coexpr`, `de-table-1280-dark`). **A** in the shared classes. **B**: `uppercase` still typed in Landing.tsx and
   PickMany.tsx (one each).
2. Monospace for numbers in running text (`n = 14,920`) and for placeholders (`cells-1440-light`, `expr-violin`).
   **A** for Cells. **B**: 64 `mono` uses in 17 components; keep mono for gene symbols and file names only.
3. Four weights for emphasis (500 tabs and chips, 600 buttons, 700 the mark) (`cells-1440-light`). **A** in the
   shell and shared classes. **B**: `font-bold` in GeneExpression.tsx (1) and Landing.tsx (2).

## 3. Colour (5)
1. `--ink-3` text (tabs at rest, captions, eyebrows, table heads, `n =`) at 2.34 to 2.56:1 in light and 3.07 to
   3.96:1 in dark: fails AA, and the tabs read as disabled (measured; `cells-1440-light`, `landing`). **A**.
2. `--accent` as text is 4.47:1 in light; white on the dark accent (the "Open a bundle" button) is 2.98:1
   (`landing-1280-dark`). **A** (`--text-on-accent`).
3. The default categorical palette (`npg`) fails on a nine-type scatter: worst pair ΔE 4.8 for protan readers
   (`#7E6148` against `#E64B35`); qNSC and Endothelial are both red at ΔE 7.5 for full colour vision; five of ten
   colours below the chroma floor (`validate_palette.js --pairs all`; `cells`, `composition`). **B**.
4. In dark, `--line` was `--sunk`'s own value, so sunk panels and table rows had no edge (`de-table-1280-dark`). **A**.
5. Neuroblast (`#3C5488`) is 2.34:1 on the dark plot ground (validator; `cells-1280-dark`). **B** with item 3.

## 4. Spacing and density (3)
1. Five control heights side by side: button 35, select 33, segment 28.75, chip and small button 26.75 px
   (`de-1440-light`, `coexpr`). **A** (`--h-sm` 28, `--h-md` 32).
2. Off-scale spacing in the shell (11 px tab padding, 10 px gaps, a 42 px bar) (`cells-1440-light`). **A**.
3. Radii of 14/10/6 px, and nested rounded panels inside rounded cards (`overview-1280-light`). **A** (10/6/4).
   **B**: 26 arbitrary `rounded-[…]` values in 17 components move to the tokens.

## 5. States (2)
1. Empty states are a dashed grey box with no action: "Search a gene above…", "Pick a set above…" (`coexpr`,
   `sets`). **B**.
2. The first step of DE (nothing picked yet) is a warning-yellow note, the colour of a problem (`de-1440-light`).
   **B**. Its sentence now says the pickers are "in the controls on the left" (run A moved them).

## 6. Interaction (4)
1. Ten tab stops before the view (the tab order, measured: stops 2 to 10 are the tabs). **A** (one stop; arrows).
2. The tab list's roles were invalid: a `role="group"` between the tablist and its tabs (axe: aria-required-children
   and aria-required-parent, both critical). **A**.
3. No readout on the embedding: no exact values for any cell (`cells`). **A** (pointer readout).
4. No selection on the embedding, so nothing to undo (`cells`). **B** (click a legend entry to isolate it; Escape
   or the same click undoes).

## 7. Charts (5)
1. The embedding had no axes or axis names (`cells`). **A**.
2. Its legend gave no n (`cells`). **A** (count per entry in the inspector).
3. Violin y axes carry numbers but no quantity or unit (`expr-violin`). **B**.
4. The feature plot's scale is a 60 px ramp in about 8 px type (`expr-feature`). **B**.
5. A Save button over every facet: 9 on Composition, 6 on the violins (`composition`, `expr-violin`). **B**.

## 8. Motion (not audited by looking)
Stills cannot show motion. The stylesheet keeps durations at or under 220 ms and has a reduced-motion block. **C**.

## 9. Speed
Measured, not looked at: see W037's as-built record.

## 10. Truth (0 found)
No number or label was found changed or inferred in the screens looked at. Run A changed one sentence because the
layout made it false (§5.2), and no number.

## Runs B and C, in order
- **B1.** Gene expression: plot kind, group by, columns, colour, scale and cell types to the rail; the figure grid
  fitted to the stage; violin y titled; one Save; the feature ramp sized and labelled (§1.2, 1.5, 7.3 to 7.5).
- **B2.** Differential expression: the view switch, test, thresholds and filters to the rail; table and volcano in
  the stage; the inspector shows the clicked gene; the first step as an empty state (§1.2, 5.2).
- **B3.** Markers, Composition, Co-expression, Gene sets and its several-at-once panel, the same way (§1.2, 5.1).
- **B4.** The categorical palette, validated in both modes with `--pairs all`; colour never the only cue (§3.3, 3.5).
- **B5.** Overview and Methods stay a reading column; Landing gets the tokens (§2.1 to 2.3, 4.3 leftovers).
- **B6.** States for every panel: empty, loading in the frame, error with what to do, no data, large (§5).
- **B7.** Selection on the embedding with undo (§6.4); a keyboard path to the readout.
- **C.** Motion audit and reduced motion; figure export at publication quality from the new frame; the
  before-and-after gallery; the last polish found by looking.

## Designer run 1 (2026-11-11): what closed, what the designer added, what is left

Run A's surface was replaced (docs/DESIGN.md, "Rejected"); its 19 fixes stand where they were structural. Of the
eight it left:
- **Closed.** §3.3 and §3.5 (B4): the default palette is `studio`, validated `--pairs all` on both grounds (every
  gate passes; worst pair CVD ΔE 7.5, normal 15.4, 3:1 or more on both grounds). §5.2: DE's first step is an empty
  state. §6.4 (B7): a key entry isolates its cells; the entry again, Escape or Show all undoes it.
- **Part.** B1: Gene expression's controls are in the rail and the figure starts under the head line; the violin's
  y title, the feature ramp and one Save are left (§7.3 to 7.5). B2: DE's test and cutoffs are in the rail, the
  view switch in the stage's head, the volcano at its own size; the table to the bottom edge and the volcano's
  inspector are left. B3: Composition's and Markers' controls are in the rail; Co-expression and Gene sets are
  not started. §5.1: `.empty` is words on the stage with no box, everywhere; each view's wording is left.
- **Left.** B5, B6, C, and the parts above. docs/DESIGN.md, "What is left", is the order.

Found by the designer and fixed in this run (each by looking at `after/` or by measurement):
1. Boxes in boxes: grey page, white card, grey plot ground, carded legend (`cells`). Flat panes at hairlines.
2. The page scrolled and the figure was sized by width: split panels 375 px with a third of the window empty
   (`cells-viewport-1440`). A fixed frame; the figure fitted in both directions for any panel count.
3. A panel's name sat in the corner of its cell, away from its plot. It sits directly above the plot.
4. Names on the embedding were 10 px whatever the panel. Sized from the panel, 11 to 14 px.
5. One swatch read as two colours in two screenshots: the PNGs were 256-colour images. The record is full colour.
6. Chosen segments and chips were black fills, the heaviest marks on a screen (`sets`, `expr-violin`). A thumb; a wash.
7. Field edges were 1.5:1. `--ctl`: 3.18:1 or more.
8. 12.5 px type; `font-bold`; uppercase tracked headings on the landing page. Whole pixels, three weights, sentence case.
9. The volcano's type grew with the window (16 px axis type at 1,440). Drawn at 1.25 times its own size at most.
10. The key was nine tab stops once its rows were buttons (measured: 20 stops on Cells). One stop; arrows move along it.
11. A scrolling stage could not be reached by keyboard (axe: scrollable-region-focusable on Overview). It is a tab stop.

Open, seen and not fixed: Composition's bars and Markers' dot plot still scale their type with the stage; Save
buttons still sit over every facet; `Show cells` and the volcano's Labels are still on the stage; Co-expression and
Gene sets keep their rows of controls; the DE status chip repeats the Test group's choice.
