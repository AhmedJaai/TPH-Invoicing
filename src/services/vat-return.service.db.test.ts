import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, documents, invoices, users, vatFilings } from "@/db/schema";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { parseVatPeriod } from "@/lib/vat-return";
import { allocate, createPayment } from "./payment.service";
import {
  chooseVatInvoices, chooseVatTxs, fileVatReturn, loadVatReturn, setVatCashSales, VatChoiceRefused, voidVatFiling,
} from "./vat-return.service";
import type { Tx } from "./types";

/*
  الاستعلامُ خامّ بشرطٍ مركّب (`COVERED_BY_INVOICE`) — من الصنف الذي صمت مرّتين وأرجع صفراً.
  فيُختبر على المخطّط الحقيقيّ، في ربعٍ بعيدٍ لا بيانات فيه.
*/
const Q = parseVatPeriod("2098-Q3")!;

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `vat-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function bankTx(tx: Tx, o: {
  iso: string; amountMinor: number; direction?: "DEBIT" | "CREDIT"; category?: "SUPPLIER" | "SALARY" | "RENT" | "POS_SETTLEMENT";
  supplierId?: string; paymentId?: string; at?: Date;
}): Promise<string> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `vat-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [row] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: o.at ?? day(o.iso), amountMinor: o.amountMinor, direction: o.direction ?? "DEBIT",
    category: o.category ?? "SUPPLIER", supplierId: o.supplierId,
    ...(o.paymentId ? { matchedPaymentId: o.paymentId, matchStatus: "MATCHED" as const } : {}),
  }).returning({ id: bankTransactions.id });
  return row.id;
}

/** فاتورةٌ وحوالتُها المطابَقة — والفاتورةُ «لا تُخصم» إن طُلب. */
async function paidInvoice(tx: Tx, eligible: boolean) {
  const s = await makeSupplier(tx);
  const inv = await makeInvoice(tx, s, 1150_00, "2098-08-10");
  if (!eligible) await tx.update(invoices).set({ inputVatStatus: "NOT_ELIGIBLE" }).where(eq(invoices.id, inv));
  const pay = await createPayment(tx, { supplierId: s, paidAt: day("2098-08-12"), amountMinor: 1150_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
  await allocate(tx, pay, 1150_00, [{ invoiceId: inv, amountMinor: 1150_00 }]);
  const out = await bankTx(tx, { iso: "2098-08-12", amountMinor: 1150_00, supplierId: s, paymentId: pay });
  return { s, inv, out };
}

describe("الحوالةُ التي سدّدت فاتورةً محسوبة «مغطّاة» — لا تُخصم ضريبتُها مرّتين", () => {
  it("فاتورةٌ مستوفية: حوالتُها مغطّاة، وضمُّها يُرفض", () =>
    withRollback(async (tx) => {
      const actor = await someone(tx);
      const p = await paidInvoice(tx, true);
      const view = await loadVatReturn(Q, tx);
      expect(view.txs.find((t) => t.id === p.out)).toMatchObject({ coveredByInvoice: true, included: false });
      expect(view.result.input.invoices.vatMinor).toBe(150_00);
      expect(await caught(chooseVatTxs([p.out], true, actor, tx))).toBeInstanceOf(VatChoiceRefused);
    }));

  it("فاتورةٌ «لا تُخصم» حُسبت بإقرار صاحبها: حوالتُها تصير مغطّاة — كانت تبقى قابلةً للضمّ", () =>
    withRollback(async (tx) => {
      const actor = await someone(tx);
      const p = await paidInvoice(tx, false);

      /* قبل الإقرار: لا ضريبةَ من الفاتورة، والحوالةُ تُضمّ */
      let view = await loadVatReturn(Q, tx);
      expect(view.txs.find((t) => t.id === p.out)?.coveredByInvoice).toBe(false);
      await chooseVatTxs([p.out], true, actor, tx);
      view = await loadVatReturn(Q, tx);
      expect(view.result.input.totalMinor).toBe(150_00);

      /* «احسبها»: الضريبةُ من الفاتورة وحدها — والحوالةُ المختارةُ من قبل لا تُعدّ معها */
      await chooseVatInvoices([p.inv], true, actor, tx);
      view = await loadVatReturn(Q, tx);
      expect(view.txs.find((t) => t.id === p.out)).toMatchObject({ coveredByInvoice: true, included: false });
      expect(view.result.input.invoices.vatMinor).toBe(150_00);
      expect(view.result.input.selected.vatMinor).toBe(0);
      expect(view.result.input.totalMinor).toBe(150_00);
      expect(await caught(chooseVatTxs([p.out], true, actor, tx))).toBeInstanceOf(VatChoiceRefused);
    }));

  it("فاتورةٌ مستوفية أخرجها صاحبُها: لا تغطّي حوالتَها", () =>
    withRollback(async (tx) => {
      const actor = await someone(tx);
      const p = await paidInvoice(tx, true);
      await chooseVatInvoices([p.inv], false, actor, tx);
      const view = await loadVatReturn(Q, tx);
      expect(view.txs.find((t) => t.id === p.out)?.coveredByInvoice).toBe(false);
      expect(view.result.input.invoices.vatMinor).toBe(0);
    }));

  it("حوالةٌ غيرُ مطابَقة لمورّدٍ له فاتورةٌ محسوبة في الربع السابق: تحذير", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await makeInvoice(tx, s, 1150_00, "2098-06-20");
      const out = await bankTx(tx, { iso: "2098-07-03", amountMinor: 1150_00, supplierId: s });
      const view = await loadVatReturn(Q, tx);
      expect(view.txs.find((t) => t.id === out)).toMatchObject({ coveredByInvoice: false, supplierHasInvoices: true });
    }));
});

describe("ما لا يدخل الخصم", () => {
  it("فاتورةٌ مستندُها ينتظر المراجعة لا تُحسب حتى تُراجَع", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 1150_00, "2098-08-10");
      const [row] = await tx.select({ documentId: invoices.documentId }).from(invoices).where(eq(invoices.id, inv));
      await tx.update(documents).set({ status: "NEEDS_REVIEW" }).where(eq(documents.id, row.documentId));
      const view = await loadVatReturn(Q, tx);
      expect(view.invoices.find((i) => i.id === inv)).toMatchObject({ included: false, awaitingReview: true });
      expect(view.result.input.invoices.vatMinor).toBe(0);
    }));

  it("الراتبُ لا يُضمّ ولو وصل معرّفُه — والإيجارُ يُضمّ", () =>
    withRollback(async (tx) => {
      const actor = await someone(tx);
      const salary = await bankTx(tx, { iso: "2098-08-01", amountMinor: 4000_00, category: "SALARY" });
      const rent = await bankTx(tx, { iso: "2098-08-01", amountMinor: 11500_00, category: "RENT" });
      expect(await caught(chooseVatTxs([salary], true, actor, tx))).toBeInstanceOf(VatChoiceRefused);
      await chooseVatTxs([rent], true, actor, tx);
      expect((await loadVatReturn(Q, tx)).result.input.selected.vatMinor).toBe(1500_00);
    }));

  it("حدُّ الربع بتوقيت الرياض: ٣٠ سبتمبر ٢١:٣٠ UTC هو ١ أكتوبر", () =>
    withRollback(async (tx) => {
      const late = await bankTx(tx, { iso: "", at: new Date("2098-09-30T21:30:00Z"), amountMinor: 115_00, direction: "CREDIT", category: "POS_SETTLEMENT" });
      const inside = await bankTx(tx, { iso: "", at: new Date("2098-09-30T20:30:00Z"), amountMinor: 115_00, direction: "CREDIT", category: "POS_SETTLEMENT" });
      const q3 = await loadVatReturn(Q, tx);
      expect(q3.txs.some((t) => t.id === inside)).toBe(true);
      expect(q3.txs.some((t) => t.id === late)).toBe(false);
      expect((await loadVatReturn(parseVatPeriod("2098-Q4")!, tx)).txs.some((t) => t.id === late)).toBe(true);
    }));
});

describe("النقدُ ولقطةُ التقديم", () => {
  it("نقدٌ غير مودَع يدخل المخرجات، ومحوُه يعيد «لم يُكتب»", () =>
    withRollback(async (tx) => {
      const actor = await someone(tx);
      await setVatCashSales("2098-08", 1150_00, actor, tx);
      let view = await loadVatReturn(Q, tx);
      expect(view.result.output.vatMinor).toBe(150_00);
      expect(view.cash.find((c) => c.month === "2098-08")?.grossMinor).toBe(1150_00);
      await setVatCashSales("2098-08", null, actor, tx);
      view = await loadVatReturn(Q, tx);
      expect(view.cash.find((c) => c.month === "2098-08")?.grossMinor).toBeNull();
    }));

  it("ربعٌ لم ينتهِ لا يُقدَّم", () =>
    withRollback(async (tx) => {
      const e = await caught(fileVatReturn({ periodKey: "2098-Q3", filedOn: "2098-10-05", reference: null, creditDisposition: null }, await someone(tx), tx));
      expect(e).toBeInstanceOf(VatChoiceRefused);
    }));

  it("التقديمُ يحفظ الرقم ويقفل الاختيارات، والرصيدُ الدائن يُرحَّل، والتراجعُ يفتح", () =>
    withRollback(async (tx) => {
      const actor = await someone(tx);
      /* ربعٌ مضى: فاتورةٌ بضريبة 150 ولا مبيعات — رصيدٌ دائن */
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 1150_00, "2001-02-10");
      const period = { periodKey: "2001-Q1", filedOn: "2001-04-10", reference: "ZATCA-1" };

      expect(await caught(fileVatReturn({ ...period, creditDisposition: null }, actor, tx))).toBeInstanceOf(VatChoiceRefused);
      const filing = await fileVatReturn({ ...period, creditDisposition: "CARRY" }, actor, tx);
      expect(filing).toMatchObject({ netMinor: -150_00, inputVatMinor: 150_00, creditDisposition: "CARRY" });
      expect(await caught(fileVatReturn({ ...period, creditDisposition: "CARRY" }, actor, tx))).toBeInstanceOf(VatChoiceRefused);

      /* مقفل: لا اختيارَ ولا نقد */
      expect(await caught(chooseVatInvoices([inv], false, actor, tx))).toBeInstanceOf(VatChoiceRefused);
      expect(await caught(setVatCashSales("2001-03", 100_00, actor, tx))).toBeInstanceOf(VatChoiceRefused);

      /* الربعُ التالي يبدأ بالرصيد المرحَّل */
      const next = await loadVatReturn(parseVatPeriod("2001-Q2")!, tx);
      expect(next.result.carriedInMinor).toBe(150_00);
      expect(next.result.netMinor).toBe(-150_00);

      await voidVatFiling("2001-Q1", "خطأ في التسجيل", actor, tx);
      await chooseVatInvoices([inv], false, actor, tx);
      const [kept] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from vat_filings where period_key = '2001-Q1'`)).rows;
      expect(kept.n).toBe(1);
      const live = await tx.select().from(vatFilings).where(sql`${vatFilings}.period_key = '2001-Q1' and ${vatFilings}.voided_at is null`);
      expect(live).toHaveLength(0);
      expect((await loadVatReturn(parseVatPeriod("2001-Q2")!, tx)).result.carriedInMinor).toBe(0);
    }));
});
