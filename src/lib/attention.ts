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
  HIGH: "عالٍ",
  MEDIUM: "متوسّط",
  OPPORTUNITY: "فرصة",
};

export interface AttentionEvidence {
  label: string;
  sub?: string;
  amountMinor?: number;
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
  AT_RISK: "معرَّض للضياع",
  ANNUAL: "أثر سنويّ مقدَّر",
  OWED: "مستحقّ عليك",
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
  /** دفعات يُشتبه بتكرارها */
  duplicatePayments: number;
  duplicatePaymentAmountMinor: number;

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

  /** مورّدون لهم فواتير ولم يصل كشفهم */
  suppliersMissingStatement: string[];
  /** مورّدون لا يصدرون فواتير وبلا عقد */
  suppliersWithoutContract: string[];

  /** فواتير بلا بنود — تحليل الأصناف لا يراها */
  invoicesWithoutLines: number;

  /** أصناف ارتفع سعرها عند مورّدها */
  priceRises: AttentionEvidence[];
  priceRiseAnnualMinor: number;
}

const RANK: Record<AttentionSeverity, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, OPPORTUNITY: 3,
};

const riyals = (m: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Math.abs(m) / 100);

export function buildAttention(f: AttentionFacts): AttentionItem[] {
  const out: AttentionItem[] = [];

  /* ── حرج ── */
  if (f.duplicatePayments > 0) {
    out.push({
      id: "duplicate-payments",
      area: "BANK",
      severity: "CRITICAL",
      title: `${f.duplicatePayments} دفعة يُشتبه بتكرارها`,
      detail: "تحويلان لنفس الجهة بنفس المبلغ في نفس اليوم.",
      action: "راجعها فوراً — استرداد المكرّر يصعب كلّما تأخّر.",
      actionLabel: "افتح الحركات",
      href: "/bank",
      count: f.duplicatePayments,
      amountMinor: f.duplicatePaymentAmountMinor,
      impact: { kind: "RECOVERABLE", amountMinor: f.duplicatePaymentAmountMinor },
      evidence: [],
    });
  }

  if (f.openBlockers > 0) {
    out.push({
      id: "open-blockers",
      area: "DATA",
      severity: "CRITICAL",
      title: `${f.openBlockers} تنبيه مانع لم يُعالَج`,
      detail: "يمنع إقفال الشهر ويشوّه أرقامه.",
      action: "عالجها أو تجاوزها بسبب مكتوب.",
      actionLabel: "افتح ما يحتاج مراجعة",
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
      title: `${riyals(f.vatAtRiskMinor)} ريال ضريبة مدخلات معرّضة للضياع`,
      detail: `${f.notTaxValidCount} فاتورة لا تحمل الأركان الأربعة، فلا يجوز خصم ضريبتها.`,
      action: "اطلب من هؤلاء المورّدين فاتورة ضريبية كاملة تحمل رقمنا الضريبي.",
      actionLabel: "افتح الفواتير الناقصة",
      href: "/purchases/invoices?tax=INVALID",
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
      title: `${riyals(f.overdueMinor)} ريال مستحقّة منذ أكثر من ٦٠ يوماً`,
      detail: "التأخّر الطويل يفسد شروط التوريد ويضعف تفاوضك.",
      action: "أدرجها في دفعة أوّل الشهر.",
      actionLabel: "افتح المتأخّرة",
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
      title: `${f.unclassifiedBankTx} حركة بنكية لم تُصنَّف`,
      detail: `بقيمة ${riyals(f.unclassifiedBankAmountMinor)} ريال. ما لم يُصنَّف يبقى محسوباً على المورّدين ظلماً.`,
      action: "صنّفها مرّة — يُحفظ التصنيف قاعدةً تسري على أمثاله في كل كشف بعده.",
      actionLabel: "افتح الحركات",
      href: "/bank",
      count: f.unclassifiedBankTx,
      amountMinor: f.unclassifiedBankAmountMinor,
      impact: { kind: "UNATTRIBUTED", amountMinor: f.unclassifiedBankAmountMinor },
      evidence: [],
    });
  }

  if (f.priceRiseAnnualMinor > 0) {
    out.push({
      id: "price-rises",
      area: "SUPPLIERS",
      severity: f.priceRiseAnnualMinor > 100_000 ? "HIGH" : "MEDIUM",
      title: `ارتفاع الأسعار يكلّفك ${riyals(f.priceRiseAnnualMinor)} ريال سنوياً`,
      detail: `${f.priceRises.length} صنفاً ارتفع سعره عند مورّده.`,
      action: "فاوض على الثلاثة الأعلى أثراً، واطلب عرضاً من مورّد بديل لتفاوض بورقة في يدك.",
      actionLabel: "افتح الأصناف",
      href: "/analysis",
      count: f.priceRises.length,
      amountMinor: f.priceRiseAnnualMinor,
      impact: { kind: "ANNUAL", amountMinor: f.priceRiseAnnualMinor },
      evidence: f.priceRises,
    });
  }

  /* ── متوسّط ── */
  if (f.suppliersMissingStatement.length > 0) {
    out.push({
      id: "missing-statements",
      area: "SUPPLIERS",
      severity: "MEDIUM",
      title: `${f.suppliersMissingStatement.length} مورّد لم يصل كشفه`,
      detail: "الكشف وحده يكشف فاتورة حُمّلت عليك ولم تصلك — ولا يظهر ذلك في أرشيفك مهما فتّشته.",
      action: "اطلب الكشف الشهري منهم، ثمّ طابقه.",
      actionLabel: "اطلب الكشوف",
      href: "/statements",
      count: f.suppliersMissingStatement.length,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: f.suppliersMissingStatement.map((name) => ({ label: name })),
    });
  }

  if (f.unknownTaxCount > 0) {
    out.push({
      id: "unknown-tax",
      area: "DATA",
      severity: "MEDIUM",
      title: `${f.unknownTaxCount} فاتورة لم يُقرأ تفصيلها الضريبي`,
      // الفرق عن «غير صالحة» مقصود: هذه تُقرأ، وتلك يُطالَب مورّدها
      detail: "حالتها مجهولة لا غير صالحة. لا تُطالِب مورّدها قبل قراءتها.",
      action: "اقرأ محتواها من صفحة المستندات.",
      actionLabel: "افتح ما لم يُقرأ",
      href: "/purchases/invoices?tax=UNKNOWN",
      count: f.unknownTaxCount,
      impact: { kind: "UNATTRIBUTED", amountMinor: null },
      evidence: f.unknownTaxEvidence,
    });
  }

  if (f.invoicesWithoutLines > 0) {
    out.push({
      id: "no-lines",
      area: "DATA",
      severity: "MEDIUM",
      title: `${f.invoicesWithoutLines} فاتورة بلا بنود`,
      detail: "تحليل الأصناف والأسعار لا يراها، فأرقامه ناقصة بقدرها.",
      action: "اقرأ محتواها ليكتمل التحليل.",
      actionLabel: "افتح فواتير بلا بنود",
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
      title: `${f.pendingDocuments} مستند لم يُبتّ فيه`,
      detail: "مرفوع ولم يُعتمد ولم يُرفض.",
      action: "راجعه واعتمده أو ارفضه.",
      actionLabel: "افتح الوارد",
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
      title: `${f.suppliersWithoutContract.length} مورّد لا يصدر فواتير وبلا عقد`,
      detail: `${f.suppliersWithoutContract.join(" · ")} — بلا عقد لا خصم ضريبة ولا إثبات مصروف.`,
      action: "وقّع عقد توريد مكتوباً، أو استبدله بمورّد يصدر فواتير ضريبية.",
      actionLabel: "افتح المورّدين",
      href: "/suppliers",
      count: f.suppliersWithoutContract.length,
      impact: { kind: "AT_RISK", amountMinor: null },
      evidence: f.suppliersWithoutContract.map((name) => ({ label: name })),
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
