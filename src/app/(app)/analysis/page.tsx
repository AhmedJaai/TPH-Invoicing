import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CalendarClock, Info, Layers, Link2, ShoppingBasket, Tags, TrendingDown, TrendingUp } from "lucide-react";
import { db } from "@/db";
import { invoiceLines, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Money, PageShell } from "@/components/page-shell";
import { summarizeItems, type ItemSummary, type LineRow } from "@/lib/analytics";
import {
  Badge, Callout, DataTable, Delta, EmptyState, LinkButton, LinkTabs, Meter, Monogram, NoAccess, Section,
} from "@/components/ui";
import { Figure } from "@/components/supplier-intel";
import { PRODUCT, countNoun, DAY, TIME } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { buildDataHealth } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { ProductMapping } from "@/components/product-mapping";
import { listProducts, listSupplierProducts, mappingCoverage } from "@/services/product.service";
import { suggestMerges, type SupplierItem } from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * الأصناف والأسعار — ما اشتريتَه، وكيف تحرّك سعرُه، وعند مَن.
 *
 * ثلاثةُ أعمالٍ لا صفحةٌ طويلة، كلٌّ في لسانٍ يُحفظ في العنوان:
 *
 *   • ما تحرّك سعرُه (الافتراضيّ — ويفتحه بندُ «ارتفعت أسعار أصناف»
 *     على `#price-moves`)، ومعه ما بلغ دورةَ شرائه المعتادة.
 *   • الأصنافُ حسب الإنفاق — كلُّها، ويُبحث فيها.
 *   • ربطُ أصناف المورّدين بصنفٍ معياريّ — عملٌ على الأصناف لا عرضٌ لها.
 *
 * ── لماذا صفحةٌ واحدة كانت ثلاثاً ── (باقٍ)
 *
 * `/analysis` و`/performance` كانتا تشغّلان الاستعلامَ نفسه وتعرضان الجدولَ
 * نفسه، و`/purchases/products` ثالثةٌ عن الأصناف. والمقارنةُ داخل المورّد
 * لا عبره (درس «العنب»): المفتاح `${supplierId}::${اسم}`.
 */

type View = "prices" | "spend" | "mapping";

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

const pctOf = (i: ItemSummary) => (i.priceChange?.deltaRatio == null ? null : Math.round(i.priceChange.deltaRatio * 100));

export default async function ItemsAndPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
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
  const wanted = (await searchParams).view;
  const view: View = wanted === "spend" ? "spend" : wanted === "mapping" && canMap ? "mapping" : "prices";

  const [rows, health, mapping, slugRows] = await Promise.all([
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
    db.select({ id: suppliers.id, slug: suppliers.slug }).from(suppliers),
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
          icon={Tags}
          title="لا بنود فواتير بعد."
          hint="تُبنى الأصناف من بنود الفواتير — يمتلئ هذا حين يُقرأ محتوى أوّل فاتورة، فيظهر كلُّ صنفٍ وسعرُه وعند مَن."
          action={<LinkButton href="/upload" variant="primary">ارفع مستنداً</LinkButton>}
        />
      </PageShell>
    );
  }

  const slugOf = new Map(slugRows.map((r) => [r.id, r.slug]));
  const lineCoverage = health.metrics.find((m) => m.id === "lines");
  const totalSpend = items.reduce((s, i) => s + i.totalSpentMinor, 0);

  /* ما تحرّك 3٪ فأكثر — دون ذلك تقريبٌ لا حركة */
  const priceMoves = items
    .filter((i) => i.priceChange && i.priceChange.deltaRatio !== null && Math.abs(i.priceChange.deltaRatio) >= 0.03)
    .sort((a, b) => Math.abs(b.priceChange!.deltaRatio!) - Math.abs(a.priceChange!.deltaRatio!));
  const rises = priceMoves.filter((i) => i.priceChange!.direction === "up");
  const falls = priceMoves.filter((i) => i.priceChange!.direction === "down");
  const maxRise = Math.max(0, ...rises.map((i) => pctOf(i) ?? 0));

  const dueSoon = items
    .filter((i) => i.averageDaysBetweenOrders !== null && daysSince(i.lastOrderedAt) !== null)
    .filter((i) => daysSince(i.lastOrderedAt)! >= i.averageDaysBetweenOrders! * 0.85)
    .map((item) => ({ item, cycle: item.averageDaysBetweenOrders!, since: daysSince(item.lastOrderedAt)! }))
    .sort((a, b) => b.since / b.cycle - a.since / a.cycle)
    .slice(0, 12);

  const unmapped = mapping ? mapping[2].total - mapping[2].mapped : 0;

  const supplierCell = (i: ItemSummary) => {
    const slug = i.supplierId ? slugOf.get(i.supplierId) : undefined;
    return slug ? (
      <Link href={`/suppliers/${slug}?tab=prices#detail`} className="relative hover:text-accent hover:underline">{i.supplierName}</Link>
    ) : (
      <>{i.supplierName}</>
    );
  };

  return (
    <PageShell
      user={user}
      width="wide"
      title="الأصناف والأسعار"
      intro="كلُّ صنفٍ اشتريتَه: كم كلّف، ومن أيّ مورّد، وكيف تحرّك سعرُه عنده."
    >
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Figure
          icon={TrendingUp}
          label="ارتفع سعرُه"
          href="/analysis#price-moves"
          tone={rises.length > 0 ? "warn" : undefined}
          value={<span className="nums">{rises.length}</span>}
          sub={rises.length > 0 ? `أكبرُه ${maxRise}٪ في آخر شراء — عند المورّد نفسه.` : "لا صنفَ ارتفع سعرُه 3٪ فأكثر في آخر شراء."}
        />
        <Figure
          icon={TrendingDown}
          label="انخفض سعرُه"
          href="/analysis#price-moves"
          tone={falls.length > 0 ? "ok" : undefined}
          value={<span className="nums">{falls.length}</span>}
          sub="مقابل آخر سعرٍ خالفه، عند المورّد نفسه."
        />
        <Figure
          icon={ShoppingBasket}
          label="مشتريات محسوبة بالبنود"
          href="/analysis?view=spend"
          value={<Money minor={totalSpend} />}
          sub={`${countNoun(items.length, PRODUCT)} عند المورّدين كلّهم.`}
        />
        {mapping ? (
          <Figure
            icon={Link2}
            label="مربوطٌ بصنفٍ معياريّ"
            href="/analysis?view=mapping"
            value={<><span className="nums">{mapping[2].mapped}</span><span className="text-base font-medium text-muted"> من <span className="nums">{mapping[2].total}</span></span></>}
          >
            <Meter value={mapping[2].mapped} max={Math.max(1, mapping[2].total)} tone={unmapped === 0 ? "ok" : "accent"} label="الأصناف المربوطة" />
          </Figure>
        ) : (
          <Figure icon={Layers} label="أصناف مختلفة" value={<span className="nums">{items.length}</span>} sub="الصنفُ بمورّده — الاسمُ وحده لا يعرّف صنفاً." />
        )}
      </div>

      {lineCoverage && lineCoverage.state !== "GOOD" && (
        <Callout tone="warn" icon={Info} className="mt-4" title="الأرقامُ على جزءٍ من الفواتير">
          أرقام هذه الصفحة مبنيّة على {lineCoverage.detail}. الباقي غير محسوب فيها.
        </Callout>
      )}
      {/* ما لا يُحسَب يُقال ولا يُعرَض صفراً — والمبيعات غير موصولة */}
      <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span>
          <span className="font-bold text-ink-soft">غير متاح بعد:</span> هامشُ الربح وتكلفةُ المبيعات وربحيّةُ الصنف — تحتاج مصدرَ مبيعاتٍ لم يُوصَل،
          ولن تُعرَض بأرقامٍ مقدَّرة.
        </span>
      </p>

      <div className="mt-8">
        <LinkTabs
          label="أعمال الأصناف"
          items={[
            { href: "/analysis", label: "ما تحرّك سعرُه", count: priceMoves.length, active: view === "prices" },
            { href: "/analysis?view=spend", label: "حسب الإنفاق", count: items.length, active: view === "spend" },
            ...(canMap ? [{ href: "/analysis?view=mapping", label: "اربط الأصناف", count: unmapped, active: view === "mapping" }] : []),
          ]}
        />
      </div>

      {view === "prices" && (
        <>
          <Section
            id="price-moves"
            title="ما تحرّك سعرُه"
            icon={Tags}
            count={priceMoves.length}
            className="mt-6"
            hint="سعرُ الوحدة في آخر شراء مقابل آخر سعرٍ خالفه — عند المورّد نفسه، وبعد الخصم. ما دون 3٪ تقريبٌ لا حركة."
          >
            <DataTable
              rows={priceMoves}
              keyOf={(i) => i.key}
              searchOf={(i) => `${i.displayName} ${i.supplierName}`}
              searchLabel="ابحث عن صنف أو مورّد"
              empty={
                <EmptyState
                  compact
                  icon={Tags}
                  title="لم يتحرّك سعرُ صنفٍ 3٪ فأكثر."
                  hint="كلُّ صنفٍ اشتُري مرّتين فأكثر بقي سعرُه في آخر شراءٍ قريباً ممّا قبله."
                />
              }
              columns={[
                {
                  key: "item", header: "الصنف", primary: true,
                  cell: (i) => (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Monogram name={i.supplierName} />
                      <span className="min-w-0">
                        <span className="block truncate font-bold" dir="auto">{i.displayName}</span>
                        <span className="block text-[11px] font-normal text-muted">{supplierCell(i)} · طُلب {countNoun(i.orderCount, TIME)}</span>
                      </span>
                    </span>
                  ),
                },
                { key: "prev", header: "كان", numeric: true, cell: (i) => <span className="text-ink-soft"><Money minor={i.priceChange!.previousMinor} /></span> },
                { key: "now", header: "صار", numeric: true, cell: (i) => <span className="font-bold"><Money minor={i.priceChange!.currentMinor} /></span> },
                {
                  key: "delta", header: "التغيّر",
                  cell: (i) => <Delta pct={pctOf(i)} favourable={i.priceChange!.direction === "down"} />,
                },
                {
                  key: "when", header: "متى", secondary: true,
                  cell: (i) => <span className="whitespace-nowrap text-xs text-ink-soft">{formatDay(i.priceChange!.currentDate)}</span>,
                },
              ]}
            />
          </Section>

          <Section
            title="بلغ دورةَ شرائه المعتادة"
            icon={CalendarClock}
            count={dueSoon.length > 0 ? dueSoon.length : undefined}
            /* النظام لا يعرف المخزون — يعرف سلوكَ الشراء وحده، فيقول المقارنة ولا يوصي */
            hint="ليست توصيةً بإعادة الطلب — النظام لا يعرف مخزونك. يعرف كم يوماً يمرّ عادةً بين شرائك للصنف، ومتى اشتريتَه آخر مرّة."
          >
            {dueSoon.length === 0 ? (
              <EmptyState compact icon={CalendarClock} title="لا صنفَ بلغ دورته." hint="تُحسب الدورة لما اشتُري في يومين مختلفين فأكثر." />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {dueSoon.map((x) => (
                  <li key={x.item.key} className="flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold" dir="auto">{x.item.displayName}</span>
                      <span className="block text-[11px] leading-relaxed text-muted">
                        {x.item.supplierName} · عادةً كلَّ {countNoun(x.cycle, DAY)} · آخرُه قبل {countNoun(x.since, DAY)}
                      </span>
                    </span>
                    <Badge tone={x.since > x.cycle ? "warn" : undefined} dot>{x.since > x.cycle ? "تجاوز دورتك" : "بلغ دورتك"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {view === "spend" && (
        <Section
          title="الأصناف حسب الإنفاق"
          icon={ShoppingBasket}
          count={items.length}
          className="mt-6"
          hint="بالأكثر كلفة — أعلى الجدول هو ما يستحقّ التفاوض عليه. ابحث باسم الصنف أو المورّد."
        >
          <DataTable
            rows={items}
            keyOf={(i) => i.key}
            searchOf={(i) => `${i.displayName} ${i.supplierName}`}
            searchLabel="ابحث عن صنف أو مورّد"
            columns={[
              {
                key: "item", header: "الصنف", primary: true,
                cell: (i) => (
                  <span className="block min-w-0">
                    <span className="block truncate font-bold" dir="auto">{i.displayName}</span>
                    <span className="block text-[11px] font-normal text-muted">{supplierCell(i)}</span>
                  </span>
                ),
              },
              { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <span className="font-bold"><Money minor={i.totalSpentMinor} /></span> },
              { key: "unit", header: "متوسّط سعر الوحدة", numeric: true, cell: (i) => <Money minor={i.averageUnitPriceMinor} /> },
              { key: "orders", header: "مرّات الطلب", numeric: true, cell: (i) => <span className="nums">{i.orderCount}</span> },
              {
                key: "move", header: "آخر تغيّر", secondary: true,
                cell: (i) => (i.priceChange ? <Delta pct={pctOf(i)} favourable={i.priceChange.direction === "down"} /> : <span className="text-[11px] text-muted">—</span>),
              },
              {
                key: "last", header: "آخر طلب", secondary: true,
                cell: (i) => <span className="whitespace-nowrap text-xs text-ink-soft">{formatDay(i.lastOrderedAt)}</span>,
              },
            ]}
          />
        </Section>
      )}

      {/* ── الربط: عملٌ على الأصناف ── */}
      {view === "mapping" && mapping && (
        <Section
          title="اربط أصناف المورّدين"
          icon={Link2}
          className="mt-6"
          hint={`${mapping[2].mapped} من ${mapping[2].total} مربوطة بصنفٍ معياريّ. والربط أساسُ كلّ مقارنة تكلفة: بلا وحدةٍ واحدة تُجمَع، «العنب» عند مورّدَين صنفان لا واحد.`}
        >
          {mapping[0].length === 0 ? (
            <EmptyState compact icon={Link2} title="لا أصناف بعد." hint="تُبنى من بنود الفواتير — اقرأ محتوى فواتيرك أوّلاً." />
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
