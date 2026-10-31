/**
 * أرقامُ المستشار — أيّها من دفاترك وأيّها معرفةٌ عامّة.
 *
 * المستشارُ يتكلّم في السوق والتجارب والخطط، فلا يُسقَط جوابُه لرقمٍ عامّ («المقاهي
 * المختصّة بين ٢٥٪ و٣٥٪») كما تُسقَط جملةُ القراءة الشهريّة. بل يُوسَم كلُّ رقم: ما طابق
 * حقيقةً حسبها الخادم في هذا الدور يُقال «من دفاترك» ومعه اسمُها، وما لم يطابق يُقال
 * «عامّ أو تقدير — لم يُحسب من دفاترك». فيرى صاحبُ المقهى أيَّ رقمٍ يبني عليه.
 */
import type { Fact } from "@/lib/finance/reading";
import { numberKey, numberTokens } from "./numbers";

/**
 * أرقامُ الجواب التي طابقت حقيقةً بنوعها: النسبةُ نسبةً، والمبلغُ أو العددُ مبلغاً أو عدداً.
 * مفتاحُها ← اسمُ الحقيقة. وما لم يطابق لا يُذكر — غيابُه من الخريطة هو وسمُه.
 */
/**
 * أهذا الرقمُ قيمةُ الحقيقة؟ أضيقُ من مطابقة القراءة الشهريّة: المستشارُ يكتب افتراضاتٍ
 * عامّة («رسوم شبكة 1٪») فلا يُقبل تقريبُ نسبةٍ صغيرة إلى عددٍ صحيح — ٠٫٧٪ لا تصير «1٪
 * من دفاترك». والمبلغُ بالريال الصحيح كما أُعطي.
 */
function sameValue(n: number, kind: "pct" | "num", f: Fact): boolean {
  if (f.value === null) return false;
  const v = Math.abs(f.value);
  if (kind === "pct") return f.kind === "PCT" && (Math.abs(n - v) < 0.051 || (v >= 5 && n === Math.round(v)));
  return (f.kind === "SAR" || f.kind === "COUNT") && n === v;
}

export function verifiedNumbers(text: string, facts: readonly Fact[]): Record<string, string> {
  const out: Record<string, string> = {};
  /* ما في اسم الحقيقة من عدد («يوم 2026-09-05 (153 طلباً)») حقيقةٌ كذلك — رآه النموذج من الدفاتر */
  const inLabels: Fact[] = facts.flatMap((f) => numberTokens(f.label).filter((t) => t.kind === "num").map((t) => ({ id: f.id, label: f.label, kind: "COUNT" as const, value: t.value })));
  const all = [...facts, ...inLabels];
  for (const t of numberTokens(text)) {
    if (!t.kind) continue;
    const kind = t.kind;
    const fact = all.find((f) => sameValue(t.value, kind, f));
    if (fact) out[numberKey(t.kind, t.value)] = fact.label;
  }
  return out;
}
