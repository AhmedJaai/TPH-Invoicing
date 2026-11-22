import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { users } from "@/db/schema";
import { CreditNoteRefused, recordAccountCreditNote, recordCreditNote } from "./credit-note.service";
import { loadUnbackedPayments } from "./supplier-followups.service";
import { findPaymentTwin } from "./payment.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import type { Tx } from "./types";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `cn-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

describe("الإشعار الدائن — فاتورة بخمسة آلاف وإشعار بسبعمئة = ٤٬٣٠٠", () => {
  it("ينقص ما بقي على الفاتورة وما على المقهى للمورّد", () =>
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

  it("لا يتجاوز ما بقي — ولا يكتب شيء", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 500_00, "2026-09-10");
      const e = await caught(recordCreditNote(tx, { invoiceId: inv, amountMinor: 600_00, issuedOn: "2026-09-15", reference: null, reason: null }, await someone(tx)));
      expect(e).toBeInstanceOf(CreditNoteRefused);
      const [n] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payments where supplier_id = ${s}`)).rows;
      expect(n.n).toBe(0);
    }));

  it("ولا يتبنّاه كشف البنك: حوالة بالمبلغ نفسه في اليوم نفسه ليست هو", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 5000_00, "2026-09-10");
      await recordCreditNote(tx, { invoiceId: inv, amountMinor: 700_00, issuedOn: "2026-09-15", reference: null, reason: null }, await someone(tx));
      expect(await findPaymentTwin(tx, { supplierId: s, paidAt: day("2026-09-15"), amountMinor: 700_00 })).toBeNull();
    }));
});

describe("الإشعار الدائن على حساب المورّد — لا على فاتورة", () => {
  it("يُخصم من فواتيره المفتوحة بالأقدم أوّلاً، وما بقي رصيدٌ لك عنده", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const older = await makeInvoice(tx, s, 100_00, "2026-09-01");
      const newer = await makeInvoice(tx, s, 50_00, "2026-09-05");
      const actor = await someone(tx);

      const first = await recordAccountCreditNote(tx, { supplierId: s, amountMinor: 120_00, issuedOn: "2026-09-20", reference: "CN-1", reason: "مرتجع من فاتورتين" }, actor);
      expect(first).toMatchObject({ appliedMinor: 120_00, creditLeftMinor: 0 });
      const remaining = async (inv: string) => Number((await tx.execute<{ r: number }>(sql`
        select (i.total_minor - coalesce((select sum(amount_minor) from payment_allocations where invoice_id = i.id), 0))::int as r
          from invoices i where i.id = ${inv}`)).rows[0].r);
      expect(await remaining(older)).toBe(0);
      expect(await remaining(newer)).toBe(30_00);

      const second = await recordAccountCreditNote(tx, { supplierId: s, amountMinor: 100_00, issuedOn: "2026-09-25", reference: "CN-2", reason: null }, actor);
      expect(second).toMatchObject({ appliedMinor: 30_00, creditLeftMinor: 70_00 });
      const [b] = await loadSupplierBalances(tx, s);
      expect(b.openMinor).toBe(0);
      expect(b.creditMinor).toBe(70_00);
    }));

  it("ليس «دفعةً بلا فاتورة» — لم يخرج له مال", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await recordAccountCreditNote(tx, { supplierId: s, amountMinor: 300_00, issuedOn: "2026-09-20", reference: null, reason: null }, await someone(tx));
      const unbacked = await loadUnbackedPayments(tx);
      expect(unbacked.some((u) => u.supplierId === s)).toBe(false);
    }));

  it("إشعارٌ بالمرجع نفسه يُسأل عنه، ويمضي بإقرار", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const actor = await someone(tx);
      await recordAccountCreditNote(tx, { supplierId: s, amountMinor: 200_00, issuedOn: "2026-09-20", reference: "CN-9", reason: null }, actor);
      const e = await caught(recordAccountCreditNote(tx, { supplierId: s, amountMinor: 150_00, issuedOn: "2026-09-22", reference: "CN-9", reason: null }, actor));
      expect(e).toBeInstanceOf(CreditNoteRefused);
      expect((e as CreditNoteRefused).duplicate).toBe(true);
      const ok = await recordAccountCreditNote(tx, { supplierId: s, amountMinor: 150_00, issuedOn: "2026-09-22", reference: "CN-9", reason: null, acknowledgeDuplicate: true }, actor);
      expect(ok.creditLeftMinor).toBe(150_00);
    }));
});
