/**
 * معادلة الكشف: **الرصيد الافتتاحي + الوارد − الصادر = الرصيد الختامي.**
 *
 * هذه هي التسوية. وما كان النظام يفعله قبلها ليس تسويةً بل مطابقةَ
 * حركات: يقول «طوبقت ٣٠١ حركة من ٣١٨» ولا يقول هل يساوي مجموعُها ما
 * يقوله البنك. والفرق بين القولين هو الفرق بين «عملتُ كثيراً» و«الحساب
 * مضبوط».
 *
 * ومن غيرها تمرّ ثلاثة أخطاء صامتة:
 *   • حركةٌ لم تُقرأ من الملفّ أصلاً — لا تُطابَق ولا تُعدّ ناقصة، لأنّ
 *     الغائب لا يُرى.
 *   • حركةٌ قُرئت بمبلغٍ خطأ — تُطابَق وتُقفَل، والفرق يبقى في الرصيد.
 *   • كشفٌ ناقص أوّله أو آخره — يبدو تامّاً لأنّ ما فيه متّسق مع نفسه.
 *
 * والمعادلة تكشف الثلاثة بعددٍ واحد: الفرق غير المفسَّر.
 *
 * **والمجهول ليس صفراً.** كشفٌ لا يحمل رصيده الافتتاحي لا يُفترَض أنّه
 * بدأ من صفر — يُعلَن أنّه غير معروف، وتبقى المعادلة غير قابلة للفحص.
 * افتراضُ الصفر هنا يخترع فرقاً بحجم الرصيد كلِّه.
 */

export type BalanceStatus =
  /** المعادلة صحيحة تماماً. */
  | "BALANCED"
  /** فرقٌ داخل حدّ التسامح — كسورُ هللةٍ في تصديرٍ لا أكثر. */
  | "WITHIN_TOLERANCE"
  /** فرقٌ حقيقيّ يجب أن يُفسَّر قبل الإقفال. */
  | "UNEXPLAINED"
  /** الأرصدة غير معروفة — لا يُحكَم. */
  | "UNKNOWN";

/**
 * حدّ التسامح: هللةٌ واحدة.
 *
 * لا أكثر — الفرق في الرصيد ليس تقريبَ ضريبةٍ على سطر، بل مالٌ نُقص أو
 * زيد. وكل هللةٍ فوق ذلك سؤالٌ مشروع.
 */
export const BALANCE_TOLERANCE_MINOR = 1;

export interface BalanceInput {
  /** رصيد أوّل المدّة كما يقوله البنك — `null` إن لم يُقرأ. */
  openingMinor: number | null;
  /** رصيد آخر المدّة كما يقوله البنك — `null` إن لم يُقرأ. */
  closingMinor: number | null;
  /** مجموع الوارد في الفترة. */
  creditsMinor: number;
  /** مجموع الصادر في الفترة. */
  debitsMinor: number;
}

export interface BalanceResult {
  status: BalanceStatus;
  /** الرصيد الذي تقتضيه الحركات المقروءة. */
  computedClosingMinor: number | null;
  /** المقروء ناقصاً المحسوب — موجبٌ يعني حركاتٍ واردة لم تُقرأ. */
  differenceMinor: number | null;
  reason: string;
}

/**
 * يفحص المعادلة على فترةٍ واحدة لحسابٍ واحد.
 *
 * ولا يُصلح شيئاً: يقول ما الحال. الإصلاح قرارُ إنسان لأنّ سببه قد
 * يكون ملفّاً ناقصاً أو قراءةً خاطئة أو حركةً لم يسجّلها البنك بعد.
 */
export function checkBalance(input: BalanceInput): BalanceResult {
  if (input.openingMinor === null || input.closingMinor === null) {
    return {
      status: "UNKNOWN",
      computedClosingMinor: null,
      differenceMinor: null,
      reason:
        input.openingMinor === null && input.closingMinor === null
          ? "الكشف لا يحمل رصيداً افتتاحياً ولا ختامياً — لا تُفحَص المعادلة"
          : input.openingMinor === null
            ? "الرصيد الافتتاحي غير معروف — والصفر ليس بديلاً عنه"
            : "الرصيد الختامي غير معروف — والصفر ليس بديلاً عنه",
    };
  }

  const computed = input.openingMinor + input.creditsMinor - input.debitsMinor;
  const difference = input.closingMinor - computed;
  const abs = Math.abs(difference);

  if (difference === 0) {
    return {
      status: "BALANCED",
      computedClosingMinor: computed,
      differenceMinor: 0,
      reason: "الافتتاحي والحركات يعطيان الختامي بالضبط",
    };
  }

  if (abs <= BALANCE_TOLERANCE_MINOR) {
    return {
      status: "WITHIN_TOLERANCE",
      computedClosingMinor: computed,
      differenceMinor: difference,
      reason: `فرق ${abs} هللة — كسرُ تصديرٍ لا نقصُ حركة`,
    };
  }

  return {
    status: "UNEXPLAINED",
    computedClosingMinor: computed,
    differenceMinor: difference,
    reason:
      difference > 0
        ? `البنك يقول رصيداً أعلى بـ${riyals(abs)} — حركاتٌ واردة لم تُقرأ`
        : `البنك يقول رصيداً أقلّ بـ${riyals(abs)} — حركاتٌ صادرة لم تُقرأ`,
  };
}

/** حالة الحركة عند التسوية: أهي مفسَّرة أم لا. */
export interface ExplainedInput {
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  /** مفسَّرة: طُوبقت بفاتورة، أو صُنّفت باباً معروفاً وأُقرّت. */
  explained: boolean;
}

export interface AccountReconciliation {
  balance: BalanceResult;
  totalCount: number;
  explainedCount: number;
  unexplainedCount: number;
  /** مالٌ في الحساب لا يُعرف ما هو — وهو الرقم الذي يهمّ. */
  unexplainedMinor: number;
  creditsMinor: number;
  debitsMinor: number;
  /** أَتَمَّ الحسابُ تسويتَه؟ لا تكفي المطابقة وحدها: المعادلة شرط. */
  reconciled: boolean;
}

/**
 * تسوية حسابٍ لفترة: المعادلة أوّلاً، ثمّ ما لم يُفسَّر من حركاته.
 *
 * وترتيب الشرطين مقصود: حسابٌ طُوبقت كل حركاته ومعادلتُه مختلّة **ليس
 * مسوّى** — لأنّ الاختلال يعني أنّ في الكشف حركاتٍ لم تصل إلينا أصلاً،
 * فالمطابقة تامّة على ناقص.
 */
export function reconcileAccount(
  rows: readonly ExplainedInput[],
  balances: { openingMinor: number | null; closingMinor: number | null },
): AccountReconciliation {
  let creditsMinor = 0;
  let debitsMinor = 0;
  let explainedCount = 0;
  let unexplainedMinor = 0;

  for (const r of rows) {
    if (r.direction === "CREDIT") creditsMinor += r.amountMinor;
    else debitsMinor += r.amountMinor;

    if (r.explained) explainedCount++;
    else unexplainedMinor += r.amountMinor;
  }

  const balance = checkBalance({
    openingMinor: balances.openingMinor,
    closingMinor: balances.closingMinor,
    creditsMinor,
    debitsMinor,
  });

  return {
    balance,
    totalCount: rows.length,
    explainedCount,
    unexplainedCount: rows.length - explainedCount,
    unexplainedMinor,
    creditsMinor,
    debitsMinor,
    reconciled:
      explainedCount === rows.length &&
      (balance.status === "BALANCED" || balance.status === "WITHIN_TOLERANCE"),
  };
}

function riyals(minor: number): string {
  return `${(minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ريال`;
}

/** جملةٌ عربية تصف الحال — تُعرَض كما هي. */
export function describeReconciliation(r: AccountReconciliation): string {
  if (r.balance.status === "UNKNOWN") {
    return `${r.explainedCount} من ${r.totalCount} حركة مفسَّرة — والمعادلة لا تُفحَص: ${r.balance.reason}`;
  }
  if (r.reconciled) return `الحساب مسوّى: ${r.totalCount} حركة، والمعادلة صحيحة`;
  if (r.balance.status === "UNEXPLAINED") return r.balance.reason;
  return `${r.unexplainedCount} حركة بلا تفسير، قيمتها ${riyals(r.unexplainedMinor)}`;
}
