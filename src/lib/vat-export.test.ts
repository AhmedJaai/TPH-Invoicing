import { describe, expect, it } from "vitest";
import { computeVatReturn } from "./vat-return";
import { buildVatSheets, type VatExportInvoice } from "./vat-export";
import { sheetsToWorkbook } from "./xlsx-sheets";

const invoice = (o: Partial<VatExportInvoice>): VatExportInvoice => ({
  number: "INV-1", day: "2026-08-10", supplier: "مورّد", sellerVat: "310000000000003", supplierVat: null,
  subtotalMinor: 10_000, vatMinor: 1_500, totalMinor: 11_500, vatUsedMinor: 1_500, included: true, choice: null,
  reasons: [], warnings: [], periodMonth: "2026-08", carriedFromMonth: null, ...o,
});

describe("سجلُّ الإقرار للمحاسب", () => {
  const invoices = [
    invoice({}),
    invoice({ number: "INV-2", vatMinor: null, subtotalMinor: null, vatUsedMinor: 1_500, choice: true }),
    invoice({ number: "INV-3", included: false, reasons: ["رقمُ المورّد الضريبيّ"] }),
  ];
  const result = computeVatReturn({
    invoices: [
      { id: "1", inputVatStatus: "ELIGIBLE", vatMinor: 1_500, totalMinor: 11_500, choice: null, subtotalMinor: 10_000 },
      { id: "2", inputVatStatus: "NOT_ELIGIBLE", vatMinor: null, totalMinor: 11_500, choice: true },
      { id: "3", inputVatStatus: "NOT_ELIGIBLE", vatMinor: 1_500, totalMinor: 11_500, choice: null },
    ],
    txs: [{ id: "s", direction: "CREDIT", category: "POS_SETTLEMENT", amountMinor: 115_000, choice: null, coveredByInvoice: false }],
  });
  const sheets = buildVatSheets({
    label: "الربع الثالث 2026", periodKey: "2026-Q3", generatedAt: "2026-10-07", result, invoices,
    txs: [{ day: "2026-08-01", label: "تسوية", categoryLabel: "تسوية الشبكة", direction: "CREDIT", category: "POS_SETTLEMENT", amountMinor: 115_000, vatMinor: 15_000, included: true, choice: null }],
    cash: [{ month: "2026-07", grossMinor: null }, { month: "2026-08", grossMinor: 2_300 }],
    filing: null,
  });
  const sheet = (name: string) => sheets.find((s) => s.name === name)!.rows;

  it("المحسوبةُ في ورقتها بسندها، وما لم يُخصم في ورقته بسببه", () => {
    expect(sheet("سجلّ المدخلات")).toHaveLength(3);
    expect(sheet("سجلّ المدخلات")[2][10]).toContain("15/115");
    expect(sheet("سجلّ المدخلات")[2][7]).toBe("غير معروف");
    expect(sheet("لم تُخصم")[1][11]).toContain("رقمُ المورّد الضريبيّ");
  });

  it("الملخّصُ يحمل صافي الصفحة نفسَه، والنقدُ المكتوب وحده في المخرجات", () => {
    const net = sheet("الملخّص").find((r) => typeof r[0] === "string" && r[0].startsWith("صافي الضريبة"))!;
    expect(net[2]).toEqual({ riyals: "120.00" });
    expect(sheet("سجلّ المخرجات")).toHaveLength(3);
  });

  it("الورقةُ الجدوليّة لها ترشيح، والمالُ خلايا عدديّة", () => {
    const wb = sheetsToWorkbook(sheets);
    const ws = wb.Sheets["سجلّ المدخلات"];
    expect(ws["!autofilter"]).toBeDefined();
    expect(ws["I2"]).toMatchObject({ t: "n", v: 115 });
    expect(wb.Sheets["الملخّص"]["!autofilter"]).toBeUndefined();
  });
});
