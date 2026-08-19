# scRNA-seq Studio — design

Fourth app in the family. Same contract as `rnaseq-studio`: **read a finished object,
compute on it honestly, and produce statistics you can defend.** Markers, differential
expression, enrichment and module scores are all run here, in the browser. Upstream
processing — clustering, integration, normalisation — is not: it comes from the file, is
labelled as coming from the file, and is never silently redone.

- `rnaseq-service` — raw FASTQ → counts (request builder)
- `rnaseq-lab` — count matrix → DESeq2
- `rnaseq-studio` — result bundle → figures + Methods
- **`scrnaseq-studio`** — `.h5ad` / Seurat `.rds` → figures + Methods  ← this document

Mentor grounding for every methodological choice below came from the Theis and Satija
corpora (Digital Mentors); citations are inline as DOIs.

---

## 1. Input

The user brings an object that has **already been processed** — QC'd, normalized,
clustered, embedded. That object is the bundle. There is no import wizard.

### 1.1 `.h5ad` — first-class path

AnnData's on-disk layout is HDF5 and is stable and specified:

| Path | Used for |
| --- | --- |
| `/X` | expression (dense, or CSR group `data`/`indices`/`indptr`) |
| `/raw/X`, `/layers/counts` | **raw counts** — required for pseudobulk DE |
| `/obs` | per-cell metadata; categoricals as `{codes, categories}` |
| `/var` | gene names (`_index`) |
| `/obsm/X_umap`, `/obsm/X_tsne`, `/obsm/X_pca` | embeddings |
| `/uns` | provenance — `log1p`, `neighbors`, `leiden`, `hvg`, package versions |

Read with **`h5wasm`** (libhdf5 compiled to WASM). Critically, h5wasm supports
**lazy hyperslab reads**, so the file is never loaded whole: the overview, the
embedding, and the metadata come from a few small datasets, and expression is read
per gene on demand.

### 1.2 Seurat `.rds` — supported, with an honest ceiling

We already ship **webR** (for DESeq2). `readRDS()` deserializes a Seurat object
*without Seurat installed* — S4 slots are readable as attributes — so we extract
`assays`, `meta.data`, and `reductions` and normalize them into the same in-memory
shape as h5ad.

Two honest caveats, surfaced in the UI rather than buried:

1. **No lazy read.** RDS is a serial stream; it must be fully materialized. Above
   roughly **1.5 GB** the browser tab will fail. The open dialog states the file
   size and warns before it tries.
2. **Layout drift.** Seurat v3/v4 store `@assays$RNA@counts`; v5 stores
   `@assays$RNA@layers$counts` with separate cell/feature maps. Both are handled,
   version detected from the object; anything else is reported, not guessed at.

When RDS is too large, offer the one-liner rather than failing:

```r
library(sceasy); sceasy::convertFormat(obj, from="seurat", to="anndata",
                                       outFile="object.h5ad")
```

### 1.3 The one performance decision that matters

AnnData `X` is **cells × genes CSR**. Row slices (a cell) are free; column slices
(a gene) require touching every row — and *every plot in this app is a gene*.

So on load we make **one O(nnz) pass to build a gene-major (CSC) index** into typed
arrays. After that, "show me Ascl1" is a single contiguous slice instead of a full
scan. This is done once, with a progress bar, and it is the difference between a
200 ms gene lookup and a 20 s one.

---

## 2. What the studio computes, and what it refuses to

`rnaseq-studio`'s rule was "statistics are DESeq2, or they are not shown." That rule
was right for bulk and **wrong here**: bulk RNA-seq without replicates is a design
error, whereas single-cell without replicates is the norm. The rule that carries over
is the principle underneath it — *every number is labelled with the test that produced
it, and nothing is shown that has not been computed* — not the specific engine.

### 2.1 Differential expression — Wilcoxon by default, pseudobulk by choice

**Most single-cell experiments have no replicates.** A design rule that blocks on
them would make the studio useless for the majority of real objects, so the default
is the test the field actually runs.

**Default — `FindMarkers` / `rank_genes_groups`.** A Wilcoxon rank-sum test across
cells, with Seurat's own defaults: `logfc.threshold` 0.25, `min.pct` 0.1, and
Bonferroni adjustment over the genes tested. It requires no replicates and is
available on every object with two or more groups. We implement the same test in
JavaScript rather than shipping R for it, so it runs instantly and matches what a
reviewer would reproduce in Seurat.

**Option — pseudobulk → DESeq2, offered only above 3 samples per group.** Summing
raw counts per (sample × cell type) yields a genes × samples matrix — exactly the
shape `rnaseq-studio/src/lib/deseq.ts` already accepts, so there is no second
statistics engine. Below four samples per group the button is disabled and states
why. Cells are excluded from a pseudobulk column when a sample contributes fewer
than 10 of that type, because power "is heavily dependent on the abundance of the
cell state" (doi:10.1016/j.cell.2021.04.048); the exclusions are shown, never silent.

The two tests are **not interchangeable, and the UI says so** rather than letting
the user assume the bigger number is the better one:

> "Leveraging pseudobulk values removes the inherent lack of independence that
> characterizes multiple cells from the same individual, which would otherwise lead
> to substantial false positives for standard single-cell differential expression
> workflows." — doi:10.1101/2024.10.15.618577

So whenever both are available, each result names the other's count in a line the
user cannot miss: *"The other test gives 4."* Per-cell testing is for exploring;
pseudobulk is for a claim that has to survive a new animal. On a one-sample-per-group
design the Methods text states plainly that the p-values describe variation between
cells, not between animals — the study is not blocked, it is described accurately.

### 2.1a The gates are a control, not a constant

`FindMarkers` does not test every gene. Seurat applies two gates first —
`logfc.threshold` 0.25 and `min.pct` 0.1 — and a gene failing either is dropped without
being tested at all. They are speed pre-filters: skipping the rank sum is most of what
they buy, and the genes they drop are ones no test would have called.

They were constants here, and that made them the one filter in the studio nobody could
see or move. An object with twenty thousand genes returns four thousand rows, the table
pages honestly through those four thousand, and it still reads as a truncated table —
reported as exactly that. So two things changed. The count is stated under the table, with
both gate names, because a number that surprises a reader needs its reason next to it and
not in Methods. And the gates themselves are now inputs, with **Test every gene** setting
both to zero.

Two consequences, both stated on the card rather than used as reasons to withhold the
control. It is slower, because the gates were the speed. And Bonferroni is applied across
however many genes were tested, so testing twenty thousand instead of four makes the
correction five times harsher — a gene significant at Seurat's defaults can stop being
significant when you widen the gates, which is a real property of the correction and not a
bug.

There is a second inert control, and it is the one that gets reported. The |log₂FC| cutoff
runs down to 0, but a gene below the GATE has no row to admit at any cutoff — and both
default to 0.25, so the slider's whole travel below its own default is dead until somebody
widens the gate. That is stated where it happens, with the one click that fixes it:
*"No gene below 0.25 log₂ was tested… **Test them too**"*. Not done automatically, because
widening the gate re-runs the test and a slider that silently starts a four-minute pass is
the complaint immediately before this one.

The default stays at Seurat's 0.25 rather than at 0, and that is a trade rather than an
oversight: matching `FindMarkers` is what lets a reader reproduce these rows, which the
whole DE design rests on. What changed is that the gate is no longer a wall — it is one
click, and the click is offered at the moment the reader hits it.

The gates are part of the QUESTION, so they are in the pass's cache key and in the Run
gate: widening one on a streamed object re-arms Run rather than silently starting a
four-minute pass on a keystroke. Methods reads the gates in force, so a reader who has
widened them does not get a paragraph describing Seurat's defaults.

### 2.2 Two thresholds, because there are two scales

`|log₂FC| > 1` is a **bulk convention that does not transfer**. Seurat's `avg_log2FC`
is computed on log-normalized values, which compresses effect sizes; a cutoff of 1
discards nearly everything real. Pseudobulk runs on summed raw counts, which behave
like a bulk experiment.

| Test | Effect-size cutoff | Adjustment |
| --- | --- | --- |
| Wilcoxon, per cell | `logfc.threshold` 0.25 (Seurat's own) | Bonferroni |
| Pseudobulk DESeq2 | \|log₂FC\| ≥ 1 | Benjamini–Hochberg |

The headline count, the table, the volcano's dashed lines and the Methods sentence
all read from one function, so they can never disagree.

### 2.3 The object may have no comparison at all

Three shapes must all work, and the interface reshapes itself for each. All three
are in the prototype as demo objects, because a design that only survives the happy
case has not been tested.

| Object | Global bar | Contrast tabs | Default view |
| --- | --- | --- | --- |
| **Replicated cohort** (4 v 4) | cell type · control · compare | both tests | as bulk studio |
| **Time course** (0/6/24/72 h, one sample each) | cell type · control · compare | Wilcoxon only, pseudobulk disabled with the reason | groups in **file order**, never alphabetical |
| **Wild type only** (one condition) | cell type only | dimmed, with an empty state pointing at Markers and Gene expression | gene search across cell types |

Group order comes from the categorical order stored in the object, so a time course
reads 0 h → 72 h. Sorting it would be a silent corruption of the axis.

### 2.4 Gene search is a first-class way in

For a single-condition object, "what does gene X look like across my cell types" is
*the* question, and it needs no statistics at all. So the Gene expression tab leads
with a search box that takes **one gene or a whole list**: paste comma-, space-,
tab- or newline-separated symbols and they resolve case-insensitively to the object's
own capitalisation, because a list copied out of a paper or a spreadsheet is rarely
cased the way the matrix is. Symbols that do not resolve are named back to the user
with the species hint (`Ascl1` vs `ASCL1`) rather than silently dropped. Single-gene
typing still autocompletes, exact match first, so `Sox2` never sits below `Sox21`.

A **Group by** control then sets the identities, shared by all three plot types:

- **Across cell types** — one violin per cell type, every type on screen at once.
  The only mode available on a single-condition object, and the default everywhere.
- **Across groups** — within the selected cell type, in the object's own order.
- **Cell type × group** — the product, for spotting a change confined to one population.

Two plot types read the same gene list and the same identities, so they can never
disagree about what is being shown:

**Violin panel.** Each gene keeps its own y axis, column count is user-selectable, and
under every violin sits a **detection bar** — the fraction of cells expressing the
gene. Without it a dropout-heavy gene is just a spike at zero, and there is no way to
tell "absent in this population" from "absent from this dataset", a distinction
single-cell readers need constantly and most violin plots destroy.

**Seurat feature plot.** Expression painted on the embedding, one panel per gene,
splitting by group when Group by is set to one of the group modes — and then both
panels share that gene's scale, so a difference between them is real. Two details
decide whether the figure is honest: cells are drawn in **ascending order of
expression** (Seurat's `order = TRUE`), so positive cells land on top instead of being
buried under the negative majority, which can otherwise erase a real signal entirely;
and the scale is clipped at the gene's own **99th percentile**, so one runaway cell
cannot flatten everything else to the floor colour. Non-expressing cells take the
ramp's own lowest colour rather than a neutral grey — with a dark-low ramp like
viridis a grey would be *lighter* than the lowest real value, and the scale would run
backwards at its own floor.

**Seurat dot plot.** Genes on x, identities on y, dot size = fraction expressing,
dot colour = average expression, in the lightgrey→blue ramp people already know how
to read. Seurat's `scale = TRUE` default z-scores each gene *down its own column* and
clips to ±2.5, which makes the colour a claim about **where** a gene is highest, not
how much of it there is — a housekeeping gene that is high everywhere comes out
uniformly pale. That is the most misread property of this figure, so scaling is an
explicit switch with the consequence stated under the plot in both positions, rather
than a silent default.

Genes on x is Seurat's orientation and it is right for the handful of genes this tab
was first built for. It is the wrong one for a marker panel, and the panel is now
allowed to be one: the list takes **up to 100 genes**, at which point genes on x is a
plate 3 176 units wide with every name rotated, against 540 × 2 046 the other way
round — a figure you scroll rather than a figure wider than any page. So the axes are
swappable, which is also how pheatmap, ComplexHeatmap and scanpy's `dotplot` draw the
same data. Only the layout changes: one function maps a plate square to a
(identity, gene) pair, and the dendrograms are named for the quantity they order
rather than for the side of the plate they were on, so both follow their own axis
across the swap.

### 2.5 Figure palettes are a product feature, not a default

A figure that has to be recoloured by hand before submission is a figure the studio
half-finished. So palette choice is global — set once on Overview, applied to every
figure at once — and the options are the ones journals' own figures use, as
distributed in ggsci: **npg** (Nature), **aaas** (Science), **lancet**, **nejm**,
**jco**. Categorical colours fall back to golden-angle hue generation past the tenth
entry, so a long cluster list never wraps round and gives two populations the same
colour — the bug the bulk studio shipped once with a 23-arm design.

Continuous expression ramps are offered separately: the Seurat grey→blue default and
the Cell-style grey→red because readers recognise them, plus **viridis** and **magma**,
which are perceptually uniform and safe for colour-vision deficiency — the reason they
have largely displaced rainbow scales in the journals.

### 2.6 Marker genes ≠ condition DE

Cluster markers answer *"who is this cluster"* and are one-vs-rest within a dataset;
they are ranked and labelled as a **descriptive ranking, not a hypothesis test**
— the clusters were defined by the same expression the test then scores, so the
p-values are circular. We show effect sizes (log fold-change, pct.1/pct.2) and mark
the p-value column as "for ranking only". This is the single most common
misreading in single-cell papers and the UI takes a position on it.

### 2.7 QC is reported, not redone

> "Quality control is performed at the sample level as thresholds can vary
> substantially between samples." — doi:10.1038/s41576-023-00586-w

> QC covariates "should be considered jointly when univariate thresholding decisions
> are made, and these thresholds should be set as permissive as possible to avoid
> filtering out viable cell populations." — doi:10.15252/msb.20188746

The studio shows the **three covariates jointly, per sample** — total counts,
genes detected, % mitochondrial — as violins with a scatter view, and reads the
thresholds already applied from `uns` when the pipeline recorded them. It offers a
*preview* filter (MAD-based or manual) that reports how many cells each threshold
would remove, but writes nothing.

Ambient RNA and doublets are **upstream** concerns (SoupX, CellBender, DecontX,
doi:10.1038/s42255-023-00876-x). The studio detects whether they ran, from `uns`
keys and obs columns, and states plainly: *"no doublet call found in this object"*
— rather than pretending or silently correcting.

### 2.8 Composition inherits the same independence problem

Cell-type proportions are plotted **per sample**, never pooled per group, for exactly
the reason pseudobulk exists: cells from one animal are not independent observations.

Two charts, and the form of each is doing work:

1. **A horizontal 100% stacked bar per sample.** Horizontal because the quantity is a
   percentage, and percentages are compared along a shared axis — vertical stacks make
   the reader estimate heights against nine different baselines. The value is printed
   inside any segment wide enough to hold it, and omitted where it would clip; a
   truncated "1%" is worse than no label.
2. **A small-multiple bar chart per cell type**, groups on the x axis, **each panel on
   its own y axis** with nice round ticks. A shared axis would flatten every population
   except the largest — Pericytes at 0.2% and Neuroblasts at 21% cannot share a scale.
   Where there are replicates, the individual samples are drawn over the bar as points
   with a range line, so an apparent difference that the animals do not support is
   visible as overlap rather than hidden inside a mean.

---

### 2.8a Several signatures, one pass

A module score is a weighted walk over the genes that carry a weight, and nothing about
that walk is specific to one signature — so scoring seven sets one at a time reads the
matrix seven times for no reason. On an object held in memory that is a wasted second; on
a 5.8 GB collection it is seven passes of several minutes each, which decides whether the
comparison gets made at all. Somebody who has just pasted seven pathways wants all seven.

So the weights are held gene-major and sparse — a CSR over genes, each entry naming a SET
and the weight it gives that gene — and one walk accumulates every signature at once. Gene
major because the pass is gene major: one lookup per gene, then one walk over its cells
adding to however many sets weight it, which for a real signature is one or two. A dense
`nSets × nGenes` matrix holds the same information and would make the inner loop
proportional to the number of sets rather than to the number of sets that contain the gene.

What is shared is the pass, **not the statistics**. `scoreManyPlan` runs the ordinary
`scorePlan` per set, so every signature keeps its own control genes, matched to its own
expression levels; sharing one control set across seven would be faster still and would
score every one of them against the wrong baseline. `scripts/test-sets.mjs` holds the two
paths to **bit-for-bit** equality rather than to closeness — the same genes are folded in
the same order with the same weights, so anything but an exact match would mean the shared
pass had changed one of the answers.

The figure is signatures down the side, populations along the bottom, on a diverging scale
centred on zero — a module score is signed and its zero means "no higher than genes of
comparable abundance", so a scale whose neutral sits anywhere else misreports which way a
population went. On the demo the five SVZ programmes land where they should: quiescence
highest in qNSC, activation in aNSC, proliferation in TAP, each negative in the others.

Capped at thirty sets. Not a limit on the pass, which is one walk whatever the number, but
on the two things that do grow — one Float32 per set per cell (thirty across the atlas is
35 MB) and a figure that stops being readable long before that.

### 2.8b "Across groups" is a question about the object, not about one cell type

`identities()` in chart.ts answers "which rows does the GENE tab draw", and there "across
groups" legitimately means *within the cell type selected beside the figure* — a violin
panel is showing one population's response to a treatment, and the cell type is a parameter
of it.

A module score across groups is a different question, and it was being answered with the
same function. "How does this signature move between aged_HFD and aged_chow" is asked of
the whole object; answering it for whichever cell type happened to be selected in a bar at
the top of the page produced a figure that reads as the first question and is the second,
with nothing on it saying so. Reported as a bug, and it was one.

`lib/columns.ts` is the fix. A column there carries its own CELLS rather than a
(cell type, group) pair — which is what lets a group pool every cell type, something no
pair can express, since `src.group(ti, cond)` has no "all types" to pass. Across groups on
the demo now covers 14 920 + 19 447 = every cell, where before it covered one cluster's.

Two things came with it. Both gene-set cards take the same **column filter** the per-gene
heatmap already had, filtering cell types and groups on two axes rather than over their
product — 133 clusters against 20 groups is 2 660 toggles, which is not a control. And the
several-signature grid can **z-score along each row**, because a signature of eight abundant
genes and one of forty rare ones cannot be compared on a shared absolute scale; scaled, a
row says where that signature is highest rather than how large it is. Scaled after
filtering, so removing a population changes the scale — the same rule the per-gene heatmap
follows.

The per-gene heatmap goes through it too, and gained something from the move. It used to
read `src.mean(gene, ti, cond)`, which *needs* a cell type to ask about — that is why its
"across groups" was one cluster's cells, and why it re-read the matrix every time somebody
switched grouping. It now reads once at the **finest partition** the object has, one part
per populated cell type × group, and keeps sums and counts rather than means. Every column
any grouping can draw is a union of those parts, so regrouping and re-filtering are
arithmetic on numbers already in hand: no pass over the file, ever, after the first.

Sums and counts, never means, because a mean is not additive. The mean over a union is the
sum of the parts' sums over the sum of their sizes; averaging the parts' means instead
would weight a part of forty cells the same as one of four thousand — which on a real
annotation, where cell type × group is wildly unbalanced, is not a rounding difference.

With no figure on the tab reading it any more, the shared **Cell type** selector is gone
from the bar above it. A control nothing reads is how "across groups" came to mean "across
the groups of one cluster" in the first place.

One thing went away rather than being fixed: the single-set card's "My own genes" textarea,
a second way in that scored a pasted list without it ever becoming a collection. "Add your
own…" replaced the problem it was working around — a pasted list is a collection now, it
sits in the picker beside MSigDB's, it can be switched on and off, and it is testable in
Enrichment as well as scorable here. Two doors for one gene list, one of which produced
something the rest of the studio could not see, was a fork with nothing on the other side.

### 2.9 A metabolic library, because MSigDB does not publish one

Over-representation is corrected across everything tested. A reader asking whether a
contrast is metabolic has, in MSigDB, no way to ask only that: the metabolic pathways
and the metabolic ontology terms are real and well curated, and they are scattered
across KEGG, Reactome, WikiPathways, Hallmark, PID and GO:BP with signalling, disease,
development, protein turnover and mRNA decay beside them. Testing the default library
to find out about glycolysis spends the correction on nine thousand terms nobody asked
about.

So `scripts/derive-metabolic.mjs` assembles one — **1 533 sets for human, 1 391 for
mouse**, 181 and 178 kB, offered beside the databases it drew on and off by default.

The first version of this file was a **subset** that kept its parents' systematic ids,
so that a set present in two enabled collections would be folded and tested once. That
was correct arithmetic and the wrong product: the parent collections are on by default,
so `indexFor` folded every one of its sets away and switching the collection on changed
nothing a reader could see. A collection that does nothing until you switch four others
off is not a collection beside the others, it is a mode. It is independent now, and
independent means two things, both of which cost something:

- **Its own ids.** Every set is `METABOLIC_` + the id it was assembled from, so no fold
  can remove it and every hit is reported under Metabolic whatever else is enabled. The
  price is that a pathway also present in an *enabled* parent is now tested twice and
  enters the Benjamini–Hochberg correction twice. That is stated on the card, in the
  warning colour, naming the parents actually on and offering the fix — switch them off
  and the test is metabolism alone. The parent id is recoverable by dropping the prefix,
  so a hit is still citable as the pathway it is, and `scripts/test-sets.mjs` checks
  that dropping the prefix names a real set in a parent and that its members are that
  set's, unchanged.
- **Its own content.** GO:BP and GO:MF are sources here, not only the curated pathway
  collections, so the library carries 1 031 metabolic terms no pathway database has —
  which is what makes it worth enabling *next to* a full default library rather than
  instead of one.

Merged into one collection, Hallmark's "Glycolysis", Reactome's and WikiPathways' are
three different sets whose source column now reads "Metabolic" for all three. So the
origin goes in the **name** — `Glycolysis (Hallmark)`, `Glycolysis (Reactome)` —
because three identical rows in a results table tell a reader nothing. The test asserts
the names are unique for exactly that reason.

**Which terms, and how they were chosen.** By hand, into `scripts/metabolic-terms.tsv`,
which is committed and is the input this build reads. It is not a rule the script
evaluates, and that is the second thing this section had to change.

It *was* a rule — a vocabulary of forty metabolic words matched against the systematic
name, guarded differently for pathway databases and for ontologies. A vocabulary is only
ever as good as the correlation between what a pathway is called and what it is about,
and that correlation fails exactly where it matters. It missed
`KEGG_PENTOSE_AND_GLUCURONATE_INTERCONVERSIONS`, a metabolic map with no metabolic word
in it; `REACTOME_COMPLEX_I_BIOGENESIS`, which builds the respiratory chain;
`REACTOME_MITOCHONDRIAL_BIOGENESIS`; `KEGG_INSULIN_SIGNALING_PATHWAY` and
`KEGG_PPAR_SIGNALING_PATHWAY`, whose whole subject is metabolic control; and
`KEGG_TYPE_II_DIABETES_MELLITUS`. No vocabulary catches those without catching half of
signalling with them.

So all **15 646** term names in the pathway and ontology collections — the union across
both species, since they share systematic ids, so each term is decided once — were read
and judged against written criteria, and **2 813** were kept. A list is auditable in a
way a regexp is not: it diffs, it can be argued with line by line, and it cannot quietly
change its mind about a term nobody was looking at. `scripts/test-sets.mjs` holds the
six terms above as the regression, so a return to matching fails.

The criteria are the boundary: the biochemistry of small molecules, energy metabolism,
redox and one-carbon, storage and mobilisation, metabolite transport, the pathways that
*regulate* metabolism, metabolic disease, metabolic enzyme activities, and the
compartments that exist to do metabolism. Not macromolecule turnover, which GO also
calls metabolism — protein, RNA and DNA metabolic processes, translation, the proteasome
— nor the top-of-hierarchy terms that cover everything, nor signalling and development
where a metabolite is incidental.

**One statement, one set.** The library said "oxidative phosphorylation" sixty times
over: every electron-transfer step, every respiratory complex's assembly, each database's
own copy, and the GO regulation-of terms above them. Sixty sets that are one claim at
different resolutions is sixty rows in a results table for one finding, and sixty of the
tests the Benjamini–Hochberg correction is spread across — the same disease the whole
collection exists to cure, inside the collection. That family is consolidated to **four**:
Hallmark's and KEGG's oxidative phosphorylation, Reactome's aerobic respiration, and
mitochondrial biogenesis, which is a different question from respiring. Terms whose
subject is another family that merely happens in the mitochondrion — beta-oxidation, the
TCA cycle, iron–sulfur clusters, mitochondrial fatty acid synthesis — stay with their own
kind, and the test checks that consolidating the organelle did not cost the biochemistry.

Ribosomes needed no consolidation: they are macromolecule turnover and the criteria never
admitted them. The single survivor,
`GOBP_NONRIBOSOMAL_PEPTIDE_BIOSYNTHETIC_PROCESS`, is genuine small-molecule metabolism and
is named for what it is *not*.

**A curated list rots, so it is watched.** A term the list names that no collection ships
is a rename nobody noticed, and the test fails on it. A term in a new release that *looks*
metabolic and is in neither record is reported by the build — which is what the old
vocabulary is now for, and its only remaining job. The 428 terms that were judged and
deliberately left out are written down too, prefixed `!`, so the build can tell "nobody
has looked at this yet" from "somebody looked and said no", and so the second is arguable
in a diff instead of invisible.

### 2.10 Co-expression, and the three ways it lies

"Which genes move with this one" needs no statistics beyond a correlation, and it is one pass
over the matrix: for every gene, accumulate three sums against a seed and throw the values
away — the same shape as markers and the module score, so it is a fifth job kind in the same
worker. What the design is actually about is the three ways the obvious version misleads.

**Shared zeros.** A Pearson correlation across cells on a ~1% dense matrix is largely a
statement about absence: two genes detected in 8% of cells agree in the other 92% for no
biological reason. Two defences, both on by default. A **detection floor** — a gene under 10%
of the cells in scope is not ranked, Seurat's `min.pct` doing the same job it does for markers —
and **metacells**, the scope's cells split into near-equal pools by repeated proportional median
cuts of the embedding. Equal-sized, so no pool is one cell wearing a hat; spatially contiguous,
so averaging removes dropout without averaging away the local structure the correlation is meant
to find. On the demo the difference is visible and is the argument: the aNSC module against
`Ascl1` reads r ≈ 0.998 over metacells and 0.849 per cell, and the per-cell number is the
attenuated one.

The construction follows **hdWGCNA** (Morabito et al., *Cell Reports Methods* 2023), which is
where metacells-for-co-expression comes from, and it follows it in the part that matters most:
a metacell may not span two cell types or two samples. That is hdWGCNA's `group.by`, and without
it two populations that happen to sit next to each other in the embedding share pools and the
"co-expression" that results is two populations rather than one programme — while pooling across
animals quietly averages away the replicates a later claim rests on. The pool budget is shared
out among the groups in proportion to their size, which is why the cutting is proportional rather
than binary: twenty groups each rounding down to a power of two is a systematic shortfall in the
one quantity this mode exists to have enough of. A group too small to build a metacell from —
under ten cells, the same floor pseudobulk DE applies — is dropped rather than allowed to stand
as a metacell of four, and the card reports how many cells that cost.

Two things it does **not** follow. hdWGCNA builds metacells by KNN in a reduced space with many
components; a bundle carries only 2-D embeddings, so neighbours here are close to, but not the
same as, neighbours in expression space. And hdWGCNA's reason for metacells is to then construct
a network — soft-thresholded adjacency, topological overlap, dynamic tree cut — which this does
not do. What the studio has is the supervised half: given a gene or a signature, rank every gene
against it. When the seed is a set, that ranking *is* hdWGCNA's **kME**, since the seed is the
module eigengene and kME is defined as a gene's correlation with it.

**n is not the sample size.** With 292 495 cells, r = 0.01 carries p ≈ 1e-5. Every gene is
"significant", the ranking is unmoved by the p, and cells from one animal are not independent
draws — the argument this studio already makes for Wilcoxon against pseudobulk. So the result
carries r and the detection rate and **no p-value**. A column of 1e-300 beside r = 0.02 would be
a number that looks like evidence and is not.

**A set is not its mean.** Seeding with the average of a signature's members is what everyone
writes first, and it cancels: a pathway holds activators and repressors, and the mean is
dominated by whichever members are most abundant. So the set is correlated **with itself** first;
each member is standardised, and signed by the leading eigenvector of the member correlation
matrix — WGCNA's module eigengene, by power iteration because the matrix is at most a few
hundred square. Only then are they combined.

The identity that makes that affordable is worth writing down. With each member standardised to
unit norm, r(g, m) = ⟨ĝ, ẑ_m⟩, so a weighted mean of the members' own independent correlations is

    Σ_m w_m s_m r(g, m) = ⟨ĝ, Σ_m w_m s_m ẑ_m⟩

— the correlation of g against **one** composite vector, up to its norm. Correlating each member
separately and combining afterwards, and correlating once against the signed composite, are the
same number; `scripts/test-correlate.mjs` asserts that the two orderings are identical and that
their ratio is one constant across genes. One pass therefore reports what |set| passes would
have said.

Coherence is reported with the result, not hidden: what share of the members' variance runs one
way, how many were inverted, and the mean pairwise r after signing. Two programmes written down
as one set is a common and legitimate finding — a pathway with an arm that goes the other way —
and the honest response is to say so and let the reader split it, rather than average it into
silence. On a deliberately mixed seed (five quiescence markers, five proliferation markers) the
card reports 61% coherence with 5 of 10 inverted, and returns Mcm5/Pcna/Ccnd1 on one side and
Hes1/Hes5/Notch1/Cdkn1a/Cdkn1b on the other.

Four axes are offered because they answer four questions. **Metacells** is the default.
**Per cell** is the unpooled version, offered because it is what a reader expects to find and
kept honest by the caption.

**Cell type × group** builds one column per populated cell type × level, averaged from the
cells themselves. This is what most people mean by "correlate over pseudobulk", and unlike the
mode of that name it is available on every object: the columns come from the expression the
studio already reads, so nothing has to have been exported for it and nothing has to be held as
a dense table. That distinction is not academic — `collection-source.ts` drops the exporter's
pseudobulk past 12 M values, so the objects large enough to want the analysis are exactly the
ones that never had it, and the mode was disabled on essentially everything. Columns can be cut
by group or by sample; one built from fewer than ten cells is dropped rather than drawn, the
same floor pseudobulk DE applies. Scoped to a single cell type the product collapses — nine
types × two groups is eighteen columns, one type × two groups is two — and the card says so and
names the way out rather than drawing a correlation over two points.

**Pseudobulk** is the exporter's own table: summed RAW counts per sample × cell type. It stays
a separate mode and a separate name, because it is not the same quantity — summing counts and
normalising afterwards is a log of means, where averaging the studio's values is a mean of logs.
Both are defensible summaries of a population and they are not interchangeable, so the interface
refuses to put them under one label.

### 2.11 Your own gene sets, in whatever you keep them in

The studio could take a GMT and nothing else, behind a control labelled "Add a GMT…". That is
the Broad's interchange format and almost nobody's working format: what a person has in front of
them is the dict they built the analysis with, in a notebook, one keystroke from the clipboard.
Asking them to convert it first is asking them to write a script in order to use a studio whose
premise is not having to.

So the control is a **text box**, and `parseSets` meets the input where it is — a Python dict
with a variable name in front of it, an R `list(x = c(...))`, JSON in three shapes, a GMT, an
Excel paste, `Name: gene, gene` lines, or a bare column of symbols for one set. Reading a file
still exists, inside the same dialog, and goes through the same parser: a file is only a paste
that arrived differently.

Two decisions carry the design.

**A scan, not a parser.** Strict JSON is tried first and costs nothing when it fails; everything
after it is tolerant by construction. A `JSON.parse` rejects a trailing comma, and a Python
literal is not JSON at all — somebody pasting out of their own notebook must not be told their
input is malformed because of a comma their language allows. The consequence is that the reader
can only ever get *fewer* sets than they meant, never a thrown error on syntax.

**Which makes the panel underneath the actual feature.** Every set found, how many of its genes
this object measures, and which ones it does not — before anything is added. A silent parse is
the failure mode of every paste box ever built: it reads three of your twelve sets and reports
success. This says what it understood while the input is still one edit away from right, and on
an object that cannot answer for the sets at all it says that too, which is the more common
disappointment — a mouse signature pasted onto a human object matches nothing, and the reason is
capitalisation.

One rule worth recording because it could have gone either way: a repeated set name **replaces**.
`JSON.parse` resolves a duplicated key to the last one before the parser is ever called, and
Python and R resolve their own literals the same way, so first-wins on the text paths would have
meant one input giving two answers depending on whether it happened to be strict JSON.

## 3. Interface

### 3.1 The global bar — set once, applies everywhere

The lesson from the 23-arm bulk stress test: selection belongs to the app, not the
tab. Single-cell adds one axis, so the bar carries three controls:

```
Cell type ▾  |  Control ▾  |  Compare ▾          Wilcoxon · per cell · no replicates required
Cell type ▾                                      Single condition · 1 sample
```

Changing the cell type re-scopes every tab at once. `design.ts` generalizes from
`{control, groups}` to `{cellType, control, groups}` — the same select-all /
remove-all affordances, the same precomputed contrast list.

The bar is **built from the object, not fixed**: a single-condition file gets no
control/compare selectors at all, because offering a comparison that cannot exist
is how a user ends up reading a number that means nothing. The status chip always
names the test in force and why it is the one available.

Two view settings sit at the far end of the bar, on the same reasoning as the
selection: they move every figure in the studio, so a control living on one tab would
be a setting you change in one place and walk somewhere else to see. **Figure style**
is the palette and the expression ramp. **Group order** is the order the group levels
are drawn in — the object's own by default, because a categorical order is usually a
design and sorting it would destroy that, and one click back to it from anywhere.

Reordering is a view of the object and must never become an edit of it, so it is one
rewrite of one array: `Dataset.conds`. Every figure that splits by group reads its
levels from there, so all of them move together and none of them needed changing. It
is safe as a permutation because a group is identified by NAME everywhere below the
Source — `group(ti, cond)` takes the name, each cell carries the name, the pseudobulk
design reads it off the sample — so no cell can change group when a level changes
place. `scripts/test-order.mjs` asserts exactly that: same cells, same means, same
pooled selections, before and after.

### 3.2 Tabs

```
Overview · Cells · Composition · Markers ‖ DEG table · Volcano · Enrichment ·
Gene expression · Gene sets · Methods
```

The four tabs before the divider are single-cell-specific. **Everything after it is
`rnaseq-studio`'s tab bar in the exact order approved there** — a user arriving
from the bulk studio finds every downstream tool where they left it, now carrying a
test selector because single-cell has two defensible answers where bulk had one.

| Tab | Content |
| --- | --- |
| **Overview** | cells / genes / samples / clusters; per-sample QC violins; provenance strip marking every step **from your file** vs **computed here**; missing-piece warnings (no raw counts → DE disabled, with the reason) |
| **Cells** | embedding on WebGL canvas. Colour by cluster, condition, sample, QC metric, or gene. **Split by condition side-by-side with a shared axis range** — the honest way to show a condition effect on a map |
| **Composition** | per-sample stacked proportions + per-cell-type dot plot with sample points |
| **Markers** | ranked one-vs-rest table + dot plot (mean expression × % detected). Cluster renaming lives here, and names propagate to every other tab and to Methods |
| **DEG table · Volcano · Enrichment** | as `rnaseq-studio`, for the selected cell type, under a **Test** segmented control — Wilcoxon per cell (default) or pseudobulk DESeq2 (only above 3 samples per group). Dimmed entirely on a single-condition object |
| **Co-expression** | a seed (one gene, or a signature sent over from Gene sets) correlated against every gene, over metacells, single cells, cell type × group columns or the exporter's pseudobulk; both ends ranked, with the set's own coherence reported beside the score |
| **Gene expression** | gene search with exact-match-first ranking, one gene or up to 100 pasted; **Group by** across cell types / groups / their product; **Plot** as violin panel (independent y per facet, selectable columns, relative-to-control, detection bars) or **Seurat dot plot** (size = % expressing, colour = average expression, scaling switchable, axes clusterable and swappable) |
| **Methods** | continuous prose, superscript numbered citations, one reference per tool, cutoffs read from the object |

### 3.3 Carried over without change

Everything the bulk studio already paid for in user feedback: exact-match-ranks-first
autocomplete, untruncated pathway labels, user-selectable term count, `ErrorBoundary`
keyed on tab (never on selection — that wipes typed input), full project name with
no truncation, contrast labelled on every figure, results hidden entirely when the
selected pair has not been computed.

---

## 4. Scale

| Cells | Behaviour |
| --- | --- |
| ≤ 50 k | everything interactive |
| 50 k – 250 k | embedding switches to a density/hex view above a point threshold; per-gene reads stay lazy |
| > 250 k | opens read-only in summary mode; gene lookups still work, per-cell scatter is binned |

Pseudobulk is unaffected by cell count — it collapses to *samples*, so DE stays fast
at any scale. That is a second reason the pseudobulk choice is the right one.

---

## 5. What this app deliberately does not do

Not clustering, not integration, not trajectory inference, not annotation transfer.
Those need the full dataset, real compute, and method choices that belong to the
analyst — and on Theis's own evidence they are where over-correction happens:

> "Data integration and batch correction should be performed by different methods.
> Data integration tools may over-correct simple batch effects."
> — doi:10.15252/msb.20188746

> "Users should be cautious of signals found only after expression recovery.
> Exploratory analysis may be best performed without this step."
> — doi:10.15252/msb.20188746

The studio therefore never imputes or denoises, and shows what the object contains.
If someone needs the upstream work done, that is a `scrnaseq-lab` — a separate app,
the same way `rnaseq-lab` is separate from `rnaseq-studio`.

---

# Why the defaults are what they are

Moved from the README so that document can describe the tool. Unchanged.

**Most single-cell experiments have no replicates, so nothing blocks on them.** The default test is
the one Seurat's `FindMarkers` and Scanpy's `rank_genes_groups` run — a Wilcoxon rank-sum test
across cells, with Seurat's own gates (`logfc.threshold` 0.25, `min.pct` 0.1, Bonferroni).
Pseudobulk → DESeq2 is offered as an alternative and only above three samples per group, where it
is defensible. When both are available each result names the other's count, because the larger
number is not the better one: per-cell testing is for exploring, pseudobulk is for a claim that has
to survive a new animal.

**The groups are drawn in the order the file wrote them, until you say otherwise.** A
categorical order in an object is usually a design — `0 h, 6 h, 24 h, 72 h`, `young_chow,
young_hfd, old_chow, old_hfd` — so sorting it would destroy information, and it is the default
everywhere. It is also not always the order a figure wants, so **Group order** in the top bar
moves a level and every figure that splits by group follows at once: the split embedding, the
composition bars, the violins, the dot plot, the feature panels, the gene-set heatmap. Nothing is
recomputed and no cell moves — a group is identified by name everywhere below the figures, and
Control and Compare are chosen by name too, so they do not move with it.

**A correlation across cells is three traps, and the defaults step around all three.** Pearson
r on a matrix that is ~1% dense is mostly a statement about shared absence, so a gene detected in
under 10% of the cells in scope is not ranked and cells are pooled into near-equal **metacells**
before correlating — following hdWGCNA, including the part that matters: no metacell spans two
cell types or two samples, so a pool cannot be two populations that merely sit near each other in
the embedding. With tens of thousands of observations any r is "significant" and cells from
one animal are not independent draws, so the table reports r and the detection rate and **no
p-value at all**. And a signature seeded as the mean of its members cancels — a pathway holds
arms that move in opposite directions — so the set is correlated with itself first and each
member standardised and signed by the leading eigenvector before they are combined. Because the
members are standardised, that one composite correlation *is* the weighted mean of their own
independent correlations; how much of the set runs one way is reported with the result.

**Two cutoffs, because there are two scales.** `|log₂FC| > 1` is a bulk convention that does not
transfer — single-cell values are log-normalized before testing, so effect sizes are compressed and
a cutoff of 1 discards almost everything real. The per-cell test reports at Seurat's
`logfc.threshold`; pseudobulk, which runs on summed raw counts, keeps the bulk cutoff. One function
feeds the headline count, the table, the volcano's dashed lines and the Methods sentence, so they
cannot disagree.

**The object may have no comparison at all.** A single-condition file gets no control/compare
selectors and the contrast tabs stay empty rather than inventing a pair. A time course keeps its
groups in the object's own categorical order — 0 h first, 72 h last, never alphabetical.

**Nothing is shown that has not been computed.** No substitute contrast, no stale numbers, and a
Methods generator that will not claim doublet removal, ambient-RNA correction or a batch correction
it did not find in the file.

**Enrichment tests against your object, not the genome.** The background is the genes the object
actually measured. Scoring against genes the assay could not detect inflates every enrichment it
produces, and the header states the background size so the number is checkable.

**Module scores subtract a matched control set.** The naive "mean expression of the signature" is
dominated by how abundant its genes happen to be — a ribosomal signature scores high in every cell
and means nothing. Subtracting a control set drawn from the same expression bins is what makes zero
a meaningful reference.

**One set of cutoffs, shared by every tab.** padj and |log₂FC| live at app level, not per tab, so the
table, the volcano's dashed lines, the enrichment input list and the Methods sentence all read the
same two numbers. Moving a slider cannot leave one of them describing a different experiment — and
switching test resets them, because the two tests are on different scales.

**Everything is exportable.** Every figure has a PNG button and every table a CSV button. The
figures are hand-drawn SVG whose colours are CSS custom properties, so export inlines the computed
style first; without that a serialized `<svg>` has no document to resolve `var(--ink)` against and
comes out black on black.

**Every gene is a link.** Click a row in the DEG table, a point in the volcano, a member gene of an
enriched term, or a gene in a scored signature, and it opens in **Gene expression**.
