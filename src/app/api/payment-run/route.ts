/** يصدّر دفعة الشهر ملفَّ تحويلات جماعية للبنك. */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, paymentAllocations, suppliers } from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { buildPaymentRun, toBankTransferCsv, type PayableInvoice } from "@/lib/payment-run";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser("payment:approve");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
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
      allocatedMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::int`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
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
    })),
    month,
  );

  return new NextResponse(toBankTransferCsv(run), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payment-run-${month}.csv"`,
    },
  });
}
