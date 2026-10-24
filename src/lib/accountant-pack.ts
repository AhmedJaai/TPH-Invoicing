/**
 * حزمةُ المحاسب — شهرٌ كاملٌ في ملفٍّ واحد يُرسَل إليه.
 *
 * كان المحاسب يُعطى لقطاتِ شاشة، أو يُدعى إلى النظام ليجمع بنفسه. والحزمةُ
 * ستُّ أوراق بترتيب ما يسأل عنه: الملخّص · الفواتير · الضريبة · الدفعات ·
 * المصروفات · حركاتُ البنك — كلُّها من القاعدة لشهرٍ واحد.
 *
 * وما لم يُقرأ يُكتب «غير معروف» لا صفراً: ضريبةٌ مجهولةٌ في خانةٍ فارغة
 * يجمعها إكسل صفراً فيقول إنّ المقهى لم يدفع ضريبة. والملخّصُ يعدّ
 * المجهولَ ويقوله.
 *
 * دالّةٌ خالصة: صفوفٌ مكتوبة تدخل، وأوراقٌ تخرج. المالُ هللاتٌ صحيحة حتى
 * آخر لحظة، ثمّ يُكتب ريالاتٍ بمنزلتين (`formatRiyals`) — لا قسمةَ عائمة.
 */
import { formatRiyals } from "./money";
import { METHOD_LABEL, paymentStatusLabel } from "./payment-state";
import type { Role } from "./permissions";
import { HIDDEN_SALARY_LABEL, SALARY_CATEGORY, withoutSalaryRows } from "./payroll/visibility";
import { CATEGORY_LABEL, type TxCategory } from "./bank/rules";
import { TAX_STATUS_LABEL, type InputVatStatus, type TaxStatus } from "./validation";

export interface PackInvoice {
  number: string;
  date: string;
  supplier: string;
  sellerVat: string | null;
  subtotalMinor: number | null;
  vatMinor: number | null;
  totalMinor: number;
  taxStatus: TaxStatus;
  inputVatStatus: InputVatStatus;
  paidMinor: number;
}

export interface PackPayment {
  date: string;
  supplier: string | null;
  amountMinor: number;
  feeMinor: number;
  method: string;
  status: string;
  invoices: string[];
  fromBank: boolean;
}

export interface PackExpense {
  date: string;
  category: string;
  label: string;
  amountMinor: number;
  source: string;
}

export interface PackBankRow {
  date: string;
  description: string;
  direction: "DEBIT" | "CREDIT";
  amountMinor: number;
  category: string;
  matched: boolean;
}

export interface PackInput {
  month: string;
  monthLabel: string;
  generatedAt: string;
  closed: boolean;
  invoices: PackInvoice[];
  payments: PackPayment[];
  expenses: PackExpense[];
  bank: PackBankRow[];
}

/**
 * الرواتبُ لمن يملك `payroll:view` وحده (`lib/payroll/visibility.ts`): لغيره تصير حوالاتُ
 * باب «راتب أو أجر» ومصروفاتُه **سطراً واحداً بمجموعها** في كلّ ورقة — فتتوازن الحزمة
 * ويُقيَّد مصروفُ الرواتب، ولا يخرج من النظام اسمُ موظّفٍ ولا راتبُه.
 */
export function redactPackSalaries(p: PackInput, role: Role | null | undefined): PackInput {
  const bank = withoutSalaryRows(p.bank, role, (b) => (b.direction === "DEBIT" ? b.amountMinor : -b.amountMinor));
  const expenses = withoutSalaryRows(p.expenses, role, (e) => e.amountMinor);
  return {
    ...p,
    bank: bank.hidden.count === 0 ? bank.rows : [...bank.rows, {
      date: p.month, description: HIDDEN_SALARY_LABEL, direction: "DEBIT", amountMinor: bank.hidden.totalMinor, category: SALARY_CATEGORY, matched: false,
    }],
    expenses: expenses.hidden.count === 0 ? expenses.rows : [...expenses.rows, {
      date: p.month, category: SALARY_CATEGORY, label: HIDDEN_SALARY_LABEL, amountMinor: expenses.hidden.totalMinor, source: "—",
    }],
  };
}

/** خليّةٌ مكتوبة: نصٌّ، أو مبلغٌ بالريال (يُكتب عدداً بتنسيق المال)، أو فراغٌ معلَن. */
export type Cell = string | { riyals: string } | { count: number };

export interface Sheet {
  name: string;
  rows: Cell[][];
}

const UNKNOWN = "غير معروف";
const riyals = (minor: number): Cell => ({ riyals: formatRiyals(minor) });
const maybe = (minor: number | null): Cell => (minor === null ? UNKNOWN : riyals(minor));

export const SOURCE_LABEL: Record<string, string> = { BANK: "كشف البنك", INVOICE: "فاتورة", MANUAL: "إدخال يدوي" };

export function categoryLabel(c: string): string {
  const labels: Readonly<Record<string, string>> = CATEGORY_LABEL satisfies Record<TxCategory, string>;
  return labels[c] ?? c;
}

export const INPUT_VAT_LABEL: Record<InputVatStatus, string> = {
  ELIGIBLE: "قابلة للخصم",
  NOT_ELIGIBLE: "غير قابلة للخصم",
  UNKNOWN,
};

export interface PackSummary {
  invoiceCount: number;
  invoicesTotalMinor: number;
  vatKnownMinor: number;
  vatUnknownCount: number;
  deductibleVatMinor: number;
  paidMinor: number;
  openMinor: number;
  /** ما خرج مالاً — بلا الإشعارات الدائنة */
  paymentsMinor: number;
  /** إشعاراتٌ دائنة سوّت فواتيرَ الشهر ولم يخرج لها مال */
  creditNotesMinor: number;
  expensesMinor: number;
  bankInMinor: number;
  bankOutMinor: number;
  /** صادرٌ بلا تفسير: غيرُ مصنَّف، أو لمورّدٍ بلا دفعةٍ قُيّدت له. */
  bankUnexplainedCount: number;
}

/**
 * صادرٌ يسأل عنه المحاسب: غيرُ مصنَّف، أو خرج لمورّدٍ ولا دفعةَ مقيَّدةً تقابله.
 *
 * كان العدُّ «صادرٌ لم يُطابَق» — والمطابقةُ للدفعات وحدها، فعدّ رسومَ الشبكة
 * والرواتبَ والإيجار (٣٨٨ في أغسطس ٢٠٢٦ وكلُّها مفسَّرةٌ ببابها) فبدا الشهرُ
 * فوضى وهو مستقيم.
 */
export function unexplained(b: PackBankRow): boolean {
  return b.direction === "DEBIT" && (b.category === "UNKNOWN" || (b.category === "SUPPLIER" && !b.matched));
}

export interface OutflowByCategory {
  category: string;
  count: number;
  totalMinor: number;
}

/** صادرُ البنك بأبوابه، الأكبرُ أوّلاً — ما يسأل عنه المحاسب قبل الحركات. */
export function outflowByCategory(p: PackInput): OutflowByCategory[] {
  const by = new Map<string, OutflowByCategory>();
  for (const b of p.bank) {
    if (b.direction !== "DEBIT") continue;
    const row = by.get(b.category) ?? { category: b.category, count: 0, totalMinor: 0 };
    row.count++;
    row.totalMinor += b.amountMinor;
    by.set(b.category, row);
  }
  return [...by.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

/** رسومٌ صغيرةٌ متكرّرة (مئاتٌ في الشهر) — تُجمَل ببابها في الورق ولا تُسرَد. */
export const SMALL_FEE_CATEGORIES: ReadonlySet<string> = new Set(["POS_FEE", "POS_VAT", "BANK_FEE", "BANK_VAT"]);

/** المصروفاتُ بأبوابها، الأكبرُ أوّلاً. */
export function expensesByCategory(p: PackInput): OutflowByCategory[] {
  const by = new Map<string, OutflowByCategory>();
  for (const e of p.expenses) {
    const row = by.get(e.category) ?? { category: e.category, count: 0, totalMinor: 0 };
    row.count++;
    row.totalMinor += e.amountMinor;
    by.set(e.category, row);
  }
  return [...by.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

/** ما بقي على الفاتورة — لا يقلّ عن صفر، فالسدادُ الزائد رصيدٌ للمورّد لا دينٌ سالب. */
export function invoiceOpenMinor(i: PackInvoice): number {
  return Math.max(0, i.totalMinor - i.paidMinor);
}

export interface VatRow {
  status: InputVatStatus;
  count: number;
  /** مجموعُ المقروء وحده — والمجهولُ يُعَدّ في `unknownVat` ولا يُجمع صفراً. */
  vatKnownMinor: number;
  unknownVat: number;
}

/** ضريبةُ المدخلات بحالها — لورقة Excel وللحزمة المطبوعة من مصدرٍ واحد. */
export function vatByStatus(p: PackInput): VatRow[] {
  return (["ELIGIBLE", "NOT_ELIGIBLE", "UNKNOWN"] as const).map((status) => {
    const list = p.invoices.filter((i) => i.inputVatStatus === status);
    return {
      status,
      count: list.length,
      vatKnownMinor: list.reduce((s, i) => s + (i.vatMinor ?? 0), 0),
      unknownVat: list.filter((i) => i.vatMinor === null).length,
    };
  });
}

export function summarize(p: PackInput): PackSummary {
  const live = p.payments.filter((x) => x.status !== "REVERSED" && x.status !== "VOID");
  return {
    invoiceCount: p.invoices.length,
    invoicesTotalMinor: p.invoices.reduce((s, i) => s + i.totalMinor, 0),
    vatKnownMinor: p.invoices.reduce((s, i) => s + (i.vatMinor ?? 0), 0),
    vatUnknownCount: p.invoices.filter((i) => i.vatMinor === null).length,
    deductibleVatMinor: p.invoices
      .filter((i) => i.inputVatStatus === "ELIGIBLE" && i.vatMinor !== null)
      .reduce((s, i) => s + (i.vatMinor ?? 0), 0),
    paidMinor: p.invoices.reduce((s, i) => s + Math.min(i.paidMinor, i.totalMinor), 0),
    openMinor: p.invoices.reduce((s, i) => s + invoiceOpenMinor(i), 0),
    paymentsMinor: live.filter((x) => x.method !== "CREDIT_NOTE").reduce((s, x) => s + x.amountMinor, 0),
    creditNotesMinor: live.filter((x) => x.method === "CREDIT_NOTE").reduce((s, x) => s + x.amountMinor, 0),
    expensesMinor: p.expenses.reduce((s, e) => s + e.amountMinor, 0),
    bankInMinor: p.bank.filter((b) => b.direction === "CREDIT").reduce((s, b) => s + b.amountMinor, 0),
    bankOutMinor: p.bank.filter((b) => b.direction === "DEBIT").reduce((s, b) => s + b.amountMinor, 0),
    bankUnexplainedCount: p.bank.filter(unexplained).length,
  };
}

export function buildAccountantPack(p: PackInput): Sheet[] {
  const s = summarize(p);

  const summary: Cell[][] = [
    ["حزمة المحاسب", p.monthLabel],
    ["الشهر", p.month],
    ["حالة الشهر", p.closed ? "مقفل" : "مفتوح، وقد تتغيّر أرقامه"],
    ["تاريخ الإعداد", p.generatedAt],
    [],
    ["المشتريات"],
    ["عدد الفواتير", { count: s.invoiceCount }],
    ["مجموع الفواتير", riyals(s.invoicesTotalMinor)],
    ["الضريبة المقروءة", riyals(s.vatKnownMinor)],
    ["فواتير لم تُقرأ ضريبتها", { count: s.vatUnknownCount }],
    /* حكمُ النظام على الفواتير وحده — رقمُ الإقرار يضيف ما أُقرّ بيد وضريبةَ الرسوم وما اختير من الكشف */
    ["ضريبة الفواتير المستوفية للشروط (بحسب النظام، ورقم الإقرار في سجل الإقرار)", riyals(s.deductibleVatMinor)],
    ["المسدّد منها", riyals(s.paidMinor)],
    ["المتبقي عليها", riyals(s.openMinor)],
    [],
    ["المال"],
    ["دفعات الشهر (القائمة)", riyals(s.paymentsMinor)],
    ...(s.creditNotesMinor > 0 ? [["إشعارات دائنة (مرتجع أو خصم، بلا خروج مال)", riyals(s.creditNotesMinor)]] : []),
    ["المصروفات", riyals(s.expensesMinor)],
    ["الداخل إلى البنك", riyals(s.bankInMinor)],
    ["الخارج من البنك", riyals(s.bankOutMinor)],
    ["خارج غير مفسَّر (غير مصنّف، أو لمورّد بلا دفعة)", { count: s.bankUnexplainedCount }],
    [],
    ["ملاحظة", "الإيرادات ليست في هذه الحزمة. ضريبة المخرجات وحساب الإقرار في «سجل الإقرار» داخل صفحة الإقرار الضريبي. والقيمة غير المعروفة تظهر «غير معروف» لا صفراً."],
  ];

  const invoices: Cell[][] = [
    ["رقم الفاتورة", "التاريخ", "المورّد", "الرقم الضريبي للمورّد", "قبل الضريبة", "الضريبة", "الإجمالي", "الحالة الضريبية", "ضريبة المدخلات", "المسدّد", "الباقي"],
    ...p.invoices.map((i) => [
      i.number,
      i.date,
      i.supplier,
      i.sellerVat ?? UNKNOWN,
      maybe(i.subtotalMinor),
      maybe(i.vatMinor),
      riyals(i.totalMinor),
      TAX_STATUS_LABEL[i.taxStatus],
      INPUT_VAT_LABEL[i.inputVatStatus],
      riyals(Math.min(i.paidMinor, i.totalMinor)),
      riyals(invoiceOpenMinor(i)),
    ]),
  ];

  const vatRows = vatByStatus(p).map((v): Cell[] => [
    INPUT_VAT_LABEL[v.status],
    { count: v.count },
    riyals(v.vatKnownMinor),
    v.unknownVat > 0 ? `منها ${v.unknownVat} لم تُقرأ ضريبتها` : "",
  ]);
  const vat: Cell[][] = [["ضريبة المدخلات", "عدد الفواتير", "الضريبة المقروءة", "ملاحظة"], ...vatRows];

  const payments: Cell[][] = [
    ["التاريخ", "المورّد", "المبلغ", "رسم التحويل", "الطريقة", "الحال", "على الفواتير", "من كشف البنك"],
    ...p.payments.map((x) => [
      x.date,
      x.supplier ?? "غير منسوبة إلى مورّد",
      riyals(x.amountMinor),
      riyals(x.feeMinor),
      METHOD_LABEL[x.method] ?? x.method,
      paymentStatusLabel(x.status),
      x.invoices.join(" | "),
      x.method === "CREDIT_NOTE" ? "إشعار دائن" : x.fromBank ? "نعم" : "إقرار يدوي",
    ]),
  ];

  const expenses: Cell[][] = [
    ["التاريخ", "التصنيف", "البيان", "المبلغ", "المصدر"],
    ...p.expenses.map((e) => [e.date, categoryLabel(e.category), e.label, riyals(e.amountMinor), SOURCE_LABEL[e.source] ?? e.source]),
  ];

  const bank: Cell[][] = [
    ["التاريخ", "البيان", "الاتجاه", "المبلغ", "التصنيف", "مطابقة"],
    ...p.bank.map((b) => [
      b.date,
      b.description,
      b.direction === "CREDIT" ? "وارد" : "صادر",
      riyals(b.amountMinor),
      categoryLabel(b.category),
      b.matched ? "نعم" : "لا",
    ]),
  ];

  return [
    { name: "الملخّص", rows: summary },
    { name: "الفواتير", rows: invoices },
    { name: "الضريبة", rows: vat },
    { name: "الدفعات", rows: payments },
    { name: "المصروفات", rows: expenses },
    { name: "حركات البنك", rows: bank },
  ];
}
