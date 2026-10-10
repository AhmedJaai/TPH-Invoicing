/**
 * وسم الفواتير مسدَّدة يدوياً.
 *
 * الواقع أنّ أغلب الفواتير سُدّدت قبل وجود النظام، ومطابقة كشف البنك لا
 * تلتقط كلّ شيء. فبدل أن تبقى مئة فاتورة «غير مسدَّدة» زوراً، يعتمدها المالك
 * — ويُسجَّل ذلك في سجل التدقيق باسمه لا كأنّه حقيقة مثبتة.
 *
 * ── ومن أين دُفعت؟ ──
 *
 * `source: "OWNER"` — من حساب المالك الشخصيّ أو نقداً، أي من خارج حساب
 * المقهى. وهذا غيرُ «حوالة»: لا يظهر في كشف البنك أبداً، فلا يُنتظَر له
 * توأم. وأهمّ منه: **ما كان من حوالات المقهى مخصَّصاً على هذه الفاتورة
 * يُفَكّ عنها ويُخصم من فواتير المورّد الأخرى** — لأنّ تلك الحوالات لم
 * تكن لها. وهذا ما أبقى فاتورة يوليو للكوب الذهبي مفتوحةً وقد سُدّدت.
 *
 * و`preview: true` يعرض ما سينتقل قبل أن يقع — الفعلُ الذي ينقل مالاً
 * بين فواتير يُرى قبل الإقرار.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { PaymentTwinError, allocate, createPayment } from "@/services/payment.service";
import { distributePartial, planHandPayments, type MarkPaidRest } from "@/lib/mark-paid-plan";
import { CreditError, drawBankCredit, markPaidByOwner, previewOwnerPaid } from "@/services/supplier-credit.service";
import { INVOICE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay, parseRiyals } from "@/lib/money";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  /** يوم السداد (YYYY-MM-DD) — وإن غاب فاليوم بتوقيت الرياض، لا تاريخ الفاتورة */
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD").optional(),
  /** فواتير بعينها، أو كل ما يسبق شهراً */
  invoiceIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  supplierId: z.string().trim().min(1).max(64).optional(),
  note: z.string().max(500).optional(),
  /** من أين دُفعت: حوالة من حساب المقهى (الافتراضيّ) أو من حساب المالك. */
  source: z.enum(["BANK", "OWNER"]).optional(),
  /** يُعرض ما سيقع ولا يُكتب شيء — للسداد من حساب المالك. */
  preview: z.boolean().optional(),
  /** أُقِرّ أنّ سداداً بالمورّد واليوم والمبلغ نفسها واقعةٌ أخرى (ردُّ 409 `twin`). */
  acknowledgeTwin: z.boolean().optional(),
  /**
   * «ادفع كذا فقط» — بالريال نصّاً لا عدداً عائماً. لمورّدٍ واحد (`supplierId`)،
   * ويُفحَص على المفتوح كما يُقرأ داخل المعاملة، ويُوزَّع بالأقدم أوّلاً.
   */
  partialAmount: z.string().trim().min(1).max(20).optional(),
});
type Body = z.infer<typeof Body>;

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
    user = await guard("mark-paid", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  /* ── من حساب المالك: فاتورةٌ واحدة، بمعاينةٍ ثمّ إقرار ── */
  if (body.source === "OWNER") {
    const invoiceId = body.invoiceIds?.length === 1 ? body.invoiceIds[0] : null;
    if (!invoiceId) {
      return NextResponse.json({ error: "السداد من حساب المالك يُسجَّل لفاتورةٍ واحدة في كلّ مرّة" }, { status: 400 });
    }

    try {
      if (body.preview) {
        const plan = await previewOwnerPaid(db, invoiceId);
        return NextResponse.json({ ok: true, preview: plan });
      }

      /* القيدُ والأثرُ في معاملةٍ واحدة: مالٌ يُثبَّت بلا أثرٍ في السجلّ لا يُراجَع */
      const outcome = await db.transaction(async (tx) => {
        const out = await markPaidByOwner(tx, invoiceId);
        await recordAudit({
          actorId: user.id,
          action: "INVOICE_PAID_BY_OWNER",
          entityType: "invoice",
          entityId: invoiceId,
          after: {
            الفاتورة: out.invoiceNumber,
            سداد_المالك_بالهللات: out.ownerPaymentMinor,
            فُكّ_عنها: out.freed,
            خُصم_من: out.reapplied,
            بقي_لك_عنده_بالهللات: out.creditLeftMinor,
            ملاحظة: body.note ?? null,
            مصدر_السداد: "إقرار المالك: من حسابه الشخصيّ أو نقداً",
          },
        }, tx);
        return out;
      });

      const moved = outcome.reapplied.reduce((s, r) => s + r.amountMinor, 0);
      return NextResponse.json({
        ok: true,
        marked: 1,
        totalMinor: outcome.ownerPaymentMinor,
        message:
          `قُيّدت فاتورة ${outcome.invoiceNumber} مسدَّدةً من حسابك بـ${formatRiyalsDisplay(outcome.ownerPaymentMinor)} ريال`
          + (moved > 0 ? ` · وانتقل ${formatRiyalsDisplay(moved)} من حوالات المقهى إلى فواتيره الأخرى` : "")
          + (outcome.creditLeftMinor > 0 ? ` · وبقي لك عنده ${formatRiyalsDisplay(outcome.creditLeftMinor)}` : ""),
      });
    } catch (e) {
      if (e instanceof CreditError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  }

  /*
    ── الفواتير تُسمّى بأعيانها ──

    كان يُقبَل `throughMonth` وحده، فيُوسَم كلُّ ما شهرُه دون ذلك
    مسدَّداً — ستّ عشرة فاتورة بضغطة، بتاريخٍ وطريقةٍ لم يُقرآ من
    مستند. والإقرار بالسداد إقرارٌ عن فاتورةٍ يراها صاحبها، لا عن نطاق.
  */
  if (!body.invoiceIds?.length) {
    return NextResponse.json({ error: "حدّد الفواتير التي سُدّدت — واحدةً واحدة" }, { status: 400 });
  }
  if (body.invoiceIds.length > 50) {
    return NextResponse.json({ error: "خمسون فاتورة في المرّة الواحدة على الأكثر" }, { status: 400 });
  }
  /*
    يوم السداد لا يوم الفاتورة.

    كانت الدفعة تُؤرَّخ بتاريخ الفاتورة، والحوالة الحقيقيّة تظهر في الكشف
    بيوم خصمها — بعده بأيّام. والتوأمة تطابق اليوم، فتفوتها: الواقعة
    الواحدة تُقيَّد دفعتين، والثانية تُخصَّص على فواتير أخرى لم تُدفع.

    ويومٌ بعد اليوم يُردّ ولا يُبدَّل باليوم صامتاً — القيمةُ المبدَّلة تُقرأ جواباً.
  */
  const today = todayInRiyadh();
  if (body.paidOn && body.paidOn > today) {
    return NextResponse.json({ error: "يوم السداد لا يكون بعد اليوم — صحّح التاريخ" }, { status: 400 });
  }
  const paidOn = body.paidOn ?? today;
  const paidAt = new Date(`${paidOn}T00:00:00Z`);
  if (Number.isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "يوم السداد ليس تاريخاً صحيحاً" }, { status: 400 });
  }

  /*
    المبلغُ الجزئيّ: ما كتبه صاحبُ الدفعة يُفهَم هنا هللاتٍ صحيحة أو يُردّ — وحدُّه
    الأعلى (المفتوح) يُفحَص داخل المعاملة لا على رقمٍ جاء به المتصفّح.
  */
  let partialMinor: number | null = null;
  if (body.partialAmount !== undefined) {
    if (!body.supplierId) {
      return NextResponse.json({ error: "المبلغ الجزئيّ يُسجَّل لمورّدٍ واحد — حدّده" }, { status: 400 });
    }
    partialMinor = parseRiyals(body.partialAmount);
    if (partialMinor === null || partialMinor <= SETTLED_TOLERANCE_MINOR) {
      return NextResponse.json({ error: "المبلغ الجزئيّ ليس مبلغاً صحيحاً — اكتبه بالريال مثل 1500.00" }, { status: 400 });
    }
  }

  const invoiceIds = [...new Set(body.invoiceIds)];
  const conditions = [inArray(invoices.id, invoiceIds)];
  if (body.supplierId) conditions.push(eq(invoices.supplierId, body.supplierId));

  let marked = 0;
  let totalMinor = 0;
  /* معرّفاتُ الدفعات المكتوبة — يُعاد بها التراجعُ من الإشعار ما دام قريباً */
  const paymentIds: string[] = [];
  /* ما نُسب من حوالاتٍ في الكشف — ويُفكّ بالتراجع ولا تُلغى الحوالة */
  const drawn: { paymentId: string; invoiceId: string; amountMinor: number; paidOn: string }[] = [];
  /* مجموعُ المفتوح على المختار قبل السداد الجزئيّ — يُقال به «بقي كذا» */
  let openBeforeMinor = 0;

  try {
    await db.transaction(async (tx) => {
      /*
        القراءةُ داخل المعاملة وبقفل الصفّ: كان المتبقّي يُقرأ قبلها، فضغطتان أو
        تبويبان يحسبان الرقم نفسه ولا يردّهما إلّا مؤثِّرُ القاعدة بخطأٍ خامّ.
        الآن ينتظر الثاني حتّى يُثبَّت الأوّل، ثمّ يجدها مسدَّدة.
      */
      const locked = await tx
        .select({
          id: invoices.id,
          supplierId: invoices.supplierId,
          invoiceNumber: invoices.invoiceNumber,
          periodMonth: invoices.periodMonth,
          totalMinor: invoices.totalMinor,
        })
        .from(invoices)
        .where(and(...conditions))
        .orderBy(invoices.invoiceDate, invoices.id)
        .for("update");
      if (locked.length === 0) return;

      const sums = (await tx.execute<{ invoice_id: string; allocated: string | number }>(sql`
        select pa.invoice_id, coalesce(sum(pa.amount_minor), 0)::bigint as allocated
          from payment_allocations pa
         where pa.invoice_id in (${sql.join(locked.map((r) => sql`${r.id}`), sql`, `)})
         group by pa.invoice_id
      `)).rows;
      const allocatedBy = new Map(sums.map((r) => [r.invoice_id, Number(r.allocated)]));

      /* العتبة نفسها في كلّ شاشةٍ تقول «عليك»: ما بقي فوق هللة */
      const pending = locked
        .map((r) => ({ ...r, openMinor: r.totalMinor - (allocatedBy.get(r.id) ?? 0) }))
        .filter((r) => r.openMinor > SETTLED_TOLERANCE_MINOR);
      if (pending.length === 0) return;

      /*
        الجزئيّ: يُوزَّع على المفتوح بالأقدم أوّلاً (القفلُ مرتَّبٌ بتاريخ الفاتورة).
        وما زاد على المفتوح يُردّ بمبلغ المفتوح ولا يُقصّ — لم يُكتب شيء بعد.
      */
      let payBy: Map<string, number> | null = null;
      if (partialMinor !== null) {
        const split = distributePartial(pending.map((p) => ({ invoiceId: p.id, openMinor: p.openMinor })), partialMinor);
        if (!split.ok) throw new PartialRejected(split.openMinor);
        payBy = new Map(split.shares.map((s) => [s.invoiceId, s.payMinor]));
        openBeforeMinor = pending.reduce((s, p) => s + p.openMinor, 0);
      }
      const paying = payBy === null ? pending : pending.filter((p) => payBy.has(p.id));

      const rests: MarkPaidRest[] = [];
      for (const inv of paying) {
        let remaining = payBy?.get(inv.id) ?? inv.openMinor;
        totalMinor += remaining;
        /*
          الحوالةُ في الكشف أوّلاً: إن كان للمورّد حوالةٌ لم تُنسب فهي هذا السداد
          — وإلّا قُيِّد مرّتين (كوهي وأطلس). وما بقي بعدها يُقيَّد إقراراً.
        */
        if (inv.supplierId) {
          const d = await drawBankCredit(tx, { supplierId: inv.supplierId, invoiceId: inv.id, remainingMinor: remaining, paidOn });
          drawn.push(...d.drawn);
          remaining = d.restMinor;
        }
        if (remaining > SETTLED_TOLERANCE_MINOR) {
          rests.push({ invoiceId: inv.id, supplierId: inv.supplierId, periodMonth: inv.periodMonth, restMinor: remaining });
        }
      }

      /*
        دفعةٌ لكلّ مورّد لا لكلّ فاتورة (`planHandPayments`): الحوالةُ واحدة
        فيتبنّاها الكشفُ بمبلغها، وفاتورتان بالمبلغ نفسه لا تصيران توأمَين.

        وعبر `createPayment` لا إدراجاً باليد: فيُسأل التوأم عمّا **سبق** هذا
        الطلب (الواقعة الواحدة لا تُقيَّد دفعتين) ويُحرَس الشهر المقفل. ومن
        أقرّ أنّه سدادٌ آخر (`acknowledgeTwin`) يمضي — بيكوف يُدفَع له مرّتين.
      */
      for (const plan of planHandPayments(rests)) {
        const payId = await createPayment(tx, {
          supplierId: plan.supplierId,
          paidAt,
          amountMinor: plan.amountMinor,
          method: "BANK_TRANSFER",
          beneficiaryNameRaw: null,
          appliesToMonth: plan.appliesToMonth,
          acknowledgeTwin: body.acknowledgeTwin === true,
        });
        /*
          والتخصيص عبر `allocate` لا إدراجاً باليد: فيُحرَس شهرُ الفاتورة،
          ويُطرَح الرسم، ويُشتقّ حالُ الدفعة بعده — كان هذا المسار يُدرج
          التخصيص وينسى الحال، فبقيت دفعةٌ مخصَّصة كاملةً «غير مخصَّصة».
          وسياسةٌ تتغيّر في الخدمة تبلغ هذا الباب بلا أن يُنسَخ إليه شيء.
        */
        const out = await allocate(tx, payId, plan.allocations);
        if (out.allocatedMinor !== plan.amountMinor) {
          throw new MarkPaidRaced();
        }
        paymentIds.push(payId);
      }

      marked = paying.length;
      /* الأثرُ في المعاملة نفسها: إن سقط الطلبُ بعدها لم يبقَ مالٌ بلا سجلّ */
      await recordAudit({
        actorId: user.id,
        action: "INVOICES_MARKED_PAID",
        entityType: "invoice",
        entityId: body.supplierId ?? "manual",
        after: {
          نوع: partialMinor === null ? "وسم يدوي بالسداد" : "سدادٌ جزئيّ بقرار صاحب الدفعة",
          عدد_الفواتير: paying.length,
          المبلغ_بالهللات: totalMinor,
          ...(partialMinor === null ? {} : { المفتوح_قبله_بالهللات: openBeforeMinor, بقي_بعده_بالهللات: openBeforeMinor - totalMinor }),
          الفواتير: paying.map((p) => p.invoiceNumber),
          الدفعات: paymentIds,
          ملاحظة: body.note ?? null,
          // لم يأتِ من كشف بنك — تمييزه مهم عند أي مراجعة لاحقة
          مصدر_السداد: "إقرار المالك لا مطابقة بنكية",
          يوم_السداد: paidOn,
          أُقرّ_أنّه_سدادٌ_آخر: body.acknowledgeTwin === true,
          نُسب_من_حوالات_الكشف: drawn.map((d) => ({ الحوالة: d.paymentId, يومها: d.paidOn, بالهللات: d.amountMinor })),
        },
      }, tx);
    });
  } catch (e) {
    /*
      التوأمُ يُقال بما يُفعل فيه: الشاشةُ تعرض «سدادٌ آخر — سجّله» وتعيد الطلب
      بـ`acknowledgeTwin`. وكان يُردّ بجملةٍ ولا مخرج.
    */
    if (e instanceof PaymentTwinError) {
      return NextResponse.json({
        error: "لهذا المورّد سدادٌ مقيَّدٌ بالمبلغ نفسه في اليوم نفسه. إن كان هذا سداداً آخر فأقِرّ به، وإلّا فغيّر يوم السداد أو افتح المقيَّد.",
        twin: true,
      }, { status: 409 });
    }
    if (e instanceof PartialRejected) {
      return NextResponse.json({
        error: `المبلغ الجزئيّ أكبر من المفتوح على هذه الفواتير (${formatRiyalsDisplay(e.openMinor)} ريال) — لم يُكتب شيء. صحّح المبلغ.`,
        openMinor: e.openMinor,
      }, { status: 409 });
    }
    if (e instanceof MarkPaidRaced) {
      return NextResponse.json({ error: "تغيّر ما على هذه الفواتير أثناء الحفظ — لم يُكتب شيء. حدّث الصفحة وأعد." }, { status: 409 });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  if (marked === 0) {
    return NextResponse.json({ ok: true, marked: 0, message: "لا فواتير مفتوحة ضمن النطاق" });
  }

  const drawnMinor = drawn.reduce((s, d) => s + d.amountMinor, 0);
  const drawnDays = [...new Set(drawn.map((d) => d.paidOn))];

  return NextResponse.json({
    ok: true,
    marked,
    totalMinor,
    paymentIds,
    drawn: drawn.map((d) => ({ paymentId: d.paymentId, invoiceId: d.invoiceId })),
    ...(partialMinor === null ? {} : { partial: true, leftMinor: openBeforeMinor - totalMinor }),
    message: (partialMinor === null
      ? `سُجّل سداد ${countNoun(marked, INVOICE)} بقيمة ${formatRiyalsDisplay(totalMinor)} ريال`
      : `سُجّل سدادٌ جزئيّ ${formatRiyalsDisplay(totalMinor)} ريال على ${countNoun(marked, INVOICE)} (الأقدمُ أوّلاً) · بقي ${formatRiyalsDisplay(openBeforeMinor - totalMinor)}`)
      + (drawnMinor > 0
        ? ` · منها ${formatRiyalsDisplay(drawnMinor)} من حوالةٍ في الكشف لم تكن منسوبة (${drawnDays.map((d) => formatDay(d)).join("، ")}) — فلم تُقيَّد مرّتين`
        : ""),
  });
}

/** التخصيصُ لم يبلغ مبلغَ الدفعة — تغيّرت الفاتورةُ بين القراءة والكتابة. */
class MarkPaidRaced extends Error {}

/** المبلغُ الجزئيّ لا يصحّ على المفتوح كما قُرئ في المعاملة — يُردّ ولا يُقصّ. */
class PartialRejected extends Error {
  constructor(readonly openMinor: number) {
    super("partial rejected");
  }
}
