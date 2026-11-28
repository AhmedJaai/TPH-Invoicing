import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, expenses, monthCloses, paymentAllocations, users } from "@/db/schema";
import { day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { allocate, createPayment } from "./payment.service";
import { applySupplierCredit, markPaidByOwner, previewOwnerPaid } from "./supplier-credit.service";
import { confirmMatch } from "./match-confirm.service";
import { undoMatch } from "./match-undo.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

/**
 * فاتورةٌ مفتوحة في شهرٍ مقفل لا تُخصَّص — ولا تُسقط ما بعدها.
 *
 * «الأقدم أوّلاً» كان يختارها أوّلاً، و`allocate` يرمي `MonthClosedError`، فيسقط
 * معه الفعلُ كلُّه: أرشفةُ فاتورةٍ جديدة للمورّد (الخصمُ الآليّ في معاملتها)،
 * و«سُدّدت من حسابي»، و«سداد على حساب المورّد». وفي الإنتاج فاتورةٌ مفتوحة
 * كذلك (٢٦ نوفمبر ٢٠٢٦) — فأوّلُ حوالةٍ غير منسوبة لمورّدها كانت توقف أرشفته.
 */
const CLOSED = "2099-01";

const paidOn = async (tx: Tx, invoiceId: string) =>
  Number((await tx.select({ s: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}),0)::int` })
    .from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId)))[0].s);

async function closedMonthInvoice(tx: Tx, supplierId: string): Promise<string> {
  const id = await makeInvoice(tx, supplierId, 128_80, `${CLOSED}-10`);
  await tx.insert(monthCloses).values({ month: CLOSED, status: "CLOSED" })
    .onConflictDoUpdate({ target: monthCloses.month, set: { status: "CLOSED" } });
  return id;
}

describe("الشهر المقفل لا يوقف الخصم من رصيد المورّد", () => {
  it("الخصمُ الآليّ يتخطّى فاتورة الشهر المقفل ويسدّد الجديدة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const old = await closedMonthInvoice(tx, s);
      await createPayment(tx, { supplierId: s, paidAt: day("2099-07-10"), amountMinor: 500_00, method: "BANK_TRANSFER" });
      const fresh = await makeInvoice(tx, s, 300_00, "2099-07-08");

      const out = await applySupplierCredit(tx, s, { forwardDays: SETTLEMENT_FORWARD_DAYS });
      expect(out.appliedMinor).toBe(300_00);
      expect(await paidOn(tx, fresh)).toBe(300_00);
      expect(await paidOn(tx, old)).toBe(0);
    }));

  it("«سُدّدت من حسابي» تنقل الحوالة إلى فاتورةٍ مفتوحة لا إلى المقفلة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const old = await closedMonthInvoice(tx, s);
      const target = await makeInvoice(tx, s, 400_00, "2099-07-05");
      const other = await makeInvoice(tx, s, 250_00, "2099-07-06");
      const pay = await createPayment(tx, { supplierId: s, paidAt: day("2099-07-07"), amountMinor: 400_00, method: "BANK_TRANSFER" });
      await allocate(tx, pay, [{ invoiceId: target, amountMinor: 400_00 }]);

      const preview = await previewOwnerPaid(tx, target);
      expect(preview.reapplied.map((r) => r.invoiceId)).toEqual([other]);

      const out = await markPaidByOwner(tx, target);
      expect(out.appliedMinor).toBe(250_00);
      expect(await paidOn(tx, target)).toBe(400_00);
      expect(await paidOn(tx, other)).toBe(250_00);
      expect(await paidOn(tx, old)).toBe(0);
    }));

  it("«سداد على حساب المورّد» يوزّع على المفتوح ويتخطّى المقفل", () =>
    withRollback(async (tx) => {
      const [u] = await tx.insert(users).values({ email: `closed-${Math.random()}@test.local` }).returning({ id: users.id });
      const s = await makeSupplier(tx);
      const old = await closedMonthInvoice(tx, s);
      const fresh = await makeInvoice(tx, s, 1000_00, "2099-07-01");
      const [imp] = await tx.insert(bankImports).values({ fileName: `closed-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
      const [row] = await tx.insert(bankTransactions).values({
        bankImportId: imp.id, valueDate: day("2099-07-10"), amountMinor: 1000_00, direction: "DEBIT",
        category: "SUPPLIER", supplierId: s, description: "تحويل اختبار",
      }).returning({ id: bankTransactions.id });

      const r = await confirmMatch(u.id, { transactionId: row.id, settleSupplier: true }, tx);
      expect(r).toMatchObject({ ok: true, settled: 1, allocated: 1000_00, unapplied: 0 });
      expect(await paidOn(tx, fresh)).toBe(1000_00);
      expect(await paidOn(tx, old)).toBe(0);
    }));
});

describe("حركةٌ صارت سداداً لا يبقى عليها مصروف", () => {
  it("«رسم بنكيّ» ثمّ تراجع ثمّ سداد على حساب المورّد — المبلغ لا يُحسب مرّتين", () =>
    withRollback(async (tx) => {
      const [u] = await tx.insert(users).values({ email: `exp-${Math.random()}@test.local` }).returning({ id: users.id });
      const s = await makeSupplier(tx);
      await makeInvoice(tx, s, 500_00, "2099-07-01");
      const [imp] = await tx.insert(bankImports).values({ fileName: `exp-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
      const [row] = await tx.insert(bankTransactions).values({
        bankImportId: imp.id, valueDate: day("2099-07-10"), amountMinor: 500_00, direction: "DEBIT",
        category: "UNKNOWN", supplierId: s, description: "تحويل اختبار",
      }).returning({ id: bankTransactions.id });
      const onTx = async () => (await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.bankTransactionId, row.id))).length;

      await confirmMatch(u.id, { transactionId: row.id, notAPayment: "BANK_FEE" }, tx);
      expect(await onTx()).toBe(1);

      await undoMatch(u.id, { transactionId: row.id }, tx);
      expect(await onTx()).toBe(0);

      /* ولو بقي المصروف (اشتقاقٌ سبق): السدادُ يُسقطه */
      await tx.update(bankTransactions).set({ category: "BANK_FEE" }).where(eq(bankTransactions.id, row.id));
      await tx.insert(expenses).values({
        periodMonth: "2099-07", occurredOn: "2099-07-10", category: "BANK_FEE", label: "رسم", amountMinor: 500_00,
        source: "BANK", bankTransactionId: row.id,
      });
      expect(await onTx()).toBe(1);
      const r = await confirmMatch(u.id, { transactionId: row.id, settleSupplier: true }, tx);
      expect(r).toMatchObject({ ok: true, allocated: 500_00 });
      expect(await onTx()).toBe(0);
    }));
});

describe("السداد على الحساب يتبنّى دفعةً لها رسم", () => {
  it("يُوزَّع صافيها لا مبلغُها — والأثرُ بما كُتب", () =>
    withRollback(async (tx) => {
      const [u] = await tx.insert(users).values({ email: `fee-${Math.random()}@test.local` }).returning({ id: users.id });
      const s = await makeSupplier(tx);
      const a = await makeInvoice(tx, s, 500_00, "2099-07-01");
      const b = await makeInvoice(tx, s, 500_00, "2099-07-02");
      /* إيصالُ الحوالة سبق الكشف، وفيه رسمُها */
      const receipt = await makeDocument(tx, s, "2099-07-10");
      await createPayment(tx, { documentId: receipt, supplierId: s, paidAt: day("2099-07-10"), amountMinor: 1000_00, feeMinor: 20_00, method: "BANK_TRANSFER" });
      const [imp] = await tx.insert(bankImports).values({ fileName: `fee-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
      const [row] = await tx.insert(bankTransactions).values({
        bankImportId: imp.id, valueDate: day("2099-07-10"), amountMinor: 1000_00, direction: "DEBIT",
        category: "SUPPLIER", supplierId: s, description: "تحويل اختبار",
      }).returning({ id: bankTransactions.id });

      const r = await confirmMatch(u.id, { transactionId: row.id, settleSupplier: true }, tx);
      expect(await paidOn(tx, a)).toBe(500_00);
      expect(await paidOn(tx, b)).toBe(480_00);
      expect(r).toMatchObject({ ok: true, allocated: 980_00, supplierBalanceAfter: 20_00 });
    }));
});
