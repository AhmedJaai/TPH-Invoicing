import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * حرّاسُ المال — يقرؤون الشيفرة نصّاً.
 *
 * الخدماتُ تحمل سياسة الكتابة: الشهرُ المقفل، والتوأم، والرسم، واشتقاقُ
 * الحال. ومسارٌ يُدرج بيده يخرج من السياسة بصمت: كانت المزامنة تُدرج
 * الفاتورة والدفعة، ووسمُ السداد يُدرج التخصيص — فأوّلُ تغييرٍ في الخدمة
 * لا يبلغهما، والمترجمُ لا يرى ذلك ولا يرميه التشغيل.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const SRC = walk("src");

/* ── ١. الفاتورة والدفعة والتخصيص تُكتب في خدماتها وحدها ── */

export const MONEY_INSERT = /\.insert\(\s*(invoices|payments|paymentAllocations)\s*\)/;

const MONEY_WRITERS = new Set([
  path.join("src", "services", "invoice.service.ts"),
  path.join("src", "services", "payment.service.ts"),
]);

describe("إدراج الفاتورة والدفعة والتخصيص في خدماتها وحدها", () => {
  it("لا إدراج باليد خارج invoice.service وpayment.service", () => {
    const offenders = SRC.filter(
      (f) => !MONEY_WRITERS.has(f) && MONEY_INSERT.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(MONEY_INSERT.test("await tx.insert(invoices).values({})")).toBe(true);
    expect(MONEY_INSERT.test("await tx.insert( paymentAllocations ).values({})")).toBe(true);
  });

  it("ولا يُمسك غيره", () => {
    expect(MONEY_INSERT.test("await tx.insert(invoiceLines).values({})")).toBe(false);
    expect(MONEY_INSERT.test("await tx.insert(documents).values({})")).toBe(false);
  });
});

/* ── ٢. تاريخُ السداد والحركة يومٌ مدنيّ لا لحظةُ الخادم ── */

/**
 * الاصطلاح: التاريخ المدنيّ يُكتب `00:00Z` ليومه. والشهرُ يُشتقّ منه
 * (`payment_month` في القاعدة، و`toISOString().slice(0, 7)` في الخدمات)
 * — فلحظةُ `new Date()` في الحادية عشرة ليلاً بتوقيت الرياض آخرَ الشهر
 * تقع في الشهر التالي بـUTC أو العكس، فتُكتب الدفعة في شهرٍ غير شهرها
 * ويُحرَس الإقفال على الشهر الخطأ. واليومُ يُؤخذ من `todayInRiyadh()`.
 */
export const NOW_AS_CIVIL_DATE = /\b(paidAt|valueDate)\s*:\s*new\s+Date\(\s*\)/;

describe("paidAt وvalueDate لا يُكتبان بلحظة الخادم", () => {
  it("لا `paidAt: new Date()` ولا `valueDate: new Date()` في src", () => {
    const offenders = SRC.filter((f) => NOW_AS_CIVIL_DATE.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(NOW_AS_CIVIL_DATE.test("createPayment(tx, { paidAt: new Date(), amountMinor })")).toBe(true);
    expect(NOW_AS_CIVIL_DATE.test("{ valueDate:new Date( ) }")).toBe(true);
  });

  it("ولا يُمسك اليومَ المدنيّ", () => {
    expect(NOW_AS_CIVIL_DATE.test("paidAt: new Date(`${paidOn}T00:00:00Z`)")).toBe(false);
    expect(NOW_AS_CIVIL_DATE.test("createdAt: new Date()")).toBe(false);
  });
});

/* ── تسامحُ الريال: القاعدةُ والشيفرةُ رقمٌ واحد ── */

/*
  قيدُ إجماليّ الفاتورة في القاعدة يكتب التسامحَ رقماً بيد (`<= 100`)، والشيفرةُ تقرؤه من
  `TOTAL_ROUNDING_TOLERANCE_MINOR`. لو تغيّر أحدُهما افترقا بصمت: فاتورةٌ تقبلها الشيفرةُ
  وتردّها القاعدة، أو العكس. فيُقابَل آخرُ تعريفٍ للقيد بالثابت.
*/
describe("تسامح الريال في القاعدة هو الثابتُ في الشيفرة", () => {
  it("آخرُ هجرةٍ تعرّف قيدَ الإجمالي تكتب التسامحَ نفسَه", async () => {
    const { TOTAL_ROUNDING_TOLERANCE_MINOR } = await import("./money");
    const CHECK = /abs\(subtotal_minor \+ vat_minor[^\n]*- total_minor\) <= (\d+)/;
    const defining = readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql")).sort()
      .map((f) => ({ f, m: CHECK.exec(readFileSync(path.join("drizzle", "sql", f), "utf8")) }))
      .filter((x) => x.m !== null);
    expect(defining.length).toBeGreaterThan(0);
    const last = defining[defining.length - 1];
    expect(Number(last.m?.[1]), last.f).toBe(TOTAL_ROUNDING_TOLERANCE_MINOR);
  });
});
