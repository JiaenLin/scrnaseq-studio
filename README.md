# scRNA-seq Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Open a processed single-cell object and compute on it — in your browser.**

Convert a Scanpy `.h5ad` or a Seurat `.rds` in [scRNA-seq
Lab](https://jiaenlin.github.io/scrnaseq-lab/), then open the one file it gives you here. The
studio shows what is actually in it and runs the analysis on top: one-vs-rest markers,
differential expression, over-representation enrichment and per-cell module scores, with the
figures, the tables and the Methods paragraph that go with them.

It is a studio, not a pipeline. **It does not cluster, integrate or normalise** — the object
arrives with those already done, and the Overview marks every such step as coming *from your
file* rather than quietly redoing it. **Your file never leaves your computer** — there is no
server and nothing is uploaded.

**→ [jiaenlin.github.io/scrnaseq-studio](https://jiaenlin.github.io/scrnaseq-studio/)**

## Any size

An atlas opens as one intact dataset. Nothing about how it is stored reaches the interface:
there is no part picker, no "viewing 3 of 43", no tab that works only on small objects.

Measured on the deployed site on 2026-08-09, on a 9.3 GB source object — 292,495 cells,
31,053 genes, 133 clusters, delivered as one 5.83 GB file the lab split into 43 pieces. The
object is not in this repository, so these three numbers have not been re-measured since:

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
| **Overview** | cells / genes / samples / clusters; per-sample QC violins; a provenance table marking every step **from your file** vs **computed here**; **the run that produced the object**, record by record as its `uns` holds them; which carried column is the cell type and which the group, when the object carries more than one |
| **Cells** | the embedding on canvas, coloured by cluster, group, sample or, when the object records it, % mitochondrial; split by group on one shared axis range. A gene's expression is on **Gene expression**, as a feature plot |
| **Composition** | horizontal 100% stacked bars per sample, plus a per-cell-type bar panel with every animal drawn on top |
| **Markers** | one-vs-rest dot plot, and cluster renaming that propagates everywhere including Methods |
| **Differential expression** | one contrast, three views of it. **Table**: sortable, filterable, significant-only, with a signed **Combined** ranking column and CSV export; click a row to open that gene. Says how many of the object's genes were **tested**, and Seurat's two pre-test gates (`min.pct`, `logfc.threshold`) are controls — **Test every gene** sets both to zero. **Volcano**: adjustable cutoffs, up/down counts, hover to read a point, click to open the gene, PNG export. **Enrichment**: hypergeometric over-representation on the DEG list — direction, set-size range, ranking and collections all adjustable, including a **Metabolic** collection — 2,610 human / 2,360 mouse sets on its own ids, chosen by reading all 15,646 pathway and ontology term names rather than matching them; click a term for its member genes with their rank among every tested gene; **paste your own sets** in whatever you keep them in — a Python or R dict, JSON, a GMT, `Name: gene, gene` lines — and see what was understood before adding them |
| **Gene expression** | gene search (one gene or a pasted list of up to 100), as a violin panel, a **Seurat dot plot** — clusterable and transposable — or a **Seurat feature plot** |
| **Gene sets** | per-cell module score (`AddModuleScore` / `score_genes`) for an MSigDB set, a derived collection or your own gene list, plus **several signatures at once** — up to 30, scored in a single pass, as a signature × population heatmap with CSV; on the embedding and per identity, with clickable member genes and a per-gene heatmap that can be z-scored or left on the object's own scale |
| **Co-expression** | Pearson r of every gene against a seed — one gene, or a signature — over metacells, single cells, **cell type × group** columns built from the cells, or the exporter's pseudobulk table; both ends of the ranking, a detection floor, CSV export. A set is correlated with itself first and its members signed, so opposing arms add to the signature instead of cancelling in its mean |
| **Methods** | continuous prose with superscript citations, cutoffs and design read from the object |

## Behaviour

**Testing.** The one test the studio runs is a Wilcoxon rank-sum test across cells,
Bonferroni-adjusted — the test `FindMarkers` and `rank_genes_groups` run. A contrast tests every
gene detected in at least 10% of cells on either side (Seurat's `min.pct`) and calls results at
|log₂FC| ≥ 0.25 (Seurat's `logfc.threshold`) as a cutoff over the tested genes; **Seurat's
defaults**, which also use 0.25 as a pre-test gate, are one click away. Markers use both gates.
Above three samples per group, **pseudobulk** sums the raw counts
per sample within the chosen cell type and exports that matrix for DESeq2; no DESeq2 runs in the
browser, and Methods says so rather than describing a test nobody ran.

**Sentinels.** When the lab's converter lists an annotator's sentinels (`EXCLUDED`,
`UNRESOLVED`: cells it did not call), those cells are drawn grey and are never a cell type — not
in a legend, a composition bar or its denominator, a marker or contrast population, or a
per-type figure — and every view that leaves them out says how many it left out.

**The run.** When the lab's converter carries the run records an object's `uns` holds (each
tool's provenance, the harness's run record), Overview shows each one as recorded: every field
under its own name, the tool, version, commit, stage and run key first wherever a record has
them, and nothing inferred. A record too large to carry is named with its size, and a bundle
with no run section says so. Methods then stops saying the file carries none of the upstream
steps, and still reads no parameter out of the records.

**One cutoff source.** The per-cell test reports at Seurat's `logfc.threshold`, and one function
feeds the headline count, the table, the volcano's dashed lines and the Methods sentence, so they
cannot disagree. padj and |log₂FC| live at app level rather than per tab, and switching test
resets them (pseudobulk's is the bulk `|log₂FC| ≥ 1`, for when the exported counts are tested).

**Group order.** Groups are drawn in the order the file wrote them — a categorical order in an
object is usually a design. **Group order** in the top bar moves a level and every figure that
splits by group follows at once, with nothing recomputed and no cell moved. Control and Compare
are chosen by name, so they do not move with it.

**Correlation.** Genes detected in under 10% of cells in scope are not ranked, and cells are
pooled into near-equal metacells before correlating, following hdWGCNA — no metacell spans two
cell types or two samples. The table reports r and the detection rate and no p-value. A signature
is correlated with itself first and each member standardised and signed by the leading
eigenvector, so opposing arms add rather than cancel; how much of the set runs one way is reported
with the result.

**Enrichment background** is the genes the object measured, not the genome, and the header states
its size.

**Module scores** subtract a control set drawn from matched expression bins, which is what makes
zero a meaningful reference.

**Single-condition files** get no control/compare selectors and the contrast tabs stay empty.
Nothing is shown that has not been computed: no substitute contrast, and a Methods generator that
will not claim doublet removal, ambient correction or batch correction it did not find in the file.

**Export.** Every figure has a PNG button and every table a CSV button. Figures are hand-drawn SVG
whose colours are CSS custom properties; export inlines the computed style first.

**Every gene is a link.** A row in the DEG table, a point in the volcano, a member gene of an
enriched term or a gene in a scored signature opens in **Gene expression**.

📄 **[Why these defaults](DESIGN.md#why-the-defaults-are-what-they-are)**

## Figure palettes

Set once under **Figure style** in the top bar, applied to every figure at once, so an exported
panel already matches the manuscript. Categorical: **studio** (the default: ten colours checked
on every pair for colour-vision deficiency, on the light and the dark ground; `docs/DESIGN.md`),
**npg** (Nature), **aaas** (Science),
**lancet**, **nejm**, **jco**, as distributed in ggsci, and **Okabe–Ito** for colour-vision
deficiency — with golden-angle hue generation past the end of a palette so a long cluster list
never wraps round and hands two populations the same colour. Continuous: two-colour ramps
(blue, the default; red, teal, purple), Seurat's grey→blue, **mako**, **rocket**, **viridis**
and **magma**, and three diverging scales for quantities with a real zero.

## Changed in this version

Saved names a script may read, renamed by the words pass (docs/DESIGN.md, "In a file"):

- the module-score CSV's first column `identity` is now what its rows are: `cell_type`, `group` or
  `cell_type_x_group`;
- Markers saves as `markers.*`, not `cluster_markers.*`;
- the per-cell module-score figure is `module_score_per_cell_*`, not `module_score_by_identity_*`.

The DE CSV: a gene kept under `logfc.threshold` but not tested has empty `p`, `padj`, `fdr_BH`,
`neg_log10_padj` and `combined` (they were written `<1e-308`, as if it were the most significant gene),
and a new last column, `not_tested`, says why. `<1e-308` now means only a real p past the double.

## Status

Real data works end to end, from PBMC 3k to a 292,495-cell atlas. PBMC 3k — 2,638 cells,
13,714 genes, as `tools/export_h5ad.py` converts `testdata/`'s object — parses in 137–219 ms and
a full one-vs-rest marker test across all 8 clusters takes 0.6–0.8 s, returning CD79A/MS4A1 for
B cells, S100A9/CD14 for monocytes, GZMB/GNLY for NK, GP9/ITGA2B for megakaryocytes. Measured
2026-11-09 with `node scripts/bench-bundle.mjs` (the statistics code the browser runs, under
Node 24 on an Apple M3 Pro), six runs.

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
npm ci
npm run lint
npm test         # statistics, bundles, collections, composition, the rendered Methods and Run card,
                 # sentinels, the lab's own bundles (testdata/lab), and the rules of what a Save writes
                 # (npm run test:export writes every Save in a browser, both themes, and measures each file)
npm run build
npm run dev      # http://localhost:5173
```

That is CI's order (`.github/workflows/deploy.yml`, Node 24). Tests import `src/lib/*.ts`
directly through Node's built-in TypeScript type-stripping, so they run against the real modules
with no build step — which needs **Node 24**. The few that check what a page SAYS render the real
components through Vite (`scripts/render.mjs`).

Figures are hand-drawn SVG and canvas rather than a plotting library: the panels here are specific
enough (detection bars, Seurat dot and feature plot conventions, per-facet axes) that a library
would have been fought rather than used, and the app ships three runtime dependencies (react,
react-dom, fflate). `npm run build` writes the app's JavaScript as one file of 529.25 kB,
173.85 kB gzipped, plus a 16.91 kB compute worker (as the build printed them on 2026-11-11).

## License

MIT
