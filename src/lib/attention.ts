import {
  BLOCKER, DAY, DOCUMENT, INVOICE, ITEM, PAYMENT, PAYMENT_RECORD, PRODUCT, SUPPLIER, TRANSACTION, countNoun, type NounForms,
} from "./arabic";
import { OVERDUE_DAYS } from "./invoice-filter";
import { formatDay, formatMonth } from "./riyadh-time";
import { formatRiyalsDisplay } from "./money";
import { txHref } from "@/lib/inspector";

/** «وثيقة» لما له تاريخُ انتهاء — غيرُ «مستند» الفواتير والكشوف. */
const PAPER: NounForms = { one: "وثيقة", two: "وثيقتان", few: "وثائق", many: "وثيقةً" };

/** بعد كم يوماً من آخر كشفٍ يصير وقوفُه بنداً — الكشفُ يُستورَد أسبوعيّاً. */
export const BANK_STALE_DAYS = 7;
/**
 * ما يحتاج انتباهك.
 *
 * السؤال الذي يفتح صاحب المقهى التطبيق لأجله ليس «ما السجلات الموجودة؟»
 * بل «ماذا أفعل اليوم؟». وكانت الاستثناءات موزّعة على ست صفحات: التدقيق
 * والدفعات والسداد والكشوف والإقفال واللوحة — فلا يراها إلا من فتّش عنها.
 *
 * هنا تُجمع في مكان واحد، مرتّبةً بالأهمّ، ولكلٍّ منها **مكانٌ يُعالَج فيه**.
 * والبند بلا خطوة تالية ليس تنبيهاً بل شكوى.
 *
 * دالة خالصة: تأخذ حقائق وتُرجع بنوداً.
 */

export type AttentionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "OPPORTUNITY";

export type AttentionArea =
  | "INVOICES" | "VAT" | "BANK" | "PAYMENTS" | "SUPPLIERS" | "DATA";

export const AREA_LABEL: Record<AttentionArea, string> = {
  INVOICES: "الفواتير",
  VAT: "الضريبة",
  BANK: "البنك",
  PAYMENTS: "السداد",
  SUPPLIERS: "المورّدون",
  DATA: "جودة البيانات",
};

export const SEVERITY_LABEL: Record<AttentionSeverity, string> = {
  CRITICAL: "حرج",
  HIGH: "مرتفع",
  MEDIUM: "متوسط",
  OPPORTUNITY: "فرصة",
};

export interface AttentionEvidence {
  label: string;
  sub?: string;
  amountMinor?: number;
  /** موضعُ إصلاح هذا السطر بعينه — لا الصفحةُ الجامعة. */
  href?: string;
}

/**
 * أثر البند بالريال — وهو ما يجعله يستحقّ الانتباه أو لا يستحقّه.
 *
 * «ارتفع السعر ١٢٪» جملة لا تُحرّك أحداً. «يكلّفك ٦٬٤٠٠ ريالاً في السنة»
 * تُحرّكه. ونوع الأثر يُذكر معه، لأنّ ريالاً قد يُسترد ليس كريالٍ
 * معرَّض للرفض وليس كريالٍ مقدَّر على سنة قادمة.
 */
export type ImpactKind =
  | "RECOVERABLE"  // مالٌ خرج وقد يُسترد
  | "AT_RISK"      // مالٌ قد يضيع إن لم يُعالَج
  | "ANNUAL"       // أثرٌ سنويّ مقدَّر لا مبلغ واقع
  | "OWED"         // مالٌ مستحقّ عليك، لا مالٌ يضيع
  | "BLOCKED"      // لا مبلغ، لكنّه يوقف عملاً
  | "UNATTRIBUTED"; // مبلغ معلوم لم يُنسب إلى وجهه بعد

export interface AttentionImpact {
  kind: ImpactKind;
  /** `null` حين يُعلم الأثر ولا يُعلم قدره — ولا يُفترض صفراً. */
  amountMinor: number | null;
}

export const IMPACT_LABEL: Record<ImpactKind, string> = {
  RECOVERABLE: "قد يُسترد",
  AT_RISK: "معرّض للضياع",
  ANNUAL: "أثر سنوي مقدَّر",
  OWED: "مستحق عليك",
  BLOCKED: "يوقف عملاً",
  UNATTRIBUTED: "لم يُنسب بعد",
};

export interface AttentionItem {
  /**
   * نصّ الزرّ. الفعل يُسمّى بما يفعله لا بكلمة واحدة تصلح لكل شيء —
   * «عالِجها» لا تقول للمستخدم إلى أين يذهب ولا ماذا سيجد.
   */
  actionLabel?: string;
  id: string;
  area: AttentionArea;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  action: string;
  /** الصفحة التي يُعالَج فيها — البند بلا مكان لا يُعالَج */
  href: string;
  count: number;
  amountMinor?: number;
  /** أثره بالريال — يُقدَّم على الشدّة في الترتيب حين يكون معلوماً. */
  impact: AttentionImpact;
  evidence: AttentionEvidence[];
}

export interface AttentionFacts {
  /** تنبيهات مانعة مفتوحة */
  openBlockers: number;
  /** مستندات لم يُبتّ فيها */
  pendingDocuments: number;
  /**
   * فواتيرُ خرج مالها مرّتين في اليوم نفسه لجهةٍ واحدة.
   *
   * والمبلغُ هو **الزائد** لا المجموع: ما دُفع مرّتين يُطالَب بمرّةٍ
   * واحدة منه، لأنّ الأولى مستحقّة.
   */
  duplicatePayments: number;
  duplicatePaymentAmountMinor: number;
  duplicatePaymentEvidence: AttentionEvidence[];
  /**
   * ما طُولبت به الجهة ولم يعد بعد — بندٌ أهدأ لا يُطوى (SCN-104).
   * و«استُردّ» و«ليس ازدواجاً» لا يُعدّان أصلاً.
   */
  /**
   * كم منها يفصل بين صفّيه مرجعا سدادٍ مختلفان — أي عمليّتان قطعاً.
   * والغائبُ يُقرأ «لم يُعرَف» لا «كلّها»: فلا يُقال «لكلٍّ مرجعٌ مستقلّ»
   * إلّا حين يثبت.
   */
  duplicatePaymentsDistinct?: number;
  duplicatePaymentsClaimed?: number;
  duplicatePaymentClaimedMinor?: number;
  duplicatePaymentClaimedEvidence?: AttentionEvidence[];

  /** فواتير معلوم أنّها لا تصلح لخصم المدخلات، ومبلغ ضريبتها */
  notTaxValidCount: number;
  vatAtRiskMinor: number;
  vatAtRiskEvidence: AttentionEvidence[];

  /** فواتير لم يُقرأ تفصيلها الضريبي */
  unknownTaxCount: number;
  unknownTaxEvidence: AttentionEvidence[];

  /** مستحقّات مضى عليها ستّون يوماً فأكثر */
  overdueMinor: number;
  overdueSuppliers: AttentionEvidence[];

  /** حركات بنكية لم يُعرف مستفيدها ولم تُصنَّف */
  unclassifiedBankTx: number;
  unclassifiedBankAmountMinor: number;
  /** صفوفُ كشفٍ ملتبسة أو متضاربة لم تُقيَّد — تنتظر «هي نفسها» أو «أضِفها» (051) */
  heldBankRows: number;

  /** مورّدون يخالف آخرُ كشفٍ منهم دفترَنا (`latestStatementGaps`) — ما يطالبوننا به غيرُ ما ندين به */
  statementGaps?: { supplierName: string; slug: string; day: string; theirsMinor: number; oursMinor: number; gapMinor: number }[];

  /** ملفّاتٌ في مجلد شهرٍ غير شهر فاتورتها (`misplacedFiles`) — تُنقل بيد صاحبها */
  misplacedFiles?: { label: string; sub: string; href: string }[];

  /** مستنداتٌ مقيَّدة لم يعد ملفُّها في الدرايف — حُذف أو في السلّة (`missingFromDrive`) */
  missingFiles?: { label: string; sub: string; href: string }[];

  /** مورّدون لهم فواتير ولم يصل كشفهم */
  suppliersMissingStatement: string[];
  /**
   * العدد الحقّ — والقائمة دليلٌ مقصوص. وكان العنوان يأخذ طول القائمة
   * المقصوصة عند ثمانية، والحقيقة ثلاثة عشر.
   */
  suppliersMissingStatementCount?: number;
  /**
   * حركاتٌ قرارُها والمالُ فيها متناقضان (`detectAnomalies`): حُسمت ولم
   * تُقيَّد، أو قُيّدت وأُعلنت ليست سداداً. كانت الدالّة تُحسب ولا تُعرض.
   */
  lifecycleAnomalies?: AttentionEvidence[];
  lifecycleAnomalyMinor?: number;
  firstAnomalyTransactionId?: string | null;
  /**
   * سدادُ مورّدٍ خرج ثمّ عاد (`findReversals`): والفاتورةُ تبدو مسدَّدةً
   * والمالُ في حساب المقهى. كانت الدالّةُ مبنيّةً ومختبَرة ولا تصل إليها
   * شاشة.
   */
  /**
   * حوالاتٌ لمورّدٍ ذهبت إلى آيبانٍ غير المعروف له (`lib/bank/iban-guard.ts`) ولم يُقَل
   * فيها «أعرفه» بعد. تنبيهٌ يُغلق بضغطة — لا منع.
   */
  ibanAlerts?: AttentionEvidence[];
  ibanAlertMinor?: number;
  /** أوّلُ حوالةٍ إلى آيبانٍ لم يُرَ من قبل، فوق الحدّ — للعلم، تُغلق بـ«أعرفه». */
  firstTransfers?: AttentionEvidence[];
  firstTransferMinor?: number;
  /**
   * أيّامُ بيعٍ معتادة لم تصل تسويةُ شبكتها (`lib/bank/pos-watch.ts`) — ووسيطُ مثلها تقديرٌ
   * لما غاب لا مبلغٌ واقع. وما أسكته صاحبُه لا يُعدّ.
   */
  missingSettlements?: { day: string; usualMinor: number | null }[];
  /**
   * فواتيرُ مبدئيّة (Proforma) لم تصل فاتورتُها الضريبيّة (`proforma-watch.service.ts`) —
   * ما يُحوَّل على أساسها لا يجد فاتورتَه فيُخصَّص على أقدم فواتير المورّد.
   */
  orphanProformas?: { supplierName: string; supplierSlug: string; number: string | null; periodMonth: string | null }[];
  /**
   * توريدٌ يبدو مقيَّداً مرّتين (`repeat-delivery.service.ts`): فاتورتان للمورّد نفسِه ببنودٍ
   * وكمّيّاتٍ واحدة بينهما أيّامٌ أقلّ من إيقاعه — ملغاةٌ وبديلتُها بقيتا معاً.
   */
  repeatDeliveries?: {
    supplierName: string; firstNumber: string; secondNumber: string; gapDays: number;
    atStakeMinor: number; bothPaid: boolean; foodicsReceipts: number | null;
  }[];
  /**
   * ما اختلف فيه فودكس مع البنك ومع الفواتير (`services/foodics-attention.service.ts`) —
   * فودكس شاهدٌ: يُقال الفرقُ بطرفيه ولا يُسمّى ضياعاً، وما أسكته صاحبُه لا يُعدّ.
   */
  foodicsCardGaps?: { day: string; gapMinor: number }[];
  foodicsPurchaseDiffers?: { supplierName: string; invoiceNumber: string; gapMinor: number }[];
  foodicsPurchaseMissing?: { supplierName: string; invoiceNumber: string | null; totalMinor: number }[];
  /**
   * ما تقوله المساحةُ الماليّة (`services/finance-attention.service.ts`): ما ينقص ربحَ الشهر
   * ولا يُعرَف إلّا من صاحبه، وربطٌ جاهزٌ بدليل، وصندوقٌ فرقُه ظاهر، ومزامنةٌ وقفت، وصنفٌ
   * تكرّر فرقُه. كلُّها لها جوابٌ ممكن — وما أسكته صاحبُه لا يُعدّ.
   */
  financeRentLumps?: { day: string; amountMinor: number }[];
  financeLastMonthMissing?: { month: string; rent: boolean; salary: boolean } | null;
  stockLinksReady?: { count: number; valueMinor: number };
  foodicsTillGaps?: { day: string; userName: string | null; varianceMinor: number; uncounted: boolean }[];
  foodicsStaleHours?: number | null;
  stockRecurringGaps?: { productId: string; name: string; kind: "SHORTAGE" | "OVER_AVAILABLE"; months: number; totalMinor: number; byWitness: boolean }[];
  /**
   * وثائقُ انتهت أو دخلت مهلةَ تذكيرها (`lib/obligations.ts`) — يكتبها صاحبُها بيده.
   * `daysLeft` سالبٌ بعد الانتهاء.
   */
  expiringObligations?: { title: string; kindLabel: string; expiresOn: string; daysLeft: number }[];
  /** خصمٌ متكرّر تكرّر في شهره أو ارتفع عن عادته (`lib/recurring-detect.ts`) — والمبلغُ الزائد. */
  recurringAnomalies?: { label: string; kind: "TWICE" | "ROSE"; amountMinor: number; day: string }[];
  bouncedPayments?: AttentionEvidence[];
  bouncedPaymentMinor?: number;
  firstBouncedTransactionId?: string | null;
  /** مورّدون لا يصدرون فواتير وبلا عقد */
  suppliersWithoutContract: string[];
  /** والمال الذي دُفع لهم بلا مستند — دليلُ البند لا أسماءٌ وحدها. */
  suppliersWithoutContractEvidence?: AttentionEvidence[];

  /** فواتير بلا بنود — تحليل الأصناف لا يراها */
  invoicesWithoutLines: number;

  /**
   * مستنداتُ فواتيرَ أُرشفت ولم تُقيَّد لها فاتورة — مالٌ لا يدخل «كم أدين»
   * ولا دفعةَ الشهر، ولا شاشةَ كانت تقوله. (ثمانيةٌ في الإنتاج يوم وُجد.)
   * ولكلٍّ ملفُّه: يُقيَّد فيه، أو يُرفض إن كان نسخةً من فاتورةٍ مقيَّدة.
   */
  unrecordedInvoices?: AttentionEvidence[];

  /**
   * مالٌ خرج إلى مورّد ولا فاتورةَ تفسّره.
   *
   * وهذا السؤال الذي كان أحمد يراجعه بيده كلّ أسبوع: «لمن دفعنا بلا
   * فاتورة؟» — ولم يكن في النظام موضعٌ يجيبه. والدفعة غير المخصَّصة
   * حالٌ صحيحة لا خطأ، لكنّها **عملٌ باقٍ**: إمّا أن تصل الفاتورة،
   * وإمّا أن يُعلَن أنّ المورّد لا يصدر فواتير فيُطلَب عقدُ توريد.
   *
   * والمقدَّمةُ المعلَنة تخرج منها: صاحبُها قال ما هي، فليست سؤالاً.
   */
  unbackedPaymentCount: number;
  unbackedPaymentMinor: number;
  unbackedPaymentEvidence: AttentionEvidence[];

  /**
   * مصروفاتٌ تصف حدثاً واحداً وصل من مصدرين.
   *
   * وتُعرَض ولا تُحذَف: القيد الآليّ كاد يمحو ثلاثة مصروفات حقيقية،
   * لكلٍّ حركتُها البنكية ببصمتها. فأيّهما الصحيح قرارُ إنسان.
   */
  duplicateExpenses: number;
  duplicateExpenseAmountMinor: number;
  duplicateExpenseEvidence: AttentionEvidence[];

  /**
   * أيامٌ لا يغطّيها كشفٌ بنكيّ.
   *
   * وهذه أخطر ما في القائمة وأخفاه: كل بندٍ آخر يصف شيئاً **موجوداً**
   * فيه خلل، وهذا يصف شيئاً **غائباً**. حركاتُ الأيام غير المغطّاة لا
   * تظهر في عدّادٍ ولا في جدول، فيبدو النظام تامّاً وهو ناقص.
   */
  bankGapDays: number;
  bankGapRanges: AttentionEvidence[];
  /** فرقٌ بين ما يقوله البنك وما تقتضيه الحركات المقروءة. */
  bankBalanceDifferenceMinor: number | null;
  /**
   * آخرُ يومٍ في آخر كشفٍ مستورَد، وكم مضى عليه. الفجوةُ تُحسب **بين**
   * الكشوف وحدها، فالكشفُ الذي وقف قبل ثلاثة أسابيع لا يراه عدّاد —
   * وكلُّ رقمٍ بعدها (ما دفعتَه، وما طابقتَه، ورصيدُ المورّد) يقف معه.
   */
  bankLastDay?: string | null;
  bankStaleDays?: number | null;

  /**
   * إقرارُ الربع المنقضي لم يُسجَّل تقديمُه — من أوّل يومٍ بعد الربع حتى «قدّمتُه».
   * `daysLeft` سالبٌ بعد فوات الموعد. وغيابُه: قُدِّم، أو لا بيانات للربع.
   */
  vatReturnDue?: { periodKey: string; label: string; deadline: string; daysLeft: number } | null;

  /** أصناف ارتفع سعرها عند مورّدها */
  priceRises: AttentionEvidence[];
  priceRiseAnnualMinor: number;
}

const RANK: Record<AttentionSeverity, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, OPPORTUNITY: 3,
};

const riyals = (m: number) => formatRiyalsDisplay(Math.abs(m));

export function buildAttention(f: AttentionFacts): AttentionItem[] {
  const out: AttentionItem[] = [];

  /* ── حرج ── */

  /*
    الفجوة تسبق كل شيء.

    ما دام في الشهر يومٌ لم يُقرأ كشفُه، فكل رقمٍ بعده ناقصٌ بمقدارٍ
    مجهول — والمجهول لا يُقاس. ولذلك تُعرَض أوّلاً ولو كانت أرقامُ
    غيرها أكبر: البنود الأخرى تصف خللاً في موجود، وهذه تصف غائباً.
  */
  if (f.bankGapDays > 0) {
    out.push({
      id: "bank-coverage-gap",
      area: "BANK",
      severity: "CRITICAL",
      title: `${countNoun(f.bankGapDays, DAY)} بدون كشف بنكي`,
      detail: "حركات هذه الأيام ناقصة وليست معدومة، ولا يظهر هذا النقص في أي عدّاد.",
      action: "استورد الكشف الذي يغطّي هذه الأيام قبل أن تعتمد على أرقام الشهر.",
      actionLabel: "استورد كشفاً",
      /* الفجوة تُسدّ بالاستيراد — فيُفتَح موضعُه لا رأسُ الصفحة وفوقه ألفُ حركة */
      href: "/bank#import",
      count: f.bankGapDays,
      impact: { kind: "BLOCKED", amountMinor: null },
      evidence: f.bankGapRanges,
    });
  }

  /*
    موعدُ الإقرار عند الهيئة: من لم يفتح صفحتَه لا يعلم أنّ الموعد بعد أيّام، والتأخيرُ غرامة.
    يبقى حتى يُسجَّل «قدّمتُه». والمبلغُ في صفحته — لا يُحسب هنا مع كلّ فتح.
  */
  if (f.vatReturnDue) {
    const v = f.vatReturnDue;
    const late = v.daysLeft < 0;
    out.push({
      id: "vat-return-due",
      area: "VAT",
      severity: late || v.daysLeft <= 10 ? "HIGH" : "MEDIUM",
      title: late
        ? `فات موعد إقرار ضريبة ${v.label} منذ ${countNoun(-v.daysLeft, DAY)}`
        : `إقرار ضريبة ${v.label}: آخر موعد له ${formatDay(v.deadline)} (بعد ${countNoun(v.daysLeft, DAY)})`,
      detail: late
        ? "إن كنت قد قدّمته فسجّل ذلك ليختفي هذا البند. وإلا فعلى التأخير غرامة لدى الهيئة."
        : "قدّمه وسدّد المبلغ عبر بوابة هيئة الزكاة والضريبة والجمارك. ستجد حسابه وما ينقصه في صفحة الإقرار.",
      action: "راجع الحساب وقدّمه في البوابة، ثم سجّل «قدّمته».",
      actionLabel: "افتح الإقرار",
      href: `/close/vat?period=${v.periodKey}`,
      count: 1,
      impact: { kind: "OWED", amountMinor: null },
      evidence: [],
    });
  }

  /*
    الكشفُ الواقف: ما بعد آخر يومٍ فيه غائبٌ كالفجوة، لكنّه في آخر
    الخطّ فلا يقع بين كشفين. وأسبوعٌ مهلة: الكشفُ يُستورَد أسبوعيّاً.
  */
  if (f.bankLastDay && f.bankStaleDays != null && f.bankStaleDays > BANK_STALE_DAYS) {
    out.push({
      id: "bank-stale",
      area: "BANK",
      severity: "HIGH",
      title: `كشف البنك يقف عند ${formatDay(f.bankLastDay)}`,
      detail: `مضى ${countNoun(f.bankStaleDays, DAY)} لا يعرف النظام ما دخل فيها وما خرج، فما دفعته لمورّديك وأرصدتهم تعكس ما قبلها فقط.`,
      action: "استورد الكشف من اليوم التالي له إلى اليوم.",
      actionLabel: "استورد كشفاً",
      href: "/bank#import",
      count: f.bankStaleDays,
      impact: { kind: "BLOCKED", amountMinor: null },
      evidence: [],
    });
  }

  /*
    الفرق في المعادلة: البنك يقول رصيداً وحركاتُنا تقول غيره.
    وهو مالٌ لا نعرف أين ذهب — لا خطأ عرضٍ ولا خطأ مطابقة.
  */
  if (f.bankBalanceDifferenceMinor !== null && Math.abs(f.bankBalanceDifferenceMinor) > 1) {
    const diff = Math.abs(f.bankBalanceDifferenceMinor);
    /* فرقُ ريالٍ وسبعين هللة (سبتمبر ٢٠٢٦) كان «حرجاً» فوق ما يستحقّ القرار — الحِدّةُ بقدر المال */
    const small = diff < 100 * 100;
    out.push({
      id: "bank-balance-difference",
      area: "BANK",
      severity: small ? "MEDIUM" : "CRITICAL",
      title: small ? `فرق صغير بين رصيد البنك وحركاته (${formatRiyalsDisplay(diff)})` : "رصيد البنك لا يطابق حركاته المقروءة",
      detail:
        f.bankBalanceDifferenceMinor > 0
          ? `رصيد البنك أعلى بمقدار ${formatRiyalsDisplay(diff)}. قد تكون هناك حركة واردة لم تُقرأ، أو حركة صادرة قُرئت مرتين.`
          : `رصيد البنك أقل بمقدار ${formatRiyalsDisplay(diff)}. قد تكون هناك حركة صادرة لم تُقرأ، أو حركة واردة قُرئت مرتين.`,
      action: "راجع الكشف. الفرق يعني وجود حركات لم تصل، وليس خطأً في المطابقة.",
      actionLabel: "اكتب رصيدَي الشهر",
      /*
        الفرق يُفحَص بالمعادلة، ومكانُ كتابة الرصيدين قائمةُ الإقفال —
        وكان يفتح صفحة البنك عاريةً فلا يجد صاحبُ المقهى فيها ما يفعله.
      */
      href: "/close",
      count: 1,
      amountMinor: diff,
      impact: { kind: "BLOCKED", amountMinor: diff },
      evidence: [],
    });
  }

  if (f.duplicateExpenses > 0) {
    out.push({
      id: "duplicate-expenses",
      area: "DATA",
      severity: "HIGH",
      title: `مصروف مسجّل مرتين — ${countNoun(f.duplicateExpenses, ITEM)}`,
      detail: "المصروف الواحد يصل من كشف البنك ومن مستند مرفوع، فيُقيَّد مرتين ويرتفع مصروف الشهر.",
      action: "راجع كل مصروف واحذف المكرّر بنفسك. أنت من يقرّر أيهما الصحيح.",
      actionLabel: "احذف المكرّر",
      href: "/money/expenses",
      count: f.duplicateExpenses,
      amountMinor: f.duplicateExpenseAmountMinor,
      impact: { kind: "RECOVERABLE", amountMinor: f.duplicateExpenseAmountMinor },
      evidence: f.duplicateExpenseEvidence,
    });
  }

  /*
    مالٌ خرج مرّتين — لا صفٌّ دخل مرّتين.

    وكان هذا البند لا يظهر أبداً: `duplicatePayments` **صفرٌ مكتوبٌ بيد**
    في `attention-facts`، لا محسوب. فتقول الشاشة ضمناً «لا سداد مزدوج»
    وهي دعوى لم يفحصها أحد — وفي كشف أحمد ٢٬٣٥٠٫٧٧ ريالاً سُدّدت مرّتين
    في يومٍ واحد، وجدها بمراجعةٍ يدويّة.
  */
  if (f.duplicatePayments > 0) {
    out.push({
      id: "duplicate-payments",
      area: "BANK",
      severity: "CRITICAL",
      title: `مال خرج مرّتين في يوم واحد — ${countNoun(f.duplicatePayments, PAYMENT)}`,
      /*
        الجملةُ تتبع الدليل. كانت تقول «ولكلٍّ مرجعُ سدادٍ مستقلّ» دائماً،
        والدليلُ تحتها في اللوح نفسه يقول «بلا مرجعٍ يفصلهما» — فتناقض
        الشاشةُ نفسها في أخطر بنودها. وبلا مرجعين لا يُقطَع بأنّ المال
        خرج مرّتين: قد يكون الكشفُ ذكر السدادَ الواحد مرّتين.
      */
      detail:
        (f.duplicatePaymentsDistinct ?? 0) === f.duplicatePayments
          ? "خرج المال مرتين لنفس الجهة وبنفس المبلغ، ولكل حركة مرجع سداد مستقل،"
            + " فهما عمليتان فعليتان وليستا نسخة مكرّرة من الاستيراد."
          : "خرج المال مرتين لنفس الجهة وبنفس المبلغ في اليوم نفسه، ولا يوجد في الكشف مرجع"
            + " يميّز بين الحركتين في بعضها، فالأرجح أنه سداد مكرّر، لكن لا يمكن الجزم بذلك.",
      action:
        (f.duplicatePaymentsDistinct ?? 0) === f.duplicatePayments
          ? "طالب الجهة بردّ المبلغ الزائد. كلما تأخّرت صعب الاسترداد."
          : "راجع إيصالات السداد أو تطبيق البنك. إن ظهر السداد مرتين فطالب الجهة بردّ المبلغ الزائد.",
      actionLabel: "طالب بالردّ",
      /* الحسمُ صار في البند نفسه — ولوحُ فعله تحته، لا في صفحةٍ أخرى */
      href: "/attention?item=duplicate-payments",
      count: f.duplicatePayments,
      amountMinor: f.duplicatePaymentAmountMinor,
      impact: { kind: "RECOVERABLE", amountMinor: f.duplicatePaymentAmountMinor },
      evidence: f.duplicatePaymentEvidence,
    });
  }

  /*
    ما طُولبت به الجهة ولم يعد — لا يُحذف من القائمة ولا يبقى حرجاً.
    الحرجُ الذي يبقى بعد أن فعل صاحبه ما عليه يعلّمه تجاهلَ الحرج.
  */
  if ((f.duplicatePaymentsClaimed ?? 0) > 0) {
    const claimedMinor = f.duplicatePaymentClaimedMinor ?? 0;
    out.push({
      id: "duplicate-payments-claimed",
      area: "BANK",
      severity: "MEDIUM",
      title: `مطالبة باسترداد مال خرج مرتين، بانتظار الرد — ${countNoun(f.duplicatePaymentsClaimed ?? 0, ITEM)}`,
      detail: "طالبتَ الجهة بردّ المبلغ الزائد ولم تسجّل أنه عاد.",
      action: "تابع الجهة. وإن عاد المال فاضغط «استردّ» عند الحركتين.",
      actionLabel: "تابع المطالبة",
      /* الحسمُ صار في البند نفسه — ولوحُ فعله تحته، لا في صفحةٍ أخرى */
      href: "/attention?item=duplicate-payments-claimed",
      count: f.duplicatePaymentsClaimed ?? 0,
      amountMinor: claimedMinor,
      impact: { kind: "RECOVERABLE", amountMinor: claimedMinor },
      evidence: f.duplicatePaymentClaimedEvidence ?? [],
    });
  }

  /*
    مالٌ خرج ولا مستندَ يفسّره.

    وهو أوّل ما يسأل عنه المحاسب، وأوّل ما يسقط في الإقرار الضريبيّ:
    مصروفٌ بلا فاتورةٍ ضريبية لا يُخصَم مدخلُه، وقد لا يُقبَل مصروفاً
    أصلاً. وكان أحمد يجمعه بيده في ورقةٍ كلّ أسبوع.
  */
  if (f.unbackedPaymentCount > 0) {
    out.push({
      id: "unbacked-payments",
      area: "PAYMENTS",
      severity: "HIGH",
      /* الاسم نفسه المعروض في «حسابات المورّدين» وفي «حركة البنك» — حرفاً بحرف */
      title: `${countNoun(f.unbackedPaymentCount, PAYMENT_RECORD)} لم تُنسب إلى فاتورة`,
      detail:
        "مال وصل إلى المورّد ولا يوجد مستند يقابله، فلا يمكن خصم ضريبة مدخلاته،"
        + " ورصيد المورّد عندنا غير مؤكَّد.",
      action:
        "اطلب الفاتورة من المورّد، أو سجّل أنه لا يصدر فواتير واطلب عقد توريد.",
      actionLabel: "اطلب الفواتير",
      /* القائمة نفسها التي عُدّت — لا جدول المورّدين العامّ (BTN-110) */
      href: "/suppliers?unbacked=1#unbacked",
      count: f.unbackedPaymentCount,
      amountMinor: f.unbackedPaymentMinor,
      impact: { kind: "UNATTRIBUTED", amountMinor: f.unbackedPaymentMinor },
      evidence: f.unbackedPaymentEvidence,
    });
  }

  if (f.openBlockers > 0) {
    out.push({
      id: "open-blockers",
      area: "DATA",
      severity: "CRITICAL",
      title: `${countNoun(f.openBlockers, BLOCKER)} لم يُعالَج`,
      detail: "يمنع إقفال الشهر ويشوّه أرقامه.",
      action: "عالجها أو تجاوزها مع كتابة السبب.",
      actionLabel: "راجع المستندات",
      href: "/documents?status=NEEDS_REVIEW",
      count: f.openBlockers,
      impact: { kind: "BLOCKED", amountMinor: null },
      evidence: [],
    });
  }

  /* ── عالٍ ── */
  if (f.vatAtRiskMinor > 0) {
    out.push({
      id: "vat-at-risk",
      area: "VAT",
      severity: "HIGH",
      title: "ضريبة مدخلات معرّضة للضياع",
      detail: `${countNoun(f.notTaxValidCount, INVOICE)} لا تستوفي شروط الفاتورة الضريبية، فلا يجوز خصم ضريبتها.`,
      action: "اطلب من هؤلاء المورّدين فاتورة ضريبية كاملة تحمل رقمنا الضريبي.",
      actionLabel: "اطلب فاتورة كاملة",
      href: "/purchases/invoices?tax=INVALID&withVat=1",
      count: f.notTaxValidCount,
      amountMinor: f.vatAtRiskMinor,
      impact: { kind: "AT_RISK", amountMinor: f.vatAtRiskMinor },
      evidence: f.vatAtRiskEvidence,
    });
  }

  if (f.overdueMinor > 0) {
    out.push({
      id: "overdue",
      area: "PAYMENTS",
      severity: "HIGH",
      title: `مورّدون تأخّرت مستحقّاتهم أكثر من ${countNoun(OVERDUE_DAYS, DAY)}`,
      detail: "التأخّر الطويل يفسد شروط التوريد ويضعف تفاوضك.",
      action: "أدرجها في دفعة أول الشهر.",
      actionLabel: "راجع المتأخّرة",
      href: "/purchases/invoices?overdue=1",
      count: f.overdueSuppliers.length,
      amountMinor: f.overdueMinor,
      impact: { kind: "OWED", amountMinor: f.overdueMinor },
      evidence: f.overdueSuppliers,
    });
  }

  if (f.unclassifiedBankTx > 0) {
    out.push({
      id: "unclassified-bank",
      area: "BANK",
      severity: "HIGH",
      title: `${countNoun(f.unclassifiedBankTx, TRANSACTION)} في البنك تنتظر قرارك`,
      detail: `بقيمة ${riyals(f.unclassifiedBankAmountMinor)} ريال. لم يُعرف تصنيفها، أو عُرف أنها سداد لمورّد ولم تُقيَّد بعد.`,
      action: "حدّد تصنيف كل حركة مرة واحدة، وسيُطبَّق على الحركات المشابهة في كل كشف قادم.",
      actionLabel: "صنّف الحركات",
      /* التصنيف في الطابور — لا أعلى صفحة البنك وألفُ حركةٍ فوقها */
      href: "/attention?item=unclassified-bank",
      count: f.unclassifiedBankTx,
      amountMinor: f.unclassifiedBankAmountMinor,
      impact: { kind: "UNATTRIBUTED", amountMinor: f.unclassifiedBankAmountMinor },
      evidence: [],
    });
  }

  if (f.heldBankRows > 0) {
    out.push({
      id: "held-bank-rows",
      area: "BANK",
      severity: "HIGH",
      title: `${countNoun(f.heldBankRows, TRANSACTION)} في البنك تنتظر قرارك، فالأدلة وحدها لا تكفي للحسم`,
      detail: "سطر في الكشف يشبه حركة مقيّدة ولا يمكن الجزم أهو هي أم حركة أخرى، أو مرجعه مكرّر بمبلغ مختلف، أو حركة عندنا غير موجودة في كشف البنك الذي يغطّي يومها. وبدون قرار قد تضيع حوالة حقيقية أو تبقى حركة مكرّرة تفسد الرصيد.",
      action: "قرّر في كل واحدة من صفحة البنك. يُحفظ قرارك فلا تعود الحركة عند إعادة الاستيراد.",
      actionLabel: "قرّر في صفحة البنك",
      href: "/bank#queue",
      count: f.heldBankRows,
      /* الأثرُ معلومٌ (مالٌ قد لا يُنسب) وقدرُه لا — ولا يُفترض صفراً */
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: [],
    });
  }

  if (f.priceRiseAnnualMinor > 0) {
    out.push({
      id: "price-rises",
      area: "SUPPLIERS",
      severity: f.priceRiseAnnualMinor > 100_000 ? "HIGH" : "MEDIUM",
      title: "ارتفاع أسعار المورّدين",
      detail: `${countNoun(f.priceRises.length, PRODUCT)} ارتفع سعره عند مورّده. والأثر محسوب على كمية ما اشتريته منه في آخر سنة.`,
      action: "فاوض المورّد على الأصناف الثلاثة الأعلى أثراً، واطلب عرض سعر من مورّد بديل لتقوّي موقفك في التفاوض.",
      actionLabel: "قارن الأسعار",
      /*
        كان يفتح `/analysis` وجدولُ ارتفاع الأسعار في `/performance` —
        فمن ضغط الزرّ وصل إلى صفحةٍ لا تحمل ما وُعد به. وقد صارتا
        واحدة، والمرساة تنزل به إلى الجدول نفسه.
      */
      href: "/analysis#price-moves",
      count: f.priceRises.length,
      amountMinor: f.priceRiseAnnualMinor,
      impact: { kind: "ANNUAL", amountMinor: f.priceRiseAnnualMinor },
      evidence: f.priceRises,
    });
  }

  if ((f.lifecycleAnomalies?.length ?? 0) > 0) {
    const n = f.lifecycleAnomalies!.length;
    out.push({
      id: "lifecycle-anomalies",
      area: "BANK",
      severity: "HIGH",
      title: `${countNoun(n, TRANSACTION)} قرارها وقيدها المالي متناقضان`,
      detail: "اتُّخذ فيها قرار ولم تُقيَّد بدفعة، أو قُيّدت ثم صُنّفت أنها ليست سداداً. يُعرض هذا الخلل ولا يُصحَّح آلياً، فقد يكون سببه فشلاً في الحفظ أو حذفاً يدوياً.",
      action: "افتح الحركة وحدّد أيّ الأمرين هو الصحيح.",
      actionLabel: "راجع الحركة",
      href: f.firstAnomalyTransactionId ? txHref(f.firstAnomalyTransactionId) : "/bank",
      count: n,
      amountMinor: f.lifecycleAnomalyMinor ?? undefined,
      impact: { kind: "UNATTRIBUTED", amountMinor: f.lifecycleAnomalyMinor ?? null },
      evidence: f.lifecycleAnomalies!.slice(0, 6),
    });
  }

  /*
    حوالةٌ إلى حسابٍ غير حساب المورّد المعروف: «غيّرنا حسابنا» أشيعُ احتيالٍ على المنشآت
    الصغيرة. حرجٌ لأنّ ما يُستردّ يُستردّ في أيّامه الأولى — ويُغلق بـ«أعرفه» إن كان حسابَه.
  */
  if ((f.ibanAlerts?.length ?? 0) > 0) {
    const n = f.ibanAlerts!.length;
    out.push({
      id: "iban-mismatch",
      area: "PAYMENTS",
      severity: "CRITICAL",
      title: n === 1
        ? "حوالة لمورّد ذهبت إلى حساب غير حسابه المعروف"
        : `${countNoun(n, SUPPLIER)} حُوِّل لهم إلى حساب غير حسابهم المعروف`,
      detail: "الآيبان في كشف البنك يختلف عن المسجّل في ملف المورّد أو عمّا حُوِّل له سابقاً. قد يكون للمورّد حساب آخر، وقد تكون رسالة «غيّرنا حسابنا» مزوّرة.",
      action: "قارن بين الآيبانين. إن كنت تعرف الحساب فأغلق البند بـ«أعرفه»، وإلا فاتصل بالمورّد على رقمه المعروف وبالبنك قبل أي تحويل آخر.",
      actionLabel: "قارن الحسابين",
      href: "/attention?item=iban-mismatch",
      count: n,
      amountMinor: f.ibanAlertMinor ?? undefined,
      impact: { kind: "AT_RISK", amountMinor: f.ibanAlertMinor ?? null },
      evidence: f.ibanAlerts!.slice(0, 6),
    });
  }

  /*
    الغائبُ لا يُرى في جدول: يومٌ يصل في مثله إيداعُ الشبكة ولم يصل. تحذيرٌ لا حكم —
    قد يكون المقهى مغلقاً، فيُسكته صاحبُه في صفحته بسببه. والمبلغُ تقديرٌ فلا يُجمع أثراً.
  */
  if ((f.missingSettlements?.length ?? 0) > 0) {
    const days = f.missingSettlements!;
    out.push({
      id: "pos-missing-settlement",
      area: "BANK",
      severity: "HIGH",
      title: days.length === 1
        ? `تسوية شبكة ${formatDay(days[0].day)} لم تصل`
        : `${countNoun(days.length, DAY)} لم تصل تسوية شبكتها`,
      detail: "في مثل هذه الأيام من الأسابيع السابقة كان يصل إيداع الشبكة، ولا يوجد إيداع لها في كشف البنك.",
      action: "راجع تقرير جهاز نقاط البيع لذلك اليوم ثم كشف البنك. وإن كان المقهى مغلقاً فأسكت التنبيه من صفحته.",
      actionLabel: "افتح تسويات الشبكة",
      href: "/money/pos#missing",
      count: days.length,
      impact: { kind: "AT_RISK", amountMinor: null },
      evidence: days.slice(0, 6).map((d) => ({
        label: formatDay(d.day),
        sub: d.usualMinor === null ? "لا يوجد تقدير لمثله" : `المعتاد في مثل هذا اليوم نحو ${formatRiyalsDisplay(d.usualMinor)} (تقدير)`,
      })),
    });
  }

  /*
    توريدٌ واحد بفاتورتين: أفال ألغت 00080 وأصدرت 00084 بالبنود نفسها بعد يومين، وكشفُها
    حملهما معاً فدُفعتا — ‏١٬٩٩٨٫٧٠ لم يرها أحدٌ شهرين. سؤالٌ لا حكم: يُغلق بـ«توريدان فعلاً».
  */
  if ((f.repeatDeliveries?.length ?? 0) > 0) {
    const list = f.repeatDeliveries!;
    const total = list.reduce((s, r) => s + r.atStakeMinor, 0);
    const paid = list.filter((r) => r.bothPaid).length;
    out.push({
      id: "repeat-delivery",
      area: "INVOICES",
      severity: paid > 0 ? "CRITICAL" : "HIGH",
      title: list.length === 1
        ? `توريد من ${list[0].supplierName} يبدو مقيّداً مرتين`
        : `${list.length} توريدات تبدو مقيّدة مرتين`,
      detail: "فاتورتان للمورّد نفسه بالأصناف والكميات نفسها، والفاصل بينهما أقل من المعتاد في توريده. الأرجح أن إحداهما أُلغيت وصدرت الأخرى بدلاً منها، لكن الاثنتين بقيتا مقيّدتين."
        + (paid > 0 ? " وقد سُدّدت كلتاهما." : ""),
      action: paid > 0
        ? "اسأل المورّد. إن كانت إحداهما ملغاة فألغها عندنا واطلب إشعاراً دائناً أو خصماً من الفاتورة القادمة."
        : "اسأل المورّد قبل أن تدفع. إن كانت إحداهما ملغاة فألغها عندنا.",
      actionLabel: "قارن الفاتورتين",
      href: "/purchases/foodics#repeat",
      count: list.length,
      amountMinor: total,
      impact: { kind: paid > 0 ? "RECOVERABLE" : "AT_RISK", amountMinor: total },
      evidence: list.slice(0, 6).map((r) => ({
        label: `${r.supplierName} · ${r.firstNumber} و${r.secondNumber}`,
        sub: `بينهما ${r.gapDays === 0 ? "اليوم نفسه" : r.gapDays === 1 ? "يوم" : r.gapDays === 2 ? "يومان" : `${r.gapDays} أيام`}`
          + (r.foodicsReceipts === 1 ? " · وفودكس سجّل استلاماً واحداً" : r.foodicsReceipts === 0 ? " · ولا يوجد استلام في فودكس" : "")
          + (r.bothPaid ? " · سُدّدتا" : ""),
        amountMinor: r.atStakeMinor,
        href: "/purchases/foodics#repeat",
      })),
    });
  }

  /*
    مبدئيّةٌ في الدرايف بلا أصلها: لا تُقيَّد ديناً ولا تُخصم ضريبتُها، وما حُوِّل على أساسها
    يُخصَّص بالأقدم أوّلاً على فاتورةٍ سابقة — فيبدو القديمُ مسدَّداً وهو ليس المقصود.
  */
  if ((f.orphanProformas?.length ?? 0) > 0) {
    const list = f.orphanProformas!;
    out.push({
      id: "proforma-without-invoice",
      area: "INVOICES",
      severity: "HIGH",
      title: list.length === 1
        ? `فاتورة مبدئية من ${list[0].supplierName} بدون فاتورتها الضريبية`
        : `${list.length} فواتير مبدئية بدون فواتيرها الضريبية`,
      detail: "الموجود في الدرايف فاتورة مبدئية (Proforma) وليس الفاتورة الضريبية. لا تُقيَّد ولا تُخصم ضريبتها، وما تحوّله للمورّد على أساسها يُخصَّص على أقدم فواتيره المفتوحة.",
      action: "اطلب الفاتورة الضريبية من المورّد وارفعها، ثم راجع الفواتير التي خُصِّص عليها ما حوّلته له.",
      actionLabel: list.length === 1 ? "افتح حساب المورّد" : "افتح المستندات",
      href: list.length === 1 ? `/suppliers/${list[0].supplierSlug}` : "/documents",
      count: list.length,
      impact: { kind: "BLOCKED", amountMinor: null },
      evidence: list.slice(0, 6).map((p) => ({
        label: `${p.supplierName} · ${p.number ?? "بدون رقم"}`,
        sub: p.periodMonth ? `مبدئية ${formatMonth(p.periodMonth)}` : "مبدئية",
        href: `/suppliers/${p.supplierSlug}`,
      })),
    });
  }

  /*
    فودكس والبنك: دفعةٌ لم يُوجد لها مقطعٌ من بطاقات فودكس يقاربها. «وصل أقلّ» مالٌ قد
    يكون لم يصل؛ و«وصل أكثر» بيعٌ دُفع بالبطاقة وسُجّل بغيرها — يُراجَع ولا يُخاف عليه.
  */
  if ((f.foodicsCardGaps?.length ?? 0) > 0) {
    const gaps = f.foodicsCardGaps!;
    const short = gaps.filter((g) => g.gapMinor > 0);
    const shortMinor = short.reduce((s, g) => s + g.gapMinor, 0);
    out.push({
      id: "foodics-card-gap",
      area: "BANK",
      severity: short.length > 0 ? "HIGH" : "MEDIUM",
      title: gaps.length === 1
        ? `دفعة شبكة ${formatDay(gaps[0].day)} لا تطابق بطاقات فودكس`
        : `${gaps.length} دفعات شبكة لا تطابق بطاقات فودكس`,
      detail: short.length > 0
        ? "سجّل فودكس بطاقات أكثر مما دخل الحساب في بعض الأيام، ودخل الحساب أكثر مما سجّله في أيام أخرى."
        : "دخل الحساب من الشبكة أكثر مما سجّله فودكس بالبطاقة. قد يكون بيعاً سُجّل نقداً ودُفع بالبطاقة، أو عملية على الجهاز بلا طلب.",
      action: "افتح الدفعة وقارن بين تقرير إقفال الجهاز لتلك الليلة وطلباتها في فودكس. وإن عرفت السبب فأسكت التنبيه.",
      actionLabel: "افتح فودكس والبنك",
      href: "/money/foodics#flagged",
      count: gaps.length,
      impact: { kind: "AT_RISK", amountMinor: short.length > 0 ? shortMinor : null },
      evidence: gaps.slice(0, 6).map((g) => ({
        label: `دفعة ${formatDay(g.day)}`,
        sub: g.gapMinor > 0 ? "وصل إلى البنك أقل مما في فودكس" : "وصل إلى البنك أكثر مما في فودكس",
        amountMinor: Math.abs(g.gapMinor),
      })),
    });
  }

  /* فاتورةٌ واحدة ومبلغان: أحدُ الطرفين قرأ أو أدخل خطأً، والمستندُ هو الحكم */
  if ((f.foodicsPurchaseDiffers?.length ?? 0) > 0) {
    const list = f.foodicsPurchaseDiffers!;
    out.push({
      id: "foodics-purchase-differs",
      area: "INVOICES",
      severity: "MEDIUM",
      title: list.length === 1
        ? `مبلغ فاتورة ${list[0].supplierName} في فودكس يختلف عمّا عندنا`
        : `${countNoun(list.length, INVOICE)} يختلف مبلغها في فودكس عمّا عندنا`,
      detail: "رقم الفاتورة واحد عند الطرفين لكن الإجمالي مختلف، فأحدهما قُرئ أو أُدخل خطأً.",
      action: "افتح المستند وقرّر: صحّح الفاتورة إن كان الخطأ في قراءتنا، أو صحّح فودكس إن كان الخطأ فيه.",
      actionLabel: "قارن في فودكس والفواتير",
      href: "/purchases/foodics#differs",
      count: list.length,
      impact: { kind: "UNATTRIBUTED", amountMinor: list.reduce((s, x) => s + Math.abs(x.gapMinor), 0) },
      evidence: list.slice(0, 6).map((x) => ({ label: `${x.supplierName} · ${x.invoiceNumber}`, sub: "الفرق بين الطرفين", amountMinor: Math.abs(x.gapMinor) })),
    });
  }

  /* بضاعةٌ أُدخلت مخزونَ فودكس لمورّدٍ نعرفه ولا فاتورةَ لها في الدرايف — مستندٌ لم يصل */
  if ((f.foodicsPurchaseMissing?.length ?? 0) > 0) {
    const list = f.foodicsPurchaseMissing!;
    out.push({
      id: "foodics-purchase-missing",
      area: "INVOICES",
      severity: "MEDIUM",
      title: list.length === 1
        ? `شراء من ${list[0].supplierName} في فودكس بدون فاتورة عندنا`
        : `${list.length} حركات شراء في فودكس بدون فاتورة عندنا`,
      detail: "توجد حركة شراء مرحَّلة في فودكس لمورّد مربوط، ولا توجد في الدرايف فاتورة بنفس رقمها أو بتاريخها ومبلغها.",
      action: "اطلب الفاتورة من المورّد أو ارفعها. وإن لم تكن هناك فاتورة منتظرة فأسكت التنبيه من صفحته.",
      actionLabel: "افتح فودكس والفواتير",
      href: "/purchases/foodics#only-foodics",
      count: list.length,
      amountMinor: list.reduce((s, x) => s + x.totalMinor, 0),
      impact: { kind: "UNATTRIBUTED", amountMinor: list.reduce((s, x) => s + x.totalMinor, 0) },
      evidence: list.slice(0, 6).map((x) => ({ label: `${x.supplierName} · ${x.invoiceNumber ?? "بدون رقم"}`, amountMinor: x.totalMinor })),
    });
  }

  /* ── المساحةُ الماليّة ── */

  /*
    مزامنةٌ وقفت بلا أن يعلم أحد: فودكس يُقرأ حين يُفتَح التطبيق، فإن مضى يومٌ وأكثر
    فمبيعاتُ أمس وصناديقُه ليست هنا — وكلُّ رقمٍ في «المالية» ناقصٌ بقدرها.
  */
  if (f.foodicsStaleHours != null) {
    const days = Math.floor(f.foodicsStaleHours / 24);
    out.push({
      id: "foodics-stale",
      area: "DATA",
      severity: days >= 3 ? "HIGH" : "MEDIUM",
      title: days >= 1 ? `لم تُقرأ بيانات فودكس منذ ${countNoun(days, DAY)}` : "لم تُقرأ بيانات فودكس منذ أكثر من يوم",
      detail: "آخر مزامنة ناجحة قديمة. مبيعات الأيام التي بعدها وصناديقها غير موجودة في النظام، فأرقام «المالية» والجرد ناقصة بقدرها.",
      action: "اضغط «زامن الآن». وإن رفض فودكس المفتاح فقد أُلغي من «Authorized Apps»، فاطلب مفتاحاً جديداً.",
      actionLabel: "زامن فودكس",
      href: "/money/foodics",
      count: 1,
      impact: { kind: "BLOCKED", amountMinor: null },
      evidence: [],
    });
  }

  /*
    ربحٌ ينقصه الإيجارُ أو الرواتب ليس ربحاً — وما ينقصه لا يُعرَف إلّا من صاحبه.
    بندٌ واحد: دفعةُ إيجارٍ لم تُوزَّع، أو شهرٌ انتهى بلا إيجارٍ ولا رواتب.
  */
  const lumps = f.financeRentLumps ?? [];
  const missing = f.financeLastMonthMissing ?? null;
  if (lumps.length > 0 || missing) {
    const names = [missing?.rent ? "الإيجار" : null, missing?.salary ? "الرواتب" : null].filter((x): x is string => x !== null);
    out.push({
      id: "finance-incomplete",
      area: "DATA",
      severity: "MEDIUM",
      title: lumps.length > 0
        ? "دفعة إيجار في الكشف لم يُحدَّد عدد الأشهر التي تغطيها"
        : `ربح ${formatMonth(missing?.month ?? "")} ينقصه ${names.join(" و")}`,
      detail: lumps.length > 0
        ? `قُيّدت الدفعة كلها على شهر الدفع، فيظهر ربح الأشهر حوله «قبل الإيجار»${missing && names.length > 0 ? `، و${formatMonth(missing.month)} ينقصه ${names.join(" و")}` : ""}.`
        : "لا يوجد له قيد في الكشف ولا إقرار منك، فالرقم «ربح قبل كذا» وليس «صافي الربح».",
      action: "أدخل ما لا يظهر في الكشف: عدد الأشهر التي تغطيها دفعة الإيجار، وما يُدفع نقداً أو من حساب شخصي.",
      actionLabel: "أكمل ربح الشهر",
      href: `/finance/inputs${missing ? `?month=${missing.month}` : ""}`,
      count: Math.max(1, lumps.length),
      impact: { kind: "BLOCKED", amountMinor: lumps.length > 0 ? lumps.reduce((s, l) => s + l.amountMinor, 0) : null },
      evidence: lumps.slice(0, 4).map((l) => ({ label: `إيجار خرج ${formatDay(l.day)}`, sub: "لم يُوزَّع على أشهره", amountMinor: l.amountMinor })),
    });
  }

  /* بنودُ فواتير اتّفق دليلُ فودكس على صنفها وعبوتها: ضغطةٌ ترفع تغطيةَ «المشترى والمباع» */
  if ((f.stockLinksReady?.count ?? 0) > 0) {
    const ready = f.stockLinksReady!;
    out.push({
      id: "stock-links-ready",
      area: "DATA",
      severity: "OPPORTUNITY",
      title: `${countNoun(ready.count, PRODUCT)} من الفواتير جاهزة للربط بأصناف المخزون`,
      detail: "يقابل كل بند منها في فودكس بند شراء للمورّد نفسه وبالمبلغ نفسه، اختار له من أدخله صنف المخزون وكميته. وبدون ربطها تبقى مشتريات هذه الأصناف «غير معروفة».",
      action: "راجعها وأقرّها بضغطة واحدة، أو عدّل ما تراه غير صحيح.",
      actionLabel: "اربط البنود",
      href: "/finance/stock/links?view=ready",
      count: ready.count,
      impact: { kind: "UNATTRIBUTED", amountMinor: ready.valueMinor },
      evidence: [],
    });
  }

  /* صندوقٌ أُقفل بلا عدّ أو بفرقٍ فوق الفكّة — يُسأل عنه من أقفله، ولا يُسمّى ضياعاً */
  if ((f.foodicsTillGaps?.length ?? 0) > 0) {
    const tills = f.foodicsTillGaps!;
    const uncounted = tills.filter((t) => t.uncounted).length;
    out.push({
      id: "foodics-till-gap",
      area: "BANK",
      severity: "MEDIUM",
      title: tills.length === 1
        ? (tills[0].uncounted ? `صندوق ${formatDay(tills[0].day)} أُقفل بدون عدّ` : `صندوق ${formatDay(tills[0].day)}: المعدود يختلف عن المتوقع`)
        : `${tills.length} صناديق يختلف المعدود فيها عن المتوقع`,
      detail: uncounted > 0
        ? "أُقفل صندوق والمعدود فيه صفر بينما يتوقع فودكس نقداً، أي لم يُعدّ عند الإقفال. وفي غيره فرق أكبر من الفكّة."
        : "النقد المعدود عند الإقفال يختلف عمّا يتوقعه فودكس بأكثر من الفكّة. نقد المقهى لا يدخل البنك، فهذا العدّ هو الدليل الوحيد.",
      action: "اسأل من أقفل الصندوق: هل عدّ النقد؟ وهل أُخذ منه مبلغ دون تسجيله «سحباً» في فودكس؟ وإن عرفت السبب فأسكت التنبيه.",
      actionLabel: "افتح النقد والصندوق",
      href: "/finance/position#cash",
      count: tills.length,
      impact: { kind: "AT_RISK", amountMinor: tills.filter((t) => t.varianceMinor < 0).reduce((s, t) => s - t.varianceMinor, 0) || null },
      evidence: tills.slice(0, 6).map((t) => ({
        label: `صندوق ${formatDay(t.day)}${t.userName ? ` · فتحه ${t.userName}` : ""}`,
        sub: t.uncounted ? "أُقفل بدون عدّ" : t.varianceMinor < 0 ? "المعدود أقلّ من المتوقّع" : "المعدود أكثر من المتوقّع",
        amountMinor: Math.abs(t.varianceMinor),
      })),
    });
  }

  /*
    صنفٌ تكرّر فرقُه شهرين فأكثر — بسؤالٍ محدَّد لا بحكم: النقصُ «راجِع الوصفة أو سجِّل
    الهدر»، والاستهلاكُ فوق المتاح «فاتورةٌ ناقصة؟».
  */
  const recurring = f.stockRecurringGaps ?? [];
  const shortages = recurring.filter((g) => g.kind === "SHORTAGE");
  const overs = recurring.filter((g) => g.kind === "OVER_AVAILABLE");
  if (shortages.length > 0) {
    out.push({
      id: "stock-gap-shortage",
      area: "DATA",
      severity: "MEDIUM",
      title: shortages.length === 1
        ? `«${shortages[0].name}» يخرج من المخزون أكثر مما تفسّره وصفته، لمدة ${shortages[0].months} أشهر متتالية`
        : `${countNoun(shortages.length, PRODUCT)} تخرج من المخزون أكثر مما تفسّره وصفاتها`,
      detail: "الفرق تكرّر شهرين فأكثر، فلا يُرجَّح أنه خطأ عدّ عابر. قد يكون هدراً غير مسجّل، أو وصفة أقل من الكمية المستخدمة فعلاً (جرعة أكبر، ضبط الطحن)، أو تسرّباً. والبيانات وحدها لا تحدّد السبب.",
      action: "راجع الوصفة: هل تطابق الكمية المستخدمة فعلاً؟ وسجّل الهدر حين يقع ليخرج من الفرق.",
      actionLabel: "افتح المشترى والمباع",
      href: "/finance/stock#recurring",
      count: shortages.length,
      impact: { kind: "AT_RISK", amountMinor: shortages.reduce((s, g) => s + g.totalMinor, 0) },
      evidence: shortages.slice(0, 6).map((g) => ({
        label: g.name, sub: `${g.months} أشهر متتالية${g.byWitness ? " · بمشتريات فودكس" : ""}`, amountMinor: g.totalMinor,
        href: `/finance/stock/item?id=${g.productId}&month=all`,
      })),
    });
  }
  if (overs.length > 0) {
    out.push({
      id: "stock-gap-over",
      area: "INVOICES",
      severity: "MEDIUM",
      title: overs.length === 1
        ? `«${overs[0].name}» بيع منه أكثر مما اشتُري. هل هناك فاتورة ناقصة؟`
        : `${countNoun(overs.length, PRODUCT)} بيع منها أكثر مما اشتُري. هل هناك فواتير ناقصة؟`,
      detail: "الاستهلاك النظري زاد على المتاح شهرين فأكثر. وهذا ليس ربحاً، بل غالباً فاتورة شراء لم تُقيَّد أو لم تُربط بالصنف، أو وصفة تفترض كمية أكبر من المستخدمة.",
      action: "افتح الصنف وتأكد أن فواتيره كاملة ومربوطة، ثم راجع الوصفة.",
      actionLabel: "افتح المشترى والمباع",
      href: "/finance/stock#recurring",
      count: overs.length,
      impact: { kind: "UNATTRIBUTED", amountMinor: overs.reduce((s, g) => s + g.totalMinor, 0) },
      evidence: overs.slice(0, 6).map((g) => ({ label: g.name, sub: `${g.months} أشهر متتالية`, amountMinor: g.totalMinor, href: `/finance/stock/item?id=${g.productId}&month=all` })),
    });
  }

  /*
    رخصةٌ أو إقامةٌ أو عقدٌ يقترب انتهاؤه: الغرامةُ والإغلاقُ أغلى من خطأ فاتورة، ولا
    فاتورةَ تذكّر بها. المنتهي حرج، وما في أسبوعه عالٍ، وما في مهلته متوسّط.
  */
  if ((f.expiringObligations?.length ?? 0) > 0) {
    const list = f.expiringObligations!;
    const expired = list.filter((o) => o.daysLeft < 0).length;
    const soonest = Math.min(...list.map((o) => o.daysLeft));
    out.push({
      id: "obligations-expiring",
      area: "DATA",
      severity: expired > 0 ? "CRITICAL" : soonest <= 7 ? "HIGH" : "MEDIUM",
      title: list.length === 1
        ? `«${list[0].title.slice(0, 50)}» ${list[0].daysLeft < 0 ? "انتهت" : `تنتهي ${formatDay(list[0].expiresOn)}`}`
        : expired > 0
          ? `${countNoun(list.length, PAPER)} منتهية أو قريبة الانتهاء`
          : `${countNoun(list.length, PAPER)} يقترب انتهاؤها`,
      detail: "وثائق أدخلتها بتاريخ انتهائها، وقد انتهت أو دخلت مهلة التذكير التي حدّدتها لها.",
      action: "جدّدها ثم اكتب تاريخها الجديد، أو أجّل التذكير إن كان التجديد جارياً.",
      actionLabel: "افتح الوثائق",
      href: "/settings/obligations",
      count: list.length,
      impact: { kind: "AT_RISK", amountMinor: null },
      evidence: list.slice(0, 6).map((o) => ({
        label: o.title.slice(0, 45),
        sub: `${o.kindLabel} · ${o.daysLeft < 0 ? "انتهت" : "تنتهي"} ${formatDay(o.expiresOn)}`,
      })),
    });
  }

  /* خصمٌ شهريٌّ خرج عن عادته: مرّتين في شهره (يُطالَب به) أو ارتفع (يُسأل عنه). */
  if ((f.recurringAnomalies?.length ?? 0) > 0) {
    const list = f.recurringAnomalies!;
    const twiceMinor = list.filter((a) => a.kind === "TWICE").reduce((s, a) => s + a.amountMinor, 0);
    out.push({
      id: "recurring-anomalies",
      area: "BANK",
      severity: "MEDIUM",
      title: list.length === 1
        ? `«${list[0].label.slice(0, 40)}» ${list[0].kind === "TWICE" ? "خُصم مرتين هذا الشهر" : "ارتفع عن المعتاد"}`
        : `${list.length} خصومات متكرّرة خرجت عن المعتاد`,
      detail: "جهة يُخصم لها كل شهر مبلغ متقارب، وآخر خصم لها تكرّر في الشهر نفسه أو زاد بأكثر من ١٠٪.",
      action: "راجعها: طالب بما خُصم مرتين، واسأل عن الزيادة، أو أسكت التنبيه إن كانت الزيادة متفقاً عليها.",
      actionLabel: "افتح المتكرّر",
      href: "/money/recurring",
      count: list.length,
      amountMinor: twiceMinor > 0 ? twiceMinor : undefined,
      impact: { kind: "RECOVERABLE", amountMinor: twiceMinor > 0 ? twiceMinor : null },
      evidence: list.slice(0, 6).map((a) => ({
        label: a.label.slice(0, 45),
        sub: `${a.kind === "TWICE" ? "خُصم مرتين" : "ارتفع"} · ${formatDay(a.day)}`,
        amountMinor: a.amountMinor,
      })),
    });
  }

  /* مستفيدٌ جديد: للعلم لا للمنع — حين يكون للحساب مفوَّضٌ ثانٍ يرى صاحبُه كلَّ مستفيدٍ مرّة */
  if ((f.firstTransfers?.length ?? 0) > 0) {
    const n = f.firstTransfers!.length;
    out.push({
      id: "first-transfers",
      area: "BANK",
      severity: "MEDIUM",
      title: n === 1 ? "أول حوالة إلى حساب لم تحوّل له من قبل" : `أول حوالات إلى ${n} حسابات لم تحوّل لها من قبل`,
      detail: "آيبان يظهر في كشف البنك لأول مرة وبمبلغ فوق خمسمئة ريال. هذا للعلم: إن كنت أنت من حوّل فأغلق البند.",
      action: "راجع المستفيد والمبلغ. زر «أعرفه» يغلق البند ولا يظهر مرة أخرى.",
      actionLabel: "راجع المستفيدين",
      href: "/attention?item=first-transfers",
      count: n,
      amountMinor: f.firstTransferMinor ?? undefined,
      impact: { kind: "UNATTRIBUTED", amountMinor: f.firstTransferMinor ?? null },
      evidence: f.firstTransfers!.slice(0, 6),
    });
  }

  if ((f.bouncedPayments?.length ?? 0) > 0) {
    const n = f.bouncedPayments!.length;
    out.push({
      id: "bounced-payments",
      area: "BANK",
      severity: "HIGH",
      title: n === 1 ? "حوالة لمورّد خرجت ثم عادت" : `${countNoun(n, TRANSACTION)} لمورّدين خرجت ثم عادت`,
      detail: "رجع المبلغ نفسه إلى الحساب بعد أيام، فالفاتورة التي قُيّدت عليها تبدو مسدَّدة وهي غير مسدَّدة.",
      action: "افتح الحركة. زر «ارتدّت» يردّ الدفعة فتعود الفاتورة مستحقة (ثم أعد التحويل)، وزر «ليست ردّاً» يغلق التنبيه.",
      actionLabel: "افتح الحركة",
      href: f.firstBouncedTransactionId ? txHref(f.firstBouncedTransactionId) : "/bank",
      count: n,
      amountMinor: f.bouncedPaymentMinor ?? undefined,
      impact: { kind: "OWED", amountMinor: f.bouncedPaymentMinor ?? null },
      evidence: f.bouncedPayments!.slice(0, 6),
    });
  }

  /*
    كشفُ المورّد يخالف دفترَنا: فاتورةٌ حُمّلت علينا ولم تُقيَّد (غاناش ٢٩–٣١ يوليو)، أو
    سدادٌ مقيَّدٌ لم يصله. كان يُكتب تنبيهاً على الكشف وحده، فلا يبلغ هذه الصفحة.
  */
  const gaps = f.statementGaps ?? [];
  if (gaps.length > 0) {
    const total = gaps.reduce((s, g) => s + Math.abs(g.gapMinor), 0);
    out.push({
      id: "statement-ledger-gap",
      area: "SUPPLIERS",
      severity: "HIGH",
      title: gaps.length === 1
        ? `كشف ${gaps[0].supplierName} يختلف عن دفترنا بمقدار ${formatRiyalsDisplay(total)}`
        : `${countNoun(gaps.length, SUPPLIER)} يختلف كشفهم عن دفترنا`,
      detail: "ما يطالبك به المورّد في آخر كشفه يختلف عمّا تدين له به في دفترك: فاتورة في كشفه لم تصلك، أو سداد قيّدته ولم يصله.",
      action: "افتح الكشف. استخدم «قيّدها من الكشف» للفواتير التي لا ملف لها، أو اطلب من المورّد ما ينقص.",
      actionLabel: "افتح الكشف",
      href: gaps.length === 1 ? `/statements?supplier=${encodeURIComponent(gaps[0].slug)}` : "/statements",
      count: gaps.length,
      amountMinor: total,
      impact: { kind: "UNATTRIBUTED", amountMinor: total },
      evidence: gaps.map((g) => ({
        label: g.supplierName,
        sub: `في كشفه ${formatRiyalsDisplay(g.theirsMinor)} يوم ${formatDay(g.day)} · وفي دفترنا ${g.oursMinor >= 0 ? formatRiyalsDisplay(g.oursMinor) : `رصيد لنا عنده ${formatRiyalsDisplay(-g.oursMinor)}`}`,
        amountMinor: Math.abs(g.gapMinor),
        href: `/statements?supplier=${encodeURIComponent(g.slug)}`,
      })),
    });
  }

  /* ── متوسّط ── */
  const misplaced = f.misplacedFiles ?? [];
  if (misplaced.length > 0) {
    out.push({
      id: "files-wrong-month",
      area: "DATA",
      severity: "MEDIUM",
      title: `${countNoun(misplaced.length, DOCUMENT)} في مجلد شهر غير شهر الفاتورة`,
      detail: "قُيّدت في شهرها الصحيح حسب تاريخ الفاتورة، لكن من يبحث في الدرايف بالشهر لن يجدها. والنظام لا ينقل شيئاً في الأرشيف.",
      action: "انقلها في الدرايف إلى مجلد شهرها، وسيختفي التنبيه في المزامنة التالية.",
      actionLabel: "افتح الدرايف",
      href: "/documents/drive",
      count: misplaced.length,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: misplaced,
    });
  }

  const missingFiles = f.missingFiles ?? [];
  if (missingFiles.length > 0) {
    out.push({
      id: "files-missing-in-drive",
      area: "DATA",
      severity: "MEDIUM",
      title: `${countNoun(missingFiles.length, DOCUMENT)} مقيّدة ولم يعد ملفها في الدرايف`,
      detail: "القيد موجود لكن الملف غاب، فقد حُذف أو نُقل إلى سلّة المحذوفات. والفاتورة بلا ملفها لا تثبت خصم ضريبتها عند الفحص.",
      action: "استعدها من سلّة الدرايف (تُفرَّغ بعد ثلاثين يوماً)، وسيختفي التنبيه في المزامنة التالية.",
      actionLabel: "افتح الدرايف",
      href: "/documents/drive",
      count: missingFiles.length,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: missingFiles,
    });
  }

  if ((f.suppliersMissingStatementCount ?? f.suppliersMissingStatement.length) > 0) {
    const missingCount = f.suppliersMissingStatementCount ?? f.suppliersMissingStatement.length;
    out.push({
      id: "missing-statements",
      area: "SUPPLIERS",
      severity: "MEDIUM",
      /* الضميرُ يتبع العدد: «كشفُه» لواحد، و«كشفُهما» لاثنين، و«كشوفُهم» لما فوقهما */
      title: `${countNoun(missingCount, SUPPLIER)} ${missingCount === 1 ? "لم يصل كشفه" : missingCount === 2 ? "لم يصل كشفهما" : "لم تصل كشوفهم"}`,
      detail: "كشف المورّد وحده يُظهر فاتورة حُمّلت عليك ولم تصلك، ولا يظهر ذلك في أرشيفك مهما بحثت.",
      action: "اطلب الكشف الشهري منهم، ثم طابقه.",
      actionLabel: "اطلب الكشوف",
      /* تسمّي الغائبين — والصفحة بلا مرشِّح تعرض ما وصل لا ما غاب (BTN-110) */
      href: "/statements?missing=1",
      count: missingCount,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: f.suppliersMissingStatement.map((name) => ({ label: name })),
    });
  }

  if (f.unknownTaxCount > 0) {
    out.push({
      id: "unknown-tax",
      area: "DATA",
      severity: "MEDIUM",
      title: `${countNoun(f.unknownTaxCount, INVOICE)} لم يُقرأ تفصيلها الضريبي`,
      // الفرق عن «غير صالحة» مقصود: هذه تُقرأ، وتلك يُطالَب مورّدها
      detail: "حالتها الضريبية غير معروفة، وليست غير صالحة. لا تطالب مورّدها قبل قراءتها.",
      action: "اقرأ محتواها من صفحة المستندات.",
      actionLabel: "اقرأ تفصيلها",
      href: "/purchases/invoices?tax=UNKNOWN",
      count: f.unknownTaxCount,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: f.unknownTaxEvidence,
    });
  }

  const unrecorded = f.unrecordedInvoices ?? [];
  if (unrecorded.length > 0) {
    const known = unrecorded.filter((e) => e.amountMinor !== undefined);
    out.push({
      id: "unrecorded-invoices",
      area: "INVOICES",
      severity: "HIGH",
      title: `${countNoun(unrecorded.length, INVOICE)} أُرشفت ولم تُقيَّد`,
      detail: "مستندات فواتير في الأرشيف ليس لها فاتورة مقيّدة، فلا تدخل في «كم أدين» ولا في دفعة الشهر، والمستحق أقل من حقيقته بقدرها.",
      action: "افتح كل مستند: قيّده بضغطة إن كان فاتورة، أو ارفضه إن كان نسخة من فاتورة مقيّدة.",
      actionLabel: "قيّدها أو ارفضها",
      href: unrecorded[0].href ?? "/documents",
      count: unrecorded.length,
      impact: {
        kind: "OWED",
        amountMinor: known.length === unrecorded.length ? known.reduce((n, e) => n + (e.amountMinor ?? 0), 0) : null,
      },
      evidence: unrecorded,
    });
  }

  if (f.invoicesWithoutLines > 0) {
    out.push({
      id: "no-lines",
      area: "DATA",
      severity: "MEDIUM",
      title: `${countNoun(f.invoicesWithoutLines, INVOICE)} بدون بنود`,
      detail: "تحليل الأصناف والأسعار لا يشملها، فأرقامه ناقصة بقدرها.",
      action: "اقرأ محتواها ليكتمل التحليل.",
      actionLabel: "اقرأ بنودها",
      href: "/purchases/invoices?noLines=1",
      count: f.invoicesWithoutLines,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: [],
    });
  }

  if (f.pendingDocuments > 0) {
    out.push({
      id: "pending-documents",
      area: "INVOICES",
      severity: "MEDIUM",
      title: `${countNoun(f.pendingDocuments, DOCUMENT)} لم يُبتّ فيه`,
      detail: "مرفوع ولم يُعتمد ولم يُرفض بعد.",
      action: "راجعه واعتمده أو ارفضه.",
      actionLabel: "اعتمدها أو ارفضها",
      href: "/documents?status=NEEDS_REVIEW",
      count: f.pendingDocuments,
      impact: { kind: "BLOCKED", amountMinor: null },
      evidence: [],
    });
  }

  if (f.suppliersWithoutContract.length > 0) {
    out.push({
      id: "no-contract",
      area: "SUPPLIERS",
      severity: "MEDIUM",
      title: `${countNoun(f.suppliersWithoutContract.length, SUPPLIER)} لا يصدر فواتير وبدون عقد`,
      detail: `${f.suppliersWithoutContract.join(" · ")}: بدون عقد لا يمكن خصم الضريبة ولا إثبات المصروف.`,
      action: "وقّع عقد توريد مكتوباً، أو استبدل به مورّداً يصدر فواتير ضريبية.",
      actionLabel: "حدّد سياسة مستنداتهم",
      href: "/suppliers#no-contract",
      count: f.suppliersWithoutContract.length,
      impact: { kind: "AT_RISK", amountMinor: null },
      evidence: f.suppliersWithoutContractEvidence ?? f.suppliersWithoutContract.map((name) => ({ label: name })),
    });
  }

  return out.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || (b.amountMinor ?? 0) - (a.amountMinor ?? 0),
  );
}

/**
 * أهمّ ثلاثة، ثمّ الباقي.
 *
 * أربعة عشر بنداً معروضة دفعةً واحدة ليست أولويّة بل قائمة. والترتيب
 * بالشدّة وحدها يضع «فرصة توفير ٦٬٤٠٠ سنويّاً» تحت «مستند لم يُقرأ»،
 * فيُقدَّم الأثر المعلوم على الشدّة حين يكون كبيراً.
 *
 * البند بلا مبلغ لا يُدفع إلى الذيل: قد يكون مانعاً لإقفال شهر.
 */
export function prioritize(
  items: readonly AttentionItem[],
  limit = 3,
): { top: AttentionItem[]; rest: AttentionItem[] } {
  const sorted = [...items].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      (b.impact.amountMinor ?? 0) - (a.impact.amountMinor ?? 0) ||
      a.id.localeCompare(b.id),
  );
  return { top: sorted.slice(0, limit), rest: sorted.slice(limit) };
}

/**
 * مجموع الأثر بحسب نوعه.
 *
 * لا تُجمع الأنواع بعضها إلى بعض: ريالٌ قد يُسترد ليس كريالٍ معرَّض
 * للرفض وليس كتقديرٍ سنويّ. وجمعها يُنتج رقماً ضخماً لا معنى له.
 */
export function impactByKind(
  items: readonly AttentionItem[],
): Partial<Record<ImpactKind, { amountMinor: number; count: number }>> {
  const out: Partial<Record<ImpactKind, { amountMinor: number; count: number }>> = {};
  for (const i of items) {
    const bucket = (out[i.impact.kind] ??= { amountMinor: 0, count: 0 });
    bucket.count++;
    bucket.amountMinor += i.impact.amountMinor ?? 0;
  }
  return out;
}

/** عدّ سريع للعرض في القائمة العلوية. */
export function countBySeverity(items: readonly AttentionItem[]): Record<AttentionSeverity, number> {
  const out: Record<AttentionSeverity, number> = {
    CRITICAL: 0, HIGH: 0, MEDIUM: 0, OPPORTUNITY: 0,
  };
  for (const i of items) out[i.severity]++;
  return out;
}
