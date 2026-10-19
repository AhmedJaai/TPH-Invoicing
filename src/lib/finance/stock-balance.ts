/**
 * المشترى والمباع والمتوقَّع متبقّياً — **بلا اشتراط جرد**.
 *
 * قالها أحمد (١٢ أكتوبر ٢٠٢٦): «المفترض يحسب لي كامل المشترى والمباع بغضّ النظر عن الجرد
 * ويحسب كم ضايع منها؛ لو كان في جرد هذي نقطة إضافيّة جيّدة». فالأصل:
 *
 *   **المتوقَّع متبقّياً = كلُّ ما اشتُري منذ البداية − كلُّ ما بِيع منه − الهدر المسجَّل**
 *
 * والجردُ — إن وُجد — يقول كم ضاع: **الضائع = المتوقَّع يومَ العدّ − المعدود**. بلا عدٍّ يبقى
 * «المتوقَّع» ولا يُقال «ضاع» شيء: قد يكون على الرفّ.
 *
 * والمشترى يُحسَب **من المصدرين معاً** — فواتيرِنا المربوطة وما أُدخل في فودكس — ويُؤخَذ
 * أكملُهما عند كلّ تاريخ (أحمد، ١٢ أكتوبر ٢٠٢٦: «حساب المشترى من فودكس والفواتير ويشوف
 * إيش اللي أدقّ»). الشراءُ يسقط من سجلٍّ ولا يُخترَع فيه: فاتورةٌ لم تُربَط، أو بضاعةٌ لم
 * تُدخَل في فودكس — فالأكملُ هو الأدقّ. والمقارنةُ **تراكميّة**: فاتورةٌ بتاريخ ٣٠ يونيو
 * أُدخلت في فودكس ٢ يوليو لا تُحسَب مرّتين. والرقمان يُعرَضان معاً ويُقال أيُّهما اعتُمد.
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { varianceCostMinor } from "@/lib/inventory/purchases";
import { SUSPECT_FLOOR_MINOR, SUSPECT_GAP_MULTIPLE } from "./stock-flow";

export type PurchaseSource = "INVOICES" | "FOODICS" | "SAME";

export const PURCHASE_SOURCE_LABEL: Record<PurchaseSource, string> = {
  INVOICES: "الفواتير أكمل",
  FOODICS: "فودكس أكمل",
  SAME: "المصدران متفقان",
};

/** دون هذا الفرق (بنقاط الأساس) يُعدّ المصدران متّفقَين. */
export const SOURCES_AGREE_BP = 200;

/** كمّيّاتُ مدًى واحد بالمِلّي المعياريّ. */
export interface RangeFigures {
  /** فواتيرُنا المربوطة — `null` غير معروفة (لم يُربَط، أو بندٌ بلا كمّيّة). */
  invoicesMilli: number | null;
  invoicesMinor: number;
  /** ما أُدخل في فودكس — `null` لا عبوةَ معروفة للصنف. */
  foodicsMilli: number | null;
  foodicsMinor: number;
  /** المباعُ منه بحسب الوصفات — `null` لا وصفةَ تصل إليه. */
  soldMilli: number | null;
  staffMilli: number;
  wasteMilli: number;
}

export interface BalanceItemInput {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  rateMilliMinor: number | null;
  /** المدّةُ المعروضة، ومنذ البداية حتى عشيّتها (`null` لكلّ الوقت)، وحتى آخرها، وحتى يوم العدّ. */
  period: RangeFigures;
  before: RangeFigures | null;
  toDate: RangeFigures;
  toCount: RangeFigures | null;
  count: { day: string; milli: number; source: "OURS" | "FOODICS" } | null;
}

export type BalanceNote =
  /** لا شراءَ معروفاً له من أيّ مصدر. */
  | "NO_PURCHASES"
  | "NO_RECIPE"
  /** بِيع منه أكثر ممّا اشتُري — شراءٌ لم يُسجَّل. */
  | "SOLD_MORE_THAN_BOUGHT"
  /** الضائعُ فوق عشرة أضعاف ما بِيع — عدٌّ أو كمّيّةُ شراءٍ أُدخلت خطأً. */
  | "SUSPECT_ENTRY";

export const BALANCE_NOTE_LABEL: Record<BalanceNote, string> = {
  NO_PURCHASES: "لا شراء مسجّل لهذا الصنف، لا في الفواتير المربوطة ولا في فودكس",
  NO_RECIPE: "لا وصفة تستخدم هذا الصنف، فالمباع منه غير معروف",
  SOLD_MORE_THAN_BOUGHT: "المباع منه أكثر من المشتريات المسجّلة، فهناك مشتريات لم تُسجَّل",
  SUSPECT_ENTRY: "رقم مشكوك فيه: ربما جرد أو كمية شراء أُدخلت خطأً",
};

export interface BalanceItem {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  /** أيُّ المصدرين أكمل منذ البداية — `null` لا شراءَ معروفاً من أيّهما. */
  source: PurchaseSource | null;
  /** ما يقوله كلُّ مصدرٍ منذ البداية — يُعرَضان معاً. `null` غير معروف. */
  invoicesToDateMilli: number | null;
  foodicsToDateMilli: number | null;
  purchasedMilli: number | null;
  purchasedMinor: number | null;
  soldMilli: number | null;
  soldMinor: number | null;
  staffMilli: number;
  wasteMilli: number;
  /** المتوقَّع متبقّياً في آخر المدّة — `null` إن جُهل المشترى أو المباع. */
  expectedMilli: number | null;
  expectedMinor: number | null;
  count: BalanceItemInput["count"];
  /** المتوقَّع يومَ العدّ ناقصاً المعدود. موجبٌ ضاع، سالبٌ وُجد أكثر ممّا سُجّل شراؤه. */
  lostMilli: number | null;
  lostMinor: number | null;
  notes: BalanceNote[];
}

/** الأكملُ من المصدرين حتى تاريخ: كمّيّتُه وقيمتُه. `null` لا يُعرَف من أيّهما. */
function best(r: RangeFigures): { milli: number; minor: number } | null {
  const ours = r.invoicesMilli === null ? null : { milli: r.invoicesMilli, minor: r.invoicesMinor };
  const theirs = r.foodicsMilli === null ? null : { milli: r.foodicsMilli, minor: r.foodicsMinor };
  if (ours === null) return theirs;
  if (theirs === null) return ours;
  return theirs.milli > ours.milli ? theirs : ours;
}

/** أيُّ المصدرين أكمل منذ البداية؟ — للعرض بجانب الرقمين. */
export function chooseSource(toDate: RangeFigures): PurchaseSource | null {
  const { invoicesMilli: ours, foodicsMilli: theirs } = toDate;
  if (ours === null && theirs === null) return null;
  if (ours === null) return "FOODICS";
  if (theirs === null) return "INVOICES";
  const large = Math.max(ours, theirs);
  if (large === 0 || Math.abs(ours - theirs) * 10_000 <= large * SOURCES_AGREE_BP) return "SAME";
  return theirs > ours ? "FOODICS" : "INVOICES";
}

const remaining = (r: RangeFigures): number | null => {
  const b = best(r);
  return b === null || r.soldMilli === null ? null : b.milli - r.soldMilli - r.wasteMilli;
};

export function buildBalanceItem(i: BalanceItemInput): BalanceItem {
  const source = chooseSource(i.toDate);
  const cost = (milli: number | null) => varianceCostMinor(milli, i.rateMilliMinor, i.baseUnit);
  /* مشترى المدّة = الأكملُ حتى آخرها − الأكملُ حتى عشيّتها: تراكميٌّ فلا يُحسَب شراءٌ مرّتين */
  const end = best(i.toDate);
  const start = i.before === null ? { milli: 0, minor: 0 } : best(i.before) ?? { milli: 0, minor: 0 };
  const period = end === null ? { milli: null, minor: null } : { milli: end.milli - start.milli, minor: end.minor - start.minor };
  const expectedMilli = remaining(i.toDate);
  const notes: BalanceNote[] = [];
  if (end === null) notes.push("NO_PURCHASES");
  if (i.toDate.soldMilli === null) notes.push("NO_RECIPE");
  if (expectedMilli !== null && expectedMilli < 0) notes.push("SOLD_MORE_THAN_BOUGHT");

  let lostMilli: number | null = null;
  if (i.count !== null && i.toCount !== null) {
    const expectedAtCount = remaining(i.toCount);
    /* متوقَّعٌ سالبٌ يومَ العدّ: المشترى المسجَّل ناقص — لا يُقاس عليه ضياع */
    if (expectedAtCount !== null && expectedAtCount >= 0) lostMilli = expectedAtCount - i.count.milli;
  }
  let lostMinor = cost(lostMilli);
  const soldToCount = i.toCount?.soldMilli ?? 0;
  if (lostMilli !== null && lostMinor !== null && Math.abs(lostMinor) >= SUSPECT_FLOOR_MINOR && Math.abs(lostMilli) > Math.max(0, soldToCount) * SUSPECT_GAP_MULTIPLE) {
    lostMilli = null; lostMinor = null;
    notes.push("SUSPECT_ENTRY");
  }
  return {
    productId: i.productId, name: i.name, baseUnit: i.baseUnit, source,
    invoicesToDateMilli: i.toDate.invoicesMilli, foodicsToDateMilli: i.toDate.foodicsMilli,
    purchasedMilli: period.milli, purchasedMinor: period.minor,
    soldMilli: i.period.soldMilli, soldMinor: cost(i.period.soldMilli),
    staffMilli: i.period.staffMilli, wasteMilli: i.period.wasteMilli,
    expectedMilli, expectedMinor: cost(expectedMilli),
    count: i.count, lostMilli, lostMinor, notes,
  };
}

export interface BalanceTotals {
  purchasedMinor: number;
  /** كم صنفاً كلُّ مصدرٍ فيه أكمل، وكم اتّفقا. */
  invoicesBetter: number;
  foodicsBetter: number;
  sourcesAgree: number;
  soldMinor: number;
  /** المتوقَّع متبقّياً (الموجب) — وما بِيع فوق المشترى على حدة. */
  expectedMinor: number;
  shortPurchasesMinor: number;
  /** الضائع (موجب) والزائد (سالب) لا يتقاصّان. `null` لا صنفَ عُدّ. */
  lostMinor: number | null;
  foundMinor: number | null;
  counted: number;
  items: number;
}

export function totalBalance(items: readonly BalanceItem[]): BalanceTotals {
  const counted = items.filter((x) => x.lostMinor !== null);
  const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
  return {
    purchasedMinor: sum(items.map((x) => x.purchasedMinor ?? 0)),
    invoicesBetter: items.filter((x) => x.source === "INVOICES").length,
    foodicsBetter: items.filter((x) => x.source === "FOODICS").length,
    sourcesAgree: items.filter((x) => x.source === "SAME").length,
    soldMinor: sum(items.map((x) => x.soldMinor ?? 0)),
    expectedMinor: sum(items.map((x) => Math.max(0, x.expectedMinor ?? 0))),
    shortPurchasesMinor: sum(items.map((x) => Math.max(0, -(x.expectedMinor ?? 0)))),
    lostMinor: counted.length === 0 ? null : sum(counted.map((x) => Math.max(0, x.lostMinor ?? 0))),
    foundMinor: counted.length === 0 ? null : sum(counted.map((x) => Math.min(0, x.lostMinor ?? 0))),
    counted: counted.length, items: items.length,
  };
}
