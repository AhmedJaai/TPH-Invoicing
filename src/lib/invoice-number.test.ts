import { describe, expect, it } from "vitest";
import { normalizeInvoiceNumber, sameInvoiceNumber, unreverseInvoiceNumber } from "./invoice-number";

describe("normalizeInvoiceNumber", () => {
  it("يُسقط الأصفار البادئة — «04» هي «4» (صورة ثانية للافا)", () => {
    expect(sameInvoiceNumber("04", "4")).toBe(true);
    expect(sameInvoiceNumber("003", "3")).toBe(true);
  });

  it("الفواصل حدٌّ واحد", () => {
    expect(sameInvoiceNumber("INV/2026/00124", "INV-2026-124")).toBe(true);
    expect(sameInvoiceNumber("CIV 008504960", "CIV-008504960")).toBe(true);
  });

  it("الحرف والرقم المتلاصقان مقطعان", () => {
    expect(sameInvoiceNumber("SI0051", "SI-0051")).toBe(true);
  });

  it("الأرقام العربية لاتينيّة", () => {
    expect(sameInvoiceNumber("٠٠٤٢٠", "00420")).toBe(true);
  });

  it("رقمان مختلفان يبقيان مختلفين", () => {
    expect(sameInvoiceNumber("00420", "00421")).toBe(false);
    expect(sameInvoiceNumber("SI-0051", "SI-0057")).toBe(false);
    expect(sameInvoiceNumber("INV-2026-124", "INV-2025-124")).toBe(false);
  });

  it("الفارغ لا يساوي الفارغ", () => {
    expect(sameInvoiceNumber("", "")).toBe(false);
    expect(sameInvoiceNumber(null, undefined)).toBe(false);
    expect(normalizeInvoiceNumber("  -/ ")).toBe("");
  });

  it("الصفر وحده يبقى صفراً", () => {
    expect(normalizeInvoiceNumber("000")).toBe("0");
  });
});

describe("الرقمُ المقلوب من سطرٍ يمينيّ", () => {
  it("«0059-SI» هو «SI-0059»، وما سواه لا يُمسّ", () => {
    expect(unreverseInvoiceNumber("0059-SI")).toBe("SI-0059");
    expect(sameInvoiceNumber("0059-SI", "SI-0059")).toBe(true);
    expect(unreverseInvoiceNumber("INV/2026/00124")).toBe("INV/2026/00124");
    expect(unreverseInvoiceNumber("260410")).toBe("260410");
    expect(unreverseInvoiceNumber("2026-INV-5")).toBe("2026-INV-5");
  });
});
