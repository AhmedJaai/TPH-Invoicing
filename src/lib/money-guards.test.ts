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
