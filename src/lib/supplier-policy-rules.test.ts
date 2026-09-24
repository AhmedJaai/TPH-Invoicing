import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { needsContract, needsPaperUpload, type DocumentPolicy } from "./supplier-policy-rules";

const base: DocumentPolicy = {
  issuesInvoices: false,
  contractOnFile: false,
  contractRequired: true,
  paperInvoices: false,
};

describe("من يحتاج عقد توريد", () => {
  it("من لا يصدر فواتير ولا عقدَ عندنا", () => {
    expect(needsContract(base)).toBe(true);
  });

  it("ومن يصدر فواتير ضريبية لا يُطلَب منه عقد", () => {
    expect(needsContract({ ...base, issuesInvoices: true })).toBe(false);
  });

  it("ومن عقدُه عندنا استوفى", () => {
    expect(needsContract({ ...base, contractOnFile: true })).toBe(false);
  });

  it("ومن أُعلن أنّه لا يُطلَب منه عقد يخرج — وهو قرارُ صاحب العمل", () => {
    expect(needsContract({ ...base, contractRequired: false })).toBe(false);
  });

  it("ومن فواتيرُه ورقيّة مطلبُه رفعُ الورقة لا عقدٌ", () => {
    expect(needsContract({ ...base, paperInvoices: true })).toBe(false);
    expect(needsPaperUpload({ ...base, paperInvoices: true })).toBe(true);
  });
});

/*
  الشرطُ افترق مرّةً فأنتج عددين لسؤالٍ واحد (٣ في الرفع، ٢ في
  المورّدين). وهذا حارسٌ نصّيّ: لا يُعيد أحدٌ كتابة الأعمدة الأربعة في
  شاشةٍ بدل استدعاء القاعدة — لأنّ المترجم لا يرى النسخة، ولا يرميها
  التشغيل، ولا تظهر إلّا عدداً يناقض عدداً.
*/
describe("لا نسخةَ ثانية من الشرط", () => {
  const FILES = [
    "src/app/(app)/suppliers/page.tsx",
    "src/app/(app)/upload/page.tsx",
    "src/components/attention-workspaces.tsx",
    "src/lib/attention-facts.ts",
  ];

  for (const f of FILES) {
    it(`${f} لا يكتب الشرط بيده`, () => {
      const src = readFileSync(f, "utf8");
      // نسخةُ TypeScript: أربعةُ حقولٍ في تعبيرٍ واحد
      expect(src).not.toMatch(/!\w+\.issuesInvoices\s*&&\s*!\w+\.contractOnFile/);
      // نسخةُ SQL: أربعةُ أعمدةٍ في شرطٍ واحد
      expect(src).not.toMatch(/not\s+s\.issues_invoices[\s\S]{0,120}not\s+s\.paper_invoices/);
    });
  }
});

/*
  القاعدةُ المحقونة تسمّي أعمدتها باسم الجدول (`"suppliers"."issues_invoices"`)،
  فاستعلامٌ يُلقّب الجدولَ يجعلها تشير إلى ما ليس في FROM — و«‏invalid
  reference to FROM-clause entry» لا يراه المترجم ولا تراه الاختبارات
  النقيّة، وإنّما تراه صفحةُ عطبٍ حمراء في وجه صاحب المقهى. وقع فعلاً:
  `from suppliers s` مع الحقن.
*/
describe("الحقنُ لا يُلقَّب جدولُه", () => {
  const FILES = ["src/lib/attention-facts.ts"];
  for (const f of FILES) {
    it(`${f} لا يُلقّب suppliers حيث يحقن القاعدة`, () => {
      const src = readFileSync(f, "utf8");
      if (!src.includes("needsContractSql()")) return;
      /* اللقبُ كلمةٌ بعد الجدول ليست من كلمات SQL التالية له */
      expect(src).not.toMatch(
        /from\s+\$\{suppliers\}\s+(?!where\b|order\b|group\b|limit\b|join\b|left\b|inner\b|cross\b|on\b|having\b|union\b|\))\w+/i,
      );
    });
  }
});
