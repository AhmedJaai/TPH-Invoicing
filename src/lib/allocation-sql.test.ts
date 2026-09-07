import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * حارسُ مصيدةٍ تُسقِط المال، ولا يراها المترجم ولا تُصدر خطأً.
 *
 * ── ما وقع ──
 *
 * في `/api/match-confirm` كُتب المستحقُّ هكذا:
 *
 *     coalesce((select sum(pa.amount_minor) from payment_allocations pa
 *               where pa.invoice_id = ${invoices.id}), 0)
 *
 * و`${invoices.id}` داخل قالبٍ خام يُصيّر العمود **مجرّداً** فينفصل عن
 * صفّه، فيصمت الاستعلام الفرعيّ ويُرجع **صفراً — لا خطأً**.
 *
 * وأثرُه أنّ كلّ فاتورةٍ مسدَّدة تبدو مفتوحة. فحُوسبت فاتورةٌ سُدّدت
 * بـ٤٢٠٫٠٠ على أنّها لم تُسدَّد، وحاول النظام سدادها ثانية، فردّه
 * مؤثِّرُ `007` في القاعدة: «سداد أكبر من قيمة الفاتورة: سُدّد ٨٤٠٠٠
 * والفاتورة ٤٢٠٠٠» — ثمّ خرج ٥٠٠ إلى الشاشة.
 *
 * **والقاعدة هي التي أنقذت المال، لا الشيفرة.** ولولا ذلك المؤثِّر
 * لخرج ضعفُ المبلغ إلى المورّد بلا شكوى.
 *
 * ── ولماذا يُحرَس نصّاً ──
 *
 * لا يكشفه `tsc` (النوعان واحد)، ولا اختبارٌ نقيّ (لا قاعدة فيه)،
 * ولا يرمي في التشغيل (يُرجع صفراً صامتاً). فالحارس الوحيد الممكن أن
 * يُقرأ الملفّ ويُمنَع الشكل الخاطئ من العودة.
 *
 * والصواب `${invoices}.id` — مرجعُ الجدول ثمّ الاسم حرفياً.
 */

/** ملفّات فيها استعلاماتٌ فرعية مرتبطة على المال. */
const GUARDED = [
  "src/app/api/match-confirm/route.ts",
  "src/app/api/match-confirm-bulk/route.ts",
  "src/app/api/payment-run/route.ts",
  "src/app/api/bank-import/route.ts",
];

/**
 * الشكل الممنوع: `${table.column}` داخل `select ... where` فرعيّ.
 *
 * ويُضيَّق عمداً على الاستعلامات الفرعية: `${table.column}` في تجميعٍ
 * عاديّ على الاستعلام الرئيس صحيحٌ وشائع، فمنعُه كلّه يُنتج حارساً
 * يُتجاوَز بدل أن يُصلَح.
 */
const CORRELATED = /select[\s\S]{0,200}?where[^`]{0,120}?\$\{[a-zA-Z]+\.[a-zA-Z]+\}/i;

describe("الاستعلام الفرعيّ المرتبط يُكتب بالمرجع لا بالعمود", () => {
  for (const file of GUARDED) {
    it(`${file} لا يحمل الشكل الصامت`, () => {
      const source = readFileSync(file, "utf8");
      const hit = CORRELATED.exec(source);
      expect(
        hit === null,
        hit
          ? `شكلٌ يُرجع صفراً صامتاً: «${hit[0].slice(0, 90)}…» — اكتبه \${table}.column`
          : "",
      ).toBe(true);
    });
  }

  it("والحارس نفسه يُمسك الشكل الخاطئ — وإلّا كان طمأنينةً بلا سند", () => {
    const bad =
      "sql`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices.id}), 0)`";
    expect(CORRELATED.test(bad)).toBe(true);
  });

  it("ولا يمسك الصواب", () => {
    const good =
      "sql`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices}.id), 0)`";
    expect(CORRELATED.test(good)).toBe(false);
  });

  it("ولا يمسك التجميع العاديّ على الاستعلام الرئيس", () => {
    const fine = "sql`coalesce(sum(${paymentAllocations.amountMinor}),0)::int`";
    expect(CORRELATED.test(fine)).toBe(false);
  });
});
