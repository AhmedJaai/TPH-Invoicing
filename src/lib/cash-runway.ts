/**
 * أيّامُ النقد الباقية — «الرصيدُ يغطّي نحو كم يوماً من الصادر؟»
 *
 * الرصيدُ المعروف ÷ متوسّطِ الصادر اليوميّ الفعليّ في آخر ستّين يوماً من الكشف
 * (بلا الحركة بين حسابَي المنشأة، وبلا ما خرج ثمّ عاد). رقمٌ واحد يقول كم يعيش
 * المقهى على رصيده إن لم يدخل شيء — **والواردُ غير محسوب، فهو حدٌّ أدنى لا توقّع**.
 *
 * ولا يُقال رقمٌ على أساسٍ ناقص: رصيدٌ مجهول، أو كشفٌ واقف أكثر من أسبوع، أو تاريخٌ
 * أقصر من ثلاثين يوماً — كلٌّ يُحجب بسببه. والقسمةُ أعدادٌ صحيحة.
 */
import { daysBetween } from "@/lib/riyadh-time";


/** نافذةُ المعدّل بالأيّام — شهران يحملان إيجاراً ورواتبَ ودفعةَ مورّدين مرّتين. */
export const RUNWAY_WINDOW_DAYS = 60;
/** أقلُّ ما يُبنى عليه معدّل. */
export const RUNWAY_MIN_DAYS = 30;
/** كشفٌ أقدم من هذا «واقف» — رصيدُه لا يصف اليوم. */
export const RUNWAY_STALE_DAYS = 7;

export interface RunwayInput {
  /** `null` غير معروف. */
  balanceMinor: number | null;
  /** يومُ الرصيد `YYYY-MM-DD`. */
  balanceAsOf: string | null;
  today: string;
  /** صادرُ النافذة المنتهية بيوم الرصيد — مستبعَداً منه الداخليّ والمرتدّ. */
  outflowMinor: number;
  /** أوّلُ يومٍ في الكشوف داخل النافذة — `null` لا حركةَ فيها. */
  firstDay: string | null;
}

export type RunwayBlock = "NO_BALANCE" | "STALE" | "SHORT_HISTORY" | "NO_OUTFLOW";

export interface Runway {
  /** أيّامٌ كاملة يغطّيها الرصيد — `null` لا يُحسب. */
  days: number | null;
  blocked: RunwayBlock | null;
  /** متوسّطُ الصادر اليوميّ بالهللات (مقرَّباً) — `null` لا يُحسب. */
  dailyOutflowMinor: number | null;
  /** أيّامُ النافذة التي بُني عليها المعدّل. */
  basisDays: number;
}

export function buildRunway(input: RunwayInput): Runway {
  const none = (blocked: RunwayBlock, basisDays = 0): Runway => ({ days: null, blocked, dailyOutflowMinor: null, basisDays });
  if (input.balanceMinor === null || input.balanceAsOf === null) return none("NO_BALANCE");
  if (daysBetween(input.balanceAsOf, input.today) > RUNWAY_STALE_DAYS) return none("STALE");
  if (input.firstDay === null) return none("SHORT_HISTORY");
  /* اليومان داخلان: من أوّل يومٍ في النافذة إلى يوم الرصيد */
  const basisDays = Math.min(RUNWAY_WINDOW_DAYS, daysBetween(input.firstDay, input.balanceAsOf) + 1);
  if (basisDays < RUNWAY_MIN_DAYS) return none("SHORT_HISTORY", basisDays);
  if (input.outflowMinor <= 0) return none("NO_OUTFLOW", basisDays);
  return {
    days: input.balanceMinor <= 0 ? 0 : Math.floor((input.balanceMinor * basisDays) / input.outflowMinor),
    blocked: null,
    dailyOutflowMinor: Math.round(input.outflowMinor / basisDays),
    basisDays,
  };
}

export const RUNWAY_BLOCK_LABEL: Record<RunwayBlock, string> = {
  NO_BALANCE: "لا يمكن الحساب: الرصيد غير معروف",
  STALE: "لا يمكن الحساب: آخر حركة في الكشف قبل أكثر من أسبوع، فرصيده لا يمثّل اليوم",
  SHORT_HISTORY: "لا يمكن الحساب بعد: يلزم كشف يغطي ثلاثين يوماً على الأقل",
  NO_OUTFLOW: "لا يمكن الحساب: لا توجد مصروفات في الكشف لبناء معدل الصرف عليها",
};
