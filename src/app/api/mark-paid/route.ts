/**
 * وسم الفواتير مسدَّدة يدوياً.
 *
 * الواقع أنّ أغلب الفواتير سُدّدت قبل وجود النظام، ومطابقة كشف البنك لا
 * تلتقط كلّ شيء. فبدل أن تبقى مئة فاتورة «غير مسدَّدة» زوراً، يعتمدها المالك
 * دفعةً واحدة — ويُسجَّل ذلك في سجل التدقيق باسمه لا كأنّه حقيقة مثبتة.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, paymentAllocations, payments } from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  /** فواتير بعينها، أو كل ما يسبق شهراً */
  invoiceIds?: string[];
  throughMonth?: string;
  supplierId?: string;
  note?: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("payment:approve");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const conditions = [];
  if (body.invoiceIds?.length) conditions.push(inArray(invoices.id, body.invoiceIds));
  if (body.throughMonth) {
    if (!/^\d{4}-\d{2}$/.test(body.throughMonth)) {
      return NextResponse.json({ error: "شهر غير صالح" }, { status: 400 });
    }
    conditions.push(lte(invoices.periodMonth, body.throughMonth));
  }
  if (body.supplierId) conditions.push(eq(invoices.supplierId, body.supplierId));

  if (conditions.length === 0) {
    return NextResponse.json({ error: "حدّد فواتير أو شهراً" }, { status: 400 });
  }

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
      totalMinor += remaining;
    }
  });

  await recordAudit({
    actorId: user.id,
    action: "INVOICES_MARKED_PAID",
    entityType: "payment_run",
    entityId: body.throughMonth ?? body.supplierId ?? "manual",
    after: {
      نوع: "وسم يدوي بالسداد",
      عدد_الفواتير: pending.length,
      المبلغ: totalMinor / 100,
      النطاق: body.throughMonth ? `حتى ${body.throughMonth}` : body.supplierId ? "مورّد بعينه" : "فواتير محدّدة",
      ملاحظة: body.note ?? null,
      // لم يأتِ من كشف بنك — تمييزه مهم عند أي مراجعة لاحقة
      مصدر_السداد: "إقرار المالك لا مطابقة بنكية",
    },
  });

  return NextResponse.json({
    ok: true,
    marked: pending.length,
    totalMinor,
    message: `وُسمت ${pending.length} فاتورة بقيمة ${(totalMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ريال`,
  });
}
