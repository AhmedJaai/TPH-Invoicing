import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { statementLines } from "@/db/schema";
import { day, makeDocument, makeSupplier, withRollback } from "@/test/db";
import { createInvoice, createStatement } from "./invoice.service";

describe("فاتورةٌ تصل بعد كشف مورّدها", () => {
  it("يُطابَق سطرُها في الكشف ويُحسَم تنبيهُ «اطلبها منه»", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const stDoc = await makeDocument(tx, s, "2026-09-30");
      await createStatement(tx, {
        documentId: stDoc, supplierId: s, periodEnd: day("2026-09-30"),
        openingBalanceMinor: null, closingBalanceMinor: null,
        lines: [{ date: day("2026-09-12"), ref: "INV-7781", description: "فاتورة", debitMinor: 575_00, creditMinor: 0 }],
      });
      const [{ id: statementId }] = (await tx.execute<{ id: string }>(sql`select id from statements where document_id = ${stDoc}`)).rows;
      await tx.execute(sql`
        insert into issues (id, code, severity, entity_type, entity_id, message)
        values (${`t-issue-${statementId}`}, 'INVOICE_IN_STATEMENT_NOT_ARCHIVED', 'WARN', 'statement', ${statementId},
                'فاتورة في كشف المورّد ولا ملف لها عندنا — اطلبها منه')
      `);

      const invDoc = await makeDocument(tx, s, "2026-09-12");
      const invoiceId = await createInvoice(tx, {
        documentId: invDoc, supplierId: s, invoiceNumber: "INV-7781", invoiceDate: day("2026-09-12"), periodMonth: "2026-09",
        subtotalMinor: 500_00, vatMinor: 75_00, totalMinor: 575_00, taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
      });

      const [line] = await tx.select({ inv: statementLines.matchedInvoiceId, st: statementLines.matchStatus })
        .from(statementLines).where(eq(statementLines.statementId, statementId));
      expect(line).toEqual({ inv: invoiceId, st: "MATCHED" });
      const [issue] = (await tx.execute<{ status: string }>(sql`
        select status::text from issues where entity_id = ${statementId} and code = 'INVOICE_IN_STATEMENT_NOT_ARCHIVED'
      `)).rows;
      expect(issue.status).toBe("RESOLVED");
    }));
});
