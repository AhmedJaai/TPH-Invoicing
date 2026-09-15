/** يصدّر دفعة الشهر ملفَّ تحويلات جماعية للبنك. */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, paymentAllocations, suppliers } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { buildPaymentRun, toBankTransferCsv, type PayableInvoice } from "@/lib/payment-run";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("payment-run", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "شهر غير صالح" }, { status: 400 });
  }

  const rows = await db
    .select({
      invoiceId: invoices.id,
      supplierId: invoices.supplierId,
      supplierName: suppliers.nameAr,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      vatMinor: invoices.vatMinor,
      taxStatus: invoices.taxStatus,
      inputVatStatus: invoices.inputVatStatus,
      allocatedMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::bigint`,
      /* ما لم يُؤرشَف لم يُقَرّ — ينتظر مراجعةً أو رُفض — فلا يدخل ملفّ التحويلات */
      needsReview: sql<boolean>`coalesce(bool_or(${documents.status} <> 'ARCHIVED'), false)`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id, suppliers.nameAr);

  const run = buildPaymentRun(
    rows.map<PayableInvoice>((r) => ({
      invoiceId: r.invoiceId,
      supplierId: r.supplierId,
      supplierName: r.supplierName ?? "غير محدَّد",
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      periodMonth: r.periodMonth,
      totalMinor: r.totalMinor,
      allocatedMinor: Number(r.allocatedMinor),
      taxStatus: r.taxStatus,
      inputVatStatus: r.inputVatStatus,
      vatMinor: r.vatMinor,
      needsReview: Boolean(r.needsReview),
    })),
    month,
  );

  /* ملفٌّ يُرفع إلى البنك فيُحوَّل به مال — تنزيلُه أثرٌ لا يُترك بلا قيد */
  await recordAudit({
    actorId: user.id,
    action: "PAYMENT_RUN_EXPORTED",
    entityType: "payment_run",
    entityId: month,
    after: { الشهر: month, "جاهز بالهللات": run.readyTotalMinor, "محجوز بالهللات": run.heldTotalMinor, مورّدون: run.ready.length },
  });

  return new NextResponse(toBankTransferCsv(run), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payment-run-${month}.csv"`,
    },
  });
}
