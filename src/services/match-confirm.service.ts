/**
 * قبول مطابقة، أو إعلان أنّها ليست سداد فاتورة — بابُها `/api/match-confirm`.
 *
 * هذا هو الفعل الذي كان غائباً: يقول النظام «تحتاج قرارك» ولا يعطي ما
 * يُقرَّر به. فيقف صاحب العمل أمام حركةٍ يعرف أنّها تحتاجه ولا يملك
 * فعلاً — فيتركها، فتبقى معلّقة إلى الأبد.
 *
 * والقبول يمرّ بما يمرّ به الاستيراد: تُنشأ دفعة، وتُخصَّص بقدرها، ولا
 * تتجاوز قيمةَ الدفعة ولا قيمةَ الفاتورة — تحرسه قيود القاعدة نفسها.
 *
 * نُقل من المسار كما هو (أكتوبر ٢٠٢٦): المعاملاتُ والقفلُ والنصوصُ والرموز
 * نفسها، والرفضُ أخطاءُ عملٍ (`lib/domain-error.ts`) يترجمها `respondTo`.
 */
import { z } from "zod";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, decisionHistory, invoices } from "@/db/schema";
import { AlreadyMatchedError, allocate, claimBankTransaction, recordBankPayment } from "./payment.service";
import { recordAudit } from "@/lib/audit";
import { HandLinkRefused, linkHandPayment, loadHandPaymentLinks } from "./account-review.service";
import { resyncBankExpenses } from "./expense.service";
import { settleSupplierAccount } from "@/lib/allocation";
import { INVOICE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { Conflict, NotFound, Refused } from "@/lib/domain-error";
import type { Conn } from "./types";

/** ما يُعلَن به أنّ الحركة ليست سداد فاتورة. */
const NOT_PAYMENT_KINDS = {
  ADVANCE: { category: "SUPPLIER", label: "دفعة مقدّمة لمورّد" },
  INTERNAL: { category: "INTERNAL", label: "تحويل داخلي" },
  PERSONAL: { category: "PERSONAL", label: "تحويل شخصي" },
  BANK_FEE: { category: "BANK_FEE", label: "رسم بنكيّ" },
} as const;

export const MatchConfirmBody = z.object({
  transactionId: z.string().trim().min(1).max(64).optional(),
  /** أو مجموعةٌ تُسدَّد معاً — في معاملةٍ واحدة لا خمسَ عشرة. */
  transactionIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  /** أو: ليست سداد فاتورة، وهذا سببها. */
  notAPayment: z.enum(["ADVANCE", "INTERNAL", "PERSONAL", "BANK_FEE"]).optional(),
  /** لمن دُفعت المقدَّمة، إن لم يُعرَف المورّد من الحركة. */
  supplierId: z.string().trim().min(1).max(64).optional(),
  /**
   * أو: سدادٌ **لحساب المورّد** لا لفاتورةٍ بعينها — تُوزَّع على فواتيره بالأقدم
   * أوّلاً، وما بقي يبقى غير مخصَّص — وهي حالٌ صحيحة لا نقص.
   */
  settleSupplier: z.boolean().optional(),
});
export type MatchConfirmBody = z.infer<typeof MatchConfirmBody>;

export interface MatchConfirmed {
  ok: true;
  message: string;
  settled?: number;
  allocated?: number;
  unapplied?: number;
  supplierBalanceAfter?: number;
}

export async function confirmMatch(userId: string, body: MatchConfirmBody, conn: Conn = db): Promise<MatchConfirmed> {
  if (!body.transactionId) throw new Refused("حدّد الحركة");

  const [tx] = await conn
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, body.transactionId));

  if (!tx) throw new NotFound("هذه الحركة غير موجودة");
  if (tx.matchedPaymentId) {
    /*
      ضغطةٌ ثانية بعد انقطاعٍ نجح فيه الطلب الأوّل ليست خطأً من صاحبها.
      وكان يُقال له «تراجع عنها أوّلاً» — فيُدفَع إلى هدم عملٍ صحيح. فإن
      كان هو من قيّدها في الدقائق الأخيرة، يُقال له إنّها قُيّدت.
    */
    const [recent] = await conn
      .select({ at: decisionHistory.createdAt })
      .from(decisionHistory)
      .where(and(
        eq(decisionHistory.bankTransactionId, tx.id),
        eq(decisionHistory.actorId, userId),
        eq(decisionHistory.event, "MATCH_CONFIRMED"),
        gte(decisionHistory.createdAt, new Date(Date.now() - 15 * 60_000)),
      ))
      .orderBy(desc(decisionHistory.createdAt))
      .limit(1);
    if (recent) {
      return { ok: true, message: "سُجّلت هذه الحركة من قبل، ولم يُضف شيء جديد" };
    }
    throw new Conflict("سُجّل لهذه الحركة سداد من قبل. افتحها في صفحة البنك لترى دفعتها.");
  }

  /*
    ── سدادٌ مقيَّدٌ بيدٍ قبل الحوالة ──

    فاتورةٌ وُسمت «سُدّدت» فأُغلقت، ثمّ جاءت حوالتُها. فإقرارُها سداداً (لفاتورة
    أو لحساب المورّد) كان يُنشئ دفعةً ثانية بجانب الأولى — ورونة يصير مدفوعاً له
    ٨٩٩ عن ٤٦٢. فتُربط الحوالةُ بتلك الدفعة، ولا يُكتب غيرُ ذلك.
  */
  if (!body.notAPayment) {
    const link = (await loadHandPaymentLinks(conn)).find((l) => l.transferId === tx.id);
    /*
      (حقلا `invoiceIds` و`split` حُذفا من الطلب: بقيا بعد حذف فرعيهما، فكان
      الطلبُ يقبل توزيعاً بمبالغ ثمّ يتجاهله بصمت. واختيارُ فاتورةٍ بعينها
      يمرّ بـmatch-confirm-bulk ويتحقّق منه الخادم.)
    */
    if (link) {
      try {
        await conn.transaction((t) => linkHandPayment(t, link, userId));
      } catch (e) {
        if (e instanceof HandLinkRefused) throw new Conflict(e.message);
        throw e;
      }
      return {
        ok: true,
        message: `رُبطت بسداد سجّلته بنفسك (${formatRiyalsDisplay(link.paymentMinor)}${link.invoices[0] ? ` · ${link.invoices[0].number}` : ""})، ولم تُنشأ دفعة ثانية`
          + (link.extraMinor > 0 ? ` · وزاد رصيدك عند المورّد ${formatRiyalsDisplay(link.extraMinor)}` : ""),
      };
    }
  }

  /* ── ليست سداد فاتورة ── */
  if (body.notAPayment) {
    const kind = NOT_PAYMENT_KINDS[body.notAPayment];
    if (!kind) throw new Refused("سبب غير معروف");

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
        throw new Refused("الدفعة المقدّمة تحتاج إلى مورّد. حدّد المورّد الذي دفعت له.");
      }

      await conn.transaction(async (t) => {
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
          /* بابٌ أقرّه إنسانٌ بضغطته — ولا يبقى مصدرُه «مجهولاً» بجانبه */
          classificationSource: "HUMAN",
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
          actorId: userId,
          detail: "دفعة مقدّمة لمورّد — رصيد ينتظر فاتورته",
          payload: { الدفعة: id, المورّد: supplierId, المبلغ: tx.amountMinor },
        });

        await recordAudit({
          actorId: userId,
          action: "PAYMENT_RECORDED",
          entityType: "bank_transaction",
          entityId: tx.id,
          after: { الفعل: "قيّدت دفعةً مقدّمة", الدفعة: id, المورّد: supplierId, المبلغ_بالهللات: tx.amountMinor },
        }, t);
      });

      return { ok: true, message: "سُجّلت دفعة مقدّمة، وتُخصم من فاتورة المورّد حين تصل" };
    }

    await conn.transaction(async (t) => {
      /*
        بشرط ألّا تكون قُيّدت بين القراءة والكتابة: كان الشرطُ المعرّفَ وحده،
        فحركةٌ قُيّدت سداداً من تبويبٍ آخر تصير «متجاهَلة» ومعها دفعتُها —
        ويُشتقّ لها مصروفٌ فوق السداد. والرميُ يُلغي المعاملة كلَّها (409).
      */
      const declared = await t
        .update(bankTransactions)
        .set({
          category: kind.category,
          /* بابٌ أقرّه إنسانٌ بضغطته — ولا يبقى مصدرُه مصدرَ القاعدة بجانبه */
          classificationSource: "HUMAN",
          matchStatus: "IGNORED",
          matchDisposition: null,
          matchOutcome: "NOT_A_PAYMENT",
          /* «ليست سداداً» إقرارٌ تامّ لا نقص — فلا تبقى في المعلَّق */
          lifecycle: "CONFIRMED",
        })
        .where(and(
          eq(bankTransactions.id, tx.id),
          sql`${bankTransactions.matchedPaymentId} is null`,
        ))
        .returning({ id: bankTransactions.id });
      if (declared.length === 0) throw new AlreadyMatchedError();

      await t.insert(decisionHistory).values({
        bankTransactionId: tx.id,
        event: "MATCH_REJECTED",
        actor: "HUMAN",
        actorId: userId,
        detail: `أعلنت ليست سداد فاتورة: ${kind.label}`,
        payload: { الباب: kind.category, "الباب السابق": tx.category, "المصدر السابق": tx.classificationSource },
      });

      await resyncBankExpenses(t, userId, { transactionIds: [tx.id], insertMissing: true });

      await recordAudit({
        actorId: userId,
        action: "MATCH_REJECTED",
        entityType: "bank_transaction",
        entityId: tx.id,
        before: { الباب: tx.category, القرار: tx.matchDisposition },
        after: { الفعل: "أعلنت ليست سداد فاتورة", السبب: kind.label },
      }, t);
    });

    return { ok: true, message: `حُفظ: ${kind.label}` };
  }

  /* ── سدادٌ على حساب المورّد ── */
  if (body.settleSupplier) {
    const ids = [...new Set([
      ...(Array.isArray(body.transactionIds) ? body.transactionIds : []),
      tx.id,
    ])];

    const group = await conn
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
      throw new Refused("لا يمكن تسجيل سداد على الحساب دون مورّد واحد تُجمع عليه الحركات");
    }
    if (group.some((g) => g.direction !== "DEBIT")) {
      throw new Refused("المبلغ الداخل لا يُسجَّل سداداً لمورّد");
    }
    const already = group.filter((g) => g.matchedPaymentId !== null);
    if (already.length > 0) {
      throw new Conflict(`سُجّل سداد لـ${already.length} من هذه الحركات من قبل`);
    }

    return await settleAccounts(conn, userId, group, supplierId);
  }

  /*
    كان هنا فرعان: «قبولُ مطابقةٍ بفواتير يسمّيها الطلب» و«توزيعٌ يدويّ».
    لا شاشة تستدعيهما، وكانا يقيّدان حركةً **واردة** سداداً لفاتورة، ويقيّدان
    حوالةَ مورّدٍ على فاتورة مورّدٍ آخر ويعيدان كتابة مورّد الحركة — خلافاً
    لـ«المال الداخل ليس سداداً». فحُذفا. والتأكيد يمرّ بـ match-confirm-bulk
    (يعيد الحساب في الخادم)، والسداد على الحساب بـ settleSupplier أعلاه.
  */
  throw new Refused("حدّد الإجراء: سداد على حساب المورّد، أو «ليست سداداً»");
}

async function settleAccounts(
  conn: Conn,
  userId: string,
  group: (typeof bankTransactions.$inferSelect)[],
  supplierId: string,
): Promise<MatchConfirmed> {
  let paidCount = 0;
  /** دفعاتٌ كانت مقيَّدةً من إيصالها فتُبنّيت ولم تُنسَخ. */
  let adopted = 0;
  let allocatedTotal = 0;
  let unappliedTotal = 0;
  let invoiceCount = 0;

  const ordered = [...group].sort(
    (a, b) => a.valueDate.getTime() - b.valueDate.getTime());
  let left = 0;

  await conn.transaction(async (t) => {
    /*
      قفلٌ على المورّد، ثمّ قراءةُ المفتوح **بعده وبمقبض المعاملة**.

      كان المتبقّي يُحسَب قبل المعاملة وبلا قفل: طلبان متزامنان للمورّد نفسه
      يخطّطان على الصورة نفسها، فيسقط أحدهما بمؤثِّر ٠٢٦ خطأَ قاعدةٍ غيرَ
      مترجَم. والثاني ينتظر الآن حتّى يودَع الأوّل ثمّ يخطّط على ما بقي.
    */
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`supplier-settle:${supplierId}`}))`);

    const open = (await t
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
        /* بابٌ أقرّه إنسانٌ بضغطته — ولا يبقى مصدرُه «مجهولاً» بجانبه */
        classificationSource: "HUMAN",
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
          ? "سداد على حساب المورّد — لا رقم فاتورة في الحوالة، فوزّع بالأقدم أوّلاً"
          : "سداد على حساب المورّد — لا فاتورة مفتوحة تقابله",
        payload: {
          المبلغ: tx.amountMinor,
          "فواتير سدّدت": plan.allocations.length,
          "خصّص": plan.allocatedMinor,
          "بقي غير مخصّص": plan.remainingMinor,
          السياسة: "الأقدم أوّلاً",
        },
      });

      paidCount++;
      allocatedTotal += plan.allocatedMinor;
      unappliedTotal += plan.remainingMinor;
      invoiceCount += plan.allocations.length;
    }

    left = [...remaining.values()].reduce((n, v) => n + Math.max(0, v), 0);

    /* أثرُ التدقيق داخل معاملة المال — إن سقط سقطت معه ولا يبقى مالٌ بلا أثر */
    await recordAudit({
      actorId: userId,
      action: "MATCH_CONFIRMED",
      entityType: "supplier",
      entityId: supplierId,
      after: {
        الفعل: "سداد على حساب المورّد",
        حركات: paidCount,
        "فواتير سدّدت": invoiceCount,
        "خصّص": allocatedTotal,
        "بقي غير مخصّص": unappliedTotal,
        "دفعات تبنّيت من إيصالاتها": adopted,
        السياسة: "الأقدم أوّلاً — لا رقم فاتورة في الحوالة",
      },
    }, t);
  });

  const money = formatRiyalsDisplay;

  return {
    ok: true,
    settled: paidCount,
    allocated: allocatedTotal,
    unapplied: unappliedTotal,
    supplierBalanceAfter: left,
    message: invoiceCount === 0
      ? `سُجّل ${money(allocatedTotal + unappliedTotal)} على حساب المورّد، وبقي غير مخصّص لأنه لا فاتورة مفتوحة تقابله`
      : `سُدّد ${money(allocatedTotal)} على ${countNoun(invoiceCount, INVOICE)} بالأقدم أولاً (لا رقم فاتورة في الحوالة)`
        + (unappliedTotal > 0 ? ` · ويبقى ${money(unappliedTotal)} غير مخصّص` : "")
        + ` · رصيد المورّد بعدها ${money(left)}`
        + (adopted > 0 ? ` · و${adopted} منها كانت مسجّلة من إيصالها، فلم تُسجَّل مرة ثانية` : ""),
  };
}
