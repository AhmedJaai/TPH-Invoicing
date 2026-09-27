import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withRollback } from "@/test/db";
import { isolateProducts, latteSalesFile, makeActor, makeBranch, makeStockProduct } from "@/test/inventory";
import { finaliseCount, loadCountHeader, saveActualCounts, startCount } from "./inventory.service";
import { importSalesFile } from "./sales-import.service";
import { changesSinceFinalise } from "./inventory-staleness.service";
import { toCanonical } from "@/lib/inventory/units";

describe("الجردُ المقفَل يقول إن تغيّر ما تحته", () => {
  it("ملفُّ مبيعاتٍ لأيّامه بعد الإقفال يُقال — والتقريرُ يبقى كما أُقفل", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "G", "COFFEE");
      await isolateProducts(tx, [coffee]);
      const { countId } = await startCount({ periodStart: "2099-05-03", periodEnd: "2099-05-09", branchId: branch.id, actorId }, tx);
      await saveActualCounts(countId, [{ productId: coffee, actualMilli: toCanonical(5_000_000, "G") }], actorId, tx);
      await finaliseCount(countId, actorId, tx);

      expect(await changesSinceFinalise((await loadCountHeader(countId, tx))!, tx)).toEqual([]);

      await importSalesFile({ buffer: latteSalesFile(4, "2099-05-05", "LATE"), fileName: "late.xlsx", actorId }, tx);
      /* في معاملة الاختبار الواحدة يسبق وقتُ الإنشاء وقتَ الإقفال — فيُقدَّم كما يقع في الإنتاج */
      await tx.execute(sql`update sales_imports set created_at = now() + interval '1 hour' where file_name = 'late.xlsx'`);

      const stale = await changesSinceFinalise((await loadCountHeader(countId, tx))!, tx);
      expect(stale.map((r) => r.label)).toEqual(["ملفُّ مبيعاتٍ لأيّامه استُورد بعد الإقفال"]);
    }));
});
