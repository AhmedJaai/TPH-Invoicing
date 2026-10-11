/**
 * شاهدُ المخزون من فودكس — تحويلٌ نقيّ من صيغة الواجهة إلى صفوف المرآة.
 *
 * ثلاثُ وقائع لا تختلط:
 *   - **المعدود** في الجرد: كتبه إنسانٌ وقف أمام الرفّ. يُؤخَذ كما كُتب.
 *   - **الفرق** الذي يحسبه فودكس بجانبه: حسابُه هو، ورصيدُه الدفتريّ سالبٌ لأصنافٍ لم
 *     تُدخَل مشترياتُها. يُحفَظ شاهداً ولا يُبنى عليه.
 *   - **الصرف** الذي يكتبه مع كلّ طلب: وصفتُه × ما بِيع. يُقارَن به استهلاكُنا النظريّ.
 */
import { addDays, isoDay } from "@/lib/riyadh-time";
import { parseFoodicsMoment, riyalsToMicro, riyalsToMinor } from "./money";
import type { FoodicsStockCount, FoodicsStockMove } from "./types";

const RIYADH_OFFSET_MS = 3 * 3_600_000;
const HALF_DAY_MS = 12 * 3_600_000;

/**
 * آخرُ يومِ بيعٍ سبق العدّ.
 *
 * العدُّ يقع بعد الإقفال: ١:٤٠ فجرَ الأحد أو ٥:٤٦ صباحَه — وفودكس يؤرّخ الأوّلَ سبتاً
 * والثاني أحداً والرفُّ واحد. فاليومُ هو تاريخُ الرياض للحظة العدّ ناقصاً نصفَ يوم.
 * وما لا تُقرأ لحظتُه يُؤخَذ يومُ عمله كما هو.
 */
export function stockDayOf(countedAt: Date | null, businessDate: string): string {
  if (countedAt === null) return businessDate;
  /* لحظةٌ مُزاحةٌ إلى توقيت الرياض ناقصاً نصفَ يوم — يومُها التقويميّ هو المطلوب */
  return isoDay(new Date(countedAt.getTime() + RIYADH_OFFSET_MS - HALF_DAY_MS));
}

/** عددٌ بكسورٍ إلى جزءٍ من `scale` بلا مرورٍ بضربٍ عائم: يُقرأ نصُّه. `null` لما لا يُقرأ. */
export function toScaled(value: number | null | undefined, decimals: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const text = value.toFixed(decimals);
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const n = Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, "0"));
  return Number.isSafeInteger(n) ? (negative ? -n : n) : null;
}

export interface StockCountRow {
  head: {
    id: string; reference: string; businessDate: string; stockDay: string; status: number;
    creatorName: string | null; countedAt: Date | null; sourceUpdatedAt: Date;
  };
  items: {
    countId: string; itemId: string; sku: string | null; name: string;
    storageUnit: string | null; ingredientUnit: string | null; factorMilli: number | null;
    quantityMilli: number; varianceQuantityMilli: number | null; varianceCostMinor: number | null;
  }[];
}

/** جردٌ إلى صفوفه. `null` إن لم تُقرأ كمّيّةُ بندٍ — جردٌ ناقصٌ يُقرأ نقصاً على الرفّ. */
export function stockCountRow(c: FoodicsStockCount): StockCountRow | null {
  const updated = parseFoodicsMoment(c.updated_at);
  if (updated === null) return null;
  const countedAt = parseFoodicsMoment(c.created_at);
  const items: StockCountRow["items"] = [];
  for (const it of c.items ?? []) {
    const quantityMilli = toScaled(it.pivot.quantity, 3);
    if (quantityMilli === null) return null;
    const factor = toScaled(it.storage_to_ingredient_factor, 3);
    items.push({
      countId: c.id, itemId: it.id, sku: it.sku?.trim() || null, name: it.name.trim(),
      storageUnit: it.storage_unit?.trim() || null, ingredientUnit: it.ingredient_unit?.trim() || null,
      factorMilli: factor !== null && factor > 0 ? factor : null,
      quantityMilli,
      varianceQuantityMilli: toScaled(it.pivot.variance_quantity, 3),
      varianceCostMinor: riyalsToMinor(it.pivot.variance_cost),
    });
  }
  return {
    head: {
      id: c.id, reference: c.reference, businessDate: c.business_date,
      stockDay: stockDayOf(countedAt, c.business_date), status: c.status,
      creatorName: c.creator?.name?.trim() || null, countedAt, sourceUpdatedAt: updated,
    },
    items,
  };
}

export interface ItemMoveRow {
  businessDate: string; kind: number; itemId: string; sku: string | null; name: string;
  storageUnit: string | null; ingredientUnit: string | null;
  storageMicro: number; ingredientMilli: number | null; costMicro: number; txCount: number;
}

/**
 * حركاتُ يومٍ إلى مجموعٍ لكلّ صنفٍ ونوع.
 *
 * وحدةُ الصرف تُحسَب لكلّ سطرٍ بمعامِله هو (٠٫٠٠٠٢٥ كرتون × ٤٠٠٠ = حبّة) ثمّ تُجمَع؛
 * وسطرٌ بلا معامِل يجعل مجموعَ صنفه بوحدة الصرف «غير معروف» لا ناقصاً.
 * وما لم تُقرأ كمّيّتُه أو كلفتُه يُعدّ في `unread` ولا يُسقِط اليوم.
 */
export function aggregateMoves(moves: readonly FoodicsStockMove[]): { rows: ItemMoveRow[]; unread: number } {
  const byKey = new Map<string, ItemMoveRow & { factorMissing: boolean; seen: Set<string> }>();
  let unread = 0;
  for (const m of moves) {
    for (const it of m.items ?? []) {
      const storageMicro = toScaled(it.pivot.quantity, 6);
      const costMicro = riyalsToMicro(it.pivot.cost);
      if (storageMicro === null || costMicro === null) { unread++; continue; }
      const key = `${m.business_date}|${m.type}|${it.id}`;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          businessDate: m.business_date, kind: m.type, itemId: it.id, sku: it.sku?.trim() || null, name: it.name.trim(),
          storageUnit: it.storage_unit?.trim() || null, ingredientUnit: it.ingredient_unit?.trim() || null,
          storageMicro: 0, ingredientMilli: 0, costMicro: 0, txCount: 0, factorMissing: false, seen: new Set(),
        };
        byKey.set(key, acc);
      }
      acc.storageMicro += storageMicro;
      acc.costMicro += costMicro;
      if (!acc.seen.has(m.id)) { acc.seen.add(m.id); acc.txCount++; }
      const factorMilli = toScaled(it.storage_to_ingredient_factor, 3);
      if (factorMilli === null || factorMilli <= 0) acc.factorMissing = true;
      /* مايكرو × مِلّي ÷ مليون = مِلّي من وحدة الصرف */
      else acc.ingredientMilli = (acc.ingredientMilli ?? 0) + Math.round((storageMicro * factorMilli) / 1_000_000);
    }
  }
  const rows = [...byKey.values()].map((acc): ItemMoveRow => ({
    businessDate: acc.businessDate, kind: acc.kind, itemId: acc.itemId, sku: acc.sku, name: acc.name,
    storageUnit: acc.storageUnit, ingredientUnit: acc.ingredientUnit,
    storageMicro: acc.storageMicro, ingredientMilli: acc.factorMissing ? null : acc.ingredientMilli,
    costMicro: acc.costMicro, txCount: acc.txCount,
  }));
  return { rows, unread };
}

/** أيّامُ المدى شاملةَ الطرفين. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
