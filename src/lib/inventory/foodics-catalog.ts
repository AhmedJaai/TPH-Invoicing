/**
 * كتالوج فودكس: أصنافُ المخزون · الأصنافُ المباعة · الوصفات.
 *
 * ثلاثةُ ملفّات CSV يُصدّرها فودكس، وقد فُحصت كلُّها قبل كتابة سطرٍ
 * واحد هنا — كما فُحص تصديرُ المبيعات قبله. وما أثبته الفحص:
 *
 * ── ١ · رمزُ الصنف يعني شيئين مختلفين، فالنطاقان لا يُخلَطان ──
 *
 * ‏`sk-0002` في ملفّ المنتجات «Espresso»، وفي ملفّ المخزون
 * «Colombia margo». و**٣٩ رمزاً من ٦٠ تتصادم هكذا**: `sk-0007` لاتيه
 * ومصّاصات، و`sk-0018` حليبُ شوفان وكاساتُ ١٢ أونصة، و`sk-0057` خبزُ
 * موزٍ وبنُّ أوغندا.
 *
 * فمفتاحٌ واحد للاثنين يدمج البنَّ بالإسبريسو **صامتاً**: يظهر صنفٌ
 * واحد بوصفةٍ تستهلك نفسَها، وتُنسَب كلفةُ البنّ إلى المشروب مرّتين.
 * ولذلك رمزُ المنتج ورمزُ صنف المخزون عمودان منفصلان، ولكلٍّ قيدُ
 * فرادةٍ خاصّ به.
 *
 * ── ٢ · الكلفةُ تُشتقّ ولا تُنسَخ ──
 *
 * ملفُّ الوصفات يحمل `ingredient_cost` جاهزاً. ولم يُؤخَذ: **الخادم
 * يحسب المال** — الدرسُ نفسه من `confirm.ts`. وقد تحقّق الحساب على
 * ‏**١٤٢ سطراً من ١٤٢** بلا فارقٍ واحد:
 *
 *     كلفةُ وحدة المكوّن = كلفةُ وحدة التخزين ÷ المعامِل
 *
 * فعلبةُ حليب نادك بـ١١ ريالاً و١٫٧٥ لتراً = ‏٦٫٢٨٥٧ ريالاً للتر،
 * و٠٫١ لترٍ في «بيكلو» = ‏٠٫٦٢٨٥٧ — وهو ما يقوله الملفّ حرفاً.
 * ومطابقةُ حسابِنا لحسابه **دليلٌ على أنّنا فهمنا الملفّ**، لا سببٌ
 * للاستغناء عن الحساب.
 *
 * ── ٣ · والهللةُ تُقسَّم ألفاً في الطريق ──
 *
 * كرتونُ المصّاصات ٨٥ ريالاً لأربعة آلاف: **٢٫١٢٥ هللة للمصّاصة**.
 * فمن قرّب إلى هللتين أسقط ٦٪ من كلفتها، ومن قرّب إلى ثلاثٍ زادها
 * ‏٤١٪. فالحسابُ يجري بـ**مِلّي‑الهللة** عدداً صحيحاً، ولا يُقرَّب
 * إلّا عند آخر جمع — كما أنّ الكمّيّة مِلّي والمالَ هللات.
 */
import { readWorkbookSafely } from "@/lib/bank/parsers/safe-xlsx";
import { normaliseHeader } from "@/lib/sales/columns";
import { parseSourceCostMinor } from "@/lib/sales/values";
import { MILLI_MINOR, milliMinorToMinor, parseRiyals } from "@/lib/money";
import { convertMilli, decimalToMilli, MILLI } from "./units";
import type { StoredUnit } from "@/lib/unit-conversion";

/** أيُّ الملفّات الثلاثة هذا. */
export type CatalogKind = "ITEMS" | "PRODUCTS" | "INGREDIENTS";

export const CATALOG_LABEL: Record<CatalogKind, string> = {
  ITEMS: "أصناف المخزون",
  PRODUCTS: "الأصناف المباعة",
  INGREDIENTS: "الوصفات",
};

/* ─────────────────────────── الوحدات ─────────────────────────── */

/**
 * كلماتُ الوحدة كما يكتبها فودكس ← وحدةُ النظام.
 *
 * وتمرّ الكلمةُ والمفتاحُ بـ`normaliseHeader` نفسِها، فـ«حبة» بالتاء
 * المربوطة و«حبه» بالهاء يلتقيان — وكلاهما في الملفّ فعلاً: ‏٥١ سطراً
 * بهذه و٣٦ بتلك. والدرسُ مكتوبٌ من قبل: **المرادفُ يُطبَّع بما تُطبَّع
 * به الترويسة**، ولا تُكتب الصيغةُ المطبَّعة بالحدس.
 */
const RAW_UNITS: Record<StoredUnit, readonly string[]> = {
  G: ["جرام", "غرام", "جم", "g", "gram", "grams"],
  KG: ["كيلو", "كجم", "كيلوجرام", "كيلوغرام", "kg", "kilo", "kilogram"],
  L: ["لتر", "لترات", "l", "liter", "litre", "liters"],
  ML: ["ملل", "مل", "مليلتر", "ml", "milliliter"],
  PIECE: ["حبة", "حبه", "حبات", "قطعة", "قطع", "piece", "pieces", "pcs", "unit"],
  PACK: ["علبة", "عبوة", "باكيت", "pack", "box", "packet"],
};

const UNIT_BY_WORD = new Map<string, StoredUnit>(
  Object.entries(RAW_UNITS).flatMap(([unit, words]) =>
    words.map((w) => [normaliseHeader(w), unit as StoredUnit] as const)),
);

/**
 * وحدةُ المكوّن — و`null` لما لم يُفهَم.
 *
 * ولا تُخمَّن وحدةٌ عند العجز: صنفٌ بوحدةٍ مجهولة يُعلَن ويُستبعَد،
 * فوحدةٌ مخترَعة تُنتج استهلاكاً مخترَعاً.
 */
export function readUnit(word: string): StoredUnit | null {
  return UNIT_BY_WORD.get(normaliseHeader(word)) ?? null;
}

/* ─────────────────────────── الصفوف ─────────────────────────── */

/** صنفُ مخزونٍ كما يعرّفه فودكس: وحدةُ تخزينٍ، ووحدةُ صرف، ومعامِلٌ بينهما. */
export interface StockItemRow {
  /** الرمز في **نطاق أصناف المخزون** — لا يُخلَط برمز المنتج. */
  itemSku: string;
  name: string;
  /** «كرتون»، «كيلو»، «قالب» — تُعرَض كما كتبها ولا تُترجَم إلى وحدة نظام. */
  storageUnit: string;
  /** وحدةُ الصرف، وهي وحدةُ الصنف عندنا. */
  baseUnit: StoredUnit;
  /** كم وحدةَ صرفٍ في وحدة التخزين، بالمِلّي: كرتونٌ فيه ٥٠٠ كاس = ‏٥٠٠٬٠٠٠. */
  packQuantityMilli: number;
  /** كلفةُ **وحدة التخزين** بالهللات — ‏٢١٥ ريالاً للكرتون = ‏٢١٥٠٠. */
  packCostMinor: number;
}

/** صنفٌ يُباع: سعرُه، وكلفتُه المعلَنة عند فودكس إن كتبها. */
export interface MenuProductRow {
  /** الرمز في **نطاق الأصناف المباعة**. */
  productSku: string;
  name: string;
  priceMinor: number | null;
  /**
   * الكلفةُ التي يعلنها فودكس للصنف — **خبرٌ يُقارَن، لا كلفةٌ تُحسَب بها**.
   *
   * وهي في الملفّ لأربعةٍ وعشرين صنفاً وحدها، وتخالف مجموعَ الوصفة في
   * ستّةٍ منها مخالفةً كبيرة — وتلك بالضبط الأصناف التي سقط جوهرُها من
   * وصفتها. فالمقارنةُ تكشف النقص، والأخذُ بها يستره.
   */
  declaredCostMinor: number | null;
  isActive: boolean;
}

/** سطرُ وصفة: منتجٌ ومكوّنٌ وكمّيّة. */
export interface RecipeLineRow {
  productSku: string;
  productName: string;
  itemSku: string;
  itemName: string;
  quantityMilli: number;
  unit: StoredUnit;
  /** ما قاله الملفّ عن كلفة هذا السطر — يُقابَل بحسابنا ولا يحلّ محلّه. */
  statedCostMinor: number | null;
}

/** ما لم يُقرأ، بسببه ورقم صفّه — ولا صفَّ يُرمى صامتاً. */
export interface CatalogIssue {
  row: number;
  reason: string;
  detail: string;
}

export interface ParsedCatalog {
  kind: CatalogKind;
  items: StockItemRow[];
  products: MenuProductRow[];
  recipeLines: RecipeLineRow[];
  issues: CatalogIssue[];
  warnings: string[];
  /** عددُ الصفوف بعد الترويسة. */
  rows: number;
}

/* ───────────────────────── الترويسة ───────────────────────── */

const HEADERS: Record<CatalogKind, readonly string[]> = {
  ITEMS: ["sku", "storage_unit", "ingredient_unit", "storage_to_ingredient_factor", "cost"],
  PRODUCTS: ["sku", "price", "is_active"],
  INGREDIENTS: ["product_sku", "inventory_item_sku", "quantity", "unit"],
};

function indexOfHeaders(head: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  head.forEach((h, i) => {
    const k = normaliseHeader(h);
    if (k !== "" && !m.has(k)) m.set(k, i);
  });
  return m;
}

/**
 * أيُّ الملفّات هذا — بأعمدته لا باسمه.
 *
 * واسمُ الملفّ لا يُعوَّل عليه: يُعاد تسميتُه عند التنزيل، ويحمل رقمَ
 * تصديرٍ ومعرّفاً عشوائيّاً. والأعمدةُ هي ما يقول ما فيه.
 */
export function detectCatalogKind(head: readonly string[]): CatalogKind | null {
  const idx = indexOfHeaders(head);
  /* الوصفاتُ أوّلاً: فيها `sku`؟ لا — فيها `product_sku`، فلا تلتبس */
  for (const kind of ["INGREDIENTS", "ITEMS", "PRODUCTS"] as const) {
    if (HEADERS[kind].every((h) => idx.has(normaliseHeader(h)))) return kind;
  }
  return null;
}

/* ───────────────────────── القراءة ───────────────────────── */

function text(row: readonly string[], at: number | undefined): string {
  return at === undefined ? "" : (row[at] ?? "").trim();
}

/**
 * يقرأ ملفّاً واحداً من الثلاثة.
 *
 * ويُقرأ بـ`readWorkbookSafely` نفسِها التي تقرأ كشوف البنك وملفّ
 * المبيعات: حدودُ الصفوف والأعمدة والخلايا واحدة، ومفاتيحُ النموذج
 * الأوّليّ تُنزَع، والملفُّ يرفعه مستخدم. ولا قارئَ CSV ثانٍ في النظام.
 */
export function parseCatalogFile(buffer: Buffer): ParsedCatalog {
  const wb = readWorkbookSafely(buffer);
  const sheet = wb.sheets[0];
  if (!sheet || sheet.grid.length === 0) {
    return { kind: "ITEMS", items: [], products: [], recipeLines: [], rows: 0, warnings: wb.warnings, issues: [{ row: 0, reason: "ملفٌّ فارغ", detail: "لا صفوفَ فيه" }] };
  }

  const head = sheet.grid[0];
  const kind = detectCatalogKind(head);
  if (kind === null) {
    return {
      kind: "ITEMS", items: [], products: [], recipeLines: [], rows: 0, warnings: wb.warnings,
      issues: [{
        row: 1, reason: "ترويسةٌ غير مفهومة",
        detail: `لم تُعرَف أعمدةُ أيٍّ من الملفّات الثلاثة. الموجود: ${head.filter(Boolean).join("، ")}`,
      }],
    };
  }

  const idx = indexOfHeaders(head);
  const at = (name: string) => idx.get(normaliseHeader(name));
  const body = sheet.grid.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  const out: ParsedCatalog = {
    kind, items: [], products: [], recipeLines: [],
    issues: [], warnings: [...wb.warnings], rows: body.length,
  };

  body.forEach((row, i) => {
    /* رقمُ الصفّ كما يراه من يفتح الملفّ: الترويسةُ ١ */
    const n = i + 2;
    if (kind === "ITEMS") readItem(row, n, at, out);
    else if (kind === "PRODUCTS") readProduct(row, n, at, out);
    else readRecipeLine(row, n, at, out);
  });

  return out;
}

type At = (name: string) => number | undefined;

function readItem(row: readonly string[], n: number, at: At, out: ParsedCatalog): void {
  const sku = text(row, at("sku"));
  const name = text(row, at("name"));
  if (sku === "" || name === "") {
    out.issues.push({ row: n, reason: "صفٌّ بلا رمزٍ أو اسم", detail: `sku=«${sku}» name=«${name}»` });
    return;
  }

  const storageUnit = text(row, at("storage_unit"));
  const unitWord = text(row, at("ingredient_unit"));
  const baseUnit = readUnit(unitWord);
  if (baseUnit === null) {
    out.issues.push({ row: n, reason: "وحدةُ صرفٍ غير معروفة", detail: `«${name}» وحدتُه «${unitWord}»` });
    return;
  }

  const factorMilli = decimalToMilli(text(row, at("storage_to_ingredient_factor")));
  if (factorMilli === null || factorMilli <= 0) {
    out.issues.push({ row: n, reason: "معامِلُ العبوة غير مقروء", detail: `«${name}» — لا يُعرَف كم ${unitWord} في ${storageUnit || "وحدة التخزين"}` });
    return;
  }

  const costText = text(row, at("cost"));
  const packCostMinor = costText === "" ? null : parseRiyals(costText);
  if (packCostMinor === null || packCostMinor < 0) {
    out.issues.push({ row: n, reason: "كلفةٌ غير مقروءة", detail: `«${name}» كلفتُه «${costText}»` });
    return;
  }

  out.items.push({
    itemSku: sku, name, storageUnit, baseUnit,
    packQuantityMilli: factorMilli, packCostMinor,
  });
}

function readProduct(row: readonly string[], n: number, at: At, out: ParsedCatalog): void {
  const sku = text(row, at("sku"));
  const name = text(row, at("name"));
  if (sku === "" || name === "") {
    out.issues.push({ row: n, reason: "صفٌّ بلا رمزٍ أو اسم", detail: `sku=«${sku}» name=«${name}»` });
    return;
  }
  const price = text(row, at("price"));
  const cost = text(row, at("cost"));
  out.products.push({
    productSku: sku,
    name,
    priceMinor: price === "" ? null : parseRiyals(price),
    /* الكلفةُ المعلَنة بخمس منازلَ أحياناً (‏١١٠ ÷ ١٢) — تُقرَّب وتبقى إعلاميّة */
    declaredCostMinor: cost === "" ? null : parseSourceCostMinor(cost),
    isActive: normaliseHeader(text(row, at("is_active"))) !== "no",
  });
}

function readRecipeLine(row: readonly string[], n: number, at: At, out: ParsedCatalog): void {
  const productSku = text(row, at("product_sku"));
  const itemSku = text(row, at("inventory_item_sku"));
  if (productSku === "" || itemSku === "") {
    out.issues.push({ row: n, reason: "سطرٌ بلا طرفين", detail: `منتج=«${productSku}» مكوّن=«${itemSku}»` });
    return;
  }

  const unitWord = text(row, at("unit"));
  const unit = readUnit(unitWord);
  if (unit === null) {
    out.issues.push({ row: n, reason: "وحدةٌ غير معروفة", detail: `${productSku} ← ${itemSku} بوحدة «${unitWord}»` });
    return;
  }

  const quantityMilli = decimalToMilli(text(row, at("quantity")));
  if (quantityMilli === null || quantityMilli <= 0) {
    out.issues.push({
      row: n, reason: "كمّيّةٌ غير مقروءة",
      detail: `${productSku} ← ${itemSku} كمّيّتُه «${text(row, at("quantity"))}»`,
    });
    return;
  }

  const stated = text(row, at("ingredient_cost"));
  out.recipeLines.push({
    productSku,
    productName: text(row, at("product_name")),
    itemSku,
    itemName: text(row, at("inventory_item_name")),
    quantityMilli,
    unit,
    statedCostMinor: stated === "" ? null : parseSourceCostMinor(stated),
  });
}

/* ─────────────────────────── الكلفة ─────────────────────────── */

/**
 * كلفةُ كمّيّةٍ من صنف، بمِلّي‑الهللة.
 *
 * والقسمةُ الأخيرة وحدها هي التي تُقرَّب — فلا تتراكم أخطاءُ تقريبٍ
 * عبر مكوّنات الوصفة. و`null` حين تختلف عائلةُ الوحدة: لا جسرَ بين
 * وزنٍ وحجم، ولا بين حبّةٍ وعبوة.
 */
export function lineCostMilliMinor(
  quantityMilli: number,
  unit: StoredUnit,
  item: Pick<StockItemRow, "baseUnit" | "packQuantityMilli" | "packCostMinor">,
): number | null {
  const inBase = convertMilli(quantityMilli, unit, item.baseUnit);
  if (inBase === null) return null;
  if (item.packQuantityMilli <= 0) return null;
  return Math.round((inBase * item.packCostMinor * MILLI_MINOR) / item.packQuantityMilli);
}

/** مِلّي‑هللةٍ ← هللةً صحيحة — والمقياسُ في `money.ts`، فلا ثانيَ له. */
export const toMinor = milliMinorToMinor;

/** كلفةُ وحدةٍ واحدةٍ من الصنف بمِلّي‑الهللة — للعرض وللتقييم. */
export function unitCostMilliMinor(item: Pick<StockItemRow, "packQuantityMilli" | "packCostMinor">): number | null {
  if (item.packQuantityMilli <= 0) return null;
  return Math.round((MILLI * item.packCostMinor * MILLI_MINOR) / item.packQuantityMilli);
}
