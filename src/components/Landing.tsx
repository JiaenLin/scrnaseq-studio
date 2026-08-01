import { useRef } from 'react'

const DEMOS: [string, string, string, string][] = [
  ['cohort', '4 v 4', 'Replicated cohort',
   'Two conditions, four animals each. Both tests available.'],
  ['course', 'time course', 'Time course, no replicates',
   '0, 6, 24 and 72 h — one sample per point. Wilcoxon only.'],
  ['wt', 'single', 'Wild type only',
   'No comparison at all. Markers and gene search still work.'],
]

export default function Landing({ onOpen }: { onOpen: (key: string) => void }) {
  const dlg = useRef<HTMLDialogElement>(null)

  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div
        className="w-full max-w-[620px] rounded-[18px] px-[30px] py-[34px] text-center"
        style={{ border: '1.5px dashed var(--line-2)', background: 'var(--surface)' }}
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
        <button className="btn btn-primary" onClick={() => onOpen('cohort')}>
          Open .h5ad or Seurat .rds
        </button>
        <div className="mt-2.5">
          <button className="btn btn-ghost" onClick={() => dlg.current?.showModal()}>
            Don&rsquo;t have an object yet?
          </button>
        </div>

        <div className="eyebrow mt-6 text-left">Or try a demo object</div>
        <div className="mt-2.5 grid gap-2 text-left">
          {DEMOS.map(([key, tag, title, desc]) => (
            <button
              key={key}
              className="flex items-start gap-3 rounded-xl px-[13px] py-[11px]"
              style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
              onClick={() => onOpen(key)}
            >
              <span className="badge badge-file mt-px">{tag}</span>
              <span>
                <span className="block text-[13px] font-semibold">{title}</span>
                <span className="block text-xs" style={{ color: 'var(--ink-2)' }}>{desc}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="mono mt-5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          AnnData .h5ad — read lazily, any size &nbsp;·&nbsp; Seurat .rds — read via webR, up to ~1.5&nbsp;GB
        </p>
      </div>

      <dialog
        ref={dlg}
        className="w-[calc(100%-40px)] max-w-[520px] rounded-2xl p-0"
        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        onClick={e => { if (e.target === dlg.current) dlg.current?.close() }}
      >
        <div className="px-[22px] py-5">
          <h2 className="text-base font-semibold">Where should you start?</h2>
          <p className="mb-3 mt-1.5 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            Pick the row that matches what you have on disk right now.
          </p>
          {[
            ['Raw FASTQ files only',
             <>Build a sequencing-service request in <b>rnaseq-service</b> — it scans the bundle and names your samples.</>],
            ['A bulk gene count matrix',
             <>Run DESeq2 in <b>rnaseq-lab</b>, then bring the result bundle to <b>rnaseq-studio</b>.</>],
            ['A cell × gene matrix, not yet clustered',
             <>Process it in Scanpy or Seurat first — QC, normalize, cluster, embed — then save <code className="mono">.h5ad</code> or <code className="mono">.rds</code> and come back here.</>],
            ['A processed AnnData or Seurat object', <>You&rsquo;re in the right place. Open it above.</>],
          ].map(([title, body], i) => (
            <div key={i} className="flex gap-3 py-[11px]" style={{ borderTop: '1px solid var(--line)' }}>
              <div
                className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] text-[11px] font-bold"
                style={{ background: 'var(--sunk)', color: 'var(--ink-2)' }}
              >{i + 1}</div>
              <div>
                <b>{title as string}</b><br />
                <span className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>{body}</span>
              </div>
            </div>
          ))}
          <div className="mt-4 text-right">
            <button className="btn" onClick={() => dlg.current?.close()}>Close</button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
