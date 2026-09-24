import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { GATE_ORDER } from "@/lib/ops/production-gate";

/**
 * الوثيقة تُقارَن بالشيفرة — لا تُصدَّق.
 *
 * وجدت مراجعة سبتمبر أحدَ عشر موضعاً يخالف فيه `CLAUDE.md` الواقع: جدول
 * هجراتٍ ينقصه ملفّ، وأوامر محذوفة ما زالت موصوفة، وملفّاتٌ في جدول
 * المكتبات. وثلاث روايات لعددٍ واحد تُسقط الثقة بالبقيّة. فما يمكن فحصه
 * آلياً يُفحَص هنا.
 */
const claude = readFileSync("CLAUDE.md", "utf8");
/*
  نُقل التفصيل من `CLAUDE.md` إلى `docs/` (٢٤ سبتمبر ٢٠٢٦) كي لا يُحمَّل في
  كلّ جلسة — فالحارس يتبع المحتوى إلى موضعه ولا يسقط بسقوطه من هنا.
*/
const schemaDoc = readFileSync("docs/data-model/migrations.md", "utf8");
const modulesDoc = readFileSync("docs/reference/modules.md", "utf8");
const opsDoc = readFileSync("docs/decisions/engineering-ops.md", "utf8");
const decisionDocs = readdirSync("docs/decisions")
  .filter((f) => f.endsWith(".md"))
  .map((f) => readFileSync(`docs/decisions/${f}`, "utf8"));
const allDocs = [claude, schemaDoc, modulesDoc, ...decisionDocs].join("\n");
const scripts = Object.keys(
  (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts,
);

describe("CLAUDE.md ووثائق docs/ تطابق المستودع", () => {
  it("جدول الهجرات هو عينُ مجلّد drizzle/sql", () => {
    const listed = [...schemaDoc.matchAll(/^\| `(\d{3}_[\w-]+\.sql)` \|/gm)].map((m) => m[1]).sort();
    const onDisk = readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql")).sort();
    expect(listed).toEqual(onDisk);
  });

  it("كلّ أمرٍ مذكور موجودٌ في package.json", () => {
    const named = new Set(
      [...allDocs.matchAll(/`(?:npm run )?((?:db|drive|ops|bench|try):[\w-]+)`/g)].map((m) => m[1]),
    );
    expect([...named].filter((n) => !scripts.includes(n))).toEqual([]);
  });

  it("كلّ ملفٍّ في جدول المكتبات موجود", () => {
    const files = [...modulesDoc.matchAll(/^\| `((?:src|scripts)\/[^`]+\.tsx?)` \|/gm)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("كلّ مسارٍ يذكره CLAUDE.md موجود — الخريطة التي تدلّ على غائبٍ أسوأ من غيابها", () => {
    const paths = [...claude.matchAll(/`((?:src|docs|scripts|drizzle)\/[^`*\s]+)`/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("لا أمرَ يطبّق المخطّط بلا هجرة", () => {
    expect(scripts).not.toContain("db:push");
  });
});

/* ── الأعداد ──
 *
 * «عدد الهجرات يُقرأ من المجلّد لا يُكتَب رقماً» — والقاعدة نفسها في كلّ عدد.
 * كانت الوثيقة تقول «خمسة عشر بنداً» والبوّابة ستّة عشر: روايتان لعددٍ واحد.
 * فالعدد يُقرأ من الوثيقة ويُقارَن بمصدره، لا يُكتب في الاختبار.
 */
const TASHKEEL = /[\u064B-\u0652\u0640]/g;
const WORDS: Record<string, number> = {
  "واحد": 1, "اثنان": 2, "ثلاثة": 3, "اربعة": 4, "خمسة": 5, "ستة": 6, "سبعة": 7, "ثمانية": 8, "تسعة": 9, "عشرة": 10,
  "احد عشر": 11, "اثنا عشر": 12, "ثلاثة عشر": 13, "اربعة عشر": 14, "خمسة عشر": 15, "ستة عشر": 16,
  "سبعة عشر": 17, "ثمانية عشر": 18, "تسعة عشر": 19, "عشرون": 20,
};

/** «٤١» أو «أحدَ عشر» أو «ستّة عشر» ← عدد. وما لا يُفهَم يُرمى — لا يُقرأ صفراً. */
export function arabicCount(text: string): number {
  const t = text.trim().replace(TASHKEEL, "").replace(/[أإآ]/g, "ا");
  if (/^[٠-٩0-9]+$/.test(t)) return Number(t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  if (t in WORDS) return WORDS[t];
  throw new Error(`عددٌ لا يُفهَم في الوثيقة: «${text}»`);
}

function claimed(re: RegExp, doc: string): number {
  const m = re.exec(doc);
  if (!m) throw new Error(`لم يُعثَر على العدد في الوثيقة: ${re}`);
  return arabicCount(m[1]);
}

describe("أعدادُ الوثائق تطابق مصادرها", () => {
  it("يُفهَم العدد رقماً أو كلمة", () => {
    expect(arabicCount("٤١")).toBe(41);
    expect(arabicCount("أحدَ عشر")).toBe(11);
    expect(arabicCount("ستّة عشر")).toBe(16);
    expect(() => arabicCount("بضعة")).toThrow();
  });

  it("الجداول = عدد pgTable في schema.ts، وأسماؤها المسرودة هي أسماؤها", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const names = [...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(claimed(/^## الجداول — ([٠-٩0-9]+)$/m, schemaDoc)).toBe(names.length);

    const section = schemaDoc.slice(schemaDoc.indexOf("## الجداول —"), schemaDoc.indexOf("التعريف في `src/db/schema.ts`"));
    const listed = [...section.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(names);
  });

  it("سيناريوهات الشهادة = ما في certify-flow.ts", () => {
    const flow = readFileSync("scripts/certify-flow.ts", "utf8");
    const ordinals = new Set([...flow.matchAll(/"([٠-٩]+) · /g)].map((m) => m[1]));
    expect(claimed(/\| `npm run ops:certify` \| (\S+(?: عشر)?) سيناريو/, opsDoc)).toBe(ordinals.size);
  });

  /*
    كان هذا البند يفشل عمداً: الوثيقة تقول «خمسة عشر» و`GATE_ORDER` ستّة عشر.
    صُحّحت الوثيقة، فصار الفحص حارساً: من يضيف بنداً إلى البوّابة يصحّح عددها.
  */
  it("بنود البوّابة = GATE_ORDER.length", () => {
    expect(claimed(/\| `npm run ops:gate` \| (\S+(?: عشر)?) بنداً/, opsDoc)).toBe(GATE_ORDER.length);
  });
});
