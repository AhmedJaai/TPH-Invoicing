/**
 * لوحةُ الهدر — كم ريالاً ولأيّ سبب، من `waste_records` القائم.
 *
 * الهدرُ يُسجَّل داخل الجرد ويُبطَل بسببه ولا عرضَ يجمعه. هنا يُجمَع لأسابيعَ مضت:
 * كلفتُه مقسومةً على أسبابه، وأكثرُ الأصناف هدراً، و«انتهت صلاحيّتُه» إن تكرّر لصنف —
 * فذلك يقول إنّ الطلبيّة أكبرُ من اللازم. **ليس منتجَ إدارة هدر**: قراءةٌ لما كُتب.
 *
 * والكلفةُ من سعر الوحدة في آخر جردٍ حمله للصنف (`varianceCostMinor` نفسُها). وما لا
 * سعرَ له **يُعَدّ ولا يُجمَع صفراً**: «٣ سجلّات بلا كلفة» تُقال بجانب المجموع.
 */
import type { StoredUnit } from "../unit-conversion";
import { varianceCostMinor } from "./purchases";
import { sameUnitFamily, toCanonical } from "./units";

export type WasteReason = "EXPIRED" | "SPILLED" | "FAILED_PREP" | "CALIBRATION" | "STAFF_DRINK" | "DAMAGED" | "OTHER";

export const WASTE_REASON_LABEL: Record<WasteReason, string> = {
  EXPIRED: "انتهت صلاحيته",
  SPILLED: "انسكب",
  FAILED_PREP: "تحضير فاشل",
  CALIBRATION: "معايرة الماكينة",
  STAFF_DRINK: "مشروب موظف",
  DAMAGED: "تلف",
  OTHER: "سبب آخر",
};

export interface WasteEntry {
  productId: string;
  productName: string;
  reason: WasteReason;
  /** الكمّيّةُ بمِلّي وحدتها كما سُجّلت (لتران = 2000 و`L`). */
  quantityMilli: number;
  unit: StoredUnit;
}

export interface WasteRate {
  /** سعرُ الوحدة الأساس بالمِلّي-هللة من آخر جردٍ حمله — `null` لم يُعرف. */
  rateMilliMinor: number | null;
  baseUnit: StoredUnit;
}

export interface WasteBoard {
  recordCount: number;
  /** مجموعُ ما عُرفت كلفتُه. */
  knownCostMinor: number;
  /** سجلّاتٌ لا سعرَ لصنفها — خارج المجموع، معدودةٌ بجانبه. */
  unknownCount: number;
  byReason: { reason: WasteReason; count: number; costMinor: number; unknownCount: number }[];
  topProducts: { productId: string; productName: string; count: number; costMinor: number }[];
  /** أصنافٌ «انتهت صلاحيّتُها» أكثر من مرّة في النافذة. */
  repeatedExpiry: { productId: string; productName: string; count: number }[];
}

/** كم مرّةً «انتهت صلاحيّتُه» تجعل الصنفَ إشارةً على طلبيّةٍ زائدة. */
export const REPEATED_EXPIRY_MIN = 2;

export function entryCostMinor(e: WasteEntry, rate: WasteRate | undefined): number | null {
  /* غرامٌ وكيلو عائلةٌ واحدة تُحوَّل؛ ولا جسرَ يُخمَّن بين وزنٍ وحجم — مجهول */
  if (!rate || !sameUnitFamily(rate.baseUnit, e.unit)) return null;
  return varianceCostMinor(toCanonical(e.quantityMilli, e.unit), rate.rateMilliMinor, rate.baseUnit);
}

export function buildWasteBoard(entries: readonly WasteEntry[], rates: ReadonlyMap<string, WasteRate>): WasteBoard {
  const reasons = new Map<WasteReason, { count: number; costMinor: number; unknownCount: number }>();
  const products = new Map<string, { productName: string; count: number; costMinor: number }>();
  const expiry = new Map<string, { productName: string; count: number }>();
  let known = 0;
  let unknown = 0;

  for (const e of entries) {
    const cost = entryCostMinor(e, rates.get(e.productId));
    const r = reasons.get(e.reason) ?? { count: 0, costMinor: 0, unknownCount: 0 };
    r.count++;
    if (cost === null) { r.unknownCount++; unknown++; } else { r.costMinor += cost; known += cost; }
    reasons.set(e.reason, r);

    if (cost !== null) {
      const p = products.get(e.productId) ?? { productName: e.productName, count: 0, costMinor: 0 };
      p.count++;
      p.costMinor += cost;
      products.set(e.productId, p);
    }
    if (e.reason === "EXPIRED") {
      const x = expiry.get(e.productId) ?? { productName: e.productName, count: 0 };
      x.count++;
      expiry.set(e.productId, x);
    }
  }

  return {
    recordCount: entries.length,
    knownCostMinor: known,
    unknownCount: unknown,
    byReason: [...reasons].map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.costMinor - a.costMinor || b.count - a.count || a.reason.localeCompare(b.reason)),
    topProducts: [...products].map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.costMinor - a.costMinor || a.productId.localeCompare(b.productId)).slice(0, 3),
    repeatedExpiry: [...expiry].map(([productId, v]) => ({ productId, ...v }))
      .filter((x) => x.count >= REPEATED_EXPIRY_MIN)
      .sort((a, b) => b.count - a.count || a.productId.localeCompare(b.productId)),
  };
}
