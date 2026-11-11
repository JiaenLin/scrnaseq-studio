## The designer's reading (run 5)

Read from the tables below, which are counted. A container (a rail group, a card, a menu, an empty state, a section)
is as tall as its content, so its many heights are not a difference; its padding, radius and edge are one box each
(card 24 all round; menu radius 6 with a 1 px edge; empty state 32 by 24). The controls:

**Made one in run 5** (each was the same element measuring differently with no reason):

| element | before | now | where it was |
|---|---|---|---|
| quiet button | 24 px everywhere, 19.4 px for Reset under the cutoffs (it shrank in a column short of room) | 24 px, never shrinks (`.btn-sm`, `.btn-quiet`: `flex-shrink: 0`) | Differential expression, the rail |
| a sortable table's head cell | 28.5 px (the sort button's 28 plus the hairline) beside 28 px heads that do not sort | 28 px (`.th-sort` is 27 px plus the hairline) | the DE table against Gene sets, Co-expression, Overview |
| a picker's option | 29.4 px (12 px type with 6 px padding) beside 28 px rows in every other list | 28 px (`min-h-7`, 4 px padding; a long name still wraps) | Differential expression and Co-expression pickers |
| the Save menu's entries | "SVG — vector", "PNG — 300 dpi" (a dash, which in this app means "no value") | "SVG, vector", "PNG, 300 dpi" | every Save menu |
| a Save's tooltip and its menu's name | "Download <figure>" on a button that says Save | "Save <figure>" | every figure |
| the key's last row | Cells' key ended in a grey swatch and a paragraph | a row like the others: swatch, "Not called", its count; the annotator's labels in a hint line under it | Cells, the key pane and the saved file |
| a figure's note | Enrichment's note under its scale took the interface's tertiary ink | figure ink (`AXIS_INK`), like every other text in a figure | Enrichment, on screen and in the file |

**Different, with a reason** (left as measured):

- **button, two boxes:** 28 px with 13 px type in the rail and in a body; 24 px with 12 px type in a head line and a
  toolbar. One height per row is the rule; the type follows the height.
- **input, 13 px and 12 px at 28 px:** the 12 px ones are the mono face (gene symbols), which is set one size down
  so its x-height matches the 13 px interface face. The 24 px one sits in a table's toolbar.
- **segment, two boxes:** a segment is its control's height less 4 (24 in a 28 px control, 20 in a 24 px one);
  numbers take 4 px side padding and equal widths, words take 10.
- **option row, padded and not:** a switch row has no side padding so its words are flush with the labels above it
  (docs/DESIGN.md, Components); a chosen option is washed, a switch row is not (the switch is its state).
- **key row, two boxes:** an entry that isolates its cells is a button with a 4 px radius; the key's head line and
  the "Not called" row are not buttons.
- **menu item, two boxes:** a Save entry has two lines (format, what it is for); a picker's option has one.
- **quiet button with 6 px padding:** the two arrow buttons of Group order hold one glyph each.
- **swatch, 8 px and 15 px:** the 15 px ones are the palette previews in Figure style, a picture of a scale, not a key.
- **stage head, 40 px and one of 61 px:** with the key pane closed Cells moves its nine entries into the head line,
  which then takes a second line at 1,440 px. Designed in run 3; the plot gives up 21 px.
- **table row, one of 35.8 px:** Overview's "Cells not called" row wraps to two lines in the lab bundle.
- **note, two heights:** one and two lines of text.

**States.** Every control has a hover (the 6% ink wash, or ink text on a head cell), a 2 px accent focus ring, and a
disabled state in secondary ink; selected is ink (an edge, a wash or a thumb), never the accent. Measured in the
"States" and "Selected and disabled" tables. Not measured: pressed (`scale(0.97)`, 80 ms), which the walk cannot hold.
