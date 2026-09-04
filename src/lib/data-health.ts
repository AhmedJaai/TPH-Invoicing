/**
 * صحّة البيانات.
 *
 * الرقم بلا بيان تغطيته يخدع. أن يقول النظام «هامش الربح ٧١٪» وهو لا يملك
 * تكلفة إلا ثلث المشتريات كذبٌ بثقة. فيُعرض مع كل رقم مدى اكتمال ما بُني
 * عليه، وما لم يُوصَل بعد يُقال عنه «غير موصول» لا يُملأ بصفر.
 *
 * دالة خالصة: تأخذ عدّات وتُرجع تقييماً.
 */

export type HealthState = "GOOD" | "PARTIAL" | "MISSING" | "NOT_CONNECTED";

export interface HealthMetric {
  id: string;
  label: string;
  state: HealthState;
  /** من صفر إلى واحد؛ فارغة لما ليس موصولاً */
  coverage: number | null;
  known: number;
  total: number;
  detail: string;
  /** ما الذي يُصلحه */
  action?: string;
}

export interface HealthInput {
  documents: number;
  invoices: number;
  /** فواتير لها بنود مسجّلة */
  invoicesWithLines: number;
  /** فواتير عُرف تفصيلها الضريبي */
  invoicesWithTaxDetail: number;
  /** أشهر فيها فواتير */
  monthsWithInvoices: number;
  /** أشهر يغطّيها كشف بنك مستورد */
  monthsWithBank: number;
  /** مورّدون لهم فواتير */
  suppliersWithInvoices: number;
  /** منهم من وصل كشفه ولو مرّة */
  suppliersWithStatements: number;
  /** حركات بنكية لم تُصنَّف بعد */
  unclassifiedBankTx: number;
  bankTx: number;
}

export interface DataHealth {
  metrics: HealthMetric[];
  /** ثقة الأرقام المالية إجمالاً — متوسّط ما هو موصول */
  confidence: number;
  connected: number;
  notConnected: number;
}

function ratio(known: number, total: number): number {
  return total === 0 ? 0 : known / total;
}

function stateOf(coverage: number, total: number): HealthState {
  if (total === 0) return "MISSING";
  if (coverage >= 0.95) return "GOOD";
  if (coverage > 0) return "PARTIAL";
  return "MISSING";
}

function pct(v: number): string {
  return `${Math.round(v * 100)}٪`;
}

export function buildDataHealth(input: HealthInput): DataHealth {
  const metrics: HealthMetric[] = [];

  const invoiceCoverage = ratio(input.invoices, Math.max(input.invoices, 1));
  metrics.push({
    id: "invoices",
    label: "الفواتير مسجّلة",
    state: input.invoices > 0 ? "GOOD" : "MISSING",
    coverage: input.invoices > 0 ? invoiceCoverage : 0,
    known: input.invoices,
    total: input.invoices,
    detail: input.invoices > 0 ? `${input.invoices} فاتورة` : "لا فواتير بعد",
    action: input.invoices > 0 ? undefined : "ارفع فواتيرك أو زامن الدرايف",
  });

  const lines = ratio(input.invoicesWithLines, input.invoices);
  metrics.push({
    id: "lines",
    label: "بنود الفواتير",
    state: stateOf(lines, input.invoices),
    coverage: lines,
    known: input.invoicesWithLines,
    total: input.invoices,
    detail: `${input.invoicesWithLines} من ${input.invoices} فاتورة لها بنود (${pct(lines)})`,
    action: lines >= 0.95 ? undefined : "اقرأ محتوى الفواتير الباقية — بلا بنود لا تحليل أصناف",
  });

  const tax = ratio(input.invoicesWithTaxDetail, input.invoices);
  metrics.push({
    id: "tax",
    label: "التفصيل الضريبي",
    state: stateOf(tax, input.invoices),
    coverage: tax,
    known: input.invoicesWithTaxDetail,
    total: input.invoices,
    detail: `${input.invoicesWithTaxDetail} من ${input.invoices} فاتورة عُرفت ضريبتها (${pct(tax)})`,
    action: tax >= 0.95 ? undefined : "الباقي حالته مجهولة لا غير صالحة — اقرأ مستنداتها",
  });

  const bank = ratio(input.monthsWithBank, input.monthsWithInvoices);
  metrics.push({
    id: "bank",
    label: "تغطية كشف البنك",
    state: stateOf(bank, input.monthsWithInvoices),
    coverage: bank,
    known: input.monthsWithBank,
    total: input.monthsWithInvoices,
    detail:
      input.monthsWithInvoices === 0
        ? "لا أشهر بعد"
        : `${input.monthsWithBank} من ${input.monthsWithInvoices} شهراً يغطّيه كشف`,
    action: bank >= 0.95 ? undefined : "استورد كشف الحساب للأشهر الناقصة",
  });

  const classified = ratio(input.bankTx - input.unclassifiedBankTx, Math.max(input.bankTx, 1));
  metrics.push({
    id: "bank-classified",
    label: "تصنيف الحركات البنكية",
    state: input.bankTx === 0 ? "MISSING" : stateOf(classified, input.bankTx),
    coverage: input.bankTx === 0 ? 0 : classified,
    known: input.bankTx - input.unclassifiedBankTx,
    total: input.bankTx,
    detail:
      input.bankTx === 0
        ? "لا حركات بعد"
        : `${input.unclassifiedBankTx} حركة لم تُصنَّف بعد`,
    action: input.unclassifiedBankTx === 0 ? undefined : "صنّفها من صفحة المال — تصنيف واحد يسري على أمثاله",
  });

  const statements = ratio(input.suppliersWithStatements, input.suppliersWithInvoices);
  metrics.push({
    id: "statements",
    label: "كشوف المورّدين",
    state: stateOf(statements, input.suppliersWithInvoices),
    coverage: statements,
    known: input.suppliersWithStatements,
    total: input.suppliersWithInvoices,
    detail:
      input.suppliersWithInvoices === 0
        ? "لا مورّدين بعد"
        : `${input.suppliersWithStatements} من ${input.suppliersWithInvoices} مورّداً وصل كشفه`,
    action: statements >= 0.95 ? undefined : "اطلب الكشوف — هي وحدها تكشف فاتورة حُمّلت عليك ولم تصلك",
  });

  /*
   * ما لم يُوصَل يُقال عنه «غير موصول» ولا يُملأ بصفر ولا ببيانات وهمية.
   * صفرُ المبيعات يوحي بأنّ المقهى لم يبع شيئاً، وذلك أسوأ من الفراغ.
   */
  metrics.push({
    id: "sales",
    label: "المبيعات",
    state: "NOT_CONNECTED",
    coverage: null,
    known: 0,
    total: 0,
    detail: "غير موصولة — لا مصدر مبيعات بعد",
    action: "ربط نقطة البيع لاحقاً يفتح هامش الربح وتكلفة المبيعات",
  });

  metrics.push({
    id: "inventory",
    label: "المخزون",
    state: "NOT_CONNECTED",
    coverage: null,
    known: 0,
    total: 0,
    detail: "غير موصول",
    action: "يحتاج المبيعات والوصفات أوّلاً",
  });

  const measurable = metrics.filter((m) => m.coverage !== null);
  const confidence =
    measurable.length === 0 ? 0 : measurable.reduce((s, m) => s + (m.coverage ?? 0), 0) / measurable.length;

  return {
    metrics,
    confidence,
    connected: measurable.length,
    notConnected: metrics.length - measurable.length,
  };
}
