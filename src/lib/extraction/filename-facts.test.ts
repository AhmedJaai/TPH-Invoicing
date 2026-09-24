import { describe, expect, it } from "vitest";
import { factsFromFileName } from "./filename-facts";

describe("ما يقوله اسمُ الملفّ", () => {
  it("فاتورةُ أوراق الزيتون — الرقمُ بعد «فاتورة»", () => {
    expect(factsFromFileName("فاتورة - 260391 - مؤسسة ذا بوبليك هاوس.pdf").invoiceNumber).toBe("260391");
  });

  it("المحمصة الغربية — الرقمُ ملتصقٌ بـ«فاتورة»، وتاريخُ الطباعة لا يُؤخَذ", () => {
    const f = factsFromFileName("print_invoice_13_09_2026_15_13_22_فاتورة285558808.pdf");
    expect(f.invoiceNumber).toBe("285558808");
    expect(f.date).toBeNull();
  });

  it("اسمُ الأرشيف: تاريخٌ في أوّله، ورقمٌ بعد Invoice، ومبلغٌ بعد SAR", () => {
    expect(factsFromFileName("2026-09-9_WesternRoastery_Invoice_283872236_SAR845.25")).toEqual({
      invoiceNumber: "283872236",
      date: "2026-09-09",
      totalMinor: 84525,
    });
  });

  it("INV", () => {
    expect(factsFromFileName("INV-00420.pdf").invoiceNumber).toBe("00420");
  });

  it("ولا يُؤخَذ رقمٌ لأنّه رقم", () => {
    expect(factsFromFileName("statement-43 (4).pdf")).toEqual({ invoiceNumber: null, date: null, totalMinor: null });
    expect(factsFromFileName("310660311700003_20260921T235128_B07-2026-17328.pdf").invoiceNumber).toBeNull();
  });
});
