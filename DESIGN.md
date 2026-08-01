# scRNA-seq Studio — design

Fourth app in the family. Same contract as `rnaseq-studio`: **read a finished object,
explore it honestly, and produce statistics you can defend.** Nothing is re-processed
behind the user's back.

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
| **Gene expression** | gene search with exact-match-first ranking; **Group by** across cell types / groups / their product; **Plot** as violin panel (independent y per facet, selectable columns, relative-to-control, detection bars) or **Seurat dot plot** (size = % expressing, colour = average expression, scaling switchable) |
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
