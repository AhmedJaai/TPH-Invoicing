import { normalizeText } from "./canonical";

/**
 * الفاتورة الواحدة سُدّدت مرّتين.
 *
 * وهذه غير التكرار الذي يعالجه `dedupe`. ذاك **ملفٌّ دخل مرّتين**: صفّان
 * في القاعدة عن حركةٍ واحدة، والمال خرج مرّةً. وهذا **مالٌ خرج مرّتين**:
 * حركتان حقيقيّتان لجهةٍ واحدة بنفس المبلغ في اليوم نفسه، لكلٍّ منهما
 * مرجعُ سدادٍ مستقلّ. والأولى تُصلَح في قاعدتنا، والثانية تُطالَب بها
 * الجهةُ ويُسترَدّ المال.
 *
 * ووُجدت في مراجعة أحمد لا في النظام: **٢٬٣٥٠٫٧٧ ريالاً** في يومٍ واحد —
 * ١٥ يوليو ٢٠٢٦ — كهرباءُ عدّادَين واتصالات، كلٌّ منها مرّتين بمرجعَي
 * سدادٍ مختلفين. ولم يرها النظام لسببين، كلاهما عطب:
 *
 *   ١. `findDuplicatePayments` كانت تتخطّى كلّ بابٍ غير «مورّد» — وبابا
 *      المرافق والحكومة هما بالضبط حيث يقع السدادُ المزدوج، لأنّ
 *      السدادَ فيهما بضغطةٍ في التطبيق تُعاد حين لا يظهر التأكيد.
 *   ٢. وكانت تُحسَب لحظةَ الاستيراد وتُعرَض في نتيجته، فتضيع بإغلاقها.
 *      و`duplicatePayments` في «ما يحتاج انتباهك» كانت **صفراً مكتوباً
 *      بيد** — لا محسوباً. والصفرُ المكتوب يقول «لا تكرار» وهي دعوى.
 *
 * والفرق بين الحالتين يُقرأ من مرجع العمليّة: مرجعان مختلفان لعمليّتين،
 * ومرجعٌ واحد (أو غيابُه في الطرفين) احتمالُ نسخة.
 */

/**
 * أبوابٌ يتكرّر فيها المبلغ نفسه في اليوم نفسه **عادةً لا خطأً**.
 *
 * رسمُ القناة الرقميّة يقع مع كلّ حوالة، وقد تخرج خمسٌ في يوم؛ ورسمُ
 * الشبكة وضريبتُه يقعان مع كلّ دفعةِ تسوية. فعدُّ هذه تكراراً يُغرق
 * الشاشة بستّ عشرة مجموعةً صحيحة، ويُخفي الثلاثةَ التي تهمّ.
 */
const REPEATS_NORMALLY = new Set([
  "BANK_FEE", "BANK_VAT", "POS_FEE", "POS_VAT", "POS_SETTLEMENT",
]);

/**
 * الحدّ الأدنى — ريالان.
 *
 * ما دونهما رسومٌ صغيرة تتكرّر بطبيعتها، واستردادُها لا يساوي وقت
 * المطالبة. والحدُّ مُعلَن كي لا يُظنّ أنّ النظام يفحص كلّ هللة.
 */
export const DOUBLE_PAID_FLOOR_MINOR = 200;

export interface DoublePaidTx {
  id: string;
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description: string | null;
  beneficiaryRaw: string | null;
  category: string;
  /** مرجعُ العمليّة إن عُرف — ومرجعان مختلفان يعنيان عمليّتين. */
  operationRef: string | null;
}

export interface DoublePaidGroup {
  /** اليوم الذي خرج فيه المال مرّتين. */
  day: string;
  payee: string;
  amountMinor: number;
  category: string;
  transactions: DoublePaidTx[];
  /** ما زاد عن الحاجة — أي ما قد يُسترَدّ. */
  excessMinor: number;
  /**
   * مرجعان مختلفان ← عمليّتان قطعاً.
   * وإلّا فالاحتمال قائمٌ أن يكون الصفّان نسخةَ استيرادٍ لا سداداً ثانياً.
   */
  distinctOperations: boolean;
}

/**
 * هويّةُ الجهة لغرض هذا الفحص وحده.
 *
 * ولا تُبنى على `beneficiary_raw` وحده: هو فارغٌ في سداد «سداد» كلِّه —
 * والكهرباءُ والاتصالاتُ تُدفَع به. فيُؤخذ رقمُ المشترك حين يُذكَر
 * («رقم السداد…») لأنّه يفصل عدّاداً عن عدّاد، ثمّ صدرُ الوصف الموحَّد.
 *
 * ورقمُ **مرجع** السداد لا يدخل الهويّة — هو يختلف بين السدادين وهو
 * بالضبط ما يُثبت أنّهما اثنان.
 */
export function payeeKey(tx: DoublePaidTx): string {
  const text = normalizeText(`${tx.description ?? ""} ${tx.beneficiaryRaw ?? ""}`);
  const subscriber = /رقم\s*السداد\s*(\d{6,})/.exec(text);
  if (subscriber) return `SADAD:${subscriber[1]}`;

  const name = normalizeText(tx.beneficiaryRaw ?? "");
  if (name.length >= 4) return `NAME:${name.slice(0, 40)}`;

  return `TEXT:${text.replace(/\d+/g, "").trim().slice(0, 40)}`;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * يجمع ما خرج مرّتين لجهةٍ واحدة بمبلغٍ واحد في يومٍ واحد.
 *
 * ولا يحذف ولا يقترح حذفاً: النتيجةُ مطالبةٌ بالردّ من الجهة، لا تعديلٌ
 * في قيدنا. فالمال خرج فعلاً، والكشفُ يقول ذلك بصدق.
 */
export function findDoublePaid(
  transactions: readonly DoublePaidTx[],
): DoublePaidGroup[] {
  const groups = new Map<string, DoublePaidTx[]>();

  for (const tx of transactions) {
    if (tx.direction !== "DEBIT") continue;
    if (REPEATS_NORMALLY.has(tx.category)) continue;
    if (tx.amountMinor < DOUBLE_PAID_FLOOR_MINOR) continue;

    const key = `${dayOf(tx.valueDate)}|${tx.amountMinor}|${payeeKey(tx)}`;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const out: DoublePaidGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const refs = new Set(list.map((t) => t.operationRef).filter((r): r is string => Boolean(r)));

    out.push({
      day: key.slice(0, 10),
      payee: list[0].beneficiaryRaw?.trim()
        || (list[0].description ?? "").trim().slice(0, 40)
        || "جهة غير مسمّاة",
      amountMinor: list[0].amountMinor,
      category: list[0].category,
      transactions: list,
      /* ما زاد عن مرّةٍ واحدة — لا المجموع كلّه */
      excessMinor: list[0].amountMinor * (list.length - 1),
      distinctOperations: refs.size === list.length,
    });
  }

  /* بالمال لا بالتاريخ — ما يزن أكثر يُطالَب به أوّلاً */
  return out.sort((a, b) => b.excessMinor - a.excessMinor);
}

/** مجموعُ ما قد يُسترَدّ. */
export function recoverableMinor(groups: readonly DoublePaidGroup[]): number {
  return groups.reduce((sum, g) => sum + g.excessMinor, 0);
}
