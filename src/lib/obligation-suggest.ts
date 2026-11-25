/**
 * وثائقُ تُقترح من مدفوعاتك الحكوميّة — «الالتزامات» مبنيّةٌ وفارغة، والكشفُ يعرف أنّك سدّدت رسومَ
 * البلدية (٣٠ يونيو) والمركز السعوديّ للأعمال (٩ نوفمبر). فيُقترح كلٌّ وثيقةً تُجدَّد بعد سنةٍ من آخر
 * سداد — **تقديرٌ يُقال تقديراً** ويُصحَّح من الشهادة، ولا يُحفظ شيءٌ بلا ضغطة صاحبه.
 *
 * دالّةٌ خالصة. والنوعُ الذي له وثيقةٌ قائمة لا يُقترح.
 */
import type { ObligationKind } from "./obligations";

export interface GovPayment { day: string; amountMinor: number; text: string }

export interface ObligationSuggestion {
  kind: ObligationKind;
  title: string;
  issuer: string;
  /** آخرُ سدادٍ يُبنى عليه التقدير. */
  paidOn: string;
  amountMinor: number;
  /** سنةٌ بعد آخر سداد — تقدير. */
  expiresOn: string;
}

const RULES: readonly { kind: ObligationKind; title: string; issuer: string; match: RegExp }[] = [
  { kind: "MUNICIPAL_LICENCE", title: "رخصة البلدية", issuer: "وزارة الشؤون البلدية", match: /Municipal|بلدي|امان[هة]/i },
  { kind: "COMMERCIAL_REGISTER", title: "السجل التجاري", issuer: "المركز السعودي للأعمال", match: /Saudi\s*Center\s*For\s*Economic|المركز\s*السعودي\s*للاعمال|المركز\s*السعودي\s*للأعمال/i },
];

const plusYear = (day: string) => `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;

export function suggestObligations(payments: readonly GovPayment[], openKinds: ReadonlySet<string>): ObligationSuggestion[] {
  const out: ObligationSuggestion[] = [];
  for (const rule of RULES) {
    if (openKinds.has(rule.kind)) continue;
    const mine = payments.filter((p) => rule.match.test(p.text));
    if (mine.length === 0) continue;
    const last = mine.reduce((a, b) => (b.day > a.day ? b : a)).day;
    /* سداداتُ اليوم نفسه رسومٌ واحدة (البلدية: ٢٥٠ + ٢٥٠) */
    const amountMinor = mine.filter((p) => p.day === last).reduce((s, p) => s + p.amountMinor, 0);
    out.push({ kind: rule.kind, title: rule.title, issuer: rule.issuer, paidOn: last, amountMinor, expiresOn: plusYear(last) });
  }
  return out;
}
