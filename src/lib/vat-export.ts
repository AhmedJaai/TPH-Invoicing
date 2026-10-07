/**
 * سجلُّ الإقرار للمحاسب — كلُّ خانةٍ بما جاءت منه، في ملفٍّ واحد.
 *
 * الأوراق: الملخّص (أسطرُ الحساب كما في الصفحة) · سجلُّ المدخلات (كلُّ فاتورةٍ محسوبة وسندُ
 * حسابها) · حركاتُ الكشف المحسوبة مدخلاتٍ · سجلُّ المخرجات يوماً بيوم · ما لم يُخصم وسببُه.
 * من مادّة صفحة الإقرار نفسِها (`loadVatReturn`) — فلا يستلم المحاسبُ رقماً غير الذي يُقدَّم.
 *
 * دالّةٌ خالصة، والمالُ هللاتٌ صحيحة حتى آخر لحظة (`formatRiyals`).
 */
import { formatRiyals } from "./money";
import type { Cell, Sheet } from "./accountant-pack";
import type { VatReturn } from "./vat-return";

export interface VatExportInvoice {
  number: string; day: string; supplier: string; sellerVat: string | null; supplierVat: string | null;
  subtotalMinor?: number | null; vatMinor: number | null; totalMinor: number; vatUsedMinor: number;
  included: boolean; choice: boolean | null; reasons: string[]; warnings: string[];
  periodMonth: string; carriedFromMonth: string | null;
}

export interface VatExportTx {
  day: string; label: string; categoryLabel: string; direction: "DEBIT" | "CREDIT"; category: string;
  amountMinor: number; vatMinor: number; included: boolean; choice: boolean | null;
}

export interface VatExportInput {
  label: string;
  periodKey: string;
  generatedAt: string;
  result: VatReturn;
  invoices: readonly VatExportInvoice[];
  txs: readonly VatExportTx[];
  cash: readonly { month: string; grossMinor: number | null }[];
  filing: { filedOn: string; reference: string | null; netMinor: number } | null;
}

const UNKNOWN = "غير معروف";
const riyals = (minor: number): Cell => ({ riyals: formatRiyals(minor) });
const maybe = (minor: number | null | undefined): Cell => (minor === null || minor === undefined ? UNKNOWN : riyals(minor));

/** سندُ حساب الفاتورة في الخصم. */
function basis(i: VatExportInvoice): string {
  if (i.choice !== true) return "حكمُ النظام: مستوفية";
  return i.vatMinor === null ? "إقرارُ صاحب المنشأة — الضريبةُ 15/115 من الإجمالي (لم تُقرأ)" : "إقرارُ صاحب المنشأة — الضريبةُ كما قُرئت";
}

export function buildVatSheets(p: VatExportInput): Sheet[] {
  const r = p.result;

  const summary: Cell[][] = [
    ["سجلّ إقرار ضريبة القيمة المضافة", p.label],
    ["الفترة", p.periodKey],
    ["أُعدّ في", p.generatedAt],
    ["حالُه", p.filing ? `قُدِّم في ${p.filing.filedOn}${p.filing.reference ? ` — مرجع ${p.filing.reference}` : ""}` : "لم يُسجَّل تقديمُه — الأرقامُ حيّة وقد تتغيّر"],
    ...(p.filing ? [["الصافي المقدَّم", riyals(p.filing.netMinor)] satisfies Cell[]] : []),
    [],
    ["البند", "المبلغ قبل الضريبة", "الضريبة"],
    ["المبيعات الخاضعة للنسبة الأساسيّة", riyals(r.output.netMinor), riyals(r.output.vatMinor)],
    ["  منها واردُ البنك (شاملَ الضريبة)", riyals(r.output.grossMinor), ""],
    ["  منها نقدٌ لم يُودَع كتبه صاحبُه (شاملَ الضريبة)", riyals(r.output.cashGrossMinor), ""],
    ["المشتريات الخاضعة للنسبة الأساسيّة", riyals(r.input.baseMinor), riyals(r.input.totalMinor)],
    ["  ضريبةُ الفواتير", { count: r.input.invoices.count }, riyals(r.input.invoices.vatMinor)],
    ["  منها بإقرار صاحب المنشأة", { count: r.input.invoices.confirmed.count }, riyals(r.input.invoices.confirmed.vatMinor)],
    ["  ضريبةُ رسوم الشبكة والبنك", { count: r.input.bankVat.count }, riyals(r.input.bankVat.vatMinor)],
    ["  ضريبةُ حركاتٍ مختارة من الكشف بلا فاتورةٍ مرفوعة (15/115)", riyals(r.input.selected.grossMinor), riyals(r.input.selected.vatMinor)],
    ["مشترياتٌ قُرئت ضريبتُها صفراً", riyals(r.zeroRated.totalMinor), ""],
    ["رصيدٌ دائنٌ مرحَّل من الفترة السابقة", "", riyals(r.carriedInMinor)],
    [r.netMinor >= 0 ? "صافي الضريبة المستحقّة" : "صافي الضريبة — رصيدٌ للمنشأة", "", riyals(Math.abs(r.netMinor))],
    [],
    ["فواتيرُ لم تُخصم", { count: r.notDeductible.count }, riyals(r.notDeductible.vatKnownMinor)],
    ["ملاحظة", "ضريبةُ المخرجات 15/115 من الوارد المحسوب — بافتراض أنّ كلَّ المبيعات بالنسبة الأساسيّة. والمجهولُ مكتوبٌ «غير معروف» لا صفراً."],
  ];

  const invoiceHead: Cell[] = ["رقم الفاتورة", "التاريخ", "الشهر المحاسبيّ", "المورّد", "الرقم الضريبيّ على الفاتورة", "الرقم في سجلّ المورّد", "قبل الضريبة", "الضريبة المقروءة", "الإجمالي", "الضريبة المخصومة", "السند", "ملاحظات"];
  const invoiceRow = (i: VatExportInvoice, note: string): Cell[] => [
    i.number, i.day, i.periodMonth, i.supplier, i.sellerVat ?? UNKNOWN, i.supplierVat ?? UNKNOWN,
    maybe(i.subtotalMinor), maybe(i.vatMinor), riyals(i.totalMinor),
    i.included ? riyals(i.vatUsedMinor) : "",
    i.included ? basis(i) : i.choice === false ? "أخرجها صاحبُ المنشأة" : "لم تُخصم",
    note,
  ];
  const noteOf = (i: VatExportInvoice) => [
    ...(i.carriedFromMonth ? [`مرحَّلة من ${i.carriedFromMonth}`] : []), ...i.warnings,
  ].join(" · ");

  const inputs: Cell[][] = [invoiceHead, ...p.invoices.filter((i) => i.included).map((i) => invoiceRow(i, noteOf(i)))];
  const excluded: Cell[][] = [
    invoiceHead,
    ...p.invoices.filter((i) => !i.included).map((i) => invoiceRow(i, [i.reasons.join(" · "), noteOf(i)].filter(Boolean).join(" — "))),
  ];

  const txRow = (t: VatExportTx): Cell[] => [
    t.day, t.label, t.categoryLabel, riyals(t.amountMinor), riyals(t.vatMinor),
    t.choice === null ? "الأصل" : "باختيار صاحب المنشأة",
  ];
  const bankInputs: Cell[][] = [
    ["التاريخ", "إلى", "التصنيف", "المبلغ", "الضريبة المخصومة", "السند"],
    ...p.txs.filter((t) => t.included && t.direction === "DEBIT").map(txRow),
  ];

  /* المخرجات يوماً بيوم — والضريبةُ لكلّ يومٍ للعرض؛ التقريبُ الملزِم على مجموع الفترة */
  const days = new Map<string, { gross: number; count: number }>();
  for (const t of p.txs) {
    if (!t.included || t.direction !== "CREDIT") continue;
    const d = days.get(t.day) ?? { gross: 0, count: 0 };
    d.gross += t.amountMinor;
    d.count++;
    days.set(t.day, d);
  }
  const outputs: Cell[][] = [
    ["اليوم", "عدد الحركات", "الوارد المحسوب (شاملَ الضريبة)"],
    ...[...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]): Cell[] => [d, { count: v.count }, riyals(v.gross)]),
    ...p.cash.filter((c) => c.grossMinor !== null).map((c): Cell[] => [`${c.month} — نقدٌ لم يُودَع`, "", riyals(c.grossMinor ?? 0)]),
  ];

  return [
    { name: "الملخّص", rows: summary },
    { name: "سجلّ المدخلات", rows: inputs },
    { name: "مدخلات من الكشف", rows: bankInputs },
    { name: "سجلّ المخرجات", rows: outputs },
    { name: "لم تُخصم", rows: excluded },
  ];
}
