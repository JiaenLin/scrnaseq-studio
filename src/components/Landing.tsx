import { useRef, useState } from 'react'

const REPO = 'https://github.com/JiaenLin/scrnaseq-studio'
const RAW = 'https://raw.githubusercontent.com/JiaenLin/scrnaseq-studio/main/tools'
const LAB = 'https://jiaenlin.github.io/scrnaseq-lab/'

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

const DEMOS: [string, string, string, string][] = [
  ['cohort', '4 v 4', 'Replicated cohort', 'Two conditions, four animals each'],
  ['course', 'time course', 'Time course', '0–72 h, one sample per point'],
  ['wt', 'single', 'Wild type only', 'No contrast — markers and gene search'],
]

/**
 * A section heading on this page.
 *
 * Not `.eyebrow` — that is deliberately the lightest grey in the palette, for
 * captions sitting above a card's own title. Used as the only label for a
 * whole section it reads as a caption for nothing.
 */
const SectionTitle = ({ children }: { children: string }) => (
  <h2 className="text-[11.5px] font-bold uppercase tracking-[0.09em]"
    style={{ color: 'var(--ink)' }}>{children}</h2>
)

/** What has to be in a bundle. Terse rows, not sentences. */
const NEEDS: [string, boolean, string][] = [
  ['Clusters', true, 'a categorical cell annotation — every view is per cell type'],
  ['Embedding', true, 'UMAP or t-SNE, two dimensions'],
  ['Expression', true, 'log-normalized, not scaled — z-scores are refused'],
  ['Sample', false, 'which animal or run — without it, no composition spread'],
  ['Condition', false, 'the experimental group — without it, no comparisons'],
  ['Raw counts', false, 'integer, pre-normalization — without them, no pseudobulk'],
]

export default function Landing({ onDemo, onFile, error, busy, note }: {
  onDemo: (key: string) => void
  onFile: (file: File) => void
  error: string | null
  busy: boolean
  /** What the opening is doing right now — a large object takes a moment. */
  note?: string | null
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
      <div className="w-full max-w-[540px]">
        <header className="text-center">
          <div
            className="mx-auto mb-3 grid h-[30px] w-[30px] place-items-center rounded-[9px] text-xs font-bold text-white"
            style={{ background: 'linear-gradient(150deg, var(--accent), #a855f7)' }}
          >sc</div>
          <h1 className="text-[20px] tracking-[-0.02em]">scRNA-seq Studio</h1>
          <p className="mx-auto mt-1.5 max-w-[470px] text-[13px]" style={{ color: 'var(--ink-2)' }}>
            Explore a processed single-cell object — nothing re-run, nothing uploaded.
          </p>
        </header>

        <div
          className="mt-6 rounded-2xl px-6 py-9 text-center"
          style={{
            border: `1.5px dashed ${over ? 'var(--accent)' : 'var(--line-2)'}`,
            background: over ? 'var(--accent-soft)' : 'var(--surface)',
            transition: 'border-color 160ms ease, background-color 160ms ease',
          }}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        >
          <input
            ref={input} type="file" accept=".zip" className="hidden"
            onChange={e => take(e.target.files)}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Opening…' : 'Open a bundle'}
          </button>
          <p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {note ?? <>or drop it here — a <code className="mono">.zip</code> from scRNA-seq Lab</>}
          </p>
        </div>

        {error && (
          <div className="note mt-3"><b>That file did not open.</b> {error}</div>
        )}

        {/* One quiet notice, one link. This used to be a filled button competing
            with "Open a bundle" for the same visual weight, which left the page
            with two primary actions and no answer to which one you wanted. */}
        <div className="mt-4 rounded-xl px-4 py-3" style={{ background: 'var(--sunk)' }}>
          <div className="text-[12.5px] font-semibold">Don&rsquo;t have a bundle yet?</div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            A bundle is made once from your <code className="mono">.h5ad</code> or{' '}
            <code className="mono">.rds</code> —{' '}
            <a className="underline" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}
              href={LAB} target="_blank" rel="noreferrer">convert it in scRNA-seq&nbsp;Lab →</a>
          </p>
          <button
            className="mt-1.5 text-[11.5px] underline"
            style={{ color: 'var(--ink-3)' }}
            onClick={() => dlg.current?.showModal()}
          >
            or convert offline with a script
          </button>
        </div>

        <div className="mt-7">
          <SectionTitle>Input format</SectionTitle>
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            One <code className="mono">.zip</code> from scRNA-seq Lab, or from{' '}
            <code className="mono">tools/export_*</code>. Not the{' '}
            <code className="mono">.h5ad</code> or <code className="mono">.rds</code> itself.
          </p>
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            Size is not a limit. An object too large to hold at once arrives as one file the
            lab stored in several pieces, and opens here as the whole thing — every cell, every
            tab. Expression is read a gene at a time as you ask for it, and whole-transcriptome
            tests run off the page, so nothing freezes while it works.
          </p>
          <div className="mt-2.5 grid gap-1.5">
            {NEEDS.map(([name, required, what]) => (
              <div key={name} className="flex items-baseline gap-2">
                <span className="w-[86px] flex-none text-[12px] font-semibold">{name}</span>
                <span className={`badge flex-none ${required ? 'badge-here' : 'badge-none'}`}>
                  {required ? 'required' : 'optional'}
                </span>
                <span className="text-[11.5px]" style={{ color: 'var(--ink-2)' }}>{what}</span>
              </div>
            ))}
          </div>
          <p className="mono mt-2.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            meta.json · genes.txt · expr.indptr/indices/data · cluster.u16 · sample.u16 ·
            embed.f32 · qc.f32 · pseudobulk.tsv
          </p>
          <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
            Field-by-field in{' '}
            <a className="underline" href={`${REPO}/blob/main/tools/BUNDLE.md`}
              target="_blank" rel="noreferrer">tools/BUNDLE.md</a>.
          </p>
        </div>

        <div className="mt-7"><SectionTitle>Try a demo</SectionTitle></div>
        <div className="mt-2 grid gap-1.5">
          {DEMOS.map(([key, tag, title, desc]) => (
            <button
              key={key} disabled={busy}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left"
              style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
              onClick={() => onDemo(key)}
            >
              {/* Fixed column: the tags are different widths, so without it the
                  three titles start at three different x positions. */}
              <span className="flex-none" style={{ width: 84 }}>
                <span className="badge badge-file">{tag}</span>
              </span>
              <span className="text-[12.5px] font-semibold">{title}</span>
              <span className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{desc}</span>
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          Generated in the browser and labelled as such throughout — they exist so every view
          has something to draw.
        </p>
      </div>

      <dialog
        ref={dlg}
        className="w-[calc(100%-40px)] max-w-[560px] rounded-2xl p-0"
        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        onClick={e => { if (e.target === dlg.current) dlg.current?.close() }}
      >
        <div className="px-[22px] py-5">
          <h2 className="text-base font-semibold">Converting offline</h2>
          <p className="mb-4 mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
            For a pipeline, or a machine with no browser.{' '}
            <a className="underline" href={LAB} target="_blank" rel="noreferrer">
              scRNA-seq Lab</a>{' '}does the same thing in a tab.
          </p>

          <div className="eyebrow">1 · Get the converter</div>
          <Code>{`# Scanpy / AnnData
curl -O ${RAW}/export_h5ad.py

# Seurat — needs no Seurat installed
curl -O ${RAW}/export_seurat.R`}</Code>

          <div className="eyebrow mt-4">2 · Install what it needs</div>
          <Code>{`pip install anndata scipy          # for .h5ad
R -e 'install.packages("digest")'  # for .rds`}</Code>

          <div className="eyebrow mt-4">3 · Run it with no options first</div>
          <Code>{`python export_h5ad.py yourfile.h5ad bundle.zip`}</Code>
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            It prints your obs columns, guesses the cluster annotation and names every decision.
          </p>

          <div className="eyebrow mt-4">4 · Re-run naming the columns</div>
          <Code>{`python export_h5ad.py yourfile.h5ad bundle.zip \\
    --cluster cell_type --sample orig.ident --condition treatment`}</Code>
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            A wrong name lists the ones that exist. Only <b>--cluster</b> is needed for a first look.
          </p>

          <p className="mt-4 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            What has to be in the bundle is listed on the page behind this dialog.
          </p>
          <div className="mt-4 text-right">
            <button className="btn" onClick={() => dlg.current?.close()}>Close</button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
