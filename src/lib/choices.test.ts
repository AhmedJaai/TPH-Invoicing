import { describe, expect, it } from "vitest";
import {
  summarizeChoices, vatInvoiceChoiceRows, vatTxChoiceRows, type VatInvoiceChoiceInput, type VatTxChoiceInput,
} from "./choices";

const tx = (over: Partial<VatTxChoiceInput>): VatTxChoiceInput => ({
  id: "t1", day: "2026-08-10", label: "إيجار", direction: "DEBIT", choice: true, included: true,
  vatMinor: 150_00, blocked: null, includedByDefault: false, href: "/bank/tx/t1", ...over,
});
const inv = (over: Partial<VatInvoiceChoiceInput>): VatInvoiceChoiceInput => ({
  id: "i1", day: "2026-08-10", supplier: "غاناش", number: "A-1", choice: true, included: true,
  vatUsedMinor: 30_00, vatMinor: 30_00, machineEligible: false, href: "/purchases/invoices/i1", ...over,
});

describe("دفتر الاختيارات — إقرار الضريبة", () => {
  it("ما لم يختر لا يدخل الدفتر", () => {
    expect(vatTxChoiceRows([tx({ choice: null })], null)).toEqual([]);
    expect(vatInvoiceChoiceRows([inv({ choice: null })], null)).toEqual([]);
  });

  it("حوالة ضمّت وتحسب: تعمل، وأثرها ضريبتها، وتسحب", () => {
    const [r] = vatTxChoiceRows([tx({})], null);
    expect(r).toMatchObject({ state: "APPLIED", effectMinor: 150_00, reason: null });
    expect(r.revoke).toEqual({ url: "/api/vat-choice", needs: "month:close", body: { kind: "tx", ids: ["t1"], included: null }, label: "أعدها إلى الأصل" });
  });

  it("حوالة اختيرت ولا تحسب: «لا يطبّق الآن» بسببها ومبلغها — وأثرها صفر معلوم", () => {
    const [r] = vatTxChoiceRows([tx({ included: false, blocked: "ضريبتها محسوبة في فاتورتها" })], null);
    expect(r.state).toBe("NOT_APPLIED");
    expect(r.effectMinor).toBe(0);
    expect(r.reason).toContain("ضريبتها محسوبة في فاتورتها");
    expect(r.reason).toContain("150.00");
    expect(r.revoke).not.toBeNull();
  });

  it("ما أخرج وكان يضمّ أصلاً أثره سالب، وما لم يكن يضمّ لا أثر له بالريال", () => {
    const [byDefault] = vatTxChoiceRows([tx({ choice: false, included: false, includedByDefault: true, direction: "CREDIT" })], null);
    expect(byDefault).toMatchObject({ state: "APPLIED", effectMinor: -150_00, choice: "استبعدتها من المبيعات" });
    const [never] = vatTxChoiceRows([tx({ choice: false, included: false })], null);
    expect(never.effectMinor).toBeNull();
  });

  it("الإقرار المقدّم يقفل: يقرأ ولا يسحب", () => {
    const [r] = vatTxChoiceRows([tx({})], "إقرار الربع الثالث 2026");
    expect(r.state).toBe("LOCKED");
    expect(r.revoke).toBeNull();
    expect(r.reason).toContain("قُدّم");
  });

  it("فاتورة أقرّت وضريبتها صفر مقروء: لا تطبّق ويقال لماذا", () => {
    const [r] = vatInvoiceChoiceRows([inv({ included: false, vatMinor: 0, vatUsedMinor: 0 })], null);
    expect(r.state).toBe("NOT_APPLIED");
    expect(r.reason).toContain("صفراً");
  });

  it("فاتورة أخرجت وكانت الآلة تحسبها: أثرها سالب", () => {
    const [r] = vatInvoiceChoiceRows([inv({ choice: false, included: false, machineEligible: true })], null);
    expect(r.effectMinor).toBe(-30_00);
    expect(r.revoke?.body).toEqual({ kind: "invoice", ids: ["i1"], included: null });
  });
});

describe("خلاصة الدفتر", () => {
  it("ما لا يطبّق يرفع، والباب الفارغ لا يعرض، والأحدث أوّلاً", () => {
    const rows = [
      ...vatTxChoiceRows([
        tx({ id: "a", day: "2026-07-01" }),
        tx({ id: "b", day: "2026-09-01" }),
        tx({ id: "c", day: "2026-08-01", included: false, blocked: "ارتدّت الحوالة" }),
      ], null),
      ...vatInvoiceChoiceRows([inv({})], null),
    ];
    const s = summarizeChoices(rows);
    expect(s.total).toBe(4);
    expect(s.notApplied.map((r) => r.id)).toEqual(["vat-tx:c"]);
    expect(s.byGroup.map((g) => g.group)).toEqual(["vat-tx", "vat-invoice"]);
    expect(s.byGroup[0].rows.map((r) => r.id)).toEqual(["vat-tx:c", "vat-tx:b", "vat-tx:a"]);
  });

  it("دفتر فارغ خلاصته فارغة", () => {
    expect(summarizeChoices([])).toEqual({ total: 0, notApplied: [], byGroup: [] });
  });
});
