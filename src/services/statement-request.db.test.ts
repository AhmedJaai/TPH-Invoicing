import { describe, expect, it } from "vitest";
import { loadMissingStatementSuppliers } from "./supplier-followups.service";
import { allocate, createPayment } from "./payment.service";
import { day, makeInvoice, makeSupplier, withRollback } from "@/test/db";

/**
 * «لم يصل كشفُه» يُطلب ممّن تعامل في الشهر أو بقي له عليك — لا من كلّ مورّدٍ له فاتورةٌ يوماً ما.
 * زاكوباك آخرُ فاتورةٍ له ٩ سبتمبر وسُئل عن كشف أكتوبر.
 */
describe("loadMissingStatementSuppliers", () => {
  it("من له فاتورةٌ في الشهر يُسأل، ومن سُدّد قديمُه ولم يتعامل لا يُسأل، ومن بقي له عليك يُسأل", () =>
    withRollback(async (tx) => {
      const active = await makeSupplier(tx);
      await makeInvoice(tx, active, 500_00, "2026-10-12");

      const quiet = await makeSupplier(tx);
      const old = await makeInvoice(tx, quiet, 300_00, "2026-09-09");
      const p = await createPayment(tx, { supplierId: quiet, paidAt: day("2026-09-20"), amountMinor: 300_00, method: "BANK_TRANSFER", acknowledgeTwin: true });
      await allocate(tx, p, [{ invoiceId: old, amountMinor: 300_00 }]);

      const owing = await makeSupplier(tx);
      await makeInvoice(tx, owing, 200_00, "2026-09-02");

      const ids = new Set((await loadMissingStatementSuppliers("2026-10", tx)).map((r) => r.id));
      expect(ids.has(active)).toBe(true);
      expect(ids.has(quiet)).toBe(false);
      expect(ids.has(owing)).toBe(true);
    }));
});
