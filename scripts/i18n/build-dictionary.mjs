/**
 * يبني قاموس الواجهة الإنجليزيّة `public/i18n/en.json` من ملفّات الترجمة
 * `scripts/i18n/en/*.json` (كلٌّ منها مصفوفة {ar, en} أو كائنٌ ar→en).
 *
 *   node scripts/i18n/build-dictionary.mjs           يبني القاموس
 *   node scripts/i18n/build-dictionary.mjs --missing يسرد ما في الشيفرة بلا ترجمة
 *
 * القاموسُ يُطابَق بالنصّ العربيّ كما في الشيفرة؛ فمن غيّر نصّاً عربياً يضيف
 * ترجمتَه هنا (`--missing` يسمّيه).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIR = "scripts/i18n/en";
const OUT = "public/i18n/en.json";
const norm = (s) => s.replace(/\s+/g, " ").trim();

const dict = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const pairs = Array.isArray(data) ? data.map((x) => [x.ar, x.en]) : Object.entries(data);
  for (const [ar, en] of pairs) {
    if (typeof ar !== "string" || typeof en !== "string" || !en.trim()) continue;
    dict[norm(ar)] = en;
  }
}

if (process.argv.includes("--missing")) {
  const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "i18n-")), "all.json");
  execFileSync("node", ["scripts/i18n/ar-strings.mjs", "extract", tmp]);
  const all = JSON.parse(fs.readFileSync(tmp, "utf8"));
  const missing = all.filter((x) => !(norm(x.ar) in dict));
  for (const m of missing) console.log(JSON.stringify(m.ar), "←", m.files[0]);
  console.error(`${missing.length} of ${all.length} strings have no translation`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(OUT, JSON.stringify(sorted) + "\n");
  console.log(`${Object.keys(sorted).length} entries → ${OUT}`);
}
