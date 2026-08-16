#!/usr/bin/env python
"""Convert an annotated .h5ad into a scRNA-seq Studio bundle.

    python export_h5ad.py in.h5ad out.zip --cluster louvain [--sample orig.ident]
                                          [--condition group] [--embedding X_umap]
                                          [--extra dissection]…

Handles both the modern AnnData layout and the legacy (< 0.7) one, in which obs,
var and obsm are single compound datasets and categorical levels live in
uns/<col>_categories. Reads with anndata, which understands both.

Everything the exporter has to decide is printed and recorded in meta.notes, so
the person reading the figures sees the same caveats as the person who ran this.

See BUNDLE.md for the format.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
import zipfile

import numpy as np

warnings.filterwarnings('ignore')

SCHEMA = 'scrnaseq-studio/bundle@1'
NOTES: list[str] = []


def note(msg: str) -> None:
    NOTES.append(msg)
    print(f'  · {msg}')


def die(msg: str) -> None:
    sys.exit(f'error: {msg}')


def categorical(series):
    """(codes, level names) for any obs column, categorical or not."""
    import pandas as pd
    if isinstance(series.dtype, pd.CategoricalDtype):
        return series.cat.codes.to_numpy(), [str(c) for c in series.cat.categories]
    vals = series.astype(str)
    levels = list(dict.fromkeys(vals))          # first-appearance order, never sorted
    index = {v: i for i, v in enumerate(levels)}
    return np.array([index[v] for v in vals]), levels


def safe_entry(s: str) -> str:
    """An entry name that survives a zip and a file system."""
    out = ''.join(c if (c.isalnum() or c in '._-') else '_' for c in s)
    while '__' in out:
        out = out.replace('__', '_')
    return out.strip('_')[:40] or 'x'


def groupings(a) -> list[tuple[str, int]]:
    """Every obs column that groups the cells, with its level count.

    Printed on every run, whatever was asked for. Which column holds the
    dissection, the developmental stage or the coarse class is a question about
    the experiment and not about the file, so this names what it can see and
    lets the caller choose — the same reason --cluster is obeyed rather than
    second-guessed. Anything here is a legal --extra.
    """
    import pandas as pd
    out = []
    for name in a.obs.columns:
        s = a.obs[name]
        if isinstance(s.dtype, pd.CategoricalDtype):
            k = len(s.cat.categories)
        elif s.dtype == object or pd.api.types.is_string_dtype(s):
            k = int(s.nunique())
        else:
            continue
        # One value is not a grouping and one value per cell is a barcode.
        if 2 <= k <= 1000 and k < 0.9 * max(1, a.n_obs):
            out.append((name, k))
    return out


def extra_column(a, name: str) -> tuple[object, list[str]]:
    """One further categorical column, as codes and levels.

    Cells with no annotation become their own level rather than joining the
    first one, and levels no cell uses are dropped: a bundle should describe the
    cells it actually holds.
    """
    codes, levels = categorical(a.obs[name])
    codes = np.asarray(codes)
    if (codes < 0).any():
        levels = list(levels) + ['NA']
        codes = np.where(codes < 0, len(levels) - 1, codes)
    used = np.zeros(len(levels), dtype=bool)
    used[np.unique(codes)] = True
    if used.all():
        return codes, list(levels)
    remap = np.cumsum(used) - 1
    return remap[codes], [l for l, u in zip(levels, used) if u]


def pick_embedding(adata, wanted: str | None) -> str:
    if wanted:
        if wanted not in adata.obsm:
            die(f'no embedding {wanted!r}; found {list(adata.obsm)}')
        return wanted
    for key in ('X_umap', 'X_tsne', 'X_draw_graph_fr', 'X_pca'):
        if key in adata.obsm and adata.obsm[key].shape[1] >= 2:
            if key == 'X_pca':
                note('no UMAP or t-SNE found — using the first two principal components, '
                     'which is a much coarser picture')
            return key
    die(f'no 2D embedding in obsm; found {list(adata.obsm)}')


def classify(m) -> str:
    """What kind of matrix is this?

    Slot names lie — an .h5ad may keep scaled values in X, log1p(counts) in
    .raw, and nothing at all in layers. So classify by the numbers:

      scaled      has negatives; unusable for any expression view
      counts      integer
      log-counts  expm1 is integer — counts, logged but never depth-normalized
      lognorm     small positive non-integers; already log1p(CP10K) or similar
      linear      large positive non-integers; normalized but not logged
    """
    from scipy import sparse
    d = m.data if sparse.issparse(m) else np.asarray(m).ravel()
    d = d[d != 0]
    if d.size == 0:
        return 'lognorm'
    if d.min() < 0:
        return 'scaled'
    probe = d[: min(20000, d.size)]
    if np.allclose(probe, np.round(probe)):
        return 'counts'
    e = np.expm1(probe)
    if np.allclose(e, np.round(e), atol=1e-3):
        return 'log-counts'
    return 'lognorm' if d.max() < 50 else 'linear'


def lognormalize(counts):
    """log1p(CP10K), the transform every view in the app assumes."""
    from scipy import sparse
    m = sparse.csr_matrix(counts, dtype=np.float64)
    tot = np.asarray(m.sum(axis=1)).ravel()
    tot[tot == 0] = 1
    m = m.multiply(1e4 / tot[:, None]).tocsr()
    m.data = np.log1p(m.data)
    return m


def choose_matrices(a):
    """(display matrix, raw counts or None, which gene list to use)."""
    from scipy import sparse
    candidates = [('X', a.X, 'var')]
    if 'counts' in getattr(a, 'layers', {}):
        candidates.append(('layers["counts"]', a.layers['counts'], 'var'))
    if a.raw is not None:
        candidates.append(('raw.X', a.raw.X, 'raw'))

    kinds = {}
    for name, m, which in candidates:
        k = classify(m)
        kinds[name] = (k, m, which)
        note(f'{name} looks like {k}')

    # Raw counts, recovered if they are only hiding behind a log.
    counts = which_counts = None
    for name, (k, m, which) in kinds.items():
        if k == 'counts':
            counts, which_counts = sparse.csr_matrix(m), which
            note(f'raw counts taken from {name}')
            break
        if k == 'log-counts' and counts is None:
            r = sparse.csr_matrix(m, dtype=np.float64)
            r.data = np.round(np.expm1(r.data))
            counts, which_counts = r, which
            note(f'{name} is log1p(counts); exponentiated back to integer counts, '
                 f'so pseudobulk is available')

    # Display matrix: prefer a genuinely log-normalized one, else make it.
    for name, (k, m, which) in kinds.items():
        if k == 'lognorm':
            note(f'expression taken from {name}, already log-normalized')
            return sparse.csr_matrix(m), counts, which
    if counts is not None:
        note('expression computed here as log1p(CP10K) from the counts')
        return lognormalize(counts), counts, which_counts
    for name, (k, m, which) in kinds.items():
        if k == 'linear':
            note(f'{name} is normalized but not logged; log1p applied')
            out = sparse.csr_matrix(m, dtype=np.float64)
            out.data = np.log1p(out.data)
            return out, None, which
    die('every matrix in this object is scaled data — the app cannot plot z-scores. '
        'Re-export with the log-normalized matrix in X, .raw or layers["counts"].')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--cluster', help='obs column holding the cell annotation')
    ap.add_argument('--sample', help='obs column holding the sample/animal id')
    ap.add_argument('--condition', help='obs column holding the experimental group')
    ap.add_argument('--extra', action='append', metavar='COLUMN',
                    help='any further categorical obs column to carry, under its own '
                         'name; repeatable')
    ap.add_argument('--embedding', help='obsm key, e.g. X_umap')
    ap.add_argument('--label', help='name shown in the app')
    args = ap.parse_args()

    import anndata as ad
    from scipy import sparse

    print(f'reading {args.input}')
    a = ad.read_h5ad(args.input)
    n = a.n_obs
    print(f'  {n} cells × {a.n_vars} genes · obs: {list(a.obs.columns)}')
    cands = groupings(a)
    if cands:
        print('  groupings: ' + ' · '.join(f'{nm} ({k})' for nm, k in cands))
        print('    --cluster / --sample / --condition take one each; any of the rest can '
              'travel with --extra <column>, repeated')

    # ---- clusters ---------------------------------------------------------
    col = args.cluster
    if not col:
        for guess in ('cell_type', 'celltype', 'seurat_annotations', 'louvain', 'leiden', 'clusters'):
            if guess in a.obs:
                col = guess
                note(f'no --cluster given; using obs[{guess!r}]')
                break
    if not col or col not in a.obs:
        die(f'need a cluster column: --cluster one of {list(a.obs.columns)}')
    cluster_codes, clusters = categorical(a.obs[col])
    print(f'  clusters ({col}): {len(clusters)} — {", ".join(clusters[:10])}'
          f'{" …" if len(clusters) > 10 else ""}')

    # ---- samples and conditions ------------------------------------------
    if args.sample and args.sample in a.obs:
        sample_codes, sample_ids = categorical(a.obs[args.sample])
    else:
        if args.sample:
            note(f'obs has no {args.sample!r}')
        note('no sample column — every cell is treated as one sample. Composition '
             'cannot show between-animal spread, and pseudobulk DESeq2 needs several '
             'samples per group, so only the per-cell test will be available')
        sample_codes, sample_ids = np.zeros(n, dtype=np.int64), ['all cells']

    if args.condition and args.condition in a.obs:
        cond_codes, conditions = categorical(a.obs[args.condition])
        # The bundle stores condition per SAMPLE, not per cell. That is right for
        # the usual design — one animal, one treatment — and silently wrong for
        # any other: a hashed lane carrying two treatments, or a donor sampled
        # before and after, used to take the FIRST cell's condition and relabel
        # every other cell in that sample to match. The per-group totals still
        # came out plausible, so there was no symptom to notice.
        #
        # A sample that genuinely spans conditions is two samples. Splitting it
        # here keeps every cell's condition correct, needs no change to the
        # bundle format, and is what an analyst would do by hand. Objects whose
        # samples each hold one condition are untouched — the common case does
        # not pay for the rare one.
        spanning = []
        for si in range(len(sample_ids)):
            hit = np.flatnonzero(sample_codes == si)
            if len(hit) and len(np.unique(cond_codes[hit])) > 1:
                spanning.append(si)

        if spanning:
            pair_at, new_ids, sample_cond = {}, [], []
            new_codes = np.zeros(n, dtype=np.int64)
            for i in range(n):
                si, ci = int(sample_codes[i]), int(cond_codes[i])
                key = (si, ci)
                if key not in pair_at:
                    pair_at[key] = len(new_ids)
                    base = sample_ids[si]
                    # Only a split sample is renamed, so an object where one
                    # animal spans conditions does not rename all the others.
                    new_ids.append(f'{base}|{conditions[ci]}' if si in spanning else base)
                    sample_cond.append(conditions[ci])
                new_codes[i] = pair_at[key]
            note(f'{len(spanning)} sample(s) held cells from more than one '
                 f'{args.condition!r}, so each was split into one sample per group '
                 f'({len(sample_ids)} -> {len(new_ids)}). The bundle records condition '
                 "per sample, and relabelling those cells to the sample's first "
                 'condition would have put them in the wrong group with no visible sign')
            sample_codes, sample_ids = new_codes, new_ids
        else:
            sample_cond = []
            for si in range(len(sample_ids)):
                hit = np.flatnonzero(sample_codes == si)
                sample_cond.append(conditions[cond_codes[hit[0]]] if len(hit) else conditions[0])
    else:
        if args.condition:
            note(f'obs has no {args.condition!r}')
        note('no condition column — this object opens as a single group, and every '
             'comparison tab stays empty rather than inventing a contrast')
        conditions = ['all cells']
        sample_cond = ['all cells'] * len(sample_ids)

    # ---- everything else the object knows about a cell ---------------------
    # Not a fourth role: carried under its own name, so the app can pair it with
    # any of the three without one of them being the special one.
    roles = {col, args.sample, args.condition}
    extras = []
    for name in args.extra or []:
        if name in roles:
            continue
        if name not in a.obs:
            note(f'obs has no {name!r}, so it is not carried')
            continue
        codes, levels = extra_column(a, name)
        if len(levels) < 2:
            note(f'{name} has one value across the whole object; not carried')
            continue
        if len(levels) > 65535:
            note(f'{name} has {len(levels)} levels, too many to store as a column')
            continue
        # Two column names can flatten onto one entry name — "cell type" and
        # "cell_type" both become extra.cell_type.u16 — and two entries with one
        # name would leave the reader pointing twice at the same bytes.
        file = f'extra.{safe_entry(name)}.u16'
        i = 2
        while any(e['file'] == file for e in extras):
            file = f'extra.{safe_entry(name)}-{i}.u16'
            i += 1
        extras.append({'key': name, 'file': file, 'levels': levels, 'codes': codes})
        note(f'{name} travels with the cells as an extra grouping — {len(levels)} levels '
             f'the studio can break a figure down by')

    # ---- embedding --------------------------------------------------------
    emb_key = pick_embedding(a, args.embedding)
    emb = np.asarray(a.obsm[emb_key], dtype=np.float32)[:, :2]
    print(f'  embedding: {emb_key}')

    # ---- matrices ---------------------------------------------------------
    disp, counts, which = choose_matrices(a)
    genes = [str(g) for g in (a.raw.var_names if which == 'raw' else a.var_names)]
    if which == 'raw':
        note(f'using the {len(genes)} genes from .raw rather than the {a.n_vars} in X, '
             f'which is a variable-gene subset')
    if disp.shape[1] != len(genes):
        die(f'matrix has {disp.shape[1]} columns but the gene list has {len(genes)}')
    if counts is not None and counts.shape[1] != len(genes):
        note('raw counts have a different gene set from the expression matrix; '
             'pseudobulk disabled rather than mismatched')
        counts = None

    # ---- QC ---------------------------------------------------------------
    def obs_num(*names):
        for nm in names:
            if nm in a.obs:
                return np.asarray(a.obs[nm], dtype=np.float32)
        return None

    total = obs_num('n_counts', 'total_counts', 'nCount_RNA')
    ngene = obs_num('n_genes', 'n_genes_by_counts', 'nFeature_RNA')
    mito = obs_num('percent_mito', 'pct_counts_mt', 'percent.mt')
    src = counts if counts is not None else disp
    if total is None:
        total = np.asarray(src.sum(axis=1), dtype=np.float32).ravel()
        note('no total-count column in obs; recomputed from the matrix')
    if ngene is None:
        ngene = np.asarray((src > 0).sum(axis=1), dtype=np.float32).ravel()
        note('no detected-gene column in obs; recomputed from the matrix')
    if mito is None:
        mito = np.zeros(n, dtype=np.float32)
        note('no mitochondrial fraction in obs — the QC panel will show a flat zero '
             'rather than a made-up number')
    elif np.nanmax(mito) <= 1.0:
        mito = mito * 100.0
        note('mitochondrial fraction was a proportion; converted to a percentage')

    write_bundle(
        args.output, args.label or args.input, f'{args.input} (AnnData)',
        genes, clusters, sample_ids, sample_cond, conditions,
        cluster_codes, sample_codes, emb, total, ngene, mito,
        disp, counts, emb_key, extras,
        provenance={
            'normalization': 'log1p(CP10K)' if 'log1p' in a.uns else None,
            # Which column each role was read from. The app says "Group" because
            # it has to say something; an object that calls it Age gets a menu
            # that says Age.
            'clustering': col,
            'condition': args.condition if args.condition in a.obs else None,
            'sample': args.sample if args.sample in a.obs else None,
            'integration': 'harmony' if any('harmony' in k for k in a.obsm) else None,
            'doublets': next((k for k in a.obs if 'doublet' in k.lower() or 'scrublet' in k.lower()), None),
            'ambient': next((k for k in a.uns if k.lower() in ('soupx', 'cellbender', 'decontx')), None),
        })


def write_bundle(out, label, source, genes, clusters, sample_ids, sample_cond,
                 conditions, cluster_codes, sample_codes, emb, total, ngene, mito,
                 disp, counts, emb_key, extras, provenance):
    """Shared by both exporters — see BUNDLE.md."""
    from scipy import sparse
    n = len(cluster_codes)
    csc = disp.tocsc()
    csc.sort_indices()

    qc = np.empty(3 * n, dtype=np.float32)
    qc[0::3], qc[1::3], qc[2::3] = total, ngene, mito

    xy = np.empty(2 * n, dtype=np.float32)
    xy[0::2], xy[1::2] = emb[:, 0], emb[:, 1]

    meta = {
        'schema': SCHEMA, 'label': label, 'source': source,
        'nCells': int(n), 'nGenes': len(genes), 'nnz': int(csc.nnz),
        'clusters': clusters,
        'samples': [{'id': s, 'condition': c} for s, c in zip(sample_ids, sample_cond)],
        'conditions': conditions,
        'extras': [{'key': e['key'], 'file': e['file'], 'levels': e['levels']} for e in extras],
        'embedding': emb_key,
        'expression': 'log1p(CP10K)',
        'hasRawCounts': counts is not None,
        'provenance': provenance,
        'notes': NOTES,
    }

    print(f'writing {out}')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr('meta.json', json.dumps(meta, indent=1))
        z.writestr('genes.txt', '\n'.join(genes))
        z.writestr('cluster.u16', np.asarray(cluster_codes, dtype='<u2').tobytes())
        z.writestr('sample.u16', np.asarray(sample_codes, dtype='<u2').tobytes())
        for e in extras:
            z.writestr(e['file'], np.asarray(e['codes'], dtype='<u2').tobytes())
        z.writestr('embed.f32', xy.astype('<f4').tobytes())
        z.writestr('qc.f32', qc.astype('<f4').tobytes())
        z.writestr('expr.indptr.i32', csc.indptr.astype('<i4').tobytes())
        z.writestr('expr.indices.i32', csc.indices.astype('<i4').tobytes())
        z.writestr('expr.data.f32', csc.data.astype('<f4').tobytes())

        if counts is not None:
            # Pseudobulk: summed raw counts per sample × cluster. Small by
            # construction — it collapses cells to a handful of columns.
            cc = sparse.csr_matrix(counts)
            cols, names = [], []
            for si, sid in enumerate(sample_ids):
                for ci, cname in enumerate(clusters):
                    sel = np.flatnonzero((sample_codes == si) & (cluster_codes == ci))
                    if len(sel) == 0:
                        continue
                    cols.append(np.asarray(cc[sel].sum(axis=0), dtype=np.int64).ravel())
                    names.append(f'{sid}||{cname}||{len(sel)}')
            if cols:
                mat = np.vstack(cols).T
                lines = ['gene\t' + '\t'.join(names)]
                for gi, g in enumerate(genes):
                    lines.append(g + '\t' + '\t'.join(map(str, mat[gi])))
                z.writestr('pseudobulk.tsv', '\n'.join(lines))
                print(f'  pseudobulk: {len(names)} sample × cluster columns')

    import os
    print(f'  done — {os.path.getsize(out) / 1e6:.1f} MB, {csc.nnz} nonzeros')


if __name__ == '__main__':
    main()
