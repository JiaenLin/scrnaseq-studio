// A gene that was not tested carries no p, and a cutoff is the number written.
//
// Three defects a reviewer found in the deployed app (W053), each pinned here:
//   1. a gene the effect-size gate keeps but does not test (`carry`, lib/stats.ts)
//      has NaN for p, padj, FDR and −log₁₀ padj, and `pCsv` wrote NaN as the
//      underflow's bound: with Seurat's defaults the demo's DE CSV listed 58 of
//      70 genes as `<1e-308`, the most significant genes in the file;
//   2. cut on FDR, the volcano drew the Bonferroni padj on its y and its dashed
//      line, and drew larger the genes past the FDR: on screen "Dashed lines are
//      the cutoffs" and "larger = past both cutoffs" were false;
//   3. the slider sets 10^-v, and the cutoff was written raw: "FDR <
//      0.31622776601683794".
//
// Where a commit has no lib/de-rows.ts (192057b), the expressions the app used
// there stand in for it, quoted from that commit: the CSV wrote pCsv and nlpCsv
// of each number (DEGTable.tsx:172-175), the volcano's y was `nlp` under either
// correction (Stats.tsx:712) with the line at −log₁₀ of the cutoff (Stats.tsx:908),
// and the head, Methods and the legend wrote the cutoff as `${padjMax}`. So on
// that commit each check below fails for the reason it states.
import { demoSource } from '../src/lib/source.ts'
import { deWilcox, isSig, named, sigCount, SEURAT_GATES, DE_GATES, wilcoxPlan, wilcoxSpec } from '../src/lib/stats.ts'
import * as sig from '../src/lib/significance.ts'
import { readFileSync } from 'node:fs'
import { readCollectionIndex } from '../src/lib/collection.ts'
import { openCollection } from '../src/lib/collection-source.ts'

let failed = 0, passed = 0
const ok = (cond, name, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`) }
}
const de = await import('../src/lib/de-rows.ts').catch(() => null)
const HEADER = de ? de.deCsvHeader(true)
  : ['gene', 'pct.1', 'pct.2', 'log2FC', 'combined', 'p', 'padj', 'fdr_BH', 'neg_log10_padj', 'direction']
const csvRows = de ? rows => de.deCsvRows(rows, { wilcox: true, cs: 'b', ctrl: 'a' })
  : rows => rows.map(r => [r.gene, '', '', r.lfc.toFixed(4), '', sig.pCsv(r.p), sig.pCsv(r.padj),
    r.fdr === undefined ? '' : sig.pCsv(r.fdr), sig.nlpCsv(r.nlp), ''])
const volcanoRows = de ? de.volcanoRows : rows => rows.filter(r => Number.isFinite(r.nlp))
const volcanoY = de ? de.volcanoY : r => r.nlp
const cutOf = sig.cutOf ?? (v => v)
const cutTxt = sig.cutTxt ?? (v => `${v}`)
const col = k => HEADER.indexOf(k)

const src = demoSource('cohort')
const ti = src.clusters.indexOf('qNSC')
const conds = src.d.conds

console.log('An untested gene carries no p')
{
  ok(sig.pCsv(NaN) === '' && sig.nlpCsv(NaN) === '', 'a missing p is an empty cell in a CSV, never the bound',
    `pCsv(NaN) = "${sig.pCsv(NaN)}", nlpCsv(NaN) = "${sig.nlpCsv(NaN)}"`)
  ok(sig.pTxt(NaN) === '—' && sig.nlpTxt(NaN) === '—', 'and the em dash on screen (no value in a cell)',
    `pTxt(NaN) = "${sig.pTxt(NaN)}", nlpTxt(NaN) = "${sig.nlpTxt(NaN)}"`)
  // A correct case the fix must not hide: a real test whose p underflowed.
  ok(sig.pCsv(0) === '<1e-308' && sig.pCsv(1e-320) === '<1e-308' && sig.pTxt(0) === '< 10⁻³⁰⁸',
    'a real p that underflowed (0, 1e-320) still writes its bound', `${sig.pCsv(0)} ${sig.pCsv(1e-320)} ${sig.pTxt(0)}`)
  ok(sig.pCsv(1) === '1.0000e+0' && sig.pCsv(1e-308) === '1.0000e-308' && sig.pCsv(0.0123456) === '1.2346e-2',
    'and a p of 1, of 1e-308 or of 0.0123 is written as it was', `${sig.pCsv(1)} ${sig.pCsv(1e-308)} ${sig.pCsv(0.0123456)}`)

  // The demo contrast with Seurat's defaults, through the engine and the CSV writer.
  const res = deWilcox(src, [ti], conds[0], conds[conds.length - 1], { ...SEURAT_GATES, carry: true })
  const un = res.rows.filter(r => !Number.isFinite(r.p)), tested = res.rows.filter(r => Number.isFinite(r.p))
  ok(un.length > 0 && tested.length > 0, `the contrast has untested genes (${un.length}) and tested ones (${tested.length})`)
  const out = csvRows(res.rows)
  const carrying = out.filter((c, i) => !Number.isFinite(res.rows[i].p)
    && ['p', 'padj', 'fdr_BH', 'neg_log10_padj', 'combined'].some(k => c[col(k)] !== '' && c[col(k)] !== undefined))
  ok(carrying.length === 0, 'no untested gene carries a p, padj, FDR, −log₁₀ padj or Combined in the CSV',
    `${carrying.length} of ${un.length} do, e.g. ${carrying[0]?.join(',')}`)
  const said = out.filter((c, i) => !Number.isFinite(res.rows[i].p) && c[col('not_tested')] === de?.UNTESTED_WHY)
  ok(col('not_tested') > 0 && said.length === un.length, 'and each says why, in the table\'s words',
    `column ${col('not_tested')}, ${said.length} of ${un.length}`)
  const blankTested = out.filter((c, i) => Number.isFinite(res.rows[i].p) && (c[col('p')] === '' || c[col('not_tested')]))
  ok(blankTested.length === 0, 'and every tested gene keeps its numbers, with nothing in that column')
  // The table model: an untested gene never ranks among the significant.
  const order = res.rows.map(r => Number.isFinite(r.p))
  ok(order.indexOf(false) === -1 || !order.slice(order.indexOf(false)).includes(true),
    'the ranked rows hold every untested gene after every tested one')
  const loosest = [{ padj: 1, lfc: 0 }, { padj: 1, lfc: 0, basis: 'fdr' }]
  ok(loosest.every(th => un.every(r => !isSig(r, th)) && sigCount(res.rows, th) === sigCount(tested, th)),
    'and none passes any cutoff, the loosest included, on either correction')
  const vol = volcanoRows(res.rows)
  ok(vol.length === tested.length && vol.every(r => Number.isFinite(r.p)), 'the volcano places the tested genes and no other',
    `${vol.length} placed of ${tested.length} tested`)
  // Through the default gates too (no logfc.threshold): nothing untested, and the same numbers.
  const all = deWilcox(src, [ti], conds[0], conds[conds.length - 1], DE_GATES)
  ok(all.rows.every(r => Number.isFinite(r.p)) && csvRows(all.rows).every(c => c[col('p')] !== ''),
    'with no logfc.threshold every gene is tested and every row has a p')
}

console.log('Cut on FDR, the volcano draws the FDR')
{
  // The lab-like case: a small object where genes pass FDR while their padj is capped.
  for (const [key, cuts] of [['cohort', [0.05, 0.32, 1]], ['course', [0.05, 0.32]], ['wt', [0.05, 0.32]]]) {
    const s = demoSource(key)
    const r = deWilcox(s, [0], s.d.conds[0], s.d.conds[s.d.conds.length - 1], DE_GATES).rows
    const pts = volcanoRows(r)
    for (const cut of cuts) for (const basis of ['padj', 'fdr']) {
      const th = { padj: cut, lfc: 0.25, basis }, line = -Math.log10(cut)
      const wrong = pts.filter(q => (volcanoY(q, basis) > line && Math.abs(q.lfc) >= 0.25) !== isSig(q, th))
      ok(wrong.length === 0, `${key}, ${basis} < ${cut}: a point is larger exactly when it is past the dashed lines (${sigCount(pts, th)} are)`,
        `${wrong.length} are not, e.g. ${wrong.slice(0, 2).map(q => `${q.gene} y ${volcanoY(q, basis).toFixed(3)} vs ${line.toFixed(3)}, fdr ${q.fdr}`).join('; ')}`)
    }
    const off = pts.filter(q => Number.isFinite(q.fdr) && q.fdr > 1e-300
      && Math.abs(volcanoY(q, 'fdr') + Math.log10(q.fdr)) > 1e-9 * Math.max(1, -Math.log10(q.fdr)))
    ok(off.length === 0, `${key}: under FDR each point's y is −log₁₀ of its FDR`, `${off.length} differ, e.g. ${off[0]?.gene}`)
  }
  // Where the FDR underflows the y keeps its resolution and its order.
  const res = deWilcox(src, [ti], conds[0], conds[conds.length - 1], DE_GATES)
  const deep = volcanoRows(res.rows).filter(q => q.fdr < 1e-300)
  ok(deep.length > 0 && deep.every(q => Number.isFinite(volcanoY(q, 'fdr')) && volcanoY(q, 'fdr') > 300),
    `an FDR past the double (${deep.length} genes) still has a finite y above 300`)
}

console.log('The lab collection (testdata/lab/family-2x2.zip): small, so FDR passes where padj is capped')
{
  const blob = new Blob([readFileSync(new URL('../testdata/lab/family-2x2.zip', import.meta.url))])
  const lab = await openCollection(blob, await readCollectionIndex(blob))
  const t = lab.clusters.indexOf('TypeA')
  // A collection is lazy: it scans asynchronously, as the app's worker does.
  const deOn = async gates => {
    const plan = wilcoxPlan(wilcoxSpec(lab, [t], 'a1', 'a2', gates))
    await lab.scan(plan.visit)
    return named(lab.genes, plan.done()).rows
  }
  const r = await deOn(DE_GATES)
  const pts = volcanoRows(r)
  // The review's state: cut on FDR, the slider five steps from the top (10^-0.5).
  const cut = cutOf(10 ** -0.5), th = { padj: cut, lfc: 0.25, basis: 'fdr' }, line = -Math.log10(cut)
  const passing = pts.filter(q => isSig(q, th))
  const under = passing.filter(q => !(volcanoY(q, 'fdr') > line))
  ok(passing.length > 0 && under.length === 0,
    `FDR < ${cutTxt(cut)}: each of the ${passing.length} genes drawn larger sits above the dashed line`,
    `${under.length} sit on or under it: ${under.map(q => `${q.gene} y ${volcanoY(q, 'fdr').toFixed(3)}, line ${line.toFixed(3)}, padj ${q.padj.toPrecision(3)}, fdr ${q.fdr.toPrecision(3)}`).join('; ')}`)
  const above = pts.filter(q => !isSig(q, th) && volcanoY(q, 'fdr') > line && Math.abs(q.lfc) >= 0.25)
  ok(above.length === 0, 'and no gene drawn smaller is past both lines', above.map(q => q.gene).join(', '))
  // The same NaN through a collection: Seurat's defaults, then the CSV writer.
  const sr = await deOn({ ...SEURAT_GATES, carry: true })
  const out = csvRows(sr), un = sr.filter(q => !Number.isFinite(q.p))
  const carrying = out.filter((c, i) => !Number.isFinite(sr[i].p) && ['p', 'padj', 'fdr_BH', 'neg_log10_padj'].some(k => c[col(k)] !== ''))
  ok(un.length > 0 && carrying.length === 0, `through a collection, none of its ${un.length} untested genes carries a p in the CSV`,
    `${carrying.length} do, e.g. ${carrying[0]?.join(',')}`)
}

console.log('A cutoff is the number written')
{
  // Every value the slider sets: 10^-v, v = 0 to 10 in steps of 0.1.
  const bad = [], off = []
  for (let k = 0; k <= 100; k++) {
    const v = cutOf(10 ** -(k / 10)), t = cutTxt(v)
    const digits = t.replace(/e-?\d+$/, '').replace(/^0\.0*/, '').replace('.', '')
    if (digits.length > 2) bad.push(t)
    if (Number(t) !== v) off.push(`${t} written, ${v} in force`)
  }
  ok(bad.length === 0, 'written in two significant digits, under 0.001 as 1.4e-5', `${bad.length} are not, e.g. ${bad.slice(0, 3).join(', ')}`)
  ok(off.length === 0, 'and the cutoff in force is the number written', off.slice(0, 2).join('; '))
  ok(['0.05', '0.32', '0.001', '5e-4', '1'].join() === [0.05, 10 ** -0.5, 0.001, 10 ** -3.3, 1].map(v => cutTxt(cutOf(v))).join(),
    'the default and the review\'s value: 0.05, 0.32, 0.001, 5e-4, 1', [0.05, 10 ** -0.5, 0.001, 10 ** -3.3, 1].map(v => cutTxt(cutOf(v))).join())
}

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll untested-gene tests passed (${passed})`)
if (failed) process.exit(1)
