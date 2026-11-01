/**
 * النقدُ المطلوب للأشهر الثلاثة القادمة (أحمد، ١ نوفمبر ٢٠٢٦: «اضف ميزة او خيار الكاش اللي نحتاجه للثلاث الشهور
 * القادمة بناءً على كل شيء: التوقعات والمصروفات والايجار والرواتب»).
 *
 * لا حسابَ جديداً: المعروفُ يُؤخذ مما يقرؤه «النقد القادم» نفسُه (دفعتا المورّدين · المتكرّر بـ`occursIn` · الرواتب · مواعيد
 * الإقرار)، وما لا يُعرف بعدُ يُقدَّر بمتوسط آخر ثلاثة أشهر من كشف البنك **ويُسمّى تقديراً** في خليّته. والمجهولُ
 * يبقى `null` فيُقال «غير معروف» ولا يُكتب صفراً.
 *
 * مبلغٌ خارج فقط: لا يدخله ما سيدخل من المبيعات، فهي لا تُتنبّأ هنا (يُعرض متوسطُ ما أُودع منها للمقارنة وحده).
 *
 * دالّةٌ خالصة.
 */
import { occursIn, withoutPayrollDuplicates, type PayrollDue, type PrepaidRenewal, type RecurringInput, type VatDue } from "../cash-outlook";
import { addMonths } from "../filing";
import { formatMonth } from "../riyadh-time";

export const CASH_NEED_MONTHS = 3;

/* ───────────── متوسطات البنك ───────────── */

export interface BankMonthRow {
  /** YYYY-MM بتوقيت الرياض */
  month: string;
  category: string;
  direction: "DEBIT" | "CREDIT";
  minor: number;
}

export interface BankAverages {
  /** الأشهر التي حُسب منها المتوسط — كاملةً قبل الشهر الجاري. */
  months: string[];
  /** `null`: كشفُ البنك لا يبلغ نهايتَها، فمتوسطٌ ناقص يُنقِص الحاجة. */
  supplierPerMonthMinor: number | null;
  /** كهرباء · حكومي · أخرى · رسوم البنك والشبكة — بلا ما سُجّل متكرّراً ولا الرواتب ولا الإيجار. */
  usualPerMonthMinor: number | null;
  /** سحوباتُ المالك لنفسه **بعد ما وزّعه منها على الرواتب** — ذاك رواتبُ لا سحب، وهو داخلٌ في المسيّر فلا يُحسب ثانيةً. */
  ownerDrawsPerMonthMinor: number | null;
  /** ما خرج من البنك للرواتب مباشرةً (باب «راتب»). */
  salaryPerMonthMinor: number | null;
  /** ما حوّله المالكُ لنفسه ثمّ وزّعه على الموظّفين رواتب (`payroll_links`) — خرج من البنك باب «شخصي» وهو راتب. */
  payrollViaOwnerPerMonthMinor: number | null;
  /** ما أُودع من تسوية الشبكة (فودكس) — للمقارنة، لا تنبّؤاً. */
  depositsPerMonthMinor: number | null;
}

/** ما يتكرّر كلَّ شهر تقريباً ولا يُسجَّل متكرّراً عادةً. الزكاة سنويّة فلا تُقسَّم على ثلاثة أشهر. */
export const USUAL_CATEGORIES: ReadonlySet<string> = new Set(["UTILITY", "GOVERNMENT", "OTHER", "BANK_FEE", "BANK_VAT", "POS_FEE", "POS_VAT"]);

/** آخرُ يومٍ في الكشف يلزم أن يبلغه الشهرُ الأخير كي يُعدّ كاملاً. */
const COVERED_FROM_DAY = 25;

export function bankAverages(
  rows: readonly BankMonthRow[],
  thisMonth: string,
  lastBankDay: string | null,
  /** أبوابُ ما سجّله صاحبُه متكرّراً فاعلاً — لا تُحسب مرّتين. */
  registeredCategories: ReadonlySet<string>,
  /** ما وُزّع من حوالات «شخصي» رواتبَ وسلفاً، بشهر الحوالة — يُطرح من سحوبات المالك ويُنسب إلى الرواتب. */
  payrollViaOwner: readonly { month: string; minor: number }[] = [],
): BankAverages {
  const months = Array.from({ length: CASH_NEED_MONTHS }, (_, i) => addMonths(thisMonth, i - CASH_NEED_MONTHS));
  const last = months[months.length - 1];
  const covered = lastBankDay !== null && lastBankDay >= `${last}-${String(COVERED_FROM_DAY).padStart(2, "0")}`;
  if (!covered) return { months, supplierPerMonthMinor: null, usualPerMonthMinor: null, ownerDrawsPerMonthMinor: null, salaryPerMonthMinor: null, payrollViaOwnerPerMonthMinor: null, depositsPerMonthMinor: null };
  const inWindow = rows.filter((r) => months.includes(r.month));
  const total = (pick: (r: BankMonthRow) => boolean) => inWindow.filter(pick).reduce((s, r) => s + r.minor, 0);
  const avg = (pick: (r: BankMonthRow) => boolean) => Math.round(total(pick) / months.length);
  const viaOwner = payrollViaOwner.filter((p) => months.includes(p.month)).reduce((s, p) => s + p.minor, 0);
  const personal = total((r) => r.direction === "DEBIT" && r.category === "PERSONAL");
  return {
    months,
    supplierPerMonthMinor: avg((r) => r.direction === "DEBIT" && r.category === "SUPPLIER"),
    usualPerMonthMinor: avg((r) => r.direction === "DEBIT" && USUAL_CATEGORIES.has(r.category) && !registeredCategories.has(r.category)),
    ownerDrawsPerMonthMinor: Math.round(Math.max(0, personal - viaOwner) / months.length),
    salaryPerMonthMinor: avg((r) => r.direction === "DEBIT" && r.category === "SALARY"),
    payrollViaOwnerPerMonthMinor: Math.round(Math.min(viaOwner, personal) / months.length),
    depositsPerMonthMinor: avg((r) => r.direction === "CREDIT" && r.category === "POS_SETTLEMENT"),
  };
}

/* ───────────── الخطّة ───────────── */

export type CashNeedRowKey = "SUPPLIERS" | "PAYROLL" | "FIXED" | "VAT" | "USUAL";

export interface CashNeedCell {
  /** `null`: لا يُعرف — لا يُكتب صفراً. */
  minor: number | null;
  /** تقديرٌ من متوسط البنك أو من دفعةٍ سابقة، لا مبلغٌ معروف. */
  estimate: boolean;
  /** ما يُقال تحت الرقم. */
  note?: string;
}

export interface CashNeedRow {
  key: CashNeedRowKey;
  label: string;
  hint: string;
  cells: CashNeedCell[];
  /** مجموعُ ما عُرف أو قُدّر مبلغُه. */
  totalMinor: number;
}

export interface CashNeedPlan {
  months: string[];
  rows: CashNeedRow[];
  monthTotals: number[];
  totalMinor: number;
  /** منه ما هو تقدير (متوسطٌ أو دفعةٌ سابقة). */
  estimateMinor: number;
  /** خلايا لا يُعرف مبلغُها، بوصفها. */
  unknown: string[];
  /** دفعاتٌ كبيرة تقع بعد الأشهر الثلاثة مباشرة — يُجنَّب لها. */
  beyond: PrepaidRenewal[];
}

export interface CashNeedInput {
  today: string;
  /** المستحقّ الآن لدفعة الشهر الماضي. */
  overdueRunMinor: number;
  /** فواتيرُ هذا الشهر حتى اليوم — تُدفع أوّلَ القادم. */
  nextRunKnownMinor: number;
  supplierPerMonthMinor: number | null;
  recurring: readonly RecurringInput[];
  paidThisMonth: ReadonlySet<string>;
  payroll: readonly PayrollDue[];
  vat: readonly VatDue[];
  /** الدفعاتُ المقدّمة القادمة: المسجّلُ منها متكرّراً (`scheduled`) والمشتقُّ من التوزيع تقديراً. */
  upcoming: readonly PrepaidRenewal[];
  usualPerMonthMinor: number | null;
}

const sumKnown = (cells: readonly CashNeedCell[]) => cells.reduce((s, c) => s + (c.minor ?? 0), 0);

export function buildCashNeed(input: CashNeedInput): CashNeedPlan {
  const first = input.today.slice(0, 7);
  const months = Array.from({ length: CASH_NEED_MONTHS }, (_, i) => addMonths(first, i));
  const last = months[months.length - 1];

  /* ── المورّدون: المستحقُّ الآن معروف، وما بعده من فواتير لم تصل بعد فيُقدَّر بمتوسط ما حُوِّل ── */
  const avg = input.supplierPerMonthMinor;
  const suppliers: CashNeedCell[] = months.map((_, i) => {
    if (i === 0) return { minor: input.overdueRunMinor, estimate: false, note: "المستحق الآن عن فواتير الشهر الماضي" };
    const known = i === 1 ? input.nextRunKnownMinor : 0;
    if (avg === null) {
      return i === 1
        ? { minor: known, estimate: false, note: "فواتير هذا الشهر حتى اليوم فقط، وتزيد" }
        : { minor: null, estimate: true, note: "لا كشف بنك يكفي لتقدير ما يُحوَّل" };
    }
    return { minor: Math.max(known, avg), estimate: true, note: known >= avg ? "فواتير هذا الشهر المسجّلة تزيد على المعتاد" : "متوسط ما حُوِّل للمورّدين في آخر ثلاثة أشهر" };
  });

  /* ── الرواتب: يوم الصرف من المسيّر؛ وما بعد الشهر الجاري بالراتب المكتوب بلا خصومات لم تقع بعد ── */
  const payroll: CashNeedCell[] = months.map((m, i) => {
    const p = input.payroll.find((x) => x.month === m);
    if (!p) return { minor: null, estimate: true, note: "لا مسيّر لهذا الشهر" };
    const unknownNote = p.unknownPeople > 0 ? `ومعهم ${p.unknownPeople} بلا راتب مكتوب لم يُحسب` : undefined;
    return { minor: p.amountMinor, estimate: i > 0, note: unknownNote ?? (i > 0 ? "بالراتب المكتوب، قبل أي خصم أو إضافة" : undefined) };
  });

  /* ── الإيجار والمتكرّر: المسجَّل بأشهره (`occursIn`)، والدفعةُ المقدّمة المشتقّة تقديراً إن لم يُسجَّل بابُها ── */
  const registered = new Set(input.recurring.flatMap((r) => (r.category ? [r.category] : [])));
  const live = withoutPayrollDuplicates(input.recurring, input.payroll);
  const fixed: CashNeedCell[] = months.map((m) => {
    const hits = live.filter((r) => occursIn(r, m).occurs && !(m === first && input.paidThisMonth.has(r.id)));
    const derived = input.upcoming.filter((u) => !u.scheduled && u.dueMonth === m && !registered.has(u.category));
    const minor = hits.reduce((s, r) => s + r.amountMinor, 0) + derived.reduce((s, u) => s + u.estimateMinor, 0);
    const names = [...hits.map((r) => r.label), ...derived.map((u) => u.label)];
    return { minor, estimate: derived.length > 0, note: names.length > 0 ? names.join("، ") + (derived.length > 0 ? " (تقدير بمبلغ آخر دفعة)" : "") : undefined };
  });

  /* ── الضريبة: كلُّ إقرارٍ في شهر موعده؛ وما فات موعدُه يُسدَّد الآن فيدخل الشهر الأول ── */
  const vatCells: { minor: number | null; estimate: boolean; names: string[] }[] = months.map(() => ({ minor: 0, estimate: false, names: [] }));
  for (const v of input.vat) {
    const at = v.deadline.slice(0, 7) < first ? first : v.deadline.slice(0, 7);
    if (at > last) continue;
    const c = vatCells[months.indexOf(at)];
    if (v.amountMinor === null) c.minor = null;
    else if (c.minor !== null) c.minor += Math.max(0, v.amountMinor);
    if (v.accruing) c.estimate = true;
    c.names.push(`${v.label}${v.accruing ? " (حتى اليوم، وتزيد مع المبيعات)" : ""}${v.amountMinor === null ? " (غير معروف: ينقص كشف بنك)" : ""}`);
  }
  const vat: CashNeedCell[] = vatCells.map((c) => ({ minor: c.minor, estimate: c.estimate, note: c.names.length > 0 ? c.names.join("، ") : undefined }));

  /* ── المعتاد غير المسجَّل: متوسط آخر ثلاثة أشهر ── */
  const usual: CashNeedCell[] = months.map(() => input.usualPerMonthMinor === null
    ? { minor: null, estimate: true, note: "لا كشف بنك يكفي للتقدير" }
    : { minor: input.usualPerMonthMinor, estimate: true });

  const mk = (key: CashNeedRowKey, label: string, hint: string, cells: CashNeedCell[]): CashNeedRow => ({ key, label, hint, cells, totalMinor: sumKnown(cells) });
  const rows: CashNeedRow[] = [
    mk("SUPPLIERS", "المورّدون", "المستحق الآن، ثم المعتاد لما لم تصل فواتيره", suppliers),
    mk("PAYROLL", "الرواتب", "يوم الصرف في كل شهر", payroll),
    mk("FIXED", "الإيجار والمصروفات المسجّلة", "كل مصروف متكرر في شهر استحقاقه، والإيجار كل ستة أشهر", fixed),
    mk("VAT", "الضريبة", "آخر موعد لكل إقرار", vat),
    mk("USUAL", "مصروفات معتادة غير مسجّلة", "كهرباء وحكومي ورسوم البنك والشبكة، بمتوسط آخر ثلاثة أشهر", usual),
  ];

  const monthTotals = months.map((_, i) => rows.reduce((s, r) => s + (r.cells[i].minor ?? 0), 0));
  const unknown = rows.flatMap((r) => r.cells.flatMap((c, i) => (c.minor === null ? [`${r.label} — ${formatMonth(months[i])}`] : [])));
  return {
    months,
    rows,
    monthTotals,
    totalMinor: monthTotals.reduce((s, x) => s + x, 0),
    estimateMinor: rows.reduce((s, r) => s + r.cells.reduce((t, c) => t + (c.estimate ? (c.minor ?? 0) : 0), 0), 0),
    unknown,
    beyond: input.upcoming.filter((u) => u.dueMonth > last),
  };
}

/** كم يلزم أن يبقى في البنك: الحاجةُ الكلّيّة مقابل الرصيد — `null` إن لم يُعرف الرصيد. */
export function coverageOf(totalMinor: number, balanceMinor: number | null): { gapMinor: number; covered: boolean } | null {
  if (balanceMinor === null) return null;
  return { gapMinor: balanceMinor - totalMinor, covered: balanceMinor >= totalMinor };
}
