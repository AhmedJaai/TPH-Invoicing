/**
 * تحليلُ حساب المورّد بالذكاء — جمعُ الوقائع، والنداء، والحفظ، والقرار.
 *
 * النواة الخالصة في `src/lib/ai/supplier-analysis.ts`. وهنا ما يلمس
 * القاعدة والمزوّد. والمبادئ نفسها:
 *
 *   - النموذج يقترح والإنسان يُقرّ؛ لا فعلَ ماليّاً بلا إقرار.
 *   - الفعلُ عند الإقرار يمرّ بالخدمات نفسها التي يمرّ بها العمل اليدويّ
 *     (`markPaidByOwner`، `applySupplierCredit`) — فيحرسه مؤثِّر القاعدة.
 *   - كلّ تحليلٍ وكلّ قرارٍ في سجلّ التدقيق.
 */
import { reversePayment } from "@/services/payment.service";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiFindings, suppliers, supplierAliases } from "@/db/schema";
import { createId } from "@/lib/id";
import { recordAudit } from "@/lib/audit";
import { callDeepseek, parseJsonLoose } from "@/lib/ai/deepseek";
import { isDeepseekConfigured, modelFor } from "@/lib/ai/models";
import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisMessages,
  computeSignals,
  validateAnalysis,
  type FindingAction,
  type FindingRef,
  type PriorDecision,
  type Signals,
  type SupplierFacts,
  type ValidFinding,
} from "@/lib/ai/supplier-analysis";
import { humanizeRefs } from "@/lib/ai/finding-labels";
import {
  applySupplierCredit,
  CreditError,
  markPaidByOwner,
  previewOwnerPaid,
  type OwnerPaidPlan,
} from "./supplier-credit.service";

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/* ───────────────────────── الوقائع ───────────────────────── */

export async function gatherSupplierFacts(supplierId: string): Promise<SupplierFacts | null> {
  const [s] = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);
  if (!s) return null;

  const aliases = (
    await db.select({ value: supplierAliases.value }).from(supplierAliases)
      .where(eq(supplierAliases.supplierId, supplierId))
  ).map((a) => a.value);

  const invRows = (
    await db.execute<{
      id: string; invoice_number: string; invoice_date: Date | string; total_minor: number;
      allocated: string | number; outside: string | number;
    }>(sql`
      select i.id, i.invoice_number, i.invoice_date, i.total_minor,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0) as allocated,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa
                         join payments p on p.id = pa.payment_id
                        where pa.invoice_id = i.id and p.method in ('OWNER_ACCOUNT', 'CASH')), 0) as outside
        from invoices i where i.supplier_id = ${supplierId}
       order by i.invoice_date, i.id
    `)
  ).rows;

  const payRows = (
    await db.execute<{
      id: string; paid_at: Date | string; amount_minor: number; fee_minor: number; method: string;
      status: string; allocated: string | number; bank: string | null; reversal_reason: string | null; has_bank: boolean; has_doc: boolean;
    }>(sql`
      select p.id, p.paid_at, p.amount_minor, p.fee_minor, p.method::text as method, p.status::text as status,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.payment_id = p.id), 0) as allocated,
             (select t.description from bank_transactions t where t.matched_payment_id = p.id limit 1) as bank,
             p.reversal_reason,
             exists (select 1 from bank_transactions t2 where t2.matched_payment_id = p.id) as has_bank,
             (p.document_id is not null) as has_doc
        from payments p where p.supplier_id = ${supplierId}
       order by p.paid_at, p.id
    `)
  ).rows;

  const stRows = (
    await db.execute<{
      id: string; period_start: Date | string | null; period_end: Date | string;
      opening_balance_minor: number | null; closing_balance_minor: number | null; lines: number;
    }>(sql`
      select s.id, s.period_start, s.period_end, s.opening_balance_minor, s.closing_balance_minor,
             (select count(*)::int from statement_lines l where l.statement_id = s.id) as lines
        from statements s where s.supplier_id = ${supplierId}
       order by s.period_end
    `)
  ).rows;

  /*
    حوالاتٌ لم تُربط ويبدو أنّها له: بمورّده إن عُرف، أو باسمه واسمائه
    البديلة في الوصف. والأسماء القصيرة لا تُبحث — «سرد» تقع في كلّ مكان.
  */
  const patterns = [...new Set(
    [s.nameAr, s.nameEn, ...aliases]
      .filter((x): x is string => Boolean(x && x.trim().length >= 4))
      .map((x) => `%${x.trim().replace(/[%_]/g, "")}%`),
  )].slice(0, 12);

  /*
    كلُّ نمطٍ شرطٌ مستقلّ: مصفوفةُ JS تُمرَّر إلى القالب صفّاً لا `text[]`
    فيرفضها Postgres بـ«cannot cast type record to text[]».
  */
  const byName = patterns.length > 0
    ? sql` or ${sql.join(
        patterns.map((p) => sql`t.description ilike ${p} or t.beneficiary_raw ilike ${p}`),
        sql` or `,
      )}`
    : sql``;

  const trRows = (
    await db.execute<{ id: string; value_date: Date | string; amount_minor: number; category: string; description: string | null }>(sql`
      select t.id, t.value_date, t.amount_minor, t.category::text as category, t.description
        from bank_transactions t
       where t.direction = 'DEBIT' and t.matched_payment_id is null
         and (t.supplier_id = ${supplierId}${byName})
       order by t.value_date desc limit 20
    `)
  ).rows;

  const [last] = (
    await db.execute<{ d: Date | string | null }>(sql`select max(value_date) as d from bank_transactions`)
  ).rows;

  const prior = await db
    .select({
      kind: aiFindings.kind, title: aiFindings.title, status: aiFindings.status,
      note: aiFindings.decisionNote, decidedAt: aiFindings.decidedAt,
    })
    .from(aiFindings)
    .where(and(eq(aiFindings.supplierId, supplierId), inArray(aiFindings.status, ["ACCEPTED", "DISMISSED"])))
    .orderBy(desc(aiFindings.decidedAt))
    .limit(20);

  return {
    supplierId,
    supplierName: s.nameAr,
    aliases,
    today: new Date().toISOString().slice(0, 10),
    lastBankDate: iso(last?.d ?? null),
    invoices: invRows.map((r, k) => ({
      ref: `F${k + 1}`, id: r.id, number: r.invoice_number, date: iso(r.invoice_date)!,
      totalMinor: Number(r.total_minor), allocatedMinor: Number(r.allocated), outsideBankMinor: Number(r.outside),
    })),
    payments: payRows.map((r, k) => ({
      ref: `P${k + 1}`, id: r.id, date: iso(r.paid_at)!, amountMinor: Number(r.amount_minor),
      feeMinor: Number(r.fee_minor), method: r.method, status: r.status, allocatedMinor: Number(r.allocated),
      bankDescription: r.bank, reversalReason: r.reversal_reason,
      hasBankRow: Boolean(r.has_bank), hasDocument: Boolean(r.has_doc),
    })),
    statements: stRows.map((r, k) => ({
      ref: `K${k + 1}`, id: r.id, periodStart: iso(r.period_start), periodEnd: iso(r.period_end)!,
      openingMinor: r.opening_balance_minor === null ? null : Number(r.opening_balance_minor),
      closingMinor: r.closing_balance_minor === null ? null : Number(r.closing_balance_minor),
      lineCount: Number(r.lines),
    })),
    transfers: trRows.map((r, k) => ({
      ref: `T${k + 1}`, id: r.id, date: iso(r.value_date)!, amountMinor: Number(r.amount_minor),
      category: r.category, description: r.description ?? "",
    })),
    priorDecisions: prior
      .filter((p): p is typeof p & { status: "ACCEPTED" | "DISMISSED" } =>
        p.status === "ACCEPTED" || p.status === "DISMISSED")
      .map<PriorDecision>((p) => ({
        kind: p.kind, title: p.title, status: p.status, note: p.note, decidedAt: iso(p.decidedAt) ?? "",
      })),
  };
}

/* ───────────────────────── التحليل ───────────────────────── */

export type AnalysisOutcome =
  | {
      ok: true;
      supplierId: string;
      summary: string;
      findings: ValidFinding[];
      signals: Signals;
      model: string;
      costUsd: number;
      runId: string;
      skipped?: string;
    }
  | { ok: false; supplierId: string; reason: string; status: number };

/**
 * يحلّل حساب مورّدٍ واحد.
 *
 * نداءٌ واحد بمهلةٍ **تحت عمر المسار** (٦٠ ثانية على Vercel): الإلغاء
 * موصولٌ بإشارةٍ تنقضي قبله، فيقف النداء بمهلةٍ معلَنة بدل أن يُقتل
 * المسار صامتاً (قرار «الوقوف بمهلةٍ معلَنة»).
 */
export async function analyzeSupplier(
  supplierId: string,
  options: { persist: boolean; actorId: string | null; deadlineMs?: number },
): Promise<AnalysisOutcome> {
  const facts = await gatherSupplierFacts(supplierId);
  if (!facts) return { ok: false, supplierId, reason: "المورّد غير موجود", status: 404 };

  const signals = computeSignals(facts);
  const runId = createId();
  const model = modelFor("REASONING");

  if (facts.invoices.length === 0 && facts.payments.length === 0 && facts.statements.length === 0) {
    return { ok: true, supplierId, summary: "لا فواتير ولا دفعات ولا كشوف لهذا المورّد — لا شيء يُحلَّل.", findings: [], signals, model, costUsd: 0, runId, skipped: "EMPTY" };
  }
  if (!isDeepseekConfigured()) {
    return { ok: false, supplierId, reason: "مفتاح الذكاء غير مضبوط في الخادم", status: 503 };
  }

  const { system, user } = buildAnalysisMessages(facts, signals);
  const deadline = options.deadlineMs ?? 50_000;
  const result = await callDeepseek({
    task: "REASONING",
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    json: true,
    maxTokens: 6000,
    thinking: false,
    timeoutMs: deadline,
    /* الموعد يُقرأ من withDeadline في المسار — وإشارةٌ منقضية كانت تُعيد المحاولة كاملة */
  });

  if (!result.ok) {
    const reason =
      result.kind === "NO_BALANCE" ? "رصيد حساب الذكاء نفد — يُشحَن ثمّ يُعاد التحليل"
      : result.kind === "NOT_CONFIGURED" ? "مفتاح الذكاء غير صالح"
      : result.truncated ? "انقطع جواب الذكاء قبل أن يكتمل — أعد المحاولة"
      : `تعذّر التحليل: ${result.reason}`;
    return { ok: false, supplierId, reason, status: result.kind === "NO_BALANCE" ? 402 : 502 };
  }

  const json = parseJsonLoose(result.text);
  if (!json.ok) return { ok: false, supplierId, reason: "جواب الذكاء ليس JSON يُقرأ", status: 502 };

  const analysis = validateAnalysis(json.value, facts, signals);
  const costUsd = result.estimatedCostUsd;

  if (options.persist) {
    const perRow = analysis.findings.length > 0
      ? Math.round((costUsd * 1_000_000) / analysis.findings.length)
      : 0;

    await db.transaction(async (tx) => {
      await tx.update(aiFindings)
        .set({ status: "SUPERSEDED" })
        .where(and(eq(aiFindings.supplierId, supplierId), eq(aiFindings.status, "OPEN")));

      if (analysis.findings.length > 0) {
        await tx.insert(aiFindings).values(analysis.findings.map((f) => ({
          supplierId,
          runId,
          kind: f.kind,
          severity: f.severity,
          title: f.title,
          explanation: f.explanation,
          amountMinor: f.amountMinor,
          action: f.action as never,
          refs: f.refs as never,
          model: result.model,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          modelConfidence: f.confidence === null ? null : f.confidence.toFixed(3),
          costMicroUsd: perRow,
        })));
      }
    });

    await recordAudit({
      actorId: options.actorId,
      action: "AI_ANALYSIS_RUN",
      entityType: "supplier",
      entityId: supplierId,
      after: {
        المورّد: facts.supplierName,
        النموذج: result.model,
        نسخة_الموجّه: ANALYSIS_PROMPT_VERSION,
        عدد_الاقتراحات: analysis.findings.length,
        أُسقط: analysis.dropped,
        الخلاصة: analysis.summary,
        الكلفة_التقديرية_بالدولار: Number(costUsd.toFixed(5)),
      },
    });
  }

  return {
    ok: true, supplierId, summary: analysis.summary, findings: analysis.findings,
    signals, model: result.model, costUsd, runId,
  };
}

/* ───────────────────────── القرار ───────────────────────── */

export interface StoredFinding {
  id: string;
  supplierId: string;
  kind: string;
  severity: string;
  title: string;
  explanation: string;
  amountMinor: number | null;
  action: FindingAction | null;
  refs: FindingRef[];
  status: string;
  createdAt: Date;
}

export async function listOpenFindings(supplierId?: string): Promise<(StoredFinding & { supplierName: string; supplierSlug: string })[]> {
  const rows = await db
    .select({
      id: aiFindings.id, supplierId: aiFindings.supplierId, kind: aiFindings.kind, severity: aiFindings.severity,
      title: aiFindings.title, explanation: aiFindings.explanation, amountMinor: aiFindings.amountMinor,
      action: aiFindings.action, refs: aiFindings.refs, status: aiFindings.status, createdAt: aiFindings.createdAt,
      supplierName: suppliers.nameAr, supplierSlug: suppliers.slug,
    })
    .from(aiFindings)
    .innerJoin(suppliers, eq(suppliers.id, aiFindings.supplierId))
    .where(supplierId
      ? and(eq(aiFindings.status, "OPEN"), eq(aiFindings.supplierId, supplierId))
      : eq(aiFindings.status, "OPEN"))
    .orderBy(desc(aiFindings.createdAt));

  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return rows
    .map((r) => {
      const refs = (r.refs ?? []) as FindingRef[];
      /* ما حُفظ قبل تسمية الرموز يُسمّى عند العرض — بمراجعه المحفوظة معه */
      return {
        ...r,
        title: humanizeRefs(r.title, refs),
        explanation: humanizeRefs(r.explanation, refs),
        action: (r.action ?? null) as FindingAction | null,
        refs,
      };
    })
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}

export class FindingDecisionError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "FindingDecisionError";
    this.status = status;
  }
}

export type DecisionResult =
  | { decision: "preview"; preview: OwnerPaidPlan | { appliesMinor: number } | null }
  | { decision: "accept" | "dismiss"; message: string };

/** هل يكتب الإقرارُ مالاً؟ — فيحتاج صلاحية اعتماد السداد. */
export function actionTouchesMoney(action: FindingAction | null): boolean {
  return action !== null;
}

export async function loadFinding(findingId: string): Promise<StoredFinding> {
  const [f] = await db.select().from(aiFindings).where(eq(aiFindings.id, findingId)).limit(1);
  if (!f) throw new FindingDecisionError("الاقتراح غير موجود", 404);
  return {
    id: f.id, supplierId: f.supplierId, kind: f.kind, severity: f.severity, title: f.title,
    explanation: f.explanation, amountMinor: f.amountMinor, action: (f.action ?? null) as FindingAction | null,
    refs: (f.refs ?? []) as FindingRef[], status: f.status, createdAt: f.createdAt,
  };
}

export async function decideFinding(input: {
  findingId: string;
  decision: "preview" | "accept" | "dismiss";
  note?: string | null;
  userId: string;
}): Promise<DecisionResult> {
  const finding = await loadFinding(input.findingId);
  if (finding.status !== "OPEN") {
    throw new FindingDecisionError("هذا الاقتراح حُسم من قبل — حدّث الصفحة");
  }

  if (input.decision === "preview") {
    if (finding.action?.type === "OWNER_PAID") {
      return { decision: "preview", preview: await previewOwnerPaid(db, finding.action.invoiceId) };
    }
    return { decision: "preview", preview: null };
  }

  const note = input.note?.trim().slice(0, 500) || null;

  if (input.decision === "dismiss") {
    await db.update(aiFindings)
      .set({ status: "DISMISSED", decidedAt: new Date(), decidedById: input.userId, decisionNote: note })
      .where(and(eq(aiFindings.id, finding.id), eq(aiFindings.status, "OPEN")));
    await recordAudit({
      actorId: input.userId, action: "AI_FINDING_DECIDED", entityType: "ai_finding", entityId: finding.id,
      after: { القرار: "رُفض", النوع: finding.kind, العنوان: finding.title, ملاحظة: note },
    });
    return { decision: "dismiss", message: "رُفض الاقتراح — ولن يُقترح ثانيةً بلا دليلٍ جديد" };
  }

  /* الإقرار */
  let message = "أُقرّ الاقتراح";
  let detail: Record<string, unknown> = {};

  try {
    await db.transaction(async (tx) => {
      const [locked] = (
        await tx.execute<{ status: string }>(sql`select status from ai_findings where id = ${finding.id} for update`)
      ).rows;
      if (locked?.status !== "OPEN") throw new FindingDecisionError("هذا الاقتراح حُسم من قبل — حدّث الصفحة");

      if (finding.action?.type === "OWNER_PAID") {
        const outcome = await markPaidByOwner(tx, finding.action.invoiceId);
        message = `قُيّدت فاتورة ${outcome.invoiceNumber} مسدَّدةً من حسابك`
          + (outcome.appliedMinor > 0 ? `، وانتقلت حوالاتُ المقهى إلى فواتيره الأخرى` : "");
        detail = {
          الفاتورة: outcome.invoiceNumber,
          سداد_المالك_بالهللات: outcome.ownerPaymentMinor,
          فُكّ: outcome.freed,
          خُصم_من: outcome.reapplied,
          بقي_لك_عنده_بالهللات: outcome.creditLeftMinor,
        };
      } else if (finding.action?.type === "VOID_DUPLICATE") {
        const paymentId = finding.action.paymentId;
        /* يُعاد التحقّق لحظة الإقرار: ما زالت قائمة، وبلا حركة بنك ولا مستند */
        const [still] = (
          await tx.execute<{ status: string; doc: string | null; bank: boolean; amount: number }>(sql`
            select p.status::text as status, p.document_id as doc, p.amount_minor as amount,
                   exists (select 1 from bank_transactions t where t.matched_payment_id = p.id) as bank
              from payments p where p.id = ${paymentId} for update
          `)
        ).rows;
        if (!still || still.status === "REVERSED" || still.status === "VOID" || still.doc || still.bank) {
          throw new FindingDecisionError("تغيّرت الدفعة منذ التحليل — لم يُلغَ شيء. أعد التحليل");
        }
        const outcome = await reversePayment(tx, {
          paymentId,
          kind: "VOID",
          reason: "دفعةٌ مكرّرة بلا أصل — أقرّ المالك أنّها واقعةٌ واحدة",
          userId: input.userId,
        });
        message = outcome.freedMinor > 0
          ? "أُلغيت الدفعة المكرّرة — والفواتير التي كانت تغطّيها عادت مستحقّةً إن لم تُسدَّد بغيرها"
          : "أُلغيت الدفعة المكرّرة";
        detail = { الدفعة: paymentId, المبلغ_بالهللات: Number(still.amount), كانت_مخصَّصة_على: outcome.previousAllocations };
      } else if (finding.action?.type === "APPLY_CREDIT") {
        const outcome = await applySupplierCredit(tx, finding.supplierId, { forwardDays: null });
        message = outcome.appliedMinor > 0 ? "خُصم رصيدُك عنده من فواتيره" : "لم يبقَ رصيدٌ يُخصم — تغيّر الحساب منذ التحليل";
        detail = { خُصم_بالهللات: outcome.appliedMinor, التخصيصات: outcome.allocations };
      }

      await tx.update(aiFindings)
        .set({ status: "ACCEPTED", decidedAt: new Date(), decidedById: input.userId, decisionNote: note })
        .where(eq(aiFindings.id, finding.id));

      /* الأرقام تغيّرت — فما بقي مفتوحاً من اقتراحاتٍ ماليّة لهذا المورّد قديم */
      if (finding.action) {
        await tx.update(aiFindings)
          .set({ status: "SUPERSEDED" })
          .where(and(
            eq(aiFindings.supplierId, finding.supplierId),
            eq(aiFindings.status, "OPEN"),
            sql`${aiFindings.action} is not null`,
          ));
      }
    });
  } catch (e) {
    if (e instanceof CreditError) throw new FindingDecisionError(e.message, e.status);
    throw e;
  }

  await recordAudit({
    actorId: input.userId,
    action: finding.action?.type === "OWNER_PAID" ? "INVOICE_PAID_BY_OWNER"
      : finding.action?.type === "APPLY_CREDIT" ? "SUPPLIER_CREDIT_APPLIED"
      : finding.action?.type === "VOID_DUPLICATE" ? "PAYMENT_VOIDED"
      : "AI_FINDING_DECIDED",
    entityType: "ai_finding",
    entityId: finding.id,
    after: { القرار: "أُقرّ", النوع: finding.kind, العنوان: finding.title, ملاحظة: note, ...detail },
  });

  return { decision: "accept", message };
}
