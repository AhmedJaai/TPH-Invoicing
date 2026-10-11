/**
 * كتالوجُ فودكس من الواجهة ← الصيغةُ نفسُها التي تُخرجها ملفّاتُه الثلاثة.
 *
 * `ParsedCatalog` هو ما يكتبه `catalog-import.service.ts` — فلا قاعدةَ ثانية للواجهة:
 * المعاينةُ قبل الكتابة، و«ما كتبه إنسانٌ لا يُكتَب فوقه»، والوصفةُ نسخةٌ بتاريخ،
 * كلُّها كما هي. وما لا يُقرأ يُقال بسببه ولا يُكتب بصفر.
 *
 * والمحذوفُ في فودكس (`deleted_at`) لا يدخل: ليس في تصدير ملفّاته كذلك.
 * وخياراتُ الإضافة لا وصفةَ لها هنا — قرارٌ قائم في `inventory-foodics.md`.
 */
import { decimalToMilli } from "@/lib/inventory/units";
import { readUnit, type ParsedCatalog } from "@/lib/inventory/foodics-catalog";
import { riyalsToMinor } from "./money";
import type { FoodicsCatalogProduct, FoodicsInventoryItem } from "./types";

function emptyCatalog(kind: ParsedCatalog["kind"], rows: number): ParsedCatalog {
  return { kind, items: [], products: [], recipeLines: [], issues: [], warnings: [], rows };
}

export function catalogItemsFromApi(items: readonly FoodicsInventoryItem[]): ParsedCatalog {
  const live = items.filter((i) => !i.deleted_at);
  const out = emptyCatalog("ITEMS", live.length);
  live.forEach((i, index) => {
    const n = index + 1;
    const sku = i.sku?.trim() ?? "";
    const name = i.name?.trim() ?? "";
    if (sku === "" || name === "") {
      out.issues.push({ row: n, reason: "صفٌّ بلا رمزٍ أو اسم", detail: `sku=«${sku}» name=«${name}»` });
      return;
    }
    const unitWord = i.ingredient_unit?.trim() ?? "";
    const baseUnit = readUnit(unitWord);
    if (baseUnit === null) {
      out.issues.push({ row: n, reason: "وحدةُ صرفٍ غير معروفة", detail: `«${name}» وحدتُه «${unitWord}»` });
      return;
    }
    const storageUnit = i.storage_unit?.trim() ?? "";
    const factorMilli = i.storage_to_ingredient_factor === null || i.storage_to_ingredient_factor === undefined
      ? null : decimalToMilli(i.storage_to_ingredient_factor.toFixed(6));
    if (factorMilli === null || factorMilli <= 0) {
      out.issues.push({ row: n, reason: "معامِلُ العبوة غير مقروء", detail: `«${name}» — لا يُعرَف كم ${unitWord} في ${storageUnit || "وحدة التخزين"}` });
      return;
    }
    const packCostMinor = riyalsToMinor(i.cost);
    if (packCostMinor === null || packCostMinor < 0) {
      out.issues.push({ row: n, reason: "كلفةٌ غير مقروءة", detail: `«${name}» بلا كلفةٍ في فودكس` });
      return;
    }
    out.items.push({ itemSku: sku, name, storageUnit, baseUnit, packQuantityMilli: factorMilli, packCostMinor });
  });
  return out;
}

export function catalogProductsFromApi(products: readonly FoodicsCatalogProduct[]): { products: ParsedCatalog; recipes: ParsedCatalog } {
  const live = products.filter((p) => !p.deleted_at);
  const menu = emptyCatalog("PRODUCTS", live.length);
  const recipes = emptyCatalog("INGREDIENTS", 0);
  live.forEach((p, index) => {
    const n = index + 1;
    const sku = p.sku?.trim() ?? "";
    const name = p.name?.trim() ?? "";
    if (sku === "" || name === "") {
      menu.issues.push({ row: n, reason: "صفٌّ بلا رمزٍ أو اسم", detail: `sku=«${sku}» name=«${name}»` });
      return;
    }
    menu.products.push({
      productSku: sku,
      name,
      priceMinor: riyalsToMinor(p.price),
      declaredCostMinor: riyalsToMinor(p.cost),
      isActive: p.is_active !== false,
    });

    for (const ing of p.ingredients ?? []) {
      if (ing.deleted_at) continue;
      recipes.rows++;
      const row = recipes.rows;
      const itemSku = ing.sku?.trim() ?? "";
      if (itemSku === "") {
        recipes.issues.push({ row, reason: "سطرٌ بلا طرفين", detail: `منتج=«${sku}» مكوّن=«»` });
        continue;
      }
      const unitWord = ing.ingredient_unit?.trim() ?? "";
      const unit = readUnit(unitWord);
      if (unit === null) {
        recipes.issues.push({ row, reason: "وحدةٌ غير معروفة", detail: `${sku} ← ${itemSku} بوحدة «${unitWord}»` });
        continue;
      }
      const quantity = ing.pivot.quantity;
      const quantityMilli = quantity === null || quantity === undefined ? null : decimalToMilli(quantity.toFixed(6));
      if (quantityMilli === null || quantityMilli <= 0) {
        recipes.issues.push({ row, reason: "كمّيّةٌ غير مقروءة", detail: `${sku} ← ${itemSku} كمّيّتُه «${quantity ?? ""}»` });
        continue;
      }
      recipes.recipeLines.push({
        productSku: sku, productName: name, itemSku, itemName: ing.name?.trim() ?? "",
        quantityMilli, unit, statedCostMinor: null,
      });
    }
  });
  return { products: menu, recipes };
}
