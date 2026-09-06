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
import { settleSupplierAccount } from "@/lib/allocation";

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
  /** أو مجموعةٌ تُسدَّد معاً — في معاملةٍ واحدة لا خمسَ عشرة. */
  transactionIds?: string[];
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
  /**
   * أو: سدادٌ **لحساب المورّد** لا لفاتورةٍ بعينها.
   *
   * وهذه ليست حالةً استثنائية: بعض مورّدي أحمد لا يعطون فاتورةً أصلاً
   * — يعطون كشف حساب أو ورقةً باليد. فالحوالة سدادٌ لحسابه، والفواتير
   * تفصيلٌ داخله؛ تُوزَّع عليها بالأقدم أوّلاً، وما بقي يبقى غير
   * مخصَّص — وهي حالٌ صحيحة لا نقص.
   */
  settleSupplier?: boolean;
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
            lifecycle: "POSTED",
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
          /* «ليست سداداً» إقرارٌ تامّ لا نقص — فلا تبقى في المعلَّق */
          lifecycle: "CONFIRMED",
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

  /* ── سدادٌ على حساب المورّد ── */
  if (body.settleSupplier) {
    const ids = [...new Set([
      ...(Array.isArray(body.transactionIds) ? body.transactionIds : []),
      tx.id,
    ])];

    const group = await db
      .select()
      .from(bankTransactions)
      .where(inArray(bankTransactions.id, ids));

    /*
      الخادم يعيد التحقّق ولا يصدّق المتصفّح: مورّدٌ واحد، وصادرٌ كلّه،
      ولا حركةَ مقيَّدة بدفعة. فمن أرسل معرّفاتٍ لا يجمعها مورّد لا
      يقيّد بها سداداً بضغطة.
    */
    const suppliers = new Set(group.map((g) => g.supplierId ?? body.supplierId ?? ""));
    const supplierId = [...suppliers][0];
    if (suppliers.size !== 1 || !supplierId) {
      return NextResponse.json(
        { error: "لا يُسدَّد حسابٌ بلا مورّد واحد يجمع الحركات" },
        { status: 400 },
      );
    }
    if (group.some((g) => g.direction !== "DEBIT")) {
      return NextResponse.json({ error: "المال الداخل ليس سداداً" }, { status: 400 });
    }
    const already = group.filter((g) => g.matchedPaymentId !== null);
    if (already.length > 0) {
      return NextResponse.json(
        { error: `${already.length} من هذه الحركات مقيَّدة بدفعة بالفعل` },
        { status: 409 },
      );
    }

    return await settleAccounts(user.id, group, supplierId);
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
        lifecycle: "POSTED",
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
        lifecycle: "POSTED",
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

/**
 * يقيّد سداداً على حساب المورّد لحركةٍ أو لمجموعة — في معاملةٍ واحدة.
 *
 * **والمجموعة تُسدَّد معاً لا واحدةً واحدة.** كانت الشاشة ترسل خمسةَ
 * عشر طلباً متتابعاً لمجموعةٍ واحدة، فإن نجح ثمانية وفشل التاسع بقيت
 * المجموعة نصفَ مقيَّدة — ولا أحد يعرف أين وقفت.
 *
 * **والخادم لا يأخذ من المتصفّح إلّا معرّفات الحركات.** الفواتير تُقرأ
 * الآن، والمستحقّ يُحسَب الآن — لأنّ ما رُجّح لحظةَ الاستيراد قد تكون
 * فاتورتُه سُدّدت بعده من دفعةٍ أخرى.
 *
 * **والمستحقّ يتناقص بين حركةٍ وأختها داخل المعاملة نفسها**، فلا
 * تُخصَّص فاتورةٌ واحدة لدفعتين. والقاعدة تحرس ذلك بمؤثِّرٍ يرفض
 * تجاوز إجمالي الفاتورة — فالسباق محسوم في القاعدة لا في الترتيب.
 */
async function settleAccounts(
  userId: string,
  group: (typeof bankTransactions.$inferSelect)[],
  supplierId: string,
) {
  const open = (await db
    .select({
      id: invoices.id,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      allocated: sql<number>`coalesce((select sum(pa.amount_minor)::int
        from payment_allocations pa where pa.invoice_id = ${invoices.id}), 0)`,
    })
    .from(invoices)
    .where(eq(invoices.supplierId, supplierId)))
    .map((i) => ({
      invoiceId: i.id,
      invoiceDate: i.invoiceDate,
      periodMonth: i.periodMonth,
      outstandingMinor: i.totalMinor - Number(i.allocated),
    }))
    .filter((i) => i.outstandingMinor > 0);

  /** المستحقّ وهو يتناقص — فلا تُخصَّص فاتورةٌ لدفعتين. */
  const remaining = new Map(open.map((i) => [i.invoiceId, i.outstandingMinor]));
  const ordered = [...group].sort(
    (a, b) => a.valueDate.getTime() - b.valueDate.getTime());

  let paidCount = 0;
  let allocatedTotal = 0;
  let unappliedTotal = 0;
  let invoiceCount = 0;

  await db.transaction(async (t) => {
    for (const tx of ordered) {
      const plan = settleSupplierAccount(
        tx.amountMinor,
        tx.valueDate,
        open.map((i) => ({ ...i, outstandingMinor: remaining.get(i.invoiceId) ?? 0 })),
      );

      const months = plan.allocations
        .map((a) => open.find((o) => o.invoiceId === a.invoiceId)?.periodMonth)
        .filter((m): m is string => Boolean(m))
        .sort();

      const paymentId = await createPayment(t, {
        supplierId,
        paidAt: tx.valueDate,
        amountMinor: tx.amountMinor,
        method: "BANK_TRANSFER",
        beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
        /* شهر الدفعة هو الأحدث بين فواتيرها — لا شهر أوّلها */
        appliesToMonth: months.length > 0 ? months[months.length - 1] : null,
      });

      if (plan.allocations.length > 0) {
        await allocate(t, paymentId, tx.amountMinor, plan.allocations);
        for (const a of plan.allocations) {
          remaining.set(a.invoiceId, (remaining.get(a.invoiceId) ?? 0) - a.amountMinor);
        }
      }

      await t
        .update(bankTransactions)
        .set({
          matchedPaymentId: paymentId,
          supplierId,
          category: "SUPPLIER",
          matchStatus: "MATCHED",
          matchDisposition: null,
          matchOutcome: plan.remainingMinor > 0 ? "SUPPLIER_ON_ACCOUNT" : "SUPPLIER_SETTLED",
          lifecycle: "POSTED",
        })
        .where(eq(bankTransactions.id, tx.id));

      await t.insert(decisionHistory).values({
        bankTransactionId: tx.id,
        event: "MATCH_CONFIRMED",
        actor: "HUMAN",
        actorId: userId,
        detail: plan.allocations.length > 0
          ? "سدادٌ على حساب المورّد — لا رقمَ فاتورةٍ في الحوالة، فوُزّع بالأقدم أوّلاً"
          : "سدادٌ على حساب المورّد — لا فاتورة مفتوحة تقابله",
        payload: {
          المبلغ: tx.amountMinor,
          "فواتير سُدِّدت": plan.allocations.length,
          "خُصِّص": plan.allocatedMinor,
          "بقي غير مخصَّص": plan.remainingMinor,
          السياسة: "الأقدم أوّلاً",
        },
      });

      paidCount++;
      allocatedTotal += plan.allocatedMinor;
      unappliedTotal += plan.remainingMinor;
      invoiceCount += plan.allocations.length;
    }
  });

  await recordAudit({
    actorId: userId,
    action: "INVOICES_MARKED_PAID",
    entityType: "supplier",
    entityId: supplierId,
    after: {
      الفعل: "سدادٌ على حساب المورّد",
      حركات: paidCount,
      "فواتير سُدِّدت": invoiceCount,
      "خُصِّص": allocatedTotal,
      "بقي غير مخصَّص": unappliedTotal,
      السياسة: "الأقدم أوّلاً — لا رقم فاتورة في الحوالة",
    },
  });

  const money = (m: number) => (m / 100).toFixed(2);
  const left = [...remaining.values()].reduce((n, v) => n + Math.max(0, v), 0);

  return NextResponse.json({
    ok: true,
    settled: paidCount,
    allocated: allocatedTotal,
    unapplied: unappliedTotal,
    supplierBalanceAfter: left,
    message: invoiceCount === 0
      ? `قُيّد ${money(allocatedTotal + unappliedTotal)} على حساب المورّد — لا فاتورة مفتوحة تقابله، فبقي غير مخصَّص`
      : `سُدِّد ${money(allocatedTotal)} على ${invoiceCount} فاتورة بالأقدم أوّلاً (لا رقمَ فاتورةٍ في الحوالة)`
        + (unappliedTotal > 0 ? ` · وبقي ${money(unappliedTotal)} غير مخصَّص` : "")
        + ` · رصيد المورّد بعدها ${money(left)}`,
  });
}
