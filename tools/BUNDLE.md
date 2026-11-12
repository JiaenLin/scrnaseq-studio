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
├── extra.<name>.u16    optional — any further categorical column, same shape
├── embed.f32           float32 2 × nCells, interleaved x,y — the default embedding
├── embed.<name>.f32    optional — any further 2D embedding, same shape
├── qc.f32              float32 3 × nCells, interleaved counts, genes, mito%
├── expr.indptr.i32     int32   nGenes + 1   ┐ CSC — gene-major, so one gene
├── expr.indices.i32    int32   nnz          │ is a contiguous slice and no
├── expr.data.f32       float32 nnz          ┘ view has to scan the matrix
└── pseudobulk.tsv      optional — summed raw counts per sample × cluster (see below)
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

### Every other column the object annotated

Three of the columns here are **roles**: the clusters are what every view is per, the samples
are the unit of replication, the condition is what the experiment varied. Those three are the
app's vocabulary and it says them in every caption.

An object knows more than three things about a cell. The developing-mouse atlas annotates
each one with the `dissection` it came from as well as its `Age`, and with a `Class` above its
`Subclass` — and which of those a reader wants to break a figure down by is not a question the
converter can answer. So they travel as themselves: one `extra.<name>.u16` per column, one
uint16 level index per cell, listed in `meta.extras`. Nothing renames them. `key` is the obs /
`meta.data` column the levels came from, and that is the word the menus use — the composition
tab then offers every pairing of every column with every other, `dissection × Age` as readily
as `Cell type × Sample`, without any of them being the special one.

Two bytes per cell per column: 0.6 MB on a 292 k-cell atlas, against a matrix in gigabytes.

None of this is required. A bundle with no `meta.extras` is the bundle this format has always
written, and the app opens it exactly as it did.

**Split objects.** When the lab cuts an object into parts, each part is written with only the
levels it actually holds — so part 7's `dissection` 0 need not be part 8's — and the collection
index records the whole object's level order in `condOrder` and `extraOrder` so nothing has to
be guessed back. That is the same treatment `clusterOrder` has always had, and it exists
because collation compares the digit run after the dot as a number: without a recorded order
`e16.5` sorts before `e16.25`, no count changes, and every menu offers a sequence the
experiment never had.

### What the object calls its own columns

`provenance.clustering`, `provenance.condition` and `provenance.sample` name the column each
role was read from, or are `null` when the object had none. The app uses the condition's:
"Group" is a placeholder for whatever an experiment varied, and an object that calls it `Age`
gets a menu that says Age.

### The run that produced the object

`meta.run` is optional. scRNA-seq Lab's converter writes it from what the object's `uns` records
about the run that made it: each tool's provenance (an entry or child named `provenance` or
`*_provenance`, or a group whose `schema` names provenance) and the harness's `uns/harness_run`.

```jsonc
"run": {
  "searched": "uns/harness_run; every entry of uns, …",   // where the converter looked
  "records": [                                              // in uns order
    { "path": "uns/scintegrate/provenance",
      "record": { "tool": "scintegrate", "version": "…", "commit": "…", "job": "…" } }
  ],
  "leftOut": { "count": 1, "paths": ["uns/…"] }            // only when a record found is not listed
}
```

**What the lab writes now.** A record is listed by up to six named fields. `record` holds those of
`tool`, `version`, `commit`, `stage`, `run_key` and `job` that the object's record stores as a
string of 256 characters or fewer, unchanged, and nothing else of the record. The first 64 records
are read. A record that holds none of the six, or is not a dict, is not listed. `leftOut` counts
records the converter found and did not list, and names the first ten:

- beside a listed record, only the records past the first 64 and the records after a value longer
  than 256 characters, which ends the reading;
- when no record is listed, every record found.

The section does not say why a record is not listed. The reasons are in `meta.notes`. A name
longer than 200 characters is cut there and in the section, with the cut marked.

**What older bundles hold.** Before that, the converter copied each record, and `record` took one
of three forms:

- the uns entry as JSON, whatever it held;
- a `(not copied: …)` sentence, when the converter named the record instead of copying it. Over
  its size budget, the sentence states the size;
- `null`, a record listed with no content.

`leftOut` then counted the records that did not fit the section's byte budget. Those bundles are
on users' disks and open as they always did.

**How the app tells the two apart.** A bundle has no version field for this: `schema` and
`searched` are the same in both. So the app reads the fields present, and never the prose of the
notes:

- **Every listed record is a dict of one to six of the named fields, each a string.** The card
  shows each record by those fields, with how many of the six the bundle holds (`4 of 6 fields`).
  An older bundle whose records held nothing else reads the same, so the card's words are true of
  both.
- **At least one record is in another form.** An earlier converter wrote the section. Each record
  is shown as copied: every field under its own name, the six first where a record has them.
- **No record is listed.** The card says the bundle lists none. It never says the converter found
  none: an entry the converter could not inspect is in the notes, not in the section.

On Overview's **Run** card nothing is inferred: no tool is taken from a path, and no missing field
is filled in. An empty string is shown as an em dash, the app's mark for no value, and its title
says it is an empty string. Records that are not listed are counted and named. The card gives no
reason of its own for them: when a note of the bundle names one, it points at the notes, which are
the next card.

Other cases:

- **No `run`:** the card says the bundle carries no run section. This is so for this
  repository's exporters, for the lab before it read run records, and for an `.rds`.
- **A section not in this shape:** the card names it and shows none of it. The bundle still
  opens.

### pseudobulk.tsv

The table has one row per gene, in `genes.txt` order. Each column is one sample × cluster that
has cells, headed `sample||cluster||nCells`, with the ids written as they are.

Every line has as many tab-separated cells as the header. The app checks this before it reads a
header, in one bundle and in each part of a collection. A table that fails is refused whole: no
summed counts are offered, and a note says which line, both widths, and which sample or cell type
the bundle declares with a tab in its name. A tab inside a name does this: the header is then one
column wider than every row, and each count read by position would be its neighbour's. A writer
must refuse or escape a tab in a name.

An id can hold `|`. A sample whose cells sit in more than one condition is split into
`sample|condition`, and a name another sample already has gets `#2`. So an empty level gives
`s1|`, a level `|x` gives `s2||x`, and a level `a||b` gives `s3|a||b`. Cluster names come from
the object unchanged.

The app therefore reads each header against `meta.json`:

- the count comes from the right;
- the boundary between sample and cluster is the one `||` whose left side is in `samples` and
  whose right side is in `clusters`.

The writer takes both from the levels it writes there, so the reading it meant is always found.
The other cases:

- **Two declared pairs read one header** (samples `a` and `a|` with clusters `|b` and `b` both
  give `a|||b||3`): the table is refused, not guessed. It is not offered, and a note names the
  header.
- **No declared pair reads it:** the header is split at the first `||`, as before.

In a collection, each part's headers are read against that part's own levels, and columns are
summed by the pair, never by a joined string.

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
  "extras": [                        // optional; absent ⇒ none, and nothing changes
    { "key": "dissection",           // the obs column's own name — what the menus say
      "file": "extra.dissection.u16",
      "levels": ["Forebrain", "Midbrain", "..."] }   // index = the u16 value
  ],
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
  "provenance": {                    // older fields: a value with no source (see "facts" below)
    "normalization": "log1p(CP10K)",
    "clustering": "louvain",         // the column each role was read from
    "condition": "group",
    "sample": "orig.ident",
    "integration": null,
    "doublets": null,
    "ambient": null
  },
  "run": { "...": "..." },           // optional; the run's records, by named fields — see above
  "notes": ["..."]                   // anything the exporter had to decide, shown in the app
}
```

`provenance` holds the older fields: each a value with no source. `clustering`, `condition`
and `sample` name the column each role was read from. `normalization`, `integration`,
`doublets` and `ambient` were guessed from a key or a name by every writer; the exporters in
this folder now write `null` for the four. The app words any value here as **source not
stated** ("as the converter wrote it"), a `null` as **not stated**, and its Methods text
names no integration method from them and cites nothing from a name.

### `facts` (optional): each fact with its source

A converter that knows where a fact came from says so in `meta.facts`. The app reads it with
one closed reader (`src/lib/facts.ts`) and only then says "as recorded" or "from your file".
A bundle without it stays valid, and is worded as unsourced.

```jsonc
"facts": {
  "v": 1,
  "integration":           { "kind": "recorded", "value": "scanvi", "at": "uns/scintegrate/default_method" },
  "integration_embedding": { "kind": "recorded", "value": "X_scanvi", "at": "uns/scintegrate/default_embedding" },
  "normalization":         { "kind": "recorded", "value": null, "searched": "uns/log1p" },
  "expression":            { "kind": "measured", "value": "log1p of counts scaled to 10,000 per cell", "of": "X", "how": "..." },
  "counts":                { "kind": "measured", "value": true, "of": "layers/counts", "how": "...", "carried": false, "why": "..." },
  "total":                 { "kind": "measured", "value": null, "of": "layers/counts", "how": "summed per cell" },
  "cell_type_column":      { "kind": "chosen", "value": "cell_type", "by": "guess" }
}
```

| kind | fields | the app says |
|---|---|---|
| `recorded` | `value` (one line, 64 characters or fewer), `at` (the place in the object) | "(value), as recorded in the object at (at)", badge "from your file" |
| `recorded`, `value: null` | `searched` (where the converter looked) | "Not recorded in the object. The converter looked at (searched)." |
| `measured` | `value` (a line, a number, true or false, or null), `of` (the matrix or embedding), `how` | "(value), measured at conversion on (of): (how)" |
| `chosen` | `value` (or null), `by`: `flag`, `guess` or `app` | "(value), chosen at conversion by a flag of the command / by the command's guess from a name / in the lab's page" |

The ids the app reads: `integration`, `integration_embedding`, `normalization`, `doublets`, `ambient`, `mito`
(recorded); `expression`, `counts`, `gene_ids` (measured); `total`, `genes_detected` (recorded, as a column
with its place, or measured); `cell_type_column`, `embedding`, `not_called` (chosen). An id it does not know
is ignored. A fact it cannot take (another kind, a kind the id never has, no `at`, `of`, `how` or `by`, a
value that is not one short line of text, markup, a `facts` that is not `v: 1`) is drawn as **unreadable**
and never as recorded; the older field is not used in its place. A per-cell total is titled "Total counts"
only when its `of` is the `of` of a `counts` fact measured `true`. A reference is given only to a recorded
`integration` whose value equals a key of the app's closed table (`harmony`).

## Producing one

```bash
# Scanpy / AnnData — handles both the modern and the legacy (< 0.7) layout
python tools/export_h5ad.py in.h5ad out.zip \
    --cluster louvain --sample orig.ident --condition group \
    --extra dissection --extra Class

# Seurat — needs no Seurat installation, only Matrix
Rscript tools/export_seurat.R in.rds out.zip \
    --cluster seurat_annotations --sample orig.ident --extra region
```

`--extra` may be repeated, and defaults to nothing. Run either script with no options at all
and it names the columns it can see — including the ones that would make usable `--extra`
arguments — rather than guessing at them.

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
| **Any further column** | more pairings on the composition tab | offers the three roles only |
