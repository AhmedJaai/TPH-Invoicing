/**
 * التدفّق النقدي وقائمة الدخل — ممّا هو معلوم وحده.
 *
 * القاعدة التي تحكم هذا الملف: **ما لا مصدر له لا يُحسب صفراً**. المبيعات
 * غير موصولة، فالإيراد `null` لا `0` — ولا تُشتقّ منه نسبة ولا هامش.
 * وقائمة الدخل تُعرض ناقصةً معلَنةً بدل أن تُعرض كاملةً كاذبة.
 *
 * دوال خالصة: تأخذ حركات وتُرجع نتائج.
 */
import type { TxCategory } from "./bank/rules";

export interface CashMovement {
  /** YYYY-MM */
  month: string;
  direction: "DEBIT" | "CREDIT";
  category: TxCategory;
  amountMinor: number;
}

export interface CashFlowMonth {
  month: string;
  inMinor: number;
  outMinor: number;
  netMinor: number;
  byCategory: { category: TxCategory; amountMinor: number }[];
}

export interface CashFlow {
  months: CashFlowMonth[];
  totalInMinor: number;
  totalOutMinor: number;
  netMinor: number;
  /** حركات لم تُصنَّف — تُعلَن لأنّها تُضعف الثقة */
  unclassifiedMinor: number;
  unclassifiedCount: number;
}

export function buildCashFlow(movements: readonly CashMovement[]): CashFlow {
  const byMonth = new Map<string, CashFlowMonth>();
  let unclassifiedMinor = 0;
  let unclassifiedCount = 0;

  for (const m of movements) {
    const entry =
      byMonth.get(m.month) ??
      { month: m.month, inMinor: 0, outMinor: 0, netMinor: 0, byCategory: [] };

    if (m.direction === "CREDIT") entry.inMinor += m.amountMinor;
    else entry.outMinor += m.amountMinor;

    if (m.category === "UNKNOWN") {
      unclassifiedMinor += m.amountMinor;
      unclassifiedCount++;
    }

    const cat = entry.byCategory.find((c) => c.category === m.category);
    if (cat) cat.amountMinor += m.amountMinor;
    else entry.byCategory.push({ category: m.category, amountMinor: m.amountMinor });

    byMonth.set(m.month, entry);
  }

  const months = [...byMonth.values()]
    .map((m) => ({
      ...m,
      netMinor: m.inMinor - m.outMinor,
      byCategory: m.byCategory.sort((a, b) => b.amountMinor - a.amountMinor),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    months,
    totalInMinor: months.reduce((s, m) => s + m.inMinor, 0),
    totalOutMinor: months.reduce((s, m) => s + m.outMinor, 0),
    netMinor: months.reduce((s, m) => s + m.netMinor, 0),
    unclassifiedMinor,
    unclassifiedCount,
  };
}

/* ─────────────────── قائمة الدخل ─────────────────── */

export interface ProfitLossInput {
  /** `null` تعني «غير موصول» لا «صفر» */
  netSalesMinor: number | null;
  /** مشتريات الفترة من الفواتير */
  purchasesMinor: number;
  /** مصروفات تشغيلية من كشف البنك، مصنَّفة */
  operatingByCategory: { category: TxCategory; amountMinor: number }[];
}

export interface ProfitLossLine {
  id: string;
  label: string;
  amountMinor: number | null;
  /** بند مشتقّ لا مُدخَل */
  derived?: boolean;
  /** سبب عدم توفّره */
  unavailableReason?: string;
}

export interface ProfitLoss {
  lines: ProfitLossLine[];
  /** هل القائمة كاملة؟ */
  complete: boolean;
  missing: string[];
}

const CATEGORY_LABEL_PL: Partial<Record<TxCategory, string>> = {
  SALARY: "رواتب وأجور",
  RENT: "إيجار",
  UTILITY: "كهرباء ومياه واتصالات",
  GOVERNMENT: "رسوم حكومية وتأمينات",
  ZAKAT: "زكاة وصدقات",
  OTHER: "مصروفات أخرى",
};

/**
 * قائمة الدخل بما هو معلوم.
 *
 * بلا مبيعات لا يوجد هامش ولا تكلفة مبيعات — وتُعرض هذه البنود بأسبابها
 * لا بأصفار. الغرض أن يرى صاحب العمل **ما ينقص ليكتمل** لا أن يظنّ أنّ
 * ربحه صفر.
 */
export function buildProfitLoss(input: ProfitLossInput): ProfitLoss {
  const lines: ProfitLossLine[] = [];
  const missing: string[] = [];

  if (input.netSalesMinor === null) {
    lines.push({
      id: "sales",
      label: "صافي المبيعات",
      amountMinor: null,
      unavailableReason: "غير موصولة — لا مصدر مبيعات",
    });
    missing.push("المبيعات");
  } else {
    lines.push({ id: "sales", label: "صافي المبيعات", amountMinor: input.netSalesMinor });
  }

  lines.push({
    id: "purchases",
    label: "المشتريات",
    amountMinor: input.purchasesMinor,
  });

  /*
   * تكلفة المبيعات ليست المشتريات: الفرق بينهما تغيّر المخزون.
   * ولا مخزون موصولاً، فلا تُعرض تكلفة مبيعات ولو بدت المشتريات قريبة منها.
   */
  lines.push({
    id: "cogs",
    label: "تكلفة المبيعات",
    amountMinor: null,
    unavailableReason: "تحتاج المخزون — المشتريات ليست تكلفة مبيعات",
  });
  missing.push("المخزون");

  lines.push({
    id: "gross",
    label: "مجمل الربح",
    amountMinor: null,
    derived: true,
    unavailableReason: "يحتاج المبيعات وتكلفة المبيعات",
  });

  const operating = [...input.operatingByCategory]
    .filter((c) => c.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);

  for (const c of operating) {
    lines.push({
      id: `op-${c.category}`,
      label: CATEGORY_LABEL_PL[c.category] ?? String(c.category),
      amountMinor: c.amountMinor,
    });
  }

  const operatingTotal = operating.reduce((s, c) => s + c.amountMinor, 0);
  lines.push({
    id: "operating-total",
    label: "مجموع المصروفات التشغيلية",
    amountMinor: operatingTotal,
    derived: true,
  });

  lines.push({
    id: "operating-profit",
    label: "الربح التشغيلي",
    amountMinor: null,
    derived: true,
    unavailableReason: "يحتاج مجمل الربح",
  });

  return { lines, complete: missing.length === 0, missing };
}

/* ─────────────────── المصروف المتكرّر ─────────────────── */

export interface RecurringExpense {
  id: string;
  label: string;
  category: TxCategory;
  amountMinor: number;
  cadence: "MONTHLY" | "QUARTERLY" | "ANNUAL";
}

export interface ExpectedVsActual {
  label: string;
  category: TxCategory;
  expectedMinor: number;
  actualMinor: number;
  varianceMinor: number;
  /** موجب: أنفقتَ أكثر ممّا توقّعت */
  overspent: boolean;
}

/** حصّة الشهر من مصروف متكرّر. */
export function monthlyShare(e: RecurringExpense): number {
  if (e.cadence === "MONTHLY") return e.amountMinor;
  if (e.cadence === "QUARTERLY") return Math.round(e.amountMinor / 3);
  return Math.round(e.amountMinor / 12);
}

/**
 * يقابل المتوقَّع بالفعلي لكل تصنيف.
 * التصنيف الذي لا مصروف متكرّر له يظهر بمتوقَّع صفر — وذلك صادق: لم يُتوقَّع منه شيء.
 */
export function compareExpenses(
  recurring: readonly RecurringExpense[],
  actualByCategory: readonly { category: TxCategory; amountMinor: number }[],
): ExpectedVsActual[] {
  const expected = new Map<TxCategory, { label: string; amount: number }>();
  for (const e of recurring) {
    const prev = expected.get(e.category);
    expected.set(e.category, {
      label: prev ? `${prev.label} · ${e.label}` : e.label,
      amount: (prev?.amount ?? 0) + monthlyShare(e),
    });
  }

  const categories = new Set<TxCategory>([
    ...expected.keys(),
    ...actualByCategory.map((a) => a.category),
  ]);

  const out: ExpectedVsActual[] = [];
  for (const category of categories) {
    const exp = expected.get(category);
    const actual = actualByCategory.find((a) => a.category === category)?.amountMinor ?? 0;
    const expectedMinor = exp?.amount ?? 0;
    out.push({
      label: exp?.label ?? String(category),
      category,
      expectedMinor,
      actualMinor: actual,
      varianceMinor: actual - expectedMinor,
      overspent: actual > expectedMinor,
    });
  }

  return out.sort((a, b) => Math.abs(b.varianceMinor) - Math.abs(a.varianceMinor));
}
