import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { paymentAllocations, users } from "@/db/schema";
import { allocate, createPayment } from "./payment.service";
import { correctInvoice } from "./invoice-correction.service";
import { replaceLines } from "./invoice.service";
import type { Tx } from "./types";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `fix-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

describe("تصحيحُ مورّد الفاتورة وتاريخها", () => {
  it("قُرئ المورّدُ خطأً: يُفكّ سدادُ السابق ويعود إلى فاتورته، وتتبعها بنودُها", () =>
    withRollback(async (tx) => {
      const wrong = await makeSupplier(tx);
      const right = await makeSupplier(tx);
      const inv = await makeInvoice(tx, wrong, 400_00, "2026-09-10");
      await replaceLines(tx, { invoiceId: inv, supplierId: wrong, invoiceDate: day("2026-09-10"), subtotalMinor: null, lines: [
        { description: "حليب 1 لتر", quantity: "10", unitPrice: "40", lineTotal: "400" },
      ] });
      const other = await makeInvoice(tx, wrong, 400_00, "2026-09-12");
      const pay = await createPayment(tx, { supplierId: wrong, paidAt: day("2026-09-11"), amountMinor: 400_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      await allocate(tx, pay, 400_00, [{ invoiceId: inv, amountMinor: 400_00 }]);

      const out = await correctInvoice(tx, { invoiceId: inv, supplierId: right }, await someone(tx));
      expect(out.releasedMinor).toBe(400_00);

      /* مالُ المورّد السابق عاد إلى فاتورته الأخرى — لا يبقى على فاتورةِ غيره */
      const allocs = await tx.select({ invoiceId: paymentAllocations.invoiceId }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, pay));
      expect(allocs).toEqual([{ invoiceId: other }]);
      const [line] = (await tx.execute<{ s: string; sp_supplier: string }>(sql`
        select il.supplier_id as s, sp.supplier_id as sp_supplier
          from invoice_lines il join supplier_products sp on sp.id = il.supplier_product_id where il.invoice_id = ${inv}
      `)).rows;
      expect(line).toEqual({ s: right, sp_supplier: right });
    }));

  it("التاريخُ يُصحَّح فينتقل الشهر", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 100_00, "2026-09-02");
      await correctInvoice(tx, { invoiceId: inv, invoiceDate: "2026-08-28" }, await someone(tx));
      const [r] = (await tx.execute<{ m: string }>(sql`select period_month as m from invoices where id = ${inv}`)).rows;
      expect(r.m).toBe("2026-08");
    }));
});
