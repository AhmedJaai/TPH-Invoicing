import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import tph from "../../eslint-rules/index.mjs";

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
 * ── ولماذا يُحرَس بقراءة الشيفرة ──
 *
 * لا يكشفه `tsc` (النوعان واحد)، ولا اختبارٌ نقيّ (لا قاعدة فيه)،
 * ولا يرمي في التشغيل (يُرجع صفراً صامتاً). فالحارس الوحيد الممكن أن
 * تُقرأ الشيفرة ويُمنَع الشكل الخاطئ من العودة.
 *
 * والصواب `${invoices}.id` — مرجعُ الجدول ثمّ الاسم حرفياً.
 *
 * ── وأين الحارسُ اليوم ──
 *
 * كان انتظاماً على نصّ كلّ ملفّ؛ وصار قاعدةَ ESLint
 * `tph/no-column-in-correlated-subquery` (`eslint-rules/index.mjs`): تقرأ قالبَ
 * `sql` نفسَه، وجداولُها من `schema.ts`، وتظهر في المحرّر عند السطر. والشجرةُ
 * كلُّها تُفحَص بها في `npm run lint` وفي `code-guards.test.ts`. وهنا الأشكالُ
 * الثلاثة التي حدّدت القاعدة — على المخطّط الحقيقيّ لا على قائمةٍ تُكتب باليد.
 */
const linter = new Linter();

function caught(code: string): number {
  const messages = linter.verify(`const q = ${code};`, {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { tph },
    rules: { "tph/no-column-in-correlated-subquery": "error" },
  }, { filename: "src/x.ts" });
  if (messages.some((m) => m.fatal)) throw new Error("مثالٌ لا يُحلَّل");
  return messages.length;
}

describe("الاستعلام الفرعيّ المرتبط يُكتب بالمرجع لا بالعمود", () => {
  it("الحارس يُمسك الشكل الخاطئ — وإلّا كان طمأنينةً بلا سند", () => {
    expect(caught(
      "sql`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices.id}), 0)`",
    )).toBe(1);
  });

  it("ولا يمسك الصواب", () => {
    expect(caught(
      "sql`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices}.id), 0)`",
    )).toBe(0);
  });

  it("ولا يمسك التجميع العاديّ على الاستعلام الرئيس", () => {
    expect(caught("sql`coalesce(sum(${paymentAllocations.amountMinor}),0)::int`")).toBe(0);
  });
});

