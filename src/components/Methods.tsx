import type { CellType, Method } from '../types.ts'
import type { Source } from '../lib/source.ts'
import {
  condLabel, designFor, MIN_CELLS, type Gates, type SigBasis } from '../lib/stats.ts'
import { carriedRecords, runView } from '../lib/run.ts'
import { countText, sentinelCount } from '../lib/sentinels.ts'
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
  src, types, tis, ctrl, cs, method, padjMax, lfcMin, gates, sigBasis = 'padj', lib,
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
  /** Which correction the cutoff is read off, so the sentence names the one in force. */
  sigBasis?: SigBasis
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
  // The populations are the cell types. A sentinel — the annotator's label for
  // a cell it did not call — is not one, and the paragraph says how many cells
  // carried one and what was done with them, because a reader reproducing the
  // numbers has to leave the same cells out.
  const pops = types.filter(t => !t.sentinel)
  const uncalled = sentinelCount(d.cells, types)
  // The run's records whose content travelled with the bundle. A record the
  // converter only named carries nothing, so it changes nothing below.
  const carried = carriedRecords(runView(src.meta))

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
      them. The {pops.length} cell types are the object&rsquo;s own labels
      {clustering
        ? <>, taken from its <Mono>{clustering}</Mono> annotation{clusterRef && cite(clusterRef)}</>
        : <>, and the file records no clustering method for them</>}.
      {integration && <> Inter-sample variation was corrected with{' '}
        <Mono>{integration}</Mono>{integrationRef && cite(integrationRef)}, as recorded in the
        object.</>}{' '}
      Cells are drawn on the {src.embeddings.length > 1 ? 'embeddings' : 'embedding'} the object
      carries ({src.embeddings.map((e, i) => {
        const r = refFor(e.key, EMB_REFS)
        return (
          <span key={e.key}>
            {i === 0 ? '' : i === src.embeddings.length - 1 ? ' and ' : ', '}
            <Mono>{e.key}</Mono>{r && cite(r)}
          </span>
        )
      })}), computed before export and never recomputed here.{' '}
      {carried.length ? (
        // The file now says what made the object, so "not carried in the file"
        // would be false. What stays true is that this text reads nothing out
        // of those records: the parameters are the tools' own words, on
        // Overview, and a paragraph that picked some of them out would be
        // choosing which of a tool's settings to call the method.
        <><b>This text reads nothing between the counts and those labels</b>: the object carries
        the run&rsquo;s own record{carried.length === 1 ? '' : 's'} ({carried.map((p, i) => (
          <span key={`${i}:${p}`}>{i === 0 ? '' : i === carried.length - 1 ? ' and ' : ', '}<Mono>{p}</Mono></span>
        ))}), which Overview shows as recorded, and how many variable genes were kept, how many
        components were used, how large the neighbourhood was and at what resolution the graph was
        cut are not read out of {carried.length === 1 ? 'it' : 'them'} here, and are not guessed
        at.</>
      ) : (
        <><b>Everything between the counts and those labels is unknown to this app</b>: how many
        variable genes were kept, how many components were used, how large the neighbourhood was
        and at what resolution the graph was cut are not carried in the file, and are not guessed
        at here.</>
      )} The cell types are reported as {pops.map(t => t.name).join(', ')}.
      {uncalled.total > 0 && <> A further {uncalled.total.toLocaleString('en-US')} cells carry
        the annotator&rsquo;s labels for cells it did not call ({countText(uncalled)}); they are
        not a cell type, so they are left out of every cell type&rsquo;s count, every proportion and every test below,
        and kept on the embedding.</>}
    </p>
  )

  const de = !d.multi ? (
    <>No between-group differential expression was performed, as the object contains a single group. Cell types were supported by one-vs-rest Wilcoxon rank-sum
    tests{cite('seurat')}{uncalled.total > 0 && <>, each cell type against every other cell
    with a cell type</>}, reported as a ranking of marker genes rather than as hypothesis
    tests.</>
  ) : wil ? (
    <>Differential expression between {condLabel(cs)} and {condLabel(ctrl)} within {ct} was tested with a Wilcoxon
    rank-sum test across cells{cite('seurat')}, restricted to genes with an absolute log₂ fold
    change of at least {gates.lfc} detected in at least {(gates.pct * 100).toFixed(0)}% of cells in
    either group, with p-values {sigBasis === 'fdr'
      ? <>adjusted by the Benjamini–Hochberg procedure, with <i>m</i> the {src.genes.length.toLocaleString()} genes
        the object measures</>
      : <>Bonferroni-adjusted for the {src.genes.length.toLocaleString()} genes the object measures, tested or
        not</>}. Genes with an
    adjusted p below {padjMax} and an absolute log₂ fold change of at least {lfcMin} were considered
    differentially expressed.{' '}
    {oneEach
      ? <>The design contains one sample per group, so these p-values describe variation between
        cells rather than between samples{cite('practices')}.</>
      : <>Because cells from the same sample are not independent observations, these p-values
        describe variation between cells rather than between samples{cite('practices')}.</>}</>
  ) : (
    // What the pseudobulk path does, and only that: it sums the counts and
    // exports them. DESeq2 is cited as what the matrix is for, not as a test
    // that ran — this paragraph is the text people copy into a paper, and it
    // used to say the profiles "were tested with DESeq2 … with Benjamini–
    // Hochberg adjustment", which nothing in this app does.
    <>Pseudobulk profiles were prepared for {condLabel(cs)} against {condLabel(ctrl)} within{' '}
    {ct}{cite('practices')}: raw counts were summed across all cells of a given sample, samples
    contributing fewer than {MIN_CELLS} cells of that type were excluded, and the summed counts of
    the resulting {design.n0} {condLabel(ctrl)} and {design.n1} {condLabel(cs)} profiles were saved for DESeq2{cite('deseq2')}. No test was run here, so no gene is reported as
    differentially expressed; the model, its reference level and its multiple-testing adjustment
    are chosen where the counts are tested.</>
  )

  const closing = wil || !d.multi ? (
    <>{' '}Exploration, figures and statistics were produced in scRNA-seq
    Studio{cite('studio')}, which runs these tests in the browser.</>
  ) : (
    <>{' '}Exploration and figures were produced, and the counts summed, in scRNA-seq
    Studio{cite('studio')}, in the browser.</>
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
              <b>padj</b> print as <Mono>&lt; 10⁻³⁰⁸</Mono> once they underflow: a bound,
              not a reading. −log₁₀ padj is formed in log space, does not underflow, and still
              separates rows that share that bound. The volcano&rsquo;s y axis is this column.
              <b> Combined</b> is −log₁₀(padj) × log₂FC, a signed ranking metric.
            </p>
            <p className="mb-0 mt-3">
              <b>Markers rank; they do not test.</b> Each cell type is compared against
              every other cell with the same Wilcoxon that Seurat&rsquo;s{' '}
              <Mono>FindAllMarkers</Mono> runs. But cell types that began as clusters were defined
              using the expression these p-values then score, so the p-values are not evidence
              the clusters exist.
              The effect size and the detection rates are the honest columns.
            </p>
            <p className="mb-0 mt-3">
              <b>Composition is never pooled across samples.</b> Cells from one sample are not
              independent observations, so a bar merging several samples is refused rather than
              drawn. Each cell type gets its own y axis; a shared one flattens every cell type except the largest.
            </p>
            <p className="mb-0 mt-3">
              <b>Scaling a dot plot changes its claim.</b> Seurat&rsquo;s{' '}
              <Mono>scale = TRUE</Mono> z-scores each gene down its own column, so colour shows
              <em> where</em> a gene is highest, not how abundant it is: a gene expressed evenly
              everywhere comes out uniformly pale. Turn scaling off to compare absolute levels.
            </p>
            <p className="mb-0 mt-3">
              <b>Enrichment tests against the genes this object measured</b>, never the whole
              genome: testing against genes the assay could not detect inflates every result.
              The background is narrowed once more, to the measured genes that are in at least
              one set (the annotated background), because a gene no set contains could never
              have been drawn into one. A module score subtracts a control set matched on
              expression level, which is what makes zero meaningful.
            </p>
            <p className="mb-0 mt-3">
              <b>The gene sets are MSigDB{lib ? ` ${lib.release}` : ''}</b>
              {lib && <>, the collections native to {lib.taxon}</>}. Native, not projected:
              MSigDB curates a separate mouse database, and mapping the human sets across
              orthologs instead would give different membership for every set: over the fifty
              hallmark sets the two agree on a mean Jaccard of 0.57 and not one is identical.
              Only the collections switched on are tested, and the correction is applied across
              those.
            </p>
            <p className="mb-0 mt-3">
              <b>Co-expression r is Pearson by default, and carries no p-value on purpose.</b>{' '}
              Pearson is what WGCNA and hdWGCNA use. Spearman is the same correlation over the ranks, so
              one extreme metacell cannot carry an r; it is offered only where observations are
              pooled, because per cell most values are zero and the ranks are one tie block. Which
              of the two produced a table is named above it and in its CSV heading. With tens of
              thousands of cells almost any r clears any threshold, and cells from one sample are
              not independent draws, so the table ranks by r and shows the detection rate beside
              it. A gene detected in under 10% of the cells in scope is not ranked, because two
              rarely detected genes agree wherever both are absent. Cells are pooled into
              near-equal metacells before correlating, following hdWGCNA: no metacell spans two
              cell types or two samples, and none is built from fewer than ten cells. Pooling is
              on the embedding, a 2-D projection, where hdWGCNA uses a reduced space with many
              more components.
            </p>
            <p className="mb-0 mt-3">
              <b>A gene set is signed before it is combined.</b> Seeding a correlation with
              the mean of a set&rsquo;s members cancels: a pathway holds members that move in
              opposite directions, and the mean is dominated by whichever are most abundant.
              So the set is first correlated with itself, each member is standardised and
              given the sign of the leading eigenvector of that matrix (WGCNA&rsquo;s module eigengene), and the members are combined only then. Because each member is
              standardised, the correlation against that composite <em>is</em> the weighted
              mean of the members&rsquo; own independent correlations, so one pass reports what
              testing every member separately would have said. How much of the set runs one
              way is reported with the result, since a combined score over a set that is
              really two programmes is a number to read with care.
            </p>
            <p className="mb-0 mt-3">
              <b>What this text will not say.</b> It names no normalization, variable-gene count,
              component count or clustering resolution, because {carried.length
                ? 'it reads none of them out of the run’s records'
                : 'a bundle carries none of them'}; it
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
