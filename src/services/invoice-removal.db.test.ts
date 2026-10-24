import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { caught, day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import {
  auditLogs, bankImports, bankTransactions, documents, invoices, issues, monthCloses, paymentAllocations, payments,
  statementLines, statements, users, vatFilings,
} from "@/db/schema";
import { InvoiceRemovalRefused, loadRemovalFacts, removeInvoiceEntry } from "./invoice-removal.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `rm-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function pay(tx: Tx, supplierId: string, invoiceId: string, amountMinor: number, paidAt: string, method: "BANK_TRANSFER" | "OWNER_ACCOUNT" = "BANK_TRANSFER") {
  const [p] = await tx.insert(payments).values({ supplierId, paidAt: day(paidAt), amountMinor, method, status: "APPLIED" }).returning({ id: payments.id });
  await tx.insert(paymentAllocations).values({ paymentId: p.id, invoiceId, amountMinor });
  return p.id;
}

async function bankLink(tx: Tx, supplierId: string, paymentId: string, amountMinor: number) {
  const [imp] = await tx.insert(bankImports).values({ fileName: `rm-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [row] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day("2026-09-03"), amountMinor, direction: "DEBIT", category: "SUPPLIER", supplierId,
    description: "تحويل اختبار", matchedPaymentId: paymentId, matchStatus: "MATCHED",
  }).returning({ id: bankTransactions.id });
  return row.id;
}

const balanceOf = async (tx: Tx, s: string) => {
  const [b] = await loadSupplierBalances(tx, s);
  return { owed: b?.owedMinor ?? 0, credit: b?.creditLeftMinor ?? 0 };
};

/*
  أحمد (٢٥ أكتوبر): حذف ملفّ الفاتورة القديمة من الدرايف بعد أن استبدلها، والقديمةُ سُدّدت بحوالة —
  فبقي القيدان، وظهر أنّ له رصيداً عند المورّد.
*/
async function replaced(tx: Tx) {
  const s = await makeSupplier(tx);
  const old = await makeInvoice(tx, s, 500_00, "2026-09-01");
  const fresh = await makeInvoice(tx, s, 500_00, "2026-09-02");
  const p1 = await pay(tx, s, old, 500_00, "2026-09-03");
  const btx = await bankLink(tx, s, p1, 500_00);
  const [{ doc }] = await tx.select({ doc: invoices.documentId }).from(invoices).where(eq(invoices.id, old));
  await tx.insert(issues).values({ code: "FILE_MISSING_IN_DRIVE", severity: "WARN", entityType: "document", entityId: doc, message: "«old.pdf» محذوف من الدرايف." });
  return { s, old, fresh, p1, btx, doc };
}

describe("حذف قيد فاتورة (invoice:remove)", () => {
  it("حذف القيد: تُحذف الفاتورة، والدفعة باقية رصيداً، والمستند مرفوض، والتنبيه يُحسم، وسجلّ بالقبل والبعد", () =>
    withRollback(async (tx) => {
      const { s, old, p1, doc } = await replaced(tx);
      expect(await balanceOf(tx, s)).toEqual({ owed: 500_00, credit: 0 });
      const facts = await loadRemovalFacts(old, tx);
      expect(facts).toMatchObject({ refusal: null, allocatedMinor: 500_00, invoice: { fileMissing: true } });
      expect(facts.allocations[0]).toMatchObject({ paymentId: p1, bankLinked: true });

      const actor = await someone(tx);
      const out = await removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "release", reallocate: false }, actorId: actor });
      expect(out).toMatchObject({ releasedMinor: 500_00, movedMinor: 0, reappliedMinor: 0, leftAsCreditMinor: 500_00 });
      expect(out.balance.before).toEqual({ owedMinor: 500_00, creditLeftMinor: 0 });

      expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, old))).toHaveLength(0);
      const [p] = await tx.select({ id: payments.id, status: payments.status }).from(payments).where(eq(payments.id, p1));
      expect(p.id).toBe(p1);
      expect(await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, p1))).toHaveLength(0);
      const [d] = await tx.select({ s: documents.status }).from(documents).where(eq(documents.id, doc));
      expect(d.s).toBe("REJECTED");
      const open = await tx.select({ id: issues.id }).from(issues).where(and(eq(issues.entityId, doc), eq(issues.status, "OPEN")));
      expect(open).toHaveLength(0);
      /* الدفعةُ رصيدٌ يقابل الفاتورة الجديدة المفتوحة: لا عليك ولا لك */
      expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 0 });

      const [a] = await tx.select({ before: auditLogs.before, after: auditLogs.after }).from(auditLogs)
        .where(and(eq(auditLogs.action, "INVOICE_ENTRY_REMOVED"), eq(auditLogs.entityId, old)));
      expect(a.before).toMatchObject({ "عليك قبل (هللة)": 500_00 });
      expect(a.after).toMatchObject({ "فُكّ (هللة)": 500_00, "بقي رصيداً (هللة)": 500_00 });
    }));

  it("حذف القيد مع التوزيع: الدفعة تسدّ أقدم المفتوح", () =>
    withRollback(async (tx) => {
      const { old, fresh, p1 } = await replaced(tx);
      const out = await removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "release", reallocate: true }, actorId: await someone(tx) });
      expect(out.reappliedMinor).toBe(500_00);
      expect(await tx.select({ inv: paymentAllocations.invoiceId, a: paymentAllocations.amountMinor }).from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, p1))).toEqual([{ inv: fresh, a: 500_00 }]);
    }));

  it("انقل سداده: التخصيص وحوالة البنك وسطر الكشف تنتقل إلى الأخرى", () =>
    withRollback(async (tx) => {
      const { s, old, fresh, p1, btx } = await replaced(tx);
      const sdoc = await makeDocument(tx, s, "2026-09-30");
      const [st] = await tx.insert(statements).values({ documentId: sdoc, supplierId: s, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30") }).returning({ id: statements.id });
      const [line] = await tx.insert(statementLines).values({ statementId: st.id, date: day("2026-09-01"), ref: "X", debitMinor: 500_00, matchedInvoiceId: old, matchStatus: "MATCHED" }).returning({ id: statementLines.id });

      const out = await removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "move", targetId: fresh }, actorId: await someone(tx) });
      expect(out).toMatchObject({ movedMinor: 500_00, leftAsCreditMinor: 0, target: { id: fresh } });
      expect(await tx.select({ inv: paymentAllocations.invoiceId }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, p1))).toEqual([{ inv: fresh }]);
      const [b] = await tx.select({ p: bankTransactions.matchedPaymentId }).from(bankTransactions).where(eq(bankTransactions.id, btx));
      expect(b.p).toBe(p1);
      const [l] = await tx.select({ inv: statementLines.matchedInvoiceId }).from(statementLines).where(eq(statementLines.id, line.id));
      expect(l.inv).toBe(fresh);
      expect(out.balance.after).toEqual({ owedMinor: 0, creditLeftMinor: 0 });
    }));

  it("انقل سداده بسقف ما بقي على الأخرى — والزائد رصيد", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const old = await makeInvoice(tx, s, 500_00, "2026-09-01");
      const small = await makeInvoice(tx, s, 300_00, "2026-09-02");
      await pay(tx, s, old, 500_00, "2026-09-03", "OWNER_ACCOUNT");
      const out = await removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "move", targetId: small }, actorId: await someone(tx) });
      expect(out).toMatchObject({ movedMinor: 300_00, leftAsCreditMinor: 200_00 });
      expect(out.balance.after).toEqual({ owedMinor: 0, creditLeftMinor: 200_00 });
    }));

  it("لا ينقل إلى فاتورة مورّد آخر", () =>
    withRollback(async (tx) => {
      const { old } = await replaced(tx);
      const other = await makeInvoice(tx, await makeSupplier(tx), 500_00, "2026-09-02");
      expect(await caught(removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "move", targetId: other }, actorId: await someone(tx) })))
        .toMatchObject({ status: 400 });
      expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, old))).toHaveLength(1);
    }));

  it("الشهر المقفل يُردّ بأسمائه ولا يتغيّر شيء", () =>
    withRollback(async (tx) => {
      const { old } = await replaced(tx);
      await tx.insert(monthCloses).values({ month: "2026-09", status: "CLOSED" });
      expect((await loadRemovalFacts(old, tx)).closedMonths).toEqual(["2026-09"]);
      const e = await caught(removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "release", reallocate: false }, actorId: await someone(tx) }));
      expect(e).toBeInstanceOf(InvoiceRemovalRefused);
      expect(e).toMatchObject({ payload: { months: ["2026-09"] } });
    }));

  it("فاتورة ضريبتها في إقرار قُدّم لا يُحذف قيدها", () =>
    withRollback(async (tx) => {
      const { old } = await replaced(tx);
      await tx.insert(vatFilings).values({
        periodKey: "2098-Q1", filedOn: "2098-04-20", outputVatMinor: 0, inputVatMinor: 65_22, netMinor: -65_22,
        snapshot: { invoices: [{ id: old, vatMinor: 65_22, by: "آلة" }], txs: [] },
      });
      expect((await loadRemovalFacts(old, tx)).refusal).toContain("2098-Q1");
      expect(await caught(removeInvoiceEntry(tx, { invoiceId: old, choice: { mode: "release", reallocate: false }, actorId: await someone(tx) })))
        .toBeInstanceOf(InvoiceRemovalRefused);
    }));
});
