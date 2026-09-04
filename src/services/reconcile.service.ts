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
import { classify, type MerchantMemory } from "@/lib/bank/classification";
import { resolveSupplier, type SupplierIdentity } from "@/lib/bank/entities";
import { generateCandidates, type Candidate, type OpenInvoice } from "@/lib/bank/candidates";
import { reconcile, type Claim } from "@/lib/bank/optimizer";
import { decide, type Decision } from "@/lib/bank/decision";
import { toCategory } from "@/lib/bank/apply";
import type { TxCategory } from "@/lib/bank/rules";
import type { Outcome, TxKind } from "@/lib/bank/taxonomy";

export interface ReconcileInput {
  rows: readonly (RawBankRow & { key: string })[];
  invoices: readonly OpenInvoice[];
  suppliers: readonly SupplierIdentity[];
  memory?: ReadonlyMap<string, MerchantMemory>;
}

export interface TransactionResult {
  key: string;
  kind: TxKind;
  category: TxCategory;
  /** لماذا صُنّفت هكذا. */
  classificationReason: string;
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
}

export interface ReconcileResult {
  results: TransactionResult[];
  /** خطّة الكتابة — لا تُنفَّذ إلّا بموافقة، ومصدرها المحرّك وحده. */
  planned: PlannedPayment[];
  summary: {
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

export function runReconciliation(input: ReconcileInput): ReconcileResult {
  const { rows, invoices, suppliers, memory = new Map() } = input;

  const prepared = rows.map((row) => {
    const canonical = toCanonical(row);
    const classification = classify(canonical, memory);
    return { key: row.key, canonical, classification };
  });

  const claims: Claim[] = [];
  const perKey = new Map<string, { supplierId: string | null; score: number; evidence: string[] }>();

  for (const p of prepared) {
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

    for (const candidate of generateCandidates(
      {
        transactionId: p.key,
        valueDate: p.canonical.valueDate,
        amountMinor: p.canonical.amountMinor,
        supplierId: resolution.supplierId,
        supplierScore: resolution.score,
        references: matchableReferences(p.canonical.references).map((r) => r.value),
      },
      invoices,
    )) {
      claims.push({ transactionId: p.key, candidate });
    }
  }

  const { assigned } = reconcile(claims);
  const decided = new Map(assigned.map((a) => [a.transactionId, { a, d: decide(a) }]));

  const results: TransactionResult[] = prepared.map((p) => {
    const found = decided.get(p.key);
    const supplier = perKey.get(p.key)!;
    const isPayment = PAYMENT_KINDS.includes(p.classification.kind);

    return {
      key: p.key,
      kind: p.classification.kind,
      category: toCategory(p.classification.kind),
      classificationReason: p.classification.reason,
      supplierId: supplier.supplierId,
      supplierScore: supplier.score,
      supplierEvidence: supplier.evidence,
      decision: found?.d ?? null,
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

    const chosen = invoices.filter((i) => r.candidate!.invoiceIds.includes(i.id));
    if (chosen.length === 0) continue;

    /*
      يُوزَّع المبلغ على الفواتير بترتيب تاريخها — الأقدم أوّلاً — ولا
      يتجاوز مجموعُ التخصيصات قيمةَ الدفعة ولا قيمةَ أيّ فاتورة.
    */
    let left = r.candidate.allocatedMinor;
    const allocations: PlannedPayment["allocations"] = [];
    for (const inv of [...chosen].sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime())) {
      if (left <= 0) break;
      const take = Math.min(left, inv.outstandingMinor);
      if (take <= 0) continue;
      allocations.push({ invoiceId: inv.id, amountMinor: take });
      left -= take;
    }
    if (allocations.length === 0) continue;

    const months = [...new Set(chosen.map((i) => i.periodMonth))].sort();

    planned.push({
      transactionKey: r.key,
      supplierId: r.supplierId,
      amountMinor: r.candidate.allocatedMinor,
      paidAt: prepared.find((p) => p.key === r.key)!.canonical.valueDate,
      allocations,
      months,
      primaryMonth: months[months.length - 1],
    });
  }

  const summary = {
    total: results.length,
    understood: results.filter((r) => r.kind !== "UNKNOWN").length,
    auto: results.filter((r) => r.decision?.disposition === "AUTO").length,
    suggest: results.filter((r) => r.decision?.disposition === "SUGGEST").length,
    review: results.filter(
      (r) => r.decision?.disposition === "REVIEW" ||
        (r.decision === null && PAYMENT_KINDS.includes(r.kind)),
    ).length,
    notPayment: results.filter((r) => !PAYMENT_KINDS.includes(r.kind)).length,
  };

  return { results, planned, summary };
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
