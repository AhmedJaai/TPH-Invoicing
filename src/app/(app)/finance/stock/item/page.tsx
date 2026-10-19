import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Coffee, Info, Receipt, Scale } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { Callout, Card, DataTable, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { formatUnits } from "@/lib/finance/format";
import { readableQuantity } from "@/lib/finance/quantity";
import { BALANCE_NOTE_LABEL, PURCHASE_SOURCE_LABEL } from "@/lib/finance/stock-balance";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadStockBalance } from "@/services/stock-balance.service";
import { loadFlowMonths, loadItemDetail } from "@/services/stock-flow.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** كم شهراً يُعرَض في الاتّجاه. */
const TREND_MONTHS = 8;

/**
 * صنفٌ واحد: كم اشتُري وكم بِيع منه وكم يُتوقَّع أنّه بقي — وما كوّن كلَّ رقم: فواتيرُه،
 * وما بِيع فصرف منه، وشهراً بشهر. الرقمُ في «المشترى والمباع» ينتهي هنا.
 */
export default async function StockItemPage({ searchParams }: { searchParams: Promise<{ id?: string; month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/stock");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="صنف"><NoAccess what="تفصيل الصنف" /></PageShell>;
  }
  const q = await searchParams;
  if (!q.id) redirect("/finance/stock");
  const months = await loadFlowMonths();
  const month = q.month && MONTH_RE.test(q.month) && months.includes(q.month) ? q.month : null;
  const b = await loadStockBalance(month, { trendFor: q.id, months: months.slice(0, TREND_MONTHS) });
  const item = b.items.find((x) => x.productId === q.id);
  const back = <LinkButton href={month ? `/finance/stock?month=${month}` : "/finance/stock"} variant="quiet" size="sm" icon={ArrowRight}>المشترى والمباع</LinkButton>;
  if (!item) {
    return (
      <PageShell user={user} title="صنف غير موجود" actions={back}>
        <EmptyState icon={Info} title="هذا الصنف ليس من أصناف المخزون الحالية." />
      </PageShell>
    );
  }
  const from = b.from ?? b.firstDay ?? b.to;
  const detail = await loadItemDetail(item.productId, { month: month ?? "", from, to: b.to, openingCountDay: null, closingCountDay: null });
  const qty = (milli: number | null) => readableQuantity(milli, item.baseUnit);
  const short = item.expectedMilli !== null && item.expectedMilli < 0;

  return (
    <PageShell
      user={user}
      width="wide"
      title={item.name}
      eyebrow={month ? formatMonth(month) : <><T s="كل الفترة حتى {0}" a={[<bdi key="0">{formatDay(b.to)}</bdi>]} /></>}
      actions={back}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-[11px] font-bold text-muted">{month ? "المشتريات في الشهر" : "المشتريات"}</p>
          <p className="nums mt-1.5 text-[17px] font-semibold">{qty(item.purchasedMilli)}</p>
          <p className="mt-1 text-[11px] text-muted">
            {item.source ? PURCHASE_SOURCE_LABEL[item.source] : "لا توجد مشتريات مسجّلة"}{item.purchasedMinor !== null && <> · <Money minor={item.purchasedMinor} /></>}
            <span className="block"><T s="منذ البداية، من فواتيرنا: {0} · ومن فودكس: {1}" a={[<span key="0" className="nums">{item.invoicesToDateMilli === null ? "غير مربوطة" : qty(item.invoicesToDateMilli)}</span>, <span key="1" className="nums">{item.foodicsToDateMilli === null ? "لم تُدخل" : qty(item.foodicsToDateMilli)}</span>]} /></span>
          </p>
        </Card>
        <Card>
          <p className="text-[11px] font-bold text-muted">{month ? "المباع منه في الشهر" : "المباع منه"}</p>
          <p className="nums mt-1.5 text-[17px] font-semibold">{qty(item.soldMilli)}</p>
          <p className="mt-1 text-[11px] text-muted">{item.soldMilli === null ? "لا توجد وصفة تستخدمه" : <><T s="حسب الوصفات{0}{1}" a={[item.staffMilli > 0 && <> <T s=" · لمشروبات الموظفين {0}" a={[<span key="0" className="nums">{qty(item.staffMilli)}</span>]} /></>, item.wasteMilli > 0 && <> <T s=" · هدر مسجّل {0}" a={[<span key="0" className="nums">{qty(item.wasteMilli)}</span>]} /></>]} /></>}</p>
        </Card>
        <Card tone={short ? "warn" : undefined}>
          <p className="text-[11px] font-bold text-muted">المتوقع بقاؤه</p>
          <p className="nums mt-1.5 text-[17px] font-semibold">{item.expectedMilli === null ? "غير معروف" : short ? `−${qty(-item.expectedMilli)}` : qty(item.expectedMilli)}</p>
          <p className="mt-1 text-[11px] text-muted">{short ? "بيع منه أكثر مما سُجّل شراؤه، فهناك مشتريات لم تدخل الحساب" : <><T s="كل ما اشتُري منذ البداية − كل ما بيع{0}" a={[item.expectedMinor !== null && <> · <Money minor={item.expectedMinor} /></>]} /></>}</p>
        </Card>
        <Card tone={item.lostMilli !== null && item.lostMilli > 0 ? "warn" : undefined}>
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted"><T s="{0} المفقود" a={[<Scale key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></p>
          <p className="nums mt-1.5 text-[17px] font-semibold">{item.lostMilli === null ? "—" : item.lostMilli >= 0 ? qty(item.lostMilli) : `وُجد أكثر بـ${qty(-item.lostMilli)}`}</p>
          <p className="mt-1 text-[11px] text-muted">
            {item.count === null ? "لم يُعدّ على الرف، فلا يمكن قياس المفقود" : <><T s="عُدّ في {0}: {1}{2}" a={[<bdi key="0">{formatDay(item.count.day)}</bdi>, <span key="1" className="nums">{qty(item.count.milli)}</span>, item.lostMinor !== null && <> · <MaybeMoney minor={item.lostMinor} signed /></>]} /></>}
          </p>
        </Card>
      </div>

      {item.notes.length > 0 && (
        <Callout tone="warn" icon={Info} className="mt-4" title="ما ينبغي مراعاته عند قراءة هذا الرقم">
          <ul className="list-disc space-y-0.5 ps-4">
            {item.notes.map((n) => <li key={n}>{BALANCE_NOTE_LABEL[n]}</li>)}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="/finance/stock/links" size="sm">اربط بنود الفواتير</LinkButton>
            <LinkButton href="/inventory/recipes" size="sm" variant="quiet">الوصفات</LinkButton>
          </div>
        </Callout>
      )}
      {item.lostMilli !== null && item.lostMilli > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          <T s="المفقود هو ما كان يُتوقع وجوده على الرف يوم العدّ ولم يوجد. قد يكون هدراً لم يُسجَّل، أو كمية أكبر من الوصفة، أو عدّاً ناقصاً، أو تسريباً، والبيانات لا تحدد أياً منها. {0}." a={[<Link key="0" href="/inventory/recipes" className="font-bold text-accent hover:underline">راجع الوصفة</Link>]} /></p>
      )}

      <Section title="شهراً بشهر" icon={Scale} hint="الكمية المتوقع بقاؤها في نهاية كل شهر، وهي رصيد متراكم منذ البداية.">
        <DataTable
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (r) => formatMonth(r.month) },
            { key: "bought", header: "المشتريات", numeric: true, cell: (r) => <span className="nums">{qty(r.purchasedMilli)}</span> },
            { key: "sold", header: "المباع منه", numeric: true, cell: (r) => <span className="nums">{qty(r.soldMilli)}</span> },
            { key: "left", header: "المتوقع في نهايته", numeric: true, cell: (r) => <span className={`nums ${r.expectedMilli !== null && r.expectedMilli < 0 ? "text-warn" : ""}`}>{r.expectedMilli === null ? "غير معروف" : r.expectedMilli < 0 ? `−${qty(-r.expectedMilli)}` : qty(r.expectedMilli)}</span> },
          ]}
          rows={b.trend} keyOf={(r) => r.month}
          hrefOf={(r) => `/finance/stock/item?id=${item.productId}&month=${r.month}`}
        />
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-2">
        <Section title="فواتيره المربوطة" icon={Receipt} count={detail.purchases.length} hint={item.source === "FOODICS" ? "اعتمدنا على فودكس لهذا الصنف. وهذه بنود فواتيرنا المربوطة به، ومجموعها أقل منه." : undefined}>
          <DataTable
            columns={[
              { key: "supplier", header: "المورّد", primary: true, cell: (r) => r.supplierName || "استلام يدوي" },
              { key: "day", header: "التاريخ", cell: (r) => <bdi>{formatDay(r.day)}</bdi> },
              { key: "qty", header: "الكمية", numeric: true, cell: (r) => (r.canonicalMilli === null ? <span className="text-[11px] text-warn">غير معروفة</span> : <span className="nums">{qty(r.canonicalMilli)}</span>) },
              { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <Money minor={r.lineTotalMinor} /> },
            ]}
            rows={detail.purchases} keyOf={(r) => r.lineId}
            hrefOf={(r) => (r.invoiceId && r.invoiceNumber ? `/purchases/invoices/${r.invoiceId}` : undefined)}
            empty={<EmptyState icon={Receipt} title="لا توجد بنود فواتير مربوطة به في هذه المدة." hint="إن كان قد اشتُري، فبند فاتورته لم يُربط بعد." action={<LinkButton href="/finance/stock/links" size="sm">اربط بنود الفواتير</LinkButton>} />}
          />
        </Section>
        <Section title="ما بيع وما صُرف منه" icon={Coffee} count={detail.sales.length} hint="الأصناف المباعة التي تدخل في وصفتها، وما استهلكته منه.">
          <DataTable
            columns={[
              { key: "name", header: "الصنف المباع", primary: true, cell: (r) => r.name },
              { key: "sold", header: "المباع", numeric: true, cell: (r) => <span className="nums">{formatUnits(r.soldMilli)}</span> },
              { key: "used", header: "المصروف منه", numeric: true, cell: (r) => <span className="nums">{qty(r.usedMilli)}</span> },
              { key: "staff", header: "لمشروبات الموظفين", numeric: true, secondary: true, cell: (r) => (r.staffMilli === 0 ? <span className="text-muted">—</span> : <span className="nums">{qty(r.staffMilli)}</span>) },
            ]}
            rows={detail.sales} keyOf={(r) => r.name}
            empty={<EmptyState icon={Coffee} title="لم يُصرف منه لأي صنف مباع في هذه المدة." hint="لا توجد وصفة تستخدمه، أو لم يُبع ما يستخدمه." action={<LinkButton href="/inventory/recipes" size="sm">الوصفات</LinkButton>} />}
          />
        </Section>
      </div>
    </PageShell>
  );
}
