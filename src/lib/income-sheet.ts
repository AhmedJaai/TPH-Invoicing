/**
 * قائمةُ الدخل «الناقصةُ المعلَنة» — جوابُ «هل ربحتُ هذا الشهر؟» بما يُعرف وحده.
 *
 * `buildProfitLoss` (في `cashflow.ts`) بُنيت تُبقي الإيرادَ `null` حين لا مصدر، ولم تصلها
 * شاشة. وصار للإيراد مصدرٌ حقيقيّ: ما حسبه إقرارُ الضريبة مبيعاتٍ (وارد البنك والنقد
 * الذي كتبه صاحبُه) بلا ضريبته. فتُوصَل هنا، ويُضاف سطرٌ واحد صريح:
 *
 *   **الباقي على أساسٍ نقديّ = المبيعات − المشتريات − المصروفات**
 *
 * وليس «الربح»: المشترياتُ ليست تكلفةَ المبيعات (المخزونُ لم يُطرح)، فمجملُ الربح
 * والربحُ التشغيليّ يبقيان «غير معروف» بسببهما. والباقي نفسُه **لا يُحسب** إن نقص
 * الشهر — لم ينتهِ، أو فيه أيّامٌ بلا كشف بنك، أو لا مبيعات معروفة — ويُقال ما نقص.
 */
import { buildProfitLoss, type ProfitLossLine } from "./cashflow";
import { isTxCategory, type TxCategory } from "./bank/rules";

export interface IncomeSheetInput {
  /** مبيعاتُ الشهر كما في الإقرار — `null` لا واردَ عُدّ بيعاً ولا نقدَ كُتب. */
  revenue: {
    /** وارد البنك المعدود بيعاً + النقد المكتوب، بلا ضريبة المبيعات. */
    netMinor: number;
    bankGrossMinor: number;
    /** `null` لم يُكتب نقدٌ لهذا الشهر. */
    cashGrossMinor: number | null;
    outputVatMinor: number;
  } | null;
  /** أيّامٌ بلا كشف بنك في الشهر — `null` لا كشفَ له أصلاً. */
  bankGapDays: number | null;
  /** الشهرُ لم ينتهِ بعد. */
  open: boolean;
  invoices: readonly { subtotalMinor: number | null; vatMinor: number | null; totalMinor: number }[];
  expenses: readonly { category: string; amountMinor: number }[];
}

export interface IncomeSheet {
  lines: ProfitLossLine[];
  /** المشترياتُ بلا ضريبتها حيث قُرئت. */
  purchasesMinor: number;
  /** فواتيرُ لم يُقرأ صافيها ولا ضريبتُها — دخلت بإجماليّها، فالمشترياتُ أعلى بضريبتها المجهولة. */
  purchasesGrossOnlyCount: number;
  expensesMinor: number;
  /** `null` لا يُحسب — والأسبابُ في `blockers`. */
  remainderMinor: number | null;
  /** ما يمنع حسابَ الباقي — فارغةٌ حين حُسب. */
  blockers: string[];
  /** ما يُقرأ معه الرقمُ دائماً، حُسب أو لم يُحسب. */
  caveats: string[];
}

/** صافي الفاتورة قبل الضريبة: المقروء، وإلّا الإجماليّ ناقصاً ضريبتَه المقروءة، وإلّا الإجماليّ معلَناً. */
export function invoiceNet(i: { subtotalMinor: number | null; vatMinor: number | null; totalMinor: number }): { minor: number; grossOnly: boolean } {
  if (i.subtotalMinor !== null) return { minor: i.subtotalMinor, grossOnly: false };
  if (i.vatMinor !== null) return { minor: i.totalMinor - i.vatMinor, grossOnly: false };
  return { minor: i.totalMinor, grossOnly: true };
}

export function buildIncomeSheet(input: IncomeSheetInput): IncomeSheet {
  const nets = input.invoices.map(invoiceNet);
  const purchasesMinor = nets.reduce((s, n) => s + n.minor, 0);
  const purchasesGrossOnlyCount = nets.filter((n) => n.grossOnly).length;

  const byCategory = new Map<TxCategory, number>();
  for (const e of input.expenses) {
    const category: TxCategory = isTxCategory(e.category) ? e.category : "OTHER";
    byCategory.set(category, (byCategory.get(category) ?? 0) + e.amountMinor);
  }
  const expensesMinor = input.expenses.reduce((s, e) => s + e.amountMinor, 0);

  const base = buildProfitLoss({
    netSalesMinor: input.revenue?.netMinor ?? null,
    purchasesMinor,
    operatingByCategory: [...byCategory].map(([category, amountMinor]) => ({ category, amountMinor })),
  });

  const blockers: string[] = [];
  if (input.revenue === null) blockers.push("لا مبيعات معروفة لهذا الشهر: لا واردَ بنكٍ عُدّ بيعاً ولا نقدَ كُتب");
  if (input.open) blockers.push("الشهرُ لم ينتهِ — مبيعاتُه ومشترياتُه ناقصة");
  if (input.bankGapDays === null) blockers.push("لا كشفَ بنكٍ لهذا الشهر — المبيعاتُ والمصروفاتُ من الكشف غائبة");
  else if (input.bankGapDays > 0) blockers.push(`في الشهر ${input.bankGapDays} يوماً بلا كشف بنك — ما دخل وخرج فيها غير معروف`);

  const remainderMinor = blockers.length === 0 && input.revenue !== null
    ? input.revenue.netMinor - purchasesMinor - expensesMinor
    : null;

  const lines: ProfitLossLine[] = [
    ...base.lines.map((l) => (l.id === "sales" && l.amountMinor === null
      ? { ...l, unavailableReason: "لا واردَ بنكٍ عُدّ بيعاً ولا نقدَ كُتب لهذا الشهر" }
      : l)),
    {
      id: "cash-remainder",
      label: "الباقي على أساسٍ نقديّ (المبيعات − المشتريات − المصروفات)",
      amountMinor: remainderMinor,
      derived: true,
      unavailableReason: remainderMinor === null ? blockers.join(" · ") : undefined,
    },
  ];

  const caveats = [
    "المشترياتُ ليست تكلفةَ المبيعات: ما اشتُري وبقي على الرفّ محسوبٌ هنا كأنّه بِيع — فالباقي ليس «الربح».",
    "المبيعاتُ ما وصل البنكَ وعُدّ بيعاً في الإقرار ومعه النقدُ الذي كتبتَه — تسويةٌ تأخّرت إلى الشهر التالي تُحسب في شهر وصولها.",
  ];
  if (input.revenue && input.revenue.cashGrossMinor === null) caveats.push("لم يُكتب نقدٌ غير مودَع لهذا الشهر — إن كان فالمبيعاتُ أعلى ممّا هنا.");
  if (purchasesGrossOnlyCount > 0) {
    caveats.push(`${purchasesGrossOnlyCount} فاتورةً لم يُقرأ صافيها ولا ضريبتُها فدخلت بإجماليّها — المشترياتُ أعلى بضريبتها.`);
  }

  return { lines, purchasesMinor, purchasesGrossOnlyCount, expensesMinor, remainderMinor, blockers, caveats };
}
