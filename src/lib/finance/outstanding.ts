/**
 * «الربح بعد كلّ ما عليك» لشهرٍ لم يُقفل (أحمد، ٢٣ نوفمبر ٢٠٢٦: «ابغى يكون في اضافة تحت تشمل الربح
 * بعد كامل المصروفات حتى اللي لسا باقي ما اندفعت مثل الفواتير و الرواتب»).
 *
 * الربحُ في «المالية» يحسب المشتريات بتاريخ الفاتورة — المدفوعةُ وغيرها سواء — لكنّه يحسب الرواتب
 * والفواتيرَ الدوريّة (اتصالات، كهرباء) حين تخرج من البنك. فقبل يوم الرواتب يبدو الشهرُ أربحَ ممّا هو.
 * فيُطرح هنا:
 *
 * - **رواتبُ الشهر الباقية** من المسيّر (`loadPayrollDues`) — بعد خصم حوالاتِ رواتبٍ خرجت ولم توزَّع
 *   (محسوبةٌ في الربح أصلاً)، ومن لا راتبَ مكتوبٌ له يُقال ولا يُحسب.
 * - **خصمٌ شهريّ معتاد لم يأتِ بعد** في الشهر الجاري وحده، بمبلغه المعتاد — **تقديرٌ** يُسمّى كذلك.
 *   والرواتبُ والإيجارُ خارجه: الأولى من المسيّر، والثاني محسوبٌ في الربح كلَّ شهر.
 *
 * والفواتيرُ غيرُ المسدَّدة تُذكر بعددها ومبلغها **ولا تُطرح**: محسوبةٌ في المشتريات من يوم قيدها.
 *
 * دالّةٌ خالصة. المالُ هللات، والمجهولُ `null`.
 */
import { addDays, monthEndDay } from "../riyadh-time";

/** خصمٌ لم يأتِ منذ هذا القدر انقطع غالباً — لا يُقدَّر. */
export const RECURRING_ACTIVE_DAYS = 45;
const SKIP_RECURRING = new Set(["SALARY", "RENT"]);

export interface OutstandingSeries {
  key: string;
  label: string;
  category: string;
  usualMinor: number;
  lastDay: string;
  dayOfMonth: number | null;
  chargeDays: readonly string[];
}

export interface OutstandingInput {
  month: string;
  today: string;
  profitMinor: number | null;
  /** `null`: المسيّرُ لم يُقرأ — فلا يُقال عن الرواتب شيء. */
  payroll: { owedMinor: number; people: number; unknownPeople: number; undistributedMinor: number } | null;
  recurring: readonly OutstandingSeries[];
  unpaidInvoices: { count: number; openMinor: number };
}

export interface OutstandingLine {
  id: string;
  label: string;
  note: string | null;
  amountMinor: number;
  estimate: boolean;
}

export interface OutstandingView {
  lines: OutstandingLine[];
  /** ما يُطرح كلُّه. */
  totalMinor: number;
  profitAfterMinor: number | null;
  /** موظّفون بلا راتبٍ مكتوب — فالرقمُ أكبرُ من الحقيقة بقدرهم. */
  unknownPeople: number;
  unpaidInvoices: { count: number; openMinor: number };
}

export function buildOutstanding(i: OutstandingInput): OutstandingView {
  const lines: OutstandingLine[] = [];
  if (i.payroll && i.payroll.owedMinor > 0) {
    lines.push({
      id: "payroll",
      label: "رواتب الشهر الباقية",
      note: i.payroll.undistributedMinor > 0 ? "بعد خصم حوالات رواتب خرجت ولم توزَّع على موظف، فهي محسوبة في الربح" : null,
      amountMinor: i.payroll.owedMinor,
      estimate: false,
    });
  }

  const monthStart = `${i.month}-01`;
  const current = i.today.slice(0, 7) === i.month;
  if (current) {
    const activeSince = addDays(monthStart, -RECURRING_ACTIVE_DAYS);
    for (const s of i.recurring) {
      if (SKIP_RECURRING.has(s.category) || s.usualMinor <= 0) continue;
      if (s.lastDay < activeSince) continue;
      if (s.chargeDays.some((d) => d >= monthStart && d <= monthEndDay(i.month))) continue;
      lines.push({
        id: `recurring-${s.key}`,
        label: s.label.trim(),
        note: s.dayOfMonth ? `يُخصم عادةً قرب يوم ${s.dayOfMonth}، ولم يُخصم هذا الشهر بعد` : "يُخصم كل شهر، ولم يُخصم هذا الشهر بعد",
        amountMinor: s.usualMinor,
        estimate: true,
      });
    }
  }

  const totalMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  return {
    lines,
    totalMinor,
    profitAfterMinor: i.profitMinor === null ? null : i.profitMinor - totalMinor,
    unknownPeople: i.payroll?.unknownPeople ?? 0,
    unpaidInvoices: i.unpaidInvoices,
  };
}
