import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { day, makeDocument, makeSupplier, withRollback } from "@/test/db";
import { documents, invoices, statementLines, statements, users } from "@/db/schema";
import { createInvoice } from "./invoice.service";
import { recordStatementOnlyInvoices, statementRefNumber } from "./statement-invoices.service";
import { loadRecordedInvoices } from "./document-backlog.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `st-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function statementWith(tx: Tx, supplierId: string, lines: { date: string; ref: string | null; debit: number; credit?: number; status?: "UNMATCHED" | "IGNORED" }[]) {
  const doc = await makeDocument(tx, supplierId, "2026-09-30");
  const [st] = await tx.insert(statements).values({
    documentId: doc, supplierId, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    openingBalanceMinor: null, closingBalanceMinor: null,
  }).returning({ id: statements.id });
  for (const l of lines) {
    await tx.insert(statementLines).values({
      statementId: st.id, date: day(l.date), ref: l.ref, description: null,
      debitMinor: l.debit, creditMinor: l.credit ?? 0, matchStatus: l.status ?? "UNMATCHED",
    });
  }
  return st.id;
}

describe("قيدُ الناقصة من كشف المورّد (غاناش)", () => {
  it("يُقيَّد كلُّ سطرٍ مدينٍ لم يُطابَق — بلا صافٍ ولا ضريبة، ويُطابَق السطرُ بها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const st = await statementWith(tx, s, [
        { date: "2026-09-02", ref: "CIV-1 (Abhur - 1", debit: 533_60 },
        { date: "2026-09-04", ref: "CIV-2", debit: 455_40 },
        { date: "2026-09-03", ref: null, debit: 0, credit: 989_00, status: "IGNORED" },
      ]);
      const out = await recordStatementOnlyInvoices(tx, st, await someone(tx));
      expect(out.created.map((c) => c.number)).toEqual(["CIV-1", "CIV-2"]);
      const rows = await tx.select({ n: invoices.invoiceNumber, sub: invoices.subtotalMinor, tax: invoices.inputVatStatus, origin: documents.origin, file: documents.driveFileId })
        .from(invoices).innerJoin(documents, eq(documents.id, invoices.documentId)).where(eq(invoices.supplierId, s));
      expect(rows.every((r) => r.sub === null && r.tax === "NOT_ELIGIBLE" && r.origin === "STATEMENT_LINE" && r.file === null)).toBe(true);
      const lines = await tx.select({ m: statementLines.matchStatus }).from(statementLines).where(eq(statementLines.statementId, st));
      expect(lines.filter((l) => l.m === "MATCHED")).toHaveLength(2);

      /* ومرّةً ثانية لا يُقيَّد شيء */
      expect((await recordStatementOnlyInvoices(tx, st, await someone(tx))).created).toHaveLength(0);
    }));

  it("ملفُّها حين يصل يتبنّى القيدَ نفسَه — لا فاتورتان، ولا يُحسب «مكرّرة»", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const st = await statementWith(tx, s, [{ date: "2026-09-02", ref: "CIV-9", debit: 115_00 }]);
      await recordStatementOnlyInvoices(tx, st, await someone(tx));
      const [before] = await tx.select({ id: invoices.id, doc: invoices.documentId }).from(invoices).where(eq(invoices.supplierId, s));
      expect((await loadRecordedInvoices(tx)).some((r) => r.supplierId === s)).toBe(false);

      const realDoc = await makeDocument(tx, s, "2026-09-02");
      const id = await createInvoice(tx, {
        documentId: realDoc, supplierId: s, invoiceNumber: "civ 9", invoiceDate: day("2026-09-02"), periodMonth: "2026-09",
        subtotalMinor: 100_00, vatMinor: 15_00, totalMinor: 115_00, sellerVat: "310111111100003", buyerVat: "310007971600003",
        taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
      });
      expect(id).toBe(before.id);
      const all = await tx.select({ doc: invoices.documentId, tax: invoices.inputVatStatus }).from(invoices).where(eq(invoices.supplierId, s));
      expect(all).toEqual([{ doc: realDoc, tax: "ELIGIBLE" }]);
      expect(await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, before.doc))).toHaveLength(0);
    }));

  it("سطرٌ رقمُه داخل فاتورةٍ جامعة عندنا لا يُقيَّد ثانية (هنقري مان)", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const doc = await makeDocument(tx, s, "2026-05-01");
      await createInvoice(tx, {
        documentId: doc, supplierId: s, invoiceNumber: "INVA-02527-02717-02751-02781", invoiceDate: day("2026-05-01"), periodMonth: "2026-05",
        subtotalMinor: null, vatMinor: null, totalMinor: 240_00, taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN", isFixedAsset: false,
      });
      const st = await statementWith(tx, s, [
        { date: "2026-05-25", ref: "INVA/2026/02717 (Abhur - 001578", debit: 80_00 },
        { date: "2026-06-04", ref: "INVA/2026/02849", debit: 80_00 },
      ]);
      const out = await recordStatementOnlyInvoices(tx, st, await someone(tx));
      expect(out.created.map((c) => c.number)).toEqual(["INVA/2026/02849"]);
      const lines = await tx.select({ ref: statementLines.ref, m: statementLines.matchStatus }).from(statementLines).where(eq(statementLines.statementId, st));
      expect(lines.every((l) => l.m === "MATCHED")).toBe(true);
    }));

  it("رقمُ السطر بلا وصف الفرع", () => {
    expect(statementRefNumber("INVA/2026/02717 (Abhur - 001578")).toBe("INVA/2026/02717");
  });
});
