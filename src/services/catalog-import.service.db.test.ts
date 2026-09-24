import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { caught, withRollback } from "@/test/db";
import { isolateProducts, makeActor, makeBranch, makeStockProduct } from "@/test/inventory";
import { importFoodicsCatalog } from "./catalog-import.service";
import { importSalesFile } from "./sales-import.service";
import { saveRecipeVersion } from "./recipe.service";
import { recomputeCount, startCount } from "./inventory.service";
import { canonicalToQuantity } from "@/lib/inventory/units";
import type { Tx } from "./types";

/**
 * الكتالوجُ الحقيقيّ يدخل القاعدة.
 *
 * ثلاثةُ ملفّاتٍ كما نزلت من فودكس، تمرّ بالخدمة نفسِها التي تمرّ بها
 * الشاشة، على المخطّط نفسِه. والأرقامُ مأخوذةٌ من الملفّات لا من
 * توقُّع — فإن تغيّر المحوِّل فتغيّرت، لم يكن التغيّرُ صامتاً.
 */
const ITEMS = "src/test/fixtures/foodics-inventory-items.csv";
const PRODUCTS = "src/test/fixtures/foodics-products.csv";
const INGREDIENTS = "src/test/fixtures/foodics-product-ingredients.csv";
const SALES = "src/test/fixtures/foodics-order-items.xlsx";

/** أسبوعُ التصدير الحقيقيّ: الأحد ١٣ إلى السبت ١٩ سبتمبر. */
const WEEK = { start: "2026-09-13", end: "2026-09-19" };

function file(path: string) {
  return { fileName: path.split("/").pop()!, buffer: readFileSync(path) };
}

const ALL = () => [file(ITEMS), file(PRODUCTS), file(INGREDIENTS)];

async function importAll(tx: Tx, actorId: string, over: Partial<{ effectiveFrom: string; dryRun: boolean }> = {}) {
  return importFoodicsCatalog(
    { files: ALL(), effectiveFrom: WEEK.start, actorId, ...over },
    tx,
  );
}

describe("الكتالوجُ الحقيقيّ يدخل القاعدة", () => {
  it("‏٦٠ صنفَ مخزون و٥٨ صنفاً يُباع و٤٩ وصفة — من ثلاثة ملفّاتٍ في طلبٍ واحد", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const r = await importAll(tx, actorId);

      expect(r.files.map((f) => f.kind).sort()).toEqual(["INGREDIENTS", "ITEMS", "PRODUCTS"]);
      expect(r.files.every((f) => f.issues.length === 0)).toBe(true);

      expect(r.stockItems.created).toBe(60);
      expect(r.menuProducts.created).toBe(58);
      /*
        ‏١٤٢ سطراً تنتظم في ٤٠ وصفة، ويُضاف إليها **تسعُ وصفاتٍ للجاهز**
        لم يحمل لها الملفُّ شيئاً (ماءٌ وبراوني وكوكيز وكيكُ باشن…).
        والستُّ الباقيات من الجاهز كان لها تغليفٌ في الملفّ، فأُكمِلت
        ولم تُستحدَث.
      */
      expect(r.recipes.written).toBe(49);
      expect(r.recipes.blocked).toBe(0);
    }));

  /*
    ── ٣٩ رمزاً تحمل معنيين ──

    `sk-0002` منتجاً «Espresso» وصنفَ مخزونٍ «Colombia margo». فلو
    خُلط النطاقان لصار صفّاً واحداً — بوصفةٍ تستهلك نفسَها. وهذا
    الاختبار يقف على ذلك الحدّ بعينه.
  */
  it("ورمزٌ واحدٌ يصير صفّين لا صفّاً — البنُّ ليس الإسبريسو", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);

      const rows = await tx.execute<{ name_ar: string; item: string | null; product: string | null; stock: boolean }>(sql`
        select name_ar, foodics_item_sku as item, foodics_product_sku as product, is_stock_item as stock
          from products
         where foodics_item_sku = 'sk-0002' or foodics_product_sku = 'sk-0002'
         order by foodics_item_sku nulls last
      `);

      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0].name_ar).toBe("Colombia margo");
      expect(rows.rows[0].item).toBe("sk-0002");
      expect(rows.rows[0].product).toBeNull();
      expect(rows.rows[0].stock).toBe(true);

      expect(rows.rows[1].name_ar).toBe("Espresso");
      expect(rows.rows[1].product).toBe("sk-0002");
      expect(rows.rows[1].item).toBeNull();
      /* والصنفُ المباع لا يُعَدّ على الرفّ — «كم إسبريسو عندك؟» ليس سؤالَ جرد */
      expect(rows.rows[1].stock).toBe(false);
    }));

  it("والعبوةُ تُحفَظ بثلاثتها ولا تُحفَظ قسمتُها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);

      const [cups] = (await tx.execute<Record<string, unknown>>(sql`
        select catalog_pack_unit as unit, catalog_pack_milli as milli,
               catalog_pack_cost_minor as cost, base_unit
          from products where foodics_item_sku = 'sk-0018'
      `)).rows;

      expect(cups.unit).toBe("كرتون");
      expect(Number(cups.milli)).toBe(500_000);
      expect(Number(cups.cost)).toBe(21_500);
      expect(cups.base_unit).toBe("PIECE");
    }));

  /*
    ── والربطُ بنقاط البيع خبرٌ لا تخمين ──

    رمزُ الكتالوج هو رمزُ تصدير المبيعات نفسُه. فمن استورد الكتالوج
    ثمّ المبيعات لم يُسأل عن ربطِ شيء — وكان الطابورُ ٤٤ سؤالاً.
  */
  it("ومن استورد الكتالوج قبل المبيعات لم يُسأل عن ربطِ صنف", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      await importAll(tx, actorId);

      const imported = await importSalesFile(
        { buffer: readFileSync(SALES), fileName: "sales.xlsx", actorId, branchLabel: branch.nameAr },
        tx,
      );

      const unmapped = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from pos_products where product_id is null and kind = 'PRODUCT'
      `);
      expect(Number(unmapped.rows[0].n)).toBe(0);
      /*
        وما يقوله الاستيرادُ لصاحبه هو ما تقوله صفحةُ الربط. كان يعدّ كلَّ
        جديدٍ ومنه أحدَ عشر خياراً لا تُربَط، فيقول «١١ تحتاج ربطاً» وصفحةُ
        الربط فارغة.
      */
      expect(imported.unmappedProducts).toBe(0);
    }));

  it("ورفعُه مرّتين لا يُنشئ نسخةَ وصفةٍ ثانية", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);
      const again = await importAll(tx, actorId);

      expect(again.stockItems.created).toBe(0);
      expect(again.stockItems.updated).toBe(60);
      expect(again.recipes.written).toBe(0);
      expect(again.recipes.unchanged).toBe(49);
    }));

  /*
    ── وما كتبه إنسانٌ لا يُكتَب فوقه ──

    من عدّل جرعةً بيده لا يُلغى عملُه لأنّ ملفّاً رُفع. ويُعلَن أنّ
    الاستيراد تخطّاه — فالتخطّي الصامت يجعل صاحبَه يظنّ أنّ تعديله ضاع.
  */
  it("ووصفةٌ كتبها إنسانٌ يتخطّاها الاستيراد ويُعلن ذلك", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);

      const [espresso] = (await tx.execute<{ id: string }>(sql`
        select id from products where foodics_product_sku = 'sk-0002'
      `)).rows;
      const coffee = await makeStockProduct(tx, "بنّ يدويّ", "KG", "COFFEE");

      await saveRecipeVersion({
        menuProductId: String(espresso.id), effectiveFrom: "2026-09-20", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 21_000, unit: "G" }],
      }, tx);

      const after = await importFoodicsCatalog(
        { files: ALL(), effectiveFrom: "2026-09-27", actorId }, tx,
      );
      expect(after.recipes.skippedHuman).toBe(1);
      expect(after.changes.some((c) => c.action === "SKIPPED" && c.name === "Espresso")).toBe(true);

      /* والجرعةُ اليدويّة باقية */
      const [ing] = (await tx.execute<{ q: string }>(sql`
        select i.quantity_milli as q
          from recipe_versions v
          join recipes r on r.id = v.recipe_id
          join recipe_ingredients i on i.recipe_version_id = v.id
         where r.product_id = ${String(espresso.id)} and v.status = 'ACTIVE'
           and v.effective_to is null
      `)).rows;
      expect(Number(ing.q)).toBe(21_000);
    }));

  it("والمعاينةُ تحسب ولا تكتب", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const preview = await importAll(tx, actorId, { dryRun: true });

      expect(preview.dryRun).toBe(true);
      expect(preview.stockItems.created).toBe(60);

      const n = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from products where foodics_item_sku is not null
      `);
      expect(Number(n.rows[0].n)).toBe(0);
    }));

  it("وملفُّ الوصفات وحدَه يُعلن ما نقصه ولا يكتب نصفَ وصفة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const r = await importFoodicsCatalog(
        { files: [file(INGREDIENTS)], effectiveFrom: WEEK.start, actorId }, tx,
      );

      expect(r.recipes.written).toBe(0);
      expect(r.recipes.blocked).toBe(49);
      expect(r.blocked[0].reason).toContain("الأصناف المباعة");
    }));

  it("وتاريخُ سريانٍ غيرُ مكتوبٍ يُردّ قبل أن يُقرأ ملفّ", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const e = await caught(importFoodicsCatalog(
        { files: ALL(), effectiveFrom: "19-09-2026", actorId }, tx,
      ));
      expect((e as Error).message).toContain("YYYY-MM-DD");
    }));
});

describe("الجاهزُ يُشترى ويُباع كما هو", () => {
  /*
    ── والتغليفُ يبقى، والصنفُ يُضاف إليه ──

    «تشيز مدريد» في الملفّ شوكةٌ وعلبةٌ — والكعكةُ ليست فيه. فتُضاف
    الكعكةُ **إلى** ما جاء، لا بدلاً منه: الشوكةُ تُستهلَك أيضاً.
  */
  it("«تشيز مدريد» صارت ثلاثةَ مكوّنات — والكعكةُ فيها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);

      const rows = await tx.execute<{ name_ar: string; quantity_milli: string; unit: string }>(sql`
        select p.name_ar, i.quantity_milli, i.unit
          from products mp
          join recipes r on r.product_id = mp.id
          join recipe_versions v on v.recipe_id = r.id and v.effective_to is null
          join recipe_ingredients i on i.recipe_version_id = v.id
          join products p on p.id = i.product_id
         where mp.foodics_product_sku = 'sk-0023'
         order by p.name_ar
      `);

      expect(rows.rows.map((r) => r.name_ar)).toEqual(["تشيز مدريد", "شوك", "علب تيكاوي"]);
      const cake = rows.rows.find((r) => r.name_ar === "تشيز مدريد")!;
      expect(Number(cake.quantity_milli)).toBe(1_000);
      expect(cake.unit).toBe("PIECE");
    }));

  it("و«الماء» بلا وصفةٍ في الملفّ صارت قارورةً واحدة", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);

      const rows = await tx.execute<{ name_ar: string; quantity_milli: string }>(sql`
        select p.name_ar, i.quantity_milli
          from products mp
          join recipes r on r.product_id = mp.id
          join recipe_versions v on v.recipe_id = r.id and v.effective_to is null
          join recipe_ingredients i on i.recipe_version_id = v.id
          join products p on p.id = i.product_id
         where mp.foodics_product_sku = 'sk-0014'
      `);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].name_ar).toBe("مياه معدنية");
      expect(Number(rows.rows[0].quantity_milli)).toBe(1_000);
    }));

  /*
    والكمبوتشا علبةٌ كاملة — ٣٣٠ مليلتراً، وهي محتوى العلبة في
    الكتالوج. فتُقرأ بوحدة صرف صنفها لا بوحدةٍ تُكتب في جدول الاقتران.
  */
  it("والكمبوتشا ٣٣٠ مليلتراً بوحدة صنفها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importAll(tx, actorId);

      const [row] = (await tx.execute<{ quantity_milli: string; unit: string }>(sql`
        select i.quantity_milli, i.unit
          from products mp
          join recipes r on r.product_id = mp.id
          join recipe_versions v on v.recipe_id = r.id and v.effective_to is null
          join recipe_ingredients i on i.recipe_version_id = v.id
          join products p on p.id = i.product_id
         where mp.foodics_product_sku = 'sk-0011' and p.foodics_item_sku = 'sk-0042'
      `)).rows;
      expect(Number(row.quantity_milli)).toBe(330_000);
      expect(row.unit).toBe("ML");
    }));

  it("ومبيعُ الحلى صار يُخصَم من المخزون — ٩٧ قطعةَ تشيز مدريد", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      await importAll(tx, actorId);

      const [cake] = (await tx.execute<{ id: string }>(sql`
        select id from products where foodics_item_sku = 'sk-0011'
      `)).rows;
      await isolateProducts(tx, [String(cake.id)]);

      await importSalesFile(
        { buffer: readFileSync(SALES), fileName: "sales.xlsx", actorId, branchLabel: branch.nameAr },
        tx,
      );

      const { countId } = await startCount(
        { periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx,
      );
      const report = await recomputeCount(countId, tx);
      const line = report.lines.find((l) => l.productId === String(cake.id))!;

      /* وكانت صفراً قبل هذا: الوصفةُ فيها الشوكةُ والعلبةُ لا الكعكة */
      expect(canonicalToQuantity(line.theoreticalConsumptionMilli!, "PIECE")).toBe(97);
    }));
});

describe("الكتالوجُ يُقوِّم الفرق حين لا فاتورة", () => {
  /*
    ── الفاتورةُ واقعةٌ والكتالوجُ تقدير ──

    فالكتالوجُ يأتي أخيراً في ترتيب التقييم. لكنّه خيرٌ من «لا كلفة»:
    صنفٌ لم تصل فاتورتُه هذا الأسبوع يُقوَّم فرقُه بتقديرٍ **مُعلَنٍ
    أنّه تقدير** لا يُترَك بلا رقم.
  */
  /*
    ── ويُرفَع الكتالوجُ بتاريخِ سريانٍ **بعد** الأسبوع المعدود ──

    وهو ما وقع فعلاً: رُفع في ٢١ سبتمبر بسريانٍ من ٢٠، والجردُ على
    ‏١٣–١٩. فخرج ١٧٠٦ سطرَ بيعٍ من ١٧١٧ من الحساب. وأوّلُ نسخةٍ تسري
    منذ البداية، فتغطّيه.
  */
  it("بنُّ إثيوبيا: ‏٥٫٧١٥ كجم — ولو رُفع الكتالوجُ بسريانٍ بعد الأسبوع", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const branch = await makeBranch(tx);
      await importAll(tx, actorId, { effectiveFrom: "2026-09-27" });

      const [coffee] = (await tx.execute<{ id: string }>(sql`
        select id from products where foodics_item_sku = 'sk-0003'
      `)).rows;
      await isolateProducts(tx, [String(coffee.id)]);

      await importSalesFile(
        { buffer: readFileSync(SALES), fileName: "sales.xlsx", actorId, branchLabel: branch.nameAr },
        tx,
      );

      const { countId } = await startCount(
        { periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx,
      );
      const report = await recomputeCount(countId, tx);
      const line = report.lines.find((l) => l.productId === String(coffee.id))!;

      /*
        «Iced V60 Ethiopia» ٢٧٦ كوباً مصنوعاً × ٢٠ جراماً = ‏٥٬٥٢٠،
        و«Hot V60 Ethiopia» ١٣ × ١٥ = ‏١٩٥. والمجموع ‏٥٫٧١٥ كجم.
        ووصفتان مختلفتان لصنفٍ واحد تجتمعان في سطرٍ واحد من الجرد.
      */
      expect(canonicalToQuantity(line.theoreticalConsumptionMilli!, "KG")).toBe(5.715);

      /*
        ── ٨٨ ريالاً للكيلو، ووحدةُ الصنف الجرام ──

        فالمعدَّلُ ‏٨٫٨ هللة للجرام: يُحفَظ ‏٨٬٨٠٠ مِلّي‑هللة، ويُعرَض
        المقرَّبُ «٩». ولو قُوِّم الفرقُ بالمقرَّب لزادت كلفتُه ٢٫٣٪.
      */
      expect(line.valuationBasis).toBe("CATALOG");
      expect(line.unitCostMilliMinor).toBe(8_800);
      expect(line.unitCostMinor).toBe(9);
    }));
});
