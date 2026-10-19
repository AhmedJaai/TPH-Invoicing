/**
 * أداةُ نصوص الواجهة العربيّة — تقرأ الشيفرة بمحلِّل TypeScript فتجد كلَّ نصٍّ
 * عربيّ في سلسلةٍ أو قالبٍ أو نصّ JSX (لا التعليقات).
 *
 *   node scripts/i18n/ar-strings.mjs list <files...>     يسرد النصوص بأرقام أسطرها
 *   node scripts/i18n/ar-strings.mjs strip <files...>    يحذف الحركات عدا الشدّة
 *   node scripts/i18n/ar-strings.mjs extract <out.json>  يجمع نصوص src كلّها (للقاموس)
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const AR = /[؀-ۿ]/;
const HARAKAT = /[\u064C-\u0650\u0652]/g; // الحركات عدا الشدّة وتنوين الفتح

export function arabicNodes(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (n) => {
    const k = n.kind;
    if (
      k === ts.SyntaxKind.StringLiteral ||
      k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      k === ts.SyntaxKind.TemplateHead ||
      k === ts.SyntaxKind.TemplateMiddle ||
      k === ts.SyntaxKind.TemplateTail ||
      k === ts.SyntaxKind.JsxText
    ) {
      const start = n.getStart(sf);
      const end = n.getEnd();
      const raw = text.slice(start, end);
      if (AR.test(raw)) {
        const line = sf.getLineAndCharacterOfPosition(start).line + 1;
        const value = k === ts.SyntaxKind.JsxText ? n.text : n.text;
        out.push({ kind: ts.SyntaxKind[k], start, end, raw, value, line, jsx: k === ts.SyntaxKind.JsxText,
          head: k === ts.SyntaxKind.TemplateHead || k === ts.SyntaxKind.TemplateMiddle,
          tail: k === ts.SyntaxKind.TemplateTail || k === ts.SyntaxKind.TemplateMiddle });
      }
    }
    // سياقُ JSX: سماتُ title/placeholder/aria-label نصوصٌ عاديّة فتُلتقط أعلاه
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "list") {
  for (const f of args) {
    const t = fs.readFileSync(f, "utf8");
    const ns = arabicNodes(f, t);
    if (!ns.length) continue;
    console.log(`### ${f}`);
    for (const n of ns) console.log(`${n.line}: ${n.raw.replace(/\s+/g, " ").trim()}`);
  }
} else if (cmd === "strip") {
  let changed = 0;
  for (const f of args) {
    const t = fs.readFileSync(f, "utf8");
    const ns = arabicNodes(f, t);
    let out = t;
    for (const n of [...ns].reverse()) {
      const s = n.raw.replace(HARAKAT, "");
      if (s !== n.raw) out = out.slice(0, n.start) + s + out.slice(n.end);
    }
    if (out !== t) { fs.writeFileSync(f, out); changed++; }
  }
  console.log(`stripped ${changed} files`);
} else if (cmd === "extract") {
  // القاموس: كلُّ نصٍّ كاملاً، والقالبُ بقيمه خاناتٍ ‎{0}‎ ‎{1}‎ — هكذا يُطابَق ما يُرسم
  const seen = new Map();
  const add = (v, f) => {
    v = v.replace(/\s+/g, " ").trim();
    if (!v || !AR.test(v)) return;
    if (!seen.has(v)) seen.set(v, new Set());
    seen.get(v).add(f);
  };
  // ما لا يُرسم: أوامرُ النموذج، وقراءةُ المستندات، وبياناتُ الاختبار
  const notUi = /^src\/(lib\/(ai\/(?!finding-labels)|extraction\/)|test\/|db\/)/;
  for (const f of walk("src")) {
    if (notUi.test(f.split(path.sep).join("/"))) continue;
    const t = fs.readFileSync(f, "utf8");
    const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f, t, ts.ScriptTarget.Latest, true, kind);
    const visit = (n) => {
      if (ts.isTemplateExpression(n)) {
        let v = n.head.text;
        n.templateSpans.forEach((sp, i) => { v += `{${i}}` + sp.literal.text; });
        add(v, f);
      } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || n.kind === ts.SyntaxKind.JsxText) {
        add(n.text, f);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const arr = [...seen].map(([ar, files]) => ({ ar, files: [...files] }));
  fs.writeFileSync(args[0], JSON.stringify(arr, null, 1));
  console.log(`${arr.length} unique strings`);
} else if (cmd === "apply") {
  // يستبدل نصوصاً بأعيانها: ملفّ JSON ‏{ "path": [[old, new], …] } — القالب بخاناته ‎{0}‎
  // يُعاد بناؤه بتعابيره نفسها وبترتيبها، فلا تُمسّ الشيفرة إلّا في النصّ.
  const plan = JSON.parse(fs.readFileSync(args[0], "utf8"));
  const norm = (v) => v.replace(/\s+/g, " ").trim();
  let done = 0, missed = [];
  for (const [f, pairs] of Object.entries(plan)) {
    let text = fs.readFileSync(f, "utf8");
    const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kind);
    const map = new Map(pairs.map(([a, b]) => [norm(a), b]));
    const hit = new Set();
    const edits = [];
    const esc = (v, q) => v.replace(/\\/g, "\\\\").replace(q === "`" ? /`|\$\{/g : new RegExp(q, "g"), (m) => "\\" + m);
    const visit = (n) => {
      if (ts.isTemplateExpression(n)) {
        let v = n.head.text; n.templateSpans.forEach((sp, i) => (v += `{${i}}` + sp.literal.text));
        const nv0 = map.get(norm(v));
        if (nv0 !== undefined) {
          // الفراغ على طرفي القالب جزءٌ من المعنى (« · ») — يُحفظ كما كان
          const nv = v.match(/^\s*/)[0] + nv0.trim() + v.match(/\s*$/)[0];
          const parts = nv.split(/\{(\d+)\}/);
          const order = parts.filter((_, i) => i % 2 === 1).map(Number);
          if (order.length === n.templateSpans.length) {
            let out = "`" + esc(parts[0], "`");
            order.forEach((k, i) => { out += "${" + n.templateSpans[k].expression.getText(sf) + "}" + esc(parts[2 * i + 2], "`"); });
            edits.push([n.getStart(sf), n.getEnd(), out + "`"]); hit.add(norm(v));
          }
        }
      } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        const nv0 = map.get(norm(n.text));
        if (nv0 !== undefined) {
          const nv = n.text.match(/^\s*/)[0] + nv0.trim() + n.text.match(/\s*$/)[0];
          const raw = text.slice(n.getStart(sf), n.getEnd()); const q = raw[0];
          edits.push([n.getStart(sf), n.getEnd(), q + esc(nv, q === "`" ? "`" : q) + q]); hit.add(norm(n.text));
        }
      } else if (n.kind === ts.SyntaxKind.JsxText) {
        const nv = map.get(norm(n.text));
        if (nv !== undefined && !/[{}<>]/.test(nv)) {
          const raw = text.slice(n.getStart(sf), n.getEnd());
          const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
          edits.push([n.getStart(sf), n.getEnd(), lead + nv + trail]); hit.add(norm(n.text));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // نصٌّ داخل قالبٍ يُستبدل هو أيضاً: يُترك للمرور التالي، فالقالب يُعاد بناؤه من تعابيره الأصلية
    edits.sort((x, y) => y[0] - x[0]);
    const kept = edits.filter((e) => !edits.some((o) => o !== e && o[0] <= e[0] && o[1] >= e[1] && (o[0] < e[0] || o[1] > e[1])));
    for (const [a, b, r] of kept) text = text.slice(0, a) + r + text.slice(b);
    fs.writeFileSync(f, text);
    done += kept.length;
    for (const k of map.keys()) if (!hit.has(k)) missed.push(f + " :: " + k);
  }
  console.log(`applied ${done}`);
  if (missed.length) console.log("missed:\n" + missed.join("\n"));
} else {
  console.error("usage: list|strip|extract|apply");
  process.exit(1);
}
