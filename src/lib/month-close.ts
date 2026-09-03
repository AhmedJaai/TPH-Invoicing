/**
 * قائمة تحقّق إقفال الشهر.
 *
 * الإقفال إعلانٌ بأنّ الشهر تمّ: كل فاتورة وصلت، وكلّ خلل عُولج أو تُجووز
 * عمداً. فلا يكون زرّاً يُضغط، بل قائمةً تُقرأ.
 *
 * والمانع يُفرَّق عن التنبيه: المانع خللٌ في البيانات نفسها لا يجوز إقفال
 * شهر عليه، والتنبيه واقعٌ قد يقرّ به المالك ويمضي — كفاتورة مورّد لا يصدر
 * فواتير ضريبية. الخلط بينهما يجعل القائمة إمّا مستحيلة أو بلا معنى.
 *
 * دالة خالصة: تأخذ حقائق الشهر وتُرجع القائمة.
 */

export type CheckState = "PASS" | "WARN" | "BLOCK";

export interface CheckItem {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  action?: string;
}

export interface MonthFacts {
  month: string;
  invoiceCount: number;
  notTaxValidCount: number;
  unpaidCount: number;
  unpaidTotalMinor: number;
  unpostedCount: number;
  fixedAssetCount: number;
  openBlockerIssues: number;
  documentsNeedingReview: number;
  /** مورّدون لهم فواتير في الشهر */
  suppliersWithInvoices: number;
  /** منهم من وصل كشفه عن الشهر */
  suppliersWithStatement: number;
  bankImportCoversMonth: boolean;
}

export interface MonthCloseReport {
  month: string;
  items: CheckItem[];
  blockers: CheckItem[];
  warnings: CheckItem[];
  canClose: boolean;
}

const riyals = (m: number) =>
  (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildMonthClose(facts: MonthFacts): MonthCloseReport {
  const items: CheckItem[] = [];

  /*
   * الشهر بلا فواتير: يمنع الإقفال عمداً.
   * الأرجح أنّ الفواتير لم تُرفع بعد لا أنّه لم يُشترَ شيء، وإقفال شهر فارغ
   * يُغلق الباب على فواتير في الطريق.
   */
  items.push({
    id: "has-invoices",
    label: "فواتير الشهر مرفوعة",
    state: facts.invoiceCount > 0 ? "PASS" : "BLOCK",
    detail:
      facts.invoiceCount > 0
        ? `${facts.invoiceCount} فاتورة في ${facts.month}`
        : "لا فاتورة واحدة في هذا الشهر",
    action: facts.invoiceCount > 0 ? undefined : "ارفع فواتير الشهر أو زامن الدرايف قبل الإقفال",
  });

  items.push({
    id: "no-blockers",
    label: "لا تنبيهات مانعة مفتوحة",
    state: facts.openBlockerIssues === 0 ? "PASS" : "BLOCK",
    detail:
      facts.openBlockerIssues === 0
        ? "لا شيء يمنع"
        : `${facts.openBlockerIssues} تنبيه مانع لم يُعالَج`,
    action: facts.openBlockerIssues === 0 ? undefined : "عالجها أو تجاوزها بسبب مكتوب",
  });

  items.push({
    id: "no-pending-review",
    label: "لا مستندات معلّقة للمراجعة",
    state: facts.documentsNeedingReview === 0 ? "PASS" : "BLOCK",
    detail:
      facts.documentsNeedingReview === 0
        ? "كل مستندات الشهر مؤرشفة"
        : `${facts.documentsNeedingReview} مستند لم يُبتّ فيه`,
    action: facts.documentsNeedingReview === 0 ? undefined : "راجعها وأرشفها أو ارفضها",
  });

  items.push({
    id: "tax-valid",
    label: "كل الفواتير ضريبية كاملة",
    state: facts.notTaxValidCount === 0 ? "PASS" : "WARN",
    detail:
      facts.notTaxValidCount === 0
        ? "كلّها تصلح لخصم المدخلات"
        : `${facts.notTaxValidCount} فاتورة لا تصلح لخصم المدخلات`,
    action: facts.notTaxValidCount === 0 ? undefined : "اطلب البديل من المورّد قبل السداد",
  });

  items.push({
    id: "paid",
    label: "مستحقّات الشهر مسدَّدة",
    state: facts.unpaidCount === 0 ? "PASS" : "WARN",
    detail:
      facts.unpaidCount === 0
        ? "لا رصيد مستحق"
        : `${facts.unpaidCount} فاتورة بقيمة ${riyals(facts.unpaidTotalMinor)} ريال`,
    action: facts.unpaidCount === 0 ? undefined : "أدرجها في دفعة أوّل الشهر أو اعتمدها مسدَّدة",
  });

  items.push({
    id: "posted",
    label: "كل الفواتير مقيَّدة محاسبياً",
    state: facts.unpostedCount === 0 ? "PASS" : "WARN",
    detail:
      facts.unpostedCount === 0
        ? "لا شيء معلّق عن القيد"
        : `${facts.unpostedCount} فاتورة لم تُقيَّد`,
    action: facts.unpostedCount === 0 ? undefined : "قيّدها — الفاتورة غير المقيَّدة تختفي من التقارير",
  });

  const missingStatements = Math.max(0, facts.suppliersWithInvoices - facts.suppliersWithStatement);
  items.push({
    id: "statements",
    label: "كشوف المورّدين وصلت وطوبقت",
    state: missingStatements === 0 ? "PASS" : "WARN",
    detail:
      missingStatements === 0
        ? `كشوف ${facts.suppliersWithInvoices} مورّداً كاملة`
        : `${missingStatements} من ${facts.suppliersWithInvoices} مورّداً لم يصل كشفه`,
    action:
      missingStatements === 0
        ? undefined
        : "اطلب الكشف — هو وحده يكشف فاتورة حُمّلت عليك ولم تصلك",
  });

  items.push({
    id: "bank",
    label: "كشف البنك مستورد ويغطّي الشهر",
    state: facts.bankImportCoversMonth ? "PASS" : "WARN",
    detail: facts.bankImportCoversMonth ? "السداد مثبت بحركات بنكية" : "لم يُستورد كشف بنك يغطّي الشهر",
    action: facts.bankImportCoversMonth ? undefined : "استورد كشف الحساب من صفحة السداد",
  });

  if (facts.fixedAssetCount > 0) {
    items.push({
      id: "fixed-assets",
      label: "الأصول الثابتة رُوجعت",
      state: "WARN",
      detail: `${facts.fixedAssetCount} فاتورة فوق حدّ الرسملة`,
      action: "راجعها مع المحاسب — صرفها دفعة واحدة يشوّه ربح الشهر",
    });
  }

  const blockers = items.filter((i) => i.state === "BLOCK");
  const warnings = items.filter((i) => i.state === "WARN");

  return { month: facts.month, items, blockers, warnings, canClose: blockers.length === 0 };
}
