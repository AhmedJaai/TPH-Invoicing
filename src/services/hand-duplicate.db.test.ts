import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import {
  alertResolutions, auditLogs, bankImports, bankTransactions, invoices, monthCloses, paymentAllocations, payments, users,
} from "@/db/schema";
import { mergeDuplicateInvoice, previewMerge } from "./invoice-merge.service";
import { loadRemovalFacts, removeInvoiceEntry } from "./invoice-removal.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import { applySupplierCredit } from "./supplier-credit.service";
import {
  HandDuplicateRefused, decideDuplicateHandPayment, duplicateHandHeldIds, loadDuplicateHandPayments, voidDuplicateHandPayment,
} from "./hand-duplicate.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `handdup-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/** «سجّل الفاتورة مسدّدة» من حساب المالك — بلا حركة بنك ولا إيصال. */
async function handPay(tx: Tx, supplierId: string, invoiceId: string, amountMinor: number, paidAt: string) {
  const [p] = await tx.insert(payments).values({ supplierId, paidAt: day(paidAt), amountMinor, method: "OWNER_ACCOUNT", status: "APPLIED" }).returning({ id: payments.id });
  await tx.insert(paymentAllocations).values({ paymentId: p.id, invoiceId, amountMinor });
  return p.id;
}

/** حوالةٌ من الكشف سدّدت الفاتورة — مالٌ خرج حقّاً. */
async function bankPay(tx: Tx, supplierId: string, invoiceId: string, amountMinor: number, paidAt: string) {
  const [p] = await tx.insert(payments).values({ supplierId, paidAt: day(paidAt), amountMinor, method: "BANK_TRANSFER", status: "APPLIED" }).returning({ id: payments.id });
  await tx.insert(paymentAllocations).values({ paymentId: p.id, invoiceId, amountMinor });
  const [imp] = await tx.insert(bankImports).values({ fileName: `handdup-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(paidAt), amountMinor, direction: "DEBIT", category: "SUPPLIER", supplierId,
    description: "تحويل اختبار", matchedPaymentId: p.id, matchStatus: "MATCHED",
  });
  return p.id;
}

/** نسختان من الفاتورة نفسها، الأقدمُ قيداً تبقى، وكلٌّ وُسمت «مسدّدة» بيد. */
async function twoPaidCopies(tx: Tx, o: { total: number; date: string; paidAt: string; numbers: [string, string]; dropPaidBy?: "hand" | "bank" }) {
  const s = await makeSupplier(tx);
  const older = await makeInvoice(tx, s, o.total, o.date);
  const newer = await makeInvoice(tx, s, o.total, o.date);
  await tx.update(invoices).set({ invoiceNumber: o.numbers[0], createdAt: day("2026-10-01") }).where(eq(invoices.id, older));
  await tx.update(invoices).set({ invoiceNumber: o.numbers[1], createdAt: day("2026-10-20") }).where(eq(invoices.id, newer));
  const kept = await handPay(tx, s, older, o.total, o.paidAt);
  const dup = o.dropPaidBy === "bank" ? await bankPay(tx, s, newer, o.total, o.paidAt) : await handPay(tx, s, newer, o.total, o.paidAt);
  return { s, older, newer, kept, dup };
}

const balanceOf = async (tx: Tx, s: string) => {
  const [b] = await loadSupplierBalances(tx, s);
  return { owed: b?.owedMinor ?? 0, credit: b?.creditLeftMinor ?? 0 };
};
const statusOf = async (tx: Tx, id: string) => (await tx.select({ s: payments.status }).from(payments).where(eq(payments.id, id)))[0].s;

const MOOD = { total: 204_30, date: "2026-09-30", paidAt: "2026-09-30", numbers: ["74389", "INV-74389"] as [string, string] };
const JMLA = { total: 382_00, date: "2026-09-16", paidAt: "2026-09-16", numbers: ["0092-006-16895", "B07/2026/17328"] as [string, string] };

describe("الدمج لا يصنع رصيداً من سدادٍ مكرّر بيد", () => {
  for (const [name, o] of [["مود القهوة", MOOD], ["جملة التقنية", JMLA]] as const) {
    it(`${name}: المعاينة تقول إنّ السداد مكرّر، و«ألغِ السداد المكرّر» يترك فاتورةً مسدّدة ودفعةً ملغاة ولا شيء عليك ولا لك`, () =>
      withRollback(async (tx) => {
        const { s, older, newer, kept, dup } = await twoPaidCopies(tx, o);
        expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 0 });

        const preview = await previewMerge(tx, { invoiceId: newer, twinId: older });
        expect(preview).toMatchObject({ keptId: older, allocatedMinor: o.total, closedMonths: [] });
        expect(preview.duplicates.map((d) => [d.paymentId, d.amountMinor, d.method])).toEqual([[dup, o.total, "OWNER_ACCOUNT"]]);

        const out = await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, handPayments: "void", actorId: await someone(tx) });
        expect(out).toMatchObject({ keptId: older, voidedMinor: o.total, voidedPaymentIds: [dup], releasedMinor: 0, reappliedMinor: 0 });

        expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.supplierId, s))).toEqual([{ id: older }]);
        expect(await tx.select({ p: paymentAllocations.paymentId, a: paymentAllocations.amountMinor }).from(paymentAllocations)
          .where(eq(paymentAllocations.invoiceId, older))).toEqual([{ p: kept, a: o.total }]);
        expect(await statusOf(tx, dup)).toBe("VOID");
        const [why] = await tx.select({ r: payments.reversalReason }).from(payments).where(eq(payments.id, dup));
        expect(why.r).toContain(o.numbers[1]);
        expect(why.r).toContain(o.numbers[0]);
        expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 0 });
        expect(await loadDuplicateHandPayments(tx, s)).toEqual([]);

        const voided = await tx.select({ a: auditLogs.after }).from(auditLogs)
          .where(and(eq(auditLogs.action, "PAYMENT_VOIDED"), eq(auditLogs.entityId, dup)));
        expect(voided).toHaveLength(1);
      }));

    it(`${name} كما وقع في الإنتاج: دُمجتا وبقي السداد رصيداً — فيظهر، ويتنحّى عنه الخصم الآليّ، و«ألغِ القيد المكرّر» يصلحه`, () =>
      withRollback(async (tx) => {
        const { s, older, newer, dup } = await twoPaidCopies(tx, o);
        const actor = await someone(tx);
        /* ما فعلته الشاشةُ يوم ٢٤ أكتوبر: الدمجُ بلا سؤال */
        const out = await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, actorId: actor });
        expect(out).toMatchObject({ releasedMinor: o.total, voidedMinor: 0 });
        expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: o.total });

        const [found] = await loadDuplicateHandPayments(tx, s);
        expect(found).toMatchObject({ paymentId: dup, creditMinor: o.total, release: { action: "INVOICE_MERGED" } });
        expect(found.why).toContain(o.numbers[0]);

        /* فاتورةٌ تصل بعدها لا يُغلقها الخصمُ الآليّ بمالٍ لم يخرج */
        expect(await duplicateHandHeldIds(tx, s)).toEqual(new Set([dup]));
        const next = await makeInvoice(tx, s, o.total, "2026-10-02");
        expect((await applySupplierCredit(tx, s, { forwardDays: 7 })).appliedMinor).toBe(0);
        expect(await tx.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, next))).toHaveLength(0);

        const fix = await voidDuplicateHandPayment(tx, { paymentId: dup, actorId: actor });
        expect(fix.balance.before).toEqual({ owedMinor: 0, creditLeftMinor: 0 });
        expect(fix.reopened).toEqual([]);
        expect(await statusOf(tx, dup)).toBe("VOID");
        /* لا رصيد وهميّ، والفاتورةُ الجديدة مستحقّةٌ كما هي */
        expect(await balanceOf(tx, s)).toEqual({ owed: o.total, credit: 0 });
        expect(await loadDuplicateHandPayments(tx, s)).toEqual([]);
      }));
  }

  it("مود القهوة بلا فاتورة بعدها: بعد «ألغِ القيد المكرّر» لا عليك ولا لك", () =>
    withRollback(async (tx) => {
      const { older, newer, dup } = await twoPaidCopies(tx, MOOD);
      const actor = await someone(tx);
      await mergeDuplicateInvoice(tx, { invoiceId: older, twinId: newer, fileOf: older, actorId: actor });
      const fix = await voidDuplicateHandPayment(tx, { paymentId: dup, actorId: actor });
      expect(fix.balance).toEqual({ before: { owedMinor: 0, creditLeftMinor: 204_30 }, after: { owedMinor: 0, creditLeftMinor: 0 } });
    }));

  it("حوالةٌ في الكشف فكّها الدمج تبقى رصيداً ولا تُلغى — ولو طُلب الإلغاء", () =>
    withRollback(async (tx) => {
      const { s, older, newer, dup } = await twoPaidCopies(tx, { ...MOOD, dropPaidBy: "bank" });
      expect((await previewMerge(tx, { invoiceId: newer, twinId: older })).duplicates).toEqual([]);
      const out = await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, handPayments: "void", actorId: await someone(tx) });
      expect(out).toMatchObject({ voidedMinor: 0, voidedPaymentIds: [], releasedMinor: 204_30 });
      expect(await statusOf(tx, dup)).toBe("UNAPPLIED");
      expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 204_30 });
      expect(await loadDuplicateHandPayments(tx, s)).toEqual([]);
      expect(await duplicateHandHeldIds(tx, s)).toEqual(new Set());
    }));

  it("الباقيةُ غيرُ مسدّدة: سدادُ الساقطة يسدّها كما كان ولا يُلغى", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const older = await makeInvoice(tx, s, 204_30, "2026-09-30");
      const newer = await makeInvoice(tx, s, 204_30, "2026-09-30");
      await tx.update(invoices).set({ createdAt: day("2026-10-01") }).where(eq(invoices.id, older));
      await tx.update(invoices).set({ createdAt: day("2026-10-20") }).where(eq(invoices.id, newer));
      const p = await handPay(tx, s, newer, 204_30, "2026-09-30");
      expect((await previewMerge(tx, { invoiceId: older, twinId: newer })).duplicates).toEqual([]);
      const out = await mergeDuplicateInvoice(tx, { invoiceId: older, twinId: newer, fileOf: older, handPayments: "void", actorId: await someone(tx) });
      expect(out).toMatchObject({ voidedMinor: 0, reappliedMinor: 204_30 });
      expect(await statusOf(tx, p)).toBe("APPLIED");
      expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 0 });
    }));
});

describe("«هي دفعةٌ حقيقيّة» والشهرُ المقفل", () => {
  it("الإقرارُ يُخرجها من القائمة ويعيدها للخصم الآليّ، والتراجعُ يعيد السؤال", () =>
    withRollback(async (tx) => {
      const { s, older, newer, dup } = await twoPaidCopies(tx, JMLA);
      const actor = await someone(tx);
      await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, actorId: actor });
      await decideDuplicateHandPayment(tx, { paymentId: dup, decision: "KEEP", actorId: actor });
      expect(await loadDuplicateHandPayments(tx, s)).toEqual([]);
      expect(await duplicateHandHeldIds(tx, s)).toEqual(new Set());
      const [row] = await tx.select().from(alertResolutions).where(eq(alertResolutions.key, `hand-dup:${dup}`));
      expect(row.decision).toBe("NOT_DUPLICATE");
      /* وما أُقرّ لا يُلغى من هذا الباب حتى يُعاد السؤال */
      expect(await caught(voidDuplicateHandPayment(tx, { paymentId: dup, actorId: actor }))).toBeInstanceOf(HandDuplicateRefused);

      await decideDuplicateHandPayment(tx, { paymentId: dup, decision: "OPEN", actorId: actor });
      expect((await loadDuplicateHandPayments(tx, s)).map((d) => d.paymentId)).toEqual([dup]);
    }));

  it("الشهرُ المقفل يردّ الإلغاء بأسمائه ولا يتغيّر شيء", () =>
    withRollback(async (tx) => {
      const { s, older, newer, dup } = await twoPaidCopies(tx, JMLA);
      const actor = await someone(tx);
      await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, actorId: actor });
      await tx.insert(monthCloses).values({ month: "2026-09", status: "CLOSED" });
      const e = await caught(voidDuplicateHandPayment(tx, { paymentId: dup, actorId: actor }));
      expect(e).toBeInstanceOf(HandDuplicateRefused);
      expect(e).toMatchObject({ payload: { months: ["2026-09"] } });
      expect(await statusOf(tx, dup)).toBe("UNAPPLIED");
      expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 382_00 });
    }));

  it("دفعةٌ ربطها أحدٌ بحوالةٍ بعد المعاينة لا تُلغى", () =>
    withRollback(async (tx) => {
      const { older, newer, dup, s } = await twoPaidCopies(tx, MOOD);
      const actor = await someone(tx);
      await mergeDuplicateInvoice(tx, { invoiceId: newer, twinId: older, fileOf: older, actorId: actor });
      const [imp] = await tx.insert(bankImports).values({ fileName: `handdup-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
      await tx.insert(bankTransactions).values({
        bankImportId: imp.id, valueDate: day("2026-09-30"), amountMinor: 204_30, direction: "DEBIT", category: "SUPPLIER", supplierId: s,
        description: "تحويل", matchedPaymentId: dup, matchStatus: "MATCHED",
      });
      expect(await caught(voidDuplicateHandPayment(tx, { paymentId: dup, actorId: actor }))).toBeInstanceOf(HandDuplicateRefused);
      expect(await statusOf(tx, dup)).toBe("UNAPPLIED");
    }));
});

describe("«حذف القيد» يعرض إلغاء السداد بيدٍ الذي لم يسدّد إلّا المحذوفة", () => {
  it("للمورّد سدادٌ آخر بالمبلغ نفسه: مقترَح، والإلغاءُ معه يترك الحساب متّزناً", () =>
    withRollback(async (tx) => {
      const { s, older, newer, dup } = await twoPaidCopies(tx, JMLA);
      const facts = await loadRemovalFacts(newer, tx);
      expect(facts.handOnly).toEqual([{ paymentId: dup, amountMinor: 382_00, method: "OWNER_ACCOUNT", paidOn: "2026-09-16", hasTwin: true }]);
      const out = await removeInvoiceEntry(tx, { invoiceId: newer, choice: { mode: "release", reallocate: false, voidHand: true }, actorId: await someone(tx) });
      expect(out).toMatchObject({ voidedMinor: 382_00, releasedMinor: 0, leftAsCreditMinor: 0 });
      expect(await statusOf(tx, dup)).toBe("VOID");
      expect(await balanceOf(tx, s)).toEqual({ owed: 0, credit: 0 });
      expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.supplierId, s))).toEqual([{ id: older }]);
    }));

  it("وبلا اختياره يبقى رصيداً كما كان — ثمّ يظهر سؤالاً", () =>
    withRollback(async (tx) => {
      const { s, newer, dup } = await twoPaidCopies(tx, JMLA);
      const out = await removeInvoiceEntry(tx, { invoiceId: newer, choice: { mode: "release", reallocate: false }, actorId: await someone(tx) });
      expect(out).toMatchObject({ voidedMinor: 0, leftAsCreditMinor: 382_00 });
      expect((await loadDuplicateHandPayments(tx, s)).map((d) => [d.paymentId, d.release?.action])).toEqual([[dup, "INVOICE_ENTRY_REMOVED"]]);
    }));

  it("حوالةُ الكشف لا تُعرض للإلغاء", () =>
    withRollback(async (tx) => {
      const { newer } = await twoPaidCopies(tx, { ...JMLA, dropPaidBy: "bank" });
      expect((await loadRemovalFacts(newer, tx)).handOnly).toEqual([]);
    }));
});
