import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { payments, users } from "@/db/schema";
import { OrphanPaymentError, resolveOrphanPayment } from "./orphan-payment.service";
import { caught, day, makeSupplier, withRollback } from "@/test/db";
import type { Tx } from "./types";

async function orphan(tx: Tx): Promise<string> {
  const [p] = await tx.insert(payments).values({
    paidAt: day("2026-08-27"), amountMinor: 3_000_00, method: "BANK_TRANSFER", appliesToMonth: "2026-08",
  }).returning({ id: payments.id });
  return p.id;
}

/* من يحسمها مستخدمٌ حقيقيّ: `reversed_by_id` و`actor_id` مفتاحان أجنبيّان */
async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

describe("دفعةٌ بلا مورّد ولا حركة — تُحسَم ولا تبقى في الطابور", () => {
  it("تُنسَب إلى مورّد، ولا تُنسَب ثانيةً", () =>
    withRollback(async (tx) => {
      const id = await orphan(tx);
      const who = await someone(tx);
      const supplierId = await makeSupplier(tx);
      await resolveOrphanPayment(tx, { action: "assign", paymentId: id, supplierId }, who);
      const [row] = await tx.select({ s: payments.supplierId }).from(payments).where(eq(payments.id, id));
      expect(row.s).toBe(supplierId);

      const other = await makeSupplier(tx);
      const e = await caught(resolveOrphanPayment(tx, { action: "assign", paymentId: id, supplierId: other }, who));
      expect(e).toBeInstanceOf(OrphanPaymentError);
    }));

  it("تُلغى بسببها ولا تُحذَف", () =>
    withRollback(async (tx) => {
      const id = await orphan(tx);
      await resolveOrphanPayment(tx, { action: "void", paymentId: id, reason: "أجرة — ليست لمورّد" }, await someone(tx));
      const [row] = await tx.select({ status: payments.status, reason: payments.reversalReason })
        .from(payments).where(eq(payments.id, id));
      expect(row).toEqual({ status: "VOID", reason: "أجرة — ليست لمورّد" });
    }));
});
