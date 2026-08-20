// Reading gene sets in whatever they were written in.
//
// The point of this file is that the input is not a format, it is whatever was
// on the user's clipboard. Every block below is a shape somebody actually
// pastes: a Python dict out of a notebook, an R list, a JSON export, a GMT, a
// spreadsheet, a bare column of symbols. None of them may throw, and none of
// them may quietly lose a set or a gene.

import { collectionToText, parseSets } from '../src/lib/msigdb.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

/** A collection as {setName: [genes]}, for comparing against what was meant. */
const shape = (c) => Object.fromEntries(
  c.sets.map(s => [s.name, Array.from(s.genes, i => c.symbols[i])]))

console.log('\nTHE PYTHON DICT SOMEBODY PASTES OUT OF A NOTEBOOK')
{
  // The reported case, verbatim: a variable name, newlines inside the lists,
  // ragged indentation, a trailing comma on the last member of a list.
  const text = `pathway_genes = {

    "BCAA catabolism": [
        "Bcat2", "Bckdha", "Bckdhb", "Dbt",
        "Dld", "Ppm1k", "Bckdk",
        "Ivd", "Mccc1", "Mccc2",
        "Acadm", "Hibadh"
    ],

    "Propanoate metabolism": [
        "Pcca", "Pccb", "Mmut",
        "Acat1", "Aldh6a1",
        "Mcee", "Mlycd"
    ],

    "TCA cycle": [
        "Cs", "Aco2",
        "Idh2", "Idh3a",
        "Ogdh", "Dlst",
        "Suclg1", "Sucla2",
        "Sdha", "Sdhb",
        "Fh1", "Mdh2"
    ],

    "Glycolysis": [
        "Hk1", "Hk2",
        "Gpi1", "Pfkm",
        "Aldoa", "Gapdh",
        "Pgk1", "Pgam1",
        "Eno1", "Pkm",
        "Ldha"
    ]
}`
  const c = parseSets(text, 'My metabolism')
  check('every set is found', c.sets.map(s => s.name),
    ['BCAA catabolism', 'Propanoate metabolism', 'TCA cycle', 'Glycolysis'])
  check('the variable name is not a set', c.sets.some(s => /pathway_genes/.test(s.name)), false)
  check('members survive the newlines inside the list',
    shape(c)['BCAA catabolism'],
    ['Bcat2', 'Bckdha', 'Bckdhb', 'Dbt', 'Dld', 'Ppm1k', 'Bckdk',
      'Ivd', 'Mccc1', 'Mccc2', 'Acadm', 'Hibadh'])
  check('a name with a space is kept whole', shape(c)['TCA cycle'].length, 12)
  check('the collection is named as asked', c.source, 'My metabolism')
  check('symbols are pooled across sets, so Sdha is stored once',
    c.symbols.filter(g => g === 'Sdha').length, 1)
}

console.log('\nTHE SAME THING IN EVERY OTHER DIALECT')
{
  const want = { A: ['Cs', 'Aco2'], B: ['Hk1', 'Pkm'] }
  const same = (label, text) => check(label, shape(parseSets(text)), want)

  same('single quotes', `{'A': ['Cs', 'Aco2'], 'B': ['Hk1', 'Pkm']}`)
  same('trailing commas', `{\n "A": ["Cs", "Aco2",],\n "B": ["Hk1", "Pkm",],\n}`)
  same('a python comment in the middle',
    `d = {\n # carbon\n "A": ["Cs", "Aco2"],\n "B": ["Hk1", "Pkm"]  # glycolysis\n}`)
  same('strict json', JSON.stringify(want))
  same('json with the genes under a key',
    JSON.stringify({ A: { genes: ['Cs', 'Aco2'] }, B: { genes: ['Hk1', 'Pkm'] } }))
  same('json as a list of records',
    JSON.stringify([{ name: 'A', genes: ['Cs', 'Aco2'] }, { name: 'B', genes: ['Hk1', 'Pkm'] }]))
  same('json records under other key names',
    JSON.stringify([{ pathway: 'A', members: ['Cs', 'Aco2'] },
      { pathway: 'B', members: ['Hk1', 'Pkm'] }]))
  same('an r named list', `list("A" = c("Cs", "Aco2"), "B" = c("Hk1", "Pkm"))`)
  same('an r list with bare names', `list(A = c("Cs","Aco2"), B = c("Hk1","Pkm"))`)
  same('an r list with bare genes too', `list(A = c(Cs, Aco2), B = c(Hk1, Pkm))`)
  same('a gmt, description column and all', `A\tsome description\tCs\tAco2\nB\t\tHk1\tPkm`)
  same('a gmt whose description is a url', `A\thttp://x.org/A\tCs\tAco2\nB\thttp://x.org/B\tHk1\tPkm`)
  same('a spreadsheet with no description column', `A\tCs\tAco2\nB\tHk1\tPkm`)
  same('name: gene, gene lines', `A: Cs, Aco2\nB: Hk1, Pkm`)
  same('the same with quotes and semicolons', `A: "Cs"; "Aco2"\nB: 'Hk1'; 'Pkm'`)
  same('windows line endings', `{\r\n "A": ["Cs", "Aco2"],\r\n "B": ["Hk1", "Pkm"]\r\n}`)
}

console.log('\nONE SET, WITH NO NAMES ANYWHERE')
{
  const c = parseSets('Cs Aco2 Mdh2', 'Bare list')
  check('a bare list becomes one set under the collection name',
    shape(c), { 'Bare list': ['Cs', 'Aco2', 'Mdh2'] })
  check('one gene per line is the same thing',
    shape(parseSets('Cs\nAco2\nMdh2', 'Column')), { Column: ['Cs', 'Aco2', 'Mdh2'] })
  check('commas, spaces and blank lines all separate',
    shape(parseSets('Cs, Aco2\n\n  Mdh2 ,\n', 'Mixed')), { Mixed: ['Cs', 'Aco2', 'Mdh2'] })
}

console.log('\nWHAT IT REFUSES TO GET WRONG')
{
  check('a duplicated gene inside a set is stored once',
    shape(parseSets('{"A": ["Cs", "Cs", "Aco2"]}')), { A: ['Cs', 'Aco2'] })
  // Last wins, because JSON.parse has already resolved a duplicated key that
  // way before the parser sees it — so first-wins on the text paths would give
  // the same input two answers depending on whether it was strict JSON.
  check('a repeated set name is resolved the way the language would',
    shape(parseSets('{"A": ["Cs"], "A": ["Zzz"]}')), { A: ['Zzz'] })
  check('and the text paths agree with it',
    shape(parseSets('A: Cs\nA: Zzz')), { A: ['Zzz'] })
  check('without leaving a hole where the first one was',
    parseSets('A: Cs\nB: Aco2\nA: Zzz').sets.map(s => s.name), ['A', 'B'])
  check('an empty set is dropped rather than carried',
    shape(parseSets('{"A": ["Cs"], "Empty": []}')), { A: ['Cs'] })
  check('a name that is only punctuation is not a set',
    shape(parseSets('{"--": ["Cs"], "A": ["Aco2"]}')), { A: ['Aco2'] })
  check('gene order is the order given',
    shape(parseSets('{"A": ["Zzz", "Aaa", "Mmm"]}')), { A: ['Zzz', 'Aaa', 'Mmm'] })
  check('set order is the order given',
    parseSets('{"Z": ["Cs"], "A": ["Aco2"]}').sets.map(s => s.name), ['Z', 'A'])

  // A JSON array of records must not turn its own field names into sets.
  const rec = parseSets(JSON.stringify([{ name: 'A', genes: ['Cs'] }]))
  check('a record\'s "genes" key is not mistaken for a set name',
    rec.sets.map(s => s.name), ['A'])

  // Nothing may throw except genuinely empty input.
  let threw = null
  try { parseSets('') } catch (e) { threw = e.message }
  check('empty input says so', /nothing to read/.test(threw ?? ''), true)
  threw = null
  try { parseSets('{}') } catch (e) { threw = e.message }
  check('an empty dict says what shapes are accepted',
    /no gene sets found/.test(threw ?? ''), true)
  for (const junk of ['{{{', '<<<>>>', ',,,,', '][', '   \n\n   \t']) {
    let ok = true
    try { parseSets(junk) } catch { ok = 'threw a normal error' }
    check(`junk input ${JSON.stringify(junk)} is handled`, ok !== false, true)
  }
}

console.log('\nSIZE AND SHAPE OF WHAT COMES BACK')
{
  const c = parseSets('{"A": ["Cs", "Aco2"], "B": ["Aco2", "Mdh2"]}', 'X')
  check('symbols are the union, in first-seen order', c.symbols, ['Cs', 'Aco2', 'Mdh2'])
  check('members are indices into that table', Array.from(c.sets[1].genes), [1, 2])
  check('it declares itself species-agnostic', c.species, 'any')
  check('and says where it came from', c.release, 'pasted')
}


console.log('\nA COLLECTION READS ITS OWN OUTPUT BACK')
{
  // What makes a pasted collection EDITABLE rather than delete-and-retype: the
  // editor reopens it as text, and the parser has to give back what it was
  // handed. Without this property, fixing one typed symbol in a set of ninety
  // meant retyping ninety.
  const shapes = {
    'a python dict': `pathway_genes = {
  "TCA cycle": ["Cs", "Aco2", "Idh3a", "Ogdh", "Sdha", "Fh1", "Mdh2"],
  "Glycolysis": ["Hk1", "Gpi1", "Pfkl", "Aldoa", "Gapdh", "Pkm"],
  "BCAA catabolism": ["Bckdha", "Bckdhb", "Dbt", "Dld", "Ivd"],
}`,
    'a GMT': [
      'HALLMARK_ONE\thttp://x\tGfap\tAqp4\tS100b',
      'HALLMARK_TWO\thttp://y\tAscl1\tEgfr\tMki67\tTop2a',
    ].join('\n'),
    'one name per line': 'Quiescence: Gfap, Aqp4, Id3\nActivation: Ascl1, Egfr',
    'a single unnamed set': 'Gfap\nAqp4\nS100b\nId3',
  }

  const same = (a, b) =>
    a.sets.length === b.sets.length
    && a.sets.every((s, i) =>
      s.name === b.sets[i].name
      && s.genes.length === b.sets[i].genes.length
      && Array.from(s.genes, g => a.symbols[g])
        .every((sym, k) => sym === b.symbols[b.sets[i].genes[k]]))

  for (const [what, text] of Object.entries(shapes)) {
    const once = parseSets(text, 'Mine')
    const twice = parseSets(collectionToText(once), 'Mine')
    check(`${what} survives the round trip`, same(once, twice), true)
    check('  and keeps every gene',
      twice.sets.reduce((n, s) => n + s.genes.length, 0),
      once.sets.reduce((n, s) => n + s.genes.length, 0))
  }

  // The awkward ones: a set name containing the separator. Written as
  // `Name: a, b, c`, a colon in the name is the case that splits in the wrong
  // place if anything does.
  const odd = parseSets('Glycolysis: step 1: Hk1, Gpi1\nTCA, aerobic: Cs, Fh1', 'Mine')
  const back = parseSets(collectionToText(odd), 'Mine')
  check('a set name holding a colon or a comma still round-trips', same(odd, back), true)
  check('and it did not silently become one set', [odd.sets.length, back.sets.length], [2, 2])
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll gene-set parsing tests passed')
process.exit(failed ? 1 : 0)
