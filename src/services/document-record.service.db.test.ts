import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, documents, invoices, users } from "@/db/schema";
import { RecordRefused, recordDocumentByHand } from "./document-record.service";
import { caught, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import type { Tx } from "./types";

/* رقمُ المنشأة الضريبيّ — يحكم به `reviewConfirmed` على رقم المشتري، ولا يُضبط في بيئة CI */
process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

const base = (documentId: string, supplierId: string) => ({
  documentId,
  kind: "TAX_INVOICE" as const,
  supplierId,
  invoiceNumber: "HAND-1",
  invoiceDate: "15/08/2026",
  subtotal: "1,000.00",
  vat: "١٥٠٫٠٠",
  total: "1150",
});

describe("قيدُ فاتورةٍ من مستندٍ بيد — «أكمِل الناقص»", () => {
  it("المعاينةُ تحكم ولا تكتب", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const d = await makeDocument(tx, s, "2026-08-10");
      const out = await recordDocumentByHand(await someone(tx), base(d, s), true, tx);
      expect(out.invoiceId).toBeNull();
      expect(out.totalMinor).toBe(1150_00);
      expect(out.month).toBe("2026-08");
      const rows = await tx.select().from(invoices).where(eq(invoices.documentId, d));
      expect(rows).toHaveLength(0);
    }));

  it("القيدُ بالمسار نفسه: الهللاتُ من النصّ، والتاريخُ موحَّد، والنوعُ والمورّدُ على المستند، وأثرٌ في السجلّ", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const d = await makeDocument(tx, s, "2026-08-10");
      await tx.update(documents).set({ kind: "QUOTATION", supplierId: null }).where(eq(documents.id, d));
      const who = await someone(tx);
      const out = await recordDocumentByHand(who, base(d, s), false, tx);
      expect(out.invoiceId).not.toBeNull();
      const [inv] = await tx.select().from(invoices).where(eq(invoices.documentId, d));
      expect(inv.totalMinor).toBe(1150_00);
      expect(inv.vatMinor).toBe(150_00);
      expect(inv.invoiceDate.toISOString().slice(0, 10)).toBe("2026-08-15");
      const [doc] = await tx.select({ kind: documents.kind, supplierId: documents.supplierId }).from(documents).where(eq(documents.id, d));
      expect(doc).toEqual({ kind: "TAX_INVOICE", supplierId: s });
      const log = await tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, d));
      expect(log.map((l) => l.action)).toContain("DOCUMENT_RECORDED_BY_HAND");
    }));

  it("لا يُقيَّد مرّتين، ولا فوق فاتورةٍ قائمة، ولا المرفوض", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const who = await someone(tx);
      const d = await makeDocument(tx, s, "2026-08-10");
      await recordDocumentByHand(who, base(d, s), false, tx);
      expect(await caught(recordDocumentByHand(who, base(d, s), false, tx))).toBeInstanceOf(RecordRefused);

      const rejected = await makeDocument(tx, s, "2026-08-10");
      await tx.update(documents).set({ status: "REJECTED" }).where(eq(documents.id, rejected));
      expect(await caught(recordDocumentByHand(who, base(rejected, s), false, tx))).toBeInstanceOf(RecordRefused);
    }));

  it("رقمٌ مسجَّلٌ للمورّد نفسه يمنع القيد ويُقال — لا يُكتب شيء", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const existing = await makeInvoice(tx, s, 500_00, "2026-08-01");
      const [e] = await tx.select({ n: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, existing));
      const d = await makeDocument(tx, s, "2026-08-10");
      const out = await recordDocumentByHand(await someone(tx), { ...base(d, s), invoiceNumber: e.n }, false, tx);
      expect(out.invoiceId).toBeNull();
      expect(out.review.blockers.length + out.review.findings.length).toBeGreaterThan(0);
    }));
});
