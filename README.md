# scRNA-seq Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open a processed single-cell object and explore it — in your browser, without re-running anything.**

Bring a Scanpy `.h5ad` or a Seurat `.rds` that has already been QC'd, normalized, clustered and
embedded. scRNA-seq Studio reads it, shows you what is actually in it, and produces the figures,
the statistics and the Methods paragraph. **Your file never leaves your computer** — there is no
server and nothing is uploaded.

Fourth app in the family:

| App | Input | Output |
|---|---|---|
| [rnaseq-service](https://github.com/JiaenLin/rnaseq-service) | raw FASTQ | analysis request + sample sheet |
| [rnaseq-lab](https://github.com/JiaenLin/rnaseq-lab) | bulk count matrix | DESeq2 result bundle |
| [rnaseq-studio](https://github.com/JiaenLin/rnaseq-studio) | result bundle | figures + Methods |
| **scrnaseq-studio** | `.h5ad` / `.rds` | figures + Methods |

---

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

Every tab is functional and covered by tests. Reading real files is what remains:

- [ ] `.h5ad` reader (h5wasm, lazy hyperslab reads — see [DESIGN.md](DESIGN.md) §1.1)
- [ ] Seurat `.rds` reader (webR `readRDS`, with the ~1.5 GB ceiling stated up front — §1.2)
- [ ] gene-major (CSC) index built once on load — §1.3
- [ ] real DESeq2 in webR, replacing the simulated pseudobulk run
- [ ] a larger gene set collection — an `.h5ad` carries none, so the studio ships its own
      (18 sets across GO:BP, KEGG, Hallmark and curated signatures); MSigDB import is the next step

Until then the app opens one of three built-in demo objects — a replicated 4 v 4 cohort, a time
course with one sample per point, and a wild-type-only reference. They exist because an interface
built only for the easy case breaks on the other two, and all three are common.

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
