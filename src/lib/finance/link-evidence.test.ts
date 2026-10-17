import { describe, expect, it } from "vitest";
import { summariseEvidence, type EvidenceMatch } from "./link-evidence";

const m = (over: Partial<EvidenceMatch>): EvidenceMatch => ({
  supplierProductId: "sp1", productId: "guji", baseUnit: "G", invoiceQtyMilli: 5_000, foodicsBaseMilli: 5_000_000, ...over,
});

describe("دليل الربط من فودكس", () => {
  it("خمسة كيلو في فاتورتنا وخمسة آلاف جرام في فودكس: الوحدة ألف جرام", () => {
    const e = summariseEvidence([m({}), m({ invoiceQtyMilli: 2_000, foodicsBaseMilli: 2_000_000 })]).get("sp1");
    expect(e).toEqual({ productId: "guji", baseUnit: "G", matches: 2, contentQuantity: "1000" });
  });
  it("شواهد تختلف على الصنف لا يقترح منها شيء", () => {
    expect(summariseEvidence([m({}), m({ productId: "margo" })]).has("sp1")).toBe(false);
  });
  it("والغالب بأربعة من خمسة يقترح", () => {
    const e = summariseEvidence([m({}), m({}), m({}), m({}), m({ productId: "margo" })]).get("sp1");
    expect(e?.productId).toBe("guji");
    expect(e?.matches).toBe(4);
  });
  it("عبوة لم تتّفق عليها الشواهد تترك للإنسان", () => {
    const e = summariseEvidence([m({}), m({ foodicsBaseMilli: 2_500_000 })]).get("sp1");
    expect(e?.productId).toBe("guji");
    expect(e?.contentQuantity).toBeNull();
  });
  it("كمّيّة لم تقرأ: يقترح الصنف بلا عبوة", () => {
    expect(summariseEvidence([m({ invoiceQtyMilli: null })]).get("sp1")?.contentQuantity).toBeNull();
  });
  it("كسر في الوحدة يكتب بثلاث خانات", () => {
    expect(summariseEvidence([m({ invoiceQtyMilli: 2_000, foodicsBaseMilli: 3_500 })]).get("sp1")?.contentQuantity).toBe("1.75");
  });
});
