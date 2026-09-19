/**
 * يبني دليلَ النظام كاملاً — HTML يُطبَع إلى PDF.
 *
 *   npm run docs:handbook
 *
 * ولا يُكتب فيه رقمٌ باليد: الجداولُ والأعدادُ تُقرأ من الشيفرة لحظةَ
 * التوليد. فمن غيّر الشيفرة وأعاد التوليد وجد الدليل مطابقاً — والدليلُ
 * الذي يُكتب بيدٍ يصير كذباً عند أوّل تغيير.
 *
 * والطباعةُ بمتصفّح Chrome بلا شبكة: لا مكتبةَ رسمٍ من CDN، ولا خطٌّ
 * يُحمَّل — فالنتيجةُ واحدةٌ في كلّ مرّة.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  collectApi, collectAuditActions, collectFiles, collectMigrations,
  collectPages, collectPermissions, collectSchema, collectTests,
} from "./handbook/collect";
import { part1 } from "./handbook/part1";
import { part2 } from "./handbook/part2";
import { part3 } from "./handbook/part3";
import { esc } from "./handbook/render";

const OUT_DIR = process.argv[2] ?? "docs/handbook";

const pkgJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const pkg = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

const data = {
  files: collectFiles(),
  tests: collectTests(),
  schema: collectSchema(),
  perms: collectPermissions(),
  audit: collectAuditActions(),
  api: collectApi(),
  pages: collectPages(),
  migrations: collectMigrations(),
  pkg,
};

const TOC = [
  ["intro", "١", "ما هذا النظام، ولمن"],
  ["arch", "٢", "المعمارية العامّة"],
  ["security", "٣", "الأمن والصلاحيات"],
  ["db", "٤", "قاعدة البيانات"],
  ["code", "٥", "معمارية الشيفرة"],
  ["nav", "٦", "التنقّل والمعمارية المعلوماتية"],
  ["pages", "٧", "كلُّ صفحة: ماذا تجيب، وكلُّ زرّ فيها"],
  ["api", "٨", "مسارات الواجهة البرمجية"],
  ["flows", "٩", "مسارات العمل"],
  ["ai", "١٠", "الذكاء الاصطناعيّ"],
  ["decisions", "١١", "القرارات وأسبابُها"],
  ["redesign", "١٢", "إعادةُ التصميم: ما تغيّر، ولماذا"],
  ["tests", "١٣", "الاختبارات والبوّابة"],
  ["gaps", "١٤", "ما ليس مبنيّاً — وما بُني ولم يُوصَل"],
  ["traps", "١٥", "المصائد المعروفة"],
  ["files", "١٦", "ملحق: جردُ الملفّات"],
];

const today = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Riyadh",
}).format(new Date());

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>دليل نظام ذا بوبليك هاوس</title>
<style>
  @page { size: A4; margin: 18mm 15mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "SF Arabic", "Geeza Pro", system-ui, sans-serif;
    color: #111827; line-height: 1.75; font-size: 10.5pt; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  code, .code, .nums { font-family: ui-monospace, "SF Mono", Menlo, monospace; direction: ltr; unicode-bidi: isolate; }
  code { background: #f3f4f6; padding: 0.5pt 3pt; border-radius: 3px; font-size: 0.86em; }
  pre.code { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8pt; font-size: 8.5pt; overflow-wrap: anywhere; white-space: pre-wrap; }

  /* ── الغلاف ── */
  .cover { height: 247mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover h1 { font-size: 30pt; margin: 0 0 6pt; letter-spacing: -0.5pt; }
  .cover .sub { font-size: 13pt; color: #4b5563; margin: 0 0 24pt; }
  .cover dl { display: grid; grid-template-columns: auto 1fr; gap: 4pt 14pt; font-size: 10pt; max-width: 120mm; }
  .cover dt { color: #6b7280; }
  .cover dd { margin: 0; font-weight: 600; }
  .cover .rule { height: 3px; background: #111827; width: 56mm; margin: 0 0 18pt; }

  /* ── الفهرس ── */
  .toc { page-break-after: always; }
  .toc ol { list-style: none; padding: 0; counter-reset: none; }
  .toc li { display: flex; gap: 8pt; align-items: baseline; padding: 3.5pt 0; border-bottom: 1px dotted #e5e7eb; }
  .toc .n { color: #6b7280; min-width: 16pt; font-weight: 700; }

  h2 { font-size: 17pt; margin: 0 0 10pt; padding-bottom: 5pt; border-bottom: 2px solid #111827; page-break-after: avoid; }
  h2 .num { display: inline-block; color: #6b7280; margin-left: 8pt; font-size: 13pt; }
  h3 { font-size: 12.5pt; margin: 16pt 0 6pt; page-break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; color: #374151; page-break-after: avoid; }
  p { margin: 0 0 7pt; }
  ul { margin: 0 0 8pt; padding-inline-start: 16pt; }
  li { margin-bottom: 3.5pt; }

  table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9pt; page-break-inside: auto; }
  th, td { border: 1px solid #e5e7eb; padding: 4pt 6pt; text-align: start; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; font-size: 8.5pt; }
  tr { page-break-inside: avoid; }
  table.compact { font-size: 8.5pt; }
  table.tight td, table.tight th { padding: 2.5pt 5pt; }
  table.chips td { border: none; padding: 2pt 4pt; }

  .note { background: #f0f9ff; border-inline-start: 3px solid #0284c7; padding: 7pt 10pt; margin: 8pt 0; border-radius: 0 5px 5px 0; }
  .warn { background: #fffbeb; border-inline-start: 3px solid #d97706; padding: 7pt 10pt; margin: 8pt 0; border-radius: 0 5px 5px 0; }
  .muted { color: #6b7280; }

  figure { margin: 12pt 0; page-break-inside: avoid; }
  figcaption { font-size: 8.5pt; color: #6b7280; margin-top: 5pt; text-align: center; }
  svg { display: block; max-width: 100%; }

  .page-break { page-break-before: always; }

  /*
    ── العرضُ على الشاشة ──
    قياسُ الصفحة وهوامشُها في at-page لا يسريان على الشاشة، فيمتدّ النصُّ
    بعرض النافذة كلِّه ويُقصّ الغلاف. وهذه الكتلةُ للشاشة وحدها: نسخةُ
    HTML تُقرأ كما يُقرأ الـPDF، والطباعةُ لا تتأثّر بها.
  */
  @media screen {
    body { background: #f4f4f5; }
    body > section, body > * { max-width: 190mm; margin-inline: auto; }
    body { padding: 12mm 0 24mm; }
    body > section { background: #fff; padding: 14mm; margin-bottom: 8mm; box-shadow: 0 1px 3px rgb(0 0 0 / .08); border-radius: 4px; }
    .cover { height: auto; min-height: 150mm; }
    .page-break { display: none; }
  }
</style>
</head>
<body>

<section class="cover">
  <div class="rule"></div>
  <h1>دليل نظام ذا بوبليك هاوس</h1>
  <p class="sub">المعمارية · الشيفرة · الواجهة · القرارات وأسبابُها</p>
  <dl>
    <dt>المنشأة</dt><dd>مؤسسة ذا بوبليك هاوس — النسيم، جدّة</dd>
    <dt>الرقم الضريبيّ</dt><dd class="nums">310007971600003</dd>
    <dt>السجلّ التجاريّ</dt><dd class="nums">7052766941</dd>
    <dt>تاريخ التوليد</dt><dd>${esc(today)}</dd>
    <dt>ملفّات المصدر</dt><dd class="nums">${data.files.length}</dd>
    <dt>أسطر المصدر</dt><dd class="nums">${data.files.reduce((s, f) => s + f.lines, 0).toLocaleString("en-US")}</dd>
    <dt>جداول القاعدة</dt><dd class="nums">${data.schema.tables.length}</dd>
    <dt>حالات الاختبار</dt><dd class="nums">${data.tests.cases.toLocaleString("en-US")}</dd>
  </dl>
  <p style="margin-top:22pt;font-size:9pt;color:#6b7280;max-width:130mm">
    وُلِّد هذا الدليل من المستودع نفسِه: كلُّ عددٍ وكلُّ جدولٍ وكلُّ مسارٍ فيه
    مقروءٌ من الشيفرة لحظةَ التوليد، لا مكتوبٌ بيد. فمن غيّر الشيفرة وأعاد
    التوليد وجد الدليل مطابقاً.
  </p>
</section>

<section class="toc">
  <h2 style="border:none;padding:0">المحتويات</h2>
  <ol>
    ${TOC.map(([id, n, t]) => `<li><span class="n">${esc(n)}</span><span>${esc(t)}</span></li>`).join("")}
  </ol>
</section>

${part1(data)}
${part2(data)}
${part3(data)}

</body>
</html>`;

mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, "handbook.html");
writeFileSync(file, html);
console.log(`✓ ${file}`);
console.log(`  ${(html.length / 1024).toFixed(0)}KB · ${TOC.length} فصلاً`);
