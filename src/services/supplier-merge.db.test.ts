import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { caught, day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import {
  auditLogs, bankImports, bankTransactions, documents, invoices, monthCloses, payments, supplierAliases, suppliers, users,
} from "@/db/schema";
import { createPayment } from "./payment.service";
import {
  deleteSupplier, mergeSuppliers, previewDelete, previewMerge, SupplierMergeRefused, undoMerge,
} from "./supplier-merge.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function owner(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `smerge-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function bankTx(tx: Tx, supplierId: string, amountMinor: number, iso: string): Promise<string> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `dbtest-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [t] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT", category: "SUPPLIER", supplierId,
  }).returning({ id: bankTransactions.id });
  return t.id;
}

describe("دمج مورّد في آخر (supplier:merge)", () => {
  it("ينقل الفواتير والدفعات والحركات والمستندات والأسماء، ويبقى المصدر شاهداً، ويُقيَّد في السجلّ", () =>
    withRollback(async (tx) => {
      const actor = await owner(tx);
      const a = await makeSupplier(tx);
      const b = await makeSupplier(tx);
      const inv = await makeInvoice(tx, a, 115_00, "2099-03-05");
      const pay = await createPayment(tx, { supplierId: a, paidAt: day("2099-03-10"), amountMinor: 50_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      const btx = await bankTx(tx, a, 50_00, "2099-03-10");
      await tx.insert(supplierAliases).values([
        { supplierId: a, value: "ALPHA CO", normalized: "alpha co", kind: "BANK_BENEFICIARY" },
        { supplierId: a, value: "SHARED", normalized: "shared", kind: "NAME_VARIANT" },
        { supplierId: b, value: "SHARED", normalized: "shared", kind: "NAME_VARIANT" },
      ]);

      const p = await previewMerge(a, b, tx);
      expect(p.refused).toBeNull();
      expect(p.counts.invoices).toBe(1);
      expect(p.counts.payments).toBe(1);
      expect(p.counts.bank_transactions).toBe(1);
      expect(p.duplicates.aliases).toBe(1);
      expect(p.balance.source).toBe(65_00);
      expect(p.balance.after).toBe(65_00);

      await mergeSuppliers(a, b, actor, tx);
      const [i] = await tx.select({ s: invoices.supplierId }).from(invoices).where(eq(invoices.id, inv));
      const [pp] = await tx.select({ s: payments.supplierId }).from(payments).where(eq(payments.id, pay));
      const [bt] = await tx.select({ s: bankTransactions.supplierId }).from(bankTransactions).where(eq(bankTransactions.id, btx));
      expect([i.s, pp.s, bt.s]).toEqual([b, b, b]);
      const [src] = await tx.select().from(suppliers).where(eq(suppliers.id, a));
      expect(src.isActive).toBe(false);
      expect(src.mergedIntoId).toBe(b);
      const aliases = await tx.select({ n: supplierAliases.normalized }).from(supplierAliases).where(eq(supplierAliases.supplierId, b));
      expect(aliases.map((x) => x.n).sort()).toEqual(["alpha co", "shared"]);
      const audit = await tx.select().from(auditLogs).where(eq(auditLogs.entityId, a));
      expect(audit.some((x) => x.action === "SUPPLIER_MERGED")).toBe(true);

      /* والتراجعُ يعيد ما نُقل واحداً بواحد، والاسمَ المحذوف بصفّه */
      await undoMerge(a, actor, tx);
      const [i2] = await tx.select({ s: invoices.supplierId }).from(invoices).where(eq(invoices.id, inv));
      expect(i2.s).toBe(a);
      const back = await tx.select({ n: supplierAliases.normalized }).from(supplierAliases).where(eq(supplierAliases.supplierId, a));
      expect(back.map((x) => x.n).sort()).toEqual(["alpha co", "shared"]);
      const [src2] = await tx.select().from(suppliers).where(eq(suppliers.id, a));
      expect(src2.mergedIntoId).toBeNull();
      expect(src2.isActive).toBe(true);
    }));

  it("دمجٌ يمسّ شهراً مقفلاً يُردّ بقائمة أشهره، ولا يُكتب شيء", () =>
    withRollback(async (tx) => {
      const actor = await owner(tx);
      const a = await makeSupplier(tx);
      const b = await makeSupplier(tx);
      const inv = await makeInvoice(tx, a, 115_00, "2099-04-05");
      await tx.insert(monthCloses).values({ month: "2099-04", status: "CLOSED" });
      const p = await previewMerge(a, b, tx);
      expect(p.closedMonths).toEqual(["2099-04"]);
      const e = await caught(mergeSuppliers(a, b, actor, tx));
      expect(e).toBeInstanceOf(SupplierMergeRefused);
      expect((e as SupplierMergeRefused).months).toEqual(["2099-04"]);
      const [i] = await tx.select({ s: invoices.supplierId }).from(invoices).where(eq(invoices.id, inv));
      expect(i.s).toBe(a);
    }));

  it("رقمان ضريبيّان مختلفان يُقالان تعارضاً", () =>
    withRollback(async (tx) => {
      const a = await makeSupplier(tx);
      const b = await makeSupplier(tx);
      await tx.update(suppliers).set({ vatNumber: "300000000000013" }).where(eq(suppliers.id, a));
      await tx.update(suppliers).set({ vatNumber: "300000000000023" }).where(eq(suppliers.id, b));
      const p = await previewMerge(a, b, tx);
      expect(p.conflicts.map((c) => c.field)).toEqual(["VAT"]);
    }));
});

describe("حذف مورّد بلا مال", () => {
  it("مورّدٌ بمستندٍ وأسماءٍ بلا مال يُحذف: المستندُ يبقى بلا مورّد والأسماءُ تُحذف", () =>
    withRollback(async (tx) => {
      const actor = await owner(tx);
      const a = await makeSupplier(tx);
      const doc = await makeDocument(tx, a, "2099-05-01");
      await tx.insert(supplierAliases).values({ supplierId: a, value: "SABEA", normalized: "sabea", kind: "BANK_BENEFICIARY" });
      const p = await previewDelete(a, tx);
      expect(p.refused).toBeNull();
      expect(p.detach.documents).toBe(1);
      expect(p.detach.aliases).toBe(1);

      await deleteSupplier(a, actor, tx);
      expect(await tx.select().from(suppliers).where(eq(suppliers.id, a))).toEqual([]);
      const [d] = await tx.select({ s: documents.supplierId }).from(documents).where(eq(documents.id, doc));
      expect(d.s).toBeNull();
      expect(await tx.select().from(supplierAliases).where(eq(supplierAliases.supplierId, a))).toEqual([]);
      const audit = await tx.select().from(auditLogs).where(eq(auditLogs.entityId, a));
      expect(audit.some((x) => x.action === "SUPPLIER_DELETED")).toBe(true);
    }));

  it("مورّدٌ عليه فاتورة أو حركة بنك لا يُحذف", () =>
    withRollback(async (tx) => {
      const actor = await owner(tx);
      const a = await makeSupplier(tx);
      await makeInvoice(tx, a, 115_00, "2099-05-05");
      expect((await previewDelete(a, tx)).refused).toContain("فواتير");
      expect(await caught(deleteSupplier(a, actor, tx))).toBeInstanceOf(SupplierMergeRefused);

      const c = await makeSupplier(tx);
      await bankTx(tx, c, 10_00, "2099-05-06");
      expect(await caught(deleteSupplier(c, actor, tx))).toBeInstanceOf(SupplierMergeRefused);
    }));
});
