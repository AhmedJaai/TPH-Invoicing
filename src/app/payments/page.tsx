import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, paymentAllocations, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { buildPaymentRun, buildSupplierMessage, type PayableInvoice } from "@/lib/payment-run";
import { previousMonth } from "@/lib/filing";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "payment:approve")) {
    return (
      <PageShell user={user} active="/payments" title="دفعة أوّل الشهر">
        <Empty message="اعتماد الدفعات للمالك وحده." />
      </PageShell>
    );
  }

  const { month: raw } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(raw ?? "")
    ? raw!
    : previousMonth(new Date().toISOString().slice(0, 7));

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
      isTaxValid: invoices.isTaxValid,
      inputVatEligible: invoices.inputVatEligible,
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
      isTaxValid: r.isTaxValid,
      inputVatEligible: r.inputVatEligible,
      vatMinor: r.vatMinor,
    })),
    month,
  );

  const heldBySupplier = new Map<string, typeof run.held>();
  for (const h of run.held) {
    const list = heldBySupplier.get(h.invoice.supplierName) ?? [];
    list.push(h);
    heldBySupplier.set(h.invoice.supplierName, list);
  }

  return (
    <PageShell
      user={user}
      active="/payments"
      title={`دفعة ${month}`}
      intro="مستحقّات الشهر المنقضي مورّداً مورّداً. ما ليس فاتورة ضريبية كاملة يُحجز — السداد قبل الحصول عليها يفقدك ورقة التفاوض الوحيدة."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">جاهز للتحويل</p>
          <p className="mt-1 text-xl font-bold text-ok"><Money minor={run.readyTotalMinor} /></p>
          <p className="mt-1 text-[11px] text-muted">{run.ready.length} مورّد</p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">محجوز</p>
          <p className={`mt-1 text-xl font-bold ${run.held.length ? "text-warn" : ""}`}>
            <Money minor={run.heldTotalMinor} />
          </p>
          <p className="mt-1 text-[11px] text-muted">{run.held.length} فاتورة</p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">ضريبة معرّضة</p>
          <p className={`mt-1 text-xl font-bold ${run.vatAtRiskMinor ? "text-danger" : ""}`}>
            <Money minor={run.vatAtRiskMinor} />
          </p>
        </div>
        <div className="flex items-center rounded-xl border border-line bg-raised px-4 py-3">
          {run.ready.length > 0 ? (
            <a
              href={`/api/payment-run?month=${month}`}
              className="w-full rounded-lg bg-inverse-surface px-3 py-2 text-center text-xs font-bold text-inverse-ink"
            >
              نزّل ملف التحويلات
            </a>
          ) : (
            <span className="text-xs text-muted">لا شيء للتصدير</span>
          )}
        </div>
      </div>

      {run.ready.length === 0 && run.held.length === 0 ? (
        <div className="mt-8">
          <Empty message={`لا مستحقّات في ${month} — إمّا سُدّد كل شيء أو لم تُرفع فواتير الشهر بعد.`} />
        </div>
      ) : null}

      {run.ready.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-base font-bold">جاهز للاعتماد</h2>
          <div className="space-y-3">
            {run.ready.map((s) => (
              <article key={s.supplierId} className="rounded-xl border border-line bg-raised p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-bold">{s.supplierName}</h3>
                  <span className="text-base font-bold"><Money minor={s.totalMinor} /></span>
                </div>
                <ul className="mt-2 divide-y divide-line">
                  {s.invoices.map((i) => (
                    <li key={i.invoiceId} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="font-mono text-ink-soft" dir="ltr">
                        {i.invoiceNumber} · {i.invoiceDate.toISOString().slice(0, 10)}
                      </span>
                      <Money minor={i.totalMinor - i.allocatedMinor} />
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {run.held.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-base font-bold">محجوز حتى تُعالَج</h2>
          <p className="mb-3 text-xs text-muted">
            لا تُدرَج في ملف التحويلات. اطلب الفاتورة الصحيحة قبل السداد.
          </p>
          <div className="space-y-3">
            {[...heldBySupplier].map(([name, list]) => (
              <article key={name} className="rounded-xl border border-warn/40 bg-warn-bg p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-bold text-warn">{name}</h3>
                  <span className="text-sm font-bold text-warn">
                    <Money minor={list.reduce((s, h) => s + h.invoice.totalMinor - h.invoice.allocatedMinor, 0)} />
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {list.map((h) => (
                    <li key={h.invoice.invoiceId} className="text-xs text-ink-soft">
                      <span className="font-mono" dir="ltr">{h.invoice.invoiceNumber}</span> — {h.message}
                    </li>
                  ))}
                </ul>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(buildSupplierMessage(name, list))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block rounded-lg border border-warn/50 px-3 py-1.5 text-xs font-bold text-warn"
                >
                  رسالة واتساب جاهزة
                </a>
              </article>
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
