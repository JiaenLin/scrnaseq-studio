import type { CellType, Method } from '../types.ts'
import type { Source } from '../lib/source.ts'
import {
  condLabel, designFor, LFC_GATE, MIN_CELLS, PCT_GATE } from '../lib/stats.ts'
import { Card, Mono } from './Ui.tsx'

/**
 * The references, keyed rather than numbered.
 *
 * Which of them the text cites depends on the object — a bundle recording no
 * batch correction gets no Harmony sentence, and a t-SNE is not a UMAP — so a
 * fixed numbered list would carry entries nothing points at, which is the same
 * overclaim moved somewhere quieter. Numbers are handed out in the order the
 * prose asks for them and an uncited reference is not printed.
 */
const REFS = {
  seurat: <>Hao Y, et al. Integrated analysis of multimodal single-cell data. <i>Cell</i> 184, 3573–3587 (2021).</>,
  harmony: <>Korsunsky I, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. <i>Nat Methods</i> 16, 1289–1296 (2019).</>,
  leiden: <>Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. <i>Sci Rep</i> 9, 5233 (2019).</>,
  umap: <>McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection. <i>arXiv</i> 1802.03426 (2018).</>,
  tsne: <>van der Maaten L, Hinton G. Visualizing data using t-SNE. <i>J Mach Learn Res</i> 9, 2579–2605 (2008).</>,
  deseq2: <>Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. <i>Genome Biol</i> 15, 550 (2014).</>,
  practices: <>Heumos L, Schaar AC, … Theis FJ. Best practices for single-cell analysis across modalities. <i>Nat Rev Genet</i> 24, 550–572 (2023).</>,
  studio: <>scRNA-seq Studio. Browser-based exploration and differential expression for single-cell objects (2026). https://jiaenlin.github.io/scrnaseq-studio/</>,
}

type RefKey = keyof typeof REFS

/**
 * What an embedding key is a citation for.
 *
 * The object names its own embeddings and can carry several — X_UMAP and X_tSNE
 * on the atlas — so the paper cited follows the name in the file. A key this
 * does not recognise is still named; it simply gets no citation, which is the
 * honest outcome for a projection nobody here can identify.
 */
const EMB_REFS: [RegExp, RefKey][] = [
  [/umap/i, 'umap'],
  [/t-?sne/i, 'tsne'],
]

const METHOD_REFS: [RegExp, RefKey][] = [
  [/leiden/i, 'leiden'],
  [/harmony/i, 'harmony'],
]

const refFor = (text: string, table: [RegExp, RefKey][]): RefKey | null =>
  table.find(([re]) => re.test(text))?.[1] ?? null

export default function Methods({ src, types, ti, ctrl, cs, method, padjMax, lfcMin }: {
  src: Source
  types: CellType[]
  ti: number
  ctrl: string[]
  cs: string[]
  method: Method
  /** The cutoffs actually in force, so the prose can never drift from the figures. */
  padjMax: number
  lfcMin: number
}) {
  const d = src.d
  const design = designFor(src, ti, ctrl, cs)
  const wil = method === 'wilcox'
  const oneEach = d.samples.length === d.conds.length
  const ct = types[ti]?.name ?? ''
  const prov = src.meta.provenance

  // Numbers are allocated on first use, so the two paragraphs have to be built
  // in the order they are read — which is why the first one is a variable here
  // rather than markup in the return below.
  const used: RefKey[] = []
  const cite = (k: RefKey) => {
    let i = used.indexOf(k)
    if (i < 0) i = used.push(k) - 1
    return <sup>{i + 1}</sup>
  }

  const clustering = prov.clustering
  const clusterRef = clustering ? refFor(clustering, METHOD_REFS) : null
  const integration = prov.integration
  const integrationRef = integration ? refFor(integration, METHOD_REFS) : null

  const processing = (
    <p>
      This object was processed elsewhere and read from a bundle exported from{' '}
      <Mono>{src.meta.source}</Mono>. Expression values are{' '}
      <Mono>{src.meta.expression}</Mono>; nothing in this app imputes, denoises or rescales
      them. The {types.length} populations are the object&rsquo;s own labels
      {clustering
        ? <>, taken from its <Mono>{clustering}</Mono> annotation{clusterRef && cite(clusterRef)}</>
        : <>, and the file records no clustering method for them</>}.
      {integration && <> Inter-sample variation was corrected with{' '}
        <Mono>{integration}</Mono>{integrationRef && cite(integrationRef)}, as recorded in the
        object.</>}{' '}
      Cells are drawn on the {src.embeddings.length > 1 ? 'embeddings' : 'embedding'} the object
      carries — {src.embeddings.map((e, i) => {
        const r = refFor(e.key, EMB_REFS)
        return (
          <span key={e.key}>
            {i === 0 ? '' : i === src.embeddings.length - 1 ? ' and ' : ', '}
            <Mono>{e.key}</Mono>{r && cite(r)}
          </span>
        )
      })} — computed before export and never recomputed here.{' '}
      <b>Everything between the counts and those labels is unknown to this app</b>: how many
      variable genes were kept, how many components were used, how large the neighbourhood was
      and at what resolution the graph was cut are not carried in the file, and are not guessed
      at here. The populations are reported as {types.map(t => t.name).join(', ')}.
    </p>
  )

  const de = !d.multi ? (
    <>No between-group differential expression was performed, as the object contains a single
    condition. Cluster identities were supported by one-vs-rest Wilcoxon rank-sum
    tests{cite('seurat')}, reported as a ranking of marker genes rather than as hypothesis
    tests.</>
  ) : wil ? (
    <>Differential expression between {condLabel(cs)} and {condLabel(ctrl)} within {ct} was tested with a Wilcoxon
    rank-sum test across cells{cite('seurat')}, restricted to genes with an absolute log₂ fold
    change of at least {LFC_GATE} detected in at least {(PCT_GATE * 100).toFixed(0)}% of cells in
    either group, with p-values Bonferroni-adjusted for the number of genes tested. Genes with an
    adjusted p below {padjMax} and an absolute log₂ fold change of at least {lfcMin} were considered
    differentially expressed.{' '}
    {oneEach
      ? <>The design contains one sample per group, so these p-values describe variation between
        cells rather than between animals{cite('practices')}.</>
      : <>Because cells from the same animal are not independent observations, these p-values
        describe variation between cells rather than between animals{cite('practices')}.</>}</>
  ) : (
    <>Differential expression between {condLabel(cs)} and {condLabel(ctrl)} within {ct} was tested on pseudobulk
    profiles{cite('practices')}: raw counts were summed across all cells of a given animal, animals
    contributing fewer than {MIN_CELLS} cells of that type were excluded, and the resulting matrix
    of {design.n0} {condLabel(ctrl)} and {design.n1} {condLabel(cs)} profiles was tested with DESeq2{cite('deseq2')} using{' '}
    {condLabel(ctrl)} as the reference level, with Benjamini–Hochberg adjustment. Genes with an adjusted p
    below {padjMax} and an absolute log₂ fold change of at least {lfcMin} were considered
    differentially expressed.</>
  )

  const closing = (
    <>{' '}Exploration, figures and statistics were produced in scRNA-seq
    Studio{cite('studio')}, which runs these tests in the browser.</>
  )

  return (
    <>
      <Card
        eyebrow="Methods" title="Single-cell RNA sequencing analysis"
        sub="Continuous prose under one heading, every step read from the object. The text follows the test currently selected, and stops where the file stops."
      >
        <div className="prose-methods mt-3.5">
          {processing}
          <p>{de}{closing}</p>
        </div>

        <div className="mt-[18px]">
          <div className="eyebrow mb-2">References</div>
          <ol className="m-0 pl-5 text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {used.map(k => <li key={k} className="mb-1.5">{REFS[k]}</li>)}
          </ol>
        </div>
      </Card>

      <div className="note">
        <b>Sentences this generator refuses to write.</b> It will not name a normalization, a
        variable-gene count, a number of components or a clustering resolution, because a bundle
        carries none of them; it will not claim doublet removal or ambient RNA correction, because
        neither is recorded in this object; it will not describe a batch correction it did not
        find; it will not call a t-SNE a UMAP; and it will not call a one-sample-per-group design
        replicated. Anything absent from the file is absent from the text — including the
        references, which are printed only where the prose cites them. The cutoffs above are read
        from <Mono>lib/stats.ts</Mono>, so the prose and the figures can never disagree.
      </div>
    </>
  )
}
