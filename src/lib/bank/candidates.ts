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

const WEIGHTS: ScoreParts = { supplier: 0.35, amount: 0.4, date: 0.1, reference: 0.15 };

export function combine(parts: ScoreParts): number {
  return (
    parts.supplier * WEIGHTS.supplier +
    parts.amount * WEIGHTS.amount +
    parts.date * WEIGHTS.date +
    parts.reference * WEIGHTS.reference
  );
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/** درجة قرب التاريخ: تامّة في اليوم نفسه، وتتناقص حتى حدّ النافذة. */
export function dateScore(txDate: Date, invoiceDate: Date): number {
  const d = daysBetween(txDate, invoiceDate);
  if (d > DATE_WINDOW_DAYS) return 0;
  return 1 - d / DATE_WINDOW_DAYS;
}

/** درجة قرب المبلغ: تامّة عند التطابق، وتنهار سريعاً بالبعد. */
export function amountScore(paidMinor: number, dueMinor: number): number {
  if (dueMinor <= 0) return 0;
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
 * والقيود ثلاثة — حجم المجموعة، وحجم المجموعة المرشَّحة، وأن يُقطَع
 * الفرع متى تجاوز مجموعُه المبلغَ — وبها يبقى العدّ محتملاً.
 *
 * وتُرتَّب الفواتير تنازلياً كي يُقطَع الفرع مبكراً.
 */
export function findSubsets(
  invoices: readonly OpenInvoice[],
  targetMinor: number,
  toleranceMinor: number = GROUP_TOLERANCE_MINOR,
  maxSize: number = MAX_GROUP_SIZE,
): OpenInvoice[][] {
  const pool = [...invoices]
    .filter((i) => i.outstandingMinor > 0)
    .sort((a, b) => b.outstandingMinor - a.outstandingMinor)
    .slice(0, MAX_POOL);

  const found: OpenInvoice[][] = [];
  const current: OpenInvoice[] = [];

  const walk = (start: number, sum: number) => {
    if (found.length >= 20) return;

    if (Math.abs(sum - targetMinor) <= toleranceMinor && current.length > 0) {
      found.push([...current]);
      return;
    }
    if (current.length >= maxSize) return;
    if (sum > targetMinor + toleranceMinor) return;

    for (let i = start; i < pool.length; i++) {
      current.push(pool[i]);
      walk(i + 1, sum + pool[i].outstandingMinor);
      current.pop();
      if (found.length >= 20) return;
    }
  };

  walk(0, 0);
  return found;
}

/* ─────────────────── التوليد ─────────────────── */

/**
 * كل ما يُحتمل أن تكون هذه الحركة سداداً له.
 *
 * لا يُختار هنا شيء ولا يُستبعَد الضعيف — الاختيار لاحق، وإخفاءُ
 * المرشّح الثاني هو ما يجعل المطابقة تبدو أكيدة وهي ليست كذلك.
 */
export function generateCandidates(
  tx: MatchInput,
  invoices: readonly OpenInvoice[],
): Candidate[] {
  if (tx.supplierId === null) return [];

  const mine = invoices.filter((i) => i.supplierId === tx.supplierId && i.outstandingMinor > 0);
  if (mine.length === 0) return [];

  const out: Candidate[] = [];

  /* ── فاتورة واحدة ── */
  for (const inv of mine) {
    const amount = amountScore(tx.amountMinor, inv.outstandingMinor);
    const date = dateScore(tx.valueDate, inv.invoiceDate);
    const reference = referenceScore(tx.references, inv.invoiceNumber);
    if (amount === 0 && reference === 0) continue;

    const diff = tx.amountMinor - inv.outstandingMinor;
    const outcome: Outcome =
      Math.abs(diff) <= EXACT_TOLERANCE_MINOR ? "EXACT_INVOICE"
      : diff < 0 ? "PARTIAL_PAYMENT"
      : "OVERPAYMENT";

    const parts = { supplier: tx.supplierScore, amount, date, reference };
    const evidence = [`المورّد مرجَّح بدرجة ${Math.round(tx.supplierScore * 100)}٪`];
    if (amount === 1) evidence.push("المبلغ يطابق المتبقّي تماماً");
    else if (outcome === "PARTIAL_PAYMENT") evidence.push(`سدادٌ جزئيّ — يبقى ${(-diff) / 100} ريالاً`);
    else if (outcome === "OVERPAYMENT") evidence.push(`يزيد ${diff / 100} ريالاً عن المتبقّي`);
    if (reference === 1) evidence.push("المرجع يطابق رقم الفاتورة");
    else if (reference > 0) evidence.push("المرجع يشبه رقم الفاتورة");
    evidence.push(`فرق التاريخ ${Math.round(daysBetween(tx.valueDate, inv.invoiceDate))} يوماً`);

    out.push({
      invoiceIds: [inv.id],
      outcome,
      allocatedMinor: Math.min(tx.amountMinor, inv.outstandingMinor),
      parts,
      score: combine(parts),
      evidence,
    });
  }

  /* ── مجموعة فواتير ── */
  for (const subset of findSubsets(mine, tx.amountMinor)) {
    if (subset.length < 2) continue;

    const sum = subset.reduce((s, i) => s + i.outstandingMinor, 0);
    const amount = amountScore(tx.amountMinor, sum);
    const date = Math.max(...subset.map((i) => dateScore(tx.valueDate, i.invoiceDate)));
    const reference = Math.max(...subset.map((i) => referenceScore(tx.references, i.invoiceNumber)));

    const parts = { supplier: tx.supplierScore, amount, date, reference };
    out.push({
      invoiceIds: subset.map((i) => i.id),
      outcome: "MULTI_INVOICE",
      allocatedMinor: Math.min(tx.amountMinor, sum),
      parts,
      /*
        المجموعة تُخصَم قليلاً عن الفاتورة الواحدة بنفس الدرجة: احتمال
        أن تجتمع عدّة فواتير على مبلغٍ بالمصادفة أكبر من احتمال أن
        تطابقه واحدة.
      */
      score: combine(parts) * (1 - 0.02 * subset.length),
      evidence: [
        `${subset.length} فواتير مجموعها ${sum / 100} ريالاً`,
        ...(amount === 1 ? ["المجموع يطابق الدفعة تماماً"] : [`فرق المجموع ${Math.abs(tx.amountMinor - sum) / 100} ريالاً`]),
      ],
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
