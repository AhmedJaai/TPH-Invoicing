/**
 * قائمةُ الطلب — ماذا أطلب هذا الأسبوع، ومن أيّ مورّد، وبكم تقريباً.
 *
 * لا قاعدةَ ثانية لـ«ما ينفد»: المرشَّحون من `runningOut` في `finance/stock-balance.ts`
 * (آخرُ عدٍّ + ما اشتُري بعده − ما صرفته الوصفات، على متوسّط صرف أربعة أسابيع). وهذا
 * الملفّ يضيف ثلاثة أشياء فقط:
 *
 *   ١. الكمّيّة: ما يكفي أيّامَ التوصيل ثمّ `coverDays` يوماً، ناقصاً ما على الرفّ —
 *      مرفوعةً إلى عبوة الشراء الكاملة إن عُرفت (لا يُطلب «٠٫٤ كرتون»).
 *   ٢. المورّد: مَن اشتُري منه آخرَ مرّة، وسعرُ عبوته في تلك الفاتورة.
 *   ٣. الرسالة: نصٌّ مهذّب يُنسَخ ويُلصق في واتساب — لا يُرسَل شيءٌ من هنا.
 *
 * والمجهولُ يبقى مجهولاً: صنفٌ لا عبوةَ لآخر بنده أو لا سعر «سعره غير معروف» (`null`)،
 * ومجموعُ المورّد لا يُكتب رقماً واحداً وفيه صنفٌ بلا سعر.
 * والمال بالهللات والكمّيّة بالمِلّي — أعدادٌ صحيحة.
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { runningOut } from "@/lib/finance/stock-balance";
import { decimalToMilli, MILLI } from "./units";
import { purchaseQuantity } from "./purchases";

/** يُطلب ما يكفي أسبوعين بعد وصول الطلب. */
export const ORDER_COVER_DAYS = 14;
/** أيّامُ التوصيل: ما يُصرف بين الطلب ووصوله يُحسب في الكمّيّة. */
export const ORDER_LEAD_DAYS = 2;
/** خياراتُ «ما ينفد خلال» في الشاشة — أسبوعٌ هو تنبيهُ المشترى والمباع نفسُه. */
export const ORDER_HORIZONS = [7, 14] as const;

/** صنفٌ بتقدير كفايته — ما يحمله `BalanceItem` ويكفي هذا الملفّ. */
export interface OrderCandidate {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  cover: { onShelfMilli: number; dailyUseMilli: number; daysLeft: number | null } | null;
}

/** آخرُ بند فاتورةٍ مربوطٍ بالصنف — كما يُقرأ من القاعدة. */
export interface LastInvoiceLine {
  productId: string;
  supplierId: string;
  supplierName: string;
  supplierSlug: string;
  phoneE164: string | null;
  /** اسمُ البند كما كتبه المورّد — يُطلب به لأنّه اسمُه عنده. */
  description: string;
  day: string;
  /** عددُ العبوات نصّاً كما في `invoice_lines.qty`. */
  qty: string | null;
  lineTotalMinor: number;
  packSize: string | null;
  contentUnit: StoredUnit | null;
  contentQuantity: string | null;
}

/** ما يُعرف عن عبوة الشراء من آخر بند. */
export interface LastPurchase {
  supplierId: string;
  supplierName: string;
  supplierSlug: string;
  phoneE164: string | null;
  description: string;
  day: string;
  /** ما في العبوة الواحدة بمِلّي وحدة الأساس — `null` لا مواصفةَ عبوة. */
  packMilli: number | null;
  /** سعرُ العبوة الواحدة بالهللات — `null` لا تُعرف الكمّيّة فلا يُقسَم المبلغ. */
  packPriceMinor: number | null;
}

/**
 * عبوةُ الشراء وسعرُها من آخر بند. العبوة = ما في «١» من كمّيّة البند (`purchaseQuantity`
 * نفسُها لا حسابٌ ثانٍ)، والسعر = مبلغُ البند ÷ كمّيّته. وما لم يُقرأ يبقى `null`.
 */
export function lastPurchaseFromLine(line: LastInvoiceLine, baseUnit: StoredUnit): LastPurchase {
  const one = purchaseQuantity({
    lineId: "", invoiceId: "", invoiceNumber: "", supplierName: line.supplierName, invoiceDate: line.day,
    description: line.description, productId: line.productId, qty: "1", lineTotalMinor: 0,
    packSize: line.packSize, contentUnit: line.contentUnit, contentQuantity: line.contentQuantity,
  }, baseUnit);
  const packMilli = one.known && one.canonicalMilli > 0 ? one.canonicalMilli : null;
  const qtyMilli = decimalToMilli(line.qty);
  const packPriceMinor = packMilli !== null && qtyMilli !== null && qtyMilli > 0 && line.lineTotalMinor > 0
    ? Math.round((line.lineTotalMinor * MILLI) / qtyMilli)
    : null;
  return {
    supplierId: line.supplierId, supplierName: line.supplierName, supplierSlug: line.supplierSlug,
    phoneE164: line.phoneE164, description: line.description, day: line.day, packMilli, packPriceMinor,
  };
}

export interface OrderLine {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  daysLeft: number;
  onShelfMilli: number;
  dailyUseMilli: number;
  /** ما يلزم فعلاً قبل التقريب إلى العبوة. */
  needMilli: number;
  /** ما في العبوة — `null` يُطلب بالوحدة لا بالعبوة. */
  packMilli: number | null;
  /** عددُ العبوات المقترح — `null` حين لا عبوة. */
  packs: number | null;
  /** الكمّيّةُ المقترحة بمِلّي وحدة الأساس (عبواتٌ كاملة، أو وحداتٌ كاملة بلا عبوة). */
  orderMilli: number;
  packPriceMinor: number | null;
  /** الكلفةُ التقديريّة — `null` سعرُها غير معروف. */
  costMinor: number | null;
  /** اسمُ البند عند المورّد، و`null` لم يُشترَ بفاتورةٍ مربوطة. */
  description: string | null;
  lastDay: string | null;
}

export interface SupplierOrder {
  /** `null`: أصنافٌ لم تُشترَ بفاتورةٍ مربوطة — المورّد غير معروف. */
  supplierId: string | null;
  supplierName: string | null;
  supplierSlug: string | null;
  phoneE164: string | null;
  lines: OrderLine[];
  /** مجموعُ ما عُرف سعره. */
  knownCostMinor: number;
  /** أصنافٌ بلا سعر — فالمجموع ناقصٌ بها. */
  unknownCostLines: number;
  /** المجموع كاملاً، و`null` إن كان فيه صنفٌ بلا سعر. */
  totalMinor: number | null;
}

export interface OrderOptions {
  /** يُعرض ما ينفد خلال هذه الأيّام. */
  horizonDays?: number;
  leadDays?: number;
  coverDays?: number;
}

/** الكمّيّةُ المقترحة لصنف: عبواتٌ كاملة تغطّي الحاجة، أو وحداتٌ كاملة بلا عبوة. */
export function proposeQuantity(needMilli: number, packMilli: number | null): { packs: number | null; orderMilli: number } {
  if (needMilli <= 0) return { packs: packMilli === null ? null : 0, orderMilli: 0 };
  if (packMilli !== null && packMilli > 0) {
    const packs = Math.ceil(needMilli / packMilli);
    return { packs, orderMilli: packs * packMilli };
  }
  return { packs: null, orderMilli: Math.ceil(needMilli / MILLI) * MILLI };
}

/** كلفةُ عددٍ من العبوات — `null` بلا سعر عبوة. وبلا عبوة لا سعرَ للوحدة يُعرف من البند. */
export function lineCost(packs: number | null, packPriceMinor: number | null): number | null {
  if (packs === null || packPriceMinor === null) return null;
  return packs * packPriceMinor;
}

/** مجموعُ مورّدٍ من أسطره — الكلفةُ المجهولة تُعَدّ ولا تُجمع صفراً. */
export function supplierTotals(costs: readonly (number | null)[]): Pick<SupplierOrder, "knownCostMinor" | "unknownCostLines" | "totalMinor"> {
  let known = 0;
  let unknown = 0;
  for (const c of costs) {
    if (c === null) unknown += 1;
    else known += c;
  }
  return { knownCostMinor: known, unknownCostLines: unknown, totalMinor: unknown > 0 ? null : known };
}

/**
 * قائمةُ الطلب مجموعةً بالمورّد. الأقربُ نفاداً أوّلاً في كلّ مورّد، والمورّدُ الأعجلُ
 * أوّلاً، و«مورّد غير معروف» آخراً.
 */
export function buildOrderList(
  items: readonly OrderCandidate[],
  lastPurchase: ReadonlyMap<string, LastPurchase>,
  opts: OrderOptions = {},
): SupplierOrder[] {
  const horizon = opts.horizonDays ?? ORDER_HORIZONS[0];
  const lead = opts.leadDays ?? ORDER_LEAD_DAYS;
  const coverDays = opts.coverDays ?? ORDER_COVER_DAYS;

  const groups = new Map<string, SupplierOrder>();
  for (const item of runningOut(items, horizon)) {
    const cover = item.cover!;
    const last = lastPurchase.get(item.productId) ?? null;
    const needMilli = Math.max(0, cover.dailyUseMilli * (lead + coverDays) - cover.onShelfMilli);
    const packMilli = last?.packMilli ?? null;
    const { packs, orderMilli } = proposeQuantity(needMilli, packMilli);
    if (orderMilli === 0) continue;
    const packPriceMinor = last?.packPriceMinor ?? null;
    const line: OrderLine = {
      productId: item.productId, name: item.name, baseUnit: item.baseUnit,
      daysLeft: cover.daysLeft!, onShelfMilli: cover.onShelfMilli, dailyUseMilli: cover.dailyUseMilli,
      needMilli, packMilli, packs, orderMilli, packPriceMinor,
      costMinor: lineCost(packs, packPriceMinor),
      description: last?.description ?? null, lastDay: last?.day ?? null,
    };
    const key = last?.supplierId ?? "";
    const g = groups.get(key) ?? {
      supplierId: last?.supplierId ?? null, supplierName: last?.supplierName ?? null,
      supplierSlug: last?.supplierSlug ?? null, phoneE164: last?.phoneE164 ?? null,
      lines: [], knownCostMinor: 0, unknownCostLines: 0, totalMinor: 0,
    };
    g.lines.push(line);
    groups.set(key, g);
  }
  const out = [...groups.values()].map((g) => ({ ...g, ...supplierTotals(g.lines.map((l) => l.costMinor)) }));
  return out.sort((a, b) =>
    Number(a.supplierId === null) - Number(b.supplierId === null)
    || a.lines[0].daysLeft - b.lines[0].daysLeft
    || (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "ar"));
}

/** سطرٌ في رسالة الطلب: ما يُطلب وكمّيّتُه بلغة المورّد. */
export interface MessageLine {
  label: string;
  quantity: string;
}

/**
 * رسالةُ الطلب لمورّد — تُنسَخ وتُلصق في واتساب. أرقامٌ لاتينيّة كما يكتبها الناس فيه.
 */
export function buildOrderMessage(supplierName: string | null, lines: readonly MessageLine[]): string {
  return [
    supplierName ? `السلام عليكم ${supplierName}،` : "السلام عليكم،",
    "",
    "نرجو تجهيز الطلب التالي لمؤسسة ذا بوبليك هاوس (النسيم، جدة):",
    ...lines.map((l) => `• ${l.label}: ${l.quantity}`),
    "",
    "ونرجو إفادتنا بموعد التوصيل وإجمالي الفاتورة.",
    "شاكرين لكم.",
  ].join("\n");
}
