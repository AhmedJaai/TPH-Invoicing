import { describe, expect, it } from "vitest";
import { planCreditApplication, SETTLEMENT_FORWARD_DAYS, settleSupplierAccount } from "./allocation";

/** حدودُ «الأقدم أوّلاً» التي كانت تنجو فيها طفراتُ Stryker. */
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const DAY = 24 * 60 * 60 * 1000;

describe("settleSupplierAccount — نافذةُ الأيّام السبعة", () => {
  it("فاتورةٌ بعد الحوالة بأكثر من سبعة أيّام لا تُسدَّد ولو كانت أقدمَ ما بقي", () => {
    const paidAt = day("2026-09-03");
    const plan = settleSupplierAccount(1_000_00, paidAt, [
      { invoiceId: "late", invoiceDate: new Date(paidAt.getTime() + (SETTLEMENT_FORWARD_DAYS * DAY) + 1), outstandingMinor: 600_00 },
      { invoiceId: "old", invoiceDate: day("2026-08-01"), outstandingMinor: 300_00 },
    ]);
    expect(plan.allocations).toEqual([{ invoiceId: "old", amountMinor: 300_00 }]);
    expect(plan.remainingMinor).toBe(700_00);
  });

  it("فاتورةٌ على حدّ السبعة أيّام بالضبط تُسدَّد", () => {
    const paidAt = day("2026-09-03");
    const plan = settleSupplierAccount(500_00, paidAt, [
      { invoiceId: "edge", invoiceDate: new Date(paidAt.getTime() + SETTLEMENT_FORWARD_DAYS * DAY), outstandingMinor: 500_00 },
    ]);
    expect(plan.allocatedMinor).toBe(500_00);
  });
});

describe("planCreditApplication — حدُّ النافذة", () => {
  it("فاتورةٌ على حدّ النافذة بالضبط يُخصم منها الرصيد، وما بعده بلحظةٍ لا", () => {
    const paidAt = day("2026-09-01");
    const plan = planCreditApplication(
      [{ paymentId: "p", paidAt, availableMinor: 1_000_00 }],
      [
        { invoiceId: "edge", invoiceDate: new Date(paidAt.getTime() + 7 * DAY), outstandingMinor: 400_00 },
        { invoiceId: "after", invoiceDate: new Date(paidAt.getTime() + 7 * DAY + 1), outstandingMinor: 400_00 },
      ],
      { forwardDays: 7 },
    );
    expect(plan.allocations).toEqual([{ paymentId: "p", invoiceId: "edge", amountMinor: 400_00 }]);
    expect(plan.creditLeftMinor).toBe(600_00);
    expect(plan.openLeftMinor).toBe(400_00);
  });
});
