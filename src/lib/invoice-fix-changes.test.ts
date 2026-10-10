import { describe, expect, it } from "vitest";
import { changesLine, fixChanges, type FixFields } from "./invoice-fix-changes";

const base: FixFields = {
  invoiceNumber: "INV-1", sellerVat: "310000000000003", buyerVat: "", subtotal: "1000.00", vat: "150.00", total: "1150.00",
  discount: "", charges: "", invoiceDate: "2026-09-01", supplierId: "s1",
};

describe("تصحيحُ الفاتورة: قبل ← بعد", () => {
  it("لا تغييرَ ← لا شيء يُقال", () => {
    expect(fixChanges(base, { ...base })).toEqual([]);
  });

  it("المبلغُ المتغيّر يُقال بصيغة العرض من وإلى", () => {
    const c = fixChanges(base, { ...base, total: "1050", vat: "50" });
    expect(changesLine(c)).toBe("الضريبة: 150.00 ← 50.00 · الإجماليّ: 1,150.00 ← 1,050.00");
  });

  it("المبلغُ نفسه بكتابةٍ أخرى ليس تغييراً", () => {
    expect(fixChanges(base, { ...base, total: "1,150", subtotal: "1000" })).toEqual([]);
  });

  it("الفارغُ ليس صفراً: «لا خصم» ← «0» تغييرٌ يُقال", () => {
    const c = fixChanges(base, { ...base, discount: "0" });
    expect(c).toEqual([{ field: "discount", label: "الخصم", before: "فارغ", after: "0.00" }]);
  });

  it("المورّدُ يُسمّى باسمه لا بمعرّفه", () => {
    const c = fixChanges(base, { ...base, supplierId: "s2" }, (id) => ({ s1: "المراعي", s2: "بيكوف" })[id] ?? null);
    expect(changesLine(c)).toBe("المورّد: المراعي ← بيكوف");
  });

  it("مبلغٌ لا يُقرأ يُعرَض كما كُتب ولا يُخفى", () => {
    const c = fixChanges(base, { ...base, total: "abc" });
    expect(c[0]).toMatchObject({ before: "1,150.00", after: "abc" });
  });
});
