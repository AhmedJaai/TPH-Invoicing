/**
 * ملفُّ فاتورةٍ قُيِّدت من كشف المورّد بلا ملفّ (057) — يصل وشهرُها مقفل.
 *
 * التبنّي الكامل يكتب الصافي والضريبة والتاريخ من الملفّ، والشهرُ المقفل شهادةٌ لا
 * تُعدَّل أرقامُها. لكنّ ربطَ الملفّ بقيده لا يغيّر رقماً: الفاتورةُ بمبلغها، وصار لها
 * أصلٌ في الدرايف. فيُربط الملفّ وحده — ما دام إجماليُّه إجماليَّ القيد. وإن خالفه
 * فذلك خبرٌ لا يُبتلَع: الشهرُ يُفتح ويُصحَّح بيد صاحبه.
 *
 * خالصة.
 */
import { formatRiyalsDisplay, TOTAL_ROUNDING_TOLERANCE_MINOR } from "./money";

export type ClosedMonthAdoption = { ok: true } | { ok: false; message: string };

export function adoptionInClosedMonth(input: {
  month: string;
  invoiceNumber: string;
  recordedTotalMinor: number;
  /** إجماليُّ الملفّ كما أقرّه الإنسان — الفراغُ: لم يُقرأ، فلا خلافَ يُدّعى */
  fileTotalMinor: number | null;
}): ClosedMonthAdoption {
  if (input.fileTotalMinor === null) return { ok: true };
  if (Math.abs(input.fileTotalMinor - input.recordedTotalMinor) <= TOTAL_ROUNDING_TOLERANCE_MINOR) return { ok: true };
  return {
    ok: false,
    message: `فاتورة ${input.invoiceNumber} مسجّلة من كشف المورّد بمبلغ ${formatRiyalsDisplay(input.recordedTotalMinor)} في شهر ${input.month} المقفل، والملف يقول ${formatRiyalsDisplay(input.fileTotalMinor)}. أعد فتح الشهر لتصحّح المبلغ، أو راجع الإجمالي المكتوب.`,
  };
}
