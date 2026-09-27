import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { users } from "@/db/schema";
import { CreditNoteRefused, recordCreditNote } from "./credit-note.service";
import { findPaymentTwin } from "./payment.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import type { Tx } from "./types";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `cn-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

describe("الإشعارُ الدائن — فاتورةٌ بخمسة آلاف وإشعارٌ بسبعمئة = ٤٬٣٠٠", () => {
  it("يُنقص ما بقي على الفاتورة وما على المقهى للمورّد", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 5000_00, "2026-09-10");
      const out = await recordCreditNote(tx, { invoiceId: inv, amountMinor: 700_00, issuedOn: "2026-09-15", reference: "CN-12", reason: "مرتجع" }, await someone(tx));
      expect(out.remainingMinor).toBe(4300_00);

      const [b] = await loadSupplierBalances(tx, s);
      expect(b.openMinor).toBe(4300_00);
      const [a] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'PAYMENT_CREDIT_NOTE_RECORDED' and entity_id = ${inv}`)).rows;
      expect(a.n).toBe(1);
    }));

  it("لا يتجاوز ما بقي — ولا يُكتب شيء", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 500_00, "2026-09-10");
      const e = await caught(recordCreditNote(tx, { invoiceId: inv, amountMinor: 600_00, issuedOn: "2026-09-15", reference: null, reason: null }, await someone(tx)));
      expect(e).toBeInstanceOf(CreditNoteRefused);
      const [n] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payments where supplier_id = ${s}`)).rows;
      expect(n.n).toBe(0);
    }));

  it("ولا يتبنّاه كشفُ البنك: حوالةٌ بالمبلغ نفسه في اليوم نفسه ليست هو", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 5000_00, "2026-09-10");
      await recordCreditNote(tx, { invoiceId: inv, amountMinor: 700_00, issuedOn: "2026-09-15", reference: null, reason: null }, await someone(tx));
      expect(await findPaymentTwin(tx, { supplierId: s, paidAt: day("2026-09-15"), amountMinor: 700_00 })).toBeNull();
    }));
});
