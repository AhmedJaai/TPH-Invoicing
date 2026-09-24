import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, paymentAllocations, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { buildPaymentRun, buildSupplierMessage, type PayableInvoice } from "@/lib/payment-run";
import { previousMonth } from "@/lib/filing";
import { MarkSupplierPaid } from "@/components/payment-run-actions";
import { countNoun, INVOICE, SUPPLIER } from "@/lib/arabic";
import { NoAccess } from "@/components/ui";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import { loadPayeeAccounts } from "@/services/payee-account.service";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payments");
  if (!can(user.role, "payment:approve")) {
    return (
      <PageShell user={user} width="wide" title="دفعة الشهر">
        <NoAccess what="اعتماد الدفعات" />
      </PageShell>
    );
  }

  const { month: raw } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(raw ?? "")
    ? raw!
    : previousMonth(currentMonthRiyadh());

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

  /* رصيدٌ لنا عند كلّ مورّد — يُخصم من دفعته فلا يُحوَّل الريال مرّتين */
  const balances = await loadSupplierBalances();
  const creditBySupplier = new Map(balances.map((b) => [b.supplierId, b.creditMinor]));

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
    /* «أدرجها في دفعة أوّل الشهر» كانت خطوةً لا تُنفَّذ: ما فات شهرُه لا يدخل الدفعة أبداً */
    { creditBySupplier, includeOlderUnpaid: true },
  );
  /* الحسابُ الذي سيحمله الملفّ — يُرى قبل التنزيل لا بعد فتحه في إكسل */
  const accounts = await loadPayeeAccounts(run.ready.map((r) => r.supplierId));

  const heldBySupplier = new Map<string, typeof run.held>();
  for (const h of run.held) {
    const list = heldBySupplier.get(h.invoice.supplierName) ?? [];
    list.push(h);
    heldBySupplier.set(h.invoice.supplierName, list);
  }

  return (
    <PageShell
      user={user}
     
      title={`دفعة الشهر — ${formatMonth(month)}`}
      intro="مستحقّات الشهر المنقضي وما تأخّر قبله، مورّداً مورّداً. ما ليس فاتورة ضريبية كاملة يُحجز — السداد قبل الحصول عليها يفقدك ورقة التفاوض الوحيدة."
    >
      {/* أربعةُ أصفارٍ فوق «لا مستحقّات» تكرارٌ لا خبر — والجملةُ تحتها تقول ما يُعرَف */}
      {(run.ready.length > 0 || run.held.length > 0 || run.coveredByCredit.length > 0) && (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">جاهز للتحويل</p>
          <p className="mt-1 text-xl font-bold text-ok"><Money minor={run.readyTotalMinor} /></p>
          <p className="mt-1 text-xs text-muted">{countNoun(run.ready.length, SUPPLIER)}</p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">محجوز</p>
          <p className={`mt-1 text-xl font-bold ${run.held.length ? "text-warn" : ""}`}>
            <Money minor={run.heldTotalMinor} />
          </p>
          <p className="mt-1 text-xs text-muted">{countNoun(run.held.length, INVOICE)}</p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">ضريبة معرّضة</p>
          <p className={`mt-1 text-xl font-bold ${run.vatAtRiskMinor ? "text-danger" : ""}`}>
            <Money minor={run.vatAtRiskMinor} />
          </p>
        </div>
        <div className="flex items-center rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
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
      )}

      {run.ready.length === 0 && run.held.length === 0 ? (
        <div className="mt-8">
          <Empty message={`لا مستحقّات في ${month} — إمّا سُدّد كل شيء أو لم تُرفع فواتير الشهر بعد.`} />
        </div>
      ) : null}

      {run.ready.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-base font-bold">جاهز للتحويل</h2>
          <div className="space-y-3">
            {run.ready.map((s) => (
              <article key={s.supplierId} className="rounded-2xl border border-line bg-raised shadow-raised p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-bold">{s.supplierName}</h3>
                  <span className="text-base font-bold"><Money minor={s.totalMinor} /></span>
                </div>
                {(() => {
                  const acc = accounts.get(s.supplierId);
                  return acc?.account ? (
                    <p className="mt-0.5 text-[11px] text-muted">
                      إلى <bdi className="font-mono" dir="ltr">{acc.account}</bdi> — من كشوف البنك
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-warn">{acc?.note ?? "الحسابُ غير معروف — أدخله في البنك"}</p>
                  );
                })()}
                <ul className="mt-2 divide-y divide-line">
                  {s.invoices.map((i) => (
                    <li key={i.invoiceId} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="text-ink-soft" dir="auto">
                        <bdi className="font-mono">{i.invoiceNumber}</bdi> · {formatDay(i.invoiceDate)}
                      </span>
                      <span className="nums-col shrink-0">
                        <Money minor={i.totalMinor - i.allocatedMinor} />
                      </span>
                    </li>
                  ))}
                </ul>
                {s.creditAppliedMinor > 0 ? (
                  <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                    خُصم <Money minor={s.creditAppliedMinor} /> رصيداً لك عنده دفعتَه ولم يُخصم من فاتورة —
                    فحوِّل الباقي وحده، ثمّ اخصم الرصيد من «تحليل الذكاء».
                  </p>
                ) : (
                  <MarkSupplierPaid
                    supplierName={s.supplierName}
                    invoiceIds={s.invoices.map((i) => i.invoiceId)}
                    totalMinor={s.totalMinor}
                  />
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {run.coveredByCredit.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-base font-bold">يغطّيها رصيدُك عندهم</h2>
          <p className="mb-3 text-xs text-muted">
            دفعتَ لهؤلاء مالاً لم يُخصم بعد، ويكفي لفواتير الشهر كلّها — فلا تحوِّل لهم شيئاً.
          </p>
          <ul className="space-y-2">
            {run.coveredByCredit.map((s) => (
              <li key={s.supplierId} className="flex items-baseline justify-between gap-3 rounded-2xl border border-ok/40 bg-ok-bg px-4 py-3 text-sm">
                <span className="font-bold">{s.supplierName}</span>
                <span className="text-xs text-ink-soft">
                  رصيدك يغطّي <Money minor={s.creditAppliedMinor} />
                </span>
              </li>
            ))}
          </ul>
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
                {/*
                  السبب يُقال مرّةً للمجموعة، لا في ذيل كل سطر.
                  كانت الجملة نفسها تتكرّر ثلاث عشرة مرّة تحت مورّدٍ واحد —
                  خمسمئة حرفٍ لا تضيف شيئاً بعد أوّل قراءة، وتُخفي أرقام
                  الفواتير وهي المطلوبة لطلب البديل.
                */}
                {(() => {
                  const reasons = [...new Set(list.map((h) => h.message))];
                  return (
                    <>
                      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {list.map((h) => (
                          <li key={h.invoice.invoiceId} className="font-mono text-xs text-ink-soft" dir="ltr">
                            {h.invoice.invoiceNumber}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                        {reasons.length === 1
                          ? reasons[0]
                          : reasons.map((r) => `• ${r}`).join(" ")}
                      </p>
                    </>
                  );
                })()}
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
