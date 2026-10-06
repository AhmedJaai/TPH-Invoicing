import { describe, expect, it } from "vitest";
import {
  computeVatReturn, filingDeadline, isIncluded, parseVatPeriod, periodBounds, periodMonths,
  invoiceIncluded, previousQuarter, quarterOfMonth, txVat, vatInsideGross, type VatInvoice, type VatTx,
} from "./vat-return";

const inv = (o: Partial<VatInvoice>): VatInvoice => ({
  id: "i", inputVatStatus: "ELIGIBLE", vatMinor: 0, totalMinor: 11_500, choice: null, ...o,
});

const tx = (o: Partial<VatTx>): VatTx => ({
  id: "t", direction: "CREDIT", category: "POS_SETTLEMENT", amountMinor: 0, choice: null, coveredByInvoice: false, ...o,
});

describe("الضريبة داخل المبلغ الشامل", () => {
  it("١١٥ ريالاً فيها ١٥", () => expect(vatInsideGross(11_500)).toBe(1_500));
  it("تقريبٌ واحدٌ إلى الهللة", () => expect(vatInsideGross(100)).toBe(13));
  it("الصفر صفر", () => expect(vatInsideGross(0)).toBe(0));
});

describe("الفترة", () => {
  it("الربع وشهوره وحدوده", () => {
    const q = parseVatPeriod("2026-Q3")!;
    expect(periodMonths(q)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(periodBounds(q)).toEqual({ from: "2026-07-01", until: "2026-10-01" });
  });
  it("الربع الرابع يعبر السنة", () => {
    expect(periodBounds(parseVatPeriod("2026-Q4")!).until).toBe("2027-01-01");
    expect(filingDeadline(parseVatPeriod("2026-Q4")!)).toBe("2027-01-31");
  });
  it("آخر يوم للتقديم: آخر الشهر التالي", () => {
    expect(filingDeadline(parseVatPeriod("2026-Q3")!)).toBe("2026-10-31");
    expect(filingDeadline(parseVatPeriod("2026-01")!)).toBe("2026-02-28");
  });
  it("الشهر وربعه والسابق", () => {
    expect(quarterOfMonth("2026-08")).toEqual({ kind: "quarter", year: 2026, quarter: 3 });
    expect(previousQuarter({ kind: "quarter", year: 2026, quarter: 1 })).toEqual({ kind: "quarter", year: 2025, quarter: 4 });
  });
  it("المدخل الفاسد لا يُخمَّن", () => {
    expect(parseVatPeriod("2026-Q5")).toBeNull();
    expect(parseVatPeriod("2026-13")).toBeNull();
    expect(parseVatPeriod("x")).toBeNull();
  });
});

describe("ما يُعدّ من حركات البنك", () => {
  it("تسوية الشبكة تُعدّ مبيعاتٍ بلا اختيار، وغيرها من الوارد لا", () => {
    expect(isIncluded(tx({}))).toBe(true);
    expect(isIncluded(tx({ category: "OTHER" }))).toBe(false);
    expect(isIncluded(tx({ category: "OTHER", choice: true }))).toBe(true);
    expect(isIncluded(tx({ choice: false }))).toBe(false);
  });
  it("ضريبة الرسوم تُعدّ مدخلاتٍ بلا اختيار، ومبلغُها هو الضريبة", () => {
    const v = tx({ direction: "DEBIT", category: "POS_VAT", amountMinor: 230 });
    expect(isIncluded(v)).toBe(true);
    expect(txVat(v)).toBe(230);
  });
  it("الصادر الآخر لا يُعدّ إلّا باختيار، وضريبتُه ١٥/١١٥", () => {
    const rent = tx({ direction: "DEBIT", category: "RENT", amountMinor: 4_750_000 });
    expect(isIncluded(rent)).toBe(false);
    expect(isIncluded({ ...rent, choice: true })).toBe(true);
    expect(txVat(rent)).toBe(619_565);
  });
  it("المسدِّدة فاتورةً محسوبة لا تُعدّ ولو اختيرت — وإلّا عُدّت ضريبتُها مرّتين", () => {
    expect(isIncluded(tx({ direction: "DEBIT", category: "SUPPLIER", choice: true, coveredByInvoice: true }))).toBe(false);
  });
});

describe("الإقرار", () => {
  it("المستحقّ = المخرجات − المدخلات، والتقريب على المجموع", () => {
    const r = computeVatReturn({
      invoices: [
        inv({ id: "a", vatMinor: 15_000 }),
        inv({ id: "b", inputVatStatus: "NOT_ELIGIBLE", vatMinor: 3_000 }),
        inv({ id: "c", vatMinor: null }),
      ],
      txs: [
        tx({ id: "s1", amountMinor: 100 }), tx({ id: "s2", amountMinor: 100 }), tx({ id: "s3", amountMinor: 100 }),
        tx({ id: "s4", amountMinor: 1_149_700 }),
        tx({ id: "v", direction: "DEBIT", category: "POS_VAT", amountMinor: 300 }),
        tx({ id: "r", direction: "DEBIT", category: "RENT", amountMinor: 115_000, choice: true }),
        tx({ id: "u", direction: "DEBIT", category: "UTILITY", amountMinor: 50_000 }),
      ],
    });
    expect(r.output).toEqual({ grossMinor: 1_150_000, vatMinor: 150_000, count: 4 });
    expect(r.input.invoices).toEqual({ vatMinor: 15_000, count: 1, confirmed: { count: 0, vatMinor: 0, derivedCount: 0 } });
    expect(r.input.bankVat).toEqual({ vatMinor: 300, count: 1 });
    expect(r.input.selected).toEqual({ grossMinor: 115_000, vatMinor: 15_000, count: 1 });
    expect(r.input.totalMinor).toBe(30_300);
    expect(r.notDeductible).toEqual({ count: 2, vatKnownMinor: 3_000, vatUnknownCount: 1 });
    expect(r.netMinor).toBe(119_700);
  });
  it("المدخلات أكبر: رصيدٌ سالبٌ لك لا صفر", () => {
    const r = computeVatReturn({ invoices: [inv({ id: "a", vatMinor: 500 })], txs: [] });
    expect(r.netMinor).toBe(-500);
  });
});

describe("فاتورةٌ تقرّ أنّها ضريبيّة", () => {
  it("إقرارُك يُدخل ما حكمت الآلةُ «لا تُخصم» لركنٍ لم يُقرأ — بضريبتها المقروءة", () => {
    const r = computeVatReturn({ invoices: [inv({ inputVatStatus: "NOT_ELIGIBLE", vatMinor: 2_480, choice: true })], txs: [] });
    expect(r.input.invoices).toEqual({ vatMinor: 2_480, count: 1, confirmed: { count: 1, vatMinor: 2_480, derivedCount: 0 } });
    expect(r.notDeductible.count).toBe(0);
  });
  it("وضريبتُها غير مقروءة: 15/115 من الإجمالي، ويُقال", () => {
    const r = computeVatReturn({ invoices: [inv({ inputVatStatus: "NOT_ELIGIBLE", vatMinor: null, totalMinor: 115_000, choice: true })], txs: [] });
    expect(r.input.invoices.confirmed).toEqual({ count: 1, vatMinor: 15_000, derivedCount: 1 });
  });
  it("ضريبةٌ قُرئت صفراً لا تُحسب ولو أقررت — لا شيء فيها يُخصم", () => {
    expect(invoiceIncluded(inv({ inputVatStatus: "NOT_ELIGIBLE", vatMinor: 0, choice: true }))).toBe(false);
  });
  it("«لا تحسبها» تُخرج المستوفية", () => {
    expect(invoiceIncluded(inv({ vatMinor: 100, choice: false }))).toBe(false);
    expect(invoiceIncluded(inv({ vatMinor: 100 }))).toBe(true);
  });
});
