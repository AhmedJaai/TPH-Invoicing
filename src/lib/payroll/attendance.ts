/**
 * الحضورُ من جوال الموظّف — أين كان، وهل تأخّر، وكم عمل.
 *
 * لا بصمةَ في المقهى، ولا يراجع صاحبُه الكاميرات كلَّ يوم. فالموظّفُ يسجّل حضوره وانصرافه من
 * رابطه الشخصيّ، ويُحكم على التسجيل بشاهدين:
 *   - **الموقع**: بُعدُ الجوال عن المقهى (GPS) ضمن نصف قطرٍ يضبطه صاحبُه، مع هامشِ دقّة القراءة.
 *   - **الشبكة**: عنوانُ الإنترنت العامّ — إن طابق عنوانَ شبكة المقهى فالجوالُ على الواي فاي فيه.
 * وما لا يجتمع له شاهدٌ يُسجَّل ولا يُرفض، ويُعرض على صاحب المقهى ليقبله أو يردّه.
 *
 * والتأخيرُ يُحسب من وقت الحضور وبداية الدوام بتوقيت الرياض (UTC+3، بلا توقيتٍ صيفيّ).
 *
 * نقيّ. الإحداثيّاتُ أعدادٌ صحيحة بالميكرودرجة، والمسافةُ أمتارٌ صحيحة.
 */
import type { CheckinVerdict } from "@/db/schema";
import { todayInRiyadh } from "@/lib/riyadh-time";

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const EARTH_RADIUS_M = 6_371_000;

/** نصفُ القطر الأصليّ حول المقهى — مبنى ومواقفه. */
export const DEFAULT_RADIUS_M = 120;
/** أقصى ما يُغتفر من ضعف دقّة القراءة — قراءةٌ دقّتُها كيلومتر لا تشهد بشيء. */
export const MAX_ACCURACY_ALLOWANCE_M = 100;

export const VERDICT_LABEL: Record<CheckinVerdict, string> = {
  IN_PLACE: "في المقهى",
  ON_NETWORK: "على شبكة المقهى",
  FAR: "بعيد عن المقهى",
  NO_LOCATION: "بلا موقع",
};

/** شاهدٌ يكفي: موقعُه في المقهى أو جوالُه على شبكته. */
export function trusted(verdict: CheckinVerdict): boolean {
  return verdict === "IN_PLACE" || verdict === "ON_NETWORK";
}

export const toMicro = (deg: number): number => Math.round(deg * 1_000_000);

/** المسافةُ بين نقطتين بالأمتار (هافرساين). */
export function distanceMeters(aLatMicro: number, aLngMicro: number, bLatMicro: number, bLngMicro: number): number {
  const rad = (micro: number) => (micro / 1_000_000) * (Math.PI / 180);
  const dLat = rad(bLatMicro - aLatMicro);
  const dLng = rad(bLngMicro - aLngMicro);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLatMicro)) * Math.cos(rad(bLatMicro)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export interface CafePlace {
  latMicro: number;
  lngMicro: number;
  radiusM: number;
}

export function judgeCheckin(input: {
  place: CafePlace | null;
  position: { latMicro: number; lngMicro: number; accuracyM: number | null } | null;
  /** عنوانُ الجوال يطابق عنوانَ شبكة المقهى المحفوظ. */
  onNetwork: boolean;
}): { verdict: CheckinVerdict; distanceM: number | null } {
  const distanceM = input.place && input.position
    ? distanceMeters(input.place.latMicro, input.place.lngMicro, input.position.latMicro, input.position.lngMicro)
    : null;
  if (distanceM !== null && input.place) {
    const allowance = Math.min(MAX_ACCURACY_ALLOWANCE_M, Math.max(0, input.position?.accuracyM ?? 0));
    if (distanceM <= input.place.radiusM + allowance) return { verdict: "IN_PLACE", distanceM };
  }
  if (input.onNetwork) return { verdict: "ON_NETWORK", distanceM };
  return { verdict: input.position ? "FAR" : "NO_LOCATION", distanceM };
}

/* ─────────────── الوقت ─────────────── */

/** يومُ الرياض للحظة. */
export function riyadhDay(at: Date): string {
  return todayInRiyadh(at);
}

/** «HH:MM» بتوقيت الرياض. */
export function riyadhClock(at: Date): string {
  return new Date(at.getTime() + RIYADH_OFFSET_MS).toISOString().slice(11, 16);
}

/** لحظةُ بداية الدوام في يومٍ بتوقيت الرياض. */
export function shiftStartAt(day: string, shiftStart: string): Date {
  return new Date(Date.parse(`${day}T${shiftStart}:00Z`) - RIYADH_OFFSET_MS);
}

/** دقائقُ التأخير عن بداية الدوام — صفرٌ إن حضر قبلها. */
export function lateMinutesAt(inAt: Date, day: string, shiftStart: string): number {
  return Math.max(0, Math.floor((inAt.getTime() - shiftStartAt(day, shiftStart).getTime()) / 60_000));
}

/** دقائقُ الانصراف قبل نهاية الدوام — صفرٌ إن انصرف بعدها. */
export function earlyMinutesAt(outAt: Date, day: string, shiftStart: string, shiftMinutes: number): number {
  const end = shiftStartAt(day, shiftStart).getTime() + shiftMinutes * 60_000;
  return Math.max(0, Math.ceil((end - outAt.getTime()) / 60_000));
}

/**
 * أوّلُ يومٍ يُحسب فيه التأخيرُ والانصرافُ المبكّر من تسجيل الحضور (أحمد، ٧ نوفمبر ٢٠٢٦: «اليوم تجريبيّ،
 * من الغد يبدأ»). ما سُجّل قبله يُحفظ ويُعرض ولا يُخصم منه شيء.
 */
export const CHECKIN_COUNTS_FROM = "2026-11-08";

/**
 * سجلُّ أحمد الجعيدي نفسِه (موظّفٌ في المسيّر) يُحسب من أوّل يوم — يجرّب به ما يراه الموظّفون
 * («خلّي صفحتي مفتوحاً فيها الخصم من أوّل»، ٧ نوفمبر ٢٠٢٦).
 */
export const COUNTS_FROM_START: ReadonlySet<string> = new Set(["0bf0a8be-8804-47ed-b0e7-627fdbabe537"]);

/** يُحسب من تسجيل هذا اليوم تأخيرٌ أو انصراف؟ */
export function checkinCounts(day: string, employeeId?: string): boolean {
  return day >= CHECKIN_COUNTS_FROM || (employeeId !== undefined && COUNTS_FROM_START.has(employeeId));
}

/** الانصرافُ يُنسب إلى يوم آخر حضورٍ قبله بعشرين ساعةٍ على الأكثر — دوامُ الليل يعبر منتصفه. */
export const OUT_PAIRS_WITHIN_MS = 20 * 60 * 60 * 1000;

export function dayForOut(outAt: Date, lastIn: { at: Date; day: string } | null): string {
  if (lastIn && outAt.getTime() - lastIn.at.getTime() <= OUT_PAIRS_WITHIN_MS && outAt >= lastIn.at) return lastIn.day;
  return riyadhDay(outAt);
}

/* ─────────────── الدوام: من الساعة كم إلى كم ─────────────── */

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** أطولُ دوامٍ يُقبل — ستّ عشرة ساعة. */
export const MAX_SHIFT_MINUTES = 960;

/** «HH:MM» → دقائق من منتصف الليل، أو `null`. */
export function clockMinutes(hhmm: string): number | null {
  const m = CLOCK.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** نهايةُ الدوام «HH:MM» من بدايته وطوله — ما بعد منتصف الليل يلتفّ: ١٦:٠٠ + ٨ ساعات = ٠٠:٠٠. */
export function shiftEndOf(start: string, minutes: number): string {
  const s = clockMinutes(start) ?? 0;
  const end = (s + minutes) % (24 * 60);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/**
 * طولُ الدوام بالدقائق من بدايته ونهايته — نهايةٌ قبل البداية تعبر منتصف الليل (١٦:٠٠ ← ٠٢:٠٠ عشرُ ساعات).
 * `null`: وقتٌ غير مفهوم، أو نهايةٌ تساوي البداية، أو أقلُّ من ساعة، أو فوق ستّ عشرة.
 */
export function shiftLength(start: string, end: string): number | null {
  const s = clockMinutes(start), e = clockMinutes(end);
  if (s === null || e === null) return null;
  const minutes = (e - s + 24 * 60) % (24 * 60);
  return minutes >= 60 && minutes <= MAX_SHIFT_MINUTES ? minutes : null;
}

/** «4:00 م» · «12:30 ص» — للموظّف، بلا ساعةٍ من أربعٍ وعشرين. */
export function clock12(hhmm: string): string {
  const total = clockMinutes(hhmm);
  if (total === null) return hhmm;
  const h = Math.floor(total / 60), m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
}

/** «4:00 م – 12:00 ص» — الدوامُ كما يُقرأ، أو `null` بلا بداية. */
export function shiftRange(shiftStart: string | null, shiftMinutes: number): string | null {
  return shiftStart ? `${clock12(shiftStart)} – ${clock12(shiftEndOf(shiftStart, shiftMinutes))}` : null;
}

/** «الجمعة والسبت» — أيّامُ الراحة كما تُقرأ، أو `null` بلا راحة. */
export function daysOffLabel(daysOff: string): string | null {
  const days = [...new Set(daysOff.split(""))].filter((d) => /^[0-6]$/.test(d)).sort().map((d) => WEEKDAY_LABEL[Number(d)]);
  return days.length === 0 ? null : days.join(" و");
}

/* ─────────────── الدوامُ المخصَّص: لكلّ يوم وقتُه ─────────────── */

/** سطرُ دوامٍ مخصَّص (099): ليومٍ من الأسبوع أو ليومٍ بعينه. */
export interface ShiftRule {
  id?: string;
  weekday: number | null;
  day: string | null;
  shiftStart: string | null;
  shiftMinutes: number | null;
  off: boolean;
}

export interface BaseShift {
  shiftStart: string | null;
  shiftMinutes: number;
  daysOff: string;
}

/** دوامُ اليوم: راحة، أو من «start» بطوله. `start` فارغٌ: لم يُكتب له وقت (لا يُحسب تأخير). */
export type DayShift = { off: true } | { off: false; start: string | null; minutes: number; source: "DAY" | "WEEKDAY" | "BASE" };

/**
 * أيُّ دوامٍ في هذا اليوم؟ اليومُ بعينه يغلب يومَ الأسبوع، ويومُ الأسبوع يغلب الدوامَ الأصليّ.
 * وراحةُ الأسبوع من `daysOff` — ويومٌ بعينه يجعلها دواماً أو يجعل يومَ العمل راحة.
 */
export function shiftOn(day: string, base: BaseShift, rules: readonly ShiftRule[]): DayShift {
  const exact = rules.find((r) => r.day === day);
  if (exact) return exact.off || !exact.shiftStart || !exact.shiftMinutes ? { off: true } : { off: false, start: exact.shiftStart, minutes: exact.shiftMinutes, source: "DAY" };
  if (!isWorkday(day, base.daysOff)) return { off: true };
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const week = rules.find((r) => r.weekday === weekday && !r.off && r.shiftStart && r.shiftMinutes);
  if (week) return { off: false, start: week.shiftStart, minutes: week.shiftMinutes!, source: "WEEKDAY" };
  return { off: false, start: base.shiftStart, minutes: base.shiftMinutes, source: "BASE" };
}

/** «4:00 م – 12:00 ص» لدوام اليوم، أو `null` (راحة أو بلا وقت). */
export function dayShiftRange(s: DayShift): string | null {
  return s.off ? null : shiftRange(s.start, s.minutes);
}

/** في الجدول وقتٌ مخصَّص لأيّ يوم؟ */
export function hasCustomWeek(rules: readonly ShiftRule[]): boolean {
  return rules.some((r) => r.weekday !== null);
}

/** يومُ عمل؟ — أيّامُ الراحة أرقامٌ (٠ الأحد … ٦ السبت). */
export function isWorkday(day: string, daysOff: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return !daysOff.includes(String(weekday));
}

export const WEEKDAY_LABEL = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;

/** الزرُّ المقترح: انصرافٌ إن كان آخرُ تسجيلٍ حضوراً قريباً، وإلّا حضور. */
export function nextKind(last: { kind: "IN" | "OUT"; at: Date } | null, now: Date): "IN" | "OUT" {
  return last && last.kind === "IN" && now.getTime() - last.at.getTime() < OUT_PAIRS_WITHIN_MS ? "OUT" : "IN";
}

/**
 * دقائقُ العمل من أزواج حضورٍ وانصراف — للجزئيّ. حضورٌ بلا انصرافٍ لا يُحسب (يُقال عددُه).
 * المرفوضُ لا يدخل.
 */
export function workedMinutes(checkins: readonly { kind: "IN" | "OUT"; at: Date; rejected?: boolean }[]): { minutes: number; open: number } {
  const sorted = checkins.filter((c) => !c.rejected).sort((a, b) => a.at.getTime() - b.at.getTime());
  let minutes = 0, open = 0;
  let pending: Date | null = null;
  for (const c of sorted) {
    if (c.kind === "IN") {
      if (pending) open++;
      pending = c.at;
    } else if (pending && c.at.getTime() - pending.getTime() <= OUT_PAIRS_WITHIN_MS) {
      minutes += Math.floor((c.at.getTime() - pending.getTime()) / 60_000);
      pending = null;
    }
  }
  if (pending) open++;
  return { minutes, open };
}

/** عنوانُ الطلب كما تكتبه Vercel — أوّلُ ما في `x-forwarded-for`. */
export function clientIp(headers: Headers): string | null {
  const raw = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || null;
  return raw && raw.length <= 64 ? raw : null;
}
