import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { findSameNameCandidates, summarizeItems, type LineRow } from "@/lib/analytics";
import { NoAccess, DataTable, EmptyState, Section, Stat, StatGrid } from "@/components/ui";
import { PRODUCT, countNoun, DAY, TIME } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { buildDataHealth } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { ProductMapping } from "@/components/product-mapping";
import { listProducts, listSupplierProducts, mappingCoverage } from "@/services/product.service";
import { suggestMerges, type SupplierItem } from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * الأصناف والأسعار — صفحةٌ واحدة كانت ثلاثاً.
 *
 * `/analysis` و`/performance` كانتا **تشغّلان الاستعلام نفسه حرفاً
 * بحرف** (عشرون ألف سطرِ فاتورة)، وتعرضان جدول «الأصناف حسب الإنفاق»
 * نفسَه، وبطاقتَي «أصناف مختلفة» و«أسماء تتكرّر عند مورّدين» بالرقمين
 * نفسيهما. وتفترقان في شيءٍ واحد: جدولُ تغيّر الأسعار في الثانية.
 *
 * و`/purchases/products` ثالثةٌ عن الأصناف كذلك — عملُ ربطِ اسمِ الصنف
 * عند المورّد بصنفٍ معياريّ. وهو عملٌ على الأصناف لا صفحةٌ عنها.
 *
 * ومعها كان بند «ارتفعت أسعار أصناف» في التنبيهات يفتح `/analysis` —
 * **وجدول الأسعار لم يكن فيها**. فمن ضغط الزرّ وصل إلى صفحةٍ لا تحمل
 * ما وُعد به. وقد صار يحمله.
 */

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export default async function ItemsAndPricesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/analysis");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الأصناف والأسعار">
        <NoAccess />
      </PageShell>
    );
  }

  const canMap = can(user.role, "supplier:edit");

  const [rows, health, mapping] = await Promise.all([
    db
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
      .limit(20000),
    gatherHealthFacts().then(buildDataHealth),
    canMap
      ? Promise.all([listSupplierProducts(), listProducts(), mappingCoverage()])
      : Promise.resolve(null),
  ]);

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
      <PageShell user={user} width="wide" title="الأصناف والأسعار">
        <EmptyState
          title="لا بنود فواتير بعد."
          hint="تُبنى الأصناف من بنود الفواتير — يمتلئ هذا حين يُقرأ محتوى أوّل فاتورة."
        />
      </PageShell>
    );
  }

  const lineCoverage = health.metrics.find((m) => m.id === "lines");
  const totalSpend = items.reduce((s, i) => s + i.totalSpentMinor, 0);
  const sameName = findSameNameCandidates(items);

  const priceMoves = items
    .filter((i) => i.priceChange && i.priceChange.deltaRatio !== null && Math.abs(i.priceChange.deltaRatio) >= 0.03)
    .sort((a, b) => Math.abs(b.priceChange!.deltaRatio!) - Math.abs(a.priceChange!.deltaRatio!));
  const priceMovesShown = priceMoves.slice(0, 25);

  const withCycle = items.filter(
    (i) => i.averageDaysBetweenOrders !== null && daysSince(i.lastOrderedAt) !== null,
  );
  const dueSoonAll = withCycle
    .filter((i) => daysSince(i.lastOrderedAt)! >= i.averageDaysBetweenOrders! * 0.85)
    .map((item) => ({
      item,
      cycle: item.averageDaysBetweenOrders!,
      since: daysSince(item.lastOrderedAt)!,
    }))
    .sort((a, b) => b.since / b.cycle - a.since / a.cycle);
  const dueSoon = dueSoonAll.slice(0, 12);

  const top = items.slice(0, 40);

  return (
    <PageShell
      user={user}
      width="wide"
      title="الأصناف والأسعار"
      intro="كلّ صنفٍ اشتريتَه: كم كلّف، ومن أيّ مورّد، وكيف تحرّك سعرُه."
    >
      <StatGrid>
        <Stat label="أصناف مختلفة" value={String(items.length)} />
        <Stat label="مشتريات محسوبة بالبنود" minor={totalSpend} />
        <Stat
          label="أسعار تحرّكت"
          value={String(priceMoves.length)}
          tone={priceMoves.length > 0 ? "warn" : undefined}
        />
        <Stat label="أسماء تتكرّر عند مورّدين" value={String(sameName.length)} />
      </StatGrid>

      {lineCoverage && lineCoverage.state !== "GOOD" && (
        <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
          ⚠ أرقام هذه الصفحة مبنيّة على {lineCoverage.detail}. الباقي غير محسوب فيها.
        </p>
      )}
      {/*
        ما لا يُحسَب يُقال، ولا يُعرَض صفراً — والمبيعات غير موصولة، فكلّ
        ما يُبنى عليها غير متاح.
      */}
      <p className="mt-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs leading-relaxed text-muted">
        <span className="font-bold text-ink-soft">غير متاح بعد: </span>
        هامش الربح · تكلفة المبيعات · ربحيّة الصنف — كلُّها تحتاج مصدرَ مبيعاتٍ لم يُوصَل،
        ولن تُعرَض بأرقامٍ مقدَّرة.
      </p>

      {/* ── ما تحرّك سعرُه — وهو ما يفتحه بندُ التنبيه ── */}
      {priceMoves.length > 0 && (
        <Section
          className="scroll-mt-24"
          id="price-moves"
          title="تغيّر أسعار الأصناف"
          hint="سعرُ الوحدة في آخر فاتورة مقابل الذي قبله — عند المورّد نفسه، وبعد الخصم والضريبة لا قبلهما."
        >
          <DataTable
            rows={priceMovesShown}
            keyOf={(i) => i.key}
            columns={[
              {
                key: "item", header: "الصنف", primary: true,
                cell: (i) => (
                  <span>
                    <span className="block font-medium">{i.displayName}</span>
                    <span className="block text-[11px] text-muted">
                      {i.supplierName} · طُلب {countNoun(i.orderCount, TIME)}
                    </span>
                  </span>
                ),
              },
              { key: "prev", header: "السابق", numeric: true, cell: (i) => <span className="text-ink-soft"><Money minor={i.priceChange!.previousMinor} /></span> },
              { key: "now", header: "الحالي", numeric: true, cell: (i) => <span className="font-medium"><Money minor={i.priceChange!.currentMinor} /></span> },
              {
                key: "delta", header: "التغيّر", numeric: true,
                cell: (i) => {
                  const up = i.priceChange!.direction === "up";
                  return (
                    <span className={`font-bold ${up ? "text-danger" : "text-ok"}`}>
                      {up ? "▲" : "▼"} {Math.abs(Math.round(i.priceChange!.deltaRatio! * 100))}٪
                    </span>
                  );
                },
              },
            ]}
          />
          {priceMoves.length > priceMovesShown.length && (
            <p className="mt-2 text-xs text-muted">تُعرض أكبرُ 25 حركة من {priceMoves.length}.</p>
          )}
        </Section>
      )}

      {sameName.length > 0 && (
        <Section
          title="اسمٌ واحد عند مورّدين — للمراجعة"
          hint="هذه مرشّحات لا نتائج. تطابقُ الاسم لا يعني تطابقَ الصنف: «عنب» عند المحمصة الغربية كيلو بنٍّ بـ١٥٥ ريالاً، و«عنب» عند لافا زجاجةُ كمبوتشا بـ١٣٫٥٠. فانظر الوصفين بنفسك — فإن كانا صنفاً واحداً فالفارق فرصة، وإلّا فلا معنى للمقارنة."
        >
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
        </Section>
      )}

      {dueSoon.length > 0 && (
        <Section
          title="أصناف مضى على آخر شرائها ما يقارب دورتك المعتادة"
          /*
            «قارب موعد طلبها» توحي بأنّ النظام يعرف المخزون، وهو لا يعرفه.
            كلّ ما يعرفه سلوك شرائك: كم يوماً بين طلبٍ وطلب، ومتى كان آخره.
          */
          hint="ليست توصيةً بإعادة الطلب — النظام لا يعرف مخزونك. هو يعرف كم يوماً يمرّ عادةً بين شرائك للصنف ومتى اشتريتَه آخر مرّة، فيعرض المقارنة وحدها."
        >
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
          {dueSoonAll.length > dueSoon.length && (
            <p className="mt-2 text-xs text-muted">تُعرض أقربُ 12 من {dueSoonAll.length}.</p>
          )}
        </Section>
      )}

      <Section
        title="الأصناف حسب الإنفاق"
        hint="مرتّبةً بالأكثر كلفة — أعلى الجدول هو ما يستحقّ التفاوض عليه."
      >
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
              cell: (i) => <span className="text-xs text-ink-soft">{formatDay(i.lastOrderedAt)}</span>,
            },
          ]}
        />
        {items.length > top.length && (
          <p className="mt-2 text-xs text-muted">
            تُعرض أعلى {countNoun(top.length, PRODUCT)} إنفاقاً من {items.length}.
          </p>
        )}
      </Section>

      {/* ── الربط: عملٌ على الأصناف، وكان صفحةً ثالثة عنها ── */}
      {canMap && mapping && (
        <Section
          title="اربط أصناف المورّدين"
          hint={`${mapping[2].mapped} من ${mapping[2].total} مربوطة بصنفٍ معياريّ. والربط أساسُ كلّ مقارنة تكلفة: بلا وحدةٍ واحدة تُجمَع، «العنب» عند مورّدَين صنفان لا واحد.`}
        >
          {mapping[0].length === 0 ? (
            <Empty message="لا أصناف بعد. تُبنى من بنود الفواتير — اقرأ محتوى فواتيرك أوّلاً." />
          ) : (
            <ProductMapping
              rows={mapping[0]}
              products={mapping[1]}
              suggestions={suggestMerges(
                mapping[0].map<SupplierItem>((r) => ({
                  supplierId: r.supplierId,
                  supplierName: r.supplierName,
                  normalized: r.normalized,
                  displayName: r.displayName,
                  lastUnitPriceMinor: r.lastUnitPriceMinor,
                  orderCount: r.orderCount,
                })),
              )}
            />
          )}
        </Section>
      )}
    </PageShell>
  );
}
