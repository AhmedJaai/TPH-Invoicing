import { describe, expect, it } from "vitest";
import { financeSnapshots, monthCloses } from "@/db/schema";
import { loadMonthsInCorrection } from "./month-correction.service";
import { withRollback } from "@/test/db";

/** شهرٌ خُتم ثمّ فُتح يظهر «مفتوحاً للتصحيح» بربحه المجمَّد — والمقفلُ والذي لم يُختم قطّ لا يظهران. */
describe("أشهرٌ فُتحت للتصحيح", { timeout: 120_000 }, () => {
  it("المفتوحُ بعد ختمٍ وحده، بربحه المجمَّد", () =>
    withRollback(async (tx) => {
      await tx.insert(monthCloses).values([
        { month: "2099-03", status: "OPEN" },
        { month: "2099-04", status: "CLOSED" },
        { month: "2099-05", status: "OPEN" },
      ]);
      await tx.insert(financeSnapshots).values([
        { month: "2099-03", payload: { pnl: { profitMinor: 123_45 } } },
        { month: "2099-04", payload: { pnl: { profitMinor: 1 } } },
      ]);
      const list = (await loadMonthsInCorrection(tx)).filter((m) => m.month.startsWith("2099-"));
      expect(list.map((m) => [m.month, m.frozenProfitMinor])).toEqual([["2099-03", 123_45]]);
    }));
});
