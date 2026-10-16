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
  const seen = new Map();
  for (const f of walk("src")) {
    const t = fs.readFileSync(f, "utf8");
    for (const n of arabicNodes(f, t)) {
      const v = n.value.replace(/\s+/g, " ").trim();
      if (!v || !AR.test(v)) continue;
      if (!seen.has(v)) seen.set(v, { files: new Set(), template: n.head || n.tail });
      seen.get(v).files.add(f);
    }
  }
  const arr = [...seen].map(([k, v]) => ({ ar: k, template: v.template, files: [...v.files] }));
  fs.writeFileSync(args[0], JSON.stringify(arr, null, 1));
  console.log(`${arr.length} unique strings`);
} else {
  console.error("usage: list|strip|extract");
  process.exit(1);
}
