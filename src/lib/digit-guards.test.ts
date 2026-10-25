import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * نصُّ الواجهة بالأرقام اللاتينيّة — كما يكتب `arabic.ts` و`money.ts` كلَّ رقمٍ محسوب.
 *
 * كان ١٢٠ نصّاً ثابتاً بالأرقام العربيّة‑الهنديّة بجانب أرقامٍ لاتينيّة محسوبة، فتجتمع
 * الكتابتان في جملةٍ واحدة: «يجب أن يكون ١٥ رقماً، يبدأ بـ3 وينتهي بـ3». والإدخالُ يقبل
 * الاثنتين (`digits.ts`)؛ والعرضُ واحد.
 *
 * ويُستثنى ما يقرؤه النموذجُ لا الإنسان (التعليماتُ المرقَّمة)، وجدولُ التحويل، وبذرةُ
 * المورّدين، ونصوصُ SQL (تعليقاتُها).
 */
const EXEMPT = [
  "src/lib/ai/",
  "src/lib/bank/adjudicator-prompt.ts",
  "src/lib/bank/vision-statement.ts",
  "src/lib/bank/canonical.ts",
  "src/lib/digits.ts",
  "src/lib/money.ts",
  "src/lib/suppliers-seed.ts",
  "src/lib/extraction/schema.ts",
  "src/lib/extraction/schemas-by-kind.ts",
  "src/services/adjudicator.service.ts",
  "src/services/finance-reading.service.ts",
];
const INDIC = /[٠-٩٫٬]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(full) && !full.includes(".test.") ? [full] : [];
  });
}

export function indicLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    /* نصُّ SQL يحمل تعليقاته — ليس واجهة */
    if (ts.isTaggedTemplateExpression(n) && n.tag.getText() === "sql") return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && INDIC.test(n.getText())) {
      out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.getText().slice(0, 80)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("أرقامُ نصّ الواجهة لاتينيّة", () => {
  it("لا تنسيقَ بالعربيّة بلا `nu-latn` — «أرسل ١٤١» كانت تُكتب بالهنديّة بجانب «قبل 3 أيّام»", () => {
    const bad = files("src").filter((f) => !EXEMPT.some((e) => f.startsWith(e)))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const))
      .filter(([, , l]) => /(toLocale(?:Date|Time)?String|Intl\.(?:NumberFormat|DateTimeFormat))\(\s*["']ar(?:-SA)?["']/.test(l))
      .map(([f, n]) => `${f}:${n}`);
    expect(bad).toEqual([]);
  });

  it("يمسك الرقمَ الهنديّ في النصّ ويترك SQL", () => {
    expect(indicLiterals("x.tsx", `const a = <p>آخر ٢٤ ساعة</p>; const b = sql\`/* ١ */ select 1\`;`)).toHaveLength(1);
  });

  it("لا رقمَ هنديّاً في نصٍّ ثابت يُعرض", () => {
    const found = files("src").filter((f) => !EXEMPT.some((e) => f.startsWith(e))).flatMap((f) => indicLiterals(f, readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });
});
