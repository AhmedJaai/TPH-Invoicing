/**
 * متتبّعُ انتهاء الوثائق — السجلُّ التجاريّ ورخصةُ البلديّة والدفاعُ المدنيّ
 * والشهاداتُ الصحّيّة والإقامات وعقدُ الإيجار والتأمين.
 *
 * غرامةُ رخصةٍ منتهية أو إغلاقٌ بلديّ أغلى من أيّ خطأ فاتورة، ولم يكن في
 * النظام تاريخُ انتهاءٍ واحد. الإدخالُ بيد صاحب المقهى (عشرُ وثائق تقريباً)،
 * والنظامُ يذكّر قبل الموعد بمهلةٍ يكتبها لكلّ وثيقة.
 *
 * دالّةٌ خالصة. والأيّامُ بتوقيت الرياض (`today` يُمرَّر). وما لا تاريخَ له لا
 * يُحفظ أصلاً: التاريخُ شرطُ الوثيقة هنا، فلا «غير معروف» يُحسب به.
 */
import { daysBetween, isoDay } from "@/lib/riyadh-time";


export const OBLIGATION_KINDS = [
  "COMMERCIAL_REGISTER", "MUNICIPAL_LICENCE", "CIVIL_DEFENCE", "HEALTH_CERTIFICATE",
  "IQAMA", "LEASE", "INSURANCE", "SUBSCRIPTION", "OTHER",
] as const;

export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const OBLIGATION_KIND_LABEL: Record<ObligationKind, string> = {
  COMMERCIAL_REGISTER: "السجلّ التجاريّ",
  MUNICIPAL_LICENCE: "رخصة البلديّة",
  CIVIL_DEFENCE: "الدفاع المدنيّ",
  HEALTH_CERTIFICATE: "شهادة صحّيّة",
  IQAMA: "إقامة",
  LEASE: "عقد الإيجار",
  INSURANCE: "تأمين",
  SUBSCRIPTION: "اشتراك أو عقد خدمة",
  OTHER: "أخرى",
};

export function isObligationKind(v: string): v is ObligationKind {
  return (OBLIGATION_KINDS as readonly string[]).includes(v);
}

/** المهلةُ الأصل قبل الانتهاء — ثلاثون يوماً، وتُكتب لكلّ وثيقة. */
export const DEFAULT_REMIND_DAYS = 30;
export const MAX_REMIND_DAYS = 180;
/** في أسبوعها الأخير تشتدّ. */
export const URGENT_DAYS = 7;

export interface Obligation {
  id: string;
  kind: ObligationKind;
  title: string;
  /** الجهةُ المُصدِرة. */
  issuer: string | null;
  /** رقمُ الوثيقة. */
  reference: string | null;
  /** لمن — اسمُ الموظّف في الإقامة والشهادة الصحّيّة. */
  holder: string | null;
  /** YYYY-MM-DD */
  expiresOn: string;
  remindDays: number;
  note: string | null;
}

export type ExpiryLevel = "EXPIRED" | "URGENT" | "SOON" | "OK";

export const EXPIRY_LEVEL_LABEL: Record<ExpiryLevel, string> = {
  EXPIRED: "انتهت",
  URGENT: "تنتهي هذا الأسبوع",
  SOON: "تنتهي قريباً",
  OK: "سارية",
};

export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === day;
}

/** كم يوماً بقي — سالبٌ بعد الانتهاء، وصفرٌ يومَه. */
export function daysLeft(expiresOn: string, today: string): number {
  return daysBetween(today, expiresOn);
}

export function expiryLevel(o: Pick<Obligation, "expiresOn" | "remindDays">, today: string): ExpiryLevel {
  const left = daysLeft(o.expiresOn, today);
  if (left < 0) return "EXPIRED";
  if (left <= URGENT_DAYS) return "URGENT";
  if (left <= o.remindDays) return "SOON";
  return "OK";
}

/** مفتاحُ التأجيل — يحمل تاريخَ الانتهاء، فتجديدُ الوثيقة يُعيد التذكيرَ لموعدها الجديد. */
export function obligationKey(o: Pick<Obligation, "id" | "expiresOn">): string {
  return `obligation:${o.id}:${o.expiresOn}`;
}

export interface DueObligation extends Obligation {
  daysLeft: number;
  level: Exclude<ExpiryLevel, "OK">;
}

/**
 * ما حان تذكيرُه: انتهى أو دخل مهلتَه — الأقربُ انتهاءً أوّلاً (والمنتهي قبل الجميع).
 * و`silenced` ما أجّله صاحبُه؛ **والمنتهي لا يُسكَت**: وثيقةٌ انتهت خطرٌ قائم لا
 * تذكيرٌ يؤجَّل — تُجدَّد أو تُؤرشَف.
 */
export function dueObligations(
  list: readonly Obligation[],
  today: string,
  silenced: ReadonlySet<string> = new Set(),
): DueObligation[] {
  const out: DueObligation[] = [];
  for (const o of list) {
    const level = expiryLevel(o, today);
    if (level === "OK") continue;
    if (level !== "EXPIRED" && silenced.has(obligationKey(o))) continue;
    out.push({ ...o, daysLeft: daysLeft(o.expiresOn, today), level });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title));
}

/** «بعد ١٢ يوماً» · «اليوم» · «منذ ٣ أيّام» — بلا أرقامٍ سالبة تُقرأ خطأً. */
export function describeDaysLeft(left: number): string {
  if (left === 0) return "تنتهي اليوم";
  if (left === 1) return "تنتهي غداً";
  if (left === -1) return "انتهت أمس";
  if (left > 0) return left === 2 ? "بعد يومين" : left <= 10 ? `بعد ${left} أيّام` : `بعد ${left} يوماً`;
  const past = -left;
  return past === 2 ? "انتهت منذ يومين" : past <= 10 ? `انتهت منذ ${past} أيّام` : `انتهت منذ ${past} يوماً`;
}
