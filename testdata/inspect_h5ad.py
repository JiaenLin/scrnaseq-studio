"""Dump the on-disk structure of an .h5ad, as the reader will meet it.

Deliberately uses raw h5py, not anndata: the browser reader has h5wasm and no
Python, so what matters is what the bytes look like, not what anndata makes of
them.
"""
import sys
import h5py

path = sys.argv[1] if len(sys.argv) > 1 else 'pbmc3k_processed.h5ad'
f = h5py.File(path, 'r')


def enc(o):
    a = o.attrs
    t = a.get('encoding-type', b'')
    v = a.get('encoding-version', b'')
    t = t.decode() if isinstance(t, bytes) else t
    v = v.decode() if isinstance(v, bytes) else v
    return f'{t} {v}'.strip()


print(f'FILE  {path}')
print(f'root attrs: {dict(f.attrs)}\n')

print('=== X ===')
X = f['X']
if isinstance(X, h5py.Dataset):
    print(f'  dense  shape={X.shape}  dtype={X.dtype}  {enc(X)}')
else:
    print(f'  sparse group  {enc(X)}  attrs={dict(X.attrs)}')
    for k in X:
        print(f'    {k:10s} shape={X[k].shape}  dtype={X[k].dtype}')

for key in ('raw/X', 'raw.X', 'layers'):
    if key in f:
        o = f[key]
        print(f'\n=== {key} ===')
        if isinstance(o, h5py.Dataset):
            print(f'  dense  shape={o.shape}  dtype={o.dtype}')
        else:
            print(f'  {enc(o)}')
            for k in o:
                sub = o[k]
                if isinstance(sub, h5py.Dataset):
                    print(f'    {k:10s} shape={sub.shape}  dtype={sub.dtype}')
                else:
                    print(f'    {k}/  {enc(sub)}  keys={list(sub)}')

for frame in ('obs', 'var', 'raw/var', 'raw.var'):
    if frame not in f:
        continue
    g = f[frame]
    print(f'\n=== {frame} ===  {enc(g)}')
    idx = g.attrs.get('_index', b'_index')
    idx = idx.decode() if isinstance(idx, bytes) else idx
    order = g.attrs.get('column-order', [])
    order = [c.decode() if isinstance(c, bytes) else c for c in order]
    print(f'  _index = {idx!r} · column-order = {order}')
    # Legacy anndata (< 0.7) writes a whole frame as ONE compound dataset
    # instead of a group of columns. The reader must handle both.
    if isinstance(g, h5py.Dataset):
        print(f'  LEGACY compound dataset  shape={g.shape}')
        for name in g.dtype.names:
            sub = g.dtype[name]
            vals = g[:4][name]
            print(f'  {name:22s} {str(sub):12s}  e.g. {list(vals)}')
        continue
    for k in g:
        o = g[k]
        if isinstance(o, h5py.Dataset):
            sample = o[:3]
            print(f'  {k:22s} dataset  shape={o.shape} dtype={o.dtype}  e.g. {list(sample)[:3]}')
        else:
            cats = o.get('categories')
            codes = o.get('codes')
            print(f'  {k:22s} CATEGORICAL  {enc(o)}  '
                  f'codes={codes.shape if codes is not None else None} '
                  f'{codes.dtype if codes is not None else ""}  '
                  f'n_categories={cats.shape[0] if cats is not None else None}')
            if cats is not None:
                vals = [c.decode() if isinstance(c, bytes) else c for c in cats[:12]]
                print(f'  {"":22s}   -> {vals}')

for key in ('obsm', 'varm', 'obsp'):
    if key in f:
        print(f'\n=== {key} ===')
        for k in f[key]:
            o = f[key][k]
            print(f'  {k:16s} shape={getattr(o, "shape", "?")}  dtype={getattr(o, "dtype", "?")}')

if 'uns' in f:
    print('\n=== uns ===')
    def walk(g, ind='  '):
        for k in g:
            o = g[k]
            if isinstance(o, h5py.Dataset):
                v = o[()]
                if isinstance(v, bytes):
                    v = v.decode()
                s = str(v)
                print(f'{ind}{k:24s} {o.shape} {o.dtype}  {s[:70]}')
            else:
                print(f'{ind}{k}/')
                if len(ind) < 6:
                    walk(o, ind + '  ')
    walk(f['uns'])

f.close()
