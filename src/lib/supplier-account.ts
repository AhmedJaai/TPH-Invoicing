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
  | "NO_STATEMENT"
  /**
   * لا نعرف شيئاً أصلاً: لا فاتورة ولا سداد ولا كشف.
   *
   * وهذه **ليست صفراً**. الصفر يقول «لا شيء عليك له» — دعوى. ومورّدو
   * المقهى فيهم من يعطي ورقةً باليد ومن لا يعطي شيئاً، فغيابُ الفاتورة
   * عندنا غيابُ علمٍ لا غيابُ دَين.
   */
  | "UNKNOWN";

export interface SupplierAccount {
  billedMinor: number;
  paidMinor: number;
  creditNoteMinor: number;
  adjustmentMinor: number;
  /** ما نعرفه نحن — و`null` حين لا مستند لدينا أصلاً. */
  knownBalanceMinor: number | null;
  /** ما يقوله كشفُه — و`null` يعني لم يصل أو لم يُقرأ. */
  reportedBalanceMinor: number | null;
  /** موجبٌ: هو يطالب بأكثر ممّا نعرف. سالبٌ: العكس. */
  differenceMinor: number | null;
  /**
   * ما خُصّص من دفعاتٍ بعد تاريخ الكشف على فواتير سبقته — و`null` بلا كشف.
   * يُعرَض بجانب الفرق: المالُ نفسه يبدو «مفتوحاً» عند الكشف ومسدَّداً اليوم.
   */
  allocatedAfterStatementMinor: number | null;
  /** تفسيرٌ يُثبته الحساب لا يُخمَّن — و`null` حين لا تفسير. */
  explanation: AccountExplanation | null;
  status: AccountStatus;
}

export type AccountExplanation =
  /** الفرق يساوي ما خُصّص بعد تاريخ الكشف على فواتير سبقته. */
  | { kind: "ALLOCATED_AFTER_STATEMENT" }
  /** رصيدُ كشفه يساوي فاتورةً عندنا سابقةً له — فهي لم تغب. */
  | { kind: "INVOICE_ON_FILE"; invoiceNumber: string };

/** يُتسامح بريالٍ — المورّد يُسقط كسور الريال، والمطبوع هو الملزِم. */
export const ACCOUNT_TOLERANCE_MINOR = 100;

export function buildSupplierAccount(input: {
  billedMinor: number;
  paidMinor: number;
  credits?: readonly CreditLine[];
  /** تسوياتٌ يدويّة — موجبها يزيد ما علينا. */
  adjustmentMinor?: number;
  reportedBalanceMinor?: number | null;
  /** ما خُصّص من دفعاتٍ بعد تاريخ الكشف على فواتير تاريخُها قبله. */
  allocatedAfterStatementMinor?: number | null;
  /** فواتيرُنا التي تاريخُها حتى تاريخ الكشف — بها يُعرَف أغائبةٌ فاتورتُه أم عندنا. */
  invoicesAtStatement?: readonly { invoiceNumber: string; totalMinor: number }[];
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

  /*
    ولا شيء عندنا يُبنى عليه رقم.

    مورّدٌ بلا فاتورةٍ ولا سدادٍ ولا تسوية: رصيدُه عندنا **مجهول** لا
    صفر. وقياسُه على بيانات أحمد أظهر ستّة موردين كذلك، كانوا يُعرَضون
    «نعرف 0.00» — وهي جملةٌ تقول «لا شيء عليك له»، ونحن لا نعرف.
  */
  const nothingKnown =
    input.billedMinor === 0 && input.paidMinor === 0
    && base.creditNoteMinor === 0 && adjustmentMinor === 0;

  const known = nothingKnown ? null : knownBalanceMinor;
  const differenceMinor =
    reported === null || known === null ? null : reported - known;

  const status: AccountStatus =
    known === null && reported === null
      ? "UNKNOWN"
      : differenceMinor === null
        ? "NO_STATEMENT"
        : Math.abs(differenceMinor) <= ACCOUNT_TOLERANCE_MINOR
          ? "AGREED"
          : "DIFFERS";

  const allocatedAfterStatementMinor =
    reported === null ? null : Math.max(0, input.allocatedAfterStatementMinor ?? 0);

  /*
    ── «فاتورةٌ لم تصلنا» دعوى تُنفى بالحساب قبل أن تُكتب ──

    الكوب الذهبي: نعرف ٥٬٨٥٤٫٣٨ ويقول كشفُه ١٢٬٠٠٣٫١٣، فكتبت الصفحة
    «فاتورةٌ حمّلها علينا ولم تصلنا» — وصفحةُ المستحقّ نفسها تقول ٠٫٠٠.
    ورصيدُ كشفه يساوي فاتورة يوليو بالهللة، وهي عندنا قُيّدت مسدَّدةً من
    حساب المالك، وما عرفناه مفتوحاً عند الكشف (بقيّة مايو) سُدّد كلُّه
    بحوالاتٍ بعده. فالخلاف على **أيّ فاتورةٍ سُدّدت** لا على فاتورةٍ غابت.

    فتفسيران يُثبَتان بالحساب ويسبقان التخمين:
      ١. الفرق يساوي ما خُصّص بعد الكشف على فواتير سبقته — ترتيبُ تخصيص.
      ٢. رصيدُ كشفه يساوي فاتورةً عندنا تاريخُها حتى الكشف — لم تغب.
    والتسامح ريالٌ كتسامح الاتّفاق.
  */
  let explanation: AccountExplanation | null = null;
  if (status === "DIFFERS" && differenceMinor! > 0 && reported !== null) {
    if (
      allocatedAfterStatementMinor! > 0
      && Math.abs(differenceMinor! - allocatedAfterStatementMinor!) <= ACCOUNT_TOLERANCE_MINOR
    ) {
      explanation = { kind: "ALLOCATED_AFTER_STATEMENT" };
    } else {
      const held = (input.invoicesAtStatement ?? []).find(
        (i) => i.totalMinor > 0 && Math.abs(i.totalMinor - reported) <= ACCOUNT_TOLERANCE_MINOR,
      );
      if (held) explanation = { kind: "INVOICE_ON_FILE", invoiceNumber: held.invoiceNumber };
    }
  }

  return {
    billedMinor: input.billedMinor,
    paidMinor: input.paidMinor,
    creditNoteMinor: base.creditNoteMinor,
    adjustmentMinor,
    knownBalanceMinor: known,
    reportedBalanceMinor: reported,
    differenceMinor,
    allocatedAfterStatementMinor,
    explanation,
    status,
  };
}

/** جملةٌ تصف الحال — تُقرأ ولا تحتاج جدولاً. */
export function describeAccount(a: SupplierAccount): string {
  if (a.status === "UNKNOWN") {
    return "لا فاتورة منه ولا كشف — فرصيدُه عندنا مجهول، وليس صفراً";
  }
  if (a.status === "NO_STATEMENT" && a.knownBalanceMinor === null) {
    return "كشفُه وصل ولا فاتورة منه عندنا — فلا يُقارَن";
  }
  if (a.status === "NO_STATEMENT") {
    return "لم يصل كشفٌ منه بعد — فلا مقارنة، وما نعرفه من فواتيرنا وحدها";
  }
  if (a.status === "AGREED") return "كشفُه يوافق ما عندنا";
  if (a.explanation?.kind === "ALLOCATED_AFTER_STATEMENT") {
    return "الفرق يساوي ما خُصّص بعد تاريخ كشفه على فواتير سبقته — ترتيبُ تخصيص، لا فاتورةٌ غائبة";
  }
  if (a.explanation?.kind === "INVOICE_ON_FILE") {
    return `رصيدُ كشفه يساوي فاتورة ${a.explanation.invoiceNumber} وهي عندنا — الخلاف على أيّ فاتورةٍ سُدّدت، لا فاتورةٌ غائبة`;
  }
  return a.differenceMinor! > 0
    ? "يطالب بأكثر ممّا نعرف — فاتورةٌ حمّلها علينا ولم تصلنا، أو سدادٌ لم يُسجَّل عندنا"
    : "نعرف أكثر ممّا يطالب — سدادٌ لم يصل كشفُه بعد، أو إشعارٌ دائن لم نقيّده";
}
