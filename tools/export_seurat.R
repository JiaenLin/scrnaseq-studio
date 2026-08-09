#!/usr/bin/env Rscript
# Convert an annotated Seurat .rds into a scRNA-seq Studio bundle.
#
#   Rscript export_seurat.R in.rds out.zip --cluster seurat_annotations
#                                          [--sample orig.ident] [--condition group]
#                                          [--extra region] [--reduction umap]
#                                          [--label "..."]
#
# Deliberately does NOT require the Seurat package. readRDS deserializes the
# object regardless and every slot is reachable through attributes() — only the
# S4 *class definition* would need Seurat, and nothing here dispatches on it. So
# this runs on any machine with R and Matrix, including one where the Seurat
# version that wrote the file is no longer installable.
#
# See BUNDLE.md for the format.

suppressMessages(library(Matrix))
if (!requireNamespace("digest", quietly = TRUE)) {
  stop("this script needs the `digest` package for CRC-32:
  install.packages(\"digest\")",
       call. = FALSE)
}

NOTES <- character(0)
note <- function(...) {
  msg <- paste0(...)
  NOTES <<- c(NOTES, msg)
  cat("  · ", msg, "\n", sep = "")
}
die <- function(...) stop(paste0(...), call. = FALSE)

# Minimal JSON writer, so this script needs nothing beyond Matrix. jsonlite is
# common but not guaranteed, and an exporter that cannot run is worse than
# thirty lines of serializer. Control characters are flattened to spaces rather
# than escaped — the only free text here is a note, and none contains any.
esc <- function(s) {
  s <- gsub("\\", "\\\\", s, fixed = TRUE)
  s <- gsub("\"", "\\\"", s, fixed = TRUE)
  s <- gsub("[[:cntrl:]]", " ", s)
  paste0("\"", s, "\"")
}

# A JSON array of one is still an array, and R cannot tell a length-1 vector
# from a scalar — so the fields the format defines as lists say so. Without this
# an object with one cluster or one group writes `"conditions": "all cells"`,
# which the app reads with .map() and refuses to open. Length 0 and length > 1
# are untouched, so nothing that already worked changes shape.
arr <- function(x) if (length(x) == 1) structure(list(x), .Names = NULL) else x

to_json <- function(x, ind = "") {
  pad <- paste0(ind, " ")
  if (is.null(x)) return("null")
  if (length(x) == 1 && !is.list(x) && is.na(x)) return("null")
  if (is.logical(x) && length(x) == 1) return(if (x) "true" else "false")
  if (is.character(x)) {
    if (length(x) == 1) return(esc(x))
    return(paste0("[", paste(vapply(x, esc, ""), collapse = ", "), "]"))
  }
  if (is.numeric(x)) {
    v <- format(x, scientific = FALSE, trim = TRUE)
    if (length(x) == 1) return(v)
    return(paste0("[", paste(v, collapse = ", "), "]"))
  }
  if (is.list(x)) {
    x <- x[!vapply(x, is.null, TRUE)]
    if (!length(x)) return("{}")
    sep <- paste0(",\n", pad)
    if (is.null(names(x)) || all(names(x) == "")) {
      items <- vapply(x, function(v) to_json(v, pad), "")
      return(paste0("[\n", pad, paste(items, collapse = sep), "\n", ind, "]"))
    }
    items <- vapply(names(x), function(k) paste0(esc(k), ": ", to_json(x[[k]], pad)), "")
    return(paste0("{\n", pad, paste(items, collapse = sep), "\n", ind, "}"))
  }
  esc(as.character(x))
}

# ---- a zip writer, so this depends on nothing outside R ---------------------
#
# utils::zip shells out to a `zip` binary Windows does not ship, and
# Compress-Archive proved unusable — it could not read files R had written, even
# after R had exited. Rather than depend on an external archiver at all, build
# the zip here. Needs only Matrix and digest.
#
# Deflate and CRC32 both come free from memCompress(type = "gzip"): a gzip
# stream is a 10-byte header, the raw deflate payload, then the CRC32 and the
# uncompressed size. Strip the ends and you have exactly the two things a zip
# entry needs, with no compression code and no CRC table.
le <- function(v, n) {
  v <- as.numeric(v)
  as.raw(vapply(seq_len(n) - 1L, function(i) (v %/% 256^i) %% 256, 0))
}

deflate_raw <- function(bytes) {
  # Despite the name, memCompress(type = "gzip") emits a *zlib* stream: a
  # two-byte header, the raw deflate payload, then an Adler-32. A zip entry
  # wants that payload and a CRC-32, so take the middle and get the checksum
  # from digest.
  z <- memCompress(bytes, "gzip")
  n <- length(z)
  if (n < 6 || z[1] != as.raw(0x78)) stop("memCompress did not return a zlib stream")
  h <- digest::digest(bytes, algo = "crc32", serialize = FALSE)
  list(
    data = z[3:(n - 4)],
    # 8 hex digits overflow a signed 32-bit integer, so combine two halves.
    crc = strtoi(substr(h, 1, 4), 16L) * 65536 + strtoi(substr(h, 5, 8), 16L),
    size = length(bytes)
  )
}

write_zip <- function(out, dir, names) {
  con <- file(out, "wb")
  on.exit(close(con), add = TRUE)
  offsets <- numeric(0)
  central <- list()
  pos <- 0

  for (nm in names) {
    raw_bytes <- readBin(file.path(dir, nm), "raw", file.size(file.path(dir, nm)))
    z <- deflate_raw(raw_bytes)
    nmb <- charToRaw(nm)
    header <- c(le(0x04034b50, 4), le(20, 2), le(0, 2), le(8, 2), le(0, 2), le(0, 2),
                le(z$crc, 4), le(length(z$data), 4), le(z$size, 4),
                le(length(nmb), 2), le(0, 2))
    writeBin(c(header, nmb, z$data), con)
    central[[length(central) + 1]] <- c(
      le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(8, 2), le(0, 2), le(0, 2),
      le(z$crc, 4), le(length(z$data), 4), le(z$size, 4),
      le(length(nmb), 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4),
      le(pos, 4), nmb)
    offsets <- c(offsets, pos)
    pos <- pos + length(header) + length(nmb) + length(z$data)
  }

  cd <- unlist(central)
  writeBin(cd, con)
  writeBin(c(le(0x06054b50, 4), le(0, 2), le(0, 2),
             le(length(names), 2), le(length(names), 2),
             le(length(cd), 4), le(pos, 4), le(0, 2)), con)
}

# ---- arguments --------------------------------------------------------------
argv <- commandArgs(trailingOnly = TRUE)
if (length(argv) < 2) die("usage: export_seurat.R in.rds out.zip --cluster <col> [...]")
input <- argv[1]
output <- argv[2]
opt <- function(name, default = NULL) {
  i <- match(paste0("--", name), argv)
  if (is.na(i) || i == length(argv)) default else argv[i + 1]
}
# Repeatable, unlike the rest: the three roles take one column each, but there
# is no limit to how many other things an object knows about a cell.
opts <- function(name) {
  i <- which(argv == paste0("--", name))
  i <- i[i < length(argv)]
  if (!length(i)) character(0) else argv[i + 1]
}
cluster_col <- opt("cluster")
sample_col <- opt("sample")
cond_col <- opt("condition")
extra_names <- opts("extra")
reduction <- opt("reduction")
label <- opt("label", input)

# An entry name that survives a zip and a file system.
safe_entry <- function(s) {
  s <- gsub("_+", "_", gsub("[^A-Za-z0-9._-]+", "_", s))
  s <- gsub("^_|_$", "", substr(s, 1, 40))
  if (!nzchar(s)) "x" else s
}

cat("reading ", input, "\n", sep = "")
obj <- readRDS(input)
a <- attributes(obj)
if (is.null(a$assays)) die("this does not look like a Seurat object (no assays slot)")

md <- a$meta.data
cat("  ", nrow(md), " cells · meta.data: ", paste(names(md), collapse = ", "), "\n", sep = "")

# Which of those columns group the cells, and how many ways. Which one holds the
# dissection, the stage or the coarse class is a question about the experiment
# and not about the file, so this names what it can see and lets the caller
# choose — the same reason --cluster is obeyed rather than second-guessed.
grp <- vapply(names(md), function(nm) {
  v <- md[[nm]]
  if (is.numeric(v) && !is.factor(v)) return(NA_integer_)
  k <- length(unique(as.character(v)))
  # One value is not a grouping and one value per cell is a barcode.
  if (k < 2 || k > 1000 || k >= 0.9 * nrow(md)) NA_integer_ else k
}, 0L)
grp <- grp[!is.na(grp)]
if (length(grp)) {
  cat("  groupings: ", paste0(names(grp), " (", grp, ")", collapse = " · "), "\n", sep = "")
  cat("    --cluster / --sample / --condition take one each; any of the rest can travel",
      " with --extra <column>, repeated\n", sep = "")
}

# ---- assay ------------------------------------------------------------------
assay_name <- if (!is.null(a$active.assay)) a$active.assay else names(a$assays)[1]
assay <- attributes(a$assays[[assay_name]])
cat("  assay: ", assay_name, "\n", sep = "")

# Seurat v5 keeps matrices in a `layers` list; v3/v4 in named slots.
get_layer <- function(nm) {
  if (!is.null(assay$layers) && !is.null(assay$layers[[nm]])) return(assay$layers[[nm]])
  assay[[nm]]
}
# dim() on a slot read without Seurat can return NULL; @Dim always works.
dims <- function(m) if (is.null(m)) c(0L, 0L) else if (is.null(dim(m))) m@Dim else dim(m)
empty <- function(m) is.null(m) || prod(dims(m)) == 0

counts <- get_layer("counts")
data <- get_layer("data")
if (empty(counts)) counts <- NULL
if (empty(data)) data <- NULL
if (is.null(data) && is.null(counts)) die("neither counts nor data is present in ", assay_name)

if (!is.null(counts)) {
  probe <- counts@x[seq_len(min(20000L, length(counts@x)))]
  if (all(probe %% 1 == 0)) {
    note("raw counts found, so pseudobulk is available")
  } else {
    note("the counts slot is not integer-valued, so it is not raw counts")
    counts <- NULL
  }
} else {
  note("no counts slot — pseudobulk DESeq2 is unavailable; only the per-cell test")
}

if (is.null(data)) {
  note("no data slot; expression computed here as log1p(CP10K) from counts")
  cs <- Matrix::colSums(counts)
  cs[cs == 0] <- 1
  data <- counts %*% Diagonal(x = 1e4 / cs)
  data@x <- log1p(data@x)
} else if (min(data@x) < 0) {
  die("the data slot contains negative values — that is scale.data, which cannot be plotted")
}

genes <- rownames(data)
if (is.null(genes)) genes <- data@Dimnames[[1]]
if (is.null(genes)) die("the expression matrix has no gene names")
cat("  ", length(genes), " genes × ", dims(data)[2], " cells\n", sep = "")

# ---- clusters ---------------------------------------------------------------
if (is.null(cluster_col)) {
  for (g in c("seurat_annotations", "cell_type", "celltype", "seurat_clusters")) {
    if (g %in% names(md)) {
      cluster_col <- g
      note("no --cluster given; using ", g)
      break
    }
  }
}
if (!is.null(cluster_col) && cluster_col %in% names(md)) {
  cl <- md[[cluster_col]]
} else if (!is.null(a$active.ident)) {
  note("no cluster column found; using active.ident")
  cl <- a$active.ident
  cluster_col <- "active.ident"
} else {
  die("need a cluster column: --cluster one of ", paste(names(md), collapse = ", "))
}
cl <- factor(cl)
# Cells with no annotation are dropped rather than given an invented label.
keep <- !is.na(cl)
if (any(!keep)) note(sum(!keep), " cells have no cluster label and were dropped")
cl <- droplevels(cl[keep])
clusters <- levels(cl)
cat("  clusters: ", length(clusters), " — ",
    paste(head(clusters, 10), collapse = ", "), "\n", sep = "")

# ---- samples and conditions -------------------------------------------------
if (!is.null(sample_col) && sample_col %in% names(md)) {
  smp <- droplevels(factor(md[[sample_col]][keep]))
} else {
  if (!is.null(sample_col)) note("meta.data has no ", sample_col)
  note("no sample column — every cell is treated as one sample. Composition cannot ",
       "show between-animal spread, and pseudobulk needs several samples per group")
  smp <- factor(rep("all cells", sum(keep)))
}
sample_ids <- levels(smp)

if (!is.null(cond_col) && cond_col %in% names(md)) {
  cond <- droplevels(factor(md[[cond_col]][keep]))
  conditions <- levels(cond)
  sample_cond <- vapply(sample_ids, function(s) as.character(cond[which(smp == s)[1]]), "")
} else {
  if (!is.null(cond_col)) note("meta.data has no ", cond_col)
  note("no condition column — this object opens as a single group, and every ",
       "comparison tab stays empty rather than inventing a contrast")
  conditions <- "all cells"
  sample_cond <- rep("all cells", length(sample_ids))
}

# ---- embedding --------------------------------------------------------------
reds <- a$reductions
if (is.null(reds) || !length(reds)) die("no reductions slot — the app needs a 2D embedding")
pick <- reduction
if (is.null(pick)) {
  for (r in c("umap", "tsne", "UMAP", "TSNE", "pca")) {
    if (r %in% names(reds)) { pick <- r; break }
  }
  if (identical(pick, "pca")) {
    note("no UMAP or t-SNE — using the first two PCs, a much coarser picture")
  }
}
if (is.null(pick) || !(pick %in% names(reds))) {
  die("no usable reduction; found ", paste(names(reds), collapse = ", "))
}
emb <- attributes(reds[[pick]])$cell.embeddings[keep, 1:2, drop = FALSE]
cat("  embedding: ", pick, "\n", sep = "")

# ---- QC ---------------------------------------------------------------------
num_col <- function(...) {
  for (nm in c(...)) if (nm %in% names(md)) return(as.numeric(md[[nm]])[keep])
  NULL
}
total <- num_col("nCount_RNA", "n_counts", "nUMI")
ngene <- num_col("nFeature_RNA", "n_genes", "nGene")
mito <- num_col("percent.mt", "percent_mito", "pct_counts_mt")
src <- if (!is.null(counts)) counts else data
if (is.null(total)) {
  total <- Matrix::colSums(src)[keep]
  note("no total-count column; recomputed from the matrix")
}
if (is.null(ngene)) {
  ngene <- Matrix::colSums(src != 0)[keep]
  note("no detected-gene column; recomputed from the matrix")
}
if (is.null(mito)) {
  mito <- rep(0, sum(keep))
  note("no mitochondrial fraction — the QC panel shows a flat zero rather than ",
       "a made-up number")
} else if (max(mito, na.rm = TRUE) <= 1) {
  mito <- mito * 100
  note("mitochondrial fraction was a proportion; converted to a percentage")
}

# ---- write ------------------------------------------------------------------
dir <- file.path(tempdir(), paste0("scbundle", Sys.getpid()))
unlink(dir, recursive = TRUE)
dir.create(dir, recursive = TRUE)
wbin <- function(f, x, sz) writeBin(x, file.path(dir, f), size = sz, endian = "little")

# Seurat stores genes x cells; the bundle is CSC over genes, which is the
# transpose. Getting this backwards renders a plot rather than an error, so it
# is done once, here, where it can be checked.
dsub <- data[, keep, drop = FALSE]
tg <- as(Matrix::t(dsub), "CsparseMatrix")   # cells x genes; CSC == gene-major

wbin("cluster.u16", as.integer(match(as.character(cl), clusters) - 1L), 2L)
wbin("sample.u16", as.integer(match(as.character(smp), sample_ids) - 1L), 2L)

# ---- everything else the object knows about a cell --------------------------
# Not a fourth role: carried under its own name, so the app can pair it with any
# of the three without one of them being the special one.
extra_cols <- list()
roles <- c(cluster_col, sample_col, cond_col)
for (nm in extra_names) {
  if (nm %in% roles) next
  if (!(nm %in% names(md))) {
    note("meta.data has no ", nm, ", so it is not carried")
    next
  }
  # droplevels for the same reason the clusters get it: a bundle should describe
  # the cells it actually holds, not the ones the object was subset from.
  v <- droplevels(factor(md[[nm]][keep]))
  lv <- levels(v)
  if (length(lv) < 2) {
    note(nm, " has one value across these cells; not carried")
  } else if (length(lv) > 65535) {
    note(nm, " has ", length(lv), " levels, too many to store as a column")
  } else {
    # Two column names can flatten onto one entry name, and two entries with
    # one name would leave the reader pointing twice at the same bytes.
    f <- paste0("extra.", safe_entry(nm), ".u16")
    taken <- vapply(extra_cols, function(e) e$file, "")
    i <- 2
    while (f %in% taken) {
      f <- paste0("extra.", safe_entry(nm), "-", i, ".u16")
      i <- i + 1
    }
    wbin(f, as.integer(match(as.character(v), lv) - 1L), 2L)
    extra_cols[[length(extra_cols) + 1]] <- list(key = nm, file = f, levels = arr(lv))
    note(nm, " travels with the cells as an extra grouping — ", length(lv),
         " levels the studio can break a figure down by")
  }
}
wbin("embed.f32", as.numeric(t(emb)), 4L)
wbin("qc.f32", as.numeric(rbind(total, ngene, mito)), 4L)
wbin("expr.indptr.i32", as.integer(tg@p), 4L)
wbin("expr.indices.i32", as.integer(tg@i), 4L)
wbin("expr.data.f32", as.numeric(tg@x), 4L)
# Binary mode with an explicit LF. writeLines() on Windows emits CRLF, so every
# gene name would arrive in the app with a trailing carriage return and every
# lookup would miss — and the trailing newline adds a phantom last gene.
gcon <- file(file.path(dir, "genes.txt"), "wb")
writeChar(paste(genes, collapse = "
"), gcon, eos = NULL)
close(gcon)

has_pb <- FALSE
if (!is.null(counts)) {
  cs <- counts[, keep, drop = FALSE]
  key <- paste(as.character(smp), as.character(cl), sep = "||")
  uk <- unique(key)
  cols <- lapply(uk, function(k) as.integer(Matrix::rowSums(cs[, key == k, drop = FALSE])))
  header <- paste0(uk, "||", vapply(uk, function(k) sum(key == k), 0L))
  mat <- do.call(cbind, cols)
  # Binary mode with an explicit LF: writeLines() on Windows emits CRLF, which
  # would leave a carriage return on every gene name in the app.
  pcon <- file(file.path(dir, "pseudobulk.tsv"), "wb")
  writeChar(paste(c(paste0("gene	", paste(header, collapse = "	")),
                    paste(genes, apply(mat, 1, paste, collapse = "	"), sep = "	")),
                  collapse = "
"), pcon, eos = NULL)
  close(pcon)
  has_pb <- TRUE
  cat("  pseudobulk: ", length(uk), " sample × cluster columns\n", sep = "")
}

meta <- list(
  schema = "scrnaseq-studio/bundle@1",
  label = label,
  source = paste0(basename(input), " (Seurat ", as.character(a$version),
                  ", assay ", assay_name, ")"),
  nCells = sum(keep), nGenes = length(genes), nnz = length(tg@x),
  clusters = arr(clusters),
  samples = lapply(seq_along(sample_ids), function(i) {
    list(id = sample_ids[i], condition = unname(sample_cond[i]))
  }),
  conditions = arr(conditions),
  # Absent rather than empty when there are none: to_json drops a NULL, and an
  # empty R list would serialize as {} where the reader expects a list.
  extras = if (length(extra_cols)) extra_cols else NULL,
  embedding = pick,
  expression = "log1p(CP10K)",
  hasRawCounts = !is.null(counts),
  provenance = list(
    normalization = "log1p(CP10K)",
    # Which column each role was read from. The app says "Group" because it has
    # to say something; an object that calls it Age gets a menu that says Age.
    clustering = cluster_col,
    condition = if (!is.null(cond_col) && cond_col %in% names(md)) cond_col else NULL,
    sample = if (!is.null(sample_col) && sample_col %in% names(md)) sample_col else NULL,
    integration = if ("integrated" %in% names(a$assays)) "Seurat integration" else NULL,
    doublets = grep("doublet|scrublet", names(md), ignore.case = TRUE, value = TRUE)[1],
    ambient = NULL
  ),
  notes = as.list(NOTES)
)
mcon <- file(file.path(dir, "meta.json"), "wb")
writeChar(to_json(meta), mcon, eos = NULL)
close(mcon)

files <- c("meta.json", "genes.txt", "cluster.u16", "sample.u16", "embed.f32", "qc.f32",
           "expr.indptr.i32", "expr.indices.i32", "expr.data.f32")
if (length(extra_cols)) files <- c(files, vapply(extra_cols, function(e) e$file, ""))
if (has_pb) files <- c(files, "pseudobulk.tsv")
out_abs <- if (grepl("^([A-Za-z]:|[/\\\\])", output)) output else file.path(getwd(), output)
if (file.exists(out_abs)) unlink(out_abs)
write_zip(out_abs, dir, files)
if (!file.exists(out_abs)) die("the bundle was not written")
unlink(dir, recursive = TRUE)
cat("  done — ", round(file.size(out_abs) / 1e6, 1), " MB, ",
    length(tg@x), " nonzeros\n", sep = "")
