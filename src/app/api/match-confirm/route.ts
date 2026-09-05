/**
 * قبول مطابقة، أو إعلان أنّها ليست سداد فاتورة.
 *
 * هذا هو الفعل الذي كان غائباً: يقول النظام «تحتاج قرارك» ولا يعطي ما
 * يُقرَّر به. فيقف صاحب العمل أمام حركةٍ يعرف أنّها تحتاجه ولا يملك
 * فعلاً — فيتركها، فتبقى معلّقة إلى الأبد.
 *
 * والقبول يمرّ بما يمرّ به الاستيراد: تُنشأ دفعة، وتُخصَّص بقدرها، ولا
 * تتجاوز قيمةَ الدفعة ولا قيمةَ الفاتورة — تحرسه قيود القاعدة نفسها.
 */
import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, decisionHistory, invoices } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { allocate, createPayment } from "@/services/payment.service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/** ما يُعلَن به أنّ الحركة ليست سداد فاتورة. */
const NOT_PAYMENT_KINDS = {
  ADVANCE: { category: "SUPPLIER", label: "دفعة مقدَّمة لمورّد" },
  INTERNAL: { category: "INTERNAL", label: "تحويل داخلي" },
  PERSONAL: { category: "PERSONAL", label: "تحويل شخصي" },
  BANK_FEE: { category: "BANK_FEE", label: "رسم بنكيّ" },
} as const;

interface Body {
  transactionId?: string;
  /** الفواتير التي تفسّر الحركة — تُقبَل كما هي. */
  invoiceIds?: string[];
  /**
   * أو توزيعٌ يكتبه صاحب العمل بنفسه.
   *
   * لأنّ النظام لا يعرف دائماً كيف قُسّمت الحوالة: دفعةٌ بسبعة آلاف
   * وخمسمئة قد تكون أربعة آلاف على فاتورة وثلاثة آلاف وخمسمئة على
   * أخرى، ولا شيء في الكشف يقول ذلك. فيقوله هو.
   */
  split?: { invoiceId: string; amountMinor: number }[];
  /** أو: ليست سداد فاتورة، وهذا سببها. */
  notAPayment?: keyof typeof NOT_PAYMENT_KINDS;
  /** لمن دُفعت المقدَّمة، إن لم يُعرَف المورّد من الحركة. */
  supplierId?: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("match-confirm", "payment:approve");
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

  if (!body.transactionId) {
    return NextResponse.json({ error: "حدّد الحركة" }, { status: 400 });
  }

  const [tx] = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, body.transactionId));

  if (!tx) return NextResponse.json({ error: "لا توجد هذه الحركة" }, { status: 404 });
  if (tx.matchedPaymentId) {
    return NextResponse.json(
      { error: "هذه الحركة مطابَقة أصلاً — تراجع عنها أوّلاً" },
      { status: 409 },
    );
  }

  /* ── ليست سداد فاتورة ── */
  if (body.notAPayment) {
    const kind = NOT_PAYMENT_KINDS[body.notAPayment];
    if (!kind) return NextResponse.json({ error: "سببٌ غير معروف" }, { status: 400 });

    /*
      الدفعة المقدَّمة **مالٌ خرج**، لا حركةٌ تُتجاهَل.

      كانت تُوسَم `IGNORED` وينتهي الأمر: يختفي من الحساب ألفُ ريالٍ
      دُفعت للمورّد قبل وصول فاتورته، ولا يبقى لها أثر — فإذا وصلت
      الفاتورة دُفعت ثانيةً. والتجاهل يليق بما ليس مالاً: رسمٌ بنكيّ أو
      تحويلٌ داخليّ. أمّا هذه فتُقيَّد دفعةً حالُها `ADVANCE`، ورصيداً
      للمورّد يُخصَّص على فاتورته حين تصل.
    */
    if (body.notAPayment === "ADVANCE") {
      const supplierId = body.supplierId ?? tx.supplierId;
      if (!supplierId) {
        return NextResponse.json(
          { error: "الدفعة المقدَّمة تحتاج مورّداً — لمن دُفعت؟" },
          { status: 400 },
        );
      }

      const advanceId = await db.transaction(async (t) => {
        const id = await createPayment(t, {
          supplierId,
          paidAt: tx.valueDate,
          amountMinor: tx.amountMinor,
          method: "BANK_TRANSFER",
          beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
          isAdvance: true,
        });

        await t
          .update(bankTransactions)
          .set({
            category: "SUPPLIER",
            matchedPaymentId: id,
            matchStatus: "MATCHED",
            matchDisposition: "AUTO",
            matchOutcome: "ADVANCE",
            supplierId,
          })
          .where(eq(bankTransactions.id, tx.id));

        await t.insert(decisionHistory).values({
          bankTransactionId: tx.id,
          event: "MATCH_CONFIRMED",
          actor: "HUMAN",
          actorId: user.id,
          detail: "دفعةٌ مقدَّمة لمورّد — رصيدٌ ينتظر فاتورته",
          payload: { الدفعة: id, المورّد: supplierId, المبلغ: tx.amountMinor },
        });

        return id;
      });

      await recordAudit({
        actorId: user.id,
        action: "INVOICES_MARKED_PAID",
        entityType: "bank_transaction",
        entityId: tx.id,
        after: { الفعل: "قُيّدت دفعةً مقدَّمة", الدفعة: advanceId, المورّد: supplierId },
      });

      return NextResponse.json({
        ok: true,
        message: "قُيّدت دفعةً مقدَّمة — تُخصَّص على فاتورة المورّد حين تصل",
      });
    }

    await db.transaction(async (t) => {
      await t
        .update(bankTransactions)
        .set({
          category: kind.category,
          matchStatus: "IGNORED",
          matchDisposition: null,
          matchOutcome: "NOT_A_PAYMENT",
        })
        .where(eq(bankTransactions.id, tx.id));

      await t.insert(decisionHistory).values({
        bankTransactionId: tx.id,
        event: "MATCH_REJECTED",
        actor: "HUMAN",
        actorId: user.id,
        detail: `أُعلنت ليست سداد فاتورة: ${kind.label}`,
        payload: { الباب: kind.category },
      });
    });

    await recordAudit({
      actorId: user.id,
      action: "INVOICES_MARKED_PAID",
      entityType: "bank_transaction",
      entityId: tx.id,
      after: { الفعل: "أُعلنت ليست سداد فاتورة", السبب: kind.label },
    });

    return NextResponse.json({ ok: true, message: `حُفظت: ${kind.label}` });
  }

  /* ── توزيعٌ يدويّ ── */
  if (body.split && body.split.length > 0) {
    return await applyManualSplit(user.id, tx, body.split);
  }

  /* ── قبول مطابقة ── */
  const ids = body.invoiceIds ?? [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "حدّد الفاتورة أو السبب" }, { status: 400 });
  }

  const chosen = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      periodMonth: invoices.periodMonth,
      invoiceDate: invoices.invoiceDate,
      totalMinor: invoices.totalMinor,
      allocated: sql<number>`coalesce((select sum(pa.amount_minor)::int
        from payment_allocations pa where pa.invoice_id = invoices.id), 0)`,
    })
    .from(invoices)
    .where(inArray(invoices.id, ids));

  if (chosen.length !== ids.length) {
    return NextResponse.json({ error: "بعض الفواتير غير موجودة" }, { status: 400 });
  }

  const suppliers = new Set(chosen.map((c) => c.supplierId));
  if (suppliers.size > 1) {
    return NextResponse.json(
      { error: "لا تُجمَع فواتير مورّدين مختلفين في دفعة واحدة" },
      { status: 400 },
    );
  }

  /*
    التخصيص بترتيب التاريخ — الأقدم أوّلاً — ولا يتجاوز قيمة الدفعة
    ولا المتبقّي على أيّ فاتورة. وقيود القاعدة تحرس هذا أيضاً، فالحارس
    مزدوج.
  */
  let left = tx.amountMinor;
  const allocations: { invoiceId: string; amountMinor: number }[] = [];
  const months = new Set<string>();

  for (const inv of [...chosen].sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime())) {
    if (left <= 0) break;
    const outstanding = inv.totalMinor - Number(inv.allocated);
    const take = Math.min(left, outstanding);
    if (take <= 0) continue;
    allocations.push({ invoiceId: inv.id, amountMinor: take });
    months.add(inv.periodMonth);
    left -= take;
  }

  if (allocations.length === 0) {
    return NextResponse.json(
      { error: "الفواتير المختارة مسدَّدة بالكامل — لا شيء يُخصَّص" },
      { status: 409 },
    );
  }

  const sorted = [...months].sort();

  /*
    الدفعة والتخصيص ووسم الحركة عملٌ واحد.

    فلو أُنشئت الدفعة ثمّ فشل التخصيص لبقيت دفعةٌ لا تفسّر شيئاً،
    وحركةٌ تبدو مطابَقة وليست كذلك.
  */
  const paymentId = await db.transaction(async (t) => {
    const id = await createPayment(t, {
      supplierId: chosen[0].supplierId,
      paidAt: tx.valueDate,
      amountMinor: tx.amountMinor,
      method: "BANK_TRANSFER",
      beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
      appliesToMonth: sorted[sorted.length - 1],
    });

    await allocate(t, id, tx.amountMinor, allocations);

    await t
      .update(bankTransactions)
      .set({
        matchedPaymentId: id,
        matchStatus: "MATCHED",
        matchDisposition: "AUTO",
        supplierId: chosen[0].supplierId,
        category: "SUPPLIER",
      })
      .where(eq(bankTransactions.id, tx.id));

    await t.insert(decisionHistory).values({
      bankTransactionId: tx.id,
      event: "MATCH_CONFIRMED",
      actor: "HUMAN",
      actorId: user.id,
      detail: `أقرّها على ${allocations.length} فاتورة`,
      payload: { الدفعة: id, الفواتير: allocations.map((a) => a.invoiceId), الشهور: sorted },
    });

    return id;
  });

  await recordAudit({
    actorId: user.id,
    action: "INVOICES_MARKED_PAID",
    entityType: "bank_transaction",
    entityId: tx.id,
    after: {
      الفعل: "قبِلَ المطابقة بنفسه",
      الدفعة: paymentId,
      الفواتير: allocations.map((a) => `${a.invoiceId}:${a.amountMinor / 100}`),
      الشهور: sorted,
      "المتبقّي بلا تخصيص": left / 100,
    },
  });

  const remainder = left > 0 ? ` وبقي ${(left / 100).toFixed(2)} بلا تخصيص` : "";
  return NextResponse.json({
    ok: true,
    message: `طُوبقت مع ${allocations.length} فاتورة${remainder}`,
    allocations,
  });
}


/**
 * توزيعٌ يكتبه صاحب العمل.
 *
 * ويُتحقَّق منه في الخادم كما يُتحقَّق من أي رقم: لا مبلغ سالب، ولا
 * مجموعٌ يتجاوز الدفعة، ولا تخصيصٌ فوق المتبقّي على الفاتورة. وقيود
 * القاعدة تحرسه أيضاً — فالحارس مزدوج.
 */
async function applyManualSplit(
  userId: string,
  tx: { id: string; amountMinor: number; valueDate: Date; beneficiaryRaw: string | null; description: string | null },
  split: { invoiceId: string; amountMinor: number }[],
): Promise<NextResponse> {
  for (const s of split) {
    if (!Number.isInteger(s.amountMinor) || s.amountMinor <= 0) {
      return NextResponse.json({ error: "كل مبلغ يجب أن يكون موجباً" }, { status: 400 });
    }
  }

  const total = split.reduce((sum, s) => sum + s.amountMinor, 0);
  if (total > tx.amountMinor) {
    return NextResponse.json(
      { error: `المجموع ${(total / 100).toFixed(2)} يتجاوز الدفعة ${(tx.amountMinor / 100).toFixed(2)}` },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      allocated: sql<number>`coalesce((select sum(pa.amount_minor)::int
        from payment_allocations pa where pa.invoice_id = invoices.id), 0)`,
    })
    .from(invoices)
    .where(inArray(invoices.id, split.map((s) => s.invoiceId)));

  if (rows.length !== split.length) {
    return NextResponse.json({ error: "بعض الفواتير غير موجودة" }, { status: 400 });
  }

  if (new Set(rows.map((r) => r.supplierId)).size > 1) {
    return NextResponse.json(
      { error: "لا تُجمَع فواتير مورّدين مختلفين في دفعة واحدة" },
      { status: 400 },
    );
  }

  for (const s of split) {
    const inv = rows.find((r) => r.id === s.invoiceId)!;
    const outstanding = inv.totalMinor - Number(inv.allocated);
    if (s.amountMinor > outstanding) {
      return NextResponse.json(
        { error: `تخصيصٌ فوق المتبقّي على فاتورة: ${(outstanding / 100).toFixed(2)} متبقٍّ` },
        { status: 400 },
      );
    }
  }

  const months = [...new Set(rows.map((r) => r.periodMonth))].sort();

  const paymentId = await db.transaction(async (t) => {
    const id = await createPayment(t, {
      supplierId: rows[0].supplierId,
      paidAt: tx.valueDate,
      amountMinor: tx.amountMinor,
      method: "BANK_TRANSFER",
      beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
      appliesToMonth: months[months.length - 1],
    });

    await allocate(t, id, tx.amountMinor, split);

    await t
      .update(bankTransactions)
      .set({
        matchedPaymentId: id,
        matchStatus: "MATCHED",
        matchDisposition: "AUTO",
        supplierId: rows[0].supplierId,
        category: "SUPPLIER",
      })
      .where(eq(bankTransactions.id, tx.id));

    await t.insert(decisionHistory).values({
      bankTransactionId: tx.id,
      event: "MATCH_CONFIRMED",
      actor: "HUMAN",
      actorId: userId,
      detail: `وزّعها بنفسه على ${split.length} فاتورة`,
      payload: { الدفعة: id, التوزيع: split },
    });

    return id;
  });

  await recordAudit({
    actorId: userId,
    action: "INVOICES_MARKED_PAID",
    entityType: "bank_transaction",
    entityId: tx.id,
    after: {
      الفعل: "وزّعها بنفسه",
      الدفعة: paymentId,
      التوزيع: split.map((s) => `${s.invoiceId}:${s.amountMinor / 100}`),
      "بلا تخصيص": (tx.amountMinor - total) / 100,
    },
  });

  const left = tx.amountMinor - total;
  return NextResponse.json({
    ok: true,
    message:
      left > 0
        ? `وُزّعت على ${split.length} فاتورة، وبقي ${(left / 100).toFixed(2)} بلا تخصيص`
        : `وُزّعت على ${split.length} فاتورة بالكامل`,
  });
}
