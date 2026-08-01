#!/usr/bin/env bash
# Fetch the PBMC 3k test objects. Neither file is committed — see README.md.
set -euo pipefail
cd "$(dirname "$0")"

H5AD_URL='https://exampledata.scverse.org/scanpy/pbmc3k.h5ad'
SEURAT_URL='https://seurat.nygenome.org/src/contrib/pbmc3k.SeuratData_3.1.4.tar.gz'

echo "→ pbmc3k_processed.h5ad"
# The figshare id that scanpy used to point at has been reused for unrelated
# data — it now serves a VASP archive. Always take the scverse URL.
curl -fSL --retry 3 -o pbmc3k_processed.h5ad "$H5AD_URL"
python - <<'PY'
import h5py
with h5py.File('pbmc3k_processed.h5ad') as f:
    assert 'X' in f and 'obs' in f, 'not an h5ad'
    print('  ok — top level:', list(f.keys()))
PY

echo "→ pbmc3k_final.rds"
curl -fSL --retry 3 -o pbmc3k.SeuratData.tar.gz "$SEURAT_URL"
tar -xzf pbmc3k.SeuratData.tar.gz pbmc3k.SeuratData/data/pbmc3k.final.rda

# SeuratData ships .rda; the app takes .rds, so re-save. saveRDS does not need
# the Seurat package — only the class definition would, and nothing here uses it.
RSCRIPT_BIN="${RSCRIPT:-Rscript}"
"$RSCRIPT_BIN" -e '
  e <- new.env(); load("pbmc3k.SeuratData/data/pbmc3k.final.rda", envir = e)
  saveRDS(get(ls(e)[1], envir = e), "pbmc3k_final.rds", compress = TRUE)
  cat("  ok — slots:", paste(names(attributes(readRDS("pbmc3k_final.rds"))), collapse=", "), "\n")
'

rm -rf pbmc3k.SeuratData pbmc3k.SeuratData.tar.gz
ls -la pbmc3k_processed.h5ad pbmc3k_final.rds
