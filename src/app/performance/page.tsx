import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { findSameNameCandidates, summarizeItems, type LineRow } from "@/lib/analytics";
import { buildDataHealth } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";

export const dynamic = "force-dynamic";

/**
 * الأداء: ما تدعمه البيانات الموجودة فعلاً.
 *
 * لا هامش ربح ولا تكلفة مبيعات — كلاهما يحتاج مصدر مبيعات لم يُوصَل.
 * وما لا يُدعم يُقال عنه ذلك صراحةً بدل أن يُملأ برقم يبدو دقيقاً.
 */
export default async function PerformancePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الأداء">
        <Empty message="دورك لا يشمل الأرقام المالية، فهذه الصفحة محجوبة عنك." />
      </PageShell>
    );
  }

  const rows = await db
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
    rows.map<LineRow>((r) => ({
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

  const health = buildDataHealth(await gatherHealthFacts());
  const lineCoverage = health.metrics.find((m) => m.id === "lines");

  const priceMoves = items
    .filter((i) => i.priceChange && Math.abs(i.priceChange.deltaRatio) >= 0.03)
    .sort((a, b) => Math.abs(b.priceChange!.deltaRatio) - Math.abs(a.priceChange!.deltaRatio))
    .slice(0, 25);

  const sameName = findSameNameCandidates(items);
  const totalSpend = items.reduce((s, i) => s + i.totalSpentMinor, 0);

  return (
    <PageShell
      user={user}
     
      title="الأداء"
      intro="ما تدعمه بياناتك الموجودة: الأصناف وأسعارها ومورّدوها. وما يحتاج مبيعات — الهامش والتكلفة — مذكور صراحةً أنّه غير متاح."
    >
      {/* ── ما هو غير متاح، صراحةً ── */}
      <div className="rounded-xl border border-dashed border-line px-4 py-3">
        <p className="text-xs leading-relaxed text-muted">
          <span className="font-bold text-ink-soft">غير متاح بعد: </span>
          هامش الربح · تكلفة المبيعات · ربحية الصنف · متوسّط الفاتورة — كلّها تحتاج مصدر
          مبيعات لم يُوصَل. ولن تُعرض بأرقام مقدَّرة.
        </p>
      </div>

      {lineCoverage && lineCoverage.state !== "GOOD" && (
        <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
          ⚠ أرقام هذه الصفحة مبنيّة على {lineCoverage.detail}. الباقي غير محسوب فيها.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">أصناف مختلفة</p>
          <p className="nums mt-1 text-xl font-bold">{items.length}</p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">مشتريات محسوبة بالبنود</p>
          <p className="mt-1 text-xl font-bold"><Money minor={totalSpend} /></p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">أسعار تحرّكت</p>
          <p className={`nums mt-1 text-xl font-bold ${priceMoves.length ? "text-warn" : ""}`}>
            {priceMoves.length}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">أسماء تتكرّر عند مورّدين</p>
          <p className="nums mt-1 text-xl font-bold">{sameName.length}</p>
        </div>
      </div>

      {priceMoves.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-base font-bold">تغيّر أسعار الأصناف</h2>
          <p className="mb-3 text-xs text-muted">
            سعر الوحدة في آخر فاتورة مقابل السعر الذي قبله — عند المورّد نفسه، وبعد
            الخصم والضريبة لا قبلهما.
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">الصنف</th>
                  <th className="px-3 py-2 text-right font-medium">السابق</th>
                  <th className="px-3 py-2 text-right font-medium">الحالي</th>
                  <th className="px-3 py-2 text-right font-medium">التغيّر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {priceMoves.map((i) => {
                  const c = i.priceChange!;
                  const up = c.direction === "up";
                  return (
                    <tr key={i.key}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{i.displayName}</p>
                        <p className="text-[11px] text-muted">
                          {i.supplierName} · طُلب {i.orderCount} مرة
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-ink-soft"><Money minor={c.previousMinor} /></td>
                      <td className="px-3 py-2.5 font-medium"><Money minor={c.currentMinor} /></td>
                      <td className={`px-3 py-2.5 font-bold ${up ? "text-danger" : "text-ok"}`}>
                        {up ? "▲" : "▼"} {Math.abs(Math.round(c.deltaRatio * 100))}٪
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">الأصناف حسب الإنفاق</h2>
          <Link href="/analysis" className="text-xs underline underline-offset-4 hover:text-ink">
            التحليل الكامل ←
          </Link>
        </div>
        {items.length === 0 ? (
          <Empty message="لا بنود بعد. البنود تُسجَّل عند قراءة محتوى الفواتير." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">الصنف</th>
                  <th className="px-3 py-2 text-right font-medium">المورّد</th>
                  <th className="px-3 py-2 text-right font-medium">مرات الطلب</th>
                  <th className="px-3 py-2 text-right font-medium">متوسّط الوحدة</th>
                  <th className="px-3 py-2 text-right font-medium">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {items.slice(0, 25).map((i) => (
                  <tr key={i.key}>
                    <td className="px-3 py-2.5 font-medium">{i.displayName}</td>
                    <td className="px-3 py-2.5 text-xs text-ink-soft">{i.supplierName}</td>
                    <td className="nums px-3 py-2.5">{i.orderCount}</td>
                    <td className="px-3 py-2.5"><Money minor={i.averageUnitPriceMinor} /></td>
                    <td className="px-3 py-2.5 font-medium"><Money minor={i.totalSpentMinor} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
