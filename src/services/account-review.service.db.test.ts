import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, paymentAllocations, payments, users } from "@/db/schema";
import { allocate, createPayment } from "./payment.service";
import { EchoMergeRefused, HandLinkRefused, linkHandPayment, loadHandPaymentLinks, loadPaymentEchoes, mergePaymentEcho } from "./account-review.service";
import { drawBankCredit, undrawBankCredit } from "./supplier-credit.service";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import type { Tx } from "./types";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/** حوالةٌ من الكشف: دفعةٌ وحركةُ بنكٍ موصولةٌ بها. */
async function bankPayment(tx: Tx, supplierId: string, amountMinor: number, iso: string): Promise<string> {
  const id = await createPayment(tx, {
    supplierId, paidAt: day(iso), amountMinor, method: "BANK_TRANSFER", acknowledgeTwin: true,
  });
  const [imp] = await tx.insert(bankImports).values({ fileName: `dbtest-${id}.xlsx` }).returning({ id: bankImports.id });
  await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT",
    matchedPaymentId: id, matchStatus: "MATCHED", category: "SUPPLIER",
  });
  return id;
}

/** إقرارٌ باليد «سُدّدت» كما كتبه `/api/mark-paid` قبل الإصلاح. */
async function manualPaid(tx: Tx, supplierId: string, invoiceId: string, amountMinor: number, iso: string): Promise<string> {
  const id = await createPayment(tx, {
    supplierId, paidAt: day(iso), amountMinor, method: "BANK_TRANSFER", acknowledgeTwin: true,
  });
  await allocate(tx, id, amountMinor, [{ invoiceId, amountMinor }]);
  return id;
}

const allocationsOf = async (tx: Tx, paymentId: string) =>
  tx.select({ invoiceId: paymentAllocations.invoiceId, amountMinor: paymentAllocations.amountMinor })
    .from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));

describe("الدفعةُ التي قُيِّدت مرّتين — كوهي كما في الإنتاج", () => {
  it("يُكشف الصدى، ويُدمج: يُلغى الإقرار وتأخذ الحوالةُ فاتورتَه، والفاتورةُ الأحدث تظهر مفتوحة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const aug6 = await makeInvoice(tx, s, 833_75, "2026-08-06");
      await makeInvoice(tx, s, 833_75, "2026-09-16");
      const bank = await bankPayment(tx, s, 833_75, "2026-08-05");
      const manual = await manualPaid(tx, s, aug6, 833_75, "2026-08-06");

      const echoes = (await loadPaymentEchoes(tx)).filter((e) => e.supplierId === s);
      expect(echoes).toHaveLength(1);
      expect(echoes[0]).toMatchObject({ manualId: manual, bankId: bank, daysApart: 1 });
      expect(echoes[0].invoices.map((i) => i.id)).toEqual([aug6]);

      await mergePaymentEcho(tx, { manualId: manual, bankId: bank }, await someone(tx));

      const [m] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, manual));
      expect(m.status).toBe("VOID");
      expect(await allocationsOf(tx, manual)).toEqual([]);
      expect(await allocationsOf(tx, bank)).toEqual([{ invoiceId: aug6, amountMinor: 833_75 }]);
      /* لا صدى بعد الدمج */
      expect((await loadPaymentEchoes(tx)).filter((e) => e.supplierId === s)).toEqual([]);
    }));

  it("يُرفض دمجُ ما ليس صدى — الخادمُ يعيد اشتقاق الزوج", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 575_00, "2026-08-13");
      const bank = await bankPayment(tx, s, 575_00, "2026-08-13");
      const manual = await manualPaid(tx, s, inv, 575_00, "2026-08-13");
      /* الحوالةُ نُسبت كلُّها إلى فاتورةٍ أخرى — فالإقرارُ واقعةٌ أخرى */
      const other = await makeInvoice(tx, s, 575_00, "2026-08-10");
      await allocate(tx, bank, 575_00, [{ invoiceId: other, amountMinor: 575_00 }]);
      const e = await caught(mergePaymentEcho(tx, { manualId: manual, bankId: bank }, await someone(tx)));
      expect(e).toBeInstanceOf(EchoMergeRefused);
    }));
});

describe("«سجّل أنّها سُدّدت» يأخذ حوالةَ الكشف غيرَ المنسوبة أوّلاً", () => {
  it("يُنسب من الحوالة ولا يبقى شيءٌ يُقيَّد إقراراً، والتراجعُ يفكّها ولا يلغيها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 575_00, "2026-09-15");
      const bank = await bankPayment(tx, s, 575_00, "2026-08-13");

      const out = await drawBankCredit(tx, { supplierId: s, invoiceId: inv, remainingMinor: 575_00, paidOn: "2026-09-20" });
      expect(out.restMinor).toBe(0);
      expect(out.drawn).toEqual([{ paymentId: bank, invoiceId: inv, amountMinor: 575_00, paidOn: "2026-08-13" }]);

      const freed = await undrawBankCredit(tx, out.drawn);
      expect(freed).toBe(575_00);
      expect(await allocationsOf(tx, bank)).toEqual([]);
      const [b] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, bank));
      expect(b.status).not.toBe("VOID");
    }));

  it("حوالةٌ أبعد من النافذة، أو دفعةٌ بلا حركة بنك، لا تُؤخذ", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 100_00, "2026-09-15");
      await bankPayment(tx, s, 100_00, "2026-05-01");
      await createPayment(tx, { supplierId: s, paidAt: day("2026-09-10"), amountMinor: 100_00, method: "CASH", acknowledgeTwin: true });
      const out = await drawBankCredit(tx, { supplierId: s, invoiceId: inv, remainingMinor: 100_00, paidOn: "2026-09-20" });
      expect(out).toEqual({ drawn: [], restMinor: 100_00 });
      const n = await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_allocations where invoice_id = ${inv}`);
      expect(Number(n.rows[0].n)).toBe(0);
    }));
});

/** حوالةٌ في الطابور: عُرف مورّدُها ولم تُربط بدفعة. */
async function waitingTransfer(tx: Tx, supplierId: string, amountMinor: number, iso: string): Promise<string> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `dbtest-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [t] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT",
    matchStatus: "UNMATCHED", category: "SUPPLIER", supplierId,
  }).returning({ id: bankTransactions.id });
  return t.id;
}

describe("حوالةُ الطابور وسدادُها المقيَّد بيد — مختبرات القهوة ورونة", () => {
  it("المبلغُ نفسه: تُربط الحوالةُ بالدفعة ولا تُنشأ ثانية، والفاتورةُ تبقى مسدَّدة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 638_00, "2026-09-08");
      const hand = await manualPaid(tx, s, inv, 638_00, "2026-09-08");
      const t = await waitingTransfer(tx, s, 638_00, "2026-09-08");

      const [l] = (await loadHandPaymentLinks(tx)).filter((x) => x.supplierId === s);
      expect(l).toMatchObject({ transferId: t, paymentId: hand, exact: true, extraMinor: 0 });

      await linkHandPayment(tx, l, await someone(tx));
      const [bt] = await tx.select({ p: bankTransactions.matchedPaymentId, st: bankTransactions.matchStatus })
        .from(bankTransactions).where(eq(bankTransactions.id, t));
      expect(bt).toEqual({ p: hand, st: "MATCHED" });
      const n = await tx.execute<{ n: number }>(sql`select count(*)::int as n from payments where supplier_id = ${s}`);
      expect(Number(n.rows[0].n)).toBe(1);
      expect(await allocationsOf(tx, hand)).toEqual([{ invoiceId: inv, amountMinor: 638_00 }]);
    }));

  it("الحوالةُ أكبر: تأخذ الدفعةُ مبلغَها، والزائدُ رصيدٌ لا يُخصَّص على الفاتورة نفسها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 437_00, "2026-09-06");
      const hand = await manualPaid(tx, s, inv, 437_00, "2026-09-06");
      const t = await waitingTransfer(tx, s, 462_00, "2026-09-06");
      const [l] = (await loadHandPaymentLinks(tx)).filter((x) => x.supplierId === s);
      expect(l).toMatchObject({ exact: false, extraMinor: 25_00 });

      await linkHandPayment(tx, { transferId: t, paymentId: hand }, await someone(tx));
      const [p] = await tx.select({ a: payments.amountMinor }).from(payments).where(eq(payments.id, hand));
      expect(p.a).toBe(462_00);
      expect(await allocationsOf(tx, hand)).toEqual([{ invoiceId: inv, amountMinor: 437_00 }]);
    }));

  it("لا يُربط ما ليس زوجاً — الحوالةُ أقلّ من الدفعة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 500_00, "2026-09-06");
      const hand = await manualPaid(tx, s, inv, 500_00, "2026-09-06");
      const t = await waitingTransfer(tx, s, 400_00, "2026-09-06");
      const e = await caught(linkHandPayment(tx, { transferId: t, paymentId: hand }, await someone(tx)));
      expect(e).toBeInstanceOf(HandLinkRefused);
    }));
});
