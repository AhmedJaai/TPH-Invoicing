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

/** خليّةٌ مكتوبة: نصٌّ، أو مبلغٌ بالريال (يُكتب عدداً بتنسيق المال)، أو فراغٌ معلَن. */
export type Cell = string | { riyals: string } | { count: number };

export interface Sheet {
  name: string;
  rows: Cell[][];
}

const UNKNOWN = "غير معروف";
const riyals = (minor: number): Cell => ({ riyals: formatRiyals(minor) });
const maybe = (minor: number | null): Cell => (minor === null ? UNKNOWN : riyals(minor));

const SOURCE_LABEL: Record<string, string> = { BANK: "كشف البنك", INVOICE: "فاتورة", MANUAL: "إدخالٌ يدويّ" };

function categoryLabel(c: string): string {
  const labels: Readonly<Record<string, string>> = CATEGORY_LABEL satisfies Record<TxCategory, string>;
  return labels[c] ?? c;
}

const INPUT_VAT_LABEL: Record<InputVatStatus, string> = {
  ELIGIBLE: "تُخصم",
  NOT_ELIGIBLE: "لا تُخصم",
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
  paymentsMinor: number;
  expensesMinor: number;
  bankInMinor: number;
  bankOutMinor: number;
  bankUnmatchedCount: number;
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
    openMinor: p.invoices.reduce((s, i) => s + Math.max(0, i.totalMinor - i.paidMinor), 0),
    paymentsMinor: live.reduce((s, x) => s + x.amountMinor, 0),
    expensesMinor: p.expenses.reduce((s, e) => s + e.amountMinor, 0),
    bankInMinor: p.bank.filter((b) => b.direction === "CREDIT").reduce((s, b) => s + b.amountMinor, 0),
    bankOutMinor: p.bank.filter((b) => b.direction === "DEBIT").reduce((s, b) => s + b.amountMinor, 0),
    bankUnmatchedCount: p.bank.filter((b) => b.direction === "DEBIT" && !b.matched).length,
  };
}

export function buildAccountantPack(p: PackInput): Sheet[] {
  const s = summarize(p);

  const summary: Cell[][] = [
    ["حزمة المحاسب", p.monthLabel],
    ["الشهر", p.month],
    ["حالُ الشهر", p.closed ? "مُقفَل" : "مفتوح — قد تتغيّر أرقامه"],
    ["أُعدّت في", p.generatedAt],
    [],
    ["المشتريات"],
    ["عدد الفواتير", { count: s.invoiceCount }],
    ["مجموع الفواتير", riyals(s.invoicesTotalMinor)],
    ["الضريبة المقروءة", riyals(s.vatKnownMinor)],
    ["فواتير ضريبتُها غير مقروءة", { count: s.vatUnknownCount }],
    ["ضريبة المدخلات القابلة للخصم", riyals(s.deductibleVatMinor)],
    ["ما سُدّد منها", riyals(s.paidMinor)],
    ["ما بقي عليها", riyals(s.openMinor)],
    [],
    ["المال"],
    ["دفعات الشهر (القائمة)", riyals(s.paymentsMinor)],
    ["المصروفات", riyals(s.expensesMinor)],
    ["وارد البنك", riyals(s.bankInMinor)],
    ["صادر البنك", riyals(s.bankOutMinor)],
    ["صادرٌ لم يُطابَق", { count: s.bankUnmatchedCount }],
    [],
    ["ملاحظة", "المبيعات غير موصولة بالنظام — الإيراد ليس في هذه الحزمة. والمجهولُ مكتوبٌ «غير معروف» لا صفراً."],
  ];

  const invoices: Cell[][] = [
    ["رقم الفاتورة", "التاريخ", "المورّد", "الرقم الضريبي للمورّد", "قبل الضريبة", "الضريبة", "الإجمالي", "حالها الضريبي", "ضريبة المدخلات", "المسدَّد", "الباقي"],
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
      riyals(Math.max(0, i.totalMinor - i.paidMinor)),
    ]),
  ];

  const vatRows = (["ELIGIBLE", "NOT_ELIGIBLE", "UNKNOWN"] as const).map((st) => {
    const list = p.invoices.filter((i) => i.inputVatStatus === st);
    const unknownVat = list.filter((i) => i.vatMinor === null).length;
    return [
      INPUT_VAT_LABEL[st],
      { count: list.length },
      riyals(list.reduce((s2, i) => s2 + (i.vatMinor ?? 0), 0)),
      unknownVat > 0 ? `منها ${unknownVat} ضريبتُها غير مقروءة` : "",
    ] as Cell[];
  });
  const vat: Cell[][] = [["ضريبة المدخلات", "عدد الفواتير", "الضريبة المقروءة", "ملاحظة"], ...vatRows];

  const payments: Cell[][] = [
    ["التاريخ", "المورّد", "المبلغ", "رسم التحويل", "الطريقة", "الحال", "على الفواتير", "من كشف البنك"],
    ...p.payments.map((x) => [
      x.date,
      x.supplier ?? "غير منسوبة",
      riyals(x.amountMinor),
      riyals(x.feeMinor),
      METHOD_LABEL[x.method] ?? x.method,
      paymentStatusLabel(x.status),
      x.invoices.join(" | "),
      x.fromBank ? "نعم" : "إقرار يدويّ",
    ]),
  ];

  const expenses: Cell[][] = [
    ["التاريخ", "الباب", "البيان", "المبلغ", "المصدر"],
    ...p.expenses.map((e) => [e.date, categoryLabel(e.category), e.label, riyals(e.amountMinor), SOURCE_LABEL[e.source] ?? e.source]),
  ];

  const bank: Cell[][] = [
    ["التاريخ", "البيان", "الاتّجاه", "المبلغ", "الباب", "مطابَقة"],
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
