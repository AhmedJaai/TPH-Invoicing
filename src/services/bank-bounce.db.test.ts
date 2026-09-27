import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, users } from "@/db/schema";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { allocate, createPayment } from "./payment.service";
import { BounceRefused, findBouncePartner, resolveBounce } from "./bank-bounce.service";
import type { Tx } from "./types";

async function pair(tx: Tx) {
  const [u] = await tx.insert(users).values({ email: `bounce-${Math.random()}@test.local` }).returning({ id: users.id });
  const s = await makeSupplier(tx);
  const inv = await makeInvoice(tx, s, 2000_00, "2099-09-01");
  /* سدادٌ قُيِّد بيدٍ ثمّ رُبطت به الحوالة */
  const pay = await createPayment(tx, { supplierId: s, paidAt: day("2099-09-02"), amountMinor: 2000_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
  await allocate(tx, pay, 2000_00, [{ invoiceId: inv, amountMinor: 2000_00 }]);
  const [imp] = await tx.insert(bankImports).values({ fileName: `bounce-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [out] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day("2099-09-02"), amountMinor: 2000_00, direction: "DEBIT",
    matchedPaymentId: pay, matchStatus: "MATCHED", category: "SUPPLIER", supplierId: s,
  }).returning({ id: bankTransactions.id });
  const [back] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day("2099-09-05"), amountMinor: 2000_00, direction: "CREDIT", category: "UNKNOWN",
  }).returning({ id: bankTransactions.id });
  return { actorId: u.id, inv, pay, out: out.id, back: back.id };
}

describe("حوالةٌ لمورّدٍ خرجت ثمّ عادت", () => {
  it("«ارتدّت» تردّ الدفعة فتعود الفاتورة مستحقّة، وتُعرَّف العودة، ولا يعود التنبيه", () =>
    withRollback(async (tx) => {
      const p = await pair(tx);
      expect(await findBouncePartner(tx, p.out)).toMatchObject({ outgoingId: p.out, incomingId: p.back });

      const r = await resolveBounce(tx, { outgoingId: p.out, incomingId: p.back, decision: "BOUNCED" }, p.actorId);
      expect(r.freedInvoices).toBe(1);
      const [a] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_allocations where invoice_id = ${p.inv}`)).rows;
      expect(a.n).toBe(0);
      const [b] = await tx.select({ st: bankTransactions.matchStatus }).from(bankTransactions).where(eq(bankTransactions.id, p.back));
      expect(b.st).toBe("IGNORED");
      expect(await findBouncePartner(tx, p.out)).toBeNull();
      expect(await caught(resolveBounce(tx, { outgoingId: p.out, incomingId: p.back, decision: "BOUNCED" }, p.actorId))).toBeInstanceOf(BounceRefused);
    }));

  it("«ليست ردّاً» لا يمسّ الدفعة ويُغلق التنبيه", () =>
    withRollback(async (tx) => {
      const p = await pair(tx);
      await resolveBounce(tx, { outgoingId: p.out, incomingId: p.back, decision: "NOT_BOUNCE" }, p.actorId);
      const [a] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payment_allocations where invoice_id = ${p.inv}`)).rows;
      expect(a.n).toBe(1);
      expect(await findBouncePartner(tx, p.out)).toBeNull();
    }));
});
