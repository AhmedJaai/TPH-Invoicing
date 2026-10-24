import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, expenses, invoices, monthCloses, payments, users } from "@/db/schema";
import { createId } from "@/lib/id";
import { paymentMonthOf } from "@/lib/riyadh-time";
import { caught, day, makeDocument, makeInvoice, makeSupplier, pgErrorOf, withRollback } from "@/test/db";
import { deleteExpense, deriveExpensesFromBank, recordManualExpense, resyncBankExpenses } from "./expense.service";
import { allocate, createPayment } from "./payment.service";
import { MonthClosedError } from "./validation.service";
import type { Tx } from "./types";

/*
  ما يفلت من مؤثِّرات ٠٢٨ — الفاتورةُ في غير مبالغها الثلاثة، والمصروف، وحركةُ البنك —
  وما يجب أن يبقى مفتوحاً لأنّ له مساراً مشروعاً اليوم. وكلُّ رفضٍ يُجرَّب في نقطة
  حفظ (`tx.transaction`) كي تبقى المعاملةُ الخارجيّة صالحةً لما بعده.
  والأشهرُ ٢٠٩٩ كي لا تلتقي بإقفالٍ في بيانات التجهيز.
*/

const close = (tx: Tx, month: string) => tx.insert(monthCloses).values({ month, status: "CLOSED" });
const reopen = (tx: Tx, month: string) => tx.update(monthCloses).set({ status: "OPEN" }).where(eq(monthCloses.month, month));

/** يُرفض في نقطة حفظ — بنصٍّ عربيٍّ يقول «مقفل» ورمزِ المؤثِّر. */
async function rejected(tx: Tx, body: (sp: Tx) => Promise<unknown>): Promise<string> {
  const err = pgErrorOf(await caught(tx.transaction(async (sp) => { await body(sp); })));
  expect(err?.code).toBe("P0001");
  expect(err?.message).toMatch(/مقفل/);
  return err?.message ?? "";
}

/** يمرّ في نقطة حفظ. */
const passes = (tx: Tx, body: (sp: Tx) => Promise<unknown>) => tx.transaction(async (sp) => { await body(sp); });

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `lock-${createId()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function bankRow(tx: Tx, iso: string, amountMinor: number, category: "RENT" | "SUPPLIER" | "UNKNOWN" = "UNKNOWN"): Promise<string> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `lock-${createId()}.xlsx` }).returning({ id: bankImports.id });
  const [t] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT",
    description: "إيجار المحلّ", category, matchStatus: category === "RENT" ? "IGNORED" : "UNMATCHED",
    identityKey: `t-lock-${createId()}`,
  }).returning({ id: bankTransactions.id });
  return t.id;
}

describe("الفاتورة في الشهر المقفل: الخصمُ والرسوم وحالُ الضريبة لا تتغيّر", () => {
  it("يُرفض الخصم والرسوم والحالُ الضريبيّ وخصمُ المدخلات والأصلُ الثابت", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const id = await makeInvoice(tx, supplierId, 1_150_00, "2099-03-10");
      await close(tx, "2099-03");
      const where = eq(invoices.id, id);
      await rejected(tx, (sp) => sp.update(invoices).set({ discountMinor: 50_00 }).where(where));
      await rejected(tx, (sp) => sp.update(invoices).set({ chargesMinor: 20_00 }).where(where));
      await rejected(tx, (sp) => sp.update(invoices).set({ taxStatus: "INVALID" }).where(where));
      await rejected(tx, (sp) => sp.update(invoices).set({ inputVatStatus: "NOT_ELIGIBLE" }).where(where));
      await rejected(tx, (sp) => sp.update(invoices).set({ isFixedAsset: true }).where(where));
    }));

  it("وما لا يغيّر المال يمرّ: ربطُ ملفٍّ بقيدها، والقيدُ المحاسبيّ", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const id = await makeInvoice(tx, supplierId, 1_150_00, "2099-03-10");
      const otherDoc = await makeDocument(tx, supplierId, "2099-03-10");
      await close(tx, "2099-03");
      await passes(tx, (sp) => sp.update(invoices).set({ documentId: otherDoc }).where(eq(invoices.id, id)));
      await passes(tx, (sp) => sp.update(invoices).set({ postedToAccounting: true, postedAt: new Date() }).where(eq(invoices.id, id)));
    }));

  it("وإعادة الفتح تعيد الكتابة ممكنة", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const id = await makeInvoice(tx, supplierId, 1_150_00, "2099-03-10");
      await close(tx, "2099-03");
      await reopen(tx, "2099-03");
      await passes(tx, (sp) => sp.update(invoices).set({ isFixedAsset: true }).where(eq(invoices.id, id)));
    }));
});

describe("المصروف في الشهر المقفل", () => {
  it("الإدراجُ المباشر يُرفض، والخدمةُ تقول MonthClosedError قبله", () =>
    withRollback(async (tx) => {
      await close(tx, "2099-04");
      await rejected(tx, (sp) => sp.insert(expenses).values({
        periodMonth: "2099-04", occurredOn: "2099-04-02", category: "RENT", label: "إيجار", amountMinor: 100_00, source: "MANUAL",
      }));
      const userId = await someone(tx);
      const e = await caught(tx.transaction((sp) => recordManualExpense(userId, {
        occurredOn: "2099-04-02", category: "RENT", label: "إيجار", amountMinor: 100_00,
      }, sp)));
      expect(e).toBeInstanceOf(MonthClosedError);
    }));

  it("الحذفُ وتعديلُ المبلغ والباب يُرفضان، والاسمُ وفكُّ الربط يمرّان", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const id = await recordManualExpense(userId, { occurredOn: "2099-04-02", category: "RENT", label: "إيجار", amountMinor: 100_00 }, tx);
      await close(tx, "2099-04");
      const where = eq(expenses.id, id);
      await rejected(tx, (sp) => sp.update(expenses).set({ amountMinor: 200_00 }).where(where));
      await rejected(tx, (sp) => sp.update(expenses).set({ category: "UTILITY" }).where(where));
      await rejected(tx, (sp) => sp.delete(expenses).where(where));
      const e = await caught(tx.transaction((sp) => deleteExpense(userId, id, sp)));
      expect(e).toBeInstanceOf(MonthClosedError);
      await passes(tx, (sp) => sp.update(expenses).set({ label: "إيجار المحلّ" }).where(where));
      await passes(tx, (sp) => sp.update(expenses).set({ bankTransactionId: null, recurringExpenseId: null }).where(where));
      expect((await tx.select({ id: expenses.id }).from(expenses).where(where)).length).toBe(1);

      await reopen(tx, "2099-04");
      expect(await deleteExpense(userId, id, tx)).toBe("DELETED");
    }));

  it("الاشتقاقُ من الكشف يتخطّى الشهر المقفل ويعدّه — لا يسقط كلُّه", () =>
    withRollback(async (tx) => {
      await bankRow(tx, "2099-05-05", 8_000_00, "RENT");
      await close(tx, "2099-05");
      const out = await deriveExpensesFromBank(null, "2099-05", tx);
      expect(out.created).toBe(0);
      expect(out.skippedClosedMonth).toBe(1);
      expect(Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from expenses where period_month = '2099-05'`)).rows[0].n)).toBe(0);
    }));

  it("وإعادةُ تصنيف حركةٍ في شهرٍ مقفل لا تمسّ مصروفه المختوم", () =>
    withRollback(async (tx) => {
      const txId = await bankRow(tx, "2099-06-05", 8_000_00, "RENT");
      expect((await deriveExpensesFromBank(null, "2099-06", tx)).created).toBe(1);
      await close(tx, "2099-06");
      /* التصنيفُ لا يغيّر المال — فيمرّ على حركة الشهر المقفل */
      await passes(tx, (sp) => sp.update(bankTransactions).set({ category: "PERSONAL" }).where(eq(bankTransactions.id, txId)));
      const sync = await tx.transaction((sp) => resyncBankExpenses(sp, null, { transactionIds: [txId], insertMissing: true }));
      expect(sync).toEqual({ updated: 0, removed: 0, created: 0 });
      const [left] = await tx.select({ category: expenses.category }).from(expenses).where(eq(expenses.bankTransactionId, txId));
      expect(left.category).toBe("RENT");
    }));
});

describe("حركة البنك في الشهر المقفل: المالُ وحده محروس", () => {
  it("الإدراجُ والحذفُ وتغييرُ المبلغ والاتّجاه والتاريخ تُرفض", () =>
    withRollback(async (tx) => {
      const txId = await bankRow(tx, "2099-07-05", 900_00);
      await close(tx, "2099-07");
      const where = eq(bankTransactions.id, txId);
      await rejected(tx, (sp) => bankRow(sp, "2099-07-06", 50_00));
      await rejected(tx, (sp) => sp.delete(bankTransactions).where(where));
      await rejected(tx, (sp) => sp.update(bankTransactions).set({ amountMinor: 901_00 }).where(where));
      await rejected(tx, (sp) => sp.update(bankTransactions).set({ direction: "CREDIT" }).where(where));
      /* ونقلُها إلى شهرٍ مفتوح كإخراجها من المقفل */
      await rejected(tx, (sp) => sp.update(bankTransactions).set({ valueDate: day("2099-08-01") }).where(where));
    }));

  it("والتصنيفُ والمرجعُ والحسابُ والربطُ بدفعةٍ تمرّ — حوالةُ شهرٍ مقفل تُطابَق بفاتورةٍ متأخّرة", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const txId = await bankRow(tx, "2099-07-05", 900_00);
      await close(tx, "2099-07");
      const where = eq(bankTransactions.id, txId);
      await passes(tx, (sp) => sp.update(bankTransactions).set({ category: "SUPPLIER", supplierId, classificationSource: "HUMAN" }).where(where));
      await passes(tx, (sp) => sp.update(bankTransactions).set({ operationRef: `TOK:T${createId()}` }).where(where));

      /* فاتورةُ أغسطس المتأخّرة، ودفعتُها تُنسب إلى أغسطس المفتوح */
      const invoiceId = await makeInvoice(tx, supplierId, 900_00, "2099-08-03");
      const pay = await createPayment(tx, { supplierId, paidAt: day("2099-07-05"), amountMinor: 900_00, method: "BANK_TRANSFER", appliesToMonth: "2099-08" });
      await passes(tx, (sp) => sp.update(bankTransactions).set({ matchedPaymentId: pay, matchStatus: "MATCHED" }).where(where));
      await passes(tx, (sp) => allocate(sp, pay, [{ invoiceId, amountMinor: 900_00 }]));
    }));

  it("وإعادة الفتح تعيد الإدراج ممكناً", () =>
    withRollback(async (tx) => {
      await close(tx, "2099-07");
      await reopen(tx, "2099-07");
      await passes(tx, (sp) => bankRow(sp, "2099-07-06", 50_00));
    }));
});

describe("التخصيص: دفعةُ شهرٍ مقفل يُخصَّص باقيها لفاتورةٍ متأخّرة في شهرٍ مفتوح", () => {
  it("يمرّ — ورصيدُ الشهر المقفل لا يتغيّر به", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const pay = await createPayment(tx, { supplierId, paidAt: day("2099-09-10"), amountMinor: 500_00, method: "BANK_TRANSFER" });
      await close(tx, "2099-09");
      const late = await makeInvoice(tx, supplierId, 500_00, "2099-10-02");
      await passes(tx, (sp) => allocate(sp, pay, [{ invoiceId: late, amountMinor: 500_00 }]));
      /* والفاتورةُ في الشهر المقفل يبقى تخصيصُها محروساً (٠٢٨) */
      const closedInvoice = await makeInvoice(tx, supplierId, 300_00, "2099-11-02");
      await close(tx, "2099-11");
      const other = await createPayment(tx, { supplierId, paidAt: day("2099-12-01"), amountMinor: 300_00, method: "BANK_TRANSFER" });
      await rejected(tx, (sp) => sp.execute(sql`insert into payment_allocations (id, payment_id, invoice_id, amount_minor)
        values (${createId()}, ${other}, ${closedInvoice}, 100)`));
    }));
});

describe("شهرُ الدفعة بتوقيت الرياض — في القاعدة والخدمة معاً", () => {
  const LATE = new Date("2099-08-31T21:30:00Z"); // الرياض: ١ سبتمبر ٠٠:٣٠

  it("payment_month تقول سبتمبر مهما كانت منطقة الجلسة، والخدمةُ تقول مثلها", () =>
    withRollback(async (tx) => {
      for (const zone of ["UTC", "America/Los_Angeles", "Asia/Riyadh"]) {
        await tx.execute(sql.raw(`set local timezone = '${zone}'`));
        const [r] = (await tx.execute<{ m: string }>(sql`select payment_month(null, ${LATE.toISOString()}::timestamptz) as m`)).rows;
        expect(r.m).toBe("2099-09");
      }
      expect(paymentMonthOf(null, LATE)).toBe("2099-09");
      const [given] = (await tx.execute<{ m: string }>(sql`select payment_month('2099-07', ${LATE.toISOString()}::timestamptz) as m`)).rows;
      expect(given.m).toBe(paymentMonthOf("2099-07", LATE));
    }));

  it("إقفالُ أغسطس لا يردّ دفعة ٢١:٣٠Z آخره، وإقفالُ سبتمبر يردّها — في الخدمة وفي القاعدة", () =>
    withRollback(async (tx) => {
      await tx.execute(sql`set local timezone = 'UTC'`);
      const supplierId = await makeSupplier(tx);
      await close(tx, "2099-08");
      await passes(tx, (sp) => createPayment(sp, { supplierId, paidAt: LATE, amountMinor: 100_00, method: "BANK_TRANSFER" }));

      await close(tx, "2099-09");
      const e = await caught(tx.transaction((sp) => createPayment(sp, { supplierId, paidAt: LATE, amountMinor: 200_00, method: "BANK_TRANSFER" })));
      expect(e).toBeInstanceOf(MonthClosedError);
      await rejected(tx, (sp) => sp.insert(payments).values({ supplierId, paidAt: LATE, amountMinor: 300_00, method: "BANK_TRANSFER" }));
    }));
});
