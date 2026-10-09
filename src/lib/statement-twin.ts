/**
 * أهذا الكشفُ مقيَّدٌ من قبل بملفٍّ آخر؟
 *
 * الفرادةُ في القاعدة على المستند وحده، فالكشفُ نفسُه بملفَّين مختلفَي البصمة
 * (صورةٌ و PDF) يُقيَّد مرّتين وتتضاعف أسطرُه في المقارنة. والهويّةُ هنا المورّدُ
 * ومدّتُه (أوّلُ يومٍ وآخرُه) ورصيدُه الختاميّ.
 *
 * **كشفٌ لا قيد**: لا يُمنَع القيد ولا يُحذف شيء — يُنبَّه ويقرّر الإنسان. ورصيدٌ
 * لم يُقرأ في أحدهما لا ينفي التشابه (المجهولُ ليس صفراً ولا اختلافاً)، ورصيدان
 * مقروءان مختلفان كشفان.
 */
export interface StatementIdentity {
  id: string;
  /** YYYY-MM-DD */
  periodStart: string;
  periodEnd: string;
  closingBalanceMinor: number | null;
}

export function findStatementTwin<T extends StatementIdentity>(
  recorded: readonly T[],
  candidate: Omit<StatementIdentity, "id"> & { id?: string },
): T | null {
  return recorded.find((r) =>
    r.id !== candidate.id
    && r.periodStart === candidate.periodStart
    && r.periodEnd === candidate.periodEnd
    && (r.closingBalanceMinor === null || candidate.closingBalanceMinor === null
      || r.closingBalanceMinor === candidate.closingBalanceMinor)) ?? null;
}
