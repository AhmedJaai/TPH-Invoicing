import { DAY, INVOICE, MONTH, SUPPLIER, TRANSACTION, countNoun } from "./arabic";
import { addDays, formatDay } from "./riyadh-time";
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
  /**
   * المبيعاتُ من فودكس (`sales`): أيّامٌ فيها مبيعات، وأوّلُها وآخرُها. كان البندُ
   * مكتوباً «غير موصولة» بيدٍ وفودكس موصولٌ وقائمةُ الدخل تقرأ إيراده — والغيابُ
   * (`undefined`) لا يُقرأ صفراً: «غير موصولة» حتى تصل أوّلُ مبيعات.
   */
  sales?: { days: number; firstDay: string | null; lastDay: string | null };
  /** الجردُ المعتمد: عددُه وآخرُ يومٍ عُدّ */
  inventory?: { counts: number; lastDay: string | null };
  /** اليوم بتوقيت الرياض — لقياس تغطية المبيعات وقِدَم الجرد */
  today?: string;
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
    label: "الفواتير المسجّلة",
    state: input.invoices > 0 ? "GOOD" : "MISSING",
    coverage: input.invoices > 0 ? invoiceCoverage : 0,
    known: input.invoices,
    total: input.invoices,
    detail: input.invoices > 0 ? `${countNoun(input.invoices, INVOICE)}` : "لا فواتير بعد",
    action: input.invoices > 0 ? undefined : "ارفع فواتيرك، أو زامن الدرايف",
  });

  const lines = ratio(input.invoicesWithLines, input.invoices);
  metrics.push({
    id: "lines",
    label: "بنود الفواتير",
    state: stateOf(lines, input.invoices),
    coverage: lines,
    known: input.invoicesWithLines,
    total: input.invoices,
    detail: `${input.invoicesWithLines} من ${countNoun(input.invoices, INVOICE)} لها بنود (${pct(lines)})`,
    action: lines >= 0.95 ? undefined : "اقرأ محتوى باقي الفواتير، فبدون البنود لا يمكن تحليل الأصناف",
  });

  const tax = ratio(input.invoicesWithTaxDetail, input.invoices);
  metrics.push({
    id: "tax",
    label: "التفصيل الضريبي",
    state: stateOf(tax, input.invoices),
    coverage: tax,
    known: input.invoicesWithTaxDetail,
    total: input.invoices,
    detail: `${input.invoicesWithTaxDetail} من ${countNoun(input.invoices, INVOICE)} قُرئ تفصيلها الضريبي (${pct(tax)})`,
    action: tax >= 0.95 ? undefined : "باقي الفواتير حالتها غير معروفة لا غير صالحة، فاقرأ مستنداتها",
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
        : `${input.monthsWithBank} من ${countNoun(input.monthsWithInvoices, MONTH)} له كشف بنك`,
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
        : `${countNoun(input.unclassifiedBankTx, TRANSACTION)} لم تُصنَّف بعد`,
    action: input.unclassifiedBankTx === 0 ? undefined : "صنّفها من صفحة المال، فالتصنيف الواحد يُطبَّق على الحركات المشابهة",
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
        : `${input.suppliersWithStatements} من ${countNoun(input.suppliersWithInvoices, SUPPLIER)} وصلنا كشف حسابه`,
    action: statements >= 0.95 ? undefined : "اطلب الكشوف من المورّدين، فهي وحدها تكشف أي فاتورة سُجّلت عليك ولم تصلك",
  });

  /*
   * ما لم يُوصَل يُقال عنه «غير موصول» ولا يُملأ بصفر ولا ببيانات وهمية.
   * صفرُ المبيعات يوحي بأنّ المقهى لم يبع شيئاً، وذلك أسوأ من الفراغ.
   */
  const sales = input.sales;
  if (!sales || sales.days === 0 || !sales.firstDay || !sales.lastDay || !input.today) {
    metrics.push({
      id: "sales",
      label: "المبيعات",
      state: "NOT_CONNECTED",
      coverage: null,
      known: 0,
      total: 0,
      detail: "غير موصولة: لم تصل مبيعات من فودكس بعد",
      action: "زامن فودكس من «المالية ← المبيعات»، أو ارفع ملف مبيعاته من «الجرد ← الاستيراد»",
    });
  } else {
    /* الأيّامُ من أوّل يوم بيعٍ حتى أمس — اليومُ لم يُقفل بعد */
    const until = addDays(input.today, -1) < sales.lastDay ? sales.lastDay : addDays(input.today, -1);
    const expected = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${sales.firstDay}T00:00:00Z`)) / 86_400_000) + 1;
    const cov = ratio(Math.min(sales.days, expected), expected);
    const stale = sales.lastDay < addDays(input.today, -3);
    metrics.push({
      id: "sales",
      label: "المبيعات",
      state: stale ? "PARTIAL" : stateOf(cov, expected),
      coverage: cov,
      known: sales.days,
      total: expected,
      detail: `${sales.days} من ${countNoun(expected, DAY)} منذ ${formatDay(sales.firstDay)} فيها مبيعات (${pct(cov)}) · آخرها ${formatDay(sales.lastDay)}`,
      action: stale
        ? "آخر مبيعات وصلت قبل أكثر من ثلاثة أيام، فزامن فودكس من «المالية ← المبيعات»"
        : cov >= 0.95 ? undefined : "الأيام الناقصة بلا مبيعات في فودكس: إن كان المقهى مفتوحاً فيها فزامن فودكس",
    });
  }

  const inv = input.inventory;
  if (!inv || inv.counts === 0 || !inv.lastDay || !input.today) {
    metrics.push({
      id: "inventory",
      label: "المخزون",
      state: "NOT_CONNECTED",
      coverage: null,
      known: 0,
      total: 0,
      detail: "لا جرد معتمد بعد",
      action: "اعتمد جرداً من «الجرد» ليُحسب المخزون وتكلفة المبيعات بالجرد",
    });
  } else {
    const ageDays = Math.round((Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${inv.lastDay}T00:00:00Z`)) / 86_400_000);
    /* جردٌ كلّ شهرٍ على الأقلّ يجعل تكلفةَ كلّ شهرٍ بالجرد — وما فات الأربعين يوماً ناقص */
    const fresh = ageDays <= 40;
    metrics.push({
      id: "inventory",
      label: "المخزون",
      state: fresh ? "GOOD" : "PARTIAL",
      coverage: fresh ? 1 : 0.5,
      known: inv.counts,
      total: inv.counts,
      detail: `${inv.counts === 1 ? "جرد معتمد واحد" : inv.counts === 2 ? "جردان معتمدان" : `${inv.counts} جرود معتمدة`}، آخرها ${formatDay(inv.lastDay)} (قبل ${countNoun(ageDays, DAY)})`,
      action: fresh ? undefined : "مضى على آخر جرد أكثر من أربعين يوماً، فاعتمد جرداً جديداً لتُحسب تكلفة الشهر بالجرد",
    });
  }

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
