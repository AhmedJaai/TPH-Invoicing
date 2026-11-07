import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import picomatch from "next/dist/compiled/picomatch";

/**
 * تقريرُ جرد السبت يقرأ خطَّه وشعارَه من القرص — وعلى Vercel لا يُنسخ ملفٌّ لم يُطلب. فالطلبُ في
 * `next.config.ts` يُحرس هنا: المفتاحُ نمطُ picomatch يطابق مسارَ الدالّة (`[token]` يُهرَّب)، وكلُّ
 * ملفٍّ يقرؤه الرسمُ في قائمته وموجودٌ في المستودع.
 */
describe("ملفّاتُ تقرير الجرد تُنسخ مع دالّته", () => {
  const config = readFileSync("next.config.ts", "utf8");
  const renderer = readFileSync("src/lib/inventory/team-report-pdf.ts", "utf8");
  const m = /"(\/a\/[^"]*count-pdf)":\s*\[([^\]]*)\]/.exec(config);

  it("المفتاحُ يطابق مسارَ الدالّة", () => {
    expect(m, "لا مفتاحَ لـ/a/[token]/count-pdf في outputFileTracingIncludes").not.toBeNull();
    const key = JSON.parse(`"${m![1]}"`) as string;
    expect(picomatch(key)("/a/[token]/count-pdf")).toBe(true);
  });

  it("كلُّ خطٍّ وصورةٍ يقرؤها الرسمُ مطلوبٌ وموجود", () => {
    const listed = [...m![2].matchAll(/"\.\/([^"]+)"/g)].map((x) => x[1]);
    const used = [...renderer.matchAll(/"(thmanyahsans-[A-Za-z]+\.woff2)"/g)].map((x) => `src/fonts/${x[1]}`);
    if (renderer.includes("public/icons/icon-192.png")) used.push("public/icons/icon-192.png");
    expect(used.length).toBeGreaterThan(1);
    for (const f of used) {
      expect(listed, `${f} لا يُنسخ مع الدالّة`).toContain(f);
      expect(() => readFileSync(f)).not.toThrow();
    }
  });
});
