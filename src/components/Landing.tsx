import { useRef, useState, type ReactNode } from 'react'

const REPO = 'https://github.com/JiaenLin/scrnaseq-studio'
const RAW = 'https://raw.githubusercontent.com/JiaenLin/scrnaseq-studio/main/tools'

function Code({ children }: { children: string }) {
  // Wrapped rather than scrolled: a command you cannot see is a command you
  // cannot copy, and these lines are mostly long URLs.
  return (
    <pre
      className="mono mt-1.5 whitespace-pre-wrap rounded-lg px-3 py-2 text-[11.5px] leading-relaxed"
      style={{ background: 'var(--sunk)', border: '1px solid var(--line)', overflowWrap: 'anywhere' }}
    >{children}</pre>
  )
}

function Step({ n, title, children, last }: {
  n: number; title: string; children: ReactNode; last?: boolean
}) {
  return (
    <div className={`flex gap-3 ${last ? 'pb-1' : 'pb-3'}`}>
      <div
        className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] text-[11px] font-bold text-white"
        style={{ background: 'var(--accent)' }}
      >{n}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{title}</div>
        {children}
      </div>
    </div>
  )
}

const DEMOS: [string, string, string, string][] = [
  ['cohort', '4 v 4', 'Replicated cohort',
   'Two conditions, four animals each. Both tests available.'],
  ['course', 'time course', 'Time course, no replicates',
   '0, 6, 24 and 72 h — one sample per point. Wilcoxon only.'],
  ['wt', 'single', 'Wild type only',
   'No comparison at all. Markers and gene search still work.'],
]

/** What the app needs, and what happens when it is missing. */
const REQUIREMENTS: [string, ReactNode, ReactNode][] = [
  ['Clusters', 'a categorical cell annotation',
    <>Required. Every view is per cell type, so without one there is nothing to group by.</>],
  ['Embedding', 'UMAP or t-SNE, two dimensions',
    <>Required by the Cells and Feature plot tabs.</>],
  ['Expression', 'log-normalized, not scaled',
    <>Required. Scaled values are z-scores and would render violins and dot plots that
      look normal and are wrong, so the exporter refuses them.</>],
  ['Sample', 'which animal or run each cell came from',
    <>Optional. Without it the object is treated as one sample, and composition cannot
      show between-animal spread.</>],
  ['Condition', 'the experimental group',
    <>Optional. Without it the object opens single-condition and the comparison tabs stay
      empty rather than inventing a contrast.</>],
  ['Raw counts', 'integer, before normalization',
    <>Optional. Without them pseudobulk is unavailable and only the per-cell test runs.</>],
]

export default function Landing({ onDemo, onFile, error, busy }: {
  onDemo: (key: string) => void
  onFile: (file: File) => void
  error: string | null
  busy: boolean
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const take = (list: FileList | null) => {
    const f = list?.[0]
    if (f) onFile(f)
  }

  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-[680px]">
        <div
          className="rounded-[18px] px-[30px] py-[34px] text-center"
          style={{
            border: `1.5px dashed ${over ? 'var(--accent)' : 'var(--line-2)'}`,
            background: over ? 'var(--accent-soft)' : 'var(--surface)',
            transition: 'border-color 160ms ease, background-color 160ms ease',
          }}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        >
          <div
            className="mx-auto mb-3.5 grid h-[30px] w-[30px] place-items-center rounded-[9px] text-xs font-bold text-white"
            style={{ background: 'linear-gradient(150deg, var(--accent), #a855f7)' }}
          >sc</div>
          <h1 className="text-[19px] tracking-[-0.02em]">scRNA-seq Studio</h1>
          <p className="mb-[18px] mt-2 text-[13.5px]" style={{ color: 'var(--ink-2)' }}>
            Open a processed single-cell object and explore it — without re-running anything.
            Your file never leaves this browser.
          </p>

          <input
            ref={input} type="file" accept=".zip" className="hidden"
            onChange={e => take(e.target.files)}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Opening…' : 'Open a bundle'}
          </button>
          <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            or drop it anywhere on this panel
          </p>

          {error && (
            <div className="note mt-4 text-left">
              <b>That file did not open.</b> {error}
            </div>
          )}

          <div className="mt-5 rounded-xl px-4 py-3 text-left" style={{ background: 'var(--sunk)' }}>
            <div className="eyebrow">The input is a bundle, not the object itself</div>
            <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
              Convert a Scanpy <code className="mono">.h5ad</code> or a Seurat{' '}
              <code className="mono">.rds</code> once, offline — the conversion is where
              the two formats' quirks get resolved, and it keeps a 288&nbsp;MB object from
              having to be loaded whole in a browser tab.
            </p>
            <pre
              className="mono mt-2.5 whitespace-pre-wrap rounded-lg px-3 py-2 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)',
                       overflowWrap: 'anywhere' }}
            >{`curl -O ${RAW}/export_h5ad.py
python export_h5ad.py yourfile.h5ad bundle.zip`}</pre>
            <button className="btn btn-primary mt-2" onClick={() => dlg.current?.showModal()}>
              How to convert — step by step
            </button>
          </div>

          <div className="eyebrow mt-6 text-left">Or try a demo object</div>
          <div className="mt-2.5 grid gap-2 text-left">
            {DEMOS.map(([key, tag, title, desc]) => (
              <button
                key={key} disabled={busy}
                className="flex items-start gap-3 rounded-xl px-[13px] py-[11px]"
                style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
                onClick={() => onDemo(key)}
              >
                <span className="badge badge-file mt-px">{tag}</span>
                <span>
                  <span className="block text-[13px] font-semibold">{title}</span>
                  <span className="block text-xs" style={{ color: 'var(--ink-2)' }}>{desc}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
            The demos are generated in the browser and labelled as such throughout — they
            exist so every view has something to draw, not to stand in for your data.
          </p>
        </div>
      </div>

      <dialog
        ref={dlg}
        className="w-[calc(100%-40px)] max-w-[620px] rounded-2xl p-0"
        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        onClick={e => { if (e.target === dlg.current) dlg.current?.close() }}
      >
        <div className="px-[22px] py-5">
          <h2 className="text-base font-semibold">Converting your object</h2>
          <p className="mb-3 mt-1.5 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            One script, run once, on the machine where the object already is. You do not need to
            install this studio, and the converter never uploads anything.
          </p>

          <Step n={1} title="Get the converter — one file">
            <Code>{`# Scanpy / AnnData
curl -O ${RAW}/export_h5ad.py

# Seurat
curl -O ${RAW}/export_seurat.R`}</Code>
          </Step>

          <Step n={2} title="Check the libraries it needs">
            <Code>{`# for .h5ad — anndata reads both the modern and the legacy layout
pip install anndata scipy

# for .rds — Matrix ships with R. Seurat is NOT required.
R -e 'install.packages("digest")'`}</Code>
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
              The Seurat converter reads the object through <code className="mono">readRDS</code>{' '}
              and <code className="mono">attributes()</code>, so it works even where the Seurat
              version that wrote the file can no longer be installed.
            </p>
          </Step>

          <Step n={3} title="Run it once with no options">
            <Code>{`python export_h5ad.py yourfile.h5ad bundle.zip`}</Code>
            <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
              It prints the columns your object actually has, guesses the cluster annotation, and
              names every decision it had to make. Read that output — it is the same text the app
              shows on the Overview tab afterwards.
            </p>
          </Step>

          <Step n={4} title="Re-run naming the columns you want">
            <Code>{`python export_h5ad.py yourfile.h5ad bundle.zip \
    --cluster cell_type --sample orig.ident --condition treatment`}</Code>
            <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
              Get a name wrong and it lists the ones that exist rather than guessing. Only
              <b> --cluster</b> matters for a first look; the other two unlock composition spread
              and the comparison tabs.
            </p>
          </Step>

          <Step n={5} title="Open bundle.zip here" last>
            <p className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
              Drop it on the panel behind this dialog. A PBMC-sized object converts to about
              8&nbsp;MB and opens in well under a second.
            </p>
          </Step>

          <div className="eyebrow mt-4 mb-2">What has to be in there</div>
          <div className="scrollx">
            <table className="t">
              <thead><tr><th>Needs</th><th>Which is</th><th>If missing</th></tr></thead>
              <tbody>
                {REQUIREMENTS.map(([name, what, missing]) => (
                  <tr key={name}>
                    <td className="whitespace-nowrap font-semibold">{name}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{what}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
            Full format in <a className="underline" href={`${REPO}/blob/main/tools/BUNDLE.md`}
              target="_blank" rel="noreferrer">tools/BUNDLE.md</a>. Raw FASTQ instead? Start at{' '}
            <b>rnaseq-service</b>. A bulk count matrix goes to <b>rnaseq-lab</b>, then{' '}
            <b>rnaseq-studio</b>.
          </p>
          <div className="mt-4 text-right">
            <button className="btn" onClick={() => dlg.current?.close()}>Close</button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
