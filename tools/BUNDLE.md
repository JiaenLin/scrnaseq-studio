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
├── genes.txt           one gene name per line, in matrix row order
├── gene_alias.txt      optional — the same genes named the other way, line for line
├── cluster.u16         uint16  per cell → index into meta.clusters
├── sample.u16          uint16  per cell → index into meta.samples
├── embed.f32           float32 2 × nCells, interleaved x,y — the default embedding
├── embed.<name>.f32    optional — any further 2D embedding, same shape
├── qc.f32              float32 3 × nCells, interleaved counts, genes, mito%
├── expr.indptr.i32     int32   nGenes + 1   ┐ CSC — gene-major, so one gene
├── expr.indices.i32    int32   nnz          │ is a contiguous slice and no
├── expr.data.f32       float32 nnz          ┘ view has to scan the matrix
└── pseudobulk.tsv      optional — summed raw counts per sample × cluster
```

All binary is little-endian. `expr` holds **log-normalized expression**, never scaled
values: scaled data is z-scored and clipped, so it contains negatives and cannot be used
for a violin, a dot plot or a module score.

### Every 2D embedding, not just one

An object usually holds several — a UMAP and a t-SNE of the same cells, often a PCA as
well — and which one to look at is a question for the person reading the figure, not for
the person who ran the conversion. So all of them travel. The default one stays in
`embed.f32` under its old name, so a reader that has never heard of `meta.embeddings`
behaves exactly as it did; the rest sit beside it, named in `meta.embeddings`. The cost is
8 bytes per cell per embedding — 2.3 MB on a 292 k-cell atlas, against a matrix measured
in gigabytes.

### Both namings of the genes

`genes.txt` is what the matrix rows are *indexed by*, whatever that is:
`ENSMUSG00000038751` in objects built off a reference, `Sox2` in objects built off
CellRanger's symbols. `meta.geneIdKind` says which, decided from the names themselves
rather than from the column they came out of.

Where the object also carried the other naming — a `Gene`, `feature_name` or `gene_ids`
column in `var` — it is written to `gene_alias.txt`, one line per matrix row, aligned with
`genes.txt` so conversion is by index and never by lookup. No mapping table ships with the
app: a table would be species-specific and would go stale, and the file being converted
already knows the answer.

Two things happen to that list, both recorded in `meta.geneAlias` rather than hidden:

- **Genes the object had no alias for** repeat their `genes.txt` name, so every line is a
  usable label and never a blank. `missing` counts them.
- **Several accessions sharing one symbol** — read-through transcripts and paralogue
  annotations both do it — keep their own rows. Nothing is merged: summing two genes'
  expression under one name is not a display decision. `duplicated` counts the rows
  affected, and disambiguating them is the reader's business.

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
  "embedding": "X_umap",             // the default — always embeddings[0].key
  "embeddings": [                    // optional; absent ⇒ one embedding, embed.f32
    { "key": "X_umap", "file": "embed.f32" },
    { "key": "X_tSNE", "file": "embed.X_tSNE.f32" }
  ],
  "geneIdKind": "accession",         // optional; what genes.txt holds: accession|symbol|mixed
  "geneAlias": {                     // optional; null when the object had one naming only
    "kind": "symbol",                // what gene_alias.txt holds — the other one
    "column": "Gene",                // the var column it was read from
    "file": "gene_alias.txt",
    "missing": 12,                   // rows with no alias; they repeat genes.txt
    "duplicated": 68                 // rows sharing an alias; never merged
  },
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
