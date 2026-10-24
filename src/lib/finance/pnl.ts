/**
 * قائمةُ الدخل الصادقة — «هل ربحتُ هذا الشهر، وكم، وما الذي ينقص الرقم؟».
 *
 *   الإيراد (ما دفعه الزبائن بلا ضريبته) − تكلفةُ المبيعات = مجملُ الربح
 *   مجملُ الربح − المصروفاتُ التشغيليّة = الربح
 *
 * والقاعدةُ الحاكمة: **ربحٌ ينقصه الإيجارُ أو الرواتب ليس ربحاً**. فالرقمُ يُسمّى بما
 * يشمله — «صافي الربح» حين لا ينقصه أساسيّ، و«الربح قبل الإيجار» حين ينقصه، و«غير
 * معروف» حين لا إيرادَ أو لا تكلفة — وكلُّ ناقصٍ باسمه وموضع إكماله.
 *
 * تكلفةُ المبيعات ثلاثُ طرقٍ تُحسَب كلُّها وتُعرَض:
 *   - **بالجرد**: مشتريات + مخزونُ أوّل الشهر − مخزونُ آخره. هي المعتمَدة حيث وُجد عدٌّ
 *     قرب طرفَي الشهر — ما خرج من الرفّ فعلاً، بيعاً وهدراً وفاقداً.
 *   - **بالمشتريات**: ما فُوتِر في الشهر. تُعتمَد حين لا عدّ، ويُقال إنّها ليست تكلفةَ ما بِيع.
 *   - **النظريّة**: الوصفات × ما بِيع. ما كان ينبغي أن يُصرَف — والفرقُ بينها وبين الجرد
 *     هو «الفرق غير المفسَّر»، سطرٌ ظاهر لا رقمٌ مدفون.
 * وكلفةُ فودكس شاهدٌ رابع يُعرَض ولا يدخل.
 *
 * نقيّ: لا قاعدةَ هنا. المال هللاتٌ صحيحة.
 */
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { formatDay } from "@/lib/riyadh-time";

export type OpexSource = "BANK" | "INVOICE" | "MANUAL" | "SPREAD" | "OFF_BOOK" | "OWNER_PAID";

export const OPEX_SOURCE_LABEL: Record<OpexSource, string> = {
  BANK: "من كشف البنك",
  INVOICE: "من فاتورة",
  MANUAL: "مسجّل يدوياً",
  SPREAD: "حصة هذا الشهر من دفعة تغطي عدة أشهر، كما أضافها المالك",
  OFF_BOOK: "خارج كشف البنك، كما أضافه المالك",
  OWNER_PAID: "فواتير مورّدين سدّدتها من مالك، محسوبة في المشتريات",
};

/**
 * ما سدّدتَه للمورّدين من مالك الخاصّ يُخصم من تحويلات الشهر لحسابك.
 *
 * التحويلاتُ لحساب المالك مصروف (أحمد، ١٢ أكتوبر ٢٠٢٦)، وفاتورةُ المورّد مشتريات. فما دُفع
 * منها نقداً لفاتورةٍ مقيَّدة كان يُحسب مرّتين: مصروفاً حين حُوِّل ومشترياتٍ حين قُيِّدت فاتورتُه
 * (أحمد، ٢٢ أكتوبر ٢٠٢٦: «علّم المدفوعة نقداً … ويُخصم من تحويلاتي الشخصية»). ويُخصم المبلغُ
 * كلُّه بضريبته: صافيه في المشتريات وضريبتُه تُستردّ في الإقرار، ولا شيءَ منه مصروف.
 *
 * ولا يُخصم فوق تحويلات الشهر: ما زاد دفعتَه من مالٍ لم يُحسب مصروفاً أصلاً، فلا تكرار فيه.
 */
export function ownerPaidDeduction(transfersMinor: number, ownerPaidMinor: number): { deductMinor: number; beyondMinor: number } {
  const deductMinor = Math.max(0, Math.min(transfersMinor, ownerPaidMinor));
  return { deductMinor, beyondMinor: Math.max(0, ownerPaidMinor - deductMinor) };
}

export interface OpexRow {
  category: TxCategory;
  label: string;
  amountMinor: number;
  source: OpexSource;
}

/** ما خرج من الحساب ولماذا — يُعرَض ولا يُدفَن. */
export interface ExcludedRow {
  label: string;
  amountMinor: number;
  reason: string;
  /** ضريبةٌ (الأصل) أو مالٌ محسوبٌ في المشتريات — أعطاه المالكُ موظّفاً ليسدّد فاتورة (084). */
  kind?: "TAX" | "PURCHASES";
}

/** ضريبةُ الرسوم مبلغُها هو الضريبة، وتُخصَم في الإقرار (`vat-return.ts`) — ليست مصروفاً. */
export const RECOVERABLE_VAT: ReadonlySet<TxCategory> = new Set<TxCategory>(["POS_VAT", "BANK_VAT"]);

/** سدادٌ لهيئة الزكاة والضريبة: تسويةُ ضريبةٍ جُمعت من الزبائن، لا مصروفُ تشغيل. */
export function isTaxSettlement(...texts: (string | null | undefined)[]): boolean {
  const text = texts.filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
  return /zakat,? ?tax and customs|هيئ[ةه] الزكا[ةه]/.test(text);
}

export interface StockCogs {
  minor: number;
  /** يوما العدّ اللذان حُسب بينهما. */
  openingDay: string;
  closingDay: string;
  /** أيّامٌ بين العدّ وطرف الشهر سُدّت بالاستهلاك النظريّ والمشتريات. */
  adjustedDays: number;
  /** أصنافٌ عُدّت في الطرفين — وحدها تدخل فرقَ المخزون. */
  countedItems: number;
  openingValueMinor: number;
  closingValueMinor: number;
  /** أصنافٌ عدُّها مشكوكٌ فيه (قفزةٌ لا يفسّرها شراءٌ ولا بيع) — أُخرجت وتُسمّى. */
  suspectItems: string[];
}

export interface PnlInput {
  month: string;
  /** الشهرُ لم ينتهِ بعد. */
  open: boolean;
  revenue: {
    /** ما دفعه الزبائن (نقداً وبطاقةً) بعد المرتجَع، شاملاً الضريبة. */
    paidMinor: number;
    vatMinor: number;
    coveredDays: number;
    expectedDays: number;
  } | null;
  /**
   * مبيعاتٌ خارج فودكس — حوالاتٌ واردة صنّفها صاحبُ المقهى «مبيعات خارج فودكس» (أحمد،
   * ٢٤ أكتوبر ٢٠٢٦: «سبعة جرة» يشتري منّا). بمبلغها كما وصل: أفيها ضريبةٌ أم لا سؤالٌ
   * للمحاسب، فلا يُطرح منها شيءٌ هنا ويُقال ذلك بجانبها. غائبٌ في لقطةٍ أقدم.
   */
  otherSales?: { grossMinor: number; count: number } | null;
  cogs: {
    purchasesMinor: number;
    purchasesInvoices: number;
    /** فواتيرُ لم يُقرأ صافيها — دخلت بإجماليّها. */
    purchasesGrossOnly: number;
    /** `null` لا وصفةَ ولا كلفةَ تكفي. */
    theoreticalMinor: number | null;
    stock: StockCogs | null;
    /** لماذا لا طريقةَ جرد — يُقال. */
    stockMissing: string | null;
    /** كلفةُ ما صرفه فودكس بحسابه — شاهد. `null` لم يُقرأ الشهرُ كلُّه. */
    foodicsMinor: number | null;
    /** هدرٌ مسجَّل في سجلّنا مقوَّماً. */
    wasteMinor: number;
    /** مشروباتُ الموظّفين بتكلفتها — داخلةٌ في النظريّة؛ تُسمّى لأنّها استهلاكٌ بلا إيراد. */
    staffMinor: number | null;
    /**
     * مشروباتٌ حُضّرت ثمّ أُرجعت بتكلفتها — داخلةٌ في النظريّة منذ ٢٤ أكتوبر ٢٠٢٦ (كانت
     * تُنقصها). تُسمّى لأنّ الرقمَ تغيّر بقرارٍ ويُقال لماذا. غائبٌ في لقطةٍ أقدم.
     */
    returnedMinor?: number | null;
  };
  opex: readonly OpexRow[];
  excluded: readonly ExcludedRow[];
  /** فئاتٌ أقرّ المالكُ أنّها لا تلزم هذا الشهر. */
  declaredNone: readonly TxCategory[];
  /** أيّامٌ بلا كشف بنك — `null` لا كشفَ للشهر. */
  bankGapDays: number | null;
}

export type PnlGapId = "NO_REVENUE" | "SALES_DAYS" | "OPEN" | "COGS_IS_PURCHASES" | "RENT" | "SALARY" | "RENT_LUMP" | "BANK_DAYS" | "NO_BANK";

export interface PnlGap {
  id: PnlGapId;
  label: string;
  /** ما يُكمله وأين. */
  action: string;
  href: string;
}

export type PnlLineKind = "item" | "sub" | "total" | "memo";

export interface PnlLine {
  id: string;
  label: string;
  /** `null` غير معروف — و`note` يقول لماذا. */
  amountMinor: number | null;
  kind: PnlLineKind;
  note?: string;
  /** يُطرَح من المجموع (تكلفةٌ أو مصروف) — للعرض. */
  negative?: boolean;
}

export type CogsMethod = "STOCK" | "PURCHASES";

export interface Pnl {
  month: string;
  revenueMinor: number | null;
  cogsMinor: number | null;
  cogsMethod: CogsMethod | null;
  grossProfitMinor: number | null;
  grossMarginBp: number | null;
  opexMinor: number;
  profitMinor: number | null;
  netMarginBp: number | null;
  /** اسمُ الرقم بما يشمله: «صافي الربح» · «الربح قبل الإيجار» … */
  profitLabel: string;
  /** لا ينقصه أساسيّ، والتكلفةُ بالجرد، والشهرُ انتهى. */
  complete: boolean;
  gaps: PnlGap[];
  lines: PnlLine[];
  /** الجرد − النظريّة − الهدر المسجَّل: ما خرج من الرفّ ولا يفسّره بيعٌ ولا هدرٌ مكتوب. */
  unexplainedMinor: number | null;
  opexByCategory: { category: TxCategory; label: string; amountMinor: number; sources: OpexSource[] }[];
}

const bp = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part * 10_000) / whole) : null);

export function buildPnl(input: PnlInput): Pnl {
  const { month } = input;
  const gaps: PnlGap[] = [];
  const lines: PnlLine[] = [];

  /* ── الإيراد ── */
  const foodicsNetMinor = input.revenue ? input.revenue.paidMinor - input.revenue.vatMinor : null;
  const other = input.otherSales && input.otherSales.count > 0 ? input.otherSales : null;
  /* فودكس المجهول يجعل الإيرادَ مجهولاً — والمبيعُ خارجه لا يملأ الفراغ */
  const revenueMinor = foodicsNetMinor === null ? null : foodicsNetMinor + (other?.grossMinor ?? 0);
  if (input.revenue === null) {
    gaps.push({ id: "NO_REVENUE", label: "لا مبيعات مقروءة من فودكس لهذا الشهر", action: "زامن فودكس", href: "/money/foodics" });
  } else if (!input.open && input.revenue.coveredDays < input.revenue.expectedDays) {
    const n = input.revenue.expectedDays - input.revenue.coveredDays;
    gaps.push({ id: "SALES_DAYS", label: `${n} يوماً من الشهر بلا مبيعات مقروءة، فالإيراد ناقص إن كان المقهى مفتوحاً فيها`, action: "راجع أيام المبيعات", href: `/finance/sales?month=${month}` });
  }
  if (input.open) gaps.push({ id: "OPEN", label: "الشهر لم ينتهِ بعد، وأرقامه حتى آخر يوم مقروء", action: "تكتمل حين ينتهي الشهر", href: `/finance?month=${month}` });

  if (other) {
    lines.push({ id: "revenue-foodics", label: "مبيعات فودكس: ما دفعه الزبائن دون الضريبة", amountMinor: foodicsNetMinor, kind: "item", note: input.revenue === null ? "لا مبيعات مقروءة" : undefined });
    lines.push({
      id: "revenue-other", label: `مبيعات خارج فودكس: ${other.count} حوالة واردة صنّفتها بيعاً، بمبلغها كما وصل`, amountMinor: other.grossMinor, kind: "item",
      note: "إن كانت فيها ضريبة فهي داخل هذا المبلغ ولم تُطرح. اسأل محاسبك عن معاملتها في الإقرار",
    });
    lines.push({ id: "revenue", label: "الإيراد", amountMinor: revenueMinor, kind: "total", note: input.revenue === null ? "مبيعات فودكس غير مقروءة" : undefined });
  } else {
    lines.push({ id: "revenue", label: "الإيراد: ما دفعه الزبائن دون الضريبة", amountMinor: revenueMinor, kind: "total", note: input.revenue === null ? "لا مبيعات مقروءة" : undefined });
  }

  /* ── تكلفةُ المبيعات ── */
  const c = input.cogs;
  const cogsMethod: CogsMethod | null = c.stock ? "STOCK" : c.purchasesInvoices > 0 ? "PURCHASES" : null;
  const cogsMinor = c.stock ? c.stock.minor : c.purchasesInvoices > 0 ? c.purchasesMinor : null;
  if (cogsMethod === "PURCHASES") {
    gaps.push({
      id: "COGS_IS_PURCHASES",
      label: `التكلفة هنا مشتريات الشهر، لا ما استُهلك منها (${c.stockMissing ?? "لا جرد يفصل المخزون"})`,
      action: "أدخل الجرد", href: "/inventory",
    });
  }
  lines.push({
    id: "cogs",
    label: cogsMethod === "STOCK" ? "تكلفة المبيعات بالجرد (المشتريات + مخزون أول الشهر − مخزون آخره)"
      : cogsMethod === "PURCHASES" ? "تكلفة المبيعات = مشتريات الشهر (لا جرد يفصل المخزون)" : "تكلفة المبيعات",
    amountMinor: cogsMinor, kind: "item", negative: true,
    note: cogsMethod === null ? "لا فاتورة مسجّلة ولا جرد" : c.stock
      ? `من جرد ${formatDay(c.stock.openingDay)} إلى جرد ${formatDay(c.stock.closingDay)} · ${c.stock.countedItems} صنفاً معدوداً${c.stock.adjustedDays > 0 ? ` · ${c.stock.adjustedDays} أيام بين الجرد ونهاية الشهر قُدّرت بالاستهلاك النظري` : ""}`
      : undefined,
  });
  const unexplainedMinor = c.stock && c.theoreticalMinor !== null ? c.stock.minor - c.theoreticalMinor - c.wasteMinor : null;
  if (c.stock) {
    lines.push({ id: "cogs-theoretical", label: "منها ما تفسّره الوصفات (الاستهلاك النظري)", amountMinor: c.theoreticalMinor, kind: "sub", note: c.theoreticalMinor === null ? "لا وصفات ولا تكلفة" : undefined });
    lines.push({ id: "cogs-waste", label: "والهدر المسجّل", amountMinor: c.wasteMinor, kind: "sub" });
    lines.push({
      id: "cogs-unexplained",
      /* السالبُ ليس ربحاً: صُرف نظريّاً أكثر ممّا خرج من الرفّ — خطأُ بياناتٍ يُسمّى */
      label: unexplainedMinor !== null && unexplainedMinor < 0
        ? "الوصفات تقول إن المستهلك أكثر مما خرج من الرف. ربما هناك فاتورة لم تُسجَّل، أو وصفة أكبر من الواقع، أو جرد خاطئ"
        : "والباقي فرق غير مفسَّر. ربما هدر لم يُسجَّل، أو وصفة أصغر من الواقع، أو مستلزمات بلا وصفة",
      amountMinor: unexplainedMinor, kind: "sub",
    });
  }

  const grossProfitMinor = revenueMinor !== null && cogsMinor !== null ? revenueMinor - cogsMinor : null;
  lines.push({ id: "gross", label: "مجمل الربح", amountMinor: grossProfitMinor, kind: "total", note: grossProfitMinor === null ? "يحتاج إلى إيراد وتكلفة" : undefined });

  /* ── المصروفاتُ التشغيليّة ── */
  const byCategory = new Map<TxCategory, { amountMinor: number; sources: Set<OpexSource> }>();
  for (const row of input.opex) {
    const acc = byCategory.get(row.category) ?? { amountMinor: 0, sources: new Set<OpexSource>() };
    acc.amountMinor += row.amountMinor;
    acc.sources.add(row.source);
    byCategory.set(row.category, acc);
  }
  const opexByCategory = [...byCategory]
    .map(([category, v]) => ({ category, label: CATEGORY_LABEL[category], amountMinor: v.amountMinor, sources: [...v.sources] }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  const opexMinor = opexByCategory.reduce((s, x) => s + x.amountMinor, 0);

  const has = (category: TxCategory) => (byCategory.get(category)?.amountMinor ?? 0) > 0 || input.declaredNone.includes(category);
  const essentials: { category: TxCategory; id: PnlGapId; name: string }[] = [
    { category: "RENT", id: "RENT", name: "الإيجار" },
    { category: "SALARY", id: "SALARY", name: "الرواتب" },
  ];
  const missingEssentials = essentials.filter((e) => !has(e.category));
  for (const e of missingEssentials) {
    gaps.push({
      id: e.id,
      label: `لا ${e.name === "الإيجار" ? "إيجار" : "رواتب"} مسجّلة لهذا الشهر، لا في الكشف ولا فيما أضفته`,
      action: `أدخل ${e.name}`, href: `/finance/inputs?month=${month}&category=${e.category}`,
    });
  }
  /* إيجارٌ خرج من الكشف دفعةً ولم يُقَل كم شهراً يغطّي: شهرُه يحمله كلَّه وجيرانُه بلا إيجار */
  const rentLump = input.opex.filter((o) => o.category === "RENT" && o.source === "BANK").reduce((s, o) => s + o.amountMinor, 0);
  if (rentLump > 0) {
    gaps.push({
      id: "RENT_LUMP",
      label: "الإيجار هنا دفعة من الكشف بكامل مبلغها. إن كانت تغطي عدة أشهر فهذا الشهر يتحمّلها وحده",
      action: "حدّد كم شهراً تغطي", href: `/finance/inputs?month=${month}&category=RENT`,
    });
  }
  if (input.bankGapDays === null) gaps.push({ id: "NO_BANK", label: "لا كشف بنك لهذا الشهر، فمصروفاته من الكشف لا تظهر", action: "استورد كشفاً", href: "/bank#import" });
  else if (input.bankGapDays > 0 && !input.open) gaps.push({ id: "BANK_DAYS", label: `${input.bankGapDays} يوماً بلا كشف بنك، وما خرج فيها غير معروف`, action: "استورد كشفاً", href: "/bank#import" });

  for (const x of opexByCategory) {
    lines.push({
      id: `op-${x.category}`, label: x.label, amountMinor: x.amountMinor, kind: "item", negative: true,
      note: x.sources.some((s) => s === "SPREAD" || s === "OFF_BOOK") ? "تشمل ما أضفته بنفسك" : undefined,
    });
  }
  for (const e of missingEssentials) {
    lines.push({ id: `op-${e.category}`, label: CATEGORY_LABEL[e.category], amountMinor: null, kind: "item", negative: true, note: "لا شيء مسجّل: القيمة غير معروفة، لا صفر" });
  }
  lines.push({ id: "opex", label: "مجموع المصروفات التشغيلية المعروفة", amountMinor: opexMinor, kind: "item", negative: true });

  /* ── الربح واسمُه ── */
  const profitMinor = grossProfitMinor !== null ? grossProfitMinor - opexMinor : null;
  const before = missingEssentials.map((e) => e.name);
  const otherGaps = gaps.some((g) => g.id === "SALES_DAYS" || g.id === "BANK_DAYS" || g.id === "NO_BANK" || g.id === "RENT_LUMP");
  const complete = profitMinor !== null && before.length === 0 && !otherGaps && !input.open && cogsMethod === "STOCK";
  let profitLabel = profitMinor === null ? "الربح" : before.length > 0 ? `الربح قبل ${before.join(" و")}` : "صافي الربح";
  if (profitMinor !== null) {
    if (otherGaps) profitLabel += " — غير مكتمل";
    else if (cogsMethod === "PURCHASES") profitLabel += " — بتكلفة المشتريات";
    if (input.open) profitLabel += " — حتى اليوم";
  }
  lines.push({ id: "profit", label: profitLabel, amountMinor: profitMinor, kind: "total", note: profitMinor === null ? "يحتاج إلى إيراد وتكلفة" : undefined });

  /* ── للعلم: ما ليس مصروفاً ── */
  const excludedMinor = input.excluded.filter((x) => x.kind !== "PURCHASES").reduce((s, x) => s + x.amountMinor, 0);
  if (excludedMinor > 0) lines.push({ id: "excluded", label: "ضريبة سُدّدت أو تُخصم في الإقرار، وليست مصروفاً", amountMinor: excludedMinor, kind: "memo" });
  const viaStaffMinor = input.excluded.filter((x) => x.kind === "PURCHASES").reduce((s, x) => s + x.amountMinor, 0);
  if (viaStaffMinor > 0) lines.push({ id: "excluded-purchases", label: "مبالغ أعطيتها موظفين ليسددوا فواتير مورّدين، محسوبة في المشتريات لا في المصروفات", amountMinor: viaStaffMinor, kind: "memo" });
  if (c.staffMinor !== null && c.staffMinor > 0) lines.push({ id: "staff-drinks", label: "مشروبات الموظفين بتكلفتها، وهي داخلة في تكلفة المبيعات", amountMinor: c.staffMinor, kind: "memo" });
  if (c.returnedMinor != null && c.returnedMinor > 0) lines.push({ id: "returned-after-prep", label: "مشروبات حُضّرت ثم أُرجعت بتكلفتها: داخلة في تكلفة المبيعات وتُعدّ هدراً (لم تعد تُنقص التكلفة منذ ٢٤ أكتوبر ٢٠٢٦)", amountMinor: c.returnedMinor, kind: "memo" });

  return {
    month,
    revenueMinor, cogsMinor, cogsMethod, grossProfitMinor,
    grossMarginBp: grossProfitMinor !== null && revenueMinor !== null ? bp(grossProfitMinor, revenueMinor) : null,
    opexMinor, profitMinor,
    netMarginBp: profitMinor !== null && revenueMinor !== null ? bp(profitMinor, revenueMinor) : null,
    profitLabel, complete, gaps, lines, unexplainedMinor, opexByCategory,
  };
}

/** أشهرُ إقرارٍ من `from` إلى `to` شاملةً. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * حصّةُ شهرٍ من مبلغٍ يُوزَّع على أشهر بالتساوي — والباقي من القسمة في الشهر الأخير،
 * فمجموعُ الحصص هو المبلغُ بالهللة. `0` لشهرٍ خارج المدى.
 */
export function spreadShare(amountMinor: number, from: string, to: string, month: string): number {
  const months = monthsBetween(from, to);
  const index = months.indexOf(month);
  if (index < 0) return 0;
  const each = Math.floor(amountMinor / months.length);
  return index === months.length - 1 ? amountMinor - each * (months.length - 1) : each;
}
