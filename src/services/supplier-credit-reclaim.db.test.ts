import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { paymentAllocations } from "@/db/schema";
import { createPayment } from "./payment.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

const paidOn = async (tx: Tx, invoiceId: string) =>
  Number((await tx.select({ s: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}),0)::int` })
    .from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId)))[0].s);

describe("الفاتورةُ الأقدم المتأخّرة تستردّ حوالتها (لوريفا)", () => {
  it("حوالةُ ٢ سبتمبر لفواتير أغسطس — لا لفاتورة ٤ سبتمبر وصلت قبلها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const aug20 = await makeInvoice(tx, s, 600_00, "2026-08-20");
      const pay = await createPayment(tx, { supplierId: s, paidAt: day("2026-09-02"), amountMinor: 1000_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      const auto = { forwardDays: SETTLEMENT_FORWARD_DAYS };
      await applySupplierCredit(tx, s, auto);
      expect(await paidOn(tx, aug20)).toBe(600_00);

      /* فاتورةُ ٤ سبتمبر تأخذ الباقي آلياً */
      const sep04 = await makeInvoice(tx, s, 400_00, "2026-09-04");
      await applySupplierCredit(tx, s, auto);
      expect(await paidOn(tx, sep04)).toBe(400_00);

      /* ثمّ تُقرأ فاتورةُ ٢٧ أغسطس متأخّرة: الحوالةُ لها، وفاتورةُ سبتمبر مفتوحة */
      const aug27 = await makeInvoice(tx, s, 400_00, "2026-08-27");
      await applySupplierCredit(tx, s, auto);
      expect(await paidOn(tx, aug27)).toBe(400_00);
      expect(await paidOn(tx, sep04)).toBe(0);

      /* ومرّةً ثانية لا تغيّر شيئاً */
      await applySupplierCredit(tx, s, auto);
      expect([await paidOn(tx, aug20), await paidOn(tx, aug27), await paidOn(tx, sep04)]).toEqual([600_00, 400_00, 0]);
      void pay;
    }));
});
