import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, paymentAllocations, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { paymentStatus, summarizeItems, vatAtRisk, type LineRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

const STATE_STYLE = {
  PAID: { label: "مسدَّدة", cls: "bg-ok-bg text-ok" },
  PARTIAL: { label: "مسدَّدة جزئياً", cls: "bg-warn-bg text-warn" },
  UNPAID: { label: "غير مسدَّدة", cls: "bg-sunken text-ink-soft" },
  OVERPAID: { label: "دفع زائد", cls: "bg-danger-bg text-danger" },
} as const;

function Card({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${cls}`}>{value}</p>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

export default async function AuditPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} active="/audit" title="التدقيق">
        <Empty message="دورك لا يشمل الأرقام المالية، فهذه الصفحة محجوبة عنك." />
      </PageShell>
    );
  }

  // الفواتير مع ما خُصّص لها من مدفوعات
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      vatMinor: invoices.vatMinor,
      isTaxValid: invoices.isTaxValid,
      inputVatEligible: invoices.inputVatEligible,
      isFixedAsset: invoices.isFixedAsset,
      postedToAccounting: invoices.postedToAccounting,
      supplierName: suppliers.nameAr,
      allocatedMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::int`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id, suppliers.nameAr)
    .orderBy(desc(invoices.invoiceDate))
    .limit(500);

  const lineRows = await db
    .select({
      normalizedDescription: invoiceLines.normalizedDescription,
      description: invoiceLines.description,
      supplierId: invoiceLines.supplierId,
      supplierName: suppliers.nameAr,
      invoiceDate: invoiceLines.invoiceDate,
      quantity: invoiceLines.qty,
      unitPriceMinor: invoiceLines.unitPriceMinor,
      lineTotalMinor: invoiceLines.lineTotalMinor,
    })
    .from(invoiceLines)
    .leftJoin(suppliers, eq(invoiceLines.supplierId, suppliers.id))
    .limit(5000);

  const items = summarizeItems(
    lineRows.map<LineRow>((r) => ({
      normalizedDescription: r.normalizedDescription,
      description: r.description,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      invoiceDate: r.invoiceDate,
      quantity: Number(r.quantity),
      unitPriceMinor: r.unitPriceMinor,
      lineTotalMinor: r.lineTotalMinor,
    })),
  );

  const priceMoves = items
    .filter((i) => i.priceChange && Math.abs(i.priceChange.deltaRatio) >= 0.03)
    .sort((a, b) => Math.abs(b.priceChange!.deltaRatio) - Math.abs(a.priceChange!.deltaRatio))
    .slice(0, 25);

  const withStatus = rows.map((r) => ({
    ...r,
    status: paymentStatus({ invoiceId: r.id, totalMinor: r.totalMinor, allocatedMinor: Number(r.allocatedMinor) }),
  }));

  const unpaid = withStatus.filter((r) => r.status.state !== "PAID");
  const unpaidTotal = unpaid.reduce((s, r) => s + Math.max(0, r.status.remainingMinor), 0);
  const notTaxValid = withStatus.filter((r) => !r.isTaxValid);
  const vat = vatAtRisk(
    rows.map((r) => ({
      invoiceId: r.id,
      supplierName: r.supplierName ?? "—",
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      vatMinor: r.vatMinor,
      inputVatEligible: r.inputVatEligible,
    })),
  );
  const unposted = withStatus.filter((r) => !r.postedToAccounting);
  const assets = withStatus.filter((r) => r.isFixedAsset);

  if (rows.length === 0) {
    return (
      <PageShell
        user={user}
        active="/audit"
        title="التدقيق"
        intro="فحص شامل: ما سُدّد وما لم يُسدَّد، وما يصلح لخصم المدخلات وما لا يصلح، وما تغيّر سعره."
      >
        <Empty message="لا توجد فواتير مسجّلة بعد. ارفع فواتيرك من الصفحة الرئيسية، أو رحّل الأرشيف القائم بـ npm run drive:migrate." />
      </PageShell>
    );
  }

  return (
    <PageShell
      user={user}
      active="/audit"
      title="التدقيق"
      intro="فحص شامل: ما سُدّد وما لم يُسدَّد، وما يصلح لخصم المدخلات وما لا يصلح، وما تغيّر سعره عن آخر مرة."
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="غير مسدَّد"
          value={<Money minor={unpaidTotal} />}
          note={`${unpaid.length} فاتورة`}
          tone={unpaidTotal > 0 ? "warn" : "ok"}
        />
        <Card
          label="ليست فواتير ضريبية"
          value={String(notTaxValid.length)}
          note="لا تصلح لخصم المدخلات"
          tone={notTaxValid.length > 0 ? "danger" : "ok"}
        />
        <Card
          label="ضريبة مدخلات معرّضة"
          value={<Money minor={vat.atRiskMinor} />}
          note="مبلغ قد نخسره"
          tone={vat.atRiskMinor > 0 ? "danger" : "ok"}
        />
        <Card
          label="أسعار تغيّرت"
          value={String(priceMoves.length)}
          note="صنف تحرّك سعره ٣٪ فأكثر"
          tone={priceMoves.length > 0 ? "warn" : undefined}
        />
      </div>

      {/* ── تغيّر الأسعار ── */}
      <section className="mt-10">
        <h2 className="mb-1 text-base font-bold">تغيّر أسعار الأصناف</h2>
        <p className="mb-3 text-xs text-muted">
          مقارنة سعر الوحدة في آخر فاتورة بالسعر الذي قبله لكل صنف عند مورّده.
        </p>
        {priceMoves.length === 0 ? (
          <Empty message="لم يتغيّر سعر أي صنف تغيّراً يُذكر — أو لم تُسجَّل بنود كافية بعد." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">الصنف</th>
                  <th className="px-3 py-2 text-right font-medium">السابق</th>
                  <th className="px-3 py-2 text-right font-medium">الحالي</th>
                  <th className="px-3 py-2 text-right font-medium">التغيّر</th>
                  <th className="px-3 py-2 text-right font-medium">الأثر السنوي المقدَّر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {priceMoves.map((i) => {
                  const c = i.priceChange!;
                  const up = c.direction === "up";
                  const perYear = i.averageDaysBetweenOrders
                    ? (i.totalQuantity / Math.max(1, i.orderCount)) * (365 / i.averageDaysBetweenOrders)
                    : i.totalQuantity;
                  return (
                    <tr key={i.key}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{i.displayName}</p>
                        <p className="text-[11px] text-muted">
                          {i.priceChangeSupplierName ?? "—"} · طُلب {i.orderCount} مرة
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-ink-soft"><Money minor={c.previousMinor} /></td>
                      <td className="px-3 py-2.5 font-medium"><Money minor={c.currentMinor} /></td>
                      <td className={`px-3 py-2.5 font-bold ${up ? "text-danger" : "text-ok"}`}>
                        {up ? "▲" : "▼"} {Math.abs(Math.round(c.deltaRatio * 100))}٪
                      </td>
                      <td className="px-3 py-2.5">
                        <Money minor={Math.round(c.deltaMinor * perYear)} tone={up ? "danger" : "ok"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── حالة الفواتير ── */}
      <section className="mt-10">
        <h2 className="mb-1 text-base font-bold">حالة الفواتير</h2>
        <p className="mb-3 text-xs text-muted">
          السداد يُحتسب من إيصالات مخصَّصة للفاتورة، لا من تاريخها.
        </p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-sunken text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-right font-medium">الفاتورة</th>
                <th className="px-3 py-2 text-right font-medium">المورّد</th>
                <th className="px-3 py-2 text-right font-medium">التاريخ</th>
                <th className="px-3 py-2 text-right font-medium">الإجمالي</th>
                <th className="px-3 py-2 text-right font-medium">السداد</th>
                <th className="px-3 py-2 text-right font-medium">ضريبياً</th>
                <th className="px-3 py-2 text-right font-medium">القيد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-raised">
              {withStatus.slice(0, 100).map((r) => {
                const s = STATE_STYLE[r.status.state];
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2.5 font-mono text-xs" dir="ltr">{r.invoiceNumber}</td>
                    <td className="px-3 py-2.5">{r.supplierName ?? "—"}</td>
                    <td className="nums px-3 py-2.5 text-xs text-ink-soft" dir="ltr">
                      {r.invoiceDate.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2.5"><Money minor={r.totalMinor} /></td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>
                        {s.label}
                      </span>
                      {r.status.state === "PARTIAL" && (
                        <span className="mr-1.5 text-[11px] text-muted">
                          بقي <Money minor={r.status.remainingMinor} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.isTaxValid ? (
                        <span className="text-xs text-ok">✓ كاملة</span>
                      ) : (
                        <span className="text-xs text-danger">✕ لا خصم</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.postedToAccounting ? (
                        <span className="text-ok">مقيَّدة</span>
                      ) : (
                        <span className="text-warn">لم تُقيَّد</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {withStatus.length > 100 && (
          <p className="mt-2 text-xs text-muted">تُعرض أحدث ١٠٠ فاتورة من {withStatus.length}.</p>
        )}
      </section>

      {/* ── ما يحتاج تدخّلاً ── */}
      <section className="mt-10 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-raised p-4">
          <h3 className="text-sm font-bold">فواتير بلا قيد</h3>
          <p className="mt-1 text-xs text-muted">مضى عليها وقت ولم تُقيَّد في النظام المحاسبي.</p>
          <p className="mt-2 text-2xl font-bold text-warn">{unposted.length}</p>
        </div>
        <div className="rounded-xl border border-line bg-raised p-4">
          <h3 className="text-sm font-bold">أصول ثابتة محتملة</h3>
          <p className="mt-1 text-xs text-muted">فوق ٣٬٠٠٠ ريال — تُرسمل وتُهلك ولا تُصرف.</p>
          <p className="mt-2 text-2xl font-bold">{assets.length}</p>
        </div>
      </section>

      {vat.rows.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-base font-bold">فواتير تُفقدنا خصم المدخلات</h2>
          <p className="mb-3 text-xs text-muted">
            مرتّبة بالأكبر أثراً — اطلب من هؤلاء المورّدين فاتورة ضريبية كاملة.
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {vat.rows.slice(0, 15).map((r) => (
              <li key={r.invoiceId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.supplierName}</span>
                  <span className="block font-mono text-[11px] text-muted" dir="ltr">
                    {r.invoiceNumber} · {r.invoiceDate.toISOString().slice(0, 10)}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold text-danger">
                  <Money minor={r.vatMinor} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
