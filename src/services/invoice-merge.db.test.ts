import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { and } from "drizzle-orm";
import { caught, day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { auditLogs, documents, invoices, paymentAllocations, payments, statementLines, statements, users } from "@/db/schema";
import { createInvoice, STATEMENT_LINE_ORIGIN } from "./invoice.service";
import { loadSupplierBalances } from "./supplier-balance.service";
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

  /*
    بيكوف (الإنتاج، ٢٤ أكتوبر): «قيّد الناقصة» قيّد من القراءة الثالثة للكشف «000285لـ#» بـ١٥٠
    يوم ٢٦ أغسطس — وهي 00346 المقيَّدة من ملفّها والمسدَّدة، وسطرُ القراءة الثانية يطابقها.
    والإصلاحُ ضغطةُ المالك «نسخة مكرّرة؟ ادمجها» — فهذا ما يجب أن يتركه.
  */
  async function bekov(tx: Tx) {
    const s = await makeSupplier(tx);
    const realDoc = await makeDocument(tx, s, "2026-08-26");
    const i346 = await createInvoice(tx, {
      documentId: realDoc, supplierId: s, invoiceNumber: "00346", invoiceDate: day("2026-08-26"), periodMonth: "2026-08",
      subtotalMinor: 130_43, vatMinor: 19_57, totalMinor: 150_00, taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
    });
    const [virtualDoc] = await tx.insert(documents).values({
      fileName: "BeCof_000285لـ# — من كشف 2026-09-25_BeCof_Statement_SAR680.00.pdf", mimeType: "application/vnd.tph.statement-line",
      kind: "TAX_INVOICE", status: "ARCHIVED", periodMonth: "2026-08", supplierId: s, origin: STATEMENT_LINE_ORIGIN,
    }).returning({ id: documents.id });
    const dup = await createInvoice(tx, {
      documentId: virtualDoc.id, supplierId: s, invoiceNumber: "000285لـ#", invoiceDate: day("2026-08-26"), periodMonth: "2026-08",
      subtotalMinor: null, vatMinor: null, totalMinor: 150_00, taxStatus: "UNKNOWN", inputVatStatus: "NOT_ELIGIBLE", isFixedAsset: false,
    });
    if (!i346 || !dup) throw new Error("لم تنشأ الفاتورتان");
    await tx.update(invoices).set({ createdAt: day("2026-09-08") }).where(eq(invoices.id, i346));
    await tx.update(invoices).set({ createdAt: day("2026-10-24") }).where(eq(invoices.id, dup));
    const p1 = await pay(tx, s, i346, 150_00, "2026-08-26");

    const statementOf = async (end: string, ref: string, invoiceId: string) => {
      const doc = await makeDocument(tx, s, end);
      const [st] = await tx.insert(statements).values({ documentId: doc, supplierId: s, periodStart: day("2026-08-01"), periodEnd: day(end) }).returning({ id: statements.id });
      await tx.insert(statementLines).values([
        { statementId: st.id, date: day("2026-08-26"), ref: "000279#", creditMinor: 750_00, matchStatus: "IGNORED" },
        { statementId: st.id, date: day("2026-08-26"), ref, debitMinor: 150_00, matchedInvoiceId: invoiceId, matchStatus: "MATCHED" },
      ]);
      return st.id;
    };
    const second = await statementOf("2026-09-06", "00346#", i346);
    const third = await statementOf("2026-09-22", "000285لـ#", dup);
    return { s, i346, dup, p1, realDoc, virtualDoc: virtualDoc.id, second, third };
  }

  it("بيكوف: تبقى 00346 بسدادها، وسطرا الكشفين عليها، ومستند سطر الكشف يُحذف، والرصيد يستقيم", () =>
    withRollback(async (tx) => {
      const { s, i346, dup, p1, realDoc, virtualDoc, second, third } = await bekov(tx);
      const [before] = await loadSupplierBalances(tx, s);
      expect(before.owedMinor).toBe(150_00);

      /* من صفحة المكرّرة، والورقةُ ورقةُ 00346 */
      const actor = await someone(tx);
      const out = await mergeDuplicateInvoice(tx, { invoiceId: dup, twinId: i346, fileOf: i346, actorId: actor });
      expect(out).toMatchObject({ keptId: i346, keptNumber: "00346", droppedNumber: "000285لـ#", releasedMinor: 0 });

      expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.supplierId, s))).toEqual([{ id: i346 }]);
      expect(await tx.select({ p: paymentAllocations.paymentId, a: paymentAllocations.amountMinor }).from(paymentAllocations)
        .where(eq(paymentAllocations.invoiceId, i346))).toEqual([{ p: p1, a: 150_00 }]);

      for (const st of [second, third]) {
        const [l] = await tx.select({ inv: statementLines.matchedInvoiceId, m: statementLines.matchStatus }).from(statementLines)
          .where(and(eq(statementLines.statementId, st), eq(statementLines.debitMinor, 150_00)));
        expect(l).toEqual({ inv: i346, m: "MATCHED" });
      }

      expect(await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, virtualDoc))).toHaveLength(0);
      const [kept] = await tx.select({ d: invoices.documentId }).from(invoices).where(eq(invoices.id, i346));
      expect(kept.d).toBe(realDoc);

      const [after] = await loadSupplierBalances(tx, s);
      expect(after.owedMinor).toBe(0);
      expect(after.creditLeftMinor).toBe(0);

      const audit = await tx.select({ actor: auditLogs.actorId }).from(auditLogs)
        .where(and(eq(auditLogs.action, "INVOICE_MERGED"), eq(auditLogs.entityId, i346)));
      expect(audit).toEqual([{ actor }]);
    }));

  it("بيكوف: سطرُ كشفٍ بلا ملفّ لا يُختار ورقةً للباقية", () =>
    withRollback(async (tx) => {
      const { i346, dup } = await bekov(tx);
      const e = await caught(mergeDuplicateInvoice(tx, { invoiceId: dup, twinId: i346, fileOf: dup, actorId: await someone(tx) }));
      expect(e).toBeInstanceOf(MergeRefused);
    }));
});
