import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, monthCloses, paymentAllocations, payments, users } from "@/db/schema";
import { UndoError, undoMarkedPaid } from "./mark-paid-undo.service";
import { allocate, createPayment } from "./payment.service";
import { MonthClosedError } from "./validation.service";
import { caught, day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import type { Tx } from "./types";

/**
 * التراجعُ عن «سجّل أنّها سُدّدت» — «كلُّ مطابقةٍ قابلةٌ للتراجع، والردُّ لا يحذف».
 *
 * الزرُّ في إشعارٍ يُضغَط بعد خطأ، فحدودُه هي ما يُختبَر: يعيد الفاتورةَ مفتوحةً
 * بالهللة ويُبقي الدفعةَ وأثرَها، ولا يصير باباً لإلغاء مالٍ قديم أو مالٍ له
 * مستند أو شهرٍ مقفل.
 */
const TOTAL = 1_150_00;

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/** إقرارُ سدادٍ كما يكتبه `/api/mark-paid`: دفعةٌ من حساب المالك مخصَّصةٌ كلُّها لفاتورة. */
async function markedPaid(tx: Tx, over: { documentId?: string } = {}) {
  const supplierId = await makeSupplier(tx);
  const invoiceId = await makeInvoice(tx, supplierId, TOTAL, "2026-08-10");
  const paymentId = await createPayment(tx, {
    supplierId, paidAt: day("2026-08-12"), amountMinor: TOTAL, method: "OWNER_ACCOUNT", ...over,
  });
  await allocate(tx, paymentId, [{ invoiceId, amountMinor: TOTAL }]);
  return { supplierId, invoiceId, paymentId };
}

async function allocatedTo(tx: Tx, invoiceId: string): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<string>`coalesce(sum(${paymentAllocations.amountMinor}), 0)` })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.invoiceId, invoiceId));
  return Number(row.sum);
}

async function paymentRow(tx: Tx, paymentId: string) {
  const [row] = await tx
    .select({ status: payments.status, reason: payments.reversalReason, amountMinor: payments.amountMinor })
    .from(payments)
    .where(eq(payments.id, paymentId));
  return row;
}

async function voidAudits(tx: Tx, paymentId: string): Promise<number> {
  const rows = await tx
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, paymentId), eq(auditLogs.action, "PAYMENT_VOIDED")));
  return rows.length;
}

describe("undoMarkedPaid — إلغاءٌ لا حذف", () => {
  it("تعود الفاتورةُ مفتوحةً بالهللة، وتبقى الدفعةُ ملغاةً بسببها، وفي السجلّ سطرُها", () =>
    withRollback(async (tx) => {
      const { invoiceId, paymentId } = await markedPaid(tx);
      expect(await allocatedTo(tx, invoiceId)).toBe(TOTAL);

      const out = await undoMarkedPaid(tx, [paymentId], await someone(tx));

      expect(out).toEqual({ voided: 1, freedMinor: TOTAL });
      expect(await allocatedTo(tx, invoiceId)).toBe(0);
      const row = await paymentRow(tx, paymentId);
      expect(row.status).toBe("VOID");
      expect(row.amountMinor).toBe(TOTAL);
      expect(row.reason).toContain("تراجعٌ عن إقرار سداد");
      expect(await voidAudits(tx, paymentId)).toBe(1);
    }));

  it("التراجعُ مرّتين لا يُنتج أثراً ثانياً — 409 ولا سطرَ تدقيقٍ جديد", () =>
    withRollback(async (tx) => {
      const { invoiceId, paymentId } = await markedPaid(tx);
      const who = await someone(tx);
      await undoMarkedPaid(tx, [paymentId], who);

      const e = await caught(undoMarkedPaid(tx, [paymentId], who));
      expect(e).toBeInstanceOf(UndoError);
      expect((e as UndoError).status).toBe(409);
      expect(await voidAudits(tx, paymentId)).toBe(1);
      expect(await allocatedTo(tx, invoiceId)).toBe(0);
    }));

  it("بعد نافذة التراجع لا يُلغى من الإشعار — والدفعةُ وتخصيصُها كما هما", () =>
    withRollback(async (tx) => {
      const { invoiceId, paymentId } = await markedPaid(tx);
      await tx.execute(sql`update payments set created_at = now() - interval '31 minutes' where id = ${paymentId}`);

      const e = await caught(undoMarkedPaid(tx, [paymentId], await someone(tx)));
      expect(e).toBeInstanceOf(UndoError);
      expect((e as UndoError).status).toBe(409);
      expect((await paymentRow(tx, paymentId)).status).not.toBe("VOID");
      expect(await allocatedTo(tx, invoiceId)).toBe(TOTAL);
    }));

  it("دفعةٌ لها مستند ليست إقراراً بلا دليل — لا تُلغى من هنا", () =>
    withRollback(async (tx) => {
      const supplierForDoc = await makeSupplier(tx);
      const documentId = await makeDocument(tx, supplierForDoc, "2026-08-12");
      const { invoiceId, paymentId } = await markedPaid(tx, { documentId });

      const e = await caught(undoMarkedPaid(tx, [paymentId], await someone(tx)));
      expect(e).toBeInstanceOf(UndoError);
      expect((e as UndoError).status).toBe(409);
      expect(await allocatedTo(tx, invoiceId)).toBe(TOTAL);
    }));

  it("في شهرٍ مقفل يُرفَض — ولا يتغيّر شيء", () =>
    withRollback(async (tx) => {
      const { invoiceId, paymentId } = await markedPaid(tx);
      await tx.insert(monthCloses).values({ month: "2026-08", status: "CLOSED" });

      const e = await caught(undoMarkedPaid(tx, [paymentId], await someone(tx)));
      expect(e).toBeInstanceOf(MonthClosedError);
      expect((await paymentRow(tx, paymentId)).status).not.toBe("VOID");
      expect(await allocatedTo(tx, invoiceId)).toBe(TOTAL);
      expect(await voidAudits(tx, paymentId)).toBe(0);
    }));

  it("ومعرّفٌ لا دفعةَ له 404 — ولا يُلغى ما جاء معه", () =>
    withRollback(async (tx) => {
      const { invoiceId, paymentId } = await markedPaid(tx);

      const e = await caught(undoMarkedPaid(tx, [paymentId, "no-such-payment"], await someone(tx)));
      expect(e).toBeInstanceOf(UndoError);
      expect((e as UndoError).status).toBe(404);
      expect((await paymentRow(tx, paymentId)).status).not.toBe("VOID");
      expect(await allocatedTo(tx, invoiceId)).toBe(TOTAL);
    }));
});
