import { describe, expect, it } from "vitest";
import { day, makeDocument, makeSupplier, withRollback } from "@/test/db";
import { createInvoice, createStatement } from "./invoice.service";
import { latestStatementDiscrepancies } from "./statement-reconcile.service";

/*
  أفال (٢٣ نوفمبر ٢٠٢٦): كشفُ ٢٥ أكتوبر يبدأ من ١٢ أغسطس (سطرُ الإشعار الدائن) ويذكر المفتوحَ وحده،
  فكانت صفحةُ المورّد تقول «ثماني فواتير عندنا لم ترد في كشفه» (١٢٬٢٨٩٫٤٨) — وكلُّها في كشفَي
  أغسطس وسبتمبر، مسدَّدةٌ بحوالتين طابقتا البنك.
*/
describe("«عندنا ولم ترد في كشفه» لا تشمل ما ورد في كشفٍ سابقٍ للمورّد نفسه", () => {
  it("فاتورةٌ طابقها كشفٌ أقدم لا تُعدّ غائبةً عن الأحدث، وغيرُها يبقى", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const invoice = async (num: string, d: string, total: number) => createInvoice(tx, {
        documentId: await makeDocument(tx, s, d), supplierId: s, invoiceNumber: num, invoiceDate: day(d), periodMonth: d.slice(0, 7),
        subtotalMinor: Math.round(total / 1.15), vatMinor: total - Math.round(total / 1.15), totalMinor: total,
        taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
      });
      await invoice("INV/2026/00124", "2026-09-02", 1_151_15);
      await invoice("INV/2026/00150", "2026-09-15", 700_00);
      await invoice("INV/2026/00167", "2026-09-27", 1_454_75);
      await invoice("INV/2026/00179", "2026-10-04", 1_831_09);
      await invoice("INV/2026/00202", "2026-10-25", 1_454_75);

      await createStatement(tx, {
        documentId: await makeDocument(tx, s, "2026-09-27"), supplierId: s,
        periodEnd: day("2026-09-27"), openingBalanceMinor: null, closingBalanceMinor: null,
        lines: [
          { date: day("2026-09-02"), ref: "INV/2026/00124", description: null, debitMinor: 1_151_15, creditMinor: 0 },
          { date: day("2026-09-27"), ref: "INV/2026/00167", description: null, debitMinor: 1_454_75, creditMinor: 0 },
        ],
      });
      await createStatement(tx, {
        documentId: await makeDocument(tx, s, "2026-10-25"), supplierId: s,
        periodEnd: day("2026-10-25"), openingBalanceMinor: null, closingBalanceMinor: null,
        lines: [
          { date: day("2026-08-12"), ref: "RINV/2026/00016 (Reversal of: INV/2026/00080)", description: "مستحق", debitMinor: 0, creditMinor: 1_998_70 },
          { date: day("2026-10-04"), ref: "INV/2026/00179", description: null, debitMinor: 1_831_09, creditMinor: 0 },
          { date: day("2026-10-25"), ref: "INV/2026/00202", description: null, debitMinor: 1_454_75, creditMinor: 0 },
        ],
      });

      const why = await latestStatementDiscrepancies(s, tx);
      expect(why?.periodEnd).toBe("2026-10-25");
      expect(why?.notInStatement.map((n) => n.invoiceNumber)).toEqual(["INV/2026/00150"]);
    }));
});
