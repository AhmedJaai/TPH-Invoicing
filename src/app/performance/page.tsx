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
import { NoAccess, DataTable } from "@/components/ui";
import { countNoun, TIME } from "@/lib/arabic";

export const dynamic = "force-dynamic";

/**
 * الأسعار: ما تدعمه البيانات الموجودة فعلاً.
 *
 * لا هامش ربح ولا تكلفة مبيعات — كلاهما يحتاج مصدر مبيعات لم يُوصَل.
 * وما لا يُدعم يُقال عنه ذلك صراحةً بدل أن يُملأ برقم يبدو دقيقاً.
 */
export default async function PerformancePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/performance");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الأسعار">
        <NoAccess />
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
    .filter((i) => i.priceChange && i.priceChange.deltaRatio !== null && Math.abs(i.priceChange.deltaRatio) >= 0.03)
    .sort((a, b) => Math.abs(b.priceChange!.deltaRatio!) - Math.abs(a.priceChange!.deltaRatio!));
  const priceMovesShown = priceMoves.slice(0, 25);

  const sameName = findSameNameCandidates(items);
  const totalSpend = items.reduce((s, i) => s + i.totalSpentMinor, 0);

  return (
    <PageShell
      user={user}
     
      title="الأسعار"
      intro="ما تدعمه بياناتك الموجودة: الأصناف وأسعارها ومورّدوها. وما يحتاج مبيعات — الهامش والتكلفة — مذكور صراحةً أنّه غير متاح."
    >
      {/* ── ما هو غير متاح، صراحةً ── */}
      <div className="rounded-2xl border border-dashed border-line px-4 py-3">
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
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">أصناف مختلفة</p>
          <p className="nums mt-1 text-xl font-bold">{items.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">مشتريات محسوبة بالبنود</p>
          <p className="mt-1 text-xl font-bold"><Money minor={totalSpend} /></p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">أسعار تحرّكت</p>
          <p className={`nums mt-1 text-xl font-bold ${priceMoves.length ? "text-warn" : ""}`}>
            {priceMoves.length}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
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
          <DataTable
            rows={priceMovesShown}
            keyOf={(i) => i.key}
            columns={[
              {
                key: "item", header: "الصنف", primary: true,
                cell: (i) => (
                  <span>
                    <span className="block font-medium">{i.displayName}</span>
                    <span className="block text-[11px] text-muted">{i.supplierName} · طُلب {countNoun(i.orderCount, TIME)}</span>
                  </span>
                ),
              },
              { key: "prev", header: "السابق", numeric: true, cell: (i) => <span className="text-ink-soft"><Money minor={i.priceChange!.previousMinor} /></span> },
              { key: "now", header: "الحالي", numeric: true, cell: (i) => <span className="font-medium"><Money minor={i.priceChange!.currentMinor} /></span> },
              {
                key: "delta", header: "التغيّر", numeric: true,
                cell: (i) => {
                  const up = i.priceChange!.direction === "up";
                  return <span className={`font-bold ${up ? "text-danger" : "text-ok"}`}>{up ? "▲" : "▼"} {Math.abs(Math.round(i.priceChange!.deltaRatio! * 100))}٪</span>;
                },
              },
            ]}
          />
          {priceMoves.length > priceMovesShown.length && (
            <p className="mt-2 text-xs text-muted">تُعرض أكبرُ 25 حركة من {priceMoves.length}.</p>
          )}
        </section>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">الأصناف حسب الإنفاق</h2>
          <Link href="/analysis" className="text-xs underline underline-offset-4 hover:text-ink">
            الإنفاق على الأصناف ←
          </Link>
        </div>
        {items.length === 0 ? (
          <Empty message="لا بنود بعد. البنود تُسجَّل عند قراءة محتوى الفواتير." />
        ) : (
          <>
            <DataTable
              rows={items.slice(0, 25)}
              keyOf={(i) => i.key}
              columns={[
                { key: "item", header: "الصنف", primary: true, cell: (i) => <span className="font-medium">{i.displayName}</span> },
                { key: "supplier", header: "المورّد", cell: (i) => <span className="text-xs text-ink-soft">{i.supplierName}</span> },
                { key: "orders", header: "مرات الطلب", numeric: true, cell: (i) => i.orderCount },
                { key: "unit", header: "متوسّط الوحدة", numeric: true, secondary: true, cell: (i) => <Money minor={i.averageUnitPriceMinor} /> },
                { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <span className="font-medium"><Money minor={i.totalSpentMinor} /></span> },
              ]}
            />
            {items.length > 25 && (
              <p className="mt-2 text-xs text-muted">تُعرض أعلى 25 إنفاقاً من {items.length} — والكلّ في التحليل الكامل.</p>
            )}
          </>
        )}
      </section>
    </PageShell>
  );
}
