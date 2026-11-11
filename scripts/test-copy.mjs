// The copy standard, held: no string over its kind's word budget, no retired
// term (docs/DESIGN.md, "Words"; the numbers are scripts/copy-standard.mjs).
//
//   node scripts/test-copy.mjs            (in `npm test`)
//   node scripts/test-copy.mjs --list     (every string, longest first: the worklist)
//   node scripts/test-copy.mjs --json     (the same, for scripts/copy-changes.mjs)
//
// Two readings, because neither is enough alone:
//
// 1. THE SOURCE, through the TypeScript parser: every piece of JSX text, every
//    string a reader can be shown through an attribute (title, placeholder,
//    aria-label, a component's label / title / hint / note) and every other
//    sentence-like string literal under src/. A string is put together the way
//    the reader gets it (the text of one element with its inline children; a
//    template with its slots), a slot counts as no word, and its kind comes
//    from the element that holds it. This reaches strings no demo shows (an
//    error for a malformed bundle, a state of a large object).
// 2. THE MEASURED INVENTORY, docs/design/inventory/after.json, written by
//    scripts/inventory-design.mjs from the built app in a browser: each string
//    as it was drawn, with the kind of element that drew it, the words on one
//    screen at rest, and the legend each saved figure carries.
//
// It needs no browser. The inventory is re-measured when copy changes
// (docs/DESIGN.md, "Checking a change").

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { BUDGET, SCREEN_BUDGET, SCREEN_KIND, excepted, refine, retiredIn, words } from './copy-standard.mjs'
import { properName } from '../src/lib/msigdb.ts'
import { nNote, wrapSpaces } from '../src/lib/figure-foot.ts'
import { NOT_CALLED, notCalledNote } from '../src/lib/sentinels.ts'

const LIST = process.argv.includes('--list')
const SRC = process.env.COPY_SRC ?? 'src'   // another tree, to list what a change did (scripts/copy-changes.mjs)
const files = []
const walkDir = d => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) walkDir(p)
    else if (/\.tsx?$/.test(f.name) && !/^bench/.test(f.name) && !/\.d\.ts$/.test(f.name)) files.push(p)
  }
}
walkDir(SRC)

const norm = s => s.replace(/\s+/g, ' ').trim()
const ENT = { rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', nbsp: ' ', amp: '&', lt: '<', gt: '>', times: '×', middot: '·', mdash: '—', ndash: '–', minus: '−', ge: '≥', le: '≤', hellip: '…', rarr: '→', larr: '←', sub2: '₂' }
const unent = s => s.replace(/&(\w+);/g, (m, n) => ENT[n] ?? m)

/** A string expression as the reader gets it; a slot the code fills is `#`. null when it holds no literal text. */
function flat(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => '#' + s.literal.text).join('')
  if (ts.isParenthesizedExpression(node)) return flat(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = flat(node.left), b = flat(node.right)
    return a === null && b === null ? null : (a ?? '#') + (b ?? '#')
  }
  return null
}

const tagOf = el => (ts.isJsxElement(el) ? el.openingElement : el).tagName.getText()
const attrsOf = el => (ts.isJsxElement(el) ? el.openingElement : el).attributes.properties
const attr = (el, name) => {
  for (const a of attrsOf(el)) {
    if (ts.isJsxAttribute(a) && a.name.getText() === name) {
      if (!a.initializer) return ''
      if (ts.isStringLiteral(a.initializer)) return a.initializer.text
      if (ts.isJsxExpression(a.initializer)) return flat(a.initializer.expression) ?? a.initializer.expression?.getText() ?? ''
    }
  }
  return null
}

/** The kind of text an element holds, from itself and the elements around it. */
function kindOfElement(el, file) {
  for (let e = el, depth = 0; e; e = e.parent) {
    if (!ts.isJsxElement(e) && !ts.isJsxSelfClosingElement(e)) continue
    const tag = tagOf(e), cls = attr(e, 'className') ?? '', role = attr(e, 'role') ?? ''
    if (role === 'tab') return 'tab'
    if (/\bmenu-foot\b/.test(cls)) return 'menu note'
    if (role === 'menuitem' || role === 'option' || tag === 'MenuItem') return 'menu item'
    if (/\bchip\b/.test(cls)) return 'chip'
    if (/\bopt\b/.test(cls)) return 'option'
    if (/\bseg\b/.test(cls)) return 'segment'
    if (tag === 'button' || /\bbtn\b/.test(cls) || tag === 'CsvButton') return depth === 0 || !/[.!?]$/.test('') ? 'button' : 'button'
    if (tag === 'th') return 'table header'
    if (tag === 'td') return 'table cell'
    if (/\bbadge\b/.test(cls)) return 'badge'
    if (/\bempty\b/.test(cls) || tag === 'Empty') return 'empty state'
    if (/\bnote\b/.test(cls) || tag === 'Note') return 'note'
    if (/\bhint\b/.test(cls) || tag === 'Hint') return 'help'
    if (/\brail-status\b/.test(cls)) return 'status'
    if (/\btx-micro\b/.test(cls) && tag === 'span' && depth === 0) return 'help'
    if (/\beyebrow\b/.test(cls)) return 'title'
    if (/\brail-label\b|\btx-label\b/.test(cls) || tag === 'label' || tag === 'dt') return 'label'
    if (/^h[1-4]$/.test(tag) || /\b(stage-title|card-title|tpane-name|plot-name|tx-title)\b/.test(cls)) return 'title'
    if (/\b(stage-meta|stage-foot|figscroll-note)\b/.test(cls)) return 'status'
    if (/\btnote\b/.test(cls)) return 'note'
    if (/\b(legend|sub|lead)\b/.test(cls) || tag === 'figcaption') return 'legend'
    if (tag === 'text' || tag === 'tspan') return 'figure text'
    if (tag === 'title') return 'tooltip'
    if (tag === 'InRail' || tag === 'RailGroup' || /\brail\b/.test(cls)) return 'help'
    depth++
  }
  return /Methods\.tsx$/.test(file) ? 'methods' : 'text'
}

const ATTR_KIND = {
  title: e => (tagOf(e) === 'MenuItem' ? 'menu item' : tagOf(e) === 'Empty' ? 'empty state title'
    : /^(Card|Section|Stage|Side|RailGroup|Block)$/.test(tagOf(e)) ? 'title' : 'tooltip'),
  placeholder: () => 'placeholder',
  'aria-label': () => 'accessible name',
  label: e => (tagOf(e) === 'Popover' ? 'accessible name' : tagOf(e) === 'Figure' || tagOf(e) === 'CsvButton' ? 'button' : 'label'),
  note: e => (tagOf(e) === 'MenuItem' ? 'menu item note' : 'help'),
  hint: () => 'help', help: () => 'help', sub: () => 'help', meta: () => 'status', why: () => 'tooltip', reason: () => 'tooltip',
  alt: () => 'accessible name', name: () => null,
}

const strings = []   // { file, line, kind, text, words }
const add = (sf, node, kind, text) => {
  const t = norm(unent(text))
  if (!t || !/[A-Za-z]{2}/.test(t)) return
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  strings.push({ file: sf.fileName, line: line + 1, kind, text: t, words: words(t.replace(/#/g, ' ')) })
}

/** The text of one element as the reader gets it: its own text with its inline children's, slots as `#`. */
const andBranch = new Map()
function elementText(el, seen) {
  return elementOwn(el, seen) + (andBranch.get(el) ?? '')
}
function elementOwn(el, seen) {
  let out = ''
  for (const c of el.children) {
    seen.add(c)
    if (ts.isJsxText(c)) out += c.text
    else if (ts.isJsxExpression(c)) {
      const e = c.expression
      if (!e) continue
      const f = flat(e)
      if (f !== null) out += f
      else if (ts.isConditionalExpression(e)) {
        // The longer branch: the budget is for the most the reader can be shown.
        const a = branchText(e.whenTrue, seen), b = branchText(e.whenFalse, seen)
        out += words(a) >= words(b) ? a : b
      } else if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
        // Of several `cond && text` in one element the longest is counted: they are alternatives far more often than not.
        const t = branchText(e.right, seen)
        if (words(t) > words(andBranch.get(el) ?? '')) andBranch.set(el, t)
      }
      else out += '#'
    } else if (ts.isJsxElement(c)) {
      const tag = tagOf(c)
      // A control inside a sentence is its own string; inline marks are part of the sentence.
      if (/^(button|input|select|textarea|svg|table|ul|ol|div|p|Figure|Popover)$/.test(tag) || /\bbtn\b/.test(attr(c, 'className') ?? '')) { seen.delete(c); out += ' ' }
      else out += elementText(c, seen)
    } else if (ts.isJsxFragment(c)) out += elementText(c, seen)
    else if (ts.isJsxSelfClosingElement(c)) out += tagOf(c) === 'br' ? ' ' : '#'
  }
  return out
}
function branchText(n, seen) {
  if (!n) return ''
  const f = flat(n)
  if (f !== null) return f
  if (ts.isParenthesizedExpression(n)) return branchText(n.expression, seen)
  if (ts.isJsxElement(n) || ts.isJsxFragment(n)) { seen.add(n); return elementText(n, seen) }
  if (ts.isConditionalExpression(n)) { const a = branchText(n.whenTrue, seen), b = branchText(n.whenFalse, seen); return words(a) >= words(b) ? a : b }
  return '#'
}

const SKIP_ATTR = /^(className|style|key|id|href|src|type|role|d|viewBox|fill|stroke|accept|htmlFor|target|rel|data-.*|on[A-Z].*|strokeLinecap|strokeLinejoin|textAnchor|dominantBaseline|transform|align|side|kind|value|variant|mode|size|as)$/
// A literal that is code, not copy: a class list, a path, a key, a colour, a selector.
const codeLike = t => /^[\w./:#@\-[\]()%,=*> ]*$/.test(t) && !/[a-z]{3,} [a-z]{2,} [a-z]{2,}/i.test(t)
  || /^(\.|#|\/|[a-z]+:\/\/)/.test(t) || /\b(px|rem|var\(--|rgba?\(|flex|grid|mt-|px-|tx-)\b/.test(t)

for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const seen = new Set()
  const visit = node => {
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && !seen.has(node)) {
      const direct = node.children.some(c => (ts.isJsxText(c) && /[A-Za-z]{2}/.test(c.text)) || (ts.isJsxExpression(c) && c.expression && flat(c.expression) !== null && /[A-Za-z]{2}/.test(flat(c.expression))))
      if (direct) {
        const kind = ts.isJsxElement(node) ? kindOfElement(node, f) : kindOfElement(node.parent, f)
        add(sf, node, kind, elementText(node, seen))
      }
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText()
      const el = node.parent.parent
      if (!SKIP_ATTR.test(name) && node.initializer) {
        const init = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
        const text = init && (ts.isConditionalExpression(init) ? branchText(init, seen) : flat(init))
        const kind = (ATTR_KIND[name] ?? (() => null))(el)
        if (text && kind && !codeLike(text)) { add(sf, node, kind, text); seen.add(init) }
        else if (text) seen.add(init)
      } else if (node.initializer) { seen.add(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer) }
    }
    // Any other sentence a reader can be shown: a message, a legend's note, a description in a list.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
      || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && flat(node) !== null)) && !seen.has(node)) {
      let top = node
      while (top.parent && ts.isBinaryExpression(top.parent) && top.parent.operatorToken.kind === ts.SyntaxKind.PlusToken && flat(top.parent) !== null) top = top.parent
      if (!seen.has(top)) {
        seen.add(top); top.forEachChild(function mark(c) { seen.add(c); c.forEachChild(mark) })
        const p = top.parent
        const isImport = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || (ts.isCallExpression(p) && /^(import|require|querySelector(All)?|closest|matches|getAttribute|setAttribute|addEventListener|removeEventListener|createElement|createElementNS|getContext|includes|startsWith|endsWith|split|join|replace|test|match|indexOf|localeCompare|toLocaleString|getPropertyValue|setProperty|slug)$/.test(p.expression.getText().split('.').pop()))
        const text = flat(top) ?? ''
        if (!isImport && words(text.replace(/#/g, ' ')) >= 3 && /[a-z]{2,} [a-z]{2,}/i.test(text) && !codeLike(text)) {
          let kind = /Methods\.tsx$|methods/.test(f) ? 'methods' : 'text'
          for (let e = top.parent; e; e = e.parent) {
            if (ts.isThrowStatement(e) || (ts.isNewExpression(e) && /Error$/.test(e.expression.getText()))) { kind = 'error'; break }
            if (ts.isPropertyAssignment(e) && /^(notes|note)$/.test(e.name.getText())) { kind = 'legend'; break }
            if (ts.isPropertyAssignment(e) && /^(why|error|message|reason)$/.test(e.name.getText())) { kind = 'error'; break }
            if (ts.isPropertyAssignment(e) && /^(title)$/.test(e.name.getText())) { kind = 'tooltip'; break }
            if (ts.isJsxAttribute(e)) { kind = (ATTR_KIND[e.name.getText()] ?? (() => null))(e.parent.parent) ?? kind; break }
            if (ts.isJsxExpression(e) && e.parent && (ts.isJsxElement(e.parent) || ts.isJsxFragment(e.parent))) { kind = kindOfElement(e.parent, f); break }
            if (ts.isFunctionLike(e) && !ts.isArrowFunction(e)) break
          }
          add(sf, top, kind, text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (process.argv.includes('--json')) {
  // Written to a file descriptor in one piece: a pipe would be cut by the exit.
  fs.writeFileSync(process.env.COPY_OUT ?? 1, JSON.stringify(strings.map(s => ({ ...s, file: s.file.replace(SRC, 'src'), over: s.words > (BUDGET[s.kind] ?? Infinity), retired: retiredIn(s.text).map(r => r.use) }))))
  process.exit(0)
}
if (LIST) {
  const over = s => s.words - (BUDGET[s.kind] ?? 999)
  for (const s of [...strings].sort((a, b) => over(b) - over(a) || b.words - a.words)) {
    const r = retiredIn(s.text).map(x => x.use).join(', ')
    console.log(`${String(s.words).padStart(3)}/${String(BUDGET[s.kind] ?? '-').padEnd(3)} ${s.kind.padEnd(16)} ${s.file.replace('src/', '').replace('components/', '')}:${s.line}  ${s.text}${r ? `   [RETIRED -> ${r}]` : ''}`)
  }
  process.exit(0)
}

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`) }
}

console.log('Copy: the source')
ok(strings.length > 600, `the parser finds the app's strings (${strings.length} in ${files.length} files)`)
const byKind = {}
for (const s of strings) (byKind[s.kind] ??= []).push(s)
for (const [kind, list] of Object.entries(byKind).sort()) {
  const cap = BUDGET[kind]
  if (cap === undefined) continue
  const over = list.filter(s => s.words > cap && !excepted(s.text))
  ok(over.length === 0, `${kind}: ${list.length} strings, none over ${cap} words`,
    over.slice(0, 6).map(s => `${s.file}:${s.line} (${s.words}) ${s.text.slice(0, 110)}`).join('\n       '))
}
const retired = strings.flatMap(s => retiredIn(s.text).map(r => ({ s, r })))
ok(retired.length === 0, 'no string uses a retired term',
  retired.slice(0, 10).map(({ s, r }) => `${s.file}:${s.line} "${s.text.slice(0, 90)}" -> ${r.use}`).join('\n       '))

const INV = 'docs/design/inventory/after.json'
if (fs.existsSync(INV)) {
  console.log('Copy: the measured inventory')
  const inv = refine(JSON.parse(fs.readFileSync(INV, 'utf8')))
  const app = inv.strings.filter(s => !s.data)
  ok(app.length > 300, `the inventory holds the app's strings as drawn (${app.length} distinct, ${inv.states.length} states)`)
  const kinds = {}
  for (const s of app) (kinds[s.kind] ??= []).push(s)
  for (const [kind, list] of Object.entries(kinds).sort()) {
    // The walk reads an empty state as one block: its instruction and its sentence together.
    const cap = kind === 'empty state' ? BUDGET['empty state block'] : BUDGET[kind]
    if (cap === undefined) continue
    const over = list.filter(s => s.own > (/Methods$/.test(s.views[0]) && kind === 'text' ? BUDGET.methods : cap) && !excepted(s.text))
    ok(over.length === 0, `as drawn, ${kind}: ${list.length}, none over ${cap} of the app's own words`,
      over.slice(0, 6).map(s => `[${s.state}] (${s.own}) ${s.text.slice(0, 110)}`).join('\n       '))
  }
  for (const [state, kind] of Object.entries(SCREEN_KIND)) {
    const r = inv.states.find(s => s.state === state)
    ok(!!r && r.app <= SCREEN_BUDGET[kind], `${state}: ${r?.app} of the app's words on one screen at rest, within ${SCREEN_BUDGET[kind]} (${kind})`)
  }
  const drawn = app.flatMap(s => retiredIn(s.text).map(r => ({ s, r })))
  ok(drawn.length === 0, 'no string as drawn uses a retired term',
    drawn.slice(0, 10).map(({ s, r }) => `[${s.state}] "${s.text.slice(0, 90)}" -> ${r.use}`).join('\n       '))
  // What a saved figure carries (the legend Save writes under the drawing, as the walk read it from each file).
  const text = f => (f.format === 'SVG' ? f.foot.map(l => l.t).join(' ') : f.own.join(' | '))
  const file = (state, re) => inv.saved.find(f => f.state === state && re.test(f.file))
  for (const f of inv.saved.filter(f => f.format === 'SVG')) {
    ok(f.foot.length > 0, `${f.state}, ${f.file}: the saved figure has a legend`)
    const own = words(f.foot.filter(l => !l.bold).map(l => l.t).join(' ').replace(/\(n = [\d,]+\)/g, ' ').replace(/[^\s]*\d[^\s]*/g, ' '))
    ok(own <= 3 * BUDGET['figure legend'], `${f.file}: its legend's sentences are ${own} words with the names of its groups, within ${3 * BUDGET['figure legend']}`)
  }
  const volcano = file('Differential expression / Volcano', /volcano/)
  ok(!!volcano && volcano.foot.some(l => l.bold && / vs .* in /.test(l.t)), "the volcano's file names its contrast and its cell type in a title line",
    volcano?.foot.map(l => l.t).join(' / '))
  ok(!!volcano && /Wilcoxon rank-sum/.test(text(volcano)) && /(padj|FDR) < [\d.e-]+ and \|log₂FC\| ≥ [\d.]+/.test(text(volcano)), "and its test and its two cutoffs")
  const dot = file('Gene expression / Dot plot', /dotplot/)
  ok(!!dot && dot.foot[0]?.bold === true, "the dot plot's file has a title line", dot?.foot[0]?.t)
  console.log('Copy: the cells the annotator did not call, in the lab fixture\'s saved files (16 of 240)')
  const labCells = file('Lab bundle: Cells', /./), labComp = file('Lab bundle: Composition', /./), labMk = file('Lab bundle: Markers', /./)
  ok(!!labCells && new RegExp(`${NOT_CALLED} \\| 16\\b`).test(text(labCells)), "Cells' saved key has a row for them with its count", labCells && text(labCells).slice(-200))
  ok(!!labCells && /EXCLUDED 10/.test(text(labCells)) && /UNRESOLVED 6/.test(text(labCells)), "and the annotator's own labels with theirs")
  {
    const m = labCells ? [...text(labCells).matchAll(/Type[A-D] \| (\d+)/g)].map(x => +x[1]) : []
    ok(m.length === 4 && m.reduce((a, b) => a + b, 0) + 16 === 240, `the saved key sums to the cells drawn (${m.join(' + ')} + 16 = 240)`)
  }
  ok(!!labComp && /16 cells the annotator did not call \(EXCLUDED and UNRESOLVED\) are not a cell type and are left out/.test(text(labComp)),
    "Composition's saved legend carries the sentence its screen shows", labComp && text(labComp))
  ok(!!labMk && /16 cells the annotator did not call \(EXCLUDED 10, UNRESOLVED 6\) are on neither side of any test/.test(text(labMk)),
    "Markers' saved legend carries the sentence its screen shows", labMk && text(labMk))
}

console.log('Copy: rules that are functions')
ok(properName('Dna repair') === 'DNA repair' && properName('E2f targets') === 'E2F targets', 'a gene-set name keeps its acronyms: DNA repair, E2F targets')
ok(properName('Tnfa signaling via nfkb') === 'TNFA signaling via NFKB' && properName('Myc targets v1') === 'MYC targets V1' && properName('G2m checkpoint') === 'G2M checkpoint',
  'TNFA signaling via NFKB, MYC targets V1, G2M checkpoint', [properName('Tnfa signaling via nfkb'), properName('Myc targets v1'), properName('G2m checkpoint')].join(' / '))
ok(properName('Oxidative phosphorylation') === 'Oxidative phosphorylation' && properName('Rna polymerase ii transcription') === 'RNA polymerase II transcription' && properName('Mrna splicing') === 'mRNA splicing',
  'a dictionary word is left alone; RNA polymerase II, mRNA', properName('Rna polymerase ii transcription'))
{
  const s = { total: 16, by: [{ name: 'EXCLUDED', n: 10 }, { name: 'UNRESOLVED', n: 6 }] }
  ok(notCalledNote(s, 'are on neither side of any test') === '16 cells the annotator did not call (EXCLUDED 10, UNRESOLVED 6) are on neither side of any test',
    'one sentence for the cells the annotator did not call, with their count and labels')
  ok(notCalledNote({ total: 0, by: [] }, 'x') === '', 'and none when there are none')
  for (const f of ['Composition.tsx', 'Markers.tsx']) ok(/notCalledNote\(/.test(fs.readFileSync(`src/components/${f}`, 'utf8')), `${f} takes that sentence from the one function (screen and saved legend)`)
  ok(/NOT_CALLED/.test(fs.readFileSync('src/components/Cells.tsx', 'utf8').split('const redraw')[1] ?? ''), "Cells paints the row into its saved key")
}
{
  const per = ['qNSC / Quiescent', 'qNSC / Reactivated', 'Oligodendrocyte / Quiescent', 'Endothelial / Reactivated', 'Pericyte / Quiescent'].map((label, i) => ({ label, n: 960 + i * 1013 }))
  let parted = 0, lines = 0
  for (let w = 220; w <= 900; w += 20) for (const l of wrapSpaces(nNote(per), w, 10.5, false)) { lines++; if (/\/ ?$/.test(l) || /^\d[\d,]*( ·)?$/.test(l) || /^(Quiescent|Reactivated) [\d,]+/.test(l) && w >= 220) parted++ }
    ok(lines > 50 && parted === 0, `a saved legend never parts a name from its count, from the width of its widest entry up (${lines} lines at 35 widths)`, `${parted} parted`)
}

console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`)
process.exit(fail ? 1 : 0)
