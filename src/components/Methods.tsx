import type { CellType, Method } from '../types.ts'
import type { Source } from '../lib/source.ts'
import {
  condLabel, designFor, MIN_CELLS, type Gates } from '../lib/stats.ts'
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

export default function Methods({
  src, types, tis, ctrl, cs, method, padjMax, lfcMin, gates, lib,
}: {
  src: Source
  types: CellType[]
  /** The cell types the contrast pools — a list; see StatsProps#tis. */
  tis: number[]
  ctrl: string[]
  cs: string[]
  method: Method
  /** The cutoffs actually in force, so the prose can never drift from the figures. */
  padjMax: number
  lfcMin: number
  /**
   * And the gates in force, for the same reason — a reader who has widened
   * them has run a different test, and the paragraph that names Seurat's
   * defaults would be describing an analysis nobody performed.
   */
  gates: Gates
  /**
   * Which MSigDB is loaded, so the prose names the release rather than a
   * version somebody typed into it once. Null before it arrives.
   */
  lib: { release: string; taxon: string } | null
}) {
  const d = src.d
  const design = designFor(src, tis, ctrl, cs)
  const wil = method === 'wilcox'
  const oneEach = d.samples.length === d.conds.length
  // Spelled out in full here, however many there are. Methods is the one place
  // that must name every population the test ran over — a reader reproducing it
  // cannot work from "3 cell types".
  const ct = tis.map(i => types[i]?.name).filter(Boolean).join(', ')
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
    change of at least {gates.lfc} detected in at least {(gates.pct * 100).toFixed(0)}% of cells in
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
        sub="Read from the object, and following the test now selected."
      >
        <div className="prose-methods">
          {processing}
          <p>{de}{closing}</p>
        </div>

        <div className="mt-5">
          <div className="eyebrow mb-2">References</div>
          <ol className="m-0 pl-5 tx-small" style={{ color: 'var(--ink-2)' }}>
            {used.map(k => <li key={k} className="mb-1.5">{REFS[k]}</li>)}
          </ol>
        </div>

        {/**
          * Where the studio's arguments live.
          *
          * Every card used to carry its own methodological defence in prose,
          * which is right once and wrong on every visit after that — a reader
          * who already knows why a violin has a detection bar still had to read
          * past the reason to reach the figure. The figures now state the fact;
          * the argument is here, once, under a heading a reviewer will look
          * for, in the same tab as the citations that support it.
          */}
        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <div className="eyebrow mb-2">How to read these numbers</div>
          <div className="prose-methods" style={{ color: 'var(--ink-2)' }}>
            <p className="m-0">
              <b>Significance is read as −log₁₀ padj.</b> A per-cell test over tens of thousands
              of genes reaches p-values below the smallest double, so <b>p</b> and{' '}
              <b>p adjusted</b> print as <Mono>&lt; 10⁻³⁰⁸</Mono> once they underflow — a bound,
              not a reading. −log₁₀ padj is formed in log space, does not underflow, and still
              separates rows that share that bound. The volcano&rsquo;s y axis is this column.
              <b> Combined</b> is −log₁₀(padj) × log₂FC, a signed ranking metric.
            </p>
            <p className="mb-0 mt-3">
              <b>Cluster markers rank; they do not test.</b> Each cluster is compared against
              every other cell with the same Wilcoxon that Seurat&rsquo;s{' '}
              <Mono>FindAllMarkers</Mono> runs — but the clusters were defined using the
              expression these p-values then score, so they are not evidence the clusters exist.
              The effect size and the detection rates are the honest columns.
            </p>
            <p className="mb-0 mt-3">
              <b>Composition is never pooled across samples.</b> Cells from one animal are not
              independent observations, so a bar merging several animals is refused rather than
              drawn. Each cell type gets its own y axis; a shared one flattens every population
              except the largest.
            </p>
            <p className="mb-0 mt-3">
              <b>Scaling a dot plot changes its claim.</b> Seurat&rsquo;s{' '}
              <Mono>scale = TRUE</Mono> z-scores each gene down its own column, so colour shows
              <em> where</em> a gene is highest, not how abundant it is — a gene expressed evenly
              everywhere comes out uniformly pale. Turn scaling off to compare absolute levels.
            </p>
            <p className="mb-0 mt-3">
              <b>Enrichment tests against the genes this object measured</b>, never the whole
              genome: testing against genes the assay could not detect inflates every result.
              The background is narrowed once more, to the measured genes that are in at least
              one set — the annotated background — because a gene no set contains could never
              have been drawn into one. A module score subtracts a control set matched on
              expression level, which is what makes zero meaningful.
            </p>
            <p className="mb-0 mt-3">
              <b>The gene sets are MSigDB{lib ? ` ${lib.release}` : ''}</b>
              {lib && <>, the collections native to {lib.taxon}</>}. Native, not projected:
              MSigDB curates a separate mouse database, and mapping the human sets across
              orthologs instead would give different membership for every set — over the fifty
              hallmark sets the two agree on a mean Jaccard of 0.57 and not one is identical.
              Only the collections switched on are tested, and the correction is applied across
              those.
            </p>
            <p className="mb-0 mt-3">
              <b>Co-expression r is Pearson by default, and carries no p-value on purpose.</b>{' '}
              Pearson is what WGCNA and hdWGCNA use, and it is what the card computes unless
              Spearman is chosen — which is the same correlation over the RANKS, so one extreme
              metacell cannot carry an r on its own and a saturating relationship still reads
              as one. Spearman is offered only where the observations are pooled: on the
              per-cell axis most values are exactly zero, so the ranks are one enormous tie
              block and the correlation would be describing the dropout pattern. Which of the
              two produced a given table is named above it and in its CSV heading.
              Correlation is taken
              across observations, and with tens of thousands of cells almost any r clears
              any threshold — while cells from one animal are not independent draws, the same
              reason this studio separates the per-cell test from pseudobulk. So the table
              ranks by r and shows the detection rate beside it. Two further cautions are
              built into the defaults rather than left to the reader: a gene detected in
              under 10% of the cells in scope is not ranked at all, because on a matrix this
              sparse two rarely-detected genes agree wherever they are both absent; and cells
              are pooled into near-equal metacells before correlating, which is what makes r
              mean what it appears to mean. The pooling follows hdWGCNA: no metacell spans two
              cell types or two samples, so a pool cannot be two populations that happen to sit
              near each other, and none is built from fewer than ten cells. Pooling is on the
              embedding — a 2-D projection, where hdWGCNA uses a reduced space with many more
              components — and that approximation is stated on the card.
            </p>
            <p className="mb-0 mt-3">
              <b>A signature is signed before it is combined.</b> Seeding a correlation with
              the mean of a set&rsquo;s members cancels: a pathway holds members that move in
              opposite directions, and the mean is dominated by whichever are most abundant.
              So the set is first correlated with itself, each member is standardised and
              given the sign of the leading eigenvector of that matrix — WGCNA&rsquo;s module
              eigengene — and the members are combined only then. Because each member is
              standardised, the correlation against that composite <em>is</em> the weighted
              mean of the members&rsquo; own independent correlations, so one pass reports what
              testing every member separately would have said. How much of the set runs one
              way is reported with the result, since a combined score over a set that is
              really two programmes is a number to read with care.
            </p>
            <p className="mb-0 mt-3">
              <b>What this text will not say.</b> It names no normalization, variable-gene count,
              component count or clustering resolution, because a bundle carries none of them; it
              claims no doublet removal, ambient-RNA correction or batch correction it did not
              find; it does not call a t-SNE a UMAP, or a one-sample-per-group design replicated.
              Cutoffs are read from <Mono>lib/stats.ts</Mono>, so the prose and the figures cannot
              disagree.
            </p>
          </div>
        </div>
      </Card>
    </>
  )
}
