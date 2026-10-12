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
 * والمشترى من فواتيرنا المربوطة حين تكتمل، وإلّا ممّا أُدخل في فودكس (صنفُه ووحدتُه
 * وعبوتُه معروفةٌ هناك) — ويُقال مصدرُه. وما لا يُعرَف يبقى «غير معروف» لا صفراً.
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { varianceCostMinor } from "@/lib/inventory/purchases";
import { SUSPECT_FLOOR_MINOR, SUSPECT_GAP_MULTIPLE, WITNESS_COMPLETENESS_BP } from "./stock-flow";

export type PurchaseSource = "INVOICES" | "FOODICS";

export const PURCHASE_SOURCE_LABEL: Record<PurchaseSource, string> = {
  INVOICES: "من فواتيرنا",
  FOODICS: "ممّا أُدخل في فودكس",
};

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
  /** المدّةُ المعروضة، ومنذ البداية حتى آخرها، ومنذ البداية حتى يوم العدّ. */
  period: RangeFigures;
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
  NO_PURCHASES: "لا شراءَ مسجَّلاً له — لا في فواتيرنا المربوطة ولا في فودكس",
  NO_RECIPE: "لا وصفةَ تصل إليه — المباعُ منه غير معروف",
  SOLD_MORE_THAN_BOUGHT: "بِيع منه أكثر ممّا سُجّل شراؤه — شراءٌ لم يُسجَّل",
  SUSPECT_ENTRY: "رقمٌ مشكوكٌ فيه: عدٌّ أو كمّيّةُ شراءٍ أُدخلت خطأً",
};

export interface BalanceItem {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  source: PurchaseSource | null;
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

/**
 * المصدرُ يُختار مرّةً لكلّ صنف على كلّ ما مضى، ثمّ يُستعمَل لكلّ المدد: فواتيرُنا إن عُرفت
 * ولم تكن دون أربعة أخماس ما في فودكس (ربطٌ ناقص)، وإلّا فودكس، وإلّا فواتيرُنا كما هي.
 */
export function chooseSource(toDate: RangeFigures): PurchaseSource | null {
  const { invoicesMilli: ours, foodicsMilli: theirs } = toDate;
  if (ours !== null && (theirs === null || theirs <= 0 || ours * 10_000 >= theirs * WITNESS_COMPLETENESS_BP)) return "INVOICES";
  if (theirs !== null && theirs > 0) return "FOODICS";
  return ours !== null ? "INVOICES" : null;
}

const bought = (r: RangeFigures, source: PurchaseSource | null): { milli: number | null; minor: number | null } =>
  source === "INVOICES" ? { milli: r.invoicesMilli, minor: r.invoicesMilli === null ? null : r.invoicesMinor }
  : source === "FOODICS" ? { milli: r.foodicsMilli, minor: r.foodicsMilli === null ? null : r.foodicsMinor }
  : { milli: null, minor: null };

const remaining = (r: RangeFigures, source: PurchaseSource | null): number | null => {
  const b = bought(r, source).milli;
  return b === null || r.soldMilli === null ? null : b - r.soldMilli - r.wasteMilli;
};

export function buildBalanceItem(i: BalanceItemInput): BalanceItem {
  const source = chooseSource(i.toDate);
  const cost = (milli: number | null) => varianceCostMinor(milli, i.rateMilliMinor, i.baseUnit);
  const period = bought(i.period, source);
  const expectedMilli = remaining(i.toDate, source);
  const notes: BalanceNote[] = [];
  if (source === null || bought(i.toDate, source).milli === null) notes.push("NO_PURCHASES");
  if (i.toDate.soldMilli === null) notes.push("NO_RECIPE");
  if (expectedMilli !== null && expectedMilli < 0) notes.push("SOLD_MORE_THAN_BOUGHT");

  let lostMilli: number | null = null;
  if (i.count !== null && i.toCount !== null) {
    const expectedAtCount = remaining(i.toCount, source);
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
    purchasedMilli: period.milli, purchasedMinor: period.minor,
    soldMilli: i.period.soldMilli, soldMinor: cost(i.period.soldMilli),
    staffMilli: i.period.staffMilli, wasteMilli: i.period.wasteMilli,
    expectedMilli, expectedMinor: cost(expectedMilli),
    count: i.count, lostMilli, lostMinor, notes,
  };
}

export interface BalanceTotals {
  purchasedMinor: number;
  /** منه ما جاء من فواتيرنا — والباقي ممّا أُدخل في فودكس. */
  purchasedFromInvoicesMinor: number;
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
    purchasedFromInvoicesMinor: sum(items.map((x) => (x.source === "INVOICES" ? x.purchasedMinor ?? 0 : 0))),
    soldMinor: sum(items.map((x) => x.soldMinor ?? 0)),
    expectedMinor: sum(items.map((x) => Math.max(0, x.expectedMinor ?? 0))),
    shortPurchasesMinor: sum(items.map((x) => Math.max(0, -(x.expectedMinor ?? 0)))),
    lostMinor: counted.length === 0 ? null : sum(counted.map((x) => Math.max(0, x.lostMinor ?? 0))),
    foundMinor: counted.length === 0 ? null : sum(counted.map((x) => Math.min(0, x.lostMinor ?? 0))),
    counted: counted.length, items: items.length,
  };
}
