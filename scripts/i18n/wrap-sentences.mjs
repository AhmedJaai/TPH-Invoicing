/**
 * يجمع الجملة المقطّعة في JSX («سجّلت دفعة لـ{name} بمبلغ <Money/>») في
 * `<T s="سجّلت دفعة لـ{0} بمبلغ {1}" a={[name, <Money/>]} />` — فتُترجَم كاملةً.
 *
 *   node scripts/i18n/wrap-sentences.mjs [ملفات…]   (بلا ملفات: كلّ src/**\/*.tsx)
 *
 * الرسمُ العربيّ لا يتغيّر: النصّ هو ما تكتبه JSX نفسها (بقاعدة مسافاتها).
 */
import ts from "typescript";
import fs from "node:fs";
import { execSync } from "node:child_process";

const AR = /[ء-ي]/;
const SKIP_TAGS = new Set(["option", "title", "textarea", "style", "script", "pre", "code", "T"]);
const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&rlm;": "‏", "&lrm;": "‎" };

function cleanJsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => { if (/[^ \t]/.test(l)) lastNonEmpty = i; });
  let out = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, "");
    if (t) { if (i !== lastNonEmpty) t += " "; out += t; }
  });
  return out;
}
function decode(s) {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => {
    if (e in ENTITIES) return ENTITIES[e];
    const m = e.match(/^&#(x?)([0-9a-f]+);$/i);
    if (m) return String.fromCodePoint(parseInt(m[2], m[1] ? 16 : 10));
    throw new Error("entity " + e);
  });
}
const tagName = (n) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText() : null);

function candidate(node) {
  if (!(ts.isJsxElement(node) || ts.isJsxFragment(node))) return null;
  const tag = tagName(node);
  if (tag && SKIP_TAGS.has(tag)) return null;
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((p) => p.name?.getText() === "data-no-translate")) return null;
  const ch = node.children;
  if (!ch.some((c) => ts.isJsxText(c) && AR.test(c.text))) return null;
  if (!ch.some((c) => (ts.isJsxExpression(c) && c.expression) || ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c))) return null;
  let s = "";
  const args = [];
  const comments = [];
  for (const c of ch) {
    if (ts.isJsxText(c)) {
      let t;
      try { t = decode(cleanJsxText(c.text)); } catch { return null; }
      if (/[{}]/.test(t)) return null;
      s += t;
    } else if (ts.isJsxExpression(c)) {
      if (!c.expression) { comments.push(c.getText()); continue; }
      const e = c.expression;
      if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && !/[{}]/.test(e.text)) { s += e.text; continue; }
      s += `{${args.length}}`;
      args.push(e.getText());
    } else {
      s += `{${args.length}}`;
      const open = ts.isJsxElement(c) ? c.openingElement : ts.isJsxSelfClosingElement(c) ? c : null;
      const text = c.getText();
      /* العنصرُ داخل مصفوفة يحتاج مفتاحاً (react/jsx-key) */
      if (open && !open.attributes.properties.some((p) => p.name?.getText() === "key")) {
        const at = open.tagName.end - c.getStart();
        args.push(text.slice(0, at) + ` key="${args.length}"` + text.slice(at));
      } else args.push(text);
    }
  }
  if (!AR.test(s)) return null;
  return { s, args, comments, start: ch[0].getStart(), end: ch[ch.length - 1].end };
}

function render({ s, args, comments }) {
  const sAttr = /["\\\n]/.test(s) ? `s={${JSON.stringify(s)}}` : `s="${s}"`;
  const aAttr = args.length ? ` a={[${args.join(", ")}]}` : "";
  return comments.join("") + `<T ${sAttr}${aAttr} />`;
}

function hasNestedCandidate(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (n !== node && candidate(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

export function wrapFile(file) {
  let src = fs.readFileSync(file, "utf8");
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const edits = [];
    const visit = (n) => {
      const c = candidate(n);
      if (c && !hasNestedCandidate(n)) edits.push(c);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!edits.length) break;
    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) src = src.slice(0, e.start) + render(e) + src.slice(e.end);
    total += edits.length;
  }
  if (total && !/import \{ T \} from "@\/components\/i18n\/t";/.test(src)) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const at = imports.length ? imports[imports.length - 1].end : 0;
    src = src.slice(0, at) + `\nimport { T } from "@/components/i18n/t";` + src.slice(at);
  }
  if (total) fs.writeFileSync(file, src);
  return total;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : execSync("git ls-files 'src/**/*.tsx'").toString().trim().split("\n").filter((f) => !f.endsWith("components/i18n/t.tsx"));
let n = 0, nf = 0;
for (const f of files) { const k = wrapFile(f); if (k) { n += k; nf++; } }
console.log(`wrapped ${n} sentences in ${nf} files`);
