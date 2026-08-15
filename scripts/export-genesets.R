# Export MSigDB to GMT files that scripts/fetch-genesets.mjs packs.
#
#   Rscript scripts/export-genesets.R [outdir]
#
# msigdbr rather than the Broad's published GMT downloads, for one reason: it
# serves the CURRENT release. The download URLs are pinned to a release
# directory, so a build against them is a build against whatever release was
# named when the script was written; msigdbr 26.1.0 fetches MSigDB 2026.1 into a
# user cache and follows the database forward.
#
# NATIVE per species, via db_species. MSigDB publishes real mouse collections —
# MH, M2, M5, M8 — annotated against mouse genes, and msigdbr will also project
# the human ones through orthologs if asked. Those are not the same data: over
# the 50 hallmark sets the two share a mean Jaccard of 0.569 and NOT ONE set has
# identical membership. This exports the native collections only, so a mouse
# result is a claim about a mouse annotation.
#
# Mouse has no KEGG. MSigDB does not redistribute it for mouse, and projecting
# the human pathways across would put a KEGG label on something KEGG never said.

args <- commandArgs(trailingOnly = TRUE)
out <- if (length(args)) args[1] else "scratch-msigdb/gmt"
dir.create(out, recursive = TRUE, showWarnings = FALSE)

if (!requireNamespace("msigdbr", quietly = TRUE))
  stop("msigdbr is required: install.packages('msigdbr')")

ver <- as.character(utils::packageVersion("msigdbr"))
# 26.x renamed category/subcategory to collection/subcollection and added
# db_species. Both spellings still work on 26.x, but only the new one exists on
# nothing older, so the shim asks the function itself which it speaks.
fm <- names(formals(msigdbr::msigdbr))
newApi <- "collection" %in% fm
hasDbSpecies <- "db_species" %in% fm
message("msigdbr ", ver, " | API=", if (newApi) "collection" else "category",
        " | db_species=", hasDbSpecies)
if (!hasDbSpecies)
  stop("this msigdbr cannot serve native mouse collections; upgrade to >= 24.1")

# label, db_species, species, collection, subcollection
GROUPS <- list(
  list("Hallmark",     "HS", "Homo sapiens", "H",  NA),
  list("KEGG",         "HS", "Homo sapiens", "C2", "CP:KEGG_LEGACY"),
  list("KEGG MEDICUS", "HS", "Homo sapiens", "C2", "CP:KEGG_MEDICUS"),
  list("Reactome",     "HS", "Homo sapiens", "C2", "CP:REACTOME"),
  list("WikiPathways", "HS", "Homo sapiens", "C2", "CP:WIKIPATHWAYS"),
  list("BioCarta",     "HS", "Homo sapiens", "C2", "CP:BIOCARTA"),
  list("GO:BP",        "HS", "Homo sapiens", "C5", "GO:BP"),
  list("GO:MF",        "HS", "Homo sapiens", "C5", "GO:MF"),
  list("GO:CC",        "HS", "Homo sapiens", "C5", "GO:CC"),
  list("Cell type",    "HS", "Homo sapiens", "C8", NA),
  list("Oncogenic",    "HS", "Homo sapiens", "C6", NA),
  list("Immunologic",  "HS", "Homo sapiens", "C7", "IMMUNESIGDB"),

  list("Hallmark",     "MM", "Mus musculus", "MH", NA),
  list("Reactome",     "MM", "Mus musculus", "M2", "CP:REACTOME"),
  list("WikiPathways", "MM", "Mus musculus", "M2", "CP:WIKIPATHWAYS"),
  list("BioCarta",     "MM", "Mus musculus", "M2", "CP:BIOCARTA"),
  list("GO:BP",        "MM", "Mus musculus", "M5", "GO:BP"),
  list("GO:MF",        "MM", "Mus musculus", "M5", "GO:MF"),
  list("GO:CC",        "MM", "Mus musculus", "M5", "GO:CC"),
  list("Cell type",    "MM", "Mus musculus", "M8", NA),
  list("Immunologic",  "MM", "Mus musculus", "M7", NA)
)

slug <- function(s) gsub("^-|-$", "", gsub("[^a-z0-9]+", "-", tolower(s)))
release <- NULL

for (g in GROUPS) {
  label <- g[[1]]; db <- g[[2]]; sp <- g[[3]]; coll <- g[[4]]; sub <- g[[5]]
  a <- list(db_species = db, species = sp)
  if (newApi) {
    a$collection <- coll
    if (!is.na(sub)) a$subcollection <- sub
  } else {
    a$category <- coll
    if (!is.na(sub)) a$subcategory <- sub
  }
  d <- as.data.frame(do.call(msigdbr::msigdbr, a))
  if (!nrow(d)) { message("[skip] ", db, " ", label, " — empty"); next }

  # Column names have moved across versions; take whichever exists.
  pick <- function(cands) { for (c in cands) if (c %in% names(d)) return(c); NA_character_ }
  nameCol <- pick(c("gs_name"))
  symCol  <- pick(c("gene_symbol", "db_gene_symbol"))
  verCol  <- pick(c("db_version"))
  if (!is.null(verCol) && !is.na(verCol)) release[[db]] <- as.character(d[[verCol]][1])

  sets <- split(d[[symCol]], d[[nameCol]])
  species <- if (db == "MM") "mouse" else "human"
  path <- file.path(out, sprintf("%s.%s.gmt", species, slug(label)))
  con <- file(path, "wb")
  for (nm in names(sets)) {
    genes <- unique(sets[[nm]])
    genes <- genes[!is.na(genes) & nzchar(genes)]
    if (!length(genes)) next
    # GMT: name, a description column, then the members. The description is the
    # collection so the packer can carry it, matching the Broad's own layout.
    writeLines(paste(c(nm, paste0(coll, if (!is.na(sub)) paste0(":", sub) else ""), genes),
                     collapse = "\t"), con, sep = "\n")
  }
  close(con)
  message(sprintf("[ ok ] %-6s %-14s %5d sets  %6d genes  -> %s",
                  species, label, length(sets), length(unique(d[[symCol]])), basename(path)))
}

writeLines(jsonlite_or_manual <- paste0(
  '{"msigdbr":"', ver, '","human":"', release[["HS"]], '","mouse":"', release[["MM"]], '"}'),
  file.path(out, "release.json"))
message("\nMSigDB ", release[["HS"]], " (human) / ", release[["MM"]], " (mouse)")
message("wrote ", out)
