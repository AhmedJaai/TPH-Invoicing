import { describe, expect, it } from "vitest";
import {
  computeVatReturn, filingDeadline, isIncluded, monthsBefore, nextQuarter, parseVatPeriod, periodBounds, periodKey, periodMonths,
  invoiceIncluded, previousQuarter, quarterOfMonth, txBlocked, txCaution, txVat, vatInsideGross, vatOnNet, type VatInvoice, type VatTx,
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
    expect(r.output).toEqual({ grossMinor: 1_150_000, vatMinor: 150_000, count: 4, cashGrossMinor: 0, netMinor: 1_000_000 });
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

describe("ما لا يُضمّ مهما اختير", () => {
  it("راتبٌ وزكاةٌ وتحويلٌ شخصيّ وحركةٌ داخليّة: لا تُضمّ من نفسها، وتُضمّ باختيار صاحبها — بتنبيهٍ لا بمنع", () => {
    for (const category of ["SALARY", "ZAKAT", "PERSONAL", "INTERNAL"]) {
      expect(isIncluded(tx({ direction: "DEBIT", category, amountMinor: 115_000 })), category).toBe(false);
      const chosen = tx({ direction: "DEBIT", category, amountMinor: 115_000, choice: true });
      expect(txBlocked(chosen), category).toBeNull();
      expect(txCaution(chosen), category).not.toBeNull();
      expect(isIncluded(chosen), category).toBe(true);
    }
    /* حوالةٌ «شخصيّة» هي شراءٌ دُفع من الحساب: اختيارُها يدخل الخصم 15/115 */
    const r = computeVatReturn({ invoices: [], txs: [tx({ direction: "DEBIT", category: "PERSONAL", amountMinor: 115_000, choice: true })] });
    expect(r.input.totalMinor).toBe(15_000);
    expect(txCaution(tx({ direction: "DEBIT", category: "RENT" }))).toBeNull();
  });
  it("والإيجارُ والحكوميّ يُضمّان باختيار", () => {
    expect(txBlocked(tx({ direction: "DEBIT", category: "RENT" }))).toBeNull();
    expect(txBlocked(tx({ direction: "DEBIT", category: "GOVERNMENT" }))).toBeNull();
  });
  it("حوالةٌ ارتدّت وعودتُها: لا مدخلاتٍ ولا مبيعات", () => {
    expect(isIncluded(tx({ direction: "DEBIT", category: "SUPPLIER", choice: true, bounced: true }))).toBe(false);
    expect(isIncluded(tx({ direction: "CREDIT", category: "SUPPLIER", choice: true, bounced: true }))).toBe(false);
  });
});

describe("فاتورةٌ تنتظر المراجعة", () => {
  it("قراءةُ نموذجٍ لم يُقرّها أحد لا يحكم لها حكمُ الآلة", () => {
    expect(invoiceIncluded(inv({ vatMinor: 1_500, awaitingReview: true }))).toBe(false);
    expect(invoiceIncluded(inv({ vatMinor: 1_500, awaitingReview: false }))).toBe(true);
  });
  it("وإقرارُ صاحبها يُدخلها — ويُعدّ «بإقرارك»", () => {
    const r = computeVatReturn({ invoices: [inv({ vatMinor: 1_500, awaitingReview: true, choice: true })], txs: [] });
    expect(r.input.invoices.confirmed.count).toBe(1);
    expect(r.input.invoices.vatMinor).toBe(1_500);
  });
});

describe("النقدُ والرصيدُ المرحَّل والوعاء", () => {
  it("نقدٌ لم يُودَع يدخل المخرجات، والتقريبُ على مجموعه مع البنك", () => {
    const r = computeVatReturn({ invoices: [], txs: [tx({ amountMinor: 100 })], cashSalesGrossMinor: 100 });
    /* 200 × 15/115 = 26.09 — لا 13 + 13 */
    expect(r.output.vatMinor).toBe(26);
    expect(r.output.grossMinor).toBe(100);
    expect(r.output.cashGrossMinor).toBe(100);
    expect(r.output.netMinor).toBe(174);
    expect(r.netMinor).toBe(26);
  });
  it("رصيدٌ دائنٌ مرحَّل يُنقص المستحقّ", () => {
    const r = computeVatReturn({ invoices: [], txs: [tx({ amountMinor: 1_150_000 })], carriedInMinor: 20_000 });
    expect(r.carriedInMinor).toBe(20_000);
    expect(r.netMinor).toBe(130_000);
  });
  it("وعاءُ المشتريات: الصافي المقروء، وإلّا الإجماليّ ناقصاً الضريبة، ووعاءُ ضريبة الرسوم 100/15 منها", () => {
    const r = computeVatReturn({
      invoices: [
        inv({ id: "a", vatMinor: 1_500, totalMinor: 14_000, subtotalMinor: 10_000 }),
        inv({ id: "b", vatMinor: 1_500, totalMinor: 11_500 }),
      ],
      txs: [
        tx({ direction: "DEBIT", category: "POS_VAT", amountMinor: 150 }),
        tx({ direction: "DEBIT", category: "RENT", amountMinor: 115_000, choice: true }),
      ],
    });
    expect(r.input.baseMinor).toBe(10_000 + 10_000 + 1_000 + 100_000);
  });
  it("ما قُرئت ضريبتُه صفراً يُعدّ «مشترياتٍ بلا ضريبة» بإجماليّه", () => {
    const r = computeVatReturn({ invoices: [inv({ vatMinor: 0, totalMinor: 5_000 }), inv({ id: "b", vatMinor: 150 })], txs: [] });
    expect(r.zeroRated).toEqual({ count: 1, totalMinor: 5_000 });
  });
  it("١٥٪ من الصافي ضربٌ صحيح", () => {
    expect(vatOnNet(57_400)).toBe(8_610);
    expect(vatOnNet(1)).toBe(0);
    expect(vatOnNet(10)).toBe(2);
  });
});

describe("خصائصُ الفترة والحساب", () => {
  it("كلُّ يومٍ في السنة يقع في ربعٍ واحدٍ بالضبط", () => {
    const quarters = [1, 2, 3, 4].map((q) => periodBounds(parseVatPeriod(`2028-Q${q}`)!));
    for (let d = Date.UTC(2028, 0, 1); d < Date.UTC(2029, 0, 1); d += 86_400_000) {
      const day = new Date(d).toISOString().slice(0, 10);
      expect(quarters.filter((b) => day >= b.from && day < b.until).length, day).toBe(1);
      const own = periodBounds(quarterOfMonth(day.slice(0, 7)));
      expect(day >= own.from && day < own.until, day).toBe(true);
    }
  });
  it("التالي والسابق متعاكسان، والأشهرُ السابقة تعبر السنة", () => {
    for (const key of ["2026-Q1", "2026-Q4", "2027-Q2"]) {
      const q = quarterOfMonth(periodMonths(parseVatPeriod(key)!)[0]);
      expect(periodKey(previousQuarter(nextQuarter(q)))).toBe(key);
    }
    expect(monthsBefore("2026-02", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthsBefore("2026-07", 3)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
  it("الصافي لا يتغيّر بترتيب الحركات، والاختيارُ ثمّ إعادتُه يعيد الرقم", () => {
    const txs = [
      tx({ id: "1", amountMinor: 333 }), tx({ id: "2", amountMinor: 777 }),
      tx({ id: "3", direction: "DEBIT", category: "RENT", amountMinor: 4_750_001, choice: true }),
      tx({ id: "4", direction: "DEBIT", category: "POS_VAT", amountMinor: 17 }),
      tx({ id: "5", direction: "DEBIT", category: "UTILITY", amountMinor: 99_999 }),
    ];
    const invoices = [inv({ id: "a", vatMinor: 1_234 }), inv({ id: "b", vatMinor: null, inputVatStatus: "UNKNOWN" })];
    const base = computeVatReturn({ invoices, txs });
    expect(computeVatReturn({ invoices: [...invoices].reverse(), txs: [...txs].reverse() }).netMinor).toBe(base.netMinor);
    const chosen = txs.map((t) => (t.id === "5" ? { ...t, choice: true } : t));
    expect(computeVatReturn({ invoices, txs: chosen }).netMinor).not.toBe(base.netMinor);
    expect(computeVatReturn({ invoices, txs: chosen.map((t) => (t.id === "5" ? { ...t, choice: null } : t)) }).netMinor).toBe(base.netMinor);
    expect(base.input.totalMinor).toBe(base.input.invoices.vatMinor + base.input.bankVat.vatMinor + base.input.selected.vatMinor);
  });
});
