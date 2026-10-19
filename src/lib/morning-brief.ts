/**
 * إحاطةُ الصباح نصّاً — تُلصَق في واتساب لشريكٍ أو محاسبٍ بلا حساب.
 *
 * من الأرقام نفسها التي على «اليوم» (لا حسابَ ثانٍ)، وبقاعدتها: **المجهولُ يُقال
 * «غير معروف» ولا يُكتب صفراً**، وما صفرُه معلومٌ يُقال جملةً لا «0.00».
 */
import { ITEM, SUPPLIER, countNoun } from "./arabic";
import { formatRiyalsDisplay } from "./money";

export interface BriefFacts {
  /** «الخميس 9 أكتوبر 2026». */
  dateLabel: string;
  /** القاعدةُ لا تعرف شيئاً بعد — لا تُقال أرقام. */
  knowsNothing: boolean;
  owedMinor: number;
  owedSuppliers: number;
  /** ما يخرج في الأيّام السبعة القادمة — `null` لمن لا يراه أو لم يُحسَب. */
  weekMinor: number | null;
  /** آخرُ رصيدٍ معروف — `null` مجهول، و`undefined` لمن لا يرى البنك (لا يُذكَر). */
  balanceMinor: number | null | undefined;
  pending: number;
}

export function buildBrief(f: BriefFacts): string {
  const head = `ذا بوبليك هاوس: ${f.dateLabel}`;
  if (f.knowsNothing) return `${head} لم يقرأ النظام بعد أي مستند أو كشف، فلا أرقام لعرضها.`;
  const lines = [
    head,
    f.owedMinor > 0
      ? `• عليك للمورّدين ${formatRiyalsDisplay(f.owedMinor)} ريال (${countNoun(f.owedSuppliers, SUPPLIER)})`
      : "• لا مبالغ مستحقة للمورّدين الآن",
    f.weekMinor === null ? null
      : f.weekMinor > 0 ? `• يخرج هذا الأسبوع ${formatRiyalsDisplay(f.weekMinor)} ريال` : "• لا مبالغ معروفة ستخرج هذا الأسبوع",
    f.balanceMinor === undefined ? null
      : f.balanceMinor === null ? "• رصيد البنك غير معروف" : `• آخر رصيد معروف ${formatRiyalsDisplay(f.balanceMinor)} ريال`,
    f.pending > 0 ? `• ينتظر قرارك ${countNoun(f.pending, ITEM)}` : "• لا شيء ينتظر قرارك",
  ];
  return lines.filter(Boolean).join("\n");
}
