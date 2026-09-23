import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { caught, withRollback } from "@/test/db";
import { isolateProducts, makeActor, makeBranch, makeInvoicePurchase } from "@/test/inventory";
import { importFoodicsCatalog } from "./catalog-import.service";
import { importSalesFile } from "./sales-import.service";
import {
  finaliseCount, listCounts, loadCountHeader, loadScope, readFrozenReport, recomputeCount,
  saveActualCounts, saveCountScope, setOpenings, startCount,
} from "./inventory.service";
import { PossibleDuplicateReceiptError, createReceipt, resolveReceipt } from "./inventory-receipt.service";
import { correctRecipeVersion, RecipeLockedError } from "./recipe.service";
import { canonicalToQuantity, toCanonical } from "@/lib/inventory/units";
import { combineSummaries } from "@/lib/inventory/variance-summary";

/**
 * شهادةُ الجرد الأسبوعيّ على بيانات المقهى الحقيقيّة.
 *
 * كتالوجُ فودكس بملفّاته الثلاثة، وتصديرُ مبيعات أسبوع ١٣–١٩ سبتمبر
 * كما نزل (٢٬٠٨١ صفّاً)، ثمّ الأسبوعُ كما يجري: نطاقٌ يُختار ← افتتاحيٌّ
 * يُدخَل ← كمّيّةٌ مستلَمة ← عدٌّ ← فرقٌ ← إقفال ← سجلٌّ واتّجاه.
 *
 * وكلُّ خطوةٍ تمرّ بالخدمة التي تمرّ بها الشاشة، في معاملةٍ تُلغى.
 * والأرقامُ من الملفّات لا من توقُّع.
 */
const ITEMS = "src/test/fixtures/foodics-inventory-items.csv";
const PRODUCTS = "src/test/fixtures/foodics-products.csv";
const INGREDIENTS = "src/test/fixtures/foodics-product-ingredients.csv";
const SALES = "src/test/fixtures/foodics-order-items.xlsx";
const WEEK = { start: "2026-09-13", end: "2026-09-19" };

const file = (path: string) => ({ fileName: path.split("/").pop()!, buffer: readFileSync(path) });

describe("شهادةُ الجرد الأسبوعيّ على بيانات المقهى الحقيقيّة", () => {
  it("من الكتالوج والمبيعات إلى جردٍ مقفَلٍ يُقرأ في السجلّ والاتّجاه", () =>
    withRollback(async (tx) => {
      const log: string[] = [];
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);

      /* ١ · الكتالوج */
      const catalog = await importFoodicsCatalog(
        { files: [file(ITEMS), file(PRODUCTS), file(INGREDIENTS)], effectiveFrom: WEEK.start, actorId }, tx,
      );
      expect(catalog.stockItems.created).toBe(60);
      expect(catalog.recipes.written).toBe(49);
      const stock = (await tx.execute<{ id: string; sku: string }>(sql`
        select id, foodics_item_sku as sku from products where foodics_item_sku is not null
      `)).rows.map((r) => ({ id: String(r.id), sku: String(r.sku) }));
      const menu = (await tx.execute<{ id: string }>(sql`
        select id from products where foodics_product_sku is not null
      `)).rows.map((r) => String(r.id));
      await isolateProducts(tx, [...stock.map((s) => s.id), ...menu]);
      log.push(`الكتالوج: ${catalog.stockItems.created} صنفَ مخزون · ${catalog.recipes.written} وصفة`);

      /* ٢ · المبيعات — ومرّةً ثانية: الملفُّ عينُه لا يدخل مرّتين */
      const sales = await importSalesFile(
        { buffer: readFileSync(SALES), fileName: "sales.xlsx", actorId, branchLabel: branch.nameAr }, tx,
      );
      const again = await importSalesFile(
        { buffer: readFileSync(SALES), fileName: "sales-again.xlsx", actorId, branchLabel: branch.nameAr }, tx,
      );
      expect(again.status).toBe("DUPLICATE");
      log.push(`المبيعات: ${JSON.stringify(sales.status)} · والملفُّ نفسُه ثانيةً ${again.status}`);

      /* ٣ · الجرد: والمربوطُ بالكتالوج لا يُسأل عن ربطه */
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      let report = await recomputeCount(countId, tx);
      expect(report.lines).toHaveLength(60);
      expect(report.coverage.readiness).not.toBe("BLOCKED");
      log.push(`التغطية: ${report.coverage.readiness} · أسطرُ بيعٍ ${report.coverage.sales.includedLines} من ${report.coverage.sales.lines}`);

      /* ٤ · النطاق: خمسةٌ خارجه، صراحةً — ويبقى بعد «التحديث» */
      const sorted = [...stock].sort((a, b) => a.sku.localeCompare(b.sku));
      const excluded = sorted.slice(-5).map((s) => s.id);
      const included = sorted.slice(0, -5).map((s) => s.id);
      await saveCountScope(countId, { included, excluded }, actorId, tx);
      report = await recomputeCount(countId, tx);
      const scope = await loadScope(countId, tx);
      expect(scope.explicit).toBe(true);
      expect(report.lines.filter((l) => l.inScope)).toHaveLength(55);
      expect(report.coverage.scope.excluded).toBe(5);
      log.push(`النطاق: ${report.coverage.scope.included} داخله · ${report.coverage.scope.excluded} خارجه باختيار`);

      /* ٥ · الاستهلاكُ المتوقَّع — بنُّ إثيوبيا ٥٫٧١٥ كجم من ملفّ المبيعات */
      const coffee = stock.find((s) => s.sku === "sk-0003")!.id;
      let line = report.lines.find((l) => l.productId === coffee)!;
      expect(canonicalToQuantity(line.theoreticalConsumptionMilli!, "KG")).toBe(5.715);
      const knownConsumption = report.lines.filter((l) => l.inScope && l.theoreticalConsumptionMilli !== null).length;
      const unknownConsumption = report.lines.filter((l) => l.inScope && l.theoreticalConsumptionMilli === null).length;
      log.push(`الاستهلاكُ المتوقَّع: معروفٌ لـ${knownConsumption} · مجهولٌ لـ${unknownConsumption} (لا وصفةَ تصل إليه) — معلَن`);

      /* ٦ · الافتتاحيُّ: لا جردَ سابق، فكلُّه مجهول — ثمّ يُدخَل للبنّ بالكيلو */
      expect(report.lines.filter((l) => l.inScope && l.openingSource === "UNKNOWN")).toHaveLength(55);
      await setOpenings(countId, [{ productId: coffee, enteredMilli: 8000, unit: "KG" }], actorId, tx);
      line = (await recomputeCount(countId, tx)).lines.find((l) => l.productId === coffee)!;
      expect(line.openingMilli).toBe(toCanonical(8_000_000, "G"));
      expect(line.openingSource).toBe("MANUAL");
      log.push("الافتتاحيّ: ٨ كجم بنٍّ أُدخلت بالكيلو فحُفظت ٨٬٠٠٠ جرام — «أُدخل يدوياً»");

      /* ٧ · كمّيّةٌ مستلَمة: ٢ كجم يوم ١٦ */
      const receiptId = await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-16", enteredMilli: 2000, unit: "KG",
      }, actorId, tx);
      line = (await recomputeCount(countId, tx)).lines.find((l) => l.productId === coffee)!;
      expect(canonicalToQuantity(line.purchasesMilli!, "KG")).toBe(2);

      /* ٨ · ثمّ وصلت فاتورتُها — فلا تُحسَب أربعة: مجهولةٌ حتى تُحسَم، ثمّ مرّةً واحدة */
      const invoiceLine = await makeInvoicePurchase(tx, coffee, "2026-09-18", 176_00, {
        packSize: "1", contentUnit: "KG", contentQuantity: "2", qty: "1",
      });
      line = (await recomputeCount(countId, tx)).lines.find((l) => l.productId === coffee)!;
      expect(line.purchasesMilli).toBeNull();
      expect(line.flags).toContain("RECEIPT_POSSIBLE_DUPLICATE");
      await resolveReceipt(receiptId, { kind: "LINK", invoiceLineId: invoiceLine }, actorId, tx);
      line = (await recomputeCount(countId, tx)).lines.find((l) => l.productId === coffee)!;
      expect(canonicalToQuantity(line.purchasesMilli!, "KG")).toBe(2);
      /* وإدخالُها ثانيةً يُسأل عنه قبل أن يُكتَب */
      expect(await caught(createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-18", enteredMilli: 2000, unit: "KG",
      }, actorId, tx))).toBeInstanceOf(PossibleDuplicateReceiptError);
      log.push("الاستلام: ٢ كجم يدوياً، ثمّ فاتورتُها ← مجهولةٌ حتى رُبطتا ← ٢ كجم مرّةً واحدة");

      /* ٩ · العدُّ والفرق: ٨ + ٢ − ٥٫٧١٥ = ٤٫٢٨٥ متوقَّعاً، ووُجد ٤٫٢ ← −٨٥ جراماً */
      report = await saveActualCounts(countId, [{ productId: coffee, actualMilli: toCanonical(4_200_000, "G") }], actorId, tx);
      line = report.lines.find((l) => l.productId === coffee)!;
      expect(canonicalToQuantity(line.theoreticalClosingMilli!, "KG")).toBe(4.285);
      expect(canonicalToQuantity(line.varianceMilli!, "G")).toBe(-85);
      expect(report.totals.summary.shortageCostMinor).toBeGreaterThan(0);
      log.push(`الفرق: متوقَّع ٤٫٢٨٥ كجم · فعليّ ٤٫٢ · فرقٌ −٨٥ جم · نقصٌ ${report.totals.summary.shortageCostMinor} هللة`);

      /* ١٠ · الإقفال — والمقفَلُ لا يتغيّر بتصحيح وصفةٍ ولا باستلامٍ متأخّر */
      await finaliseCount(countId, actorId, tx);
      const header = (await loadCountHeader(countId, tx))!;
      const frozen = await readFrozenReport(header, tx);
      const frozenCoffee = frozen.lines.find((l) => l.productId === coffee)!;

      const iced = (await tx.execute<{ id: string }>(sql`
        select r.product_id as id from recipes r join products p on p.id = r.product_id
         where p.name_en ilike 'Iced V60 Ethiopia' or p.name_ar ilike 'Iced V60 Ethiopia' limit 1
      `)).rows[0];
      if (iced) {
        expect(await caught(correctRecipeVersion({
          menuProductId: String(iced.id), actorId,
          ingredients: [{ productId: coffee, quantityMilli: 30_000, unit: "G" }],
        }, tx))).toBeInstanceOf(RecipeLockedError);
      }
      expect(await caught(createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-17", enteredMilli: 1000, unit: "KG",
        resolution: { kind: "SEPARATE" },
      }, actorId, tx))).toBeInstanceOf(Error);

      const reread = (await readFrozenReport(header, tx)).lines.find((l) => l.productId === coffee)!;
      expect(reread.varianceMilli).toBe(frozenCoffee.varianceMilli);
      expect(reread.openingSource).toBe("MANUAL");
      const [snap] = (await tx.execute<{ provenance: Record<string, unknown> }>(sql`
        select provenance from inventory_count_snapshots where count_id = ${countId}
      `)).rows;
      expect((snap.provenance.receiptIds as string[])).toContain(receiptId);
      expect((snap.provenance.scope as { source: string }).source).toBe("EXPLICIT");
      log.push("الإقفال: لقطةٌ بمصادر الافتتاحيّ والاستلامات والنطاق — والوصفةُ والاستلامُ المتأخّر مردودان");

      /* ١١ · السجلُّ والاتّجاه يقرآن الجردَ المقفَل */
      const history = (await listCounts(10, tx)).find((c) => c.id === countId)!;
      expect(history.status).toBe("FINALISED");
      expect(history.itemsInScope).toBe(55);
      const trend = combineSummaries([history.summary]);
      expect(trend.shortageCostMinor).toBe(history.summary.shortageCostMinor);
      log.push(`السجلّ: نقص ${history.summary.shortageCostMinor} · زيادة ${history.summary.overageCostMinor} · عُدّ ${history.itemsCounted} من ${history.itemsInScope}`);

      /* ١٢ · والناقصُ معلَن: أرصدةٌ مجهولة وفجواتٌ بأسمائها */
      const unknownOpenings = frozen.lines.filter((l) => l.inScope && l.openingSource === "UNKNOWN").length;
      expect(unknownOpenings).toBe(54);
      log.push(`المعلَن: ${unknownOpenings} صنفاً افتتاحيُّه مجهول · فجواتُ التغطية ${frozen.coverage.gaps.map((g) => `${g.label} (${g.count})`).join(" · ") || "لا شيء"}`);

      console.log(["", "── شهادةُ الجرد على بيانات المقهى ──", ...log.map((l) => `  ✓ ${l}`), ""].join("\n"));
    }), 60_000);
});
