import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, payments, users } from "@/db/schema";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { Conflict, NotFound, Refused } from "@/lib/domain-error";
import { confirmMatch } from "./match-confirm.service";
import { confirmMatchesBulk } from "./match-confirm-bulk.service";
import { undoMatch } from "./match-undo.service";
import { matchCandidates } from "./match-recompute.service";
import type { Tx } from "./types";

/**
 * أبوابُ المطابقة بعد نقلها من المسارات إلى خدماتها (أكتوبر ٢٠٢٦): الفروعُ نفسها،
 * والنصوصُ نفسها، والرفضُ أخطاءُ عملٍ برموز المسار القديم — على المخطّط الحقيقيّ.
 */
async function setup(tx: Tx, opts: { direction?: "DEBIT" | "CREDIT"; amountMinor?: number; category?: "UNKNOWN" | "SUPPLIER" } = {}) {
  const [u] = await tx.insert(users).values({ email: `match-${Math.random()}@test.local` }).returning({ id: users.id });
  const supplierId = await makeSupplier(tx);
  const invoiceId = await makeInvoice(tx, supplierId, 1000_00, "2099-07-01");
  const [imp] = await tx.insert(bankImports).values({ fileName: `match-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [row] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id,
    valueDate: day("2099-07-10"),
    amountMinor: opts.amountMinor ?? 1500_00,
    direction: opts.direction ?? "DEBIT",
    category: opts.category ?? "SUPPLIER",
    supplierId,
    description: "تحويل اختبار",
  }).returning({ id: bankTransactions.id });
  return { userId: u.id, supplierId, invoiceId, importId: imp.id, txId: row.id };
}

const read = (tx: Tx, id: string) =>
  tx.select().from(bankTransactions).where(eq(bankTransactions.id, id)).then((r) => r[0]);

describe("confirmMatch", () => {
  it("بلا حركة ٤٠٠، وحركةٌ مجهولة ٤٠٤ — بنصّ المسار", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      const none = await caught(confirmMatch(p.userId, {}, tx));
      expect(none).toBeInstanceOf(Refused);
      expect((none as Refused).message).toBe("حدّد الحركة");
      const missing = await caught(confirmMatch(p.userId, { transactionId: "no-such-tx" }, tx));
      expect(missing).toBeInstanceOf(NotFound);
      expect((missing as NotFound).status).toBe(404);
    }));

  it("«ليست سداداً» تُقيَّد بسببها، والتراجعُ يعيد بابَها، وتراجعٌ ثانٍ ٤٠٩", () =>
    withRollback(async (tx) => {
      const p = await setup(tx, { category: "UNKNOWN" });
      const r = await confirmMatch(p.userId, { transactionId: p.txId, notAPayment: "INTERNAL" }, tx);
      expect(r).toEqual({ ok: true, message: "حُفظ: تحويل داخلي" });
      const after = await read(tx, p.txId);
      expect(after).toMatchObject({ category: "INTERNAL", matchStatus: "IGNORED", matchOutcome: "NOT_A_PAYMENT", classificationSource: "HUMAN" });

      const undone = await undoMatch(p.userId, { transactionId: p.txId }, tx);
      expect(undone).toEqual({ ok: true, message: "تراجعتَ عن «ليست سداداً»، وعادت الحركة تنتظر قرارك" });
      expect(await read(tx, p.txId)).toMatchObject({ category: "UNKNOWN", matchStatus: "UNMATCHED", matchDisposition: "REVIEW", matchOutcome: null });

      const again = await caught(undoMatch(p.userId, { transactionId: p.txId }, tx));
      expect(again).toBeInstanceOf(Conflict);
      expect((again as Conflict).message).toBe("هذه الحركة غير مطابقة أصلاً");
    }));

  it("المقدّمةُ بلا مورّد تُردّ ٤٠٠", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      await tx.update(bankTransactions).set({ supplierId: null }).where(eq(bankTransactions.id, p.txId));
      const e = await caught(confirmMatch(p.userId, { transactionId: p.txId, notAPayment: "ADVANCE" }, tx));
      expect(e).toBeInstanceOf(Refused);
      expect((e as Refused).message).toBe("الدفعة المقدّمة تحتاج إلى مورّد. حدّد المورّد الذي دفعت له.");
    }));

  it("السدادُ على الحساب يوزَّع بالأقدم أوّلاً ويبقى الفائض غيرَ مخصَّص، والضغطةُ الثانية تقول «سُجّلت»", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      const r = await confirmMatch(p.userId, { transactionId: p.txId, settleSupplier: true }, tx);
      expect(r).toMatchObject({ ok: true, settled: 1, allocated: 1000_00, unapplied: 500_00, supplierBalanceAfter: 0 });
      expect(r.message).toContain("بالأقدم أولاً");

      const row = await read(tx, p.txId);
      expect(row.matchedPaymentId).not.toBeNull();
      expect(row.matchOutcome).toBe("SUPPLIER_ON_ACCOUNT");

      const twice = await confirmMatch(p.userId, { transactionId: p.txId, settleSupplier: true }, tx);
      expect(twice).toEqual({ ok: true, message: "سُجّلت هذه الحركة من قبل، ولم يُضف شيء جديد" });

      /* ومن غيرِ من قيّدها: ٤٠٩ بنصّها */
      const [other] = await tx.insert(users).values({ email: `match-other-${Math.random()}@test.local` }).returning({ id: users.id });
      const e = await caught(confirmMatch(other.id, { transactionId: p.txId, settleSupplier: true }, tx));
      expect(e).toBeInstanceOf(Conflict);
      expect((e as Conflict).message).toBe("سُجّل لهذه الحركة سداد من قبل. افتحها في صفحة البنك لترى دفعتها.");

      /* والتراجعُ يردّ الدفعة لا يحذفها، وتعود الفاتورة مستحقّة */
      const undone = await undoMatch(p.userId, { transactionId: p.txId, reason: "اختبار" }, tx);
      expect(undone).toMatchObject({ ok: true, removedAllocations: 1, reversedPayment: true, freedMinor: 1000_00 });
      const [pay] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, row.matchedPaymentId!));
      expect(pay.status).toBe("REVERSED");
      const [a] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_allocations where invoice_id = ${p.invoiceId}`)).rows;
      expect(a.n).toBe(0);
    }));

  it("المالُ الداخل لا يُسجَّل سداداً لمورّد", () =>
    withRollback(async (tx) => {
      const p = await setup(tx, { direction: "CREDIT" });
      const e = await caught(confirmMatch(p.userId, { transactionId: p.txId, settleSupplier: true }, tx));
      expect(e).toBeInstanceOf(Refused);
      expect((e as Refused).message).toBe("المبلغ الداخل لا يُسجَّل سداداً لمورّد");
    }));

  it("بلا إجراءٍ مسمّى ٤٠٠", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      const e = await caught(confirmMatch(p.userId, { transactionId: p.txId }, tx));
      expect(e).toBeInstanceOf(Refused);
      expect((e as Refused).message).toBe("حدّد الإجراء: سداد على حساب المورّد، أو «ليست سداداً»");
    }));
});

describe("confirmMatchesBulk", () => {
  it("بلا حركات ٤٠٠، وما لا يصلح يُردّ بسببه بلا كتابة", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      expect(await caught(confirmMatchesBulk(p.userId, { transactionIds: [] }, tx))).toBeInstanceOf(Refused);

      /* ليست اقتراحاً، وأخرى مجهولة */
      const r = await confirmMatchesBulk(p.userId, { transactionIds: [p.txId, "no-such-tx"] }, tx);
      expect(r.confirmed).toBe(0);
      expect(r.rejected).toBe(2);
      expect(r.outcomes).toEqual([
        { transactionId: p.txId, ok: false, reason: "ليست اقتراحاً، والتأكيد الجماعي للاقتراحات فقط." },
        { transactionId: "no-such-tx", ok: false, reason: "هذه الحركة غير موجودة" },
      ]);
      expect(r.message).toBe("لم يُحفظ شيء. رُدّت حركتان");
      expect((await read(tx, p.txId)).matchedPaymentId).toBeNull();
    }));

  it("فوق الحدّ ٤٠٠ بنصّه", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
      const e = await caught(confirmMatchesBulk(p.userId, { transactionIds: ids }, tx));
      expect(e).toBeInstanceOf(Refused);
      expect((e as Refused).message).toContain("الحد الأقصى للتأكيد دفعة واحدة");
    }));
});

describe("matchCandidates", () => {
  it("حركةٌ مجهولة ٤٠٤، ومقيَّدةٌ ٤٠٩", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      expect(await caught(matchCandidates("no-such-tx", tx))).toBeInstanceOf(NotFound);
      await confirmMatch(p.userId, { transactionId: p.txId, settleSupplier: true }, tx);
      const e = await caught(matchCandidates(p.txId, tx));
      expect(e).toBeInstanceOf(Conflict);
      expect((e as Conflict).message).toBe("سُجّل لهذه الحركة سداد من قبل");
    }));
});

describe("undoMatch", () => {
  it("بلا حركة ٤٠٠، ومجهولةٌ ٤٠٤", () =>
    withRollback(async (tx) => {
      const p = await setup(tx);
      expect(await caught(undoMatch(p.userId, {}, tx))).toBeInstanceOf(Refused);
      expect(await caught(undoMatch(p.userId, { transactionId: "no-such-tx" }, tx))).toBeInstanceOf(NotFound);
    }));
});
