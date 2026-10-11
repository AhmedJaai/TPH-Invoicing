/**
 * قائمةُ الدخل لشهر — تجمع ما تحسبه شاشاتٌ قائمة ولا تعيد حسابَ شيء:
 * المبيعاتُ من إقرار الضريبة للشهر (`loadVatReturn`)، والمشترياتُ والمصروفاتُ من
 * حزمة المحاسب (`loadAccountantPack`)، وملفُّ فودكس شاهداً بتغطيته.
 */
import { buildIncomeSheet, type IncomeSheet } from "@/lib/income-sheet";
import { expectedDaysOf } from "@/lib/sales/witness";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadAccountantPack } from "./accountant-pack.service";
import { loadSalesDays } from "./sales-witness.service";
import { loadVatReturn } from "./vat-return.service";

export interface IncomeSheetView {
  month: string;
  sheet: IncomeSheet;
  revenue: { netMinor: number; bankGrossMinor: number; cashGrossMinor: number | null; outputVatMinor: number } | null;
  invoiceCount: number;
  expenseCount: number;
  /** ملفُّ فودكس للشهر — `null` لا ملفّ. شاهدٌ لا يدخل الحساب. */
  foodics: { salesMinor: number; vatMinor: number; coveredDays: number; expectedDays: number } | null;
  closed: boolean;
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

export async function loadIncomeSheet(month: string): Promise<IncomeSheetView> {
  const [pack, vat, days] = await Promise.all([
    loadAccountantPack(month),
    loadVatReturn({ kind: "month", month }),
    loadSalesDays(`${month}-01`, nextMonthStart(month)),
  ]);
  const out = vat.result.output;
  const cashTyped = vat.cash.find((c) => c.month === month)?.grossMinor ?? null;
  const revenue = out.count > 0 || cashTyped !== null
    ? { netMinor: out.netMinor, bankGrossMinor: out.grossMinor, cashGrossMinor: cashTyped, outputVatMinor: out.vatMinor }
    : null;
  const coverage = vat.coverage.find((c) => c.month === month);
  const today = todayInRiyadh();

  return {
    month,
    sheet: buildIncomeSheet({
      revenue,
      bankGapDays: coverage ? coverage.gapDays : null,
      open: coverage?.open ?? month >= today.slice(0, 7),
      invoices: pack.input.invoices,
      expenses: pack.input.expenses,
    }),
    revenue,
    invoiceCount: pack.input.invoices.length,
    expenseCount: pack.input.expenses.length,
    foodics: days.length === 0 ? null : {
      salesMinor: days.reduce((s, d) => s + d.salesMinor, 0),
      vatMinor: days.reduce((s, d) => s + d.vatMinor, 0),
      coveredDays: new Set(days.map((d) => d.day)).size,
      expectedDays: expectedDaysOf(month, today),
    },
    closed: pack.input.closed,
  };
}
