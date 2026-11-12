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
// 3. THE VIEWS RENDERED NOW, in Node (scripts/render.mjs): Overview on the three
//    demos and on the fixture with cells not called, and Methods, as text. No
//    retired word, no "1 samples".
//
// It needs no browser, so reading 2 is of a walk somebody ran. It carries a
// STAMP, the hash of the source's strings at the time of the walk, and the
// check fails when the source's strings are no longer those: a changed string
// cannot pass on an inventory of the string before it. Re-measure after any
// change to a string (docs/DESIGN.md, "Checking a change").
//
// What reading 1 takes for copy: any text of an element; an attribute that is
// copy by its name (title, label, placeholder, aria-label ...) even when it is
// ONE word; a `label:` or `title:` of an object; any other literal of three
// words or more; and what a Save writes for a script to read, a file's name
// (`<Figure name>`, the first argument of downloadCsv) and a CSV's header.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { BUDGET, KEPT, RETIRED, SCREEN_BUDGET, SCREEN_KIND, asWords, butParts, excepted, kept, refine, retiredIn, words } from './copy-standard.mjs'
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
  hint: () => 'help', help: () => 'help', sub: e => (tagOf(e) === 'Card' ? 'legend' : 'help'), meta: () => 'status', why: () => 'tooltip', reason: () => 'tooltip',
  alt: () => 'accessible name', name: e => (tagOf(e) === 'Figure' ? 'file name' : null),
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

// An attribute that is copy by its name is read even when it is one word: only a path, a colour, a
// selector or an identifier is set aside. (`codeLike` set every one-word string aside, and a string
// that begins with a slot, so `label="clusters"` and an accessible name that opens with a count passed unread.)
const codeAttr = t => /^(\.[\w-]|\/|[a-z]+:\/\/)/.test(t) || /^#[\w-]+$/.test(t) || /var\(--|rgba?\(/.test(t) || /^[a-z0-9]+(_[a-z0-9]+)+$/.test(t)
const COPY_PROP = /^(label|title|note|notes|hint|sub|eyebrow|placeholder|head|meta|why|reason|help)$/
/** Is this literal where copy goes: a copy property of an object, a copy attribute, the text of an element? */
function copySlot(node) {
  for (let e = node.parent, child = node; e; child = e, e = e.parent) {
    if (ts.isConditionalExpression(e)) { if (e.condition === child) return false; continue }
    if (ts.isParenthesizedExpression(e) || ts.isTemplateSpan(e) || ts.isTemplateExpression(e) || ts.isArrayLiteralExpression(e)) continue
    if (ts.isBinaryExpression(e)) {
      const k = e.operatorToken.kind
      if (k === ts.SyntaxKind.PlusToken) continue
      if ((k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) && e.right === child) continue
      return false
    }
    if (ts.isPropertyAssignment(e)) return COPY_PROP.test(e.name.getText())
    if (ts.isJsxExpression(e)) { if (e.parent && ts.isJsxAttribute(e.parent)) continue; return !!e.parent && (ts.isJsxElement(e.parent) || ts.isJsxFragment(e.parent)) }
    if (ts.isJsxAttribute(e)) return !!(ATTR_KIND[e.name.getText()] ?? (() => null))(e.parent.parent)
    return false
  }
  return false
}

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
        if (text && kind && (kind === 'file name' || !codeAttr(text))) { add(sf, node, kind, text); seen.add(init) }
        else if (text) seen.add(init)
      } else if (node.initializer) { seen.add(ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer) }
    }
    // What a Save writes for a script to read: a CSV's file name and its header.
    if (ts.isCallExpression(node) && node.expression.getText() === 'downloadCsv') {
      const lits = (n, kind) => {
        if (!n) return
        const t = flat(n)
        if (t !== null) { add(sf, n, kind, t); seen.add(n); n.forEachChild(function mark(c) { seen.add(c); c.forEachChild(mark) }); return }
        n.forEachChild(c => lits(c, kind))
      }
      lits(node.arguments[0], 'file name'); lits(node.arguments[1], 'csv header')
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
        const sentence = words(text.replace(/#/g, ' ')) >= 3 && /[a-z]{2,} [a-z]{2,}/i.test(text) && !codeLike(text)
        // A shorter one is copy when it sits where copy goes: `{ label: 'none' }` is read, `mode === 'bulk'` is not.
        const short = !sentence && /[A-Za-z]{2}/.test(text) && !codeAttr(text) && copySlot(top)
        if (!isImport && (sentence || short)) {
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

// The source's strings, as one number: the inventory carries it, so a walk of other strings is refused.
const stamp = crypto.createHash('sha256').update([...new Set(strings.map(s => `${s.kind}\t${s.text}`))].sort().join('\n')).digest('hex').slice(0, 16)
if (process.argv.includes('--stamp')) { fs.writeFileSync(1, stamp + '\n'); process.exit(0) }
if (process.argv.includes('--json')) {
  // Written to a file descriptor in one piece: a pipe would be cut by the exit.
  fs.writeFileSync(process.env.COPY_OUT ?? 1, JSON.stringify(strings.map(s => ({ ...s, file: s.file.replace(SRC, 'src'), over: s.words > (BUDGET[s.kind] ?? Infinity), retired: kept(s) ? [] : retiredIn(asWords(s)).map(r => r.use) }))))
  process.exit(0)
}
if (LIST) {
  const over = s => s.words - (BUDGET[s.kind] ?? 999)
  for (const s of [...strings].sort((a, b) => over(b) - over(a) || b.words - a.words)) {
    const r = kept(s) ? '' : retiredIn(asWords(s)).map(x => x.use).join(', ')
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
const retired = strings.filter(s => !kept(s)).flatMap(s => retiredIn(asWords(s)).map(r => ({ s, r })))
ok(retired.length === 0, 'no string uses a retired term',
  retired.slice(0, 10).map(({ s, r }) => `${s.file}:${s.line} "${s.text.slice(0, 90)}" -> ${r.use}`).join('\n       '))
{
  // What this reading missed at d51bf41, each now read: a one-word string, a CSV's header, a file's name, "clicked".
  const one = strings.filter(s => s.words === 1 && !['file name', 'csv header'].includes(s.kind)).length
  const heads = strings.filter(s => s.kind === 'csv header').length, names = strings.filter(s => s.kind === 'file name').length
  ok(one > 100 && heads > 20 && names > 15, `one-word strings are read (${one}), and CSV headers (${heads}) and file names (${names})`)
  const caught = t => retiredIn(asWords(t)).length > 0
  ok(caught({ kind: 'label', text: 'clusters' }) && caught({ kind: 'button', text: 'Clear 1 clicked' })
    && caught({ kind: 'file name', text: 'cluster_markers' }) && caught({ kind: 'csv header', text: 'identity' })
    && caught({ kind: 'csv header', text: 'cluster population' }) && caught({ kind: 'label', text: 'min replicates' }),
    'each of them with a retired word is caught: "clusters", "Clear 1 clicked", cluster_markers, identity, min replicates')
  // The word the Run card used for what a converter did with a record: it said neither "listed" nor "copied".
  ok(caught({ kind: 'legend', text: "5 records from the object's uns, as the lab's converter carried them." })
    && !caught({ kind: 'legend', text: "5 records from the object's uns, copied unless marked otherwise." })
    && !caught({ kind: 'methods', text: 'at what resolution the graph was cut are not carried in the file, and are not guessed at' }),
    'a run record\'s retired word is caught ("carried"), its term is not ("copied"), and Methods\' "not carried in the file" stays')
  ok(fs.readFileSync(path.join(SRC, 'components/Methods.tsx'), 'utf8').includes('are not carried in the file'),
    'and the phrase the pattern leaves out is still in Methods',
    'Methods no longer says "not carried in the file": drop "(?! in the file)" from the rule in scripts/copy-standard.mjs')
  const all = strings.map(asWords)
  const stale = RETIRED.flatMap(r => butParts(r).filter(b => !all.some(t => r.re.test(t) && b.test(t))).map(b => `/${b.source}/ (${r.use})`))
  ok(stale.length === 0, 'every exemption still exempts a string in the source', stale.join('; '))
  ok(KEPT.every(k => strings.some(s => kept(s) && s.text === k.text)), `every word kept in a file by name is still there (${KEPT.map(k => k.text).join(', ')})`)
}

const INV = 'docs/design/inventory/after.json'
if (fs.existsSync(INV)) {
  console.log('Copy: the measured inventory')
  const inv = refine(JSON.parse(fs.readFileSync(INV, 'utf8')))
  ok(inv.source?.sha === stamp, 'the inventory was measured from this source: its stamp is the hash of the strings read above',
    `the inventory's stamp is ${inv.source?.sha ?? 'absent'}, the source's is ${stamp}: build, serve, and run scripts/inventory-design.mjs again`)
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
  // A short string the walk counted as the object's own (a tile's label, a key's entry) is read for retired words too.
  const own = inv.strings.filter(s => s.data && words(s.text) <= 3).flatMap(s => retiredIn(s.text).map(r => ({ s, r })))
  ok(own.length === 0, 'nor any short string counted as the object\'s own',
    own.slice(0, 10).map(({ s, r }) => `[${s.state}] "${s.text.slice(0, 60)}" -> ${r.use}`).join('\n       '))
  ok(!inv.saved.some(f => retiredIn(String(f.file).replace(/[_.]+/g, ' ')).length), 'no saved file\'s name holds a retired word',
    inv.saved.filter(f => retiredIn(String(f.file).replace(/[_.]+/g, ' ')).length).map(f => f.file).join(', '))
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

if (SRC === 'src') {
  console.log('Copy: the views rendered now (no browser, no committed file)')
  const { loadComponents, render, textOf } = await import('./render.mjs')
  const { demoSource, bundleSource } = await import('../src/lib/source.ts')
  const { parseBundle } = await import('../src/lib/bundle.ts')
  const { DE_GATES } = await import('../src/lib/stats.ts')
  const { sentinelBundle } = await import('./fixture-sentinels.mjs')
  const C = await loadComponents()
  const objects = [['the replicated demo', demoSource('cohort')], ['the time course', demoSource('course')],
    ['the wild type', demoSource('wt')], ['the fixture with cells not called', bundleSource(parseBundle(sentinelBundle()))]]
  for (const [what, src] of objects) {
    const over = textOf(render(C.Overview, { src, types: src.types, palKey: 'npg', roles: { t: -1, g: -1 }, onRoles: () => {} }))
    const bad = retiredIn(over)
    ok(bad.length === 0, `Overview on ${what}: no retired word (${words(over)} words)`, bad.map(r => `${r.re} -> ${r.use}`).join('; '))
    ok(/\bcell types?\b/.test(over) && !/\b1 (samples|groups|cell types|genes|cells)\b/.test(over), 'its tiles count cell types, and one of a thing is singular',
      (over.match(/\b1 (samples|groups|cell types|genes|cells)\b/) ?? [''])[0])
    const conds = src.d.conds
    const methods = textOf(render(C.Methods, { src, types: src.types, tis: [1], ctrl: [conds[0]], cs: [conds[conds.length - 1]],
      method: 'wilcox', padjMax: 0.05, lfcMin: 0.25, gates: DE_GATES, lib: null }))
    const badM = retiredIn(methods)
    ok(badM.length === 0, `Methods on ${what}: no retired word (${words(methods)} words)`, badM.map(r => `${r.re} -> ${r.use}`).join('; '))
    if (conds.length > 1) ok(methods.includes(`${src.genes.length.toLocaleString()} genes the object measures`), 'and it names the correction\'s denominator: every gene the object measures')
  }
}

console.log('Copy: rules that are functions')
ok(properName('Dna repair') === 'DNA repair' && properName('E2f targets') === 'E2F targets', 'a gene-set name keeps its acronyms: DNA repair, E2F targets')
ok(properName('Tnfa signaling via nfkb') === 'TNFA signaling via NFKB' && properName('Myc targets v1') === 'MYC targets V1' && properName('G2m checkpoint') === 'G2M checkpoint',
  'TNFA signaling via NFKB, MYC targets V1, G2M checkpoint', [properName('Tnfa signaling via nfkb'), properName('Myc targets v1'), properName('G2m checkpoint')].join(' / '))
ok(properName('Mhc class i protein complex') === 'MHC class I protein complex' && properName('T cell activation') === 'T cell activation'
  && properName('Regulation of b cell proliferation') === 'Regulation of B cell proliferation' && properName('Vitamin a metabolic process') === 'Vitamin A metabolic process'
  && properName('Transferase activity acting on a sulfur group') === 'Transferase activity acting on a sulfur group',
  'a single letter is a capital (MHC class I, B cell, vitamin A), and "a" after a preposition is the article')
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
