import { describe, expect, it } from "vitest";
import { makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { loadMonthPurchases } from "./changes-facts";

/*
  أشهرٌ بعيدة (٢٠٩٩) كي لا تختلط بفواتير التجهيز: «هذا الشهر» آخرُ شهرٍ فيه
  فواتير حتى شهر اليوم، فلا يقع على شهرٍ من التجهيز.
*/
describe("مشتريات الشهر في الرئيسيّة", () => {
  it("فاتورةٌ مؤرَّخةٌ بشهرٍ لم يأتِ لا تصير «مشتريات الشهر»", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await makeInvoice(tx, s, 1_000_00, "2099-05-10");
      await makeInvoice(tx, s, 500_00, "2099-05-25");
      await makeInvoice(tx, s, 104_66, "2099-07-02");

      const p = await loadMonthPurchases(tx, "2099-06-20");
      expect(p.thisMonth).toBe("2099-05");
      expect(p.thisMinor).toBe(1_500_00);
      /* مايو ليس الشهرَ الجاري — فلا «أوّل N يوماً» */
      expect(p.daysElapsed).toBeNull();
    }));

  it("الشهرُ الجاري يُقارَن بأوّل أيّامٍ مثلها من سابقه، بيوم الرياض الممرَّر", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await makeInvoice(tx, s, 1_000_00, "2099-05-10");
      await makeInvoice(tx, s, 500_00, "2099-05-25");
      await makeInvoice(tx, s, 300_00, "2099-06-05");
      await makeInvoice(tx, s, 104_66, "2099-07-02");

      const p = await loadMonthPurchases(tx, "2099-06-20");
      expect(p.thisMonth).toBe("2099-06");
      expect(p.prevMonth).toBe("2099-05");
      expect(p.thisMinor).toBe(300_00);
      /* ٢٥ مايو بعد اليوم العشرين — خارج المقارنة */
      expect(p.prevMinor).toBe(1_000_00);
      expect(p.daysElapsed).toBe(20);
    }));
});
