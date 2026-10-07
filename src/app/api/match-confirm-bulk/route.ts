/**
 * تأكيدٌ جماعيّ لاقتراحات المطابقة.
 *
 * الحاجة واقعية: كشفٌ فيه ثلاثمئة حركة يُنتج عشرات الاقتراحات، وإقرارُ
 * كلٍّ منها بضغطتين يجعل المراجعة عملاً لا يُنجَز — فتُترَك، وتبقى
 * الحركات معلّقةً إلى الأبد. والنظام الذي لا يُستعمَل لا يحمي شيئاً.
 *
 * **والخطر أنّ الجماعيّ يُغري بالثقة.** فالقاعدة هنا: الخادم لا يصدّق
 * المتصفّح في شيء. لا يأخذ منه فواتير، ولا مبالغ، ولا مورّداً — يأخذ
 * **معرّفات حركات** فقط، ثمّ يُعيد الحساب من جديد على الفواتير كما هي
 * الآن.
 *
 * ولماذا يُعاد الحساب: الاقتراح حُسب لحظةَ الاستيراد. وقد تكون فاتورته
 * سُدّدت بعده من دفعةٍ أخرى، أو أُلغيت، أو عُدّل مبلغها. فإقرارُ اقتراحٍ
 * قديم يُخصّص مالاً على فاتورةٍ لم تعد مستحقّة — وهذا يخلق مالاً من
 * العدم كما يفعل التخصيص الزائد تماماً.
 *
 * وما لم يعد يصلح لا يُقرَّ ولا يُرَدّ صامتاً: يُعاد في القائمة بسببه.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, decisionHistory } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { allocate, recordBankPayment, claimBankTransaction, AlreadyMatchedError } from "@/services/payment.service";
import { MonthClosedError } from "@/services/validation.service";
import { recordAudit } from "@/lib/audit";
import { planFor, type PlannedPayment } from "@/services/reconcile.service";
import type { Candidate } from "@/lib/bank/candidates";
import { pickCandidate, recomputeMatches } from "@/services/match-recompute.service";
import { INVOICE, TRANSACTION, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * حدّ الدفعة الواحدة.
 *
 * لا لأنّ الأكثر خطأ، بل لأنّ ما يُقرّ في ضغطةٍ واحدة يجب أن يبقى
 * قابلاً للمراجعة بعين واحدة — ولأنّ التراجع عن خمسين أسهل من التراجع
 * عن خمسمئة.
 */
export const MAX_BULK = 50;

const Body = z.object({
  /** معرّفات الحركات وحدها — ولا شيء غيرها يُؤخَذ من المتصفّح. */
  transactionIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  /**
   * لحركةٍ واحدة: المرشّحُ الذي اختاره صاحبُ العمل من القائمة التي عرضها
   * الخادم — **بمعرّفات فواتيره وحدها**. يُتحقَّق أنّه ممّا يحسبه الخادم
   * الآن، والمبلغُ والتخصيصُ يحسبهما الخادم.
   */
  candidateInvoiceIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});
type Body = z.infer<typeof Body>;

interface Outcome {
  transactionId: string;
  ok: boolean;
  reason: string;
  paymentId?: string;
  invoiceIds?: string[];
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("match-confirm-bulk", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  const ids = [...new Set(body.transactionIds ?? [])];
  if (ids.length === 0) {
    return NextResponse.json({ error: "لم تُحدَّد حركة" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { error: `أقصى ما يُقرَّ دفعةً واحدة ${countNoun(MAX_BULK, TRANSACTION)}` },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(bankTransactions)
    .where(inArray(bankTransactions.id, ids));

  const outcomes: Outcome[] = [];

  /* ما لا يصلح للإقرار أصلاً يُفرَز قبل أي حساب */
  const eligible = rows.filter((tx) => {
    if (tx.matchedPaymentId) {
      outcomes.push({ transactionId: tx.id, ok: false, reason: "مطابَقة أصلاً" });
      return false;
    }
    /* ومن اختار فاتورةً بعينها لحركةٍ في «يُراجَع» فقد قرّر — يُتحقَّق من اختياره أدناه */
    const pickedByHand = (body.candidateInvoiceIds?.length ?? 0) > 0 && tx.matchDisposition === "REVIEW";
    if (tx.matchDisposition !== "SUGGEST" && !pickedByHand) {
      outcomes.push({
        transactionId: tx.id, ok: false,
        reason: "ليست اقتراحاً — الإقرار الجماعيّ للاقتراحات وحدها",
      });
      return false;
    }
    return true;
  });

  for (const missing of ids.filter((id) => !rows.some((r) => r.id === id))) {
    outcomes.push({ transactionId: missing, ok: false, reason: "لا توجد هذه الحركة" });
  }

  if (eligible.length === 0) {
    /*
      لا شيء صالح — والردّ يقول ذلك بنصّه.
      كان يخرج بلا `message`، فتقرؤه الواجهة نجاحاً بلا خبر وتُظهر
      نصّها الاحتياطيّ «أُكِّدت». والردّ الذي لا يحمل خبر الرفض يجعل
      كلّ قارئٍ له يخترع خبراً.
    */
    return NextResponse.json({
      ok: true,
      confirmed: 0,
      rejected: outcomes.length,
      outcomes,
      message:
        outcomes.length === 1
          ? `لم يُكتب شيء — ${outcomes[0].reason}`
          : `لم يُكتب شيء — ${countNoun(outcomes.length, TRANSACTION)} رُدّت`,
    });
  }

  /* اختيارُ مرشّحٍ بعينه لحركةٍ واحدة — لا يُعمَّم على دفعة */
  const chosenInvoiceIds = body.candidateInvoiceIds ?? [];
  if (chosenInvoiceIds.length > 0 && ids.length !== 1) {
    return NextResponse.json({ error: "اختيارُ الفاتورة لحركةٍ واحدة في المرّة" }, { status: 400 });
  }

  /* ── الحقائق كما هي الآن، لا كما كانت لحظة الاستيراد ── */
  const { engine, invoiceById } = await recomputeMatches(eligible);

  const plannedByKey = new Map(engine.planned.map((p) => [p.transactionKey, p]));
  const resultByKey = new Map(engine.results.map((r) => [r.key, r]));
  /*
    إقرارُ حركةٍ واحدة بيدٍ غيرُ الإقرار الجماعيّ.

    الجماعيّ يُغري بالثقة، فلا يكتب إلّا ما بلغ الحسمَ في إعادة الحساب.
    أمّا من فتح حركةً واحدة وضغط «قيّدها على هذه الفاتورة» فقد **أقرّ**
    اقتراحاً — وكان يُردّ دائماً: الاقتراحُ الذي سببُه درجةٌ دون الحدّ أو
    مرشّحٌ قريب أو سدادٌ جزئيّ يعود اقتراحاً في كلّ إعادة حساب، فلا يُقَرّ
    من أيّ شاشة، ولا يبقى إلّا «قيّد على حسابه» وهو قد يسدّد غير المقصودة.
    فيُكتب مرشّحُ المحرّك (أو الذي اختاره من قائمته) ما دام صالحاً الآن:
    فواتيرُه مفتوحة، ولمورّد الحركة، والتخصيصُ يحسبه الخادم.
  */
  const single = ids.length === 1;
  let confirmed = 0;

  for (const tx of eligible) {
    const result = resultByKey.get(tx.id);
    let plan: PlannedPayment | undefined = chosenInvoiceIds.length > 0 ? undefined : plannedByKey.get(tx.id);
    let byHand = false;
    let candidate: Candidate | null = result?.candidate ?? null;

    /* بلا اختيارٍ صريح لا يُقَرّ ما نزل دون الاقتراح — الضعيفُ يُختار بعينه أو يُترَك */
    const confirmableByHand = chosenInvoiceIds.length > 0 || result?.decision?.disposition !== "REVIEW";
    if (!plan && single && result?.supplierId && confirmableByHand) {
      candidate = pickCandidate(engine, tx.id, chosenInvoiceIds);
      if (chosenInvoiceIds.length > 0 && !candidate) {
        outcomes.push({
          transactionId: tx.id, ok: false,
          reason: "الفاتورة المختارة لم تعد مرشّحةً لهذه الحركة — سُدّدت أو تغيّرت. حدّث القائمة واختر من جديد",
        });
        continue;
      }
      const made = candidate
        ? planFor(
            { key: tx.id, supplierId: result.supplierId, amountMinor: tx.amountMinor, paidAt: tx.valueDate },
            candidate, invoiceById, { fullAmount: true },
          )
        : null;
      if (made) {
        plan = made;
        byHand = true;
      }
    }

    /*
      لا يُقَرّ جماعةً إلّا ما بلغ الحسمَ في إعادة الحساب.

      واقتراحٌ لم يعد يبلغه ليس خطأً في المستخدم: هو تغيّرٌ في الواقع —
      سُدّدت فاتورته، أو ظهر مرشّحٌ ينافسها. فيُعاد بسببه ليُقرَّر بيدٍ
      لا بضغطةٍ جماعية.
    */
    if (!plan) {
      const last = result?.decision?.reasons?.[result.decision.reasons.length - 1];
      outcomes.push({
        transactionId: tx.id,
        ok: false,
        reason: !single && candidate
          ? `${last ?? "لم تعد تبلغ حدّ الحسم"} — أقِرّها وحدها من صفّها`
          : last ?? "لم تعد تبلغ حدّ الحسم — راجعها وحدها",
      });
      continue;
    }

    /*
      الأدلّةُ التي يُبنى عليها القيدُ تُحفَظ معه — لا أدلّةُ لحظة الاستيراد
      وقد تخالف ما كُتب فعلاً.
    */
    const evidence = {
      تصنيف: result?.classificationReason ?? null,
      مستفيد: result?.supplierEvidence ?? [],
      مطابقة: [
        ...(byHand ? (candidate?.evidence ?? []) : (result?.decision?.reasons ?? [])),
        byHand ? "أقرّها إنسانٌ على هذا المرشّح بعد إعادة الحساب" : "أُقرّت بعد إعادة الحساب",
      ],
      درجةالمستفيد: Math.round((result?.supplierScore ?? 0) * 100),
      فواتير: plan.allocations.map((a) => a.invoiceId),
    };
    const unallocated = plan.amountMinor - plan.feeMinor
      - plan.allocations.reduce((n, a) => n + a.amountMinor, 0);
    const decided = plan;

    /*
      ══ لماذا معاملةٌ لكلّ حركة، لا معاملةٌ للجميع ══

      كلُّ حركةٍ هنا **قرارٌ ماليّ مستقلّ**: دفعتُها الخاصّة على فواتيرها،
      ولها شرطُ سباقها (`matched_payment_id is null`) يمنع كتابتها مرّتين.
      فجمعُ الخمس عشرة في معاملةٍ واحدة يجعل سقوطَ واحدةٍ يُلغي أربع عشرة
      صحيحة — وذلك أسوأ لصاحب العمل، لا أسلم.

      والمطلوب ليس «الكلّ أو لا شيء» بل **أن يُعرَف ما وقع بالضبط**.
      وكان الخلل أنّ استثناءً في العاشرة يُسقط الطلب كلَّه بـ٥٠٠، فتُكتَب
      تسعٌ في القاعدة ولا يعلم بها أحد — لا الشاشة ولا السجلّ. فصار كلُّ
      سقوطٍ يُقيَّد نتيجةً لصاحبه، ويمضي الباقي.
    */
    let paymentId: string;
    try {
      paymentId = await db.transaction(async (t) => {
        const { id } = await recordBankPayment(t, {
          supplierId: decided.supplierId,
          paidAt: decided.paidAt,
          amountMinor: decided.amountMinor,
          method: "BANK_TRANSFER",
          beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
          appliesToMonth: decided.primaryMonth,
          feeMinor: decided.feeMinor,
        });

        await allocate(t, id, decided.amountMinor, decided.allocations);

        /*
          شرطُ السباق، ويُفحَص أثرُه: كان الشرط في `where` ولا يُعدّ ما
          كُتب، فتُودَع الدفعة وتخصيصها ولو خسرت السباق. `claim` يرمي
          عند صفر صفوف فتُلغى المعاملة كلّها.
        */
        await claimBankTransaction(t, tx.id, {
          matchedPaymentId: id,
          matchStatus: "MATCHED",
          /*
            قرارٌ أقرّه إنسان ليس «طُوبقت تلقائياً»: كان يُكتب `AUTO`
            فتعرضه الشاشةُ كذلك ويدخل مقياسَ الحسم التلقائيّ. `null` كما
            يكتب «قيّد على حسابه» — و«سُجّلت سداداً» شارتُه.
          */
          matchDisposition: null,
          matchOutcome: candidate?.outcome ?? tx.matchOutcome,
          matchScore: candidate ? Math.round(candidate.score * 100) : tx.matchScore,
          matchEvidence: evidence,
          lifecycle: "POSTED",
          supplierId: decided.supplierId,
          category: "SUPPLIER",
          /* بابٌ أقرّه إنسانٌ بضغطته — ولا يبقى مصدرُه «مجهولاً» بجانبه */
          classificationSource: "HUMAN",
        });

        await t.insert(decisionHistory).values({
          bankTransactionId: tx.id,
          event: "MATCH_CONFIRMED",
          actor: "HUMAN",
          actorId: user.id,
          detail: `${byHand ? "إقرارُ اقتراحٍ بيد" : "إقرارٌ"} بعد إعادة الحساب — ${countNoun(decided.allocations.length, INVOICE)}`,
          payload: {
            الدفعة: id,
            الفواتير: decided.allocations.map((a) => a.invoiceId),
            الرسم: decided.feeMinor,
            "بقي غير مخصَّص": unallocated,
            "أُعيد الحساب": true,
            "اختيارٌ بيد": byHand,
            النتيجة: candidate?.outcome ?? null,
          },
        });

        /*
          أثرُ التدقيق داخل معاملة المال: كان يُكتب بعد الإيداع وبلا مقبض،
          فإن سقط بقي المالُ مكتوباً بلا أثر.
        */
        await recordAudit({
          actorId: user.id,
          action: "MATCH_CONFIRMED",
          entityType: "bank_transaction",
          entityId: tx.id,
          before: { القرار: tx.matchDisposition, النتيجة: tx.matchOutcome, الدرجة: tx.matchScore },
          after: {
            الفعل: byHand ? "إقرارُ اقتراحٍ بيد بعد إعادة الحساب" : "إقرارُ اقتراحٍ بعد إعادة الحساب",
            الدفعة: id,
            المبلغ_بالهللات: decided.amountMinor,
            الرسم_بالهللات: decided.feeMinor,
            التخصيصات: decided.allocations,
            "بقي غير مخصَّص": unallocated,
          },
        }, t);

        return id;
      });
    } catch (e) {
      outcomes.push({
        transactionId: tx.id,
        ok: false,
        reason: e instanceof AlreadyMatchedError || e instanceof MonthClosedError
          ? e.message
          : "تعذّر التقييد — لم يُكتب منها شيء. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب.",
      });
      continue;
    }

    confirmed++;
    outcomes.push({
      transactionId: tx.id,
      ok: true,
      reason: `أُقرّت على ${countNoun(decided.allocations.length, INVOICE)}`
        + (unallocated > 0 ? ` · وبقي ${formatRiyalsDisplay(unallocated)} غير مخصَّص على حساب المورّد` : ""),
      paymentId,
      invoiceIds: decided.allocations.map((a) => a.invoiceId),
    });
  }

  return NextResponse.json({
    ok: true,
    confirmed,
    rejected: outcomes.filter((o) => !o.ok).length,
    outcomes,
    message:
      confirmed === ids.length
        ? single
          ? outcomes.find((o) => o.ok)?.reason ?? `أُقرّت ${countNoun(confirmed, TRANSACTION)}`
          : `أُقرّت ${countNoun(confirmed, TRANSACTION)}`
        : `أُقرّت ${confirmed} من ${ids.length} — والباقي تغيّر حاله فيُراجَع وحده`,
  });
}
