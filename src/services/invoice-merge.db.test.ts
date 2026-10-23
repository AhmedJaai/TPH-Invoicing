import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { documents, invoices, paymentAllocations, payments, users } from "@/db/schema";
import { MergeRefused, mergeDuplicateInvoice } from "./invoice-merge.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `merge-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function pay(tx: Tx, supplierId: string, invoiceId: string, amountMinor: number, paidAt: string, allocated = amountMinor) {
  const [p] = await tx.insert(payments).values({ supplierId, paidAt: day(paidAt), amountMinor, status: "APPLIED" }).returning({ id: payments.id });
  await tx.insert(paymentAllocations).values({ paymentId: p.id, invoiceId, amountMinor: allocated });
  return p.id;
}

/*
  غاناش ١٤ أغسطس: CIV-008599396 قُيِّدت من ملفّها وسُدّدت، ثمّ رُفعت صورتُها فقُرئت
  CIV-008593996 وقُيِّدت ثانيةً، وخصم لها الرصيدُ الآليّ من حوالةٍ أخرى.
*/
async function setup(tx: Tx) {
  const s = await makeSupplier(tx);
  const older = await makeInvoice(tx, s, 455_40, "2026-08-14");
  const newer = await makeInvoice(tx, s, 455_40, "2026-08-14");
  await tx.update(invoices).set({ createdAt: day("2026-09-08") }).where(eq(invoices.id, older));
  await tx.update(invoices).set({ createdAt: day("2026-10-23") }).where(eq(invoices.id, newer));
  const p1 = await pay(tx, s, older, 455_40, "2026-09-02");
  const p2 = await pay(tx, s, newer, 1_000_00, "2026-09-20", 41_40);
  const docOf = async (id: string) => (await tx.select({ d: invoices.documentId }).from(invoices).where(eq(invoices.id, id)))[0].d;
  return { s, older, newer, p1, p2, olderDoc: await docOf(older), newerDoc: await docOf(newer) };
}

describe("دمج فاتورتين مكرّرتين", () => {
  it("يبقى القيد الأقدم بسداده أيّاً كانت الصفحة، ويعود ما خُصّص للأحدث رصيداً", () =>
    withRollback(async (tx) => {
      const { older, newer, p1, p2, olderDoc, newerDoc } = await setup(tx);
      /* من صفحة الأحدث، والملفُّ ملفُّ الأقدم */
      const out = await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, actorId: await someone(tx) });
      expect(out).toMatchObject({ keptId: older, releasedMinor: 41_40 });

      expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, newer))).toHaveLength(0);
      const kept = await tx.select({ a: paymentAllocations.amountMinor, p: paymentAllocations.paymentId }).from(paymentAllocations).where(eq(paymentAllocations.invoiceId, older));
      expect(kept).toEqual([{ a: 455_40, p: p1 }]);
      expect(await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, p2))).toHaveLength(0);

      const st = await tx.select({ id: documents.id, s: documents.status }).from(documents).where(inArray(documents.id, [olderDoc, newerDoc]));
      expect(Object.fromEntries(st.map((d) => [d.id, d.s]))).toEqual({ [olderDoc]: "ARCHIVED", [newerDoc]: "REJECTED" });
    }));

  it("والورقةُ المختارة من الأحدث تُعلَّق بالقيد الأقدم، والأخرى ترفض", () =>
    withRollback(async (tx) => {
      const { older, newer, olderDoc, newerDoc } = await setup(tx);
      await mergeDuplicateInvoice(tx, { invoiceId: older, twinId: newer, fileOf: newer, actorId: await someone(tx) });
      const [inv] = await tx.select({ d: invoices.documentId }).from(invoices).where(eq(invoices.id, older));
      expect(inv.d).toBe(newerDoc);
      const st = await tx.select({ id: documents.id, s: documents.status }).from(documents).where(inArray(documents.id, [olderDoc, newerDoc]));
      expect(Object.fromEntries(st.map((d) => [d.id, d.s]))).toEqual({ [olderDoc]: "REJECTED", [newerDoc]: "ARCHIVED" });
    }));

  it("الباقيةُ المفتوحة يسدّها ما عاد رصيداً", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const older = await makeInvoice(tx, s, 455_40, "2026-08-14");
      const newer = await makeInvoice(tx, s, 455_40, "2026-08-14");
      await tx.update(invoices).set({ createdAt: day("2026-09-08") }).where(eq(invoices.id, older));
      await tx.update(invoices).set({ createdAt: day("2026-10-23") }).where(eq(invoices.id, newer));
      await pay(tx, s, newer, 455_40, "2026-08-20");
      const out = await mergeDuplicateInvoice(tx, { invoiceId: older, twinId: newer, fileOf: older, actorId: await someone(tx) });
      expect(out.reappliedMinor).toBe(455_40);
      const kept = await tx.select({ a: paymentAllocations.amountMinor }).from(paymentAllocations).where(eq(paymentAllocations.invoiceId, older));
      expect(kept.reduce((x, r) => x + r.a, 0)).toBe(455_40);
    }));

  it("مبلغان مختلفان ليسا نسخة — يرفض", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const a = await makeInvoice(tx, s, 455_40, "2026-08-14");
      const b = await makeInvoice(tx, s, 303_60, "2026-08-14");
      expect(await caught(mergeDuplicateInvoice(tx, { invoiceId: a, twinId: b, fileOf: a, actorId: await someone(tx) }))).toBeInstanceOf(MergeRefused);
    }));

  it("ولمورّدين مختلفين — يرفض", () =>
    withRollback(async (tx) => {
      const a = await makeInvoice(tx, await makeSupplier(tx), 455_40, "2026-08-14");
      const b = await makeInvoice(tx, await makeSupplier(tx), 455_40, "2026-08-14");
      expect(await caught(mergeDuplicateInvoice(tx, { invoiceId: a, twinId: b, fileOf: a, actorId: await someone(tx) }))).toBeInstanceOf(MergeRefused);
    }));
});
