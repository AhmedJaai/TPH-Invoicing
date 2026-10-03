import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { caught, day, makeDocument, makeSupplier, withRollback } from "@/test/db";
import { documents, invoices, paymentAllocations, payments, users } from "@/db/schema";
import { createInvoice } from "./invoice.service";
import { ReplaceRefused, replaceWithCorrectedInvoice } from "./invoice-replace.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `rep-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/* أوراق الزيتون: 260340 قُيِّدت ١٤٠، وأُعيد إصدارُها ١٣٠ */
async function setup(tx: Tx, readTotal: string) {
  const s = await makeSupplier(tx);
  const oldDoc = await makeDocument(tx, s, "2026-09-01");
  const invoiceId = (await createInvoice(tx, {
    documentId: oldDoc, supplierId: s, invoiceNumber: "260340", invoiceDate: day("2026-09-01"), periodMonth: "2026-09",
    subtotalMinor: 140_00, vatMinor: 0, totalMinor: 140_00, taxStatus: "INVALID", inputVatStatus: "NOT_ELIGIBLE", isFixedAsset: false,
  }))!;
  const newDoc = await makeDocument(tx, s, "2026-09-01");
  await tx.update(documents).set({
    status: "NEEDS_REVIEW",
    extractionJson: { invoiceNumber: "260340", invoiceDate: "2026-09-01", subtotalAmount: readTotal, vatAmount: "0", totalAmount: readTotal, lines: [] } as never,
  }).where(eq(documents.id, newDoc));
  return { s, oldDoc, newDoc, invoiceId };
}

describe("فاتورةٌ مصحَّحة تحلّ محلّ المقيَّدة", () => {
  it("القيدُ نفسُه ينتقل إلى الملفّ الجديد بمبلغه، والقديمُ يُرفض", () =>
    withRollback(async (tx) => {
      const { oldDoc, newDoc, invoiceId } = await setup(tx, "130.00");
      const out = await replaceWithCorrectedInvoice(tx, newDoc, await someone(tx));
      expect(out).toMatchObject({ invoiceId, beforeMinor: 140_00, afterMinor: 130_00, releasedMinor: 0 });
      const [inv] = await tx.select({ doc: invoices.documentId, total: invoices.totalMinor }).from(invoices).where(eq(invoices.id, invoiceId));
      expect(inv).toEqual({ doc: newDoc, total: 130_00 });
      const st = await tx.select({ id: documents.id, s: documents.status }).from(documents).where(eq(documents.id, oldDoc));
      expect(st[0].s).toBe("REJECTED");
      expect((await tx.select({ s: documents.status }).from(documents).where(eq(documents.id, newDoc)))[0].s).toBe("ARCHIVED");
    }));

  it("ما سُدِّد فوق المبلغ الجديد يعود رصيداً للمورّد", () =>
    withRollback(async (tx) => {
      const { s, newDoc, invoiceId } = await setup(tx, "130.00");
      const [p] = await tx.insert(payments).values({ supplierId: s, paidAt: day("2026-09-03"), amountMinor: 140_00, status: "APPLIED" }).returning({ id: payments.id });
      await tx.insert(paymentAllocations).values({ paymentId: p.id, invoiceId, amountMinor: 140_00 });
      const out = await replaceWithCorrectedInvoice(tx, newDoc, await someone(tx));
      expect(out.releasedMinor).toBe(10_00);
      const allocs = await tx.select({ a: paymentAllocations.amountMinor }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, p.id));
      expect(allocs.reduce((x, r) => x + r.a, 0)).toBe(130_00);
    }));

  it("والمبلغُ نفسُه نسخةٌ لا تصحيح — يُرفض الاستبدال", () =>
    withRollback(async (tx) => {
      const { newDoc } = await setup(tx, "140.00");
      expect(await caught(replaceWithCorrectedInvoice(tx, newDoc, await someone(tx)))).toBeInstanceOf(ReplaceRefused);
    }));
});
