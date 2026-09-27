import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, paymentAllocations, payments, users } from "@/db/schema";
import { allocate, createPayment, findManualTwin } from "./payment.service";
import { EchoMergeRefused, HandLinkRefused, reserveForHandPayments, loadCreditEchoes, mergeIntoCredit, linkHandPayment, loadHandPaymentLinks, loadPaymentEchoes, mergePaymentEcho } from "./account-review.service";
import { applySupplierCredit, drawBankCredit, undrawBankCredit } from "./supplier-credit.service";
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
async function waitingTransfer(
  tx: Tx, supplierId: string, amountMinor: number, iso: string, category: "SUPPLIER" | "UNKNOWN" = "SUPPLIER",
): Promise<string> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `dbtest-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [t] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT",
    matchStatus: "UNMATCHED", category, supplierId,
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

describe("سدادٌ بيدٍ خرج من حوالةٍ جامعة لم تُنسب — غاناش", () => {
  it("يُلغى الإقرارُ وتُسدَّد فاتورتُه من الحوالة، وينقص الرصيدُ بقدرها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 455_40, "2026-08-14");
      const lump = await bankPayment(tx, s, 5_225_60, "2026-08-03");
      const hand = await manualPaid(tx, s, inv, 455_40, "2026-08-14");

      const [e] = (await loadCreditEchoes(tx)).filter((x) => x.supplierId === s);
      expect(e).toMatchObject({ manualId: hand, amountMinor: 455_40, sources: [{ bankId: lump, amountMinor: 455_40 }] });

      await mergeIntoCredit(tx, hand, await someone(tx));
      const [m] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, hand));
      expect(m.status).toBe("VOID");
      expect(await allocationsOf(tx, lump)).toEqual([{ invoiceId: inv, amountMinor: 455_40 }]);
    }));

  it("لا يُدمج إن لم تسع الحوالةُ الإقرار", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 455_40, "2026-08-14");
      await bankPayment(tx, s, 100_00, "2026-08-03");
      const hand = await manualPaid(tx, s, inv, 455_40, "2026-08-14");
      expect(await caught(mergeIntoCredit(tx, hand, await someone(tx)))).toBeInstanceOf(EchoMergeRefused);
    }));
});

describe("التخصيصُ الثاني للدفعة نفسها على الفاتورة نفسها يُضاف — رونة", () => {
  it("٤٣٧ ثمّ ٢٥ على الفاتورة نفسها = ٤٦٢، لا ٤٣٧ مع «خُصّصت» كاذبة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 462_00, "2026-09-06");
      const pay = await createPayment(tx, { supplierId: s, paidAt: day("2026-09-06"), amountMinor: 462_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      await allocate(tx, pay, 462_00, [{ invoiceId: inv, amountMinor: 437_00 }]);
      const out = await allocate(tx, pay, 462_00, [{ invoiceId: inv, amountMinor: 25_00 }]);
      expect(out.allocatedMinor).toBe(25_00);
      expect(await allocationsOf(tx, pay)).toEqual([{ invoiceId: inv, amountMinor: 462_00 }]);
    }));
});

describe("كشفٌ يصل بعد «سُدّدت» — الحالةُ التي وصفها أحمد: ٣٬٠٠٠ ريال", () => {
  it("حوالةٌ عُرف مورّدُها وبابُها «غير معروف» تُربط بالسداد اليدويّ ولا تنتظر إقراراً يكتب دفعةً ثانية", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 3000_00, "2026-09-01");
      const hand = await manualPaid(tx, s, inv, 3000_00, "2026-09-04");
      const t = await waitingTransfer(tx, s, 3000_00, "2026-09-04", "UNKNOWN");
      const [l] = (await loadHandPaymentLinks(tx)).filter((x) => x.supplierId === s);
      expect(l).toMatchObject({ transferId: t, paymentId: hand, exact: true });
    }));

  it("فاتورةٌ ثانيةٌ مفتوحةٌ بالمبلغ نفسه لا تأخذ الحوالة — تُحجَز للسداد المقيَّد ولو قُيِّد بعدها بأيّام", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const first = await makeInvoice(tx, s, 3000_00, "2026-09-01");
      await makeInvoice(tx, s, 3000_00, "2026-09-10");
      /* الحوالةُ يومَ ٤، وقيدُها بيدٍ يومَ ٨ — «سُدّدت» يُؤرَّخ يومَ قيده */
      const hand = await manualPaid(tx, s, first, 3000_00, "2026-09-08");

      const reserved = await reserveForHandPayments([
        { key: "row-1", supplierId: s, day: "2026-09-04", amountMinor: 3000_00, direction: "DEBIT" },
        { key: "row-2", supplierId: s, day: "2026-09-04", amountMinor: 1200_00, direction: "DEBIT" },
      ], tx);
      expect([...reserved]).toEqual([["row-1", hand]]);

      /* والتبنّي عند الكتابة يجده كذلك — نافذةٌ متماثلة لا ‎−14/+3 */
      expect((await findManualTwin(tx, { supplierId: s, paidAt: day("2026-09-04"), amountMinor: 3000_00 }))?.id).toBe(hand);
    }));

  it("والسدادُ الذي له حركةُ بنكٍ لا يُحجَز له شيء — الحوالةُ الجديدة دفعةٌ أخرى حقّاً", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await bankPayment(tx, s, 3000_00, "2026-09-04");
      const reserved = await reserveForHandPayments([
        { key: "row-1", supplierId: s, day: "2026-09-05", amountMinor: 3000_00, direction: "DEBIT" },
      ], tx);
      expect(reserved.size).toBe(0);
    }));
});


describe("الرصيدُ الوهميّ لا يُخصَم آلياً — حوالةٌ هي صدى سدادٍ مقيَّد", () => {
  it("فاتورةٌ جديدة لا تُغلَق بحوالةٍ هي سدادُ فاتورةٍ أخرى، والإنسانُ يقرّر", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const a = await makeInvoice(tx, s, 1000_00, "2026-09-01");
      await manualPaid(tx, s, a, 1000_00, "2026-09-03");
      /* الكشفُ كتب الحوالةَ دفعةً بلا تخصيص — رصيدٌ «لنا» في الظاهر */
      await bankPayment(tx, s, 1000_00, "2026-09-02");
      const b = await makeInvoice(tx, s, 1000_00, "2026-09-05");

      const auto = await applySupplierCredit(tx, s, { forwardDays: 7 });
      expect(auto.appliedMinor).toBe(0);
      const n = await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_allocations where invoice_id = ${b}`);
      expect(Number(n.rows[0].n)).toBe(0);
    }));
});

describe("رسمُ التحويل في الربط بالسداد اليدويّ", () => {
  it("٣٬٠٠٥٫٧٥ على سدادٍ بـ٣٬٠٠٠: الزائدُ رسمٌ لا رصيدٌ للمورّد، والآليُّ بيد النظام", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 3000_00, "2026-09-01");
      const hand = await manualPaid(tx, s, inv, 3000_00, "2026-09-04");
      const t = await waitingTransfer(tx, s, 3005_75, "2026-09-04");
      await makeInvoice(tx, s, 500_00, "2026-09-06");

      await linkHandPayment(tx, { transferId: t, paymentId: hand }, await someone(tx), "SYSTEM");
      const [p] = await tx.select({ a: payments.amountMinor, f: payments.feeMinor }).from(payments).where(eq(payments.id, hand));
      expect(p).toEqual({ a: 3005_75, f: 5_75 });
      /* لا شيءَ خُصم من الفاتورة الثانية */
      expect(await allocationsOf(tx, hand)).toEqual([{ invoiceId: inv, amountMinor: 3000_00 }]);
      const [d] = (await tx.execute<{ event: string; actor: string }>(sql`
        select event::text, actor from decision_history where bank_transaction_id = ${t}
      `)).rows;
      expect(d).toEqual({ event: "POSTED", actor: "SYSTEM" });
    }));
});

describe("لا مالَ على فاتورةٍ لم يُقِرّها أحد", () => {
  it("الخصمُ الآليّ يتخطّى فاتورةً مستندُها ينتظر المراجعة، ويخصم بعد الإقرار", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await createPayment(tx, { supplierId: s, paidAt: day("2026-09-01"), amountMinor: 700_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      const inv = await makeInvoice(tx, s, 700_00, "2026-09-03");
      await tx.execute(sql`update documents set status = 'NEEDS_REVIEW' where id = (select document_id from invoices where id = ${inv})`);

      expect((await applySupplierCredit(tx, s, { forwardDays: 7 })).appliedMinor).toBe(0);

      await tx.execute(sql`update documents set status = 'ARCHIVED' where id = (select document_id from invoices where id = ${inv})`);
      expect((await applySupplierCredit(tx, s, { forwardDays: 7 })).appliedMinor).toBe(700_00);
    }));
});
