import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoiceLines, invoices, paymentAllocations, statements, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import {
  buildAging, findSameNameCandidates, paymentStatus, spendByMonth, summarizeItems, vatAtRisk,
  type LineRow,
} from "@/lib/analytics";
import { buildInsights, SEVERITY_LABEL, type InsightSeverity } from "@/lib/insights";
import { previousMonth } from "@/lib/filing";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<InsightSeverity, string> = {
  critical: "border-danger/40 bg-danger-bg",
  warning: "border-warn/40 bg-warn-bg",
  opportunity: "border-ok/40 bg-ok-bg",
  info: "border-line bg-raised",
};

const SEVERITY_TEXT: Record<InsightSeverity, string> = {
  critical: "text-danger",
  warning: "text-warn",
  opportunity: "text-ok",
  info: "text-ink-soft",
};

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold leading-none ${cls}`}>{value}</p>
      {sub && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

/** شريط أفقي بسيط — أوضح من رسم بياني على شاشة جوال. */
function Bar({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-medium"><Money minor={value} /></span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="mt-0.5 text-[10px] text-muted">{note}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "reports:view")) {
    return (
      <PageShell user={user} active="/dashboard" title="لوحة القيادة">
        <Empty message="دورك لا يشمل التقارير المالية، فهذه الصفحة محجوبة عنك." />
      </PageShell>
    );
  }

  const asOf = new Date();

  const invoiceRows = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      supplierName: suppliers.nameAr,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      vatMinor: invoices.vatMinor,
      taxStatus: invoices.taxStatus,
      inputVatStatus: invoices.inputVatStatus,
      isFixedAsset: invoices.isFixedAsset,
      postedToAccounting: invoices.postedToAccounting,
      allocatedMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::int`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id, suppliers.nameAr);

  if (invoiceRows.length === 0) {
    return (
      <PageShell
        user={user}
        active="/dashboard"
        title="لوحة القيادة"
        intro="مؤشّرات مشترياتك وتوصيات مبنيّة على بياناتك أنت."
      >
        <Empty message="لا توجد بيانات بعد. ارفع فواتيرك أو رحّل الأرشيف القائم، وستمتلئ هذه الصفحة تلقائياً." />
      </PageShell>
    );
  }

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
    .limit(20000);

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

  const withStatus = invoiceRows.map((r) => ({
    ...r,
    status: paymentStatus({ invoiceId: r.id, totalMinor: r.totalMinor, allocatedMinor: Number(r.allocatedMinor) }),
  }));

  const aging = buildAging(
    withStatus
      .filter((r) => r.status.remainingMinor > 0 && r.supplierId)
      .map((r) => ({
        supplierId: r.supplierId!,
        supplierName: r.supplierName ?? "—",
        invoiceDate: r.invoiceDate,
        outstandingMinor: r.status.remainingMinor,
      })),
    asOf,
  );

  const monthly = spendByMonth(invoiceRows.map((r) => ({ periodMonth: r.periodMonth, totalMinor: r.totalMinor })));
  const vat = vatAtRisk(
    invoiceRows.map((r) => ({
      invoiceId: r.id,
      supplierName: r.supplierName ?? "—",
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      vatMinor: r.vatMinor,
      inputVatStatus: r.inputVatStatus,
    })),
  );

  const noContract = await db
    .select({ nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(sql`${suppliers.issuesInvoices} = false and ${suppliers.contractOnFile} = false and ${suppliers.isActive} = true`);

  // مورّدون نشطون لهم فواتير هذا الشهر ولم يصل كشفهم عن الشهر السابق
  const lastMonth = previousMonth(new Date().toISOString().slice(0, 7));
  const statementRows = await db
    .select({ supplierId: statements.supplierId, periodEnd: statements.periodEnd })
    .from(statements);
  const haveStatement = new Set(
    statementRows.filter((s) => s.periodEnd.toISOString().slice(0, 7) === lastMonth).map((s) => s.supplierId),
  );
  const activeSuppliers = new Map(
    invoiceRows.filter((r) => r.supplierId).map((r) => [r.supplierId!, r.supplierName ?? "—"]),
  );
  const missingStatement = [...activeSuppliers.entries()]
    .filter(([id]) => !haveStatement.has(id))
    .map(([, name]) => name)
    .slice(0, 8);

  const unpaid = withStatus.filter((r) => r.status.state !== "PAID");
  const unpaidTotal = unpaid.reduce((s, r) => s + Math.max(0, r.status.remainingMinor), 0);
  const sameName = findSameNameCandidates(items);
  const totalSpend = invoiceRows.reduce((s, r) => s + r.totalMinor, 0);
  const thisMonth = monthly[monthly.length - 1];

  const asRef = (r: typeof withStatus[number]) => ({
    invoiceId: r.id,
    supplierName: r.supplierName ?? "—",
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    amountMinor: r.totalMinor,
  });

  const insights = buildInsights({
    items,
    sameNameCandidates: sameName,
    aging,
    monthlySpend: monthly,
    vatAtRiskMinor: vat.atRiskMinor,
    vatAtRiskCount: vat.atRiskCount,
    notTaxValidCount: withStatus.filter((r) => r.taxStatus === "INVALID").length,
    unpaidTotalMinor: unpaidTotal,
    unpaidCount: unpaid.length,
    unpostedCount: withStatus.filter((r) => !r.postedToAccounting).length,
    fixedAssetCount: withStatus.filter((r) => r.isFixedAsset).length,
    // الأدلّة: الصفوف نفسها التي بُنيت عليها الأرقام
    vatAtRiskInvoices: vat.rows.map((r) => ({
      invoiceId: r.invoiceId, supplierName: r.supplierName,
      invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate,
      amountMinor: r.vatMinor ?? 0, note: "ضريبة لا تُخصم",
    })),
    notTaxValidInvoices: withStatus.filter((r) => r.taxStatus === "INVALID").map(asRef),
    unpaidInvoices: unpaid.map((r) => ({ ...asRef(r), amountMinor: Math.max(0, r.status.remainingMinor) })),
    unpostedInvoices: withStatus.filter((r) => !r.postedToAccounting).map(asRef),
    fixedAssetInvoices: withStatus.filter((r) => r.isFixedAsset).map(asRef),
    suppliersWithoutContract: noContract.map((s) => s.nameAr),
    suppliersMissingStatement: missingStatement,
    duplicatePaymentCount: 0,
    asOf,
  });

  // أعلى المورّدين إنفاقاً
  const bySupplier = new Map<string, number>();
  for (const r of invoiceRows) {
    const name = r.supplierName ?? "غير محدَّد";
    bySupplier.set(name, (bySupplier.get(name) ?? 0) + r.totalMinor);
  }
  const topSuppliers = [...bySupplier.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxSupplier = topSuppliers[0]?.[1] ?? 0;
  const maxMonth = Math.max(...monthly.map((m) => m.totalMinor), 1);

  const [{ archived }] = await db
    .select({ archived: sql<number>`count(*)::int` })
    .from(documents)
    .where(eq(documents.status, "ARCHIVED"));

  return (
    <PageShell
      user={user}
      active="/dashboard"
      title="لوحة القيادة"
      intro="مؤشّرات مشترياتك وتوصيات مبنيّة على بياناتك أنت — لا على قواعد عامة."
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={`مشتريات ${thisMonth?.month ?? "الشهر"}`}
          value={<Money minor={thisMonth?.totalMinor ?? 0} />}
          sub={`${thisMonth?.invoiceCount ?? 0} فاتورة`}
        />
        <Kpi
          label="الرصيد المستحق"
          value={<Money minor={unpaidTotal} />}
          sub={`${unpaid.length} فاتورة غير مسدَّدة`}
          tone={unpaidTotal > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="ضريبة مدخلات معرّضة"
          value={<Money minor={vat.atRiskMinor} />}
          sub={
            vat.unknownCount > 0
              ? `${vat.atRiskCount} فاتورة غير صالحة · ${vat.unknownCount} لم تُقرأ`
              : `${vat.atRiskCount} فاتورة غير صالحة`
          }
          tone={vat.atRiskMinor > 0 ? "danger" : "ok"}
        />
        <Kpi
          label="أسماء تتكرّر عند مورّدين"
          value={String(sameName.length)}
          sub="للمراجعة — تطابق الاسم لا يعني تطابق الصنف"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="إجمالي المشتريات" value={<Money minor={totalSpend} />} sub={`${invoiceRows.length} فاتورة`} />
        <Kpi label="أصناف مختلفة" value={String(items.length)} sub="مجمَّعة بعد توحيد الأسماء" />
        <Kpi label="مستندات مؤرشفة" value={String(archived)} sub="في الدرايف" />
        <Kpi
          label="ضريبة قابلة للاسترداد"
          value={<Money minor={vat.recoverableMinor} />}
          sub="من فواتير ضريبية كاملة"
          tone="ok"
        />
      </div>

      {/* ── التوصيات ── */}
      <section className="mt-10">
        <h2 className="mb-1 text-base font-bold">ما ينبغي فعله</h2>
        <p className="mb-3 text-xs text-muted">
          مرتّبة بالأهمّ فالأكبر أثراً مالياً. كل توصية مبنيّة على فواتيرك.
        </p>
        {insights.length === 0 ? (
          <Empty message="لا توصيات — بياناتك نظيفة." />
        ) : (
          <div className="space-y-2.5">
            {insights.map((n) => (
              <article key={n.id} className={`rounded-xl border p-4 ${SEVERITY_STYLE[n.severity]}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-bold leading-snug">{n.title}</h3>
                  <span className={`shrink-0 text-[10px] font-bold ${SEVERITY_TEXT[n.severity]}`}>
                    {SEVERITY_LABEL[n.severity]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{n.detail}</p>
                <p className="mt-2 text-xs leading-relaxed">
                  <span className="font-bold">الخطوة التالية: </span>
                  {n.action}
                </p>

                {/* التوصية بلا دليلها دعوى — فالدليل تحتها، يُفتح بضغطة */}
                {n.evidence.length > 0 && (
                  <details className="group mt-2.5">
                    <summary className="cursor-pointer list-none text-[11px] font-bold underline underline-offset-4 opacity-80 hover:opacity-100">
                      اعرض التفاصيل ({n.evidence.length + (n.evidenceMore ?? 0)})
                    </summary>
                    <ul className="mt-2 divide-y divide-line/60 rounded-lg border border-line/60 bg-surface/60">
                      {n.evidence.map((e, i) => (
                        <li key={i} className="flex items-start justify-between gap-3 px-3 py-1.5">
                          <span className="min-w-0">
                            <span className="block truncate text-[11px] font-medium">{e.label}</span>
                            {e.sub && (
                              <span className="block truncate text-[10px] text-muted">{e.sub}</span>
                            )}
                            {e.note && (
                              <span className="block text-[10px] text-muted">{e.note}</span>
                            )}
                          </span>
                          {e.amountMinor !== undefined && (
                            <span className="shrink-0 text-[11px] font-bold">
                              <Money minor={e.amountMinor} />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {(n.evidenceMore ?? 0) > 0 && (
                      <p className="mt-1 text-[10px] text-muted">
                        وأكبرها معروض — بقي {n.evidenceMore} غيرها.
                      </p>
                    )}
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-base font-bold">المصروف الشهري</h2>
          <div className="space-y-3 rounded-xl border border-line bg-raised p-4">
            {monthly.map((m) => (
              <Bar key={m.month} label={m.month} value={m.totalMinor} max={maxMonth} note={`${m.invoiceCount} فاتورة`} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold">أعلى المورّدين</h2>
          <div className="space-y-3 rounded-xl border border-line bg-raised p-4">
            {topSuppliers.map(([name, total]) => (
              <Bar key={name} label={name} value={total} max={maxSupplier} />
            ))}
          </div>
        </section>
      </div>

      {aging.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-base font-bold">أعمار الذمم</h2>
          <p className="mb-3 text-xs text-muted">المستحقّ لكل مورّد موزّعاً على عمر الدين.</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">المورّد</th>
                  <th className="px-3 py-2 text-right font-medium">أقل من ٣٠</th>
                  <th className="px-3 py-2 text-right font-medium">٣٠–٥٩</th>
                  <th className="px-3 py-2 text-right font-medium">٦٠–٨٩</th>
                  <th className="px-3 py-2 text-right font-medium">٩٠+</th>
                  <th className="px-3 py-2 text-right font-medium">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {aging.map((a) => (
                  <tr key={a.supplierId}>
                    <td className="px-3 py-2.5 font-medium">{a.supplierName}</td>
                    <td className="px-3 py-2.5"><Money minor={a.buckets.current} /></td>
                    <td className="px-3 py-2.5"><Money minor={a.buckets.d30} /></td>
                    <td className="px-3 py-2.5"><Money minor={a.buckets.d60} tone={a.buckets.d60 > 0 ? "warn" : undefined} /></td>
                    <td className="px-3 py-2.5">
                      <Money minor={a.buckets.d90 + a.buckets.older} tone={a.buckets.d90 + a.buckets.older > 0 ? "danger" : undefined} />
                    </td>
                    <td className="px-3 py-2.5 font-bold"><Money minor={a.totalMinor} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PageShell>
  );
}
