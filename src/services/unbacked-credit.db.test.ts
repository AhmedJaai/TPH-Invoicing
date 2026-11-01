import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLogs, paymentAllocations, statementLines, statements, users } from "@/db/schema";
import { applyUnbackedPaymentToOpenInvoices, findCreditNoteEvidence } from "./unbacked-credit.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { allocate, createPayment, reversePayment } from "./payment.service";
import { Refused } from "@/lib/domain-error";
import { caught, day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import type { Tx } from "./types";

/**
 * أفال: دفعةٌ زادت واستُردّت بخصمها من لاحقة، وفواتيرُه المفتوحة أحدثُ منها بأشهر — فالخصمُ الآليّ (سبعةُ أيام) لا يبلغها
 * ويبقى «دفعةٌ بلا فاتورة» وفي الجهة الأخرى «مفتوحٌ» والحسابُ يطابق على الورق. والقرارُ لصاحبها بجملةٍ تُحفظ.
 */
async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function aval(tx: Tx) {
  const supplierId = await makeSupplier(tx);
  const first = await makeInvoice(tx, supplierId, 600_00, "2099-01-10");
  const paymentId = await createPayment(tx, { supplierId, paidAt: day("2099-01-20"), amountMinor: 1_000_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
  await allocate(tx, paymentId, [{ invoiceId: first, amountMinor: 600_00 }]);
  const later = await makeInvoice(tx, supplierId, 400_00, "2099-04-10");
  return { supplierId, paymentId, first, later, me: await someone(tx) };
}

const allocatedTo = async (tx: Tx, invoiceId: string) =>
  Number((await tx.select({ s: sql<string>`coalesce(sum(${paymentAllocations.amountMinor}), 0)` }).from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId)))[0].s);

describe("سدادُ الفواتير المفتوحة بدفعةٍ زادت", () => {
  it("الخصمُ الآليّ لا يبلغ فاتورةً بعد ثلاثة أشهر، وقرارُ صاحبها يخصّصها ويكتب شرحَه", () =>
    withRollback(async (tx) => {
      const s = await aval(tx);
      await applySupplierCredit(tx, s.supplierId, { forwardDays: 7 });
      expect(await allocatedTo(tx, s.later)).toBe(0);

      const out = await applyUnbackedPaymentToOpenInvoices({ paymentId: s.paymentId, note: "دفعنا زيادة واستردّها المورّد من الدفعة الأخيرة", actorId: s.me }, tx);
      expect(out).toEqual({ appliedMinor: 400_00, invoiceCount: 1, leftMinor: 0 });
      expect(await allocatedTo(tx, s.later)).toBe(400_00);

      const logs = await tx.select({ after: auditLogs.after }).from(auditLogs).where(eq(auditLogs.entityId, s.paymentId));
      expect(JSON.stringify(logs.map((l) => l.after))).toContain("دفعنا زيادة واستردّها المورّد");
    }));

  it("ضغطةٌ ثانية لا تُسدّد شيئاً ثانيةً: لا باقيَ في الدفعة", () =>
    withRollback(async (tx) => {
      const s = await aval(tx);
      await applyUnbackedPaymentToOpenInvoices({ paymentId: s.paymentId, note: "استردادُ زيادة", actorId: s.me }, tx);
      expect(await caught(applyUnbackedPaymentToOpenInvoices({ paymentId: s.paymentId, note: "استردادُ زيادة", actorId: s.me }, tx))).toBeInstanceOf(Refused);
      expect(await allocatedTo(tx, s.later)).toBe(400_00);
    }));

  it("بلا فاتورةٍ مفتوحة، أو بلا شرح، أو لدفعةٍ مردودة: يُرفض ولا يُكتب شيء", () =>
    withRollback(async (tx) => {
      const s = await aval(tx);
      expect(await caught(applyUnbackedPaymentToOpenInvoices({ paymentId: s.paymentId, note: " ", actorId: s.me }, tx))).toBeInstanceOf(Refused);

      const lone = await makeSupplier(tx);
      const p = await createPayment(tx, { supplierId: lone, paidAt: day("2099-01-20"), amountMinor: 500_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      expect(await caught(applyUnbackedPaymentToOpenInvoices({ paymentId: p, note: "لا فواتير لها", actorId: s.me }, tx))).toBeInstanceOf(Refused);

      await reversePayment(tx, { paymentId: s.paymentId, kind: "REVERSED", reason: "اختبار", userId: s.me });
      expect(await caught(applyUnbackedPaymentToOpenInvoices({ paymentId: s.paymentId, note: "بعد الردّ", actorId: s.me }, tx))).toBeInstanceOf(Refused);
      expect(await allocatedTo(tx, s.later)).toBe(0);
    }));

  it("الدليل: سطرُ إشعارٍ دائن بمبلغ الباقي بالهللة — لا سدادٌ بالمبلغ نفسه، ولا مبلغٌ مختلف", () =>
    withRollback(async (tx) => {
      const s = await aval(tx);
      const [st] = await tx.insert(statements).values({
        documentId: await makeDocument(tx, s.supplierId, "2099-04-25"), supplierId: s.supplierId,
        periodStart: day("2099-04-01"), periodEnd: day("2099-04-25"),
      }).returning({ id: statements.id });
      await tx.insert(statementLines).values([
        { statementId: st.id, date: day("2099-04-12"), ref: "RINV/2099/00016 (Reversal of: INV/2099/00080)", creditMinor: 400_00, matchStatus: "IGNORED" },
        { statementId: st.id, date: day("2099-04-13"), ref: "حوالة بنكية", creditMinor: 123_00 },
        { statementId: st.id, date: day("2099-04-14"), ref: "RINV/2099/00017", creditMinor: 399_99 },
      ]);
      expect(await findCreditNoteEvidence(s.supplierId, 400_00, tx)).toEqual({ ref: "RINV/2099/00016 (Reversal of: INV/2099/00080)", dateIso: "2099-04-12", amountMinor: 400_00 });
      expect(await findCreditNoteEvidence(s.supplierId, 123_00, tx)).toBeNull();
      expect(await findCreditNoteEvidence(s.supplierId, 400_01, tx)).toBeNull();
      expect(await findCreditNoteEvidence(s.supplierId, 0, tx)).toBeNull();

      /* ويُحفظ مع القرار — لا من المتصفّح */
      await applySupplierCredit(tx, s.supplierId, { forwardDays: 7 });
      await applyUnbackedPaymentToOpenInvoices({ paymentId: s.paymentId, note: "استردادُ زيادة بإشعار المورّد", actorId: s.me }, tx);
      const logs = await tx.select({ after: auditLogs.after }).from(auditLogs).where(eq(auditLogs.entityId, s.paymentId));
      expect(JSON.stringify(logs.map((l) => l.after))).toContain("RINV/2099/00016");
    }));
});
