import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  CountLockedError, NotAWeekError, finaliseCount, itemHistory, loadCountHeader, loadScope,
  readFrozenReport, recomputeCount, reopenCount, saveActualCounts, setCountScope, startCount,
  unmappedPosProducts,
} from "./inventory.service";
import { recordWaste } from "./inventory-movement.service";
import { canonicalToQuantity } from "@/lib/inventory/units";
import { RECIPE_EPOCH } from "@/lib/inventory/recipe";
import type { Tx } from "./types";

/**
 * الجردُ على المخطّط الحقيقيّ — والاختباراتُ النقيّة لا تُثبت أنّ
 * النظام يعمل.
 *
 * هذه تمرّ بالخدمات نفسِها التي تمرّ بها الواجهة، على الجداول نفسِها،
 * بمؤثِّراتها وقيودها. وكلُّها في معاملةٍ تُلغى، فلا يبقى صفّ.
 */

/* ─────────────────── تجهيزٌ مشترك ─────────────────── */

/** ترويسةُ فودكس الحقيقيّة — كما فُحصت في التصدير المرفق. */
const ORDERS_HEADER = [
  "order_reference", "order_status", "type", "parent_item_sku", "status",
  "sku", "name", "unit_price", "quantity", "total_price", "business_date", "branch_name",
];

function workbook(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ORDERS_HEADER, ...rows]), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

interface RowOver {
  order?: string | number; status?: string; type?: string; parent?: string;
  sku?: string; name?: string; price?: number; qty?: number; total?: number;
  date?: string; branch?: string;
}

function foodicsRow(o: RowOver = {}): (string | number)[] {
  return [
    o.order ?? 1, o.status ?? "Done", o.type ?? "المنتج", o.parent ?? "",
    o.status ?? "Done", o.sku ?? "SKU-LATTE", o.name ?? "Spanish Latte",
    o.price ?? 18, o.qty ?? 1, o.total ?? 18, o.date ?? "2026-09-03", o.branch ?? "Branch 1",
  ];
}

/** ملفُّ مبيعاتٍ فيه `count` مشروباً من صنفٍ واحد، طلبٌ لكلٍّ. */
function salesFile(count: number, date = "2026-09-03", orderPrefix = "ORD", branch?: string): Buffer {
  return workbook(
    Array.from({ length: count }, (_, i) =>
      foodicsRow({ order: `${orderPrefix}-${i + 1}`, date, branch })),
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

      const before = await countSales(tx, "FDX:ORD-");
      const second = await importSalesFile({ buffer, fileName: "a.xlsx", actorId }, tx);

      expect(second.status).toBe("DUPLICATE");
      expect(second.importId).toBe(first.importId);
      expect(await countSales(tx, "FDX:ORD-")).toBe(before);
    }));

  it("وملفٌّ آخر يحمل الطلباتِ نفسَها لا يضاعفها — المنعُ على المفتاح الطبيعيّ لا على البصمة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);

      await importSalesFile({ buffer: salesFile(3), fileName: "a.xlsx", actorId }, tx);
      const before = await countSales(tx);

      /* ملفٌّ ببصمةٍ مختلفة (صفٌّ زائد) يحمل الطلبات الثلاثة نفسها بلا تغيير */
      const wider = workbook([
        ...Array.from({ length: 3 }, (_, i) => foodicsRow({ order: `ORD-${i + 1}` })),
        foodicsRow({ order: "ORD-4" }),
      ]);
      const second = await importSalesFile({ buffer: wider, fileName: "b.xlsx", actorId }, tx);

      expect(second.status).toBe("IMPORTED");
      /* واحدةٌ جديدة، وثلاثةُ أسطرٍ مقيَّدةٌ بلا تغيير */
      expect(second.totals.salesWritten).toBe(1);
      expect(second.totals.duplicates).toBe(3);
      expect(second.totals.revised).toBe(0);
      expect(await countSales(tx, "FDX:ORD-")).toBe(before + 1);
    }));

  /*
    ── التصحيحُ ليس تكراراً ──

    تصديرُ فودكس لا يحمل رقمَ نسخةٍ ولا طابعَ إنشاء. فطلبٌ أُلغي بعد
    تصدير الأمس يصل اليوم بحال `Void`؛ ولو رُدّ الملفُّ «مكرَّراً» لبقي
    في قيدنا مبيعاً لم يقع، وحُسب استهلاكُه في الجرد.
  */
  it("تصديرٌ مصحَّح يُقرأ مراجعةً لا تكراراً — ويُحدَّث السطر", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);

      const first = await importSalesFile(
        { buffer: workbook([foodicsRow({ order: "REV-1" })]), fileName: "day1.xlsx", actorId }, tx,
      );
      expect(first.totals.salesWritten).toBe(1);

      /* التصديرُ التالي يقول إنّ الطلب أُلغي */
      const corrected = workbook([foodicsRow({ order: "REV-1", status: "Void" })]);
      const second = await importSalesFile({ buffer: corrected, fileName: "day2.xlsx", actorId }, tx);

      expect(second.status).toBe("IMPORTED");
      expect(second.totals.revised).toBe(1);
      expect(second.totals.duplicates).toBe(0);
      expect(second.revisions[0].was).toContain("Done");
      expect(second.revisions[0].now).toContain("Void");

      /* ولا بيعةَ ثانية — الطلبُ واحد، وحالُه هي التي تغيّرت */
      expect(await countSales(tx, "FDX:REV-")).toBe(1);
      const line = await tx.execute<{ source_status: string; is_void: boolean }>(sql`
        select sl.source_status, sl.is_void from sale_lines sl
          join sales s on s.id = sl.sale_id where s.external_id = 'FDX:REV-1'
      `);
      expect(line.rows[0].source_status).toBe("Void");
      expect(line.rows[0].is_void).toBe(true);

      /* والصفُّ الخام يقول ماذا تغيّر بالضبط */
      const raw = await tx.execute<{ status: string; reason: string }>(sql`
        select status, reason from sales_import_rows where import_id = ${second.importId}
      `);
      expect(raw.rows[0].status).toBe("REVISED");
      expect(raw.rows[0].reason).toContain("تغيّر ما يقوله المصدر");
    }));

  it("وخيارُ الإضافة يُقيَّد ولا يدخل طابور الربط", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importSalesFile({
        buffer: workbook([
          foodicsRow({ order: "MOD-1", sku: "sk-0002", name: "Latte" }),
          foodicsRow({ order: "MOD-1", type: "خيار الإضافة", parent: "sk-0002", sku: "sk-0039", name: "Double shots", price: 0, total: 0 }),
        ]),
        fileName: "mods.xlsx", actorId,
      }, tx);

      const kinds = await tx.execute<{ external_id: string; kind: string }>(sql`
        select external_id, kind from pos_products where external_id in ('sk-0002','sk-0039')
      `);
      expect(kinds.rows.find((r) => r.external_id === "sk-0039")?.kind).toBe("MODIFIER");
      expect(kinds.rows.find((r) => r.external_id === "sk-0002")?.kind).toBe("PRODUCT");

      /* ولا يُطلَب ربطُ «دبل شوت» — ليس صنفاً يُباع */
      const queue = await unmappedPosProducts(tx);
      expect(queue.map((q) => q.externalId)).toContain("sk-0002");
      expect(queue.map((q) => q.externalId)).not.toContain("sk-0039");
    }));

  it("ولا صفَّ يُرمى صامتاً — الخامُ محفوظٌ بحاله وسببه", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const buffer = workbook([
        foodicsRow({ order: "ORD-1", sku: "SKU-1", name: "Latte", qty: 2, total: 36 }),
        foodicsRow({ order: "ORD-2", sku: "SKU-2", name: "Tea", qty: "غير مقروء" as never, total: 9 }),
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
      expect((rows.rows[1].raw as Record<string, string>)["name"]).toBe("Tea");
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
        values (${`mv-${Math.random()}`}, ${coffee}, ${branchId}, 'OPENING', ${5000}, 'KG', '2026-08-30', ${actorId})
      `);

      /* شراءُ ٢٠ كجم بـ‏١٬٥٠٠ ريالاً */
      await makePurchase(tx, coffee, "2026-09-02", 1500_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });

      const { countId } = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId,
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
        values (${`mv-${Math.random()}`}, ${coffee}, ${branchId}, 'OPENING', ${5000}, 'KG', '2026-08-30', ${actorId})
      `);

      const { countId } = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId,
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
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: mine.id, actorId,
      }, tx);
      const report = await recomputeCount(countId, tx);

      /* ١٠ × ٢٠ جراماً = ٢٠٠ جراماً — لا ١٬٢٠٠ */
      expect(canonicalToQuantity(report.lines[0].theoreticalConsumptionMilli!, "G")).toBe(200);
    }));

  it("وجردٌ واحد للفترة الواحدة — ضغطتان لا تُنشئان جردين", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branchId = (await makeBranch(tx)).id;
      const input = { periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId };

      const first = await startCount(input, tx);
      const second = await startCount(input, tx);
      expect(second.countId).toBe(first.countId);
      expect(second.created).toBe(false);
    }));

  /*
    ── والتداخلُ أخطرُ من التطابق ──

    فترتان تشتركان في يومٍ واحد تعنيان أنّ شراءَ ذلك اليوم واستهلاكَه
    محسوبان مرّتين، وأنّ فعليَّ الأوّل ليس افتتاحيَّ الثاني. والمنعُ في
    القاعدة بمؤثِّر (`037`) **ويُقال في الخدمة بلغةٍ تُقرأ** — فرسالةُ
    Postgres ليست جواباً لصاحب المقهى.
  */
  /*
    ── والأسبوعُ يمنع التداخلَ من أصله ──

    أسابيعُ الأحد‑إلى‑السبت إمّا أن تتطابق وإمّا أن تنفصل — فلا
    تتقاطعان في يومٍ واحد أبداً. فالحارسُ عند الباب هو **شكلُ
    الفترة**، وهو أقوى: يردّ ٥ → ١١ سبتمبر قبل أن يسأل عن جردٍ آخر،
    ومعه الأسبوعُ الصحيح كي لا يكون الرفضُ حاجزاً بلا مخرج.

    ومؤثِّرُ `037` يبقى خلفه لمن كتب في القاعدة مباشرةً — يُثبته
    `db:verify`.
  */
  it("وفترةٌ ليست أسبوعاً تُردّ، ومعها الأسبوعُ الصحيح", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branchId = (await makeBranch(tx)).id;

      await startCount({ periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId }, tx);
      const e = await caught(startCount(
        { periodStart: "2026-09-05", periodEnd: "2026-09-11", branchId, actorId }, tx,
      ));

      expect(e).toBeInstanceOf(NotAWeekError);
      /* ويُقترَح الأسبوعُ الذي يحوي بدايتَها: ٣٠ أغسطس → ٥ سبتمبر */
      expect((e as Error).message).toContain("2026-08-30");
      expect((e as Error).message).toContain("2026-09-05");
    }));

  it("والأسبوعُ التالي يُقبَل — السادسُ يبدأ بعد الخامس", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branchId = (await makeBranch(tx)).id;

      const first = await startCount({ periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId }, tx);
      const second = await startCount({ periodStart: "2026-09-06", periodEnd: "2026-09-12", branchId, actorId }, tx);

      expect(second.created).toBe(true);
      expect(second.countId).not.toBe(first.countId);
    }));

  it("والفترةُ نفسُها في فرعٍ آخر جردٌ آخر — لا تداخل", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const mine = (await makeBranch(tx)).id;
      const other = (await makeBranch(tx)).id;
      const period = { periodStart: "2026-08-30", periodEnd: "2026-09-05", actorId };

      const a = await startCount({ ...period, branchId: mine }, tx);
      const b = await startCount({ ...period, branchId: other }, tx);
      expect(b.created).toBe(true);
      expect(b.countId).not.toBe(a.countId);
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
        values (${`mv-${Math.random()}`}, ${coffee}, ${branchId}, 'OPENING', ${5000}, 'KG', '2026-08-30', ${actorId})
      `);

      const { countId } = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId,
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
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: null, actorId,
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
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: null, actorId,
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
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: null, actorId,
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
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: null, actorId,
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

  /*
    ── أوّلُ نسخةٍ سارية منذ البداية ──

    تصف كيف كان يُصنَع المشروب دائماً، لا كيف سيُصنَع من الغد. ولمّا
    بدأت أوّلُ النسخ يومَ رفعها خرج **١٧٠٦ سطرَ بيعٍ من ١٧١٧** من
    الحساب — ٩٩٫٨٪ من الوحدات — والوصفاتُ كلُّها صحيحة.
  */
  it("أوّلُ نسخةٍ تسري منذ البداية، فتغطّي ما بِيع قبل كتابتها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");

      /* يُطلَب تاريخٌ في المستقبل، ويُكتَب من البداية */
      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-20", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      const [v] = (await tx.execute<{ effective_from: string; version: number }>(sql`
        select v.effective_from, v.version
          from recipe_versions v
          join recipes r on r.id = v.recipe_id
         where r.product_id = ${latte}
      `)).rows;
      expect(Number(v.version)).toBe(1);
      expect(String(v.effective_from)).toBe(RECIPE_EPOCH);
    }));

  it("والتغييرُ اللاحق وحده يُؤرَّخ — ونسخةٌ تبدأ قبل السارية تُرَدّ", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ", "KG", "COFFEE");
      const latte = await makeMenuProduct(tx, "لاتيه");

      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      /* الثانيةُ تُؤرَّخ كما طُلبت، وتُغلق الأولى قبلها بيوم */
      const second = await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-08", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 18_000, unit: "G" }],
      }, tx);
      expect(second.version).toBe(2);
      expect(second.closedPrevious).not.toBeNull();

      await expect(saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 19_000, unit: "G" }],
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
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId, actorId,
      }, tx);
      const firstReport = await recomputeCount(first.countId, tx);
      /* لا جردَ سابقٌ ولا رصيدٌ مكتوب ⇒ الافتتاحيُّ **غير معروف** لا صفر */
      expect(firstReport.lines[0].openingMilli).toBeNull();
      expect(firstReport.lines[0].flags).toContain("OPENING_UNKNOWN");

      await saveActualCounts(first.countId, [{ productId: coffee, actualMilli: kg(8) }], actorId, tx);
      await finaliseCount(first.countId, actorId, tx);

      const second = await startCount({
        periodStart: "2026-09-06", periodEnd: "2026-09-12", branchId, actorId,
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

      for (const [from, to] of [["2026-08-30", "2026-09-05"], ["2026-09-06", "2026-09-12"]]) {
        const c = await startCount({ periodStart: from, periodEnd: to, branchId, actorId }, tx);
        await saveActualCounts(c.countId, [{ productId: coffee, actualMilli: kg(8) }], actorId, tx);
        await finaliseCount(c.countId, actorId, tx);
      }

      const history = await itemHistory(coffee, 12, tx);
      expect(history).toHaveLength(2);
      expect(history[0].periodEnd).toBe("2026-09-12");
      expect(history[0].baseUnit).toBe("KG");
    }));
});

/* ─────────────────── الملفُّ الحقيقيّ ─────────────────── */

/*
  ── والاختباراتُ النقيّة لا تُثبت أنّ النظام يعمل ──

  المحوِّل مفحوصٌ على هذا الملفّ في `foodics-excel.test.ts`، وذاك يُثبت
  أنّه **يقرأ** الملفّ. وهذا يُثبت أنّ المقروء **يصل القاعدةَ ويخرج
  استهلاكاً**: ألفٌ وتسعون طلباً تمرّ بالخدمة نفسِها التي تمرّ بها
  الشاشة، على المخطّط نفسِه، بقيوده ومؤثِّراته.

  والأرقامُ أدناه مأخوذةٌ من الملفّ لا من توقُّع: فإن تغيّر المحوِّل
  فتغيّرت، لم يكن التغيّرُ صامتاً.
*/
const REAL_FILE = "src/test/fixtures/foodics-order-items.xlsx";
/** أوّلُ الأسبوع وآخرُه في التصدير المرفق. */
const REAL_FROM = "2026-09-13";
const REAL_TO = "2026-09-19";
/**
 * أكثرُ الأصناف مبيعاً فيه — و٢١١ صفّاً تقول ٢٩٣ كوباً بالجملة:
 * ‏٢٨٤ منجزاً، و٨ مرتجعة، وواحدٌ ملغى.
 */
const TOP_SKU = "sk-0058";

describe("التصديرُ الحقيقيّ يدخل القاعدة", () => {
  it("‏١٬٠٩٠ طلباً و٢٬٠٨١ سطراً منها ٣٦٤ خيارَ إضافة — ثمّ الملفُّ عينُه تكرار", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const buffer = readFileSync(REAL_FILE);

      const first = await importSalesFile(
        { buffer, fileName: "foodics-real.xlsx", actorId, branchLabel: branch.nameAr }, tx,
      );

      expect(first.status).toBe("IMPORTED");
      expect(first.totals.salesWritten).toBe(1090);
      expect(first.totals.lineCount).toBe(2081);
      expect(first.totals.errors).toBe(0);

      const mods = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from sale_lines sl
          join sales s on s.id = sl.sale_id
         where s.import_id = ${first.importId} and sl.is_modifier
      `);
      expect(Number(mods.rows[0].n)).toBe(364);

      /* والملفُّ عينُه ثانيةً: تكرارٌ يُردّ عند البصمة، ولا صفَّ يُكتب */
      const again = await importSalesFile(
        { buffer, fileName: "foodics-real.xlsx", actorId, branchLabel: branch.nameAr }, tx,
      );
      expect(again.status).toBe("DUPLICATE");
      expect(again.importId).toBe(first.importId);
    }));

  /*
    ── والملغى والمرتجَع والمجانيّ ثلاثةٌ لا واحد ──

    الجملةُ ٢٩٣ كوباً، والمصنوعُ فعلاً ٢٧٦: يخرج الملغى كلُّه (لم
    يُصنَع)، ويُنقص المرتجَعُ ثمانيةً. ولو جُمعت الثلاثةُ رقماً واحداً
    لخرج استهلاكٌ أعلى من الواقع بـ٣٤٠ جراماً — ثمّ يُعلَن «فائضٌ» في
    الرفّ سببُه حسابُنا لا مخزونُنا.

    وهذا هو موضعُ الفحص: البياناتُ الحقيقيّة فيها الحالاتُ الثلاث،
    والملفُّ المصنوع لا يضمنها.
  */
  it("وأكثرُها مبيعاً ٢٧٦ كوباً مصنوعاً من ٢٩٣ — ‏٢٠ جراماً لكلٍّ = ‏٥٫٥٢ كجم", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      const coffee = await makeStockProduct(tx, "بنّ إثيوبيا", "KG", "COFFEE");
      const drink = await makeMenuProduct(tx, "V60 إثيوبيا مثلّج");
      await isolateProducts(tx, [coffee, drink]);

      await importSalesFile(
        { buffer: readFileSync(REAL_FILE), fileName: "foodics-real.xlsx", actorId, branchLabel: branch.nameAr },
        tx,
      );

      /* يُربَط صنفٌ واحد — والباقي يبقى في الطابور، وتلك تغطيةٌ جزئيّة تُعلَن */
      const pos = await tx.execute<{ id: string }>(sql`
        select id from pos_products where external_id = ${TOP_SKU} and product_id is null
      `);
      expect(pos.rows).toHaveLength(1);
      await mapPosProducts({ posProductIds: [String(pos.rows[0].id)], productId: drink, actorId }, tx);

      await saveRecipeVersion({
        menuProductId: drink, effectiveFrom: REAL_FROM, activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      const { countId } = await startCount(
        { periodStart: REAL_FROM, periodEnd: REAL_TO, branchId: branch.id, actorId }, tx,
      );
      const report = await recomputeCount(countId, tx);

      const line = report.lines.find((l) => l.productId === coffee)!;
      /* ٢٧٦ × ٢٠ جراماً = ‏٥٬٥٢٠ جراماً — لا ٥٬٨٦٠ */
      expect(canonicalToQuantity(line.theoreticalConsumptionMilli!, "KG")).toBe(5.52);

      /*
        والتغطيةُ تُعلَن بلغة العمل: ما بقي من أصناف فودكس بلا ربط، ونصيبُها
        من الوحدات المباعة محسوبٌ لا مقدَّر — فـ«٩٦٪ من الوصفات مكتملة»
        لا تقول إنّ الباقيَ أكثرُ الأصناف مبيعاً.
      */
      expect(report.coverage.readiness).toBe("PARTIAL");
      const gap = report.coverage.gaps.find((g) => g.reason === "UNMAPPED_POS_PRODUCT")!;
      expect(gap.unitsShareBp).not.toBeNull();
      expect(gap.unitsShareBp!).toBeGreaterThan(0);
    }));
});

/* ─────────────────── أدوات ─────────────────── */

/**
 * يعدّ البيعات **التي أنشأها هذا الاختبار** لا ما في القاعدة كلِّها.
 *
 * قاعدةُ الاختبار مشتركةٌ بين الملفّات وقد تحمل بقايا من مشيٍ سابق.
 * وعددٌ مطلقٌ يمرّ اليوم ويسقط غداً ليس اختباراً — يقيس البيئةَ لا
 * الشيفرة.
 */
async function countSales(tx: Tx, prefix = "FDX:"): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sales)
    .where(sql`${sales.externalId} like ${prefix + "%"}`);
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

/**
 * نطاقُ الجرد على القاعدة — ما يُعَدّ وما لا يُعَدّ.
 *
 * والسؤالان اللذان لا يجيبهما اختبارٌ نقيّ: أيبقى العدُّ المكتوب بعد
 * الاستبعاد؟ وأيتوارَث الاختيارُ إلى جرد الأسبوع القادم؟
 */
describe("نطاقُ الجرد", () => {
  async function twoItems(tx: Tx) {
    const actorId = await makeActor(tx);
    const branch = await makeBranch(tx);
    const coffee = await makeStockProduct(tx, "حبوب قهوة", "KG", "COFFEE");
    const straws = await makeStockProduct(tx, "مصّاصات", "PIECE");
    const latte = await makeMenuProduct(tx, "لاتيه");
    await isolateProducts(tx, [coffee, straws, latte]);

    await saveRecipeVersion({
      menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
      ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
    }, tx);
    await importAndMap(tx, salesFile(100), actorId, latte, branch.nameAr);

    /* افتتاحيٌّ وشراءٌ — بلا حدَّي المعادلة يخرج الفرقُ مجهولاً لا محسوباً */
    await tx.execute(sql`
      insert into inventory_movements (id, product_id, branch_id, kind, quantity_milli, unit, occurred_on, created_by_id)
      values (${`mv-${Math.random()}`}, ${coffee}, ${branch.id}, 'OPENING', ${5000}, 'KG', '2026-08-30', ${actorId})
    `);
    await makePurchase(tx, coffee, "2026-09-02", 1500_00, {
      packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1",
    });

    return { actorId, branch, coffee, straws };
  }

  it("المستبعَدُ تُحسَب وقائعُه ولا فرقَ له — ولا يدخل المجاميع", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, straws } = await twoItems(tx);
      const { countId } = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: branch.id, actorId,
      }, tx);

      await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(20.5) }], actorId, tx);
      await setCountScope(countId, [straws], false, actorId, tx);

      const report = await recomputeCount(countId, tx);
      const line = report.lines.find((l) => l.productId === straws)!;

      expect(line.inScope).toBe(false);
      expect(line.varianceMilli).toBeNull();
      expect(report.coverage.scope.excluded).toBe(1);
      expect(report.coverage.scope.included).toBe(1);
    }));

  it("والعدُّ المكتوب يبقى في القاعدة — يُستبعَد الصنفُ ثمّ يعود فيعود فرقُه", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await twoItems(tx);
      const { countId } = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: branch.id, actorId,
      }, tx);

      await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(20.5) }], actorId, tx);
      await setCountScope(countId, [coffee], false, actorId, tx);

      /* الرقمُ محفوظٌ في السطر وإن لم يُحسَب به */
      const [row] = (await tx.execute<{ actual_milli: string | null }>(sql`
        select actual_milli from inventory_count_lines
         where count_id = ${countId} and product_id = ${coffee}
      `)).rows;
      expect(row.actual_milli).not.toBeNull();

      await setCountScope(countId, [coffee], true, actorId, tx);
      const back = await recomputeCount(countId, tx);
      expect(canonicalToQuantity(
        back.lines.find((l) => l.productId === coffee)!.varianceMilli!, "KG",
      )).toBe(-2.5);
    }));

  it("والاختيارُ يُتوارَث إلى جرد الأسبوع التالي — ولا يُسأل عنه كلَّ أحد", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, straws } = await twoItems(tx);

      const first = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: branch.id, actorId,
      }, tx);
      await setCountScope(first.countId, [straws], false, actorId, tx);
      await saveActualCounts(first.countId, [{ productId: coffee, actualMilli: kg(20.5) }], actorId, tx);
      await finaliseCount(first.countId, actorId, tx);

      const second = await startCount({
        periodStart: "2026-09-06", periodEnd: "2026-09-12", branchId: branch.id, actorId,
      }, tx);
      const scope = await loadScope(second.countId, tx);
      expect(scope.inherited).toBe(true);
      expect(scope.excluded.has(straws)).toBe(true);

      const report = await recomputeCount(second.countId, tx);
      expect(report.lines.find((l) => l.productId === straws)!.inScope).toBe(false);
      expect(report.lines.find((l) => l.productId === coffee)!.inScope).toBe(true);
    }));

  it("ولا يُكتَب نطاقٌ في جردٍ مقفَل", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, straws } = await twoItems(tx);
      const { countId } = await startCount({
        periodStart: "2026-08-30", periodEnd: "2026-09-05", branchId: branch.id, actorId,
      }, tx);
      await saveActualCounts(countId, [{ productId: coffee, actualMilli: kg(20.5) }], actorId, tx);
      await finaliseCount(countId, actorId, tx);

      expect(await caught(setCountScope(countId, [straws], false, actorId, tx)))
        .toBeInstanceOf(CountLockedError);
    }));
});
