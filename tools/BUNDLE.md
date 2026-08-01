# The scRNA-seq Studio bundle

A `.zip` the app can open directly. One conversion, run once, offline — after that the
browser reads only what a view needs.

## Why a bundle rather than the object itself

A Seurat `.rds` is a serial stream: it cannot be partially read, so opening one means
materializing the whole thing, and 81% of a typical object is `scale.data` this app never
plots. A `.h5ad` *is* randomly readable, but the format has two incompatible layouts in
the wild, its `X` is often scaled rather than expression, and its raw counts may be at
`/raw/X`, `/raw.X` or `/layers/counts`. Both of those are conversion problems, and
conversion belongs where scanpy and Seurat already are — not in a browser tab.

So the bundle is the contract, and the two exporters do the interpreting.

| | `pbmc3k` as source | as bundle |
| --- | --- | --- |
| h5ad | 24 MB | 12 MB |
| Seurat rds | 288 MB | 12 MB |

## Layout

```
bundle.zip
├── meta.json           everything small — see below
├── genes.txt           one gene symbol per line, in matrix column order
├── cluster.u16         uint16  per cell → index into meta.clusters
├── sample.u16          uint16  per cell → index into meta.samples
├── embed.f32           float32 2 × nCells, interleaved x,y
├── qc.f32              float32 3 × nCells, interleaved counts, genes, mito%
├── expr.indptr.i32     int32   nGenes + 1   ┐ CSC — gene-major, so one gene
├── expr.indices.i32    int32   nnz          │ is a contiguous slice and no
├── expr.data.f32       float32 nnz          ┘ view has to scan the matrix
└── pseudobulk.tsv      optional — summed raw counts per sample × cluster
```

All binary is little-endian. `expr` holds **log-normalized expression**, never scaled
values: scaled data is z-scored and clipped, so it contains negatives and cannot be used
for a violin, a dot plot or a module score.

### meta.json

```jsonc
{
  "schema": "scrnaseq-studio/bundle@1",
  "label": "PBMC 3k · 10x Genomics",
  "source": "pbmc3k_processed.h5ad (AnnData, legacy layout)",
  "nCells": 2638, "nGenes": 13714, "nnz": 2238732,
  "clusters": ["CD4 T cells", "CD14+ Monocytes", "..."],   // index = cluster.u16 value
  "samples":  [{ "id": "pbmc3k", "condition": "PBMC" }],   // index = sample.u16 value
  "conditions": ["PBMC"],            // the object's own order — never sorted
  "embedding": "X_umap",
  "expression": "log1p(CP10K)",
  "hasRawCounts": true,              // false ⇒ pseudobulk DESeq2 unavailable, and said so
  "provenance": {                    // null means "not recorded in the object"
    "normalization": "log1p(CP10K)",
    "clustering": "louvain",
    "integration": null,
    "doublets": null,
    "ambient": null
  },
  "notes": ["..."]                   // anything the exporter had to decide, shown in the app
}
```

`provenance` values are copied from the object where they exist and left `null` where they
do not. The app prints `null` as **not found** rather than guessing, and the Methods
generator refuses to describe a step that is `null`.

## Producing one

```bash
# Scanpy / AnnData — handles both the modern and the legacy (< 0.7) layout
python tools/export_h5ad.py in.h5ad out.zip \
    --cluster louvain --sample orig.ident --condition group

# Seurat — needs no Seurat installation, only Matrix
Rscript tools/export_seurat.R in.rds out.zip \
    --cluster seurat_annotations --sample orig.ident
```

Both print what they found, what they had to choose, and what they could not find. Every
one of those messages also lands in `meta.notes` and is shown on the Overview tab, so the
person reading the figures sees the same caveats as the person who ran the conversion.

## What the app requires

| Requirement | Why | If missing |
| --- | --- | --- |
| **Clusters** — a categorical cell annotation | every view is per cell type | refuses; there is nothing to group by |
| **An embedding** — UMAP or t-SNE, 2D | the Cells and Feature plot tabs | refuses |
| **Expression** — log-normalized, not scaled | violins, dot plot, module scores | refuses; scaled data would render silently wrong plots |
| **A sample column** | composition, and pseudobulk columns | assumes one sample and says so |
| **A condition column** | any comparison at all | opens single-condition; the contrast tabs stay empty |
| **Raw counts** | pseudobulk → DESeq2 | Wilcoxon only, stated on Overview |
