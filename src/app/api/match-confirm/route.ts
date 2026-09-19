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
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, decisionHistory, invoices } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { allocate, claimBankTransaction, recordBankPayment } from "@/services/payment.service";
import { recordAudit } from "@/lib/audit";
import { resyncBankExpenses } from "@/services/expense.service";
import { settleSupplierAccount } from "@/lib/allocation";
import { INVOICE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";

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

/**
 * أخطاءُ المال المعروفة تُترجَم هنا مرّةً لكلّ المسارات: شهرٌ مقفل،
 * أو حركةٌ قُيّدت بين قراءتها وكتابتها، أو توأمٌ لم يُقَرّ.
 */
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle(request: Request) {
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
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 });
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
    /*
      ضغطةٌ ثانية بعد انقطاعٍ نجح فيه الطلب الأوّل ليست خطأً من صاحبها.
      وكان يُقال له «تراجع عنها أوّلاً» — فيُدفَع إلى هدم عملٍ صحيح. فإن
      كان هو من قيّدها في الدقائق الأخيرة، يُقال له إنّها قُيّدت.
    */
    const [recent] = await db
      .select({ at: decisionHistory.createdAt })
      .from(decisionHistory)
      .where(and(
        eq(decisionHistory.bankTransactionId, tx.id),
        eq(decisionHistory.actorId, user.id),
        eq(decisionHistory.event, "MATCH_CONFIRMED"),
        gte(decisionHistory.createdAt, new Date(Date.now() - 15 * 60_000)),
      ))
      .orderBy(desc(decisionHistory.createdAt))
      .limit(1);
    if (recent) {
      return NextResponse.json({ ok: true, message: "قُيّدت من قبل — لم يُكتب شيءٌ ثانيةً" });
    }
    return NextResponse.json(
      { error: "هذه الحركة سُجّلت سداداً من قبل — افتحها في صفحة البنك لترى دفعتها" },
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

      await db.transaction(async (t) => {
        const { id } = await recordBankPayment(t, {
          supplierId,
          paidAt: tx.valueDate,
          amountMinor: tx.amountMinor,
          method: "BANK_TRANSFER",
          beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
          isAdvance: true,
        });

        await claimBankTransaction(t, tx.id, {
          category: "SUPPLIER",
          matchedPaymentId: id,
          matchStatus: "MATCHED",
          matchDisposition: "AUTO",
          matchOutcome: "ADVANCE",
          lifecycle: "POSTED",
          supplierId,
        });

        await t.insert(decisionHistory).values({
          bankTransactionId: tx.id,
          event: "MATCH_CONFIRMED",
          actor: "HUMAN",
          actorId: user.id,
          detail: "دفعةٌ مقدَّمة لمورّد — رصيدٌ ينتظر فاتورته",
          payload: { الدفعة: id, المورّد: supplierId, المبلغ: tx.amountMinor },
        });

        await recordAudit({
          actorId: user.id,
          action: "PAYMENT_RECORDED",
          entityType: "bank_transaction",
          entityId: tx.id,
          after: { الفعل: "قُيّدت دفعةً مقدَّمة", الدفعة: id, المورّد: supplierId, المبلغ_بالهللات: tx.amountMinor },
        }, t);
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
        payload: { الباب: kind.category, "الباب السابق": tx.category },
      });

      await resyncBankExpenses(t, user.id, { transactionIds: [tx.id], insertMissing: true });

      await recordAudit({
        actorId: user.id,
        action: "MATCH_REJECTED",
        entityType: "bank_transaction",
        entityId: tx.id,
        before: { الباب: tx.category, القرار: tx.matchDisposition },
        after: { الفعل: "أُعلنت ليست سداد فاتورة", السبب: kind.label },
      }, t);
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
    /* المورّد من الحركات وحدها — لا من جسم الطلب: كان `supplierId` المُرسَل يحوّل تحويلاً شخصيّاً رصيداً عند مورّدٍ يختاره الطالب */
    const suppliers = new Set(group.map((g) => g.supplierId ?? ""));
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
        { error: `${already.length} من هذه الحركات سُجّلت سداداً بالفعل` },
        { status: 409 },
      );
    }

    return await settleAccounts(user.id, group, supplierId);
  }

  /*
    كان هنا فرعان: «قبولُ مطابقةٍ بفواتير يسمّيها الطلب» و«توزيعٌ يدويّ».
    لا شاشة تستدعيهما، وكانا يقيّدان حركةً **واردة** سداداً لفاتورة، ويقيّدان
    حوالةَ مورّدٍ على فاتورة مورّدٍ آخر ويعيدان كتابة مورّد الحركة — خلافاً
    لـ«المال الداخل ليس سداداً». فحُذفا. والتأكيد يمرّ بـ match-confirm-bulk
    (يعيد الحساب في الخادم)، والسداد على الحساب بـ settleSupplier أعلاه.
  */
  return NextResponse.json(
    { error: "حدّد الفعل: سدادٌ على حساب المورّد، أو «ليست سداداً»" },
    { status: 400 },
  );
}

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
        from payment_allocations pa where pa.invoice_id = ${invoices}.id), 0)`,
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
  /** دفعاتٌ كانت مقيَّدةً من إيصالها فتُبنّيت ولم تُنسَخ. */
  let adopted = 0;
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

      /*
        وإن كانت الواقعةُ مقيَّدةً بلا حركة — من إيصالها أو بيدٍ سبقت —
        تُتبنّى ولا تُنسَخ، مخصَّصةً كانت أو لا (`recordBankPayment`).
      */
      const { id: paymentId, adopted: wasAdopted } = await recordBankPayment(t, {
        supplierId,
        paidAt: tx.valueDate,
        amountMinor: tx.amountMinor,
        method: "BANK_TRANSFER",
        beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
        /* شهر الدفعة هو الأحدث بين فواتيرها — لا شهر أوّلها */
        appliesToMonth: months.length > 0 ? months[months.length - 1] : null,
      });
      if (wasAdopted) adopted++;

      if (plan.allocations.length > 0) {
        await allocate(t, paymentId, tx.amountMinor, plan.allocations);
        for (const a of plan.allocations) {
          remaining.set(a.invoiceId, (remaining.get(a.invoiceId) ?? 0) - a.amountMinor);
        }
      }

      await claimBankTransaction(t, tx.id, {
        matchedPaymentId: paymentId,
        supplierId,
        category: "SUPPLIER",
        matchStatus: "MATCHED",
        matchDisposition: null,
        matchOutcome: plan.remainingMinor > 0 ? "SUPPLIER_ON_ACCOUNT" : "SUPPLIER_SETTLED",
        lifecycle: "POSTED",
      });

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
    action: "MATCH_CONFIRMED",
    entityType: "supplier",
    entityId: supplierId,
    after: {
      الفعل: "سدادٌ على حساب المورّد",
      حركات: paidCount,
      "فواتير سُدِّدت": invoiceCount,
      "خُصِّص": allocatedTotal,
      "بقي غير مخصَّص": unappliedTotal,
      "دفعاتٌ تُبنّيت من إيصالاتها": adopted,
      السياسة: "الأقدم أوّلاً — لا رقم فاتورة في الحوالة",
    },
  });

  const money = formatRiyalsDisplay;
  const left = [...remaining.values()].reduce((n, v) => n + Math.max(0, v), 0);

  return NextResponse.json({
    ok: true,
    settled: paidCount,
    allocated: allocatedTotal,
    unapplied: unappliedTotal,
    supplierBalanceAfter: left,
    message: invoiceCount === 0
      ? `قُيّد ${money(allocatedTotal + unappliedTotal)} على حساب المورّد — لا فاتورة مفتوحة تقابله، فبقي غير مخصَّص`
      : `سُدِّد ${money(allocatedTotal)} على ${countNoun(invoiceCount, INVOICE)} بالأقدم أوّلاً (لا رقمَ فاتورةٍ في الحوالة)`
        + (unappliedTotal > 0 ? ` · وبقي ${money(unappliedTotal)} غير مخصَّص` : "")
        + ` · رصيد المورّد بعدها ${money(left)}`
        + (adopted > 0 ? ` · و${adopted} منها كانت مقيَّدةً من إيصالها فلم تُكرَّر` : ""),
  });
}
