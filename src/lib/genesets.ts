// The built-in gene set collection.
//
// An .h5ad does not carry gene sets, so unlike the bulk studio — which reads
// them from the result bundle — this app has to bring its own. What ships here
// is a small collection relevant to neural stem cell work, with real GO, KEGG
// and Hallmark identifiers where they exist and an explicit "Curated" source
// where the set is a signature from a specific paper.
//
// Sets deliberately contain genes the demo object does not measure. That is the
// normal case with any real collection, and it is why the background is always
// the intersection of the collection with the genes the object actually
// measured — scoring against genes the assay could not detect inflates every
// enrichment it produces.

import type { GeneSetDef } from './ora.ts'

export const GENE_SETS: GeneSetDef[] = [
  {
    source: 'GO:BP', id: 'GO:0000086', name: 'G2/M transition of mitotic cell cycle',
    genes: ['Mki67', 'Top2a', 'Cenpf', 'Ube2c', 'Ccnb1', 'Cdk1', 'Plk1', 'Aurka', 'Bub1', 'Cdc20'],
  },
  {
    source: 'GO:BP', id: 'GO:0006260', name: 'DNA replication',
    genes: ['Mcm2', 'Mcm5', 'Pcna', 'Ccnd2', 'Rrm2', 'Mcm3', 'Mcm7', 'Gins2', 'Fen1', 'Rfc4'],
  },
  {
    source: 'GO:BP', id: 'GO:0045786', name: 'Negative regulation of cell cycle',
    genes: ['Cdkn1a', 'Cdkn1b', 'Id3', 'Hes1', 'Notch1', 'Rb1', 'Cdkn2a', 'Gas1'],
  },
  {
    source: 'GO:BP', id: 'GO:0097150', name: 'Neural stem cell population maintenance',
    genes: ['Gfap', 'Hopx', 'Id3', 'Notch1', 'Hes1', 'Hes5', 'Sox9', 'Thbs4', 'Aqp4', 'Slc1a3', 'Sox2'],
  },
  {
    source: 'GO:BP', id: 'GO:0007405', name: 'Neuroblast proliferation',
    genes: ['Ascl1', 'Dlx2', 'Egfr', 'Sox11', 'Sp8', 'Dcx', 'Mash1'],
  },
  {
    source: 'GO:BP', id: 'GO:0030182', name: 'Neuron differentiation',
    genes: ['Dcx', 'Tubb3', 'Nrxn3', 'Sox11', 'Dlx2', 'Sp8', 'Map2', 'Neurod1', 'Stmn1'],
  },
  {
    source: 'GO:BP', id: 'GO:0010001', name: 'Glial cell differentiation',
    genes: ['Plp1', 'Mbp', 'Mog', 'Sox10', 'Cnp', 'Olig2', 'Gfap', 'Cldn11'],
  },
  {
    source: 'GO:BP', id: 'GO:0042063', name: 'Gliogenesis and astrocyte identity',
    genes: ['Slc1a3', 'Agt', 'Ntsr2', 'Clu', 'Aqp4', 'Gfap', 'S100b', 'Sparcl1', 'Mt1', 'Aldh1l1'],
  },
  {
    source: 'GO:BP', id: 'GO:0001774', name: 'Microglial cell activation',
    genes: ['Cx3cr1', 'C1qa', 'Ctss', 'P2ry12', 'Hexb', 'Trem2', 'Tyrobp', 'C1qb'],
  },
  {
    source: 'GO:BP', id: 'GO:0043534', name: 'Blood vessel endothelial cell migration',
    genes: ['Cldn5', 'Pecam1', 'Flt1', 'Ly6c1', 'Kdr', 'Tek', 'Cdh5', 'Esam'],
  },
  {
    source: 'GO:BP', id: 'GO:0048514', name: 'Mural cell and pericyte development',
    genes: ['Pdgfrb', 'Kcnj8', 'Anpep', 'Vtn', 'Higd1b', 'Des', 'Rgs5', 'Notch3'],
  },
  {
    source: 'KEGG', id: 'mmu04330', name: 'Notch signaling pathway',
    genes: ['Notch1', 'Hes1', 'Hes5', 'Dll1', 'Jag1', 'Rbpj', 'Dtx1', 'Notch2'],
  },
  {
    source: 'Hallmark', id: 'HALLMARK_E2F_TARGETS', name: 'E2F targets',
    genes: ['Mcm2', 'Mcm5', 'Pcna', 'Top2a', 'Cdk1', 'Ccnb1', 'Ube2c', 'Rrm2', 'Cenpf', 'Mki67'],
  },
  {
    source: 'Hallmark', id: 'HALLMARK_TNFA_SIGNALING_VIA_NFKB', name: 'Immediate early response',
    genes: ['Fos', 'Jun', 'Egr1', 'Junb', 'Fosb', 'Arc', 'Npas4', 'Ier2', 'Nr4a1'],
  },
  {
    source: 'Curated', id: 'QUIESCENT_NSC', name: 'Quiescent NSC signature (Llorens-Bobadilla 2015)',
    genes: ['Gfap', 'Aqp4', 'Id3', 'Hopx', 'Thbs4', 'S100b', 'Clu', 'Sparcl1', 'Cdkn1a', 'Slc1a3'],
  },
  {
    source: 'Curated', id: 'ACTIVE_NSC', name: 'Activated NSC signature (Codega 2014)',
    genes: ['Ascl1', 'Egfr', 'Ccnd2', 'Mcm2', 'Sox2', 'Nes', 'Vim', 'Mki67', 'Dlx2'],
  },
  {
    source: 'Curated', id: 'DOPAMINERGIC', name: 'Dopaminergic specification',
    genes: ['Nr4a2', 'Th', 'Pitx3', 'Slc6a3', 'Ddc', 'Lmx1b'],
  },
  {
    source: 'GO:BP', id: 'GO:0006412', name: 'Translation and ribosome',
    genes: ['Rpl13a', 'Actb', 'Gapdh', 'Eef1a1', 'Rpl7', 'Rps6', 'Rplp0', 'Eif4a1'],
  },
]

export const SET_SOURCES = [...new Set(GENE_SETS.map(s => s.source))]

export const setById = (id: string) => GENE_SETS.find(s => s.id === id)
