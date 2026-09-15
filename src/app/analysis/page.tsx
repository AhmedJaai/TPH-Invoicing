import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { findSameNameCandidates, summarizeItems, type LineRow } from "@/lib/analytics";
import { NoAccess, DataTable } from "@/components/ui";
import { PRODUCT, countNoun, DAY } from "@/lib/arabic";

export const dynamic = "force-dynamic";

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export default async function AnalysisPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/analysis");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="ذكاء الشراء">
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

  if (items.length === 0) {
    return (
      <PageShell
        user={user}
       
        title="ذكاء الشراء"
        intro="كل صنف اشتريته: كم مرة طُلب، وبأي كميّة، وكم كلّف، ومن أي مورّد، وكل كم يوم تحتاجه."
      >
        <Empty message="لا توجد بنود فواتير بعد. البنود تُسجَّل عند أرشفة الفواتير — ارفع فاتورة وستظهر هنا." />
      </PageShell>
    );
  }

  const totalSpend = items.reduce((s, i) => s + i.totalSpentMinor, 0);
  const sameName = findSameNameCandidates(items);
  const top = items.slice(0, 40);

  // الأصناف التي قاربت دورة إعادة طلبها
  const dueSoon = items
    .filter((i) => i.averageDaysBetweenOrders && i.lastOrderedAt)
    .map((i) => ({ item: i, since: daysSince(i.lastOrderedAt)!, cycle: i.averageDaysBetweenOrders! }))
    .filter((x) => x.since >= x.cycle * 0.85)
    .sort((a, b) => b.since / b.cycle - a.since / a.cycle)
    .slice(0, 12);
  const dueSoonTotal = items
    .filter((i) => i.averageDaysBetweenOrders && i.lastOrderedAt)
    .filter((i) => daysSince(i.lastOrderedAt)! >= i.averageDaysBetweenOrders! * 0.85).length;

  return (
    <PageShell
      user={user}
     
      title="ذكاء الشراء"
      intro="كل صنف اشتريته: كم مرة طُلب، وبأي كميّة، وكم كلّف، ومن أي مورّد، وكل كم يوم تحتاجه."
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">أصناف مختلفة</p>
          <p className="nums mt-1 text-xl font-bold">{items.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">إجمالي المشتريات</p>
          <p className="mt-1 text-xl font-bold"><Money minor={totalSpend} /></p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">أسماء تتكرّر عند مورّدين</p>
          <p className="nums mt-1 text-xl font-bold">{sameName.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3">
          <p className="text-xs text-muted">مورّدون</p>
          <p className="nums mt-1 text-xl font-bold">
            {new Set(items.map((i) => i.supplierId).filter(Boolean)).size}
          </p>
        </div>
      </div>

      {sameName.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-base font-bold">اسم واحد عند مورّدين — للمراجعة</h2>
          <p className="mb-3 text-xs leading-relaxed text-muted">
            هذه مرشّحات لا نتائج. تطابق الاسم لا يعني تطابق الصنف: «عنب» عند المحمصة الغربية
            كيلو بنّ بـ١٥٥ ريالاً، و«عنب» عند لافا زجاجة كمبوتشا بـ١٣٫٥٠. فانظر الوصفين
            بنفسك — فإن كانا صنفاً واحداً فالفارق فرصة، وإلّا فلا معنى للمقارنة.
          </p>
          <DataTable
            rows={sameName.slice(0, 20)}
            keyOf={(g) => g.normalized}
            columns={[
              { key: "name", header: "الاسم المشترك", primary: true, cell: (g) => <span className="font-medium">{g.normalized}</span> },
              {
                key: "cheaper", header: "الأرخص",
                cell: (g) => (
                  <span>
                    <span className="block text-xs text-muted">{g.cheaper.supplierName}</span>
                    <span className="block text-[11px]">{g.cheaper.displayName}</span>
                    <Money minor={g.cheaper.lastUnitPriceMinor} tone="ok" />
                  </span>
                ),
              },
              {
                key: "dearer", header: "الأغلى",
                cell: (g) => (
                  <span>
                    <span className="block text-xs text-muted">{g.dearer.supplierName}</span>
                    <span className="block text-[11px]">{g.dearer.displayName}</span>
                    <Money minor={g.dearer.lastUnitPriceMinor} tone="danger" />
                  </span>
                ),
              },
              { key: "gap", header: "الفارق", numeric: true, cell: (g) => <span className="font-bold text-warn">{Math.round(g.gapRatio * 100)}٪</span> },
            ]}
          />
          {sameName.length > 20 && (
            <p className="mt-2 text-xs text-muted">تُعرض أوّل 20 من {sameName.length} — الأكبر فارقاً.</p>
          )}
        </section>
      )}

      {dueSoon.length > 0 && (
        <section className="mt-10">
          {/*
            «قارب موعد طلبها» توحي بأنّ النظام يعرف المخزون، وهو لا يعرفه.
            كلّ ما يعرفه سلوك شرائك: كم يوماً بين طلب وطلب، ومتى كان آخره.
            فتُقال الملاحظة كما هي، ويُترك الاستنتاج لصاحبها.
          */}
          <h2 className="mb-1 font-display text-lg font-bold leading-tight">
            أصناف مضى على آخر شرائها ما يقارب دورتك المعتادة
          </h2>
          <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">
            هذه ليست توصية بإعادة الطلب — النظام لا يعرف مخزونك. هو يعرف كم يوماً يمرّ
            عادةً بين شرائك للصنف ومتى اشتريتَه آخر مرّة، فيعرض المقارنة وحدها.
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {dueSoon.map((x) => (
              <li key={x.item.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{x.item.displayName}</span>
                  <span className="block text-[11px] leading-relaxed text-muted">
                    عادةً تشتريه كل {countNoun(x.cycle, DAY)} · آخر شراء قبل {countNoun(x.since, DAY)}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    x.since > x.cycle ? "bg-warn-bg text-warn" : "bg-sunken text-ink-soft"
                  }`}
                >
                  {x.since > x.cycle ? "تجاوز دورتك" : "بلغ دورتك"}
                </span>
              </li>
            ))}
          </ul>
          {dueSoonTotal > dueSoon.length && (
            <p className="mt-2 text-xs text-muted">تُعرض أقربُ 12 من {dueSoonTotal}.</p>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-1 font-display text-lg font-bold leading-tight">الأصناف حسب الإنفاق</h2>
        <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">
          مرتّبة بالأكثر كلفة — أعلى الصفحة هو ما يستحقّ التفاوض عليه.
        </p>
        <DataTable
          rows={top}
          keyOf={(i) => i.key}
          columns={[
            {
              key: "item", header: "الصنف", primary: true,
              cell: (i) => (
                <span>
                  <span className="block font-medium">{i.displayName}</span>
                  <span className="block text-[11px] text-muted">{i.supplierName}</span>
                </span>
              ),
            },
            { key: "orders", header: "مرات الطلب", numeric: true, cell: (i) => i.orderCount },
            { key: "qty", header: "الكميّة", numeric: true, secondary: true, cell: (i) => Math.round(i.totalQuantity * 100) / 100 },
            { key: "unit", header: "متوسط سعر الوحدة", numeric: true, cell: (i) => <Money minor={i.averageUnitPriceMinor} /> },
            { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <span className="font-medium"><Money minor={i.totalSpentMinor} /></span> },
            {
              key: "cycle", header: "الدورة", secondary: true,
              cell: (i) => <span className="text-xs text-ink-soft">{i.averageDaysBetweenOrders ? `كل ${countNoun(i.averageDaysBetweenOrders, DAY)}` : "—"}</span>,
            },
            {
              key: "last", header: "آخر طلب", secondary: true,
              cell: (i) => <span className="nums text-xs text-ink-soft" dir="ltr">{i.lastOrderedAt ? i.lastOrderedAt.toISOString().slice(0, 10) : "—"}</span>,
            },
          ]}
        />
        {items.length > top.length && (
          <p className="mt-2 text-xs text-muted">
            تُعرض أعلى {countNoun(top.length, PRODUCT)} إنفاقاً من {items.length}.
          </p>
        )}
      </section>
    </PageShell>
  );
}
