import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * المورّدون يُسدَّدون آخرَ كلّ شهر (أحمد، ٢٤ أكتوبر ٢٠٢٦) — فأجلُ المورّد
 * (`payment_terms_days`) للعلم في صفحة المورّد وحدها. لا يدخل «يحتاج قرارك»
 * ولا عددَه ولا دفعةَ الشهر ولا مجموعَها: لو قرأه أحدُ هذه لصار «متأخّراً»
 * يخالف طريقةَ الدفع التي اختارها.
 */
const MUST_NOT_READ_TERMS = [
  "src/lib/attention.ts",
  "src/lib/attention-facts.ts",
  "src/lib/attention-triage.ts",
  "src/lib/work.ts",
  "src/lib/payment-run.ts",
  "src/lib/pay-run-selection.ts",
  "src/services/payment-run.service.ts",
  "src/app/api/payment-run/route.ts",
];

describe("أجلُ المورّد للعلم وحده", () => {
  it.each(MUST_NOT_READ_TERMS)("%s لا يقرأ أجلَ المورّد", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/paymentTermsDays|payment_terms_days|pastDueOf|daysPastDue/);
  });
});
