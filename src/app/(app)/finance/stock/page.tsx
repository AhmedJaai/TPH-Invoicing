import { MONTH, PRODUCT, countNoun } from "@/lib/arabic";
import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Info, Link2, PackageCheck, Scale, ShoppingCart, Utensils } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { SignalControls } from "@/components/signal-controls";
import { Callout, DataTable, EmptyState, KeyFigure, LinkButton, LinkTabs, NoAccess, Section, type Column } from "@/components/ui";
import { BALANCE_NOTE_LABEL, PURCHASE_SOURCE_LABEL, type BalanceItem } from "@/lib/finance/stock-balance";
import { readableQuantity } from "@/lib/finance/quantity";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadFinanceAttentionFacts, stockGapKey } from "@/services/finance-attention.service";
import { loadStockBalance } from "@/services/stock-balance.service";
import { loadFlowMonths } from "@/services/stock-flow.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * المشترى والمباع — لكلّ صنف مخزون: كم اشتريتَ، كم بِيع منه، وكم يُتوقَّع أنّه بقي.
 * **بلا اشتراط جرد**؛ والجردُ إن وُجد يقول كم ضاع (`lib/finance/stock-balance.ts`).
 */
/** «فواتيرنا أكمل في 11 صنفاً، وفودكس في 28، ويتفقان في 13» — بلا «في لا أصناف» لما عددُه صفر */
function sourcesSentence(t: { invoicesBetter: number; foodicsBetter: number; sourcesAgree: number }): string {
  const parts = [
    t.invoicesBetter > 0 ? `فواتيرنا أكمل في ${countNoun(t.invoicesBetter, PRODUCT)}` : null,
    t.foodicsBetter > 0 ? `فودكس أكمل في ${countNoun(t.foodicsBetter, PRODUCT)}` : null,
    t.sourcesAgree > 0 ? `يتفقان في ${countNoun(t.sourcesAgree, PRODUCT)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` ${parts.join("، و")}.` : "";
}

export default async function FinanceStockPage({ searchParams }: { searchParams: Promise<{ month?: string; sort?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/stock");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="المشترى والمباع"><NoAccess what="تقرير المشترى والمباع" /></PageShell>;
  }
  const q = await searchParams;
  const months = await loadFlowMonths();
  const month = q.month && MONTH_RE.test(q.month) && months.includes(q.month) ? q.month : null;
  const [b, attention] = await Promise.all([loadStockBalance(month), loadFinanceAttentionFacts()]);
  const t = b.totals;
  const param = month ?? "all";
  const recurring = attention.recurring;
  const canSilence = can(user.role, "bank:edit");

  /* ما له حركةٌ أو عدّ — وما لا شيءَ له لا يملأ الجدول */
  const active = b.items.filter((x) => x.purchasedMilli !== null || (x.soldMilli ?? 0) !== 0 || x.count !== null);
  const rows = [...active].sort((a, c) =>
    Math.abs(c.lostMinor ?? 0) - Math.abs(a.lostMinor ?? 0) || Math.abs(c.expectedMinor ?? 0) - Math.abs(a.expectedMinor ?? 0) || (c.purchasedMinor ?? 0) - (a.purchasedMinor ?? 0));
  const qty = (x: BalanceItem, milli: number | null) => readableQuantity(milli, x.baseUnit);
  const short = active.filter((x) => x.notes.includes("SOLD_MORE_THAN_BOUGHT"));

  const columns: Column<BalanceItem>[] = [
    { key: "name", header: "الصنف", primary: true, cell: (x) => x.name, sortBy: (x) => x.name },
    {
      key: "purchased", header: month ? "المشترى في الشهر" : "المشترى", numeric: true,
      cell: (x) => (x.purchasedMilli === null ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : (
        <span className="block">
          <span className="nums">{qty(x, x.purchasedMilli)}</span>
          {x.purchasedMinor !== null && <span className="block text-[10px] text-muted"><Money minor={x.purchasedMinor} /></span>}
        </span>
      )),
      sortBy: (x) => x.purchasedMinor,
    },
    {
      /* الرقمان معاً منذ البداية، وأيُّهما اعتُمد — «يشوف إيش اللي أدقّ» */
      key: "sources", header: "فواتيرنا / فودكس", numeric: true, secondary: true,
      cell: (x) => (
        <span className="block text-[11px]">
          <span className={`nums block ${x.source === "INVOICES" || x.source === "SAME" ? "font-bold text-ink" : "text-muted"}`}>{x.invoicesToDateMilli === null ? "غير مربوطة" : qty(x, x.invoicesToDateMilli)}</span>
          <span className={`nums block ${x.source === "FOODICS" || x.source === "SAME" ? "font-bold text-ink" : "text-muted"}`}>{x.foodicsToDateMilli === null ? "غير مُدخل" : qty(x, x.foodicsToDateMilli)}</span>
          {x.source && <span className="block text-[10px] text-muted">{PURCHASE_SOURCE_LABEL[x.source]}</span>}
        </span>
      ),
    },
    {
      key: "sold", header: month ? "المباع في الشهر" : "المباع", numeric: true,
      cell: (x) => (x.soldMilli === null ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : (
        <span className="block">
          <span className="nums">{qty(x, x.soldMilli)}</span>
          {x.staffMilli > 0 && <span className="block text-[10px] text-muted"><T s="منها للموظفين: {0}" a={[<span key="0" className="nums">{qty(x, x.staffMilli)}</span>]} /></span>}
        </span>
      )),
      sortBy: (x) => x.soldMinor,
    },
    {
      key: "expected", header: "المتوقع بقاؤه", numeric: true,
      cell: (x) => (x.expectedMilli === null ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : x.expectedMilli < 0 ? (
        <span className="block text-[11px] text-warn"><span className="font-bold">بيع أكثر مما سُجّل شراؤه</span><span className="nums block"><T s="بزيادة {0}" a={[qty(x, -x.expectedMilli)]} /></span></span>
      ) : (
        <span className="block"><span className="nums">{qty(x, x.expectedMilli)}</span><span className="block text-[10px] text-muted"><MaybeMoney minor={x.expectedMinor} /></span></span>
      )),
      sortBy: (x) => x.expectedMinor,
    },
    {
      key: "counted", header: "المعدود", numeric: true, secondary: true,
      cell: (x) => (x.count === null ? <span className="text-[11px] text-muted">لم يُعدّ</span> : <span className="nums">{qty(x, x.count.milli)}</span>),
    },
    {
      key: "lost", header: "المفقود", numeric: true,
      cell: (x) => {
        if (x.lostMilli === null) return <span className="text-[11px] text-muted">{x.count === null ? "لا يوجد جرد يقيسه" : "—"}</span>;
        return (
          <span className="block">
            <span className="font-bold"><MaybeMoney minor={x.lostMinor} signed why="بلا تكلفة" /></span>
            <span className="nums block text-[10px] text-muted">{x.lostMilli >= 0 ? qty(x, x.lostMilli) : `وُجد أكثر بـ${qty(x, -x.lostMilli)}`}</span>
          </span>
        );
      },
      sortBy: (x) => (x.lostMinor === null ? null : Math.abs(x.lostMinor)),
    },
    {
      key: "notes", header: "ملاحظة", wrap: true, secondary: true,
      cell: (x) => (x.notes.length === 0 ? <span className="text-muted">—</span> : (
        <span className="flex flex-col items-start gap-0.5 text-[11px] text-warn">{x.notes.map((n) => <span key={n}>{BALANCE_NOTE_LABEL[n]}</span>)}</span>
      )),
    },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="المشترى والمباع"
      eyebrow={b.from ? <>{formatMonth(month ?? "")}</> : b.firstDay ? <><T s="من {0} إلى {1}" a={[<bdi key="0">{formatDay(b.firstDay)}</bdi>, <bdi key="1">{formatDay(b.to)}</bdi>]} /></> : undefined}
      intro="لكل صنف: كم اشتريت، وكم بيع منه حسب الوصفات، وكم يُتوقع أن يتبقى. وإذا عُدّ الرف، يظهر كم فُقد."
      actions={<LinkButton href="/finance/stock/links" icon={Link2} variant="secondary">اربط بنود الفواتير</LinkButton>}
    >
      <LinkTabs
        label="المدة"
        items={[
          { href: "/finance/stock", label: "كل الفترات", active: month === null },
          ...months.map((m) => ({ href: `/finance/stock?month=${m}`, label: formatMonth(m), active: m === month })),
        ]}
      />

      {t.items === 0 ? (
        /* بلا صنفٍ واحد: أربعةُ «0.00» صفرٌ عن غير علم — يُقال ما ينقص ومن أين يأتي */
        <div className="mt-5">
          <EmptyState
            icon={Boxes}
            title="لا يعرف النظام بعدُ ما اشتُري وما بيع."
            hint="المشترى من فواتيرك المربوطة بأصناف المخزون ومن مشتريات فودكس، والمباع من مبيعات فودكس ووصفاتها."
            action={<LinkButton href="/inventory/import" size="sm" variant="primary">ارفع كتالوج فودكس</LinkButton>}
          />
        </div>
      ) : (
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={ShoppingCart}
          label={month ? "المشترى في الشهر" : "المشترى"}
          value={<Money minor={t.purchasedMinor} currency />}
          sub={<><T s="من المصدرين معاً، ويُعتمد الأكمل منهما لكل صنف.{0}{1}" a={[sourcesSentence(t), b.unlinkedInvoiceMinor > 0 && <Fragment key="3"> <T s=" وهناك بنود فواتير بقيمة {0} لم تُربط بعد." a={[<Money key="0" minor={b.unlinkedInvoiceMinor} />]} /></Fragment>]} /></>}
          href="/finance/stock/links"
        />
        <KeyFigure
          icon={Utensils}
          label={month ? "المباع في الشهر" : "المباع"}
          value={<Money minor={t.soldMinor} currency />}
          sub={<><T s="حسب الوصفات والكميات المباعة، بسعر الشراء.{0}" a={[b.salesWithoutRecipeMinor > 0 && <Fragment key="0"> <T s=" لا يشمل مبيعات بلا وصفة قيمتها {0}." a={[<Money key="0" minor={b.salesWithoutRecipeMinor} />]} /></Fragment>]} /></>}
        />
        <KeyFigure
          icon={Boxes}
          label="المتوقع بقاؤه"
          value={<Money minor={t.expectedMinor} currency />}
          sub={<><T s="كل ما اشتريته منذ البداية، مطروحاً منه ما بيع والهدر المسجّل، حتى {0}." a={[<bdi key="0">{formatDay(b.to)}</bdi>]} /></>}
        />
        <KeyFigure
          icon={Scale}
          label="المفقود"
          tone={(t.lostMinor ?? 0) > 0 ? "warn" : undefined}
          value={t.lostMinor === null ? <span className="text-xl text-muted">لا يوجد جرد يقيسه</span> : <Money minor={t.lostMinor} currency />}
          sub={b.countDay
            ? <><T s="المتوقع يوم العدّ {0} مطروحاً منه ما عُدّ فعلاً، في {1}.{2}" a={[<bdi key="0">{formatDay(b.countDay)}</bdi>, countNoun(t.counted, PRODUCT), t.foundMinor !== null && t.foundMinor < 0 && <Fragment key="2"> <T s=" ووُجد في أصناف أخرى أكثر مما سُجّل شراؤه بقيمة {0}." a={[<Money key="0" minor={-t.foundMinor} />]} /></Fragment>]} /></>
            : "لم يُعدّ الرف بعد، وقد يكون «المتوقع» كله موجوداً عليه."}
          href="/inventory"
        />
      </div>
      )}

      {short.length > 0 && (
        <Callout tone="warn" icon={Info} className="mt-4" title={`${countNoun(short.length, PRODUCT)} بيع منها أكثر مما سُجّل شراؤه، بقيمة ${formatRiyalsDisplay(t.shortPurchasesMinor)} ريال`}
          action={<LinkButton href="/finance/stock/links" size="sm">اربط البنود</LinkButton>}>
          هذا ليس خطأً من المقهى، بل مشتريات لم تدخل الحساب: فاتورة لم تُربط بصنفها، أو لم تُدخل في فودكس، أو بضاعة اشتُريت قبل الافتتاح. اربط بنود الفواتير لتكتمل الصورة.
        </Callout>
      )}

      {recurring.length > 0 && (
        <Section id="recurring" title="فروق متكررة" icon={Scale} count={recurring.length} hint="أصناف يزيد فرقها على 150 ريالاً بين جردين، لشهرين متتاليين أو أكثر.">
          <ul className="space-y-2">
            {recurring.map((g) => (
              <li key={`${g.productId}${g.kind}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    <T s="{0} — {1}: {2} في {3}" a={[<Link key="0" href={`/finance/stock/item?id=${g.productId}&month=all`} className="hover:underline">{g.name}</Link>, g.kind === "SHORTAGE" ? "يخرج من الرف أكثر مما تفسّره وصفته" : "بيع منه أكثر مما اشتريت", <Money key="2" minor={g.totalMinor} />, countNoun(g.months.length, MONTH)]} /></p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    {g.months.map((m) => formatMonth(m)).join(" · ")}.{" "}
                    {g.kind === "SHORTAGE" ? "راجع الوصفة وتأكد أنها تطابق ما يُصرف فعلاً، وسجّل الهدر حين يحدث." : "ربما توجد فاتورة ناقصة. افتح الصنف وراجع فواتيره."}
                  </p>
                </div>
                {canSilence && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1"><SignalControls signalKey={stockGapKey(g.productId, g.kind)} dismissLabel="أعرف السبب" snoozeDays={30} /></div>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="الأصناف" icon={PackageCheck} count={rows.length} hint="مرتبة حسب قيمة المفقود ثم قيمة المتوقع، بالريال لا بالنسبة.">
        <DataTable
          columns={columns} rows={rows} keyOf={(x) => x.productId} sort={q.sort ?? null}
          hrefOf={(x) => `/finance/stock/item?id=${x.productId}&month=${param}`}
          searchOf={(x) => x.name}
        />
      </Section>

      <Callout tone="info" icon={Info} className="mt-6" title="كيف تقرأ الأرقام">
        <ul className="list-disc space-y-0.5 ps-4">
          <li><T s="{0}، منذ البداية، ولا يحتاج إلى جرد." a={[<strong key="0" className="text-ink">المتوقع بقاؤه = كل ما اشتريته − كل ما بيع منه − الهدر المسجّل</strong>]} /></li>
          <li><T s="{0}. قد يكون هدراً لم يُسجَّل، أو كمية أكبر من الوصفة، أو تسريباً، والبيانات وحدها لا تحدد السبب." a={[<strong key="0" className="text-ink">المفقود = المتوقع يوم العدّ − ما عُدّ على الرف</strong>]} /></li>
          <li><T s="تُحسب المشتريات من {0} ومن {1} معاً، ويُعتمد الأكمل منهما، لأن المشتريات قد تسقط من أحد السجلين لكنها لا تظهر فيه من لا شيء. يعرض عمود «فواتيرنا / فودكس» الرقمين منذ البداية، والرقم الغامق هو المعتمد." a={[<strong key="0" className="text-ink">فواتيرنا المربوطة</strong>, <strong key="1" className="text-ink">ما أُدخل في فودكس</strong>]} /></li>
          <li>الوحدة والعبوة من كتالوج فودكس، وكل بند فاتورة تربطه يُكمل سجل صنفه.</li>
        </ul>
      </Callout>
    </PageShell>
  );
}
