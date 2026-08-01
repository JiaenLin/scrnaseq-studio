import type { CellType, Dataset, Method } from '../types.ts'
import { designFor, LFC_GATE, MIN_CELLS, PCT_GATE } from '../lib/stats.ts'
import { Card, Mono } from './Ui.tsx'

const REFS: React.ReactNode[] = [
  <>Wolf FA, Angerer P, Theis FJ. SCANPY: large-scale single-cell gene expression data analysis. <i>Genome Biol</i> 19, 15 (2018).</>,
  <>Hao Y, et al. Integrated analysis of multimodal single-cell data. <i>Cell</i> 184, 3573–3587 (2021).</>,
  <>Korsunsky I, et al. Fast, sensitive and accurate integration of single-cell data with Harmony. <i>Nat Methods</i> 16, 1289–1296 (2019).</>,
  <>Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. <i>Sci Rep</i> 9, 5233 (2019).</>,
  <>McInnes L, Healy J, Melville J. UMAP: Uniform Manifold Approximation and Projection. <i>arXiv</i> 1802.03426 (2018).</>,
  <>Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. <i>Genome Biol</i> 15, 550 (2014).</>,
  <>Heumos L, Schaar AC, … Theis FJ. Best practices for single-cell analysis across modalities. <i>Nat Rev Genet</i> 24, 550–572 (2023).</>,
  <>scRNA-seq Studio. Browser-based exploration and differential expression for single-cell objects (2026). https://jiaenlin.github.io/scrnaseq-studio/</>,
]

const Sup = ({ n }: { n: number }) => <sup>{n}</sup>

export default function Methods({ d, types, ti, ctrl, cs, method }: {
  d: Dataset
  types: CellType[]
  ti: number
  ctrl: string
  cs: string
  method: Method
}) {
  const design = designFor(d, ti, ctrl, cs)
  const wil = method === 'wilcox'
  const oneEach = d.samples.length === d.conds.length
  const ct = types[ti]?.name ?? ''

  const de = !d.multi ? (
    <>No between-group differential expression was performed, as the object contains a single
    condition. Cluster identities were supported by one-vs-rest Wilcoxon rank-sum tests<Sup n={2} />,
    reported as a ranking of marker genes rather than as hypothesis tests.</>
  ) : wil ? (
    <>Differential expression between {cs} and {ctrl} within {ct} was tested with a Wilcoxon
    rank-sum test across cells<Sup n={2} />, restricted to genes with an absolute log₂ fold change
    of at least {LFC_GATE} detected in at least {(PCT_GATE * 100).toFixed(0)}% of cells in either
    group, with p-values Bonferroni-adjusted for the number of genes tested. Genes with an adjusted
    p below 0.05 past that fold-change threshold were considered differentially expressed.{' '}
    {oneEach
      ? <>The design contains one sample per group, so these p-values describe variation between
        cells rather than between animals<Sup n={7} />.</>
      : <>Because cells from the same animal are not independent observations, these p-values
        describe variation between cells rather than between animals<Sup n={7} />.</>}</>
  ) : (
    <>Differential expression between {cs} and {ctrl} within {ct} was tested on pseudobulk
    profiles<Sup n={7} />: raw counts were summed across all cells of a given animal, animals
    contributing fewer than {MIN_CELLS} cells of that type were excluded, and the resulting matrix
    of {design.n0} {ctrl} and {design.n1} {cs} profiles was tested with DESeq2<Sup n={6} /> using{' '}
    {ctrl} as the reference level, with Benjamini–Hochberg adjustment. Genes with an adjusted p
    below 0.05 and an absolute log₂ fold change above 1 were considered differentially expressed.</>
  )

  return (
    <>
      <Card
        eyebrow="Methods" title="Single-cell RNA sequencing analysis"
        sub="Continuous prose under one heading, cutoffs and design read from the object. The text follows the test currently selected."
      >
        <div className="prose-methods mt-3.5">
          <p>
            Single-cell RNA sequencing data were processed in Scanpy v1.10.2<Sup n={1} />. Counts
            were normalized to 10,000 per cell and log-transformed, and the 2,000 most variable
            genes were retained for dimensionality reduction. The first 50 principal components{' '}
            {d.samples.length > 1 && <>were corrected for inter-sample variation with Harmony<Sup n={3} /> and </>}
            were used to build a 15-nearest-neighbour graph, which was clustered with the Leiden
            algorithm<Sup n={4} /> at resolution 1.0 and embedded in two dimensions with
            UMAP<Sup n={5} />. Clustering yielded {types.length} populations, annotated by canonical
            markers and reported here as {types.map(t => t.name).join(', ')}.
          </p>
          <p>
            {de} Exploration, figures and statistics were produced in scRNA-seq Studio<Sup n={8} />,
            which runs these tests in the browser; no imputation or denoising was applied at any stage.
          </p>
        </div>

        <div className="mt-[18px]">
          <div className="eyebrow mb-2">References</div>
          <ol className="m-0 pl-5 text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {REFS.map((r, i) => <li key={i} className="mb-1.5">{r}</li>)}
          </ol>
        </div>
      </Card>

      <div className="note">
        <b>Sentences this generator refuses to write.</b> It will not claim doublet removal or
        ambient RNA correction, because neither is recorded in this object; it will not describe a
        batch correction it did not find; and it will not call a one-sample-per-group design
        replicated. Anything absent from the file is absent from the text. The
        cutoffs above are read from <Mono>lib/stats.ts</Mono>, so the prose and the figures can
        never disagree.
      </div>
    </>
  )
}
