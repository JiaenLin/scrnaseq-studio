# scRNA-seq Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open a processed single-cell object and explore it — in your browser, without re-running
anything.**

Convert a Scanpy `.h5ad` or a Seurat `.rds` in [scRNA-seq
Lab](https://jiaenlin.github.io/scrnaseq-lab/), then open the one file it gives you here. The
studio shows what is actually in it and produces the figures, the statistics and the Methods
paragraph. **Your file never leaves your computer** — there is no server and nothing is
uploaded.

**→ [jiaenlin.github.io/scrnaseq-studio](https://jiaenlin.github.io/scrnaseq-studio/)**

## Any size

An atlas opens as one intact dataset. Nothing about how it is stored reaches the interface:
there is no part picker, no "viewing 3 of 43", no tab that works only on small objects.

Measured on the deployed site, on a 9.3 GB source object — 292,495 cells, 31,053 genes,
133 clusters, delivered as one 5.83 GB file the lab split into 43 pieces:

| | |
|---|---|
| opens in | **4.0 s**, showing all 292,495 cells |
| one gene, read on demand | **3.9 ms** cold, **0.018 ms** warm |
| worst main-thread freeze while `FindAllMarkers` runs | **22 ms** — 0 gaps over 100 ms |

Three things make that work:

- **Cell-level data is resident, expression is not.** Clusters, samples, embedding and QC for
  every cell come to about 7 MB. The matrix — 5.9 GB — is never held: each gene is read from the
  file when a view asks for it, out of a gene-chunked, deflate-compressed, indexed layout.
- **Whole-transcriptome tests run off the page.** Markers, differential expression, enrichment
  and gene-set scoring run in a worker that reads the file itself, reporting honest progress and
  cancelling cleanly. Before this, the same computation blocked the tab for 3.5 seconds at a
  time; now the longest block over a four-minute pass is 22 ms, and the total for the whole
  operation is 1.71 s.
- **A withdrawn job cannot land.** Cancelling deletes its entry from the only route a worker
  message has to page state, so a stale answer has nowhere to be delivered — rather than being
  ignored by a flag someone must remember to check. Showing the wrong numbers is worse than
  being slow.

Small objects are unaffected: a bundle already in memory computes inline, exactly as before,
with no worker and no progress card.

## What it does

| Tab | Content |
|---|---|
| **Overview** | cells / genes / samples / clusters; per-sample QC violins; a provenance table marking every step **from your file** vs **computed here**; the figure-palette picker |
| **Cells** | UMAP on canvas, coloured by cluster, group, sample, QC metric or gene, split by group on one shared axis range |
| **Composition** | horizontal 100% stacked bars per sample, plus a per-cell-type bar panel with every animal drawn on top |
| **Markers** | one-vs-rest dot plot, and cluster renaming that propagates everywhere including Methods |
| **DEG table** | sortable, filterable, significant-only, with a signed **Combined** ranking column and CSV export; click a row to open that gene |
| **Volcano** | adjustable cutoffs, up/down counts, hover to read a point, click to open the gene, PNG export |
| **Enrichment** | hypergeometric over-representation on the DEG list — direction, set-size range, ranking and collections all adjustable; click a term for its member genes with their rank among every tested gene |
| **Gene expression** | gene search (one gene or a pasted list), as a violin panel, a **Seurat dot plot** or a **Seurat feature plot** |
| **Gene sets** | per-cell module score (`AddModuleScore` / `score_genes`) for a built-in signature or your own gene list, on the embedding and per identity, with clickable member genes |
| **Methods** | continuous prose with superscript citations, cutoffs and design read from the object |

## The decisions worth knowing about

**Most single-cell experiments have no replicates, so nothing blocks on them.** The default test is
the one Seurat's `FindMarkers` and Scanpy's `rank_genes_groups` run — a Wilcoxon rank-sum test
across cells, with Seurat's own gates (`logfc.threshold` 0.25, `min.pct` 0.1, Bonferroni).
Pseudobulk → DESeq2 is offered as an alternative and only above three samples per group, where it
is defensible. When both are available each result names the other's count, because the larger
number is not the better one: per-cell testing is for exploring, pseudobulk is for a claim that has
to survive a new animal.

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

## Figure palettes

Set once on Overview, applied to every figure at once, so an exported panel already matches the
manuscript. Categorical: **npg** (Nature), **aaas** (Science), **lancet**, **nejm**, **jco**, as
distributed in ggsci — with golden-angle hue generation past the tenth entry so a long cluster list
never wraps round and hands two populations the same colour. Continuous: the Seurat grey→blue
default and a grey→red, plus **viridis** and **magma**, which are perceptually uniform and safe for
colour-vision deficiency.

## Status

Real data works end to end, from PBMC 3k to a 292,495-cell atlas. Opening PBMC 3k — 2,638
cells, 13,714 genes — parses in ~200 ms and a full one-vs-rest marker test across all 8 clusters
takes ~1.6 s, returning CD79A/MS4A1 for B cells, S100A9/CD14 for monocytes, GZMB/GNLY for NK,
GP9/ITGA2B for megakaryocytes.

What remains:

- [ ] **DESeq2 on pseudobulk.** The bundle carries the summed counts and the app exports them,
      but fitting the model is not wired into the browser. Rather than label some other test
      "DESeq2", the pseudobulk tab hands you the matrix for `DESeqDataSetFromMatrix`.
- [ ] **A marker pass is off the page but not yet fast** — 266 s on the 292,495-cell atlas,
      against 272 s before. The tab stays live throughout, which was the point, but the work
      itself is unchanged. Markers treat every gene independently and the engine already
      describes the matrix as a gene range, so splitting the pass across several workers would
      be close to linear; the care needed is that merging must restore gene order exactly or
      sort ties move.
- [ ] **The inline path is ungated by size.** A plain single bundle always computes on the main
      thread, however large — a 2,638-cell object still blocks for ~470 ms. The collection
      format is what lifts the ceiling, not the engine.
- [ ] Opening a `.h5ad` or `.rds` directly, without the conversion step (h5wasm and webR —
      see [DESIGN.md](DESIGN.md) §1.1–1.2)
- [ ] MSigDB import; the studio currently ships 18 sets across GO:BP, KEGG, Hallmark and
      curated signatures, because an `.h5ad` carries none the way a bulk result bundle does

Three built-in demo objects are also available — a replicated 4 v 4 cohort, a time course with
one sample per point, and a wild-type-only reference. They exist because an interface built only
for the easy case breaks on the other two, and they run through exactly the same statistics code
as a real bundle, so the demo path cannot quietly diverge from the one that matters.

## Design notes

[DESIGN.md](DESIGN.md) records every methodological choice and why, with the literature it came
from. [docs/prototype.html](docs/prototype.html) is the single-file prototype this was promoted
from — kept because it is a faster place to try a layout than the app is.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # gene search, statistics gates, demo-object consistency
npm run lint
npm run build
```

Tests import `src/lib/*.ts` directly through Node's built-in TypeScript type-stripping, so they run
against the real modules with no build step — which needs **Node 24**.

Figures are hand-drawn SVG and canvas rather than a plotting library: the panels here are specific
enough (detection bars, Seurat dot and feature plot conventions, per-facet axes) that a library
would have been fought rather than used, and it keeps the bundle at ~83 kB gzipped.

## License

MIT
