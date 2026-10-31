/**
 * فترةُ الخصم — ما يُحسم من راتب الشهر وقع بين ٢٧ الشهر الذي قبله و٢٦ منه.
 *
 * قرارُ أحمد (١ نوفمبر ٢٠٢٦): «توزّع الرواتب يوم ٢٧، وأيّ خصمٍ يُرحَّل للشهر الذي بعده —
 * من ٢٧ أكتوبر إلى ٢٦ نوفمبر تقع الخصومات وتُخصم من راتب ٢٧ نوفمبر». فالراتبُ يخرج يومَ ٢٧
 * وقد عُرف كلُّ ما يُحسم منه، وما وقع بعده يومئذٍ لراتب الشهر القادم.
 * والإضافاتُ والسلفُ والقيودُ اليدويّة بشهرها كما تُكتب — الفترةُ لما يُعرف بيومه (حضورٌ ومخالفة).
 */
import { addDays } from "@/lib/riyadh-time";

/** يومُ صرف الرواتب. */
export const PAYDAY = 27;

export interface DeductionPeriod {
  /** أوّلُ يوم — ٢٧ الشهر السابق. */
  from: string;
  /** آخرُ يوم — ٢٦ الشهر نفسه. */
  to: string;
}

export function deductionPeriod(month: string): DeductionPeriod {
  const to = `${month}-${String(PAYDAY - 1).padStart(2, "0")}`;
  const from = addDays(`${month}-01`, -1).slice(0, 7) + `-${String(PAYDAY).padStart(2, "0")}`;
  return { from, to };
}

export function inDeductionPeriod(day: string, month: string): boolean {
  const p = deductionPeriod(month);
  return day >= p.from && day <= p.to;
}

/** أيُّ راتبٍ يُحسم منه ما وقع في هذا اليوم: من ٢٧ فصاعداً لراتب الشهر القادم. */
export function deductionMonthOf(day: string): string {
  if (Number(day.slice(8, 10)) < PAYDAY) return day.slice(0, 7);
  return addDays(`${day.slice(0, 7)}-28`, 7).slice(0, 7);
}
