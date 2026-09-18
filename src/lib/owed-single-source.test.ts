import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * «كم أدين؟» له مصدرٌ واحد — `supplier-balance.service.ts`.
 *
 * كان «المستحقّ» يُحسَب في مواضع متفرّقة بطرح المخصَّص من إجمالي كلّ
 * فاتورة: بلا رصيدنا عند المورّد، وبعتباتٍ مختلفة (صفر · هللة · لا شيء).
 * فقالت معاينة السداد «سيُخصَّص ٠٫٠٢» عن سرد كو، وبند المتأخّر «مستحقّ
 * عليك» عن مالٍ دفعناه. والمترجم لا يرى الفرق بين معادلتين.
 *
 * فالطرحُ الخامّ `total_minor - coalesce(` لا يُكتب إلّا في المواضع
 * المسمّاة هنا، ولكلٍّ سببُه.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

export const RAW_OWED = /\btotal_minor\s*-\s*coalesce\s*\(/;

const ALLOWED = new Map<string, string>([
  [path.join("src", "services", "supplier-balance.service.ts"), "المصدر نفسه"],
  [path.join("src", "services", "supplier-credit.service.ts"), "قائمة الفواتير المفتوحة للتخصيص — سؤالٌ عن الفواتير لا عن «عليك»"],
  [path.join("src", "lib", "month-close-facts.ts"), "فواتير الشهر غير المسدَّدة في قائمة الإقفال — عدُّ فواتير بعتبة الهللة"],
  [path.join("src", "lib", "changes-facts.ts"), "«عليك» قبل ثلاثين يوماً بالمعادلة نفسها عند تاريخٍ مضى — لا تجيبه الخدمة"],
]);

describe("«كم أدين؟» من مصدرٍ واحد", () => {
  it("لا طرحَ خامّاً للمخصَّص من إجمالي الفاتورة خارج المواضع المسمّاة", () => {
    const offenders = walk("src").filter(
      (f) => !ALLOWED.has(f) && RAW_OWED.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("والمواضع المسمّاة موجودة — لا إذنَ لملفٍّ غائب", () => {
    for (const f of ALLOWED.keys()) expect(statSync(f).isFile()).toBe(true);
  });

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(RAW_OWED.test("sum(i.total_minor - coalesce((select sum(pa.amount_minor)")).toBe(true);
    expect(RAW_OWED.test("invoices.total_minor-coalesce(a.s, 0)")).toBe(true);
  });

  it("ولا يُمسك غيره", () => {
    expect(RAW_OWED.test("p.amount_minor - p.fee_minor - coalesce(b.s, 0)")).toBe(false);
  });
});
