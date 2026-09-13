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
import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, paymentAllocations, payments } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { refreshPaymentStatus } from "@/services/payment.service";
import { CreditError, markPaidByOwner, previewOwnerPaid } from "@/services/supplier-credit.service";
import { INVOICE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  /** فواتير بعينها، أو كل ما يسبق شهراً */
  invoiceIds?: string[];
  supplierId?: string;
  note?: string;
  /** من أين دُفعت: حوالة من حساب المقهى (الافتراضيّ) أو من حساب المالك. */
  source?: "BANK" | "OWNER";
  /** يُعرض ما سيقع ولا يُكتب شيء — للسداد من حساب المالك. */
  preview?: boolean;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("mark-paid", "payment:approve");
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

      const outcome = await db.transaction((tx) => markPaidByOwner(tx, invoiceId));

      await recordAudit({
        actorId: user.id,
        action: "INVOICE_PAID_BY_OWNER",
        entityType: "invoice",
        entityId: invoiceId,
        after: {
          الفاتورة: outcome.invoiceNumber,
          سداد_المالك_بالهللات: outcome.ownerPaymentMinor,
          فُكّ_عنها: outcome.freed,
          خُصم_من: outcome.reapplied,
          بقي_لك_عنده_بالهللات: outcome.creditLeftMinor,
          ملاحظة: body.note ?? null,
          مصدر_السداد: "إقرار المالك: من حسابه الشخصيّ أو نقداً",
        },
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
  const conditions = [inArray(invoices.id, body.invoiceIds)];
  if (body.supplierId) conditions.push(eq(invoices.supplierId, body.supplierId));

  // ما بقي منه شيء غير مسدَّد فقط
  const rows = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      allocated: sql<number>`coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0)`,
    })
    .from(invoices)
    .where(and(...conditions));

  const pending = rows.filter((r) => r.totalMinor - Number(r.allocated) > 1);
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, marked: 0, message: "لا فواتير مفتوحة ضمن النطاق" });
  }

  let totalMinor = 0;

  await db.transaction(async (tx) => {
    for (const inv of pending) {
      const remaining = inv.totalMinor - Number(inv.allocated);
      const [pay] = await tx
        .insert(payments)
        .values({
          supplierId: inv.supplierId,
          paidAt: inv.invoiceDate,
          amountMinor: remaining,
          method: "BANK_TRANSFER",
          beneficiaryNameRaw: null,
          appliesToMonth: inv.periodMonth,
        })
        .returning({ id: payments.id });

      await tx.insert(paymentAllocations).values({
        paymentId: pay.id,
        invoiceId: inv.id,
        amountMinor: remaining,
      });

      /*
        الحال يُشتقّ بعد التخصيص، ولا يُترك على قيمته الافتراضية.

        كان هذا المسار يُدرج الدفعة وتخصيصها ثمّ ينصرف، فيبقى
        `status = 'UNAPPLIED'` على دفعةٍ خُصّصت بالكامل — فتقول بوّابة
        الإنتاج «حالُها يخالف تخصيصاتها»، وهي محقّة.
      */
      await refreshPaymentStatus(tx, pay.id);

      totalMinor += remaining;
    }
  });

  await recordAudit({
    actorId: user.id,
    action: "INVOICES_MARKED_PAID",
    entityType: "payment_run",
    entityId: body.supplierId ?? "manual",
    after: {
      نوع: "وسم يدوي بالسداد",
      عدد_الفواتير: pending.length,
      المبلغ: totalMinor / 100,
      الفواتير: pending.map((p) => p.invoiceNumber),
      ملاحظة: body.note ?? null,
      // لم يأتِ من كشف بنك — تمييزه مهم عند أي مراجعة لاحقة
      مصدر_السداد: "إقرار المالك لا مطابقة بنكية",
    },
  });

  return NextResponse.json({
    ok: true,
    marked: pending.length,
    totalMinor,
    message: `وُسمت ${countNoun(pending.length, INVOICE)} بقيمة ${(totalMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ريال`,
  });
}
