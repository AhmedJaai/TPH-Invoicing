import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import picomatch from "next/dist/compiled/picomatch";
import { SLIP_FONT_FILES, SLIP_LOGO } from "./payslip-pdf";

/**
 * قسيمةُ الراتب تقرأ خطَّها وشعارَها من القرص — وعلى Vercel لا يُنسخ ملفٌّ لم يُطلب. فالطلبُ في
 * `next.config.ts` يُحرس هنا: المفتاحُ يطابق مسارَ الدالّة، وكلُّ ملفٍّ يقرؤه الرسمُ مطلوبٌ وموجود.
 */
describe("ملفّاتُ القسيمة تُنسخ مع دالّتها", () => {
  const config = readFileSync("next.config.ts", "utf8");
  const m = /"(\/payroll\/slip\/[^"]*\/pdf)":\s*\[([^\]]*)\]/.exec(config);

  it("المفتاحُ يطابق مسارَ الدالّة", () => {
    expect(m, "لا مفتاحَ لـ/payroll/slip/[id]/pdf في outputFileTracingIncludes").not.toBeNull();
    const key = JSON.parse(`"${m![1]}"`) as string;
    expect(picomatch(key)("/payroll/slip/[id]/pdf")).toBe(true);
  });

  it("كلُّ خطٍّ وصورةٍ يقرؤها الرسمُ مطلوبٌ وموجود", () => {
    const listed = [...m![2].matchAll(/"\.\/([^"]+)"/g)].map((x) => x[1]);
    for (const f of [...SLIP_FONT_FILES.map((x) => `src/fonts/${x}`), SLIP_LOGO]) {
      expect(listed, `${f} لا يُنسخ مع الدالّة`).toContain(f);
      expect(() => readFileSync(f)).not.toThrow();
    }
  });
});
