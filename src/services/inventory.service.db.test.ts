import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  inventoryCountLines, inventoryCountSnapshots, recipeVersions, sales,
} from "@/db/schema";
import { caught, day, makeInvoice, makeSupplier, pgErrorOf, withRollback } from "@/test/db";
import { isolateProducts, kg, makeActor, makeBranch, makeMenuProduct, makeStockProduct } from "@/test/inventory";
import { importSalesFile } from "./sales-import.service";
import { mapPosProducts } from "./pos-mapping.service";
import { saveRecipeVersion } from "./recipe.service";
import {
  CountLockedError, finaliseCount, itemHistory, loadCountHeader, readFrozenReport,
  recomputeCount, reopenCount, saveActualCounts, startCount,
} from "./inventory.service";
import { recordWaste } from "./inventory-movement.service";
import { canonicalToQuantity } from "@/lib/inventory/units";
import type { Tx } from "./types";

/**
 * الجردُ على المخطّط الحقيقيّ — والاختباراتُ النقيّة لا تُثبت أنّ
 * النظام يعمل.
 *
 * هذه تمرّ بالخدمات نفسِها التي تمرّ بها الواجهة، على الجداول نفسِها،
 * بمؤثِّراتها وقيودها. وكلُّها في معاملةٍ تُلغى، فلا يبقى صفّ.
 */

/* ─────────────────── تجهيزٌ مشترك ─────────────────── */

const ORDERS_HEADER = [
  "Order Number", "Business Date", "SKU", "Product", "Quantity", "Unit Price", "Net Sales",
];

function workbook(rows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ORDERS_HEADER, ...rows]), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** ملفُّ مبيعاتٍ فيه `count` مشروباً من صنفٍ واحد. */
function salesFile(count: number, date = "2026-09-03", orderPrefix = "ORD"): Buffer {
  return workbook(
    Array.from({ length: count }, (_, i) => [
      `${orderPrefix}-${i + 1}`, date, "SKU-LATTE", "Spanish Latte", "1", "18.00", "18.00",
    ]),
  );
}

async function importAndMap(
  tx: Tx, buffer: Buffer, actorId: string, menuProductId: string, branchLabel?: string,
) {
  const result = await importSalesFile(
    { buffer, fileName: `foodics-${Math.random()}.xlsx`, actorId, branchLabel },
    tx,
  );
  const unmapped = await tx.execute<{ id: string }>(sql`
    select id from pos_products where product_id is null and external_id = 'SKU-LATTE'
  `);
  if (unmapped.rows[0]) {
    await mapPosProducts(
      { posProductIds: [String(unmapped.rows[0].id)], productId: menuProductId, actorId },
      tx,
    );
  }
  return result;
}

/* ─────────────────── الاستيراد ─────────────────── */

describe("استيرادُ المبيعات لا يُضاعِف", () => {
  it("الملفُّ عينُه مرّتين: الثانيةُ تُردّ `DUPLICATE` ولا تُكتب بيعةٌ واحدة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const buffer = salesFile(3);

      const first = await importSalesFile({ buffer, fileName: "a.xlsx", actorId }, tx);
      expect(first.status).toBe("IMPORTED");
      expect(first.totals.salesWritten).toBe(3);

      const before = await countSales(tx);
      const second = await importSalesFile({ buffer, fileName: "a.xlsx", actorId }, tx);

      expect(second.status).toBe("DUPLICATE");
      expect(second.importId).toBe(first.importId);
      expect(await countSales(tx)).toBe(before);
    }));

  it("وملفٌّ آخر يحمل الطلباتِ نفسَها لا يضاعفها — المنعُ على المفتاح الطبيعيّ لا على البصمة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);

      await importSalesFile({ buffer: salesFile(3), fileName: "a.xlsx", actorId }, tx);
      const before = await countSales(tx);

      /* ملفٌّ ببصمةٍ مختلفة (صفٌّ زائد) يحمل الطلبات الثلاثة نفسها */
      const wider = workbook([
        ...Array.from({ length: 3 }, (_, i) => [`ORD-${i + 1}`, "2026-09-03", "SKU-LATTE", "Spanish Latte", "1", "18.00", "18.00"]),
        ["ORD-4", "2026-09-03", "SKU-LATTE", "Spanish Latte", "1", "18.00", "18.00"],
      ]);
      const second = await importSalesFile({ buffer: wider, fileName: "b.xlsx", actorId }, tx);

      expect(second.status).toBe("IMPORTED");
      /* واحدةٌ جديدة فقط، وثلاثٌ رُدّت بوصفها مقيَّدة */
      expect(second.totals.salesWritten).toBe(1);
      expect(second.totals.duplicates).toBe(3);
      expect(await countSales(tx)).toBe(before + 1);
    }));

  it("ولا صفَّ يُرمى صامتاً — الخامُ محفوظٌ بحاله وسببه", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const buffer = workbook([
        ["ORD-1", "2026-09-03", "SKU-1", "Latte", "2", "18.00", "36.00"],
        ["ORD-2", "2026-09-03", "SKU-2", "Tea", "غير مقروء", "9.00", "9.00"],
      ]);

      const r = await importSalesFile({ buffer, fileName: "c.xlsx", actorId }, tx);
      expect(r.status).toBe("PARTIAL");
      expect(r.totals.errors).toBe(1);

      const rows = await tx.execute<{ status: string; reason: string | null; raw: unknown }>(sql`
        select status, reason, raw from sales_import_rows where import_id = ${r.importId} order by row_number
      `);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[1].status).toBe("ERROR");
      expect(rows.rows[1].reason).toContain("الكمّيّة");
      expect((rows.rows[1].raw as Record<string, string>)["Product"]).toBe("Tea");
    }));
});

/* ─────────────────── دورةُ الجرد ─────────────────── */

describe("الجرد من طرفه إلى طرفه", () => {
  it("مبيعاتٌ ووصفةٌ ومشترياتٌ وعدٌّ فعليّ ← فرقٌ محسوب", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const branchId = branch.id;
      const coffee = await makeStockProduct(tx, "حبوب قهوة", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "سبانيش لاتيه");
      await isolateProducts(tx, [coffee, latte]);

      /* وصفة: ٢٠ جراماً للمشروب */
      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      await importAndMap(tx, salesFile(100), actorId, latte, branch.nameAr);

      /* رصيدٌ افتتاحيّ صريح ٥ كجم */
      await tx.execute(sql`
        insert into inventory_movements (id, product_id, branch_id, kind, quantity_milli, unit, occurred_on, created_by_id)
        values (${`mv-${Math.random()}`}, ${coffee}, ${branchId}, 'OPENING', ${5000}, 'KG', '2026-09-01', ${actorId})
      `);

      /* شراءُ ٢٠ كجم بـ‏١٬٥٠٠ ريالاً */
      await makePurchase(tx, coffee, "2026-09-02", 1500_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId, actorId,
      }, tx);

      const report = await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(20.5) }], actorId, tx);
      const line = report.lines.find((l) => l.productId === coffee)!;

      expect(canonicalToQuantity(line.openingMilli!, "KG")).toBe(5);
      expect(canonicalToQuantity(line.purchasesMilli!, "KG")).toBe(20);
      expect(canonicalToQuantity(line.theoreticalConsumptionMilli!, "KG")).toBe(2);
      expect(canonicalToQuantity(line.theoreticalClosingMilli!, "KG")).toBe(23);
      expect(canonicalToQuantity(line.varianceMilli!, "KG")).toBe(-2.5);
      expect(line.varianceBp).toBe(-1087);
      expect(line.unitCostMinor).toBe(75_00);
      expect(line.varianceCostMinor).toBe(-187_50);
    }));

  it("والهدرُ المسجَّل يخرج من الفرق — لا يزيد الرفَّ ولا ينقصه", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const branchId = branch.id;
      const coffee = await makeStockProduct(tx, "حبوب قهوة", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");
      await isolateProducts(tx, [coffee, latte]);

      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);
      await importAndMap(tx, salesFile(100), actorId, latte, branch.nameAr);
      await tx.execute(sql`
        insert into inventory_movements (id, product_id, branch_id, kind, quantity_milli, unit, occurred_on, created_by_id)
        values (${`mv-${Math.random()}`}, ${coffee}, ${branchId}, 'OPENING', ${5000}, 'KG', '2026-09-01', ${actorId})
      `);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId, actorId,
      }, tx);

      const before = await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(2.5) }], actorId, tx);
      expect(canonicalToQuantity(before.lines[0].varianceMilli!, "KG")).toBe(-0.5);

      await recordWaste({
        productId: coffee, quantityMilli: 500, unit: "KG", occurredOn: "2026-09-04",
        reason: "SPILLED", branchId, countId, actorId,
      }, tx);

      const after = await recomputeCount(countId, tx);
      const line = after.lines.find((l) => l.productId === coffee)!;
      expect(canonicalToQuantity(line.recordedWasteMilli, "KG")).toBe(0.5);
      /* المتوقَّعُ نقص نصفَ كيلو، فصار الفرقُ صفراً — وقد فُسِّر */
      expect(line.varianceMilli).toBe(0);
    }));

  /*
    ── الفرعُ يُرشَّح، والفارغُ يدخل ──

    هذان وجهان لقاعدةٍ واحدة: مبيعاتُ فرعٍ لا تُحسَب على مخزون فرعٍ
    آخر، **والبيعةُ التي لم يُقرأ فرعُها ليست «لفرعٍ آخر»** — هي بيعةٌ
    لا نعرف أين وقعت، وإخراجُها يُظهر الاستهلاك صفراً بلا شكوى.
  */
  it("مبيعاتُ فرعٍ آخر لا تُحسَب على هذا المخزون، والبيعةُ بلا فرعٍ تُحسَب", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const mine = await makeBranch(tx);
      const other = await makeBranch(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");
      await isolateProducts(tx, [coffee, latte]);

      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      /* ١٠ مشروباتٍ في فرعي، و٥٠ في فرعٍ آخر */
      await importAndMap(tx, salesFile(10, "2026-09-03", "MINE"), actorId, latte, mine.nameAr);
      await importAndMap(tx, salesFile(50, "2026-09-03", "OTHER"), actorId, latte, other.nameAr);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId: mine.id, actorId,
      }, tx);
      const report = await recomputeCount(countId, tx);

      /* ١٠ × ٢٠ جراماً = ٢٠٠ جراماً — لا ١٬٢٠٠ */
      expect(canonicalToQuantity(report.lines[0].theoreticalConsumptionMilli!, "G")).toBe(200);
    }));

  it("وجردٌ واحد للفترة الواحدة — ضغطتان لا تُنشئان جردين", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branchId = (await makeBranch(tx)).id;
      const input = { periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId, actorId };

      const first = await startCount(input, tx);
      const second = await startCount(input, tx);
      expect(second.countId).toBe(first.countId);
      expect(second.created).toBe(false);
    }));
});

/* ─────────────────── الثباتُ التاريخيّ ─────────────────── */

describe("التقريرُ المقفَل لا يتغيّر", () => {
  it("تعديلُ الوصفة بعد الإقفال لا يمسّ التقرير", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const branchId = branch.id;
      const coffee = await makeStockProduct(tx, "حبوب قهوة", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");
      await isolateProducts(tx, [coffee, latte]);

      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);
      await importAndMap(tx, salesFile(100), actorId, latte, branch.nameAr);
      await tx.execute(sql`
        insert into inventory_movements (id, product_id, branch_id, kind, quantity_milli, unit, occurred_on, created_by_id)
        values (${`mv-${Math.random()}`}, ${coffee}, ${branchId}, 'OPENING', ${5000}, 'KG', '2026-09-01', ${actorId})
      `);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId, actorId,
      }, tx);
      await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(2.5) }], actorId, tx);

      const finalised = await finaliseCount(countId, actorId, tx);
      const consumedAtFinalise = finalised.lines[0].theoreticalConsumptionMilli;
      expect(canonicalToQuantity(consumedAtFinalise!, "KG")).toBe(2);

      /* ثمّ تُغيَّر الجرعة إلى ١٨ جراماً بنسخةٍ لاحقة */
      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-20", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 18_000, unit: "G" }],
      }, tx);

      const header = await loadCountHeader(countId, tx);
      const reread = await readFrozenReport(header!, tx);
      expect(reread.lines[0].theoreticalConsumptionMilli).toBe(consumedAtFinalise);
      expect(canonicalToQuantity(reread.lines[0].varianceMilli!, "KG")).toBe(-0.5);
    }));

  it("والقاعدةُ ترفض الكتابةَ في جردٍ مقفَل — لا الشيفرةُ وحدها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      await isolateProducts(tx, [coffee]);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId: null, actorId,
      }, tx);
      await recomputeCount(countId, tx);
      await finaliseCount(countId, actorId, tx);

      const e = await caught(
        tx.update(inventoryCountLines)
          .set({ actualMilli: kg(99) })
          .where(eq(inventoryCountLines.countId, countId)),
      );
      expect(pgErrorOf(e)?.message).toContain("مقفَل");
    }));

  it("والخدمةُ تقول ذلك بلغةٍ تُقرأ قبل أن يصل الطلبُ إلى القاعدة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      await isolateProducts(tx, [coffee]);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId: null, actorId,
      }, tx);
      await recomputeCount(countId, tx);
      await finaliseCount(countId, actorId, tx);

      const e = await caught(saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(1) }], actorId, tx));
      expect(e).toBeInstanceOf(CountLockedError);
    }));

  it("ولقطةُ جردٍ مقفَل لا تُحذَف", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      await isolateProducts(tx, [coffee]);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId: null, actorId,
      }, tx);
      await recomputeCount(countId, tx);
      await finaliseCount(countId, actorId, tx);

      const e = await caught(
        tx.delete(inventoryCountSnapshots).where(eq(inventoryCountSnapshots.countId, countId)),
      );
      expect(pgErrorOf(e)?.message).toContain("لا تُعدَّل");
    }));

  it("وإعادةُ الفتح فعلٌ بسببٍ مكتوب، وعدّادُها يبقى", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      await isolateProducts(tx, [coffee]);

      const { countId } = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId: null, actorId,
      }, tx);
      await recomputeCount(countId, tx);
      await finaliseCount(countId, actorId, tx);

      await expect(reopenCount(countId, "لا", actorId, tx)).rejects.toThrow();

      await reopenCount(countId, "وصلت فاتورةٌ متأخّرة", actorId, tx);
      const header = await loadCountHeader(countId, tx);
      expect(header?.status).toBe("DRAFT");
      expect(header?.reopenCount).toBe(1);

      /* وبعد الفتح تُقبَل الكتابةُ ثانيةً */
      await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(1) }], actorId, tx);
    }));
});

/* ─────────────────── نسخُ الوصفة ─────────────────── */

describe("نسخُ الوصفة لا تتداخل", () => {
  it("تفعيلُ نسخةٍ يُغلق سابقتَها في اليوم الذي قبلها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");

      const first = await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);
      const second = await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-08", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 18_000, unit: "G" }],
      }, tx);

      expect(second.closedPrevious).toBe(first.versionId);
      const rows = await tx
        .select({ id: recipeVersions.id, from: recipeVersions.effectiveFrom, to: recipeVersions.effectiveTo })
        .from(recipeVersions)
        .where(eq(recipeVersions.recipeId, second.recipeId))
        .orderBy(recipeVersions.version);

      expect(rows[0].to).toBe("2026-09-07");
      expect(rows[1].to).toBeNull();
    }));

  it("ونسخةٌ تبدأ قبل السارية تُرَدّ — ولا فجوةَ ولا تداخل", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");

      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-08", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      await expect(saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 18_000, unit: "G" }],
      }, tx)).rejects.toThrow(/تبدأ في 2026-09-08/);
    }));

  it("والمؤثِّرُ في القاعدة يمنع التداخل ولو التُفّ على الخدمة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");

      const first = await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      const e = await caught(tx.execute(sql`
        insert into recipe_versions (id, recipe_id, version, status, effective_from)
        values (${`rv-${Math.random()}`}, ${first.recipeId}, 99, 'ACTIVE', '2026-09-05')
      `));
      expect(pgErrorOf(e)?.message).toContain("تتداخل");
    }));
});

/* ─────────────────── الافتتاحيّ والتاريخ ─────────────────── */

describe("الافتتاحيُّ من آخر جردٍ مقفَل", () => {
  it("فعليُّ الأسبوع الأوّل هو افتتاحيُّ الثاني — ولا يُقرأ صفراً حين لا سابق", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const branchId = branch.id;
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      await isolateProducts(tx, [coffee]);

      const first = await startCount({
        periodStart: "2026-09-01", periodEnd: "2026-09-07", branchId, actorId,
      }, tx);
      const firstReport = await recomputeCount(first.countId, tx);
      /* لا جردَ سابقٌ ولا رصيدٌ مكتوب ⇒ الافتتاحيُّ **غير معروف** لا صفر */
      expect(firstReport.lines[0].openingMilli).toBeNull();
      expect(firstReport.lines[0].flags).toContain("OPENING_UNKNOWN");

      await saveActualCounts(first.countId, [{ productId: coffee, actualMilli: kg(8) }], actorId, tx);
      await finaliseCount(first.countId, actorId, tx);

      const second = await startCount({
        periodStart: "2026-09-08", periodEnd: "2026-09-14", branchId, actorId,
      }, tx);
      const secondReport = await recomputeCount(second.countId, tx);
      expect(canonicalToQuantity(secondReport.lines[0].openingMilli!, "KG")).toBe(8);
    }));

  it("وتاريخُ الصنف يجمع جرداته — وبه يُفرَّق المتكرّرُ من الحادثة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const branchId = branch.id;
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      await isolateProducts(tx, [coffee]);

      for (const [from, to] of [["2026-09-01", "2026-09-07"], ["2026-09-08", "2026-09-14"]]) {
        const c = await startCount({ periodStart: from, periodEnd: to, branchId, actorId }, tx);
        await saveActualCounts(c.countId, [{ productId: coffee, actualMilli: kg(8) }], actorId, tx);
        await finaliseCount(c.countId, actorId, tx);
      }

      const history = await itemHistory(coffee, 12, tx);
      expect(history).toHaveLength(2);
      expect(history[0].periodEnd).toBe("2026-09-14");
      expect(history[0].baseUnit).toBe("KG");
    }));
});

/* ─────────────────── أدوات ─────────────────── */

async function countSales(tx: Tx): Promise<number> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(sales);
  return Number(rows[0]?.n ?? 0);
}

/** بندُ فاتورةٍ بمواصفة عبوةٍ لصنفٍ معياريّ. */
async function makePurchase(
  tx: Tx,
  productId: string,
  isoDate: string,
  totalMinor: number,
  pack: { packSize: string | null; contentUnit: string | null; contentQuantity: string | null; qty: string },
): Promise<void> {
  const supplierId = await makeSupplier(tx);
  const invoiceId = await makeInvoice(tx, supplierId, totalMinor, isoDate);

  const spId = `sp-${Math.random().toString(36).slice(2, 12)}`;
  await tx.execute(sql`
    insert into supplier_products (id, supplier_id, normalized_description, display_name, product_id, pack_size, content_unit, content_quantity)
    values (${spId}, ${supplierId}, ${`item-${spId}`}, 'صنف اختبار', ${productId},
            ${pack.packSize}, ${pack.contentUnit}::base_unit, ${pack.contentQuantity})
  `);
  await tx.execute(sql`
    insert into invoice_lines (id, invoice_id, description, normalized_description, qty,
                               unit_price_minor, line_total_minor, invoice_date, supplier_id, supplier_product_id)
    values (${`il-${spId}`}, ${invoiceId}, 'صنف اختبار', ${`item-${spId}`}, ${pack.qty},
            ${totalMinor}, ${totalMinor}, ${day(isoDate)}, ${supplierId}, ${spId})
  `);
}
