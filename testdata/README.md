# Test data — PBMC 3k

Two well-annotated versions of the same 10x Genomics PBMC 3k dataset, one per input
format. **Not committed** — `*.h5ad` and `*.rds` are in `.gitignore`. Re-fetch with
`bash fetch.sh`.

| File | Format | Size | Annotation |
|---|---|---|---|
| `pbmc3k_processed.h5ad` | AnnData | 24 MB | `louvain` — 8 named cell types |
| `pbmc3k_final.rds` | Seurat 3.1.4 | 288 MB | `seurat_annotations` — 9 named cell types |

Neither is loadable by the app yet; the readers are the open item. These exist so the
readers get written against real files rather than against the spec.

---

## What the h5ad reader has to handle

Downloaded from `exampledata.scverse.org`, which is what `sc.datasets.pbmc3k_processed()`
now resolves to. **It is written in the legacy AnnData layout (< 0.7)**, and the
differences are not cosmetic:

| Modern layout | This file |
|---|---|
| `/obs` is a **group**, one dataset per column | `/obs` is **one compound dataset**, columns are dtype fields |
| categoricals are `{codes, categories}` sub-groups | codes are a plain `int8` field; **categories live in `/uns/louvain_categories`** |
| `/obsm/X_umap` is its own dataset | `/obsm` is **one compound dataset**, embeddings are fields with shape `(50,)`, `(2,)`, … |
| raw counts at `/raw/X` (a group) | `/raw.X` — a **dot, not a slash**, at the top level |

A reader written only against the documented modern layout opens this file and finds no
obs columns, no embeddings and no cell types — and could plausibly report "0 clusters"
rather than failing. Both layouts have to be handled, and the legacy one detected by
checking whether `/obs` is a dataset or a group.

Contents once parsed:

```
2638 cells × 1838 genes        X, dense float32 — scaled, HVG-subset
2638 cells × 13714 genes       raw.X, CSR sparse — the full matrix
obs      n_genes, percent_mito, n_counts, louvain
obsm     X_pca (50), X_tsne (2), X_umap (2), X_draw_graph_fr (2)
uns      draw_graph, louvain, louvain_colors, neighbors, pca, rank_genes_groups
```

Cell types (`louvain`): CD4 T cells 1144 · CD14+ Monocytes 480 · B cells 342 ·
CD8 T cells 316 · NK cells 154 · FCGR3A+ Monocytes 150 · Dendritic cells 37 ·
Megakaryocytes 15.

**`X` is scaled data, not expression.** It is z-scored and clipped, so it contains
negatives and cannot be used for a violin, a dot plot or a module score. Everything the
Gene expression tab does must read `raw.X`. A reader that grabs `X` because it is the
obvious one produces plots that look plausible and are wrong.

---

## What the Seurat reader has to handle

`pbmc3k.final` from `SeuratData` 3.1.4, re-saved as `.rds` (the package ships `.rda`).

Confirmed by reading it back **with the Seurat package absent**, which is the situation
in the browser: `readRDS` succeeds with a warning, and every slot is reachable through
`attributes()`. This validates the approach in [DESIGN.md §1.2](../DESIGN.md).

```
slots     assays, meta.data, active.assay, active.ident, graphs, neighbors,
          reductions, project.name, misc, version, commands, tools
version   3.1.4
assay RNA counts     dgCMatrix 13714 × 2638   integer, range 1–419      27 MB
          data       dgCMatrix 13714 × 2638   log-normalized, 0.76–7.47 27 MB
          scale.data matrix    13714 × 2638   dense                    277 MB
meta.data orig.ident, nCount_RNA, nFeature_RNA, seurat_annotations,
          percent.mt, RNA_snn_res.0.5, seurat_clusters
reductions pca (2638 × 50, key PC_), umap (2638 × 2, key UMAP_)
```

Cell types (`seurat_annotations`, also `active.ident`): Naive CD4 T 697 ·
Memory CD4 T 483 · CD14+ Mono 480 · B 344 · CD8 T 271 · FCGR3A+ Mono 162 ·
NK 155 · DC 32 · Platelet 14.

Notes for the reader:

- **Matrices are transposed relative to AnnData** — Seurat is genes × cells, AnnData is
  cells × genes. One of the two has to be flipped on load, and getting it backwards
  produces a plot rather than an error.
- Raw counts **are** present and integer, so pseudobulk DESeq2 is available for this
  object. (`dim()` on the counts slot returns nothing until `Matrix` is attached; read
  `@Dim` instead of trusting `dim()`.)
- `scale.data` is **277 MB of the 340 MB object** — 81% of the file, and useless to this
  app, which never plots scaled values. It must be skipped rather than materialized.

---

## The size finding, which settles a design question

Same 2638 cells, same 13714 genes:

| | h5ad | Seurat rds |
|---|---|---|
| on disk | **24 MB** | **288 MB** |
| in memory | lazy — read what you ask for | 340 MB, all of it, before anything is shown |

**12×**, and the gap is structural rather than incidental: HDF5 stores the sparse matrix
once and allows hyperslab reads, while the Seurat object additionally carries a dense
`scale.data` and must be deserialized whole because RDS is a serial stream.

This is the strongest argument yet for the split already in the design: h5ad as the
first-class path with lazy reads, and `.rds` supported with the ceiling stated up front.
A 3k-cell PBMC object — about the smallest real dataset anyone works with — already costs
288 MB as an rds. A 50k-cell experiment on the same basis lands near the browser limit.

---

## Fetching

```bash
bash fetch.sh          # ~118 MB of downloads, needs Rscript for the rda → rds step
python inspect_h5ad.py pbmc3k_processed.h5ad
```
