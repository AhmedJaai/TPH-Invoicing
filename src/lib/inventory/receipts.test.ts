import { describe, expect, it } from "vitest";
import { daysApart, duplicateCandidates, type InvoiceLineForMatch } from "./receipts";

const R = { id: "r1", productId: "coffee", receivedOn: "2026-09-18", canonicalMilli: 20_000_000 };

function line(over: Partial<InvoiceLineForMatch> = {}): InvoiceLineForMatch {
  return {
    lineId: "il-1", invoiceId: "inv-1", invoiceNumber: "A-1", supplierName: "محمصة",
    productId: "coffee", effectiveDate: "2026-09-20", canonicalMilli: 20_000_000, lineTotalMinor: 1760_00,
    ...over,
  };
}

describe("الاستلامُ الواحد لا يُحسَب مرّتين", () => {
  it("بندٌ بالكمّيّة نفسِها بعد يومين — مرشَّحٌ للتكرار", () => {
    const c = duplicateCandidates(R, [line()], new Set());
    expect(c).toHaveLength(1);
    expect(c[0].basis).toBe("SAME_QUANTITY");
  });

  it("وبندٌ مجهولُ الكمّيّة أوّلُ ما يُشتبَه فيه", () => {
    const c = duplicateCandidates(R, [line({ canonicalMilli: null })], new Set());
    expect(c[0].basis).toBe("UNKNOWN_QUANTITY");
  });

  it("والكمّيّةُ المختلفة شحنةٌ أخرى — لا تنبيهَ يصيح في كلّ شحنة", () => {
    expect(duplicateCandidates(R, [line({ canonicalMilli: 18_000_000 })], new Set())).toEqual([]);
  });

  it("ولا شَبَهَ بعد سبعة أيّام ولا في صنفٍ آخر", () => {
    expect(duplicateCandidates(R, [line({ effectiveDate: "2026-09-26" })], new Set())).toEqual([]);
    expect(duplicateCandidates(R, [line({ productId: "milk" })], new Set())).toEqual([]);
    expect(duplicateCandidates(R, [line({ effectiveDate: "2026-09-25" })], new Set())).toHaveLength(1);
  });

  it("والبندُ المرتبطُ باستلامٍ آخر لا يُرشَّح ثانية", () => {
    expect(duplicateCandidates(R, [line()], new Set(["il-1"]))).toEqual([]);
  });

  it("والأقربُ تاريخاً أوّلاً", () => {
    const c = duplicateCandidates(R, [
      line({ lineId: "far", effectiveDate: "2026-09-24" }),
      line({ lineId: "near", effectiveDate: "2026-09-17" }),
    ], new Set());
    expect(c.map((x) => x.invoiceLineId)).toEqual(["near", "far"]);
  });

  it("والفرقُ بالأيّام بلا منطقةٍ زمنيّة", () => {
    expect(daysApart("2026-09-18", "2026-09-20")).toBe(2);
    expect(daysApart("2026-02-28", "2026-03-01")).toBe(1);
  });
});
