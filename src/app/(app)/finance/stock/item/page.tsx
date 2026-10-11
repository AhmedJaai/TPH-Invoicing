import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Coffee, Info, Receipt, Scale } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { Callout, Card, DataTable, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { COST_BASIS_LABEL, FLOW_MISSING_HREF, FLOW_MISSING_LABEL, type FlowItem } from "@/lib/finance/stock-flow";
import { readableQuantity } from "@/lib/finance/quantity";
import { formatUnits } from "@/lib/finance/format";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadCumulativeStockFlow, loadFlowMonths, loadItemDetail, loadMonthStockFlow, loadMonthWindow } from "@/services/stock-flow.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** كم شهراً يُعرَض في الاتّجاه. */
const TREND_MONTHS = 6;

/**
 * صنفٌ واحد: المعادلةُ بأطرافها، وما كوّن كلَّ طرف — فواتيرُه، وما بِيع فصرف منه —
 * واتّجاهُه عبر الأشهر. الرقمُ في تقرير «المشترى والمباع» ينتهي هنا.
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
  const cumulative = q.month === "all";
  const month = !cumulative && q.month && MONTH_RE.test(q.month) ? q.month : months[1] ?? months[0];
  if (!month && !cumulative) redirect("/finance/stock");

  const whole = cumulative ? await loadCumulativeStockFlow() : null;
  const window = cumulative && whole ? whole.window : await loadMonthWindow(month ?? "");
  const detail = await loadItemDetail(q.id, window);
  const item = detail.item;
  const back = <LinkButton href={`/finance/stock?month=${cumulative ? "all" : month}`} variant="quiet" size="sm" icon={ArrowRight}>المشترى والمباع</LinkButton>;
  if (!item) {
    return (
      <PageShell user={user} title="صنفٌ غير موجود" actions={back}>
        <EmptyState icon={Info} title="هذا الصنفُ ليس بين أصناف المخزون السارية." />
      </PageShell>
    );
  }

  /* اتّجاهُه: الأشهرُ الأخيرة واحداً واحداً — الخدمةُ نفسُها، فالرقمُ هو رقمُ تقرير شهره */
  const trend: { month: string; item: FlowItem | null }[] = [];
  for (const m of months.slice(0, TREND_MONTHS)) {
    const flow = await loadMonthStockFlow(m);
    trend.push({ month: m, item: flow.items.find((x) => x.productId === item.productId) ?? null });
  }

  const unit = item.baseUnit;
  const qty = (milli: number | null) => readableQuantity(milli, unit);
  /* فرقُ الشاهد يُؤخَذ موجباً وحده: سالبُه يقول إنّ الشراءَ لم يُدخَل في فودكس لا أكثر */
  const witnessOk = item.witnessUnexplainedMilli !== null && item.witnessUnexplainedMilli >= 0;
  const gapMilli = item.unexplainedMilli ?? (witnessOk ? item.witnessUnexplainedMilli : null);
  const gapMinor = item.unexplainedMinor ?? (witnessOk ? item.witnessUnexplainedMinor : null);
  const byWitness = item.unexplainedMilli === null && witnessOk;
  const terms: { label: string; value: string; note?: string; sign: string }[] = [
    { sign: "", label: "أوّل الفترة", value: qty(item.openingMilli), note: item.openingMilli === null ? "لم يُعَدّ" : `عدّ ${formatDay(window.openingCountDay ?? window.from)}` },
    { sign: "+", label: byWitness ? "المشترى (فودكس)" : "المشترى", value: byWitness ? qty(item.witnessPurchasedMilli) : qty(item.purchasedKnownMilli), note: byWitness ? "فواتيرُنا لم تُربَط كلُّها — شاهد" : item.purchasedKnownMilli === null ? "غير معروف من فواتيرنا" : `${detail.purchases.length} بندَ فاتورة` },
    { sign: "−", label: "المباع منه نظريّاً", value: qty(item.consumed?.milli ?? null), note: item.consumed === null ? "لا وصفةَ تصل إليه" : `${detail.sales.length} صنفاً يُباع يصرف منه` },
    { sign: "−", label: "هدرٌ مسجَّل", value: qty(item.wasteMilli), note: item.witnessWasteMilli ? `فودكس سجّل ${qty(item.witnessWasteMilli)}` : undefined },
    { sign: "−", label: "آخر الفترة", value: qty(item.closingMilli), note: item.closingMilli === null ? "لم يُعَدّ" : `عدّ ${formatDay(window.closingCountDay ?? window.to)}` },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title={item.name}
      eyebrow={<>من <bdi>{formatDay(window.from)}</bdi> إلى <bdi>{formatDay(window.to)}</bdi>{cumulative ? " — تراكميّ" : ` — ${formatMonth(month ?? "")}`}</>}
      actions={back}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-5">
        {terms.map((t) => (
          <Card key={t.label}>
            <p className="text-[11px] font-bold text-muted">{t.sign && <span aria-hidden className="me-1">{t.sign}</span>}{t.label}</p>
            <p className="nums mt-1.5 text-[15px] font-semibold">{t.value}</p>
            {t.note && <p className="mt-1 text-[11px] text-muted">{t.note}</p>}
          </Card>
        ))}
      </div>

      <div className={`mt-3 rounded-2xl border px-4 py-3.5 ${gapMilli === null ? "border-line bg-raised" : gapMilli < 0 ? "border-warn/30 bg-warn-bg" : "border-line bg-raised shadow-raised"}`}>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="flex items-center gap-2 font-bold"><Scale className="h-4 w-4" strokeWidth={2} aria-hidden /> الفرق غير المفسَّر{byWitness && " — بمشتريات فودكس"}</span>
          {gapMilli === null ? <span className="font-bold text-ink-soft">غير معروف</span> : (
            <>
              <span className="nums text-base font-semibold">{qty(gapMilli)}</span>
              <span>= <strong><MaybeMoney minor={gapMinor} signed why="لا كلفةَ معروفة" /></strong></span>
              {item.costBasis && <span className="text-[11px] text-muted">بسعر: {COST_BASIS_LABEL[item.costBasis]}</span>}
            </>
          )}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
          {gapMilli === null ? (
            <>لا يُحسَب حتى يكتمل: {item.missing.map((m, i) => <span key={m}>{i > 0 && " · "}<Link href={FLOW_MISSING_HREF[m]} className="font-bold text-accent hover:underline">{FLOW_MISSING_LABEL[m]}</Link></span>)}.</>
          ) : gapMilli > 0 ? (
            "خرج من الرفّ أكثر ممّا تفسّره الوصفات. قد يكون هدراً لم يُسجَّل، أو وصفةً أصغر من الواقع (جرعةٌ أكبر، تجربةُ ضبط)، أو عدّاً ناقصاً، أو تسريباً. البياناتُ لا تحسم أيَّها."
          ) : gapMilli < 0 ? (
            "استُهلك نظريّاً أكثر من المتاح — خطأُ بياناتٍ لا ربح: فاتورةُ شراءٍ لم تُقيَّد أو لم تُربَط، أو وصفةٌ تقول أكثر ممّا يُصرَف، أو عدٌّ أوّلَ الفترة ناقص."
          ) : "لا فرق: ما اشتُري يساوي ما بِيع وما بقي."}
        </p>
        {item.surplusMilli !== null && gapMilli === null && (
          <p className="mt-1.5 text-xs text-ink-soft">مشترى {item.surplusMilli >= 0 ? "أكثر" : "أقلّ"} من المباع بـ<strong className="nums">{qty(Math.abs(item.surplusMilli))}</strong> — لا جرد يفصل المخزون عن الفاقد.</p>
        )}
      </div>

      {item.witnessConsumedMilli !== null && item.consumed !== null && item.witnessConsumedMilli !== item.consumed.milli && (
        <Callout tone="info" icon={Info} className="mt-4" title="وصفتُنا ووصفةُ فودكس لا تتّفقان على هذا الصنف">
          صرفنا النظريّ <strong className="nums">{qty(item.consumed.milli)}</strong> وصرفُ فودكس <strong className="nums">{qty(item.witnessConsumedMilli)}</strong> للمبيعات نفسِها.
          إحداهما أحدثُ من الأخرى، أو صنفٌ يُباع له وصفةٌ عندنا وليست عنده. <Link href="/inventory/recipes" className="font-bold text-accent hover:underline">راجِع الوصفات</Link>.
        </Callout>
      )}

      <Section title="اتّجاهُه عبر الأشهر" icon={Scale} hint="كلُّ شهرٍ من عدٍّ إلى عدّ — الأرقامُ أرقامُ تقرير شهره.">
        <DataTable
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (r) => formatMonth(r.month) },
            { key: "bought", header: "المشترى", numeric: true, cell: (r) => (r.item ? <span className="nums">{qty(r.item.purchasedKnownMilli ?? r.item.witnessPurchasedMilli)}{r.item.purchasedKnownMilli === null && r.item.witnessPurchasedMilli !== null && <span className="ms-1 text-[10px] text-muted">فودكس</span>}</span> : "—") },
            { key: "used", header: "المباع منه", numeric: true, cell: (r) => (r.item ? <span className="nums">{qty(r.item.consumed?.milli ?? null)}</span> : "—") },
            { key: "gap", header: "الفرق", numeric: true, cell: (r) => { const g = r.item ? r.item.unexplainedMilli ?? r.item.witnessUnexplainedMilli : null; return g === null ? <span className="text-[11px] text-muted">غير معروف</span> : <span className="nums">{qty(g)}</span>; } },
            { key: "value", header: "بالريال", numeric: true, cell: (r) => <MaybeMoney minor={r.item ? r.item.unexplainedMinor ?? r.item.witnessUnexplainedMinor : null} signed /> },
          ]}
          rows={trend} keyOf={(r) => r.month}
          hrefOf={(r) => `/finance/stock/item?id=${item.productId}&month=${r.month}`}
        />
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 lg:grid-cols-2">
        <Section title="فواتيرُه في الفترة" icon={Receipt} count={detail.purchases.length}>
          <DataTable
            columns={[
              { key: "supplier", header: "المورّد", primary: true, cell: (r) => r.supplierName || "استلامٌ يدويّ" },
              { key: "day", header: "اليوم", cell: (r) => <bdi>{formatDay(r.day)}</bdi> },
              { key: "qty", header: "الكمّيّة", numeric: true, cell: (r) => (r.canonicalMilli === null ? <span className="text-[11px] text-warn">غير معروفة</span> : <span className="nums">{qty(r.canonicalMilli)}</span>) },
              { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <Money minor={r.lineTotalMinor} /> },
            ]}
            rows={detail.purchases} keyOf={(r) => r.lineId}
            hrefOf={(r) => (r.invoiceId && r.invoiceNumber ? `/purchases/invoices/${r.invoiceId}` : undefined)}
            empty={<EmptyState icon={Receipt} title="لا بندَ فاتورةٍ مربوطاً به في الفترة." hint="إن اشتُري فبندُه لم يُربَط بعد." action={<LinkButton href="/finance/stock/links" size="sm">اربط بنودَ الفواتير</LinkButton>} />}
          />
        </Section>
        <Section title="ما بِيع فصرف منه" icon={Coffee} count={detail.sales.length} hint="الأصنافُ المباعة التي تذكره وصفتُها، وما استهلكته منه.">
          <DataTable
            columns={[
              { key: "name", header: "الصنف المباع", primary: true, cell: (r) => r.name },
              { key: "sold", header: "بِيع", numeric: true, cell: (r) => <span className="nums">{formatUnits(r.soldMilli)}</span> },
              { key: "used", header: "صرف منه", numeric: true, cell: (r) => <span className="nums">{qty(r.usedMilli)}</span> },
              { key: "staff", header: "منه موظّفون", numeric: true, secondary: true, cell: (r) => (r.staffMilli === 0 ? <span className="text-muted">—</span> : <span className="nums">{qty(r.staffMilli)}</span>) },
            ]}
            rows={detail.sales} keyOf={(r) => r.name}
            empty={<EmptyState icon={Coffee} title="لا صنفَ مباعاً يصرف منه في الفترة." hint="لا وصفةَ تذكره، أو لم يُبَع ما يصل إليه." action={<LinkButton href="/inventory/recipes" size="sm">الوصفات</LinkButton>} />}
          />
        </Section>
      </div>
    </PageShell>
  );
}
