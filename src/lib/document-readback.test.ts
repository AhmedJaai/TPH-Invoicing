import { describe, expect, it } from "vitest";
import { readback, readbackSummary, type ReadbackInput } from "./document-readback";

const base: ReadbackInput = {
  reading: {
    kind: "TAX_INVOICE",
    supplierName: "مورّد تجريبي",
    sellerVat: "300000000000003",
    invoiceNumber: "INV-0042",
    invoiceDate: "13/09/2026",
    subtotal: "100.00",
    vat: "15.00",
    total: "115.00",
    lineCount: 2,
  },
  recorded: {
    kind: "TAX_INVOICE",
    supplierName: "مورّد تجريبي",
    invoice: { number: "INV0042", date: "2026-09-13", subtotalMinor: 10000, vatMinor: 1500, totalMinor: 11500 },
  },
  confidence: { amounts: 0.95, invoiceDate: 0.6, invoiceNumber: 0.9 },
  kindLabel: (k) => (k === "TAX_INVOICE" ? "فاتورة ضريبية" : k),
  showAmounts: true,
};

const by = (rows: ReturnType<typeof readback>, f: string) => rows.find((r) => r.field === f)!;

describe("readback — المقروء بجانب المسجَّل", () => {
  it("يطابق الرقمَ بأيّ صيغة، والتاريخَ المطبوع بيومه، والمالَ بالهللات", () => {
    const rows = readback(base);
    expect(by(rows, "number").match).toBe("same");
    expect(by(rows, "date").match).toBe("same");
    expect(by(rows, "total").match).toBe("same");
    expect(by(rows, "total").recorded).toBe("115.00");
  });

  it("يقول «تغيّر» حين سُجّل مبلغٌ غيرُ المقروء", () => {
    const rows = readback({ ...base, recorded: { ...base.recorded, invoice: { ...base.recorded.invoice!, totalMinor: 11600 } } });
    expect(by(rows, "total").match).toBe("changed");
    expect(readbackSummary(rows).changed).toBe(1);
  });

  it("الثقةُ لكلّ حقل من مفتاحها، والمجهولةُ لا تُحسب جيّدة", () => {
    const rows = readback(base);
    expect(by(rows, "date").trust).toBe("low");
    expect(by(rows, "vat").trust).toBe("ok");
    expect(by(rows, "supplier").trust).toBe("unknown");
    expect(readbackSummary(rows).low).toBe(1);
    expect(readbackSummary(readback({ ...base, confidence: null })).unknownTrust).toBe(true);
  });

  it("بلا فاتورة: لا مقارنة، ولا صفر مكان المسجَّل", () => {
    const rows = readback({ ...base, recorded: { ...base.recorded, invoice: null } });
    expect(by(rows, "total").match).toBe("unrecorded");
    expect(by(rows, "total").recorded).toBeNull();
  });

  it("ما لم يُقرأ وسُجّل يُقال «لم يُقرأ» لا «تغيّر»", () => {
    const rows = readback({ ...base, reading: { ...base.reading!, vat: null } });
    expect(by(rows, "vat").match).toBe("unread");
  });

  it("من لا يرى المبالغ لا تصله صفوفُها", () => {
    const rows = readback({ ...base, showAmounts: false });
    expect(rows.some((r) => r.money)).toBe(false);
  });
});
