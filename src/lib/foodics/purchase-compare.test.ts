import { describe, expect, it } from "vitest";
import {
  comparePurchases, normaliseInvoiceNumber, suggestSupplierLinks,
  type InvoiceSide, type PurchaseSide,
} from "./purchase-compare";

function purchase(over: Partial<PurchaseSide> = {}): PurchaseSide {
  return {
    id: "p1", reference: "PUR-000001", businessDate: "2026-10-07", foodicsSupplierId: "fs1", foodicsSupplierName: "بُنساك",
    linkedSupplierId: null, invoiceNumber: "175629", invoiceDate: "2026-10-07", totalMinor: 154_986, ...over,
  };
}
function invoice(over: Partial<InvoiceSide> = {}): InvoiceSide {
  return { id: "i1", supplierId: "s1", supplierName: "Bonsack", invoiceNumber: "175629", day: "2026-10-07", totalMinor: 154_986, ...over };
}

describe("رقمُ الفاتورة بلا زخرفه", () => {
  it("الفواصلُ والأصفارُ الأولى لا تفرّق", () => {
    expect(normaliseInvoiceNumber("SI-0107")).toBe("si0107");
    expect(normaliseInvoiceNumber("00536")).toBe("536");
    expect(normaliseInvoiceNumber(" 536 ")).toBe("536");
    expect(normaliseInvoiceNumber(null)).toBe("");
  });
});

describe("مشترياتُ فودكس أمام فواتيرنا", () => {
  it("الرقمُ والمبلغُ نفسُهما ← متّفقان", () => {
    const r = comparePurchases([purchase()], [invoice()]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]).toMatchObject({ basis: "NUMBER", agrees: true, gapMinor: 0 });
    expect(r.onlyFoodics).toHaveLength(0);
  });

  it("الرقمُ نفسُه والمبلغُ مختلف ← يُعرَض الفرقُ ولا يُحسَم", () => {
    const r = comparePurchases([purchase({ totalMinor: 150_000 })], [invoice()]);
    expect(r.matched[0]).toMatchObject({ agrees: false, gapMinor: -4_986 });
  });

  it("«INV175629» و«INV/2026/175629» يلتقيان عند ذيل الأرقام حين يتّفق المبلغ", () => {
    const r = comparePurchases([purchase({ invoiceNumber: "INV175629" })], [invoice({ invoiceNumber: "INV/2026/175629" })]);
    expect(r.matched[0].basis).toBe("NUMBER_TAIL");
  });

  it("ذيلٌ قصير («003») لا يكفي بلا مورّدٍ مربوط ولا مبلغ", () => {
    const r = comparePurchases([purchase({ invoiceNumber: "A-003", totalMinor: 100 })], [invoice({ invoiceNumber: "B/003", totalMinor: 999 })]);
    expect(r.matched).toHaveLength(0);
    expect(r.onlyFoodics).toHaveLength(1);
  });

  it("بلا رقمٍ يجمعهما: المورّدُ المربوط والتاريخُ القريب والمبلغُ معاً", () => {
    const p = purchase({ invoiceNumber: "خطأ", linkedSupplierId: "s1", invoiceDate: "2026-10-05" });
    expect(comparePurchases([p], [invoice({ invoiceNumber: "X9" })]).matched[0].basis).toBe("SUPPLIER_DATE_AMOUNT");
    /* وبلا ربطٍ لا يُطابَق بالمبلغ وحده */
    expect(comparePurchases([{ ...p, linkedSupplierId: null }], [invoice({ invoiceNumber: "X9" })]).matched).toHaveLength(0);
    /* ولا بتاريخٍ بعيد */
    expect(comparePurchases([p], [invoice({ invoiceNumber: "X9", day: "2026-09-20" })]).matched).toHaveLength(0);
  });

  it("فاتورةٌ واحدة لا تُؤخَذ مرّتين — المكرَّرُ في فودكس يظهر زائداً", () => {
    const r = comparePurchases([purchase(), purchase({ id: "p2", reference: "PUR-000002" })], [invoice()]);
    expect(r.matched).toHaveLength(1);
    expect(r.onlyFoodics.map((p) => p.reference)).toEqual(["PUR-000002"]);
  });

  it("الرقمُ نفسُه عند مورّدين: يُقدَّم المورّدُ المربوط", () => {
    const r = comparePurchases(
      [purchase({ linkedSupplierId: "s2" })],
      [invoice({ id: "a", supplierId: "s1" }), invoice({ id: "b", supplierId: "s2" })],
    );
    expect(r.matched[0].invoice.id).toBe("b");
  });

  it("فاتورتُنا خارج فودكس تُسأل لمورّدٍ يتابعه وفي مدّته وحدها", () => {
    const r = comparePurchases(
      [purchase({ linkedSupplierId: "s1" })],
      [
        invoice(),
        invoice({ id: "late", invoiceNumber: "999999", day: "2026-10-09", totalMinor: 5_000 }),
        invoice({ id: "early", invoiceNumber: "111111", day: "2026-05-01", totalMinor: 5_000 }),
        invoice({ id: "other", supplierId: "equipment", invoiceNumber: "E-1", day: "2026-10-09", totalMinor: 1_160_000 }),
      ],
    );
    expect(r.onlyOurs.map((i) => i.id)).toEqual(["late"]);
    expect(r.outOfScope).toBe(2);
  });

  it("النتيجةُ لا تتغيّر بترتيب الصفوف", () => {
    const ps = [purchase(), purchase({ id: "p2", reference: "PUR-000002", totalMinor: 100 })];
    const is = [invoice(), invoice({ id: "i2", totalMinor: 100 })];
    const a = comparePurchases(ps, is).matched.map((m) => `${m.purchase.id}:${m.invoice.id}`).sort();
    const b = comparePurchases([...ps].reverse(), [...is].reverse()).matched.map((m) => `${m.purchase.id}:${m.invoice.id}`).sort();
    expect(a).toEqual(b);
  });
});

describe("اقتراحُ ربط المورّد من الفواتير لا من الاسم", () => {
  it("حركتان طابقتا مورّداً واحداً ← يُقترَح", () => {
    const r = comparePurchases(
      [purchase(), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "175630" })],
      [invoice(), invoice({ id: "i2", invoiceNumber: "175630" })],
    );
    expect(suggestSupplierLinks(r.matched)).toEqual([expect.objectContaining({ foodicsSupplierId: "fs1", supplierId: "s1", evidence: 2, against: 0 })]);
  });
  it("اسمٌ جامعٌ توزّعت حركاتُه على مورّدين ← لا اقتراح", () => {
    const r = comparePurchases(
      [purchase(), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "175630" })],
      [invoice(), invoice({ id: "i2", invoiceNumber: "175630", supplierId: "s2" })],
    );
    expect(suggestSupplierLinks(r.matched)).toEqual([]);
  });
  it("حركةٌ واحدة لا تكفي", () => {
    expect(suggestSupplierLinks(comparePurchases([purchase()], [invoice()]).matched)).toEqual([]);
  });
});
