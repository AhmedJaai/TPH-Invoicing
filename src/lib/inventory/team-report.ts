/**
 * تقريرُ جرد السبت نصّاً — يُرسله الموظّفُ من «TPH Team» واتساب للإدارة (أحمد، ٨ نوفمبر ٢٠٢٦:
 * «بعدها يطبع تقرير ويرسله ليّ واتس»). يُبنى في الخادم مما حُفظ، لا ممّا في الشاشة: ما يصل
 * المالكَ هو ما في الجرد نفسه.
 */
import { PRODUCT, countNoun } from "../arabic";

export interface ReportLine {
  name: string;
  categoryLabel: string;
  /** المسجَّلُ نصّاً بوحدته، أو `null` لم يُعَدّ. */
  counted: string | null;
}

/** «السبت ٧ نوفمبر» — بلا `toLocaleDateString` كي يطابق الخادمُ والاختبار. */
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
function day(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function teamCountReport(input: { week: { start: string; end: string }; by: string; lines: readonly ReportLine[] }): string {
  const counted = input.lines.filter((l) => l.counted !== null);
  const missing = input.lines.filter((l) => l.counted === null);
  const out = [
    `جرد السبت — أسبوع ${day(input.week.start)} إلى ${day(input.week.end)}`,
    `عدّه: ${input.by}`,
    `عُدّ ${counted.length} من ${countNoun(input.lines.length, PRODUCT)}`,
  ];
  let group: string | null = null;
  for (const l of counted) {
    if (l.categoryLabel !== group) { group = l.categoryLabel; out.push("", `*${group}*`); }
    out.push(`• ${l.name}: ${l.counted}`);
  }
  if (missing.length > 0) {
    out.push("", `*لم يُعَدّ (${missing.length})*`, ...missing.map((l) => `• ${l.name}`));
  }
  return out.join("\n");
}

/**
 * رقمُ واتساب بصيغته الدوليّة أرقاماً — «0551234567» و«+966 55 123 4567» و«00966…» كلُّها
 * «966551234567». و`null` لما لا يُقرأ رقماً.
 */
export function whatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("05")) d = `966${d.slice(1)}`;
  else if (d.length === 9 && d.startsWith("5")) d = `966${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
