import { balanceWithCredits, type CreditLine } from "./credit-notes";

/**
 * حسابُ المورّد — أصغرُ ما يكفي، ولا دفترَ أستاذ عامّ.
 *
 * كان المستحقّ يُحسَب `المفوتر − المسدَّد` وحدهما. وذلك يصحّ حين يكون
 * كلُّ ما بيننا وبين المورّد فواتيرَ في النظام. والواقع في المقهى غير
 * ذلك: مورّدٌ يعطي كشفاً ولا يعطي فواتير، وآخر يعطي ورقةً باليد،
 * وثالث يُصدر إشعاراً دائناً بمرتجَع. فيقول النظام «لا شيء عليك»
 * ويقول المورّد «عليك ثلاثة آلاف» — ولا موضع في الشاشة يجمع القولين.
 *
 * فهذه بنيةٌ من ثلاثة أطراف لا أكثر:
 *
 *   ما نعرفه     = المفوتر − الإشعارات الدائنة − المسدَّد ± تسويات
 *   ما يقوله هو  = الرصيد الختاميّ في آخر كشفٍ وصل
 *   الفرق        = ما يجب أن يُفسَّر
 *
 * والفرق ليس اتّهاماً: قد يكون فاتورةً حمّلها علينا ولم تصلنا، وقد
 * يكون سداداً لم يصل كشفُه بعد. والمقصود أن يُرى، لا أن يُحسَم.
 *
 * وما لا يُعرَف يبقى `null` — فرصيدٌ لم يُقرأ من كشفٍ ليس صفراً،
 * والصفرُ يقول «لا يطالبنا بشيء» وهي دعوى لا يملكها من لم يقرأ.
 */

export type AccountStatus =
  /** الطرفان متّفقان في حدود التسامح. */
  | "AGREED"
  /** الطرفان مختلفان، والفرق معلوم. */
  | "DIFFERS"
  /** لا كشفَ وصل، أو وصل بلا رصيدٍ مقروء — فلا مقارنة. */
  | "NO_STATEMENT";

export interface SupplierAccount {
  billedMinor: number;
  paidMinor: number;
  creditNoteMinor: number;
  adjustmentMinor: number;
  /** ما نعرفه نحن. */
  knownBalanceMinor: number;
  /** ما يقوله كشفُه — و`null` يعني لم يصل أو لم يُقرأ. */
  reportedBalanceMinor: number | null;
  /** موجبٌ: هو يطالب بأكثر ممّا نعرف. سالبٌ: العكس. */
  differenceMinor: number | null;
  status: AccountStatus;
}

/** يُتسامح بريالٍ — المورّد يُسقط كسور الريال، والمطبوع هو الملزِم. */
export const ACCOUNT_TOLERANCE_MINOR = 100;

export function buildSupplierAccount(input: {
  billedMinor: number;
  paidMinor: number;
  credits?: readonly CreditLine[];
  /** تسوياتٌ يدويّة — موجبها يزيد ما علينا. */
  adjustmentMinor?: number;
  reportedBalanceMinor?: number | null;
}): SupplierAccount {
  const base = balanceWithCredits({
    billedMinor: input.billedMinor,
    paidMinor: input.paidMinor,
    credits: input.credits ?? [],
  });

  const adjustmentMinor = input.adjustmentMinor ?? 0;

  /*
    ولا يُقصّ عند الصفر هنا.

    `balanceWithCredits` تقصّ لأنّها تجيب «كم عليك» — والدَّين لا يكون
    سالباً. وهذه تجيب «ما الفرق بين قولينا»، ورصيدٌ سالب خبرٌ صحيح:
    دفعنا له أكثر ممّا فوتر، وذلك يستحقّ أن يُرى لا أن يُصفَّر.
  */
  const knownBalanceMinor =
    input.billedMinor - base.creditNoteMinor - input.paidMinor + adjustmentMinor;

  const reported = input.reportedBalanceMinor ?? null;
  const differenceMinor = reported === null ? null : reported - knownBalanceMinor;

  const status: AccountStatus =
    differenceMinor === null
      ? "NO_STATEMENT"
      : Math.abs(differenceMinor) <= ACCOUNT_TOLERANCE_MINOR
        ? "AGREED"
        : "DIFFERS";

  return {
    billedMinor: input.billedMinor,
    paidMinor: input.paidMinor,
    creditNoteMinor: base.creditNoteMinor,
    adjustmentMinor,
    knownBalanceMinor,
    reportedBalanceMinor: reported,
    differenceMinor,
    status,
  };
}

/** جملةٌ تصف الحال — تُقرأ ولا تحتاج جدولاً. */
export function describeAccount(a: SupplierAccount): string {
  if (a.status === "NO_STATEMENT") {
    return "لم يصل كشفٌ منه بعد — فلا مقارنة، وما نعرفه من فواتيرنا وحدها";
  }
  if (a.status === "AGREED") return "كشفُه يوافق ما عندنا";
  return a.differenceMinor! > 0
    ? "يطالب بأكثر ممّا نعرف — فاتورةٌ حمّلها علينا ولم تصلنا، أو سدادٌ لم يُسجَّل عندنا"
    : "نعرف أكثر ممّا يطالب — سدادٌ لم يصل كشفُه بعد، أو إشعارٌ دائن لم نقيّده";
}
