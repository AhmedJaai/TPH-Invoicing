/**
 * استيرادُ كتالوج فودكس: الأصنافُ والعبواتُ والوصفات.
 *
 * ── الترتيبُ ليس تفصيلاً ──
 *
 * أصنافُ المخزون أوّلاً، ثمّ الأصنافُ المباعة، ثمّ الوصفات — لأنّ
 * الوصفةَ تربط طرفين لا بدّ أن يكونا موجودين. ولو عُكس لَما وجدت
 * الوصفةُ مكوّنَها فسقطت، **وسقوطُها صامتاً** أسوأ من ألّا تُستورَد:
 * يُقال «استُورد ١٤٢ سطراً» ولا أثر لها.
 *
 * ── والنطاقان لا يُخلَطان ──
 *
 * `sk-0002` منتجاً «Espresso» وصنفَ مخزونٍ «Colombia margo»، و٣٩ رمزاً
 * من ٦٠ كذلك. فالبحثُ عن صنف المخزون يقع في `foodics_item_sku` وحدَه،
 * وعن الصنف المباع في `foodics_product_sku` وحدَه. ولو جُمعا لصار
 * البنُّ هو الإسبريسو بوصفةٍ تستهلك نفسَها.
 *
 * ── والصنفُ المباع لا يُعَدّ على الرفّ ──
 *
 * ثمانيةٌ وخمسون صنفاً يُباع، ولو دخلت الجردَ لسُئل صاحبُ المقهى: «كم
 * لاتيه على الرفّ؟». فتُكتَب `is_menu_item` بلا `is_stock_item`.
 *
 * ── وما كتبه إنسانٌ لا يُكتَب فوقه ──
 *
 * نسخةُ وصفةٍ مصدرُها `HUMAN` تبقى، ويُعلَن أنّ الاستيراد تخطّاها.
 * ومن عدّل جرعةً بيده لا يُلغى عملُه لأنّ ملفّاً رُفع.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { posProducts, products } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { normaliseHeader } from "@/lib/sales/columns";
import {
  CATALOG_LABEL, parseCatalogFile,
  type CatalogIssue, type CatalogKind, type MenuProductRow, type ParsedCatalog,
  type RecipeLineRow, type StockItemRow,
} from "@/lib/inventory/foodics-catalog";
import { ensureFoodicsSource } from "./sales-import.service";
import { saveRecipeVersion } from "./recipe.service";
import type { Conn } from "./types";

/** مصدرُ نسخة الوصفة حين يكتبها الاستيراد. */
export const CATALOG_SOURCE = "FOODICS_CATALOG";

export interface CatalogFile {
  fileName: string;
  buffer: Buffer;
}

export interface CatalogImportInput {
  files: readonly CatalogFile[];
  /**
   * اليومُ الذي تبدأ فيه نسخُ الوصفات المستورَدة.
   *
   * ويُقترَح أوّلُ الأسبوع المقبل لا اليوم: **نسخةٌ تبدأ اليوم تُغلق
   * السابقةَ أمس**، فيُحسَب نصفُ الأسبوع بوصفةٍ ونصفُه بأخرى. ومن
   * أراد أثراً رجعيّاً قال تاريخَه صراحةً.
   */
  effectiveFrom: string;
  actorId: string;
  /** معاينةٌ تقرأ ولا تكتب — تُعرَض قبل الإقرار. */
  dryRun?: boolean;
}

export interface CatalogFileResult {
  fileName: string;
  kind: CatalogKind | null;
  label: string;
  rows: number;
  issues: CatalogIssue[];
  warnings: string[];
}

/** ما وقع على صنفٍ واحد — ويُسمّى باسمه لا يُعَدّ عدّاً مجرّداً. */
export interface CatalogChange {
  sku: string;
  name: string;
  action: "CREATED" | "UPDATED" | "LINKED_BY_NAME" | "SKIPPED";
  detail?: string;
}

export interface CatalogImportResult {
  dryRun: boolean;
  files: CatalogFileResult[];
  stockItems: { created: number; updated: number; linkedByName: number };
  menuProducts: { created: number; updated: number; linkedByName: number };
  recipes: { written: number; skippedHuman: number; unchanged: number; blocked: number };
  changes: CatalogChange[];
  /** ما لم يُكتب ولماذا — لا سطرَ يُرمى صامتاً. */
  blocked: { productSku: string; name: string; reason: string }[];
  effectiveFrom: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** اسمٌ موحَّد للمقارنة — بالدالّة نفسِها التي تُطبَّع بها الترويسات. */
function nameKey(name: string): string {
  return normaliseHeader(name);
}

export async function importFoodicsCatalog(
  input: CatalogImportInput,
  conn: Conn = db,
): Promise<CatalogImportResult> {
  if (!DATE.test(input.effectiveFrom)) throw new Error("تاريخُ سريان الوصفات يُكتب YYYY-MM-DD");
  if (input.files.length === 0) throw new Error("لم يُرفَع ملفّ");

  const parsed: { file: CatalogFile; result: ParsedCatalog }[] = input.files.map((file) => ({
    file, result: parseCatalogFile(file.buffer),
  }));

  const files: CatalogFileResult[] = parsed.map(({ file, result }) => ({
    fileName: file.fileName,
    kind: result.issues.some((i) => i.reason === "ترويسةٌ غير مفهومة") ? null : result.kind,
    label: CATALOG_LABEL[result.kind],
    rows: result.rows,
    issues: result.issues,
    warnings: result.warnings,
  }));

  const items = parsed.flatMap((p) => p.result.items);
  const menu = parsed.flatMap((p) => p.result.products);
  const lines = parsed.flatMap((p) => p.result.recipeLines);

  const out: CatalogImportResult = {
    dryRun: input.dryRun === true,
    files,
    stockItems: { created: 0, updated: 0, linkedByName: 0 },
    menuProducts: { created: 0, updated: 0, linkedByName: 0 },
    recipes: { written: 0, skippedHuman: 0, unchanged: 0, blocked: 0 },
    changes: [],
    blocked: [],
    effectiveFrom: input.effectiveFrom,
  };

  const run = async (tx: Conn) => {
    const itemIdBySku = await upsertStockItems(items, input, out, tx);
    const menuIdBySku = await upsertMenuProducts(menu, input, out, tx);
    await writeRecipes(lines, itemIdBySku, menuIdBySku, input, out, tx);
    if (input.dryRun) throw new DryRun();
  };

  if (input.dryRun) {
    try {
      await conn.transaction(async (tx) => { await run(tx); });
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
    }
    return out;
  }

  await conn.transaction(async (tx) => { await run(tx); });

  await recordAudit({
    actorId: input.actorId,
    action: "CATALOG_IMPORTED",
    entityType: "products",
    entityId: "foodics-catalog",
    after: {
      الملفّات: files.map((f) => `${f.fileName} (${f.label})`).join("، "),
      "أصناف المخزون": `${out.stockItems.created} جديدة · ${out.stockItems.updated} محدَّثة`,
      "الأصناف المباعة": `${out.menuProducts.created} جديدة · ${out.menuProducts.updated} محدَّثة`,
      الوصفات: `${out.recipes.written} كُتبت · ${out.recipes.skippedHuman} تخطّاها الاستيراد`,
      السريان: input.effectiveFrom,
    },
  }, conn);

  return out;
}

/** تُلغي معاملةَ المعاينة — الحسابُ يجري كاملاً ولا يبقى صفّ. */
class DryRun extends Error {}

/* ────────────────────── أصنافُ المخزون ────────────────────── */

async function upsertStockItems(
  items: readonly StockItemRow[],
  input: CatalogImportInput,
  out: CatalogImportResult,
  tx: Conn,
): Promise<Map<string, string>> {
  const bySku = new Map<string, string>();
  if (items.length === 0) return bySku;

  const existing = await tx
    .select({ id: products.id, sku: products.foodicsItemSku, nameAr: products.nameAr })
    .from(products)
    .where(inArray(products.foodicsItemSku, items.map((i) => i.itemSku)));
  const idBySku = new Map(existing.map((r) => [String(r.sku), r.id] as const));

  /*
    ── الاسمُ يربط، ولا يربط إلّا بالمساواة التامّة بعد التطبيع ──

    جدولُ الأصناف مبنيٌّ اليوم من بنود الفواتير، ففيه «بنّ» و«حليب».
    فلو أُنشئ لكلّ صنفِ كتالوجٍ صفٌّ جديد لصار للصنف الواحد صفّان:
    أحدهما تُقيَّد عليه المشتريات والآخر يُستهلَك في الوصفات — ويظهر
    فرقٌ يساوي كلَّ ما اشتُري.

    والمطابقةُ **بالمساواة لا بالتشابه** — درسُ «العنب» قائم: التشابهُ
    يخمّن، والمساواةُ بعد التطبيع خبر. وكلُّ ربطٍ بالاسم يُسمّى في
    النتيجة كي يراه الإنسان.
  */
  const orphanNames = await tx
    .select({ id: products.id, nameAr: products.nameAr })
    .from(products)
    .where(and(isNull(products.foodicsItemSku), eq(products.isStockItem, true)));
  const idByName = new Map<string, string>();
  for (const r of orphanNames) {
    const k = nameKey(r.nameAr);
    /* اسمٌ يحمله صفّان لا يدلّ على واحد — فيسقط من الربط */
    if (idByName.has(k)) idByName.set(k, "");
    else idByName.set(k, r.id);
  }

  for (const item of items) {
    const patch = {
      nameAr: item.name,
      baseUnit: item.baseUnit,
      isStockItem: true,
      foodicsItemSku: item.itemSku,
      catalogPackUnit: item.storageUnit === "" ? item.baseUnit : item.storageUnit,
      catalogPackMilli: item.packQuantityMilli,
      catalogPackCostMinor: item.packCostMinor,
      catalogSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    const known = idBySku.get(item.itemSku);
    if (known) {
      await tx.update(products).set(patch).where(eq(products.id, known));
      bySku.set(item.itemSku, known);
      out.stockItems.updated++;
      out.changes.push({ sku: item.itemSku, name: item.name, action: "UPDATED" });
      continue;
    }

    const byName = idByName.get(nameKey(item.name));
    if (byName) {
      await tx.update(products).set(patch).where(eq(products.id, byName));
      bySku.set(item.itemSku, byName);
      out.stockItems.linkedByName++;
      out.changes.push({
        sku: item.itemSku, name: item.name, action: "LINKED_BY_NAME",
        detail: "رُبط بصنفٍ قائمٍ بالاسم نفسِه — راجِعه إن لم يكن هو",
      });
      continue;
    }

    const [row] = await tx
      .insert(products)
      .values({ ...patch, isMenuItem: false, category: "OTHER" })
      .returning({ id: products.id });
    bySku.set(item.itemSku, row.id);
    out.stockItems.created++;
    out.changes.push({ sku: item.itemSku, name: item.name, action: "CREATED" });
  }

  return bySku;
}

/* ────────────────────── الأصنافُ المباعة ────────────────────── */

async function upsertMenuProducts(
  menu: readonly MenuProductRow[],
  input: CatalogImportInput,
  out: CatalogImportResult,
  tx: Conn,
): Promise<Map<string, string>> {
  const bySku = new Map<string, string>();
  if (menu.length === 0) return bySku;

  const existing = await tx
    .select({ id: products.id, sku: products.foodicsProductSku })
    .from(products)
    .where(inArray(products.foodicsProductSku, menu.map((m) => m.productSku)));
  const idBySku = new Map(existing.map((r) => [String(r.sku), r.id] as const));

  const sourceId = await ensureFoodicsSource(tx);

  for (const item of menu) {
    const patch = {
      nameAr: item.name,
      isMenuItem: true,
      /* الصنفُ المباع لا يُعَدّ على الرفّ — «كم لاتيه عندك؟» ليس سؤالَ جرد */
      isStockItem: false,
      isActive: item.isActive,
      foodicsProductSku: item.productSku,
      catalogDeclaredCostMinor: item.declaredCostMinor,
      catalogSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    const known = idBySku.get(item.productSku);
    let id: string;
    if (known) {
      await tx.update(products).set(patch).where(eq(products.id, known));
      id = known;
      out.menuProducts.updated++;
      out.changes.push({ sku: item.productSku, name: item.name, action: "UPDATED" });
    } else {
      const [row] = await tx
        .insert(products)
        .values({ ...patch, baseUnit: "PIECE", category: "OTHER" })
        .returning({ id: products.id });
      id = row.id;
      out.menuProducts.created++;
      out.changes.push({ sku: item.productSku, name: item.name, action: "CREATED" });
    }
    bySku.set(item.productSku, id);

    /*
      ── والربطُ بنقاط البيع يقع هنا، لا في طابور الربط ──

      رمزُ الكتالوج هو رمزُ تصدير المبيعات نفسُه — فالربطُ **خبرٌ من
      المصدر لا تخمينٌ من عندنا**. ومن استورد الكتالوج ثمّ المبيعات
      لم يُسأل عن ربطِ شيء.
    */
    await tx
      .insert(posProducts)
      .values({
        sourceId, externalId: item.productSku, name: item.name,
        priceMinor: item.priceMinor, kind: "PRODUCT", productId: id,
      })
      .onConflictDoUpdate({
        target: [posProducts.sourceId, posProducts.externalId],
        set: { name: item.name, priceMinor: item.priceMinor, productId: id },
      });
  }

  return bySku;
}

/* ────────────────────────── الوصفات ────────────────────────── */

async function writeRecipes(
  lines: readonly RecipeLineRow[],
  itemIdBySku: ReadonlyMap<string, string>,
  menuIdBySku: ReadonlyMap<string, string>,
  input: CatalogImportInput,
  out: CatalogImportResult,
  tx: Conn,
): Promise<void> {
  if (lines.length === 0) return;

  const byProduct = new Map<string, RecipeLineRow[]>();
  for (const l of lines) {
    const list = byProduct.get(l.productSku);
    if (list) list.push(l);
    else byProduct.set(l.productSku, [l]);
  }

  /* أيُّ الوصفات كتبها إنسان — لا يُكتَب فوقها */
  const human = await humanWrittenRecipes(tx);

  for (const [productSku, group] of byProduct) {
    const menuId = menuIdBySku.get(productSku)
      ?? await findMenuBySku(productSku, tx);
    if (!menuId) {
      out.blocked.push({
        productSku, name: group[0].productName,
        reason: "لا صنفَ مباعاً بهذا الرمز — ارفع ملفّ الأصناف المباعة معه",
      });
      out.recipes.blocked++;
      continue;
    }

    if (human.has(menuId)) {
      out.recipes.skippedHuman++;
      out.changes.push({
        sku: productSku, name: group[0].productName, action: "SKIPPED",
        detail: "وصفتُه مكتوبةٌ بيدِ إنسان — لم يُكتَب فوقها",
      });
      continue;
    }

    const ingredients = [];
    let missing: string | null = null;
    for (const l of group) {
      const productId = itemIdBySku.get(l.itemSku) ?? await findItemBySku(l.itemSku, tx);
      if (!productId) { missing = l.itemName || l.itemSku; break; }
      ingredients.push({ productId, quantityMilli: l.quantityMilli, unit: l.unit });
    }
    if (missing !== null) {
      out.blocked.push({
        productSku, name: group[0].productName,
        reason: `مكوّنُه «${missing}» ليس في أصناف المخزون — ارفع ملفّ أصناف المخزون معه`,
      });
      out.recipes.blocked++;
      continue;
    }

    /*
      ── ولا تُكتَب نسخةٌ تكرّر ما قبلها ──

      من رفع الملفّ مرّتين لا تُنشَأ له نسختان متطابقتان: النسخةُ حدثٌ
      في تاريخ الصنف، وتكرارُها يُفسد قراءةَ ذلك التاريخ. والمقارنةُ
      بالمكوّنات نفسِها لا بعددها.
    */
    if (await sameAsActive(menuId, ingredients, tx)) {
      out.recipes.unchanged++;
      continue;
    }

    try {
      await saveRecipeVersion({
        menuProductId: menuId,
        effectiveFrom: input.effectiveFrom,
        ingredients,
        activate: true,
        actorId: input.actorId,
        source: CATALOG_SOURCE,
        note: `مستورَدةٌ من كتالوج فودكس — ${group.length} مكوّناً`,
      }, tx);
      out.recipes.written++;
    } catch (e) {
      out.blocked.push({ productSku, name: group[0].productName, reason: (e as Error).message });
      out.recipes.blocked++;
    }
  }
}

async function findMenuBySku(sku: string, tx: Conn): Promise<string | null> {
  const [row] = await tx
    .select({ id: products.id }).from(products)
    .where(eq(products.foodicsProductSku, sku)).limit(1);
  return row?.id ?? null;
}

async function findItemBySku(sku: string, tx: Conn): Promise<string | null> {
  const [row] = await tx
    .select({ id: products.id }).from(products)
    .where(eq(products.foodicsItemSku, sku)).limit(1);
  return row?.id ?? null;
}

/**
 * أصنافٌ وصفتُها **القائمة الآن** كتبها إنسان — يتخطّاها الاستيراد ويُعلن ذلك.
 *
 * ── و«السارية» ليست `status = 'ACTIVE'` وحدها ──
 *
 * تفعيلُ نسخةٍ لا يُلغي حالَ سابقتها؛ يكتب لها `effective_to` وتبقى
 * `ACTIVE` بوصفها «فُعِّلت يوماً». فالشرطُ على الحال وحدَه يُرجع
 * **كلّ** نسخةٍ فُعِّلت من قبل، فيُقرأ منها أيُّها اتّفق — وهو ما
 * يجعل الحكمَ يتبع ترتيبَ الصفوف لا الحقيقة.
 *
 * والقائمةُ الآن هي المفتوحةُ الطرف: `effective_to is null`.
 */
async function humanWrittenRecipes(tx: Conn): Promise<Set<string>> {
  const rows = await tx.execute<{ product_id: string }>(sql`
    select r.product_id
      from recipe_versions v
      join recipes r on r.id = v.recipe_id
     where v.status = 'ACTIVE' and v.effective_to is null
       and coalesce(v.source, 'HUMAN') <> ${CATALOG_SOURCE}
  `);
  return new Set(rows.rows.map((r) => String(r.product_id)));
}

/** أمكوّناتُ النسخة القائمة الآن هي هذه بعينها؟ */
async function sameAsActive(
  menuProductId: string,
  ingredients: readonly { productId: string; quantityMilli: number; unit: string }[],
  tx: Conn,
): Promise<boolean> {
  const rows = await tx.execute<{ product_id: string; quantity_milli: string; unit: string }>(sql`
    select i.product_id, i.quantity_milli, i.unit
      from recipe_versions v
      join recipes r on r.id = v.recipe_id
      join recipe_ingredients i on i.recipe_version_id = v.id
     where r.product_id = ${menuProductId} and v.status = 'ACTIVE' and v.effective_to is null
  `);
  if (rows.rows.length !== ingredients.length) return false;

  const key = (p: string, q: number | string, u: string) => `${p}|${Number(q)}|${u}`;
  const have = new Set(rows.rows.map((r) => key(String(r.product_id), r.quantity_milli, String(r.unit))));
  return ingredients.every((i) => have.has(key(i.productId, i.quantityMilli, i.unit)));
}
