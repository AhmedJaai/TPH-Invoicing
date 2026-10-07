/**
 * وصلُ محرّك التسوية بمسار الاستيراد.
 *
 * كان المحرّك مكتبةً مختبَرةً لا تعمل: الاستيراد يمرّ على `match.ts`
 * القديم — الجشع، ومجموعاته الثلاث، وتصنيفه بالكلمات. وهذه الخدمة هي
 * الجسر: تأخذ صفوف الكشف، وتُخرج قراراً لكل حركة مع أدلّته.
 *
 * والمسار كما وصفه المراجع:
 *   معياريّ ← تصنيف ← تعريف المستفيد ← توليد المرشّحين ← تسوية شاملة
 *   ← قرار.
 */
import { toCanonical, matchableReferences, type RawBankRow } from "@/lib/bank/canonical";
import {
  CLASSIFICATION_VERSION, classify,
  type ClassificationSource, type MerchantMemory,
} from "@/lib/bank/classification";
import { resolveSupplier, type SupplierIdentity } from "@/lib/bank/entities";
import { searchCandidates, type Candidate, type OpenInvoice } from "@/lib/bank/candidates";
import { reconcile, type Claim } from "@/lib/bank/optimizer";
import { decide, type Decision } from "@/lib/bank/decision";
import { planAdjudication, type AdjudicationCase } from "@/lib/bank/adjudicate";
import type { CanonicalTransaction } from "@/lib/bank/canonical";
import { toCategory } from "@/lib/bank/apply";
import { splitBankFee } from "@/lib/bank/fees";
import type { SupplierProfile } from "@/lib/bank/supplier-profile";
import type { TxCategory } from "@/lib/bank/rules";
import type { Outcome, TxKind } from "@/lib/bank/taxonomy";

export interface ReconcileInput {
  rows: readonly (RawBankRow & { key: string })[];
  invoices: readonly OpenInvoice[];
  suppliers: readonly SupplierIdentity[];
  memory?: ReadonlyMap<string, MerchantMemory>;
  /**
   * كيف يُسدَّد كل مورّد عادةً — بمفتاح `supplierId`.
   *
   * ترجّح ولا تحسم، ولا تُبنى على سابقةٍ أو سابقتين. وغيابها يُعيد
   * الحساب إلى الأدلّة وحدها، وهو الأصل لا حالةُ عطل.
   */
  profiles?: ReadonlyMap<string, SupplierProfile>;
  /**
   * مصدر الصفوف — هل قُرئت حسابياً أم بصرياً؟
   *
   * وما قُرئ بصرياً لا يُطابَق تلقائياً مهما بلغت الدرجة: قراءةُ نموذجٍ
   * للأرقام تُخطئ، والمعادلة تكشف الخطأ الجسيم ولا تكشف تبادلَ وصفين
   * بين سطرين متساويَي المبلغ.
   */
  readSource?: "PARSED" | "VISION";
  /**
   * الحَكَم — اختياريّ.
   *
   * إن غاب مضى المسار حسابياً بحتاً، وهذا هو الأصل. وإن حضر لم يُستدعَ
   * إلّا لما عجز الحساب عنه، ولا يُطابِق حكمُه تلقائياً.
   */
  adjudicator?: {
    run(cases: readonly AdjudicationCase[], transactions: ReadonlyMap<string, CanonicalTransaction>):
      Promise<readonly { transactionId: string; candidate: Candidate | null; disposition: "SUGGEST" | "REVIEW"; reasons: string[] }[]>;
  };
}

export interface TransactionResult {
  key: string;
  kind: TxKind;
  category: TxCategory;
  /** لماذا صُنّفت هكذا. */
  classificationReason: string;
  /** ومن صنّفها — يُحفَظ كي يُقاس ويُصحَّح. */
  classificationSource: ClassificationSource;
  classificationRuleId: string | null;
  classificationVersion: string;
  supplierId: string | null;
  supplierScore: number;
  /** أدلّة تعريف المستفيد، بنصّها. */
  supplierEvidence: string[];
  /** القرار، إن وُجد مرشّح. */
  decision: Decision | null;
  candidate: Candidate | null;
  outcome: Outcome;
  runnerUpScore: number | null;
}

/** ما يُكتَب فعلاً حين يوافق المستخدم — من المحرّك وحده. */
export interface PlannedPayment {
  transactionKey: string;
  supplierId: string;
  amountMinor: number;
  paidAt: Date;
  /**
   * التخصيصات لكل فاتورة على حدة.
   *
   * وليست «كامل المتبقّي» دائماً: السداد الجزئي يُخصَّص بقدره،
   * والزيادة لا تُخصَّص فوق قيمة الفاتورة.
   */
  allocations: { invoiceId: string; amountMinor: number }[];
  /**
   * الشهور التي تخصّها هذه الدفعة.
   *
   * كان يُحفَظ شهر أوّل فاتورة وحده، فدفعةٌ تسدّد أغسطس وسبتمبر
   * وأكتوبر تُنسب إلى أغسطس كلّها. والشهر الحاكم هو الأحدث — لأنّ
   * الدفعة تُغلق ما بلغته — والباقي يُحفَظ معه.
   */
  months: string[];
  primaryMonth: string;
  /**
   * رسمُ التحويل داخل مبلغ الدفعة.
   *
   * كان `splitBankFee` يحسبه ثمّ لا يصل إلى المال: تُقسَّم الدفعة كاملةً
   * بما فيها الرسم، فيُنسَب إلى المورّد ما ذهب إلى البنك. وحسابٌ صحيح لا
   * يصل إلى المال أسوأ من عدمه — يوهم أنّ الحالة معالَجة.
   */
  feeMinor: number;
  feeReason: string | null;
}

export interface ReconcileResult {
  results: TransactionResult[];
  /** حالاتٌ يستحقّ التباسُها حَكَماً — ولم يُستدعَ بعد. */
  adjudicationCases: AdjudicationCase[];
  /** خطّة الكتابة — لا تُنفَّذ إلّا بموافقة، ومصدرها المحرّك وحده. */
  planned: PlannedPayment[];
  /**
   * كلُّ ما رُشّح لكلّ حركة، مرتّباً بالدرجة — بمفتاح الحركة.
   *
   * لمن يُقرّ بيده: الاقتراحُ الذي لا يبلغ الحسمَ يُعرَض بمرشّحيه ليُختار
   * بينهم، والخادمُ يتحقّق أنّ المختار من هذه القائمة لحظةَ الكتابة
   * (`planFor`). ولا يُكتَب منها شيءٌ بلا إقرار.
   */
  candidatesByKey: ReadonlyMap<string, readonly Candidate[]>;
  summary: {
    /** هل بلغ المحسِّن الحلّ الأمثل يقيناً؟ */
    exact: boolean;
    total: number;
    understood: number;
    auto: number;
    suggest: number;
    review: number;
    notPayment: number;
  };
}

/**
 * ما يُحتمل أن يكون سداد مورّد.
 *
 * ما عداه لا يدخل التسوية أصلاً — تسوية شبكة ولا راتبٌ ولا إيجار
 * يُطابَق بفاتورة. والمجهول يدخل لأنّه قد يكون سداداً لم يُعرَف بابه.
 */
const PAYMENT_KINDS: readonly TxKind[] = ["SUPPLIER_PAYMENT", "UNKNOWN"];

/**
 * يُدخِل حكم الحَكَم على النتيجة.
 *
 * ولا يرفع حالةً إلى «مطابَقة»: أقصى ما يبلغه حكمُه «اقتراح». فالنموذج
 * يرجّح بين مرشّحين حُسبوا، والإنسان يُقرّ.
 */
export function applyAdjudication(
  result: ReconcileResult,
  verdicts: readonly {
    transactionId: string;
    candidate: Candidate | null;
    disposition: "SUGGEST" | "REVIEW";
    reasons: string[];
  }[],
): ReconcileResult {
  if (verdicts.length === 0) return result;

  const byKey = new Map(verdicts.map((v) => [v.transactionId, v]));

  const results = result.results.map((r) => {
    const v = byKey.get(r.key);
    if (!v) return r;

    return {
      ...r,
      candidate: v.candidate ?? r.candidate,
      outcome: v.candidate?.outcome ?? r.outcome,
      decision: {
        disposition: v.disposition,
        reasons: [...(r.decision?.reasons ?? []), ...v.reasons],
      },
    };
  });

  const suggest = results.filter((r) => r.decision?.disposition === "SUGGEST").length;
  const review = results.filter((r) => r.decision?.disposition === "REVIEW").length;

  return {
    ...result,
    results,
    // الخطّة لا تتغيّر: حكم الحَكَم لا يُكتَب مالاً
    summary: { ...result.summary, suggest, review },
  };
}

export function runReconciliation(input: ReconcileInput): ReconcileResult {
  const {
    rows, invoices, suppliers,
    memory = new Map(), profiles = new Map(), readSource = "PARSED",
  } = input;

  const prepared = rows.map((row) => {
    const canonical = toCanonical(row);
    const classification = classify(canonical, memory);
    return { key: row.key, canonical, classification };
  });

  const preparedByKey = new Map(prepared.map((p) => [p.key, p]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const invoicesBySupplier = new Map<string, OpenInvoice[]>();
  for (const i of invoices) {
    const list = invoicesBySupplier.get(i.supplierId) ?? [];
    list.push(i);
    invoicesBySupplier.set(i.supplierId, list);
  }
  /** حركاتٌ نفدت ميزانيّةُ بحث مجموعاتها — قائمةُ مرشّحيها قد تنقص. */
  const incompleteSearch = new Set<string>();

  const claims: Claim[] = [];
  const perKey = new Map<string, { supplierId: string | null; score: number; evidence: string[] }>();
  const candidatesByKey = new Map<string, Candidate[]>();

  for (const p of prepared) {
    /*
      المال الداخل ليس سداداً — وكشفته مصفوفة التسوية.

      كان الاتّجاه لا يُفحَص أصلاً: حركةٌ **واردة** بابُها مجهول تمرّ
      إلى تعريف المستفيد ثمّ إلى توليد المرشّحين، فإن وافق مبلغُها
      فاتورةً مفتوحة حُسمت تلقائياً — فيُنشَأ سدادٌ لمورّدٍ من مالٍ
      **دخل** الحساب، وتُقفَل فاتورةٌ لم تُدفَع.

      وأثرُه مضاعف: إيرادٌ يُقرأ مصروفاً، ومستحقٌّ يختفي.

      والوارد قد يكون ردّ مبلغ — وذلك بابُ `reversal.ts` لا بابُ
      المطابقة: ما خرج ثمّ عاد لا يُطابَق بفاتورة.
    */
    if (p.canonical.direction !== "DEBIT") {
      perKey.set(p.key, { supplierId: null, score: 0, evidence: [] });
      continue;
    }

    if (!PAYMENT_KINDS.includes(p.classification.kind)) {
      perKey.set(p.key, { supplierId: null, score: 0, evidence: [] });
      continue;
    }

    const resolution = resolveSupplier(p.canonical, suppliers);
    perKey.set(p.key, {
      supplierId: resolution?.supplierId ?? null,
      score: resolution?.score ?? 0,
      evidence: resolution?.evidence.map((e) => e.detail) ?? [],
    });
    if (!resolution) continue;

    const search = searchCandidates(
      {
        transactionId: p.key,
        valueDate: p.canonical.valueDate,
        amountMinor: p.canonical.amountMinor,
        supplierId: resolution.supplierId,
        supplierScore: resolution.score,
        references: matchableReferences(p.canonical.references).map((r) => r.value),
        profile: profiles.get(resolution.supplierId),
      },
      /* فواتيرُ مورّدها وحده — لا مسحٌ لكلّ الفواتير لكلّ حركة */
      invoicesBySupplier.get(resolution.supplierId) ?? [],
    );
    if (search.subsetSearchExhausted) incompleteSearch.add(p.key);
    for (const candidate of search.candidates) {
      claims.push({ transactionId: p.key, candidate });
    }
    if (search.candidates.length > 0) candidatesByKey.set(p.key, search.candidates);
  }

  const { assigned, exact, inexactTransactionIds } = reconcile(claims);
  const decided = new Map(assigned.map((a) => [a.transactionId, { a, d: decide(a) }]));
  const inexact = new Set(inexactTransactionIds);

  /*
    الحلّ التقريبيّ لا يُطابَق تلقائياً.

    حين تنفد ميزانيّة البحث يرجع المحسِّن إلى الجشع ويُعلن `exact:false`.
    ومطابقةٌ بُنيت على حلٍّ لم يُثبت أنّه الأفضل ليست «مطابقة» بل
    اقتراح — وقولُ «تمّت المطابقة» عنها ادّعاء.
  */
  /*
    والقراءة البصرية كذلك: كلاهما «حسابٌ صحيح على مدخلٍ غير مثبت».
  */
  /*
    وتُنزَّل حركاتُ المكوّنة التي لم يُثبَت حلُّها وحدها — لا الكشفُ كلُّه:
    مورّدٌ واحد صعب لا يُعاقَب به ثلاثمئة حركةٍ حلُّها يقين.
    وكذلك من نفدت ميزانيّةُ بحث مجموعاته: قائمةُ مرشّحيه قد تنقص.
  */
  const demotionFor = (key: string): string | null =>
    inexact.has(key)
      ? "الحلّ تقريبيّ: نفدت ميزانيّة البحث فلم يُثبَت أنّه الأفضل — فيُقترَح ولا يُطابَق"
      : incompleteSearch.has(key)
        ? "بحثُ مجموعات الفواتير لم يكتمل: قد يوجد مرشّحٌ لم يُفحَص — فيُقترَح ولا يُطابَق"
        : readSource === "VISION"
          ? "الكشف قُرئ بصرياً من صورة — فلا يُطابَق تلقائياً مهما بلغت الدرجة"
          : null;

  for (const [key, entry] of decided) {
    if (entry.d.disposition !== "AUTO") continue;
    const demotion = demotionFor(key);
    if (demotion === null) continue;
    decided.set(key, {
      a: entry.a,
      d: { disposition: "SUGGEST", reasons: [...entry.d.reasons, demotion] },
    });
  }

  const results: TransactionResult[] = prepared.map((p) => {
    const found = decided.get(p.key);
    const supplier = perKey.get(p.key)!;
    const isPayment = PAYMENT_KINDS.includes(p.classification.kind);

    /*
      كل حركةٍ يُحتمَل أنّها سداد تحمل حالةَ قرار.

      كانت التي بلا مرشّح تُترَك بلا حالة — لا `AUTO` ولا `SUGGEST` ولا
      `REVIEW` — فتقول الخلاصة «٨٥ تحتاج مراجعة» ولا يجدها الطابور،
      لأنّه يبحث عن حالة. فيقف صاحب العمل أمام رقمٍ لا يقابله شيء.

      وما ليس سداداً أصلاً يبقى بلا حالة بحقّ: لا قرار فيه.
    */
    const fallback: Decision | null = isPayment
      ? {
          disposition: "REVIEW",
          reasons: [
            supplier.supplierId === null
              ? "لم يُعرَف المستفيد — عرِّفه مرّةً فيُعرَف ما يشبهه"
              : "المورّد معروف ولا فاتورة مفتوحة تطابق هذه الدفعة",
          ],
        }
      : null;

    return {
      key: p.key,
      kind: p.classification.kind,
      category: toCategory(p.classification.kind),
      classificationReason: p.classification.reason,
      classificationSource: p.classification.source,
      classificationRuleId: p.classification.ruleId,
      classificationVersion: CLASSIFICATION_VERSION,
      supplierId: supplier.supplierId,
      supplierScore: supplier.score,
      supplierEvidence: supplier.evidence,
      decision: found?.d ?? fallback,
      candidate: found?.a.candidate ?? null,
      runnerUpScore: found?.a.runnerUpScore ?? null,
      outcome: found?.a.candidate.outcome ?? outcomeWithout(isPayment, supplier.supplierId),
    };
  });

  /*
    خطّة الكتابة.

    كان المحرّك القديم هو من ينشئ الدفعات، والجديد يكتب «أدلّةً» فوقها —
    فيمكن أن تقول الشاشة اقتراحاً ويكتب الخادم غيره. مصدرُ قرارٍ واحد
    أو لا شيء.

    والاقتراح لا يُكتَب: التلقائيّ وحده. أمّا `SUGGEST` فينتظر تأكيداً،
    وهذا هو معنى أن يكون اقتراحاً.
  */
  const planned: PlannedPayment[] = [];
  for (const r of results) {
    if (r.decision?.disposition !== "AUTO" || !r.candidate || !r.supplierId) continue;
    const p = preparedByKey.get(r.key);
    if (!p) continue;
    const plan = planFor(
      { key: r.key, supplierId: r.supplierId, amountMinor: p.canonical.amountMinor, paidAt: p.canonical.valueDate },
      r.candidate, invoiceById,
    );
    if (plan) planned.push(plan);
  }

  const summary = {
    exact,
    total: results.length,
    understood: results.filter((r) => r.kind !== "UNKNOWN").length,
    auto: results.filter((r) => r.decision?.disposition === "AUTO").length,
    suggest: results.filter((r) => r.decision?.disposition === "SUGGEST").length,
    review: results.filter((r) => r.decision?.disposition === "REVIEW").length,
    notPayment: results.filter((r) => !PAYMENT_KINDS.includes(r.kind)).length,
  };

  /*
    ما يستحقّ حَكَماً.

    ويُحسَب دائماً وإن لم يُستدعَ أحد: فمعرفةُ كم التبس أهمّ من حلّه —
    دفعةٌ فيها مئتا التباس ليست حالةً تُحكَّم بل بياناتٌ ناقصة.
  */
  const adjudicationCases = planAdjudication(
    results.map((r) => ({
      transactionId: r.key,
      amountMinor: preparedByKey.get(r.key)?.canonical.amountMinor ?? 0,
      supplierId: r.supplierId,
      candidates: candidatesByKey.get(r.key) ?? [],
      decision: r.decision,
    })),
  ).cases;

  return { results, planned, candidatesByKey, adjudicationCases, summary };
}

/**
 * خطّةُ الكتابة لمرشّحٍ بعينه — مصدرُها المحرّك وحده.
 *
 * تُستعمل للتلقائيّ (`planned`) ولما يُقرّه إنسانٌ من اقتراح: المرشّحُ من
 * قائمةٍ حسبها الخادم، والتخصيصُ يحسبه الخادم — والمتصفّح لا يُرسل إلّا
 * معرّفات.
 *
 * و`fullAmount` لإقرار الإنسان: المقيَّدُ هو ما خرج من الحساب كلُّه، وما
 * زاد على الفواتير يبقى «غير مخصَّص» (حالٌ صحيحة) — لا دفعةٌ تنقص عن
 * حركتها.
 */
export function planFor(
  tx: { key: string; supplierId: string; amountMinor: number; paidAt: Date },
  candidate: Candidate,
  invoiceById: ReadonlyMap<string, OpenInvoice>,
  options: { fullAmount?: boolean } = {},
): PlannedPayment | null {
  const chosen = candidate.invoiceIds
    .map((id) => invoiceById.get(id))
    .filter((i): i is OpenInvoice => i !== undefined);
  /* فاتورةٌ من المرشّح لم تعد مفتوحة — فالمرشّحُ لم يعد صالحاً كلُّه */
  if (chosen.length === 0 || chosen.length !== candidate.invoiceIds.length) return null;
  if (chosen.some((i) => i.supplierId !== tx.supplierId)) return null;

  /*
    يُوزَّع المبلغ على الفواتير بترتيب تاريخها — الأقدم أوّلاً — ولا
    يتجاوز مجموعُ التخصيصات قيمةَ الدفعة ولا قيمةَ أيّ فاتورة.
  */
  let left = candidate.allocatedMinor;
  const allocations: PlannedPayment["allocations"] = [];
  for (const inv of [...chosen].sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime())) {
    if (left <= 0) break;
    const take = Math.min(left, inv.outstandingMinor);
    if (take <= 0) continue;
    allocations.push({ invoiceId: inv.id, amountMinor: take });
    left -= take;
  }
  if (allocations.length === 0) return null;

  const months = [...new Set(chosen.map((i) => i.periodMonth))].sort();

  /*
    الرسم يُفصَل قبل الكتابة.

    الشرط أن يزيد المدفوع على مجموع الفواتير بقدرٍ في حدّ رسم التحويل.
    وما جاوز الحدّ ليس رسماً بل فرقاً يُحقَّق فيه — فلا يُفترَض،
    لأنّ التسامح الذي يبتلع كل فرق يُخفي أخطاءً بدل أن يُصلحها.
  */
  const invoiceSum = allocations.reduce((sum, a) => sum + a.amountMinor, 0);
  const fee = splitBankFee(tx.amountMinor, invoiceSum);

  return {
    transactionKey: tx.key,
    supplierId: tx.supplierId,
    /*
      المبلغ المسجَّل هو ما خرج من الحساب فعلاً — بما فيه الرسم.
      والرسم يُعلَن في حقله، فيخرج من القسمة ولا يُخصَّص على مورّد.
      وكتابةُ المبلغ ناقصاً الرسم تجعل الدفعة لا تساوي الحركة، فتختلّ
      معادلة الكشف بمقدار الرسوم كلِّها.
    */
    amountMinor: fee || options.fullAmount ? tx.amountMinor : candidate.allocatedMinor,
    paidAt: tx.paidAt,
    allocations,
    months,
    primaryMonth: months[months.length - 1],
    feeMinor: fee?.feeMinor ?? 0,
    feeReason: fee?.reason ?? null,
  };
}

/**
 * تسمية الحال حين لا يوجد مرشّح.
 *
 * والفرق محفوظ: «عرفتُ المورّد ولم أجد فاتورة» ليست «لم أعرف
 * المستفيد» — وكلٌّ يحتاج فعلاً مختلفاً.
 */
function outcomeWithout(isPayment: boolean, supplierId: string | null): Outcome {
  if (!isPayment) return "NOT_A_PAYMENT";
  return supplierId === null ? "UNKNOWN_ENTITY" : "KNOWN_SUPPLIER_NO_INVOICE";
}

/** مفتاحُ المرشّح: فواتيرُه مرتّبةً — به يُقابَل اختيارُ المتصفّح بما حسبه الخادم. */
export function candidateKey(invoiceIds: readonly string[]): string {
  return [...invoiceIds].sort().join("+");
}

/**
 * المرشّحُ الذي يُقَرّ لهذه الحركة.
 *
 * بلا اختيار: ما رسا عليه المحرّك. وباختيار: المرشّحُ الذي فواتيرُه هي
 * المختارةُ **بعينها** من قائمة الخادم — وما ليس فيها لا يُكتَب، مهما
 * أرسل المتصفّح.
 */
export function pickCandidate(
  engine: ReconcileResult,
  transactionId: string,
  chosenInvoiceIds?: readonly string[],
): Candidate | null {
  const settled = engine.results.find((r) => r.key === transactionId)?.candidate ?? null;
  if (!chosenInvoiceIds || chosenInvoiceIds.length === 0) return settled;
  const wanted = candidateKey(chosenInvoiceIds);
  return (engine.candidatesByKey.get(transactionId) ?? [])
    .find((c) => candidateKey(c.invoiceIds) === wanted) ?? null;
}
