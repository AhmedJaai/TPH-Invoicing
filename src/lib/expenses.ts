/**
 * المصروف الفعلي.
 *
 * `recurring_expenses` يقول كم يُتوقَّع، وهذا يقول كم صُرف فعلاً. وأهمّ
 * ما فيه ليس الجمع بل **ما لا يُجمع**: سداد المورّد ليس مصروفاً هنا،
 * لأنّه محسوبٌ في المشتريات — وجمعه مرّتين يضاعف مصروف المقهى.
 *
 * دوالّ خالصة. لا قاعدة بيانات.
 */
import { createHash } from "node:crypto";
import { CATEGORY_LABEL, type TxCategory } from "./bank/rules";

export type ExpenseSource = "BANK" | "INVOICE" | "MANUAL";

export interface Expense {
  id: string;
  periodMonth: string;
  occurredOn: string;
  category: TxCategory;
  label: string;
  /** موجب دائماً — كونه مصروفاً يحمل اتجاهه. */
  amountMinor: number;
  source: ExpenseSource;
  bankTransactionId?: string | null;
  recurringExpenseId?: string | null;
}

export interface RecurringExpense {
  id: string;
  label: string;
  category: TxCategory;
  amountMinor: number;
  cadence: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  isActive: boolean;
}

export interface BankTx {
  id: string;
  valueDate: Date;
  description: string | null;
  beneficiaryRaw: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  category: TxCategory;
}

/**
 * تصنيفات لا تُقيَّد مصروفاً من كشف البنك.
 *
 * `SUPPLIER` محسوبٌ في المشتريات، فقيده مصروفاً يضاعفه.
 * `INTERNAL` حركة بين حسابَي المنشأة، لا مال خرج منها.
 * `PERSONAL` سحب المالك، وهو توزيع لا مصروف تشغيليّ.
 * `UNKNOWN` لم يُعرف وجهه — والمجهول لا يُقيَّد بابَ حساب.
 */
export const NOT_AN_EXPENSE: readonly TxCategory[] = [
  "SUPPLIER", "INTERNAL", "PERSONAL", "UNKNOWN",
];

export function isExpenseCategory(c: TxCategory): boolean {
  return !NOT_AN_EXPENSE.includes(c);
}

/**
 * ما يقول وصفه إنّه شراء بضاعة، مهما قالت القاعدة.
 *
 * وُجد في كشف أحمد تسع حركات وصفها «شراء بضاعة» وباسم مخبز، وقد
 * صنّفتها قواعده **راتباً** — لأنّ القاعدة تعلّمت اسم الشخص، والشخص
 * نفسه مورّد وموظّف. فلو قُيّدت مصروفاً لصار مبلغها محسوباً مرّتين:
 * في المشتريات وفي المصروفات.
 *
 * فالوصف الصريح يُقدَّم على التصنيف المستنتَج. ولا يُغيَّر تصنيف
 * الحركة هنا — يُستبعَد قيدها مصروفاً ويُعلَن السبب، فتصحيح التصنيف
 * قرار صاحب العمل لا قرار الاشتقاق.
 */
export const GOODS_PURCHASE_MARKERS: readonly string[] = [
  "شراء بضاعة",
  "شراء بضاعه",
  "قيمة بضاعة",
  "goods purchase",
];

export function looksLikeGoodsPurchase(...texts: (string | null | undefined)[]): boolean {
  const blob = texts.filter(Boolean).join(" ").toLowerCase();
  return GOODS_PURCHASE_MARKERS.some((m) => blob.includes(m.toLowerCase()));
}

export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface DerivedExpenses {
  candidates: ExpenseCandidate[];
  /** حركات وصفها يقول شراء بضاعة وإن صنّفتها القاعدة غير ذلك. */
  goodsPurchases: { bankTransactionId: string; label: string; amountMinor: number }[];
}

export interface ExpenseCandidate {
  bankTransactionId: string;
  periodMonth: string;
  occurredOn: string;
  category: TxCategory;
  label: string;
  amountMinor: number;
}

/**
 * ما يصلح أن يُقيَّد مصروفاً من حركات البنك.
 *
 * الخارج وحده، والمصنَّف وحده، وما ليس سداد مورّد. وما قُيّد من قبل
 * يُستبعَد بمعرّفه — فتشغيل الاشتقاق مرّتين لا يضاعف شيئاً.
 */
export function deriveFromBank(
  txs: readonly BankTx[],
  alreadyRecorded: ReadonlySet<string> = new Set(),
): DerivedExpenses {
  const out: ExpenseCandidate[] = [];
  const goodsPurchases: DerivedExpenses["goodsPurchases"] = [];

  for (const tx of txs) {
    if (tx.direction !== "DEBIT") continue;
    if (!isExpenseCategory(tx.category)) continue;
    if (alreadyRecorded.has(tx.id)) continue;
    if (tx.amountMinor === 0) continue;

    if (looksLikeGoodsPurchase(tx.description, tx.beneficiaryRaw)) {
      goodsPurchases.push({
        bankTransactionId: tx.id,
        label: tx.beneficiaryRaw?.trim() || tx.description?.trim() || "",
        amountMinor: Math.abs(tx.amountMinor),
      });
      continue;
    }

    out.push({
      bankTransactionId: tx.id,
      periodMonth: periodOf(tx.valueDate),
      occurredOn: tx.valueDate.toISOString().slice(0, 10),
      category: tx.category,
      label: tx.beneficiaryRaw?.trim() || tx.description?.trim() || CATEGORY_LABEL[tx.category],
      amountMinor: Math.abs(tx.amountMinor),
    });
  }
  return { candidates: out, goodsPurchases };
}

/** حصّة الشهر من مصروف متكرّر. */
export function monthlyShare(e: Pick<RecurringExpense, "amountMinor" | "cadence">): number {
  if (e.cadence === "MONTHLY") return e.amountMinor;
  if (e.cadence === "QUARTERLY") return Math.round(e.amountMinor / 3);
  return Math.round(e.amountMinor / 12);
}

export interface CategoryVariance {
  category: TxCategory;
  label: string;
  expectedMinor: number;
  actualMinor: number;
  /** موجب: صُرف أكثر ممّا تُوقّع. */
  varianceMinor: number;
  /** نسبة الفرق إلى المتوقَّع. `null` حين لا متوقَّع — فلا نسبة إلى صفر. */
  variancePct: number | null;
}

/**
 * المتوقَّع مقابل الفعلي لكل تصنيف في شهر.
 *
 * التصنيف الذي صُرف فيه بلا توقّع يظهر بمتوقَّعٍ صفر — وذلك صادق: لم
 * يُتوقَّع منه شيء. أمّا نسبة الفرق فتبقى `null`، إذ لا نسبة إلى صفر.
 */
export function expectedVsActual(
  recurring: readonly RecurringExpense[],
  actual: readonly Expense[],
  month: string,
): CategoryVariance[] {
  const expected = new Map<TxCategory, number>();
  for (const r of recurring) {
    if (!r.isActive) continue;
    expected.set(r.category, (expected.get(r.category) ?? 0) + monthlyShare(r));
  }

  const actualByCat = new Map<TxCategory, number>();
  for (const e of actual) {
    if (e.periodMonth !== month) continue;
    actualByCat.set(e.category, (actualByCat.get(e.category) ?? 0) + e.amountMinor);
  }

  const categories = new Set<TxCategory>([...expected.keys(), ...actualByCat.keys()]);
  const out: CategoryVariance[] = [];

  for (const category of categories) {
    const expectedMinor = expected.get(category) ?? 0;
    const actualMinor = actualByCat.get(category) ?? 0;
    out.push({
      category,
      label: CATEGORY_LABEL[category],
      expectedMinor,
      actualMinor,
      varianceMinor: actualMinor - expectedMinor,
      variancePct: expectedMinor === 0 ? null : (actualMinor - expectedMinor) / expectedMinor,
    });
  }

  return out.sort((a, b) => Math.abs(b.varianceMinor) - Math.abs(a.varianceMinor));
}

/**
 * المتوقَّع الذي لم يُصرف بعد في هذا الشهر.
 *
 * السؤال الذي لم يكن النظام يجيبه: هل دُفع الإيجار؟ وغياب الجواب أخطر
 * من الرقم نفسه — فالمصروف المنسيّ يظهر متأخّراً ومعه غرامته.
 */
export function unmetRecurring(
  recurring: readonly RecurringExpense[],
  actual: readonly Expense[],
  month: string,
): RecurringExpense[] {
  const paidIds = new Set(
    actual.filter((e) => e.periodMonth === month && e.recurringExpenseId)
      .map((e) => e.recurringExpenseId as string),
  );
  const spentByCategory = new Map<TxCategory, number>();
  for (const e of actual) {
    if (e.periodMonth !== month) continue;
    spentByCategory.set(e.category, (spentByCategory.get(e.category) ?? 0) + e.amountMinor);
  }

  return recurring.filter((r) => {
    if (!r.isActive) return false;
    if (paidIds.has(r.id)) return false;
    // بلا ربط صريح: يُعدّ مدفوعاً إن بلغ صرفُ بابه حصّةَ الشهر
    return (spentByCategory.get(r.category) ?? 0) < monthlyShare(r);
  });
}

/**
 * ربط مصروف فعليّ بالمتوقَّع الذي يفي به.
 *
 * الشرط: التصنيف نفسه، والمبلغ في حدود ١٠٪ من حصّة الشهر. والتقارب
 * وحده لا يكفي — لولا التصنيف لَرُبط راتبٌ بإيجار لتشابه مبلغيهما.
 *
 * والحدّ نسبةٌ صحيحة لا كسرٌ عشريّ: `100000 * 1.1` تساوي في العدد
 * العشريّ `110000.00000000001`، فيُرفض مبلغٌ على الحدّ تماماً.
 */
export const MATCH_TOLERANCE_PCT = 10;

export function matchRecurring(
  expense: Pick<Expense, "category" | "amountMinor">,
  recurring: readonly RecurringExpense[],
): RecurringExpense | null {
  const candidates = recurring
    .filter((r) => r.isActive && r.category === expense.category)
    .map((r) => ({ r, share: monthlyShare(r) }))
    .filter(({ share }) => share > 0
      && Math.abs(expense.amountMinor - share) * 100 <= share * MATCH_TOLERANCE_PCT)
    .sort((a, b) =>
      Math.abs(expense.amountMinor - a.share) - Math.abs(expense.amountMinor - b.share));

  return candidates[0]?.r ?? null;
}

export function totalActual(actual: readonly Expense[], month: string): number {
  return actual.filter((e) => e.periodMonth === month)
    .reduce((s, e) => s + e.amountMinor, 0);
}

export function totalExpected(recurring: readonly RecurringExpense[]): number {
  return recurring.filter((r) => r.isActive).reduce((s, r) => s + monthlyShare(r), 0);
}


/**
 * قيود يُشتبه أنّها مورّدون لا مصروفات.
 *
 * وُجد في كشف أحمد «لوريفا كيك» و«هنقري مان بيكري» مصنَّفتين **راتباً**
 * بعشرة آلاف ريال. ولا يصحّ أن يُخمَّن من الاسم أنّه مخبز — درس «العنب»
 * أنّ الاسم يخدع. لكن مقابلة الاسم بسجلّ المورّدين ليست تخميناً بل
 * دليل: إن كان المستفيد مورّداً مسجَّلاً، فتصنيفه راتباً تناقض.
 *
 * ولا يُصحَّح هنا شيء — يُعرَض التناقض ليقرّره صاحب العمل.
 */
export function normalizeName(s: string): string {
  return s
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** أقصر اسم مورّد يُعتدّ به في المقابلة — ما دونه يُطابق كثيراً بالمصادفة. */
export const MIN_SUPPLIER_NAME = 4;

export function suspectedSupplierExpenses(
  rows: readonly Expense[],
  supplierNames: readonly string[],
): { expense: Expense; supplier: string }[] {
  const names = supplierNames
    .map((n) => ({ raw: n, norm: normalizeName(n) }))
    .filter((n) => n.norm.length >= MIN_SUPPLIER_NAME);

  const out: { expense: Expense; supplier: string }[] = [];
  for (const e of rows) {
    const label = normalizeName(e.label);
    if (!label) continue;
    const hit = names.find((n) => label === n.norm || label.includes(n.norm));
    if (hit) out.push({ expense: e, supplier: hit.raw });
  }
  return out;
}


/* ─────────────── ازدواج المصروف عن حدثٍ واحد ─────────────── */

/**
 * بصمة **الحدث** لا بصمة السجلّ.
 *
 * الحدث الواقعيّ الواحد — دفعُ فاتورة كهرباء بألفٍ ومئتين في الخامس من
 * أغسطس — يصل النظام من مصدرين لا يعرف أحدهما الآخر: مرّةً من كشف
 * البنك، ومرّةً من مستندٍ رُفع للدرايف. فيُقيَّد مصروفان، ويصير مصروف
 * الشهر أعلى ممّا صُرف.
 *
 * والقيود القائمة لا تمنعه: هي تمنع تكرار السجلّ عن **نفس** الحركة أو
 * **نفس** الفاتورة، وهذان سجلّان عن مصدرين مختلفين — فيمرّان.
 *
 * فالبصمة تصف ما وقع: بابُه ويومُه ومبلغُه ومن وقع له. ولا يدخلها
 * المصدر — وإلّا عادت تفرّق بين ما تريد جمعه.
 *
 * **والوصف يدخلها كاملاً — لا مقتطعاً.**
 *
 * كان يُقتطَع عند ستّين حرفاً، ففشل على بيانات أحمد الحقيقية: ثلاثُ
 * فواتير مرافق في يومٍ واحد بمبالغ متطابقة، ولا يفرّقها إلّا **مرجعُ
 * السداد** — وهو يقع بعد الحرف الستّين في وصف الأهليّ. فبدت كلٌّ منها
 * مكرَّرةً وهي حدثان حقيقيّان بحركتين بنكيّتين مختلفتين.
 *
 * فالاقتطاع لتقصير المفتاح يُسقط ما يميّز. والتقصير يكون بالتلبيد لا
 * بالقصّ: الطول ثابت والمحتوى كامل.
 */
export function expenseEventKey(input: {
  category: TxCategory;
  occurredOn: string;
  amountMinor: number;
  label: string;
}): string {
  const label = input.label
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toUpperCase();

  return createHash("sha256")
    .update([input.category, input.occurredOn, String(input.amountMinor), label].join("|"))
    .digest("hex");
}

/**
 * الأثر الذي يشهد للمصروف.
 *
 * ووجودُ أثرين مختلفين يعني حدثين مختلفين — مهما تطابق كلُّ ما عداهما.
 * حركتان بنكيّتان ببصمتين مختلفتين هما دفعتان وقعتا، لا دفعةٌ وصلت
 * مرّتين.
 */
export function expenseAnchor(e: Expense): string | null {
  return e.bankTransactionId ?? null;
}

export interface DuplicateExpense {
  key: string;
  count: number;
  amountMinor: number;
  sources: ExpenseSource[];
  label: string;
  occurredOn: string;
}

/**
 * يجد المصروفات التي تصف حدثاً واحداً.
 *
 * ويُعرَض ولا يُحذَف: أيّهما الصحيح قرارُ إنسان — قد يكون أحدهما
 * أدقّ وصفاً أو أصحّ باباً.
 */
export function findDuplicateExpenses(rows: readonly Expense[]): DuplicateExpense[] {
  const groups = new Map<string, Expense[]>();

  for (const e of rows) {
    const key = expenseEventKey(e);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return [...groups.entries()]
    .filter(([, list]) => {
      if (list.length < 2) return false;
      /*
        آثارٌ مختلفة ⇒ أحداثٌ مختلفة.

        وهذا ما كشفته بيانات أحمد: فاتورتا كهرباء في يومٍ واحد بمبلغين
        متطابقين، لكلٍّ حركتُها البنكية ببصمتها. فهما دفعتان وقعتا، لا
        دفعةٌ وصلت مرّتين — وحذفُ إحداهما يمحو مالاً خرج فعلاً.
      */
      const anchors = list.map(expenseAnchor).filter((a): a is string => a !== null);
      return new Set(anchors).size <= 1;
    })
    .map(([key, list]) => ({
      key,
      count: list.length,
      /* المبلغ الزائد لا المبلغ كلّه: واحدٌ منها صحيح */
      amountMinor: list[0].amountMinor * (list.length - 1),
      sources: [...new Set(list.map((e) => e.source))],
      label: list[0].label,
      occurredOn: list[0].occurredOn,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}
