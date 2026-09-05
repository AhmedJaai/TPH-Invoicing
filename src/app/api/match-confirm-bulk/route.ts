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
import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankTransactions, decisionHistory, invoices, paymentAllocations,
  supplierAliases, suppliers,
} from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { allocate, createPayment } from "@/services/payment.service";
import { recordAudit } from "@/lib/audit";
import { runReconciliation } from "@/services/reconcile.service";
import { loadMerchantMemory } from "@/services/counterparty.service";
import type { SupplierIdentity } from "@/lib/bank/entities";
import type { OpenInvoice } from "@/lib/bank/candidates";

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

interface Body {
  /** معرّفات الحركات وحدها — ولا شيء غيرها يُؤخَذ من المتصفّح. */
  transactionIds?: string[];
}

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const ids = [...new Set(body.transactionIds ?? [])];
  if (ids.length === 0) {
    return NextResponse.json({ error: "لم تُحدَّد حركة" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { error: `أقصى ما يُقرَّ دفعةً واحدة ${MAX_BULK} حركة` },
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
    if (tx.matchDisposition !== "SUGGEST") {
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
    return NextResponse.json({ ok: true, confirmed: 0, outcomes });
  }

  /* ── الحقائق كما هي الآن، لا كما كانت لحظة الاستيراد ── */
  const identityRows = await db
    .select({
      id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug,
      nameEn: suppliers.nameEn, driveFolderName: suppliers.driveFolderName,
      aliases: sql<string>`coalesce(string_agg(${supplierAliases.value}, '||'), '')`,
    })
    .from(suppliers)
    .leftJoin(supplierAliases, eq(supplierAliases.supplierId, suppliers.id))
    .where(eq(suppliers.isActive, true))
    .groupBy(suppliers.id);

  const supplierIdentities: SupplierIdentity[] = identityRows.map((r) => ({
    supplierId: r.id, nameAr: r.nameAr, slug: r.slug,
    nameEn: r.nameEn, driveFolderName: r.driveFolderName,
    aliases: r.aliases.split("||").filter(Boolean),
  }));

  const invRows = await db
    .select({
      id: invoices.id, supplierId: invoices.supplierId,
      invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth, totalMinor: invoices.totalMinor,
      allocated: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}),0)::int`,
    })
    .from(invoices)
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id);

  const open: OpenInvoice[] = invRows
    .map((r) => ({
      id: r.id, supplierId: r.supplierId, invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate, periodMonth: r.periodMonth,
      totalMinor: r.totalMinor - Number(r.allocated),
      outstandingMinor: r.totalMinor - Number(r.allocated),
    }))
    .filter((i) => i.outstandingMinor > 0);

  const memory = await loadMerchantMemory();

  /*
    يُعاد الحساب على الحركات المختارة **مجتمعةً**.

    ولو حُسبت كلٌّ وحدها لجاز أن تطلب حركتان الفاتورةَ نفسها فتُخصَّص
    مرّتين — وهو ما يفعله المطابق الجشع بالضبط. والمحسِّن يوزّعها على
    الفترة كلّها فلا تُحجَز فاتورةٌ لاثنتين.
  */
  const engine = runReconciliation({
    rows: eligible.map((tx) => ({
      key: tx.id,
      valueDate: tx.valueDate,
      description: tx.description ?? "",
      beneficiaryRaw: tx.beneficiaryRaw,
      transactionType: tx.transactionType,
      amountMinor: tx.amountMinor,
      direction: tx.direction,
    })),
    invoices: open,
    suppliers: supplierIdentities,
    memory,
  });

  const plannedByKey = new Map(engine.planned.map((p) => [p.transactionKey, p]));
  const resultByKey = new Map(engine.results.map((r) => [r.key, r]));
  let confirmed = 0;

  for (const tx of eligible) {
    const plan = plannedByKey.get(tx.id);
    const result = resultByKey.get(tx.id);

    /*
      لا يُقَرّ إلّا ما بلغ الحسمَ في إعادة الحساب.

      واقتراحٌ لم يعد يبلغه ليس خطأً في المستخدم: هو تغيّرٌ في الواقع —
      سُدّدت فاتورته، أو ظهر مرشّحٌ ينافسها. فيُعاد بسببه ليُقرَّر بيدٍ
      لا بضغطةٍ جماعية.
    */
    if (!plan) {
      outcomes.push({
        transactionId: tx.id,
        ok: false,
        reason:
          result?.decision?.reasons?.[result.decision.reasons.length - 1]
          ?? "لم تعد تبلغ حدّ الحسم — راجعها وحدها",
      });
      continue;
    }

    const paymentId = await db.transaction(async (t) => {
      const id = await createPayment(t, {
        supplierId: plan.supplierId,
        paidAt: plan.paidAt,
        amountMinor: plan.amountMinor,
        method: "BANK_TRANSFER",
        beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
        appliesToMonth: plan.primaryMonth,
        feeMinor: plan.feeMinor,
      });

      await allocate(t, id, plan.amountMinor, plan.allocations);

      await t
        .update(bankTransactions)
        .set({
          matchedPaymentId: id,
          matchStatus: "MATCHED",
          matchDisposition: "AUTO",
          supplierId: plan.supplierId,
          category: "SUPPLIER",
        })
        .where(and(
          eq(bankTransactions.id, tx.id),
          /*
            شرطُ السباق: لو أقرّها أحدٌ آخر بين قراءتنا وكتابتنا لم
            تُكتَب مرّتين. والفحص في الشيفرة يفلت من طلبين متزامنين.
          */
          sql`${bankTransactions.matchedPaymentId} is null`,
        ));

      await t.insert(decisionHistory).values({
        bankTransactionId: tx.id,
        event: "MATCH_CONFIRMED",
        actor: "HUMAN",
        actorId: user.id,
        detail: `إقرارٌ جماعيّ بعد إعادة الحساب — ${plan.allocations.length} فاتورة`,
        payload: {
          الدفعة: id,
          الفواتير: plan.allocations.map((a) => a.invoiceId),
          الرسم: plan.feeMinor,
          "أُعيد الحساب": true,
        },
      });

      return id;
    });

    confirmed++;
    outcomes.push({
      transactionId: tx.id,
      ok: true,
      reason: `أُقرّت على ${plan.allocations.length} فاتورة`,
      paymentId,
      invoiceIds: plan.allocations.map((a) => a.invoiceId),
    });
  }

  await recordAudit({
    actorId: user.id,
    action: "INVOICES_MARKED_PAID",
    entityType: "bank_transaction",
    entityId: `bulk:${confirmed}`,
    after: {
      الفعل: "إقرارٌ جماعيّ لاقتراحات المطابقة",
      "طُلبت": ids.length,
      "أُقرّت": confirmed,
      "رُدّت": outcomes.filter((o) => !o.ok).length,
      "أسباب الردّ": outcomes.filter((o) => !o.ok).map((o) => o.reason),
    },
  });

  return NextResponse.json({
    ok: true,
    confirmed,
    rejected: outcomes.filter((o) => !o.ok).length,
    outcomes,
    message:
      confirmed === ids.length
        ? `أُقرّت ${confirmed} حركة`
        : `أُقرّت ${confirmed} من ${ids.length} — والباقي تغيّر حاله فيُراجَع وحده`,
  });
}
