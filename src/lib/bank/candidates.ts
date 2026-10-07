/**
 * توليد المرشّحين وتسجيلهم.
 *
 * كان النظام يبحث عن **أوّل** مطابقة ثمّ يتوقّف، ويقصر مجموعات الفواتير
 * على ثلاث من أصل أربع عشرة. فمورّدٌ له ثلاثون فاتورة مفتوحة ودفعةٌ
 * تسدّد ستّاً منها لا تُوجَد أبداً.
 *
 * وهنا يُولَّد **كل** مرشّح محتمل، ثمّ يُسجَّل بأبعادٍ منفصلة: المبلغ
 * والتاريخ والمرجع والمورّد. ولا يُختار شيء هنا — الاختيار في
 * `optimizer.ts`، والقرار في `decision.ts`.
 *
 * والمبدأ الحاكم: **أثبِت المطابقة، لا تجدها.** المطابقة الخاطئة في
 * المال أغلى من غيابها.
 */
import type { Outcome } from "./taxonomy";
import { MAX_FEE_MINOR, MAX_FEE_RATIO, splitBankFee } from "./fees";
import { fitToProfile, type SupplierProfile } from "./supplier-profile";
import { DAY, INVOICE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { riyadhDayNumber } from "@/lib/riyadh-time";

export interface OpenInvoice {
  id: string;
  supplierId: string;
  invoiceNumber: string | null;
  invoiceDate: Date;
  periodMonth: string;
  totalMinor: number;
  /** ما بقي عليها بعد ما سُدّد. */
  outstandingMinor: number;
}

export interface MatchInput {
  transactionId: string;
  valueDate: Date;
  amountMinor: number;
  /** المورّد الذي رُجّح، إن رُجّح — ودرجة ترجيحه. */
  supplierId: string | null;
  supplierScore: number;
  /** المراجع الصالحة للمطابقة، بنصّها. */
  references: readonly string[];
  /**
   * كيف يُسدَّد هذا المورّد عادةً — إن عُرف.
   *
   * ترجّح ولا تحسم: تحرّك درجةً حُسبت من أدلّة، ولا تُنشئ مطابقةً بلا
   * دليل. فمن سُدّد مئةَ مرّةٍ في يومين قد يُسدَّد اليوم بعد شهر، وذلك
   * لا يجعل السداد غيرَ سداد.
   */
  profile?: SupplierProfile;
}

/** أبعاد التسجيل، كلٌّ من صفر إلى واحد. */
export interface ScoreParts {
  supplier: number;
  amount: number;
  date: number;
  reference: number;
}

export interface Candidate {
  invoiceIds: string[];
  outcome: Outcome;
  /** المبلغ الذي ستُخصَّص به الدفعة على هذه الفواتير. */
  allocatedMinor: number;
  parts: ScoreParts;
  /** حاصل الأبعاد بأوزانها — ليس احتمالاً، بل درجةُ ترجيح. */
  score: number;
  /** لماذا رُشِّح — يُعرَض للمستخدم كما هو. */
  evidence: string[];
  /**
   * مثّل صنفاً من فواتير متساوية المبلغ لا يفرّق بينها دليل.
   *
   * اختيارُ الأقدم منها سياسةٌ لا إثبات، فلا يُحسَم بها تلقائياً
   * (`decide`): تُقترَح بسببها ويُقرّها صاحبُها بضغطة.
   */
  ambiguity?: string;
}

/* ─────────────────── الحدود ─────────────────── */

/** تسامح المبلغ للمطابقة التامّة: هللة واحدة لفرق التقريب. */
export const EXACT_TOLERANCE_MINOR = 1;

/** أقصى فرق يُقبَل في مجموعة فواتير — رسمُ تحويلٍ أو تقريب. */
export const GROUP_TOLERANCE_MINOR = 100;

/** نافذة التاريخ التي تُقبَل فيها الفاتورة قبل الدفعة أو بعدها. */
export const DATE_WINDOW_DAYS = 45;

/** أقصى عدد فواتير في مجموعة — يحدّه الواقع لا الحساب. */
export const MAX_GROUP_SIZE = 8;

/** أقصى عدد فواتير تدخل البحث عن مجموعة. */
export const MAX_POOL = 40;

/** أقصى عدد مجموعاتٍ تُعاد لحركةٍ واحدة. */
export const MAX_SUBSETS = 20;

/**
 * ميزانيّة عقد البحث عن المجموعات — لكلّ حركة.
 *
 * كان البحث بلا حدّ: دفعةٌ كبيرة وأربعون فاتورةً صغيرة لا مجموعةَ فيها تعدّ
 * نحو مئة مليون فرع داخل طلبٍ مهلتُه ستّون ثانية. والحدّ يُعلَن عند نفاده
 * (`exhausted`) كما يُعلَن في المحسِّن — فلا يُدَّعى بحثٌ لم يكتمل.
 */
export const SUBSET_NODE_BUDGET = 200_000;

/**
 * نسبٌ مألوفة للعربون والقسط من إجماليّ الفاتورة.
 *
 * دفعةُ نصف الفاتورة لم تكن تُرشَّح أصلاً: درجةُ المبلغ صفرٌ متى جاوز
 * الفرقُ العُشر. فتُرشَّح حين توافق نسبةً مألوفة **ضمن هللة** — اقتراحاً
 * دائماً لا حسماً (`PARTIAL_PAYMENT`).
 */
export const INSTALMENT_PERCENTS: readonly number[] = [25, 30, 50, 70];

/** درجةُ المبلغ لقسطٍ بنسبةٍ مألوفة: ترجيحٌ معتبر لا تطابق. */
export const INSTALMENT_AMOUNT_SCORE = 0.6;

/**
 * ترتيب بركة البحث: بصلتها بهذه الدفعة، لا بحجمها.
 *
 * كانت تُرتَّب تنازلياً بالمتبقّي وتُقصّ عند أربعين. فمورّدٌ له ستّون
 * فاتورة مفتوحة ودفعةٌ تسدّد ثلاثاً صغيرةً قريبةَ التاريخ: تزاحمها
 * الأربعون الكبرى فلا تدخل البحث أصلاً — ولا تُوجَد المجموعة أبداً.
 * والقصّ ليس خطأً؛ الخطأ أن يقصّ بمعيارٍ لا صلة له بالسؤال.
 *
 * والفاتورة التي تجاوز متبقّيها الدفعةَ لا تدخل مجموعةً مجموعُها
 * الدفعة — رياضةً لا ترجيحاً. فإسقاطها ليس تقريباً بل حذفُ المستحيل،
 * وهو وحده يوسّع البحث النافع دون أن يوسّع تكلفته.
 */
export function rankPool(
  invoices: readonly OpenInvoice[],
  targetMinor: number,
  txDate: Date | null,
  toleranceMinor: number = GROUP_TOLERANCE_MINOR,
): OpenInvoice[] {
  const feasible = invoices.filter(
    (i) => i.outstandingMinor > 0 && i.outstandingMinor <= targetMinor + toleranceMinor,
  );

  if (txDate === null) {
    return [...feasible].sort((a, b) => b.outstandingMinor - a.outstandingMinor);
  }

  /*
    قربُ التاريخ أوّلاً — فالدفعة تسدّد ما قرُب لا ما كبُر — ثمّ الحجم
    عند التساوي، لأنّ الكبير يقطع فرع البحث مبكراً فيُسرّعه.
  */
  return [...feasible].sort((a, b) => {
    const da = dateScore(txDate, a.invoiceDate);
    const db = dateScore(txDate, b.invoiceDate);
    if (da !== db) return db - da;
    return b.outstandingMinor - a.outstandingMinor;
  });
}

const WEIGHTS: ScoreParts = { supplier: 0.35, amount: 0.4, date: 0.1, reference: 0.15 };

/**
 * يجمع الأبعاد بأوزانها — على ما هو **متاح** منها وحده.
 *
 * كان غياب المرجع يُحسب صفراً، ووصف البنك نادراً ما يحمل رقم الفاتورة.
 * فسقفُ أيّ مطابقة كان ٠٫٨٢ ولو تطابق المبلغ تماماً وعُرف المورّد
 * يقيناً — أي أنّ التلقائية كانت مستحيلة بحكم المعايرة لا بحكم الشكّ.
 *
 * والصواب أن يُقسَّم الوزن على ما يُمكن قياسه: البُعد الذي لا سبيل إلى
 * قياسه لا يُحسَب حجّةً على المرشّح.
 *
 * والمرجع بُعدٌ **مؤيِّد لا نافٍ**: أوصاف هذا البنك تحمل مراجعه هو —
 * رقم سدادٍ أو رقم حوالة أو رقم هوية — لا أرقام فواتير مورّديك. فعدم
 * تطابقه لا يقول شيئاً عن المطابقة، وحسبانه حجّةً ضدّها جعل سقف كل
 * مطابقة ٠٫٨٣ ولو تطابق المبلغ تماماً وأكّد إنسانٌ المورّد. فإن طابق
 * رفع، وإن لم يطابق سكت.
 */
export function combine(parts: ScoreParts, available?: Partial<Record<keyof ScoreParts, boolean>>): number {
  const keys: (keyof ScoreParts)[] = ["supplier", "amount", "date", "reference"];
  let sum = 0;
  let total = 0;
  for (const k of keys) {
    if (available && available[k] === false) continue;
    sum += parts[k] * WEIGHTS[k];
    total += WEIGHTS[k];
  }
  return total === 0 ? 0 : sum / total;
}

/**
 * فرقُ الأيّام بتقويم الرياض — عددٌ صحيح.
 *
 * كان يُقسَم فرقُ الطوابع، ففاتورةٌ خُزّنت بوقتٍ وحركةٌ بمنتصف الليل يدخل
 * بينهما كسرُ يومٍ يُسقط حدَّ النافذة أو يُدخله، و«فرق التاريخ ٣ أيام»
 * تُعرَض ٢ أو ٤.
 */
function daysBetween(a: Date, b: Date): number {
  return Math.abs(riyadhDayNumber(a) - riyadhDayNumber(b));
}

/**
 * نافذة الفاتورة **بعد** الدفعة.
 *
 * أضيق من نافذة ما قبلها بكثير، وليس صفراً: قد يُدفَع اليومَ ويُصدِر
 * المورّد فاتورته غداً أو بعد أيام. أمّا فاتورةٌ بعد الدفعة بشهر فليست
 * التي سُدّدت بها.
 */
export const FUTURE_WINDOW_DAYS = 7;

/**
 * درجة قرب التاريخ — **باتّجاهها**.
 *
 * لأنّ الزمن في التجارة ذو اتّجاه: تصل الفاتورة ثمّ تُدفَع. فاتورةٌ قبل
 * الدفعة بعشرين يوماً أمرٌ عاديّ، وفاتورةٌ **بعدها** بعشرين يوماً ليست
 * التي سُدّدت بها — ولا يمكن أن تكون.
 *
 * وكان القياس بالقيمة المطلقة فيستويان. فتُرجَّح فاتورةٌ لم تكن قد
 * صدرت يوم الدفع على فاتورةٍ صدرت قبله بشهر، ويُنسَب سدادٌ إلى ما لم
 * يكن موجوداً حين وقع.
 *
 * والنافذة الأمامية ليست صفراً: قد يُدفَع اليومَ وتصدر الفاتورة غداً.
 */
export function dateScore(txDate: Date, invoiceDate: Date): number {
  const d = daysBetween(txDate, invoiceDate);
  const invoiceAfterPayment = riyadhDayNumber(invoiceDate) > riyadhDayNumber(txDate);

  if (invoiceAfterPayment) {
    if (d > FUTURE_WINDOW_DAYS) return 0;
    /* ونصفُ الدرجة سقفاً: ممكنٌ لا مرجَّح */
    return 0.5 * (1 - d / FUTURE_WINDOW_DAYS);
  }

  if (d > DATE_WINDOW_DAYS) return 0;
  return 1 - d / DATE_WINDOW_DAYS;
}

/**
 * درجة قرب المبلغ: تامّة عند التطابق، وتنهار سريعاً بالبعد.
 *
 * والزيادةُ التي في حدّ رسم التحويل تطابقٌ تامّ لا نقص.
 *
 * كان الرسم يُحسب في `fees.ts` ولا يبلغ التسجيل: تُقاس الدفعة بخمسة
 * آلاف وعشرين على فاتورة بخمسة آلاف فتُعطى ٠٫٨٥، فلا تبلغ حدّ الحسم
 * التلقائيّ وتبقى معلّقةً في «تحتاج مراجعة» — وصاحب العمل يعرف يقيناً
 * أنّها مدفوعة. فيراجع يدوياً ما حسبه النظام صحيحاً ولم يستعمله.
 *
 * والحدّ يمنع أن يصير هذا تسامحاً عامّاً: `splitBankFee` تشترط ألّا
 * يجاوز الفائض خمسةً وسبعين ريالاً ولا اثنين في المئة. وما جاوزهما فرقٌ
 * يُحقَّق فيه لا رسمٌ يُفترَض.
 */
export function amountScore(paidMinor: number, dueMinor: number): number {
  if (dueMinor <= 0) return 0;
  if (splitBankFee(paidMinor, dueMinor) !== null) return 1;
  const diff = Math.abs(paidMinor - dueMinor);
  if (diff <= EXACT_TOLERANCE_MINOR) return 1;
  const ratio = diff / dueMinor;
  if (ratio >= 0.1) return 0;
  return 1 - ratio * 10;
}

/** المرجع يطابق رقم الفاتورة إذا احتواه أحدهما الآخر ولم يكن قصيراً. */
export const MIN_REFERENCE_DIGITS = 4;

export function referenceScore(
  references: readonly string[],
  invoiceNumber: string | null,
): number {
  if (!invoiceNumber) return 0;
  const inv = invoiceNumber.replace(/\D/g, "");
  if (inv.length < MIN_REFERENCE_DIGITS) return 0;

  for (const raw of references) {
    const ref = raw.replace(/\D/g, "");
    if (ref.length < MIN_REFERENCE_DIGITS) continue;
    if (ref === inv) return 1;
    if (ref.includes(inv) || inv.includes(ref)) return 0.7;
  }
  return 0;
}

/* ─────────────────── مجموع الجزئيات ─────────────────── */

/**
 * كل مجموعة فواتير مجموعها يقارب المبلغ.
 *
 * مسألة مجموع الجزئيات: تُحلّ بالتعداد المقيَّد لا بالتجربة العشوائية.
 *
 * ‏— **بالحجم تصاعدياً** (اثنتان ثمّ ثلاث …): كان البحث يقف عند أوّل عشرين
 *   يجدها، وهي ما يبدأ بأكبر الفواتير؛ فالمجموعةُ الصحيحة الصغيرة قد لا
 *   تُعاد أصلاً. والأقلّ فواتيرَ أقربُ إلى الحقيقة فيُقدَّم.
 * ‏— **بقطعَين**: الفرعُ الذي جاوز مجموعُه الهدفَ، والفرعُ الذي لا يبلغه ولو
 *   أخذ أكبرَ ما بقي. والثاني كان غائباً، وهو الذي يُنهي بحثاً لا حلَّ له.
 * ‏— **وبكسر التماثل**: الفواتيرُ المتساويةُ المتبقّي صنفٌ واحد يُؤخَذ منه
 *   بالأقدم أوّلاً. مورّدٌ فواتيرُه بسعرٍ ثابت ودفعةٌ تسدّد اثنتين من عشر
 *   كانت تُنتج خمساً وأربعين مجموعةً متكافئة، فيسقط شرط الهامش دائماً.
 * ‏— **وبميزانيّة عقد** تُعلَن عند نفادها.
 */
export interface SubsetSearch {
  subsets: OpenInvoice[][];
  /** نفدت الميزانيّة قبل أن يكتمل البحث — فغيابُ مجموعةٍ ليس نفياً لها. */
  exhausted: boolean;
}

export interface SubsetOptions {
  toleranceMinor?: number;
  /**
   * كم يجوز أن ينقص المجموعُ عن الدفعة — وهو التسامحُ نفسه أصلاً، ويتّسع
   * إلى حدّ رسم التحويل حين يُبحَث عن «فواتير ورسمها».
   */
  shortfallMinor?: number;
  maxSize?: number;
  /** تاريخ الدفعة — به تُرتَّب البركة بصلتها لا بحجمها. */
  txDate?: Date | null;
  /** ما يُقدَّم داخل صنفه المتساوي: فاتورةٌ طابق مرجعُها تسبق الأقدم. */
  prefer?: ReadonlySet<string>;
  nodeBudget?: number;
}

export function searchSubsets(
  invoices: readonly OpenInvoice[],
  targetMinor: number,
  options: SubsetOptions = {},
): SubsetSearch {
  const toleranceMinor = options.toleranceMinor ?? GROUP_TOLERANCE_MINOR;
  const shortfallMinor = options.shortfallMinor ?? toleranceMinor;
  const maxSize = options.maxSize ?? MAX_GROUP_SIZE;
  const prefer = options.prefer;
  const budget = options.nodeBudget ?? SUBSET_NODE_BUDGET;

  const lo = targetMinor - shortfallMinor;
  const hi = targetMinor + toleranceMinor;

  const ranked = rankPool(invoices, targetMinor, options.txDate ?? null, toleranceMinor).slice(0, MAX_POOL);
  /*
    ويُعاد ترتيبها تنازلياً بعد الانتقاء: الانتقاء بالصلة، والترتيب
    داخل البحث بالحجم كي يُقطَع الفرع مبكراً. وهما سؤالان مختلفان.
    وداخل الصنف المتساوي: ما طابق مرجعُه، ثمّ الأقدم، ثمّ المعرّف ليثبت.
  */
  const pool = [...ranked].sort((a, b) =>
    b.outstandingMinor - a.outstandingMinor
    || Number(prefer?.has(b.id) ?? false) - Number(prefer?.has(a.id) ?? false)
    || a.invoiceDate.getTime() - b.invoiceDate.getTime()
    || a.id.localeCompare(b.id));

  const n = pool.length;
  /** مجاميعُ البادئات: `prefix[i]` مجموعُ أوّل `i` فاتورة. */
  const prefix: number[] = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + pool[i].outstandingMinor;

  const found: OpenInvoice[][] = [];
  const current: OpenInvoice[] = [];
  let nodes = 0;
  let exhausted = false;

  const walk = (start: number, sum: number, need: number) => {
    if (exhausted || found.length >= MAX_SUBSETS) return;
    if (++nodes > budget) { exhausted = true; return; }

    if (need === 0) {
      if (sum >= lo && sum <= hi) found.push([...current]);
      return;
    }

    for (let i = start; i + need <= n; i++) {
      /* كسر التماثل: من تُرك من صنفٍ متساوٍ لا يُؤخَذ مَن بعده فيه */
      if (i > start && pool[i].outstandingMinor === pool[i - 1].outstandingMinor) continue;
      /* أكبرُ ما يُبلَغ من هنا — وما بعده أصغر، فلا جدوى من المضيّ */
      if (sum + (prefix[i + need] - prefix[i]) < lo) break;
      /* وأصغرُ ما يُبلَغ بهذه الفاتورة يجاوز الهدف — فغيرُها أصغر قد يصلح */
      if (sum + pool[i].outstandingMinor + (prefix[n] - prefix[n - (need - 1)]) > hi) continue;

      current.push(pool[i]);
      walk(i + 1, sum + pool[i].outstandingMinor, need - 1);
      current.pop();
      if (exhausted || found.length >= MAX_SUBSETS) return;
    }
  };

  for (let size = 1; size <= Math.min(maxSize, n); size++) {
    walk(0, 0, size);
    if (exhausted || found.length >= MAX_SUBSETS) break;
  }

  return { subsets: found, exhausted };
}

export function findSubsets(
  invoices: readonly OpenInvoice[],
  targetMinor: number,
  toleranceMinor: number = GROUP_TOLERANCE_MINOR,
  maxSize: number = MAX_GROUP_SIZE,
  /** تاريخ الدفعة — به تُرتَّب البركة بصلتها لا بحجمها. */
  txDate: Date | null = null,
): OpenInvoice[][] {
  return searchSubsets(invoices, targetMinor, { toleranceMinor, maxSize, txDate }).subsets;
}

/* ─────────────────── التوليد ─────────────────── */

/**
 * كل ما يُحتمل أن تكون هذه الحركة سداداً له.
 *
 * لا يُختار هنا شيء ولا يُستبعَد الضعيف — الاختيار لاحق، وإخفاءُ
 * المرشّح الثاني هو ما يجعل المطابقة تبدو أكيدة وهي ليست كذلك.
 */
/**
 * يطبّق ملامح المورّد على درجةٍ حُسبت من أدلّة.
 *
 * ولا يُستدعى إلّا بعد أن تُحسب الدرجة كاملةً: الملامح تُرجّح بين
 * متقاربَين، ولا تُنشئ مرشّحاً ولا تلغيه. والدرجة تبقى في [٠،١] كي لا
 * تختلّ حدود القرار التي عُوير عليها.
 */
function applyProfile(
  score: number,
  tx: MatchInput,
  subset: readonly OpenInvoice[],
  evidence: string[],
): number {
  if (!tx.profile?.known) return score;

  const earliest = Math.min(...subset.map((i) => riyadhDayNumber(i.invoiceDate)));
  const lagDays = riyadhDayNumber(tx.valueDate) - earliest;

  const fit = fitToProfile(tx.profile, { lagDays, invoiceCount: subset.length });
  if (fit.reason) evidence.push(`عادةُ المورّد: ${fit.reason}`);

  return Math.max(0, Math.min(1, score + fit.adjustment));
}

export interface CandidateSearch {
  candidates: Candidate[];
  /**
   * بحثُ المجموعات لم يكتمل — فقد يوجد مرشّحٌ لم يُفحَص.
   * ومن يحسم على هذه القائمة يحسم على ناقص، فيُقترَح ولا يُطابَق.
   */
  subsetSearchExhausted: boolean;
}

export function generateCandidates(
  tx: MatchInput,
  invoices: readonly OpenInvoice[],
): Candidate[] {
  return searchCandidates(tx, invoices).candidates;
}

/** النسبةُ المألوفة التي توافقها الدفعة من إجماليّ الفاتورة ضمن هللة، أو `null`. */
export function instalmentPercent(paidMinor: number, totalMinor: number): number | null {
  if (paidMinor <= 0 || totalMinor <= 0) return null;
  for (const pct of INSTALMENT_PERCENTS) {
    /* بالأعداد الصحيحة: |المدفوع×١٠٠ − الإجماليّ×النسبة| ≤ هللة×١٠٠ */
    if (Math.abs(paidMinor * 100 - totalMinor * pct) <= EXACT_TOLERANCE_MINOR * 100) return pct;
  }
  return null;
}

export function searchCandidates(
  tx: MatchInput,
  invoices: readonly OpenInvoice[],
): CandidateSearch {
  if (tx.supplierId === null) return { candidates: [], subsetSearchExhausted: false };

  const mine = invoices.filter((i) => i.supplierId === tx.supplierId && i.outstandingMinor > 0);
  if (mine.length === 0) return { candidates: [], subsetSearchExhausted: false };

  const out: Candidate[] = [];

  /*
    ── كسر التماثل ──

    الفواتيرُ المتساويةُ المتبقّي والإجماليّ لمورّدٍ واحد (اشتراكٌ، توريدٌ يوميّ
    بالسعر نفسه) لا يفرّق بينها المبلغ. فكانت دفعةٌ تسدّد واحدةً من عشر تُنتج
    عشرةَ مرشّحين متقاربين يُسقط أحدُهم هامشَ الآخر — فلا تُحسَم أبداً.
    فيمثّل الصنفَ **ما طابق مرجعُه، وإلّا الأقدم** — سياسةُ «الأقدم أوّلاً»
    نفسها — ويُذكَر ذلك في الأدلّة. **ولا يُحسَم به تلقائياً**: الأقدمُ
    سياسةٌ لا إثبات، فيبقى اقتراحاً واحداً واضحاً بدل عشرةٍ متنازعة.
  */
  const preferred = new Set(
    mine.filter((i) => referenceScore(tx.references, i.invoiceNumber) > 0).map((i) => i.id),
  );
  const classes = new Map<string, OpenInvoice[]>();
  for (const inv of mine) {
    const key = `${inv.outstandingMinor}:${inv.totalMinor}`;
    const list = classes.get(key) ?? [];
    list.push(inv);
    classes.set(key, list);
  }
  /** كم فاتورةً مفتوحة بهذا المتبقّي — وكم منها طابق مرجعُه. */
  const byOutstanding = new Map<number, { total: number; preferred: number }>();
  for (const inv of mine) {
    const c = byOutstanding.get(inv.outstandingMinor) ?? { total: 0, preferred: 0 };
    c.total++;
    if (preferred.has(inv.id)) c.preferred++;
    byOutstanding.set(inv.outstandingMinor, c);
  }
  /** هل أُخذ من صنفٍ متساوٍ بعضُه بلا دليلٍ يعيّن المأخوذ؟ */
  const twinAmbiguity = (subset: readonly OpenInvoice[]): string | undefined => {
    const used = new Map<number, { n: number; preferred: number }>();
    for (const inv of subset) {
      const u = used.get(inv.outstandingMinor) ?? { n: 0, preferred: 0 };
      u.n++;
      if (preferred.has(inv.id)) u.preferred++;
      used.set(inv.outstandingMinor, u);
    }
    for (const [amount, u] of used) {
      const all = byOutstanding.get(amount);
      if (!all || u.n >= all.total) continue;
      /* المرجعُ عيّن المأخوذَ كلَّه ولم يبقَ مرجعٌ خارجه — فلا التباس */
      if (u.preferred === u.n && all.preferred === u.n) continue;
      return `${countNoun(all.total, INVOICE)} مفتوحة بالمبلغ نفسه (${formatRiyalsDisplay(amount)}) لا يفرّق بينها دليل — اقتُرحت الأقدم، فأقرّها أو اختر غيرها`;
    }
    return undefined;
  };

  const representatives: { inv: OpenInvoice; twins: number }[] = [];
  for (const list of classes.values()) {
    const ordered = [...list].sort((a, b) =>
      Number(preferred.has(b.id)) - Number(preferred.has(a.id))
      || a.invoiceDate.getTime() - b.invoiceDate.getTime()
      || a.id.localeCompare(b.id));
    representatives.push({ inv: ordered[0], twins: list.length });
  }

  /* ── فاتورة واحدة ── */
  for (const { inv, twins } of representatives) {
    let amount = amountScore(tx.amountMinor, inv.outstandingMinor);
    const date = dateScore(tx.valueDate, inv.invoiceDate);
    const reference = referenceScore(tx.references, inv.invoiceNumber);
    /* قسطٌ بنسبةٍ مألوفة من الإجماليّ — ولا يجاوز ما بقي عليها */
    const instalment =
      amount === 0 && tx.amountMinor < inv.outstandingMinor
        ? instalmentPercent(tx.amountMinor, inv.totalMinor)
        : null;
    if (instalment !== null) amount = INSTALMENT_AMOUNT_SCORE;
    if (amount === 0 && reference === 0) continue;

    const diff = tx.amountMinor - inv.outstandingMinor;
    /*
      الرسم ليس فائضاً.

      كان الخصمُ الزائد بقدر رسم التحويل يُسمَّى `OVERPAYMENT`، وهي حالةٌ
      تُرفَع إلى المراجعة عمداً لأنّها «تغيّر الرصيد». فيُراجَع يدوياً ما
      يعرفه النظام يقيناً: خمسة آلاف وعشرون على فاتورة بخمسة آلاف ليست
      فائضةً بعشرين — هي الفاتورة ورسمُ تحويلها.
    */
    const fee = splitBankFee(tx.amountMinor, inv.outstandingMinor);
    const outcome: Outcome =
      Math.abs(diff) <= EXACT_TOLERANCE_MINOR || fee !== null ? "EXACT_INVOICE"
      : diff < 0 ? "PARTIAL_PAYMENT"
      : "OVERPAYMENT";

    const parts = { supplier: tx.supplierScore, amount, date, reference };
    const evidence = [`المورّد مرجَّح بدرجة ${Math.round(tx.supplierScore * 100)}٪`];
    if (amount === 1) {
      evidence.push(
        fee ? `المبلغ يطابق المتبقّي مع رسم تحويل ${formatRiyalsDisplay(fee.feeMinor)}`
            : "المبلغ يطابق المتبقّي تماماً",
      );
    }
    else if (instalment !== null) {
      evidence.push(
        `قسطٌ: ${instalment}٪ من إجماليّ الفاتورة (${formatRiyalsDisplay(inv.totalMinor)}) تماماً — يبقى ${formatRiyalsDisplay(-diff)} ريالاً`,
      );
    }
    else if (outcome === "PARTIAL_PAYMENT") evidence.push(`سدادٌ جزئيّ — يبقى ${formatRiyalsDisplay(-diff)} ريالاً`);
    else if (outcome === "OVERPAYMENT") evidence.push(`يزيد ${formatRiyalsDisplay(diff)} ريالاً عن المتبقّي`);
    if (reference === 1) evidence.push("المرجع يطابق رقم الفاتورة");
    else if (reference > 0) evidence.push("المرجع يشبه رقم الفاتورة");
    evidence.push(`فرق التاريخ ${countNoun(daysBetween(tx.valueDate, inv.invoiceDate), DAY)}`);
    if (twins > 1) {
      evidence.push(
        preferred.has(inv.id)
          ? `${countNoun(twins, INVOICE)} بالمبلغ نفسه — أُخذت التي طابق مرجعُها`
          : `${countNoun(twins, INVOICE)} بالمبلغ نفسه — أُخذت الأقدم (الأقدم أوّلاً)`,
      );
    }

    out.push({
      invoiceIds: [inv.id],
      outcome,
      allocatedMinor: Math.min(tx.amountMinor, inv.outstandingMinor),
      parts,
      score: applyProfile(
        combine(parts, { reference: reference > 0 }),
        tx, [inv], evidence,
      ),
      evidence,
      ambiguity: twinAmbiguity([inv]),
    });
  }

  /* ── مجموعة فواتير ── */
  const tight = searchSubsets(mine, tx.amountMinor, {
    maxSize: MAX_GROUP_SIZE, txDate: tx.valueDate, prefer: preferred,
  });
  let groups = tight.subsets.filter((s) => s.length >= 2);
  let exhausted = tight.exhausted;

  /*
    ── مجموعةٌ ورسمُ تحويلها ──

    الفاتورةُ الواحدة تُقبَل مع رسمٍ حتّى ٧٥ ريالاً و٢٪، والمجموعةُ كان
    تسامحُها ريالاً: حوالةٌ تسدّد ثلاث فواتير وتزيد عشرين رسماً لا تجد
    مجموعتَها. فيُبحَث بحدّ الرسم **حين لا تفسيرَ أدقّ** — لا مجموعةَ في حدّ
    الريال ولا فاتورةَ بمبلغها — كي لا يزاحم الافتراضُ المطابقةَ التامّة.
  */
  if (groups.length === 0 && !out.some((c) => c.parts.amount === 1)) {
    const feeCap = Math.min(MAX_FEE_MINOR, Math.round(tx.amountMinor * MAX_FEE_RATIO));
    if (feeCap > GROUP_TOLERANCE_MINOR) {
      const loose = searchSubsets(mine, tx.amountMinor, {
        shortfallMinor: feeCap, maxSize: MAX_GROUP_SIZE, txDate: tx.valueDate, prefer: preferred,
      });
      exhausted = exhausted || loose.exhausted;
      groups = loose.subsets.filter((s) => {
        if (s.length < 2) return false;
        const sum = s.reduce((n, i) => n + i.outstandingMinor, 0);
        return splitBankFee(tx.amountMinor, sum) !== null;
      });
    }
  }

  for (const subset of groups) {
    const sum = subset.reduce((s, i) => s + i.outstandingMinor, 0);
    const amount = amountScore(tx.amountMinor, sum);
    const date = Math.max(...subset.map((i) => dateScore(tx.valueDate, i.invoiceDate)));
    const reference = Math.max(...subset.map((i) => referenceScore(tx.references, i.invoiceNumber)));
    const fee = splitBankFee(tx.amountMinor, sum);
    /*
      مجموعةٌ تنقص عنها الدفعةُ فوق هللة ليست «مجموعةً بمبلغها»: يُخصَّص
      بالأقدم أوّلاً فتبقى آخرُ فاتورةٍ مفتوحةً بهللاتٍ تظهر في «عليك». وهي
      في الفاتورة الواحدة `PARTIAL_PAYMENT` لا تُحسَم — فتُسمّى هنا بالاسم
      نفسه، والقاعدةُ واحدة.
    */
    const short = sum - tx.amountMinor;
    const outcome: Outcome = short > EXACT_TOLERANCE_MINOR ? "PARTIAL_PAYMENT" : "MULTI_INVOICE";

    const parts = { supplier: tx.supplierScore, amount, date, reference };
    const evidence = [
      `${countNoun(subset.length, INVOICE)} مجموعها ${formatRiyalsDisplay(sum)} ريالاً`,
      ...(fee ? [`المجموع يطابق الدفعة مع رسم تحويل ${formatRiyalsDisplay(fee.feeMinor)}`]
        : amount === 1 ? ["المجموع يطابق الدفعة تماماً"]
        : short > 0 ? [`الدفعة تنقص عن المجموع ${formatRiyalsDisplay(short)} ريالاً — تبقى على آخر فاتورة`]
        : [`الدفعة تزيد على المجموع ${formatRiyalsDisplay(-short)} ريالاً`]),
    ];

    out.push({
      invoiceIds: subset.map((i) => i.id),
      outcome,
      allocatedMinor: Math.min(tx.amountMinor, sum),
      parts,
      /*
        المجموعة تُخصَم قليلاً عن الفاتورة الواحدة بنفس الدرجة: احتمال
        أن تجتمع عدّة فواتير على مبلغٍ بالمصادفة أكبر من احتمال أن
        تطابقه واحدة.
      */
      score: applyProfile(
        combine(parts, { reference: reference > 0 }) * (1 - 0.02 * subset.length),
        tx, subset, evidence,
      ),
      evidence,
      ambiguity: twinAmbiguity(subset),
    });
  }

  return {
    candidates: out.sort((a, b) => b.score - a.score),
    subsetSearchExhausted: exhausted,
  };
}
