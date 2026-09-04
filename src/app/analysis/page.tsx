import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { findSameNameCandidates, summarizeItems, type LineRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export default async function AnalysisPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="ذكاء الشراء">
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
          <div className="scroll-x rounded-2xl border border-line shadow-raised">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="sticky top-0 bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">الاسم المشترك</th>
                  <th className="px-3 py-2 text-right font-medium">الأرخص</th>
                  <th className="px-3 py-2 text-right font-medium">الأغلى</th>
                  <th className="px-3 py-2 text-right font-medium">الفارق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-raised">
                {sameName.slice(0, 20).map((g) => (
                  <tr key={g.normalized}>
                    <td className="px-3 py-2.5 font-medium">{g.normalized}</td>
                    <td className="px-3 py-2.5">
                      <span className="block text-xs text-muted">{g.cheaper.supplierName}</span>
                      <span className="block text-[11px]">{g.cheaper.displayName}</span>
                      <Money minor={g.cheaper.lastUnitPriceMinor} tone="ok" />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block text-xs text-muted">{g.dearer.supplierName}</span>
                      <span className="block text-[11px]">{g.dearer.displayName}</span>
                      <Money minor={g.dearer.lastUnitPriceMinor} tone="danger" />
                    </td>
                    <td className="nums px-3 py-2.5 font-bold text-warn">
                      {Math.round(g.gapRatio * 100)}٪
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                    عادةً تشتريه كل {x.cycle} يوماً · آخر شراء قبل {x.since} يوماً
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
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-1 font-display text-lg font-bold leading-tight">الأصناف حسب الإنفاق</h2>
        <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">
          مرتّبة بالأكثر كلفة — أعلى الصفحة هو ما يستحقّ التفاوض عليه.
        </p>
        <div className="scroll-x rounded-2xl border border-line shadow-raised">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="sticky top-0 bg-sunken text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-right font-medium">الصنف</th>
                <th className="px-3 py-2 text-right font-medium">مرات الطلب</th>
                <th className="px-3 py-2 text-right font-medium">الكميّة</th>
                <th className="px-3 py-2 text-right font-medium">متوسط سعر الوحدة</th>
                <th className="px-3 py-2 text-right font-medium">الإجمالي</th>
                <th className="px-3 py-2 text-right font-medium">الدورة</th>
                <th className="px-3 py-2 text-right font-medium">آخر طلب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-raised">
              {top.map((i) => (
                <tr key={i.key}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{i.displayName}</p>
                    <p className="text-[11px] text-muted">{i.supplierName}</p>
                  </td>
                  <td className="nums px-3 py-2.5">{i.orderCount}</td>
                  <td className="nums px-3 py-2.5">{Math.round(i.totalQuantity * 100) / 100}</td>
                  <td className="px-3 py-2.5"><Money minor={i.averageUnitPriceMinor} /></td>
                  <td className="px-3 py-2.5 font-medium"><Money minor={i.totalSpentMinor} /></td>
                  <td className="nums px-3 py-2.5 text-xs text-ink-soft">
                    {i.averageDaysBetweenOrders ? `كل ${i.averageDaysBetweenOrders} يوم` : "—"}
                  </td>
                  <td className="nums px-3 py-2.5 text-xs text-ink-soft" dir="ltr">
                    {i.lastOrderedAt ? i.lastOrderedAt.toISOString().slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length > top.length && (
          <p className="mt-2 text-xs text-muted">
            تُعرض أعلى {top.length} صنفاً إنفاقاً من {items.length}.
          </p>
        )}
      </section>
    </PageShell>
  );
}
