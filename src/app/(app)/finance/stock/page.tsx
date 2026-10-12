import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Info, Link2, PackageCheck, Scale, ShoppingCart, Utensils } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { MaybeMoney } from "@/components/finance-bits";
import { SignalControls } from "@/components/signal-controls";
import { Callout, DataTable, KeyFigure, LinkButton, LinkTabs, NoAccess, Section, type Column } from "@/components/ui";
import { BALANCE_NOTE_LABEL, PURCHASE_SOURCE_LABEL, type BalanceItem } from "@/lib/finance/stock-balance";
import { readableQuantity } from "@/lib/finance/quantity";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadFinanceAttentionFacts, stockGapKey } from "@/services/finance-attention.service";
import { loadStockBalance } from "@/services/stock-balance.service";
import { loadFlowMonths } from "@/services/stock-flow.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * المشترى والمباع — لكلّ صنف مخزون: كم اشتريتَ، كم بِيع منه، وكم يُتوقَّع أنّه بقي.
 * **بلا اشتراط جرد**؛ والجردُ إن وُجد يقول كم ضاع (`lib/finance/stock-balance.ts`).
 */
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
      key: "purchased", header: month ? "اشتُري في الشهر" : "اشتُري", numeric: true,
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
      key: "sources", header: "فواتيرُنا / فودكس", numeric: true, secondary: true,
      cell: (x) => (
        <span className="block text-[11px]">
          <span className={`nums block ${x.source === "INVOICES" || x.source === "SAME" ? "font-bold text-ink" : "text-muted"}`}>{x.invoicesToDateMilli === null ? "لم تُربَط" : qty(x, x.invoicesToDateMilli)}</span>
          <span className={`nums block ${x.source === "FOODICS" || x.source === "SAME" ? "font-bold text-ink" : "text-muted"}`}>{x.foodicsToDateMilli === null ? "لم يُدخَل" : qty(x, x.foodicsToDateMilli)}</span>
          {x.source && <span className="block text-[10px] text-muted">{PURCHASE_SOURCE_LABEL[x.source]}</span>}
        </span>
      ),
    },
    {
      key: "sold", header: month ? "بِيع منه في الشهر" : "بِيع منه", numeric: true,
      cell: (x) => (x.soldMilli === null ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : (
        <span className="block">
          <span className="nums">{qty(x, x.soldMilli)}</span>
          {x.staffMilli > 0 && <span className="block text-[10px] text-muted">منه موظّفون: <span className="nums">{qty(x, x.staffMilli)}</span></span>}
        </span>
      )),
      sortBy: (x) => x.soldMinor,
    },
    {
      key: "expected", header: "المتوقَّع متبقّياً", numeric: true,
      cell: (x) => (x.expectedMilli === null ? <span className="text-[11px] font-bold text-ink-soft">غير معروف</span> : x.expectedMilli < 0 ? (
        <span className="block text-[11px] text-warn"><span className="font-bold">بِيع أكثر ممّا سُجّل شراؤه</span><span className="nums block">بـ{qty(x, -x.expectedMilli)}</span></span>
      ) : (
        <span className="block"><span className="nums">{qty(x, x.expectedMilli)}</span><span className="block text-[10px] text-muted"><MaybeMoney minor={x.expectedMinor} /></span></span>
      )),
      sortBy: (x) => x.expectedMinor,
    },
    {
      key: "counted", header: "المعدود", numeric: true, secondary: true,
      cell: (x) => (x.count === null ? <span className="text-[11px] text-muted">لم يُعَدّ</span> : <span className="nums">{qty(x, x.count.milli)}</span>),
    },
    {
      key: "lost", header: "الضائع", numeric: true,
      cell: (x) => {
        if (x.lostMilli === null) return <span className="text-[11px] text-muted">{x.count === null ? "لا عدَّ يقيسه" : "—"}</span>;
        return (
          <span className="block">
            <span className="font-bold"><MaybeMoney minor={x.lostMinor} signed why="لا كلفة" /></span>
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
      eyebrow={b.from ? <>{formatMonth(month ?? "")}</> : b.firstDay ? <>منذ <bdi>{formatDay(b.firstDay)}</bdi> حتى <bdi>{formatDay(b.to)}</bdi></> : undefined}
      intro="لكلّ صنف: كم اشتريتَ، كم بِيع منه بحسب وصفاته، وكم يُتوقَّع أنّه بقي. وحيث عُدّ الرفّ: كم ضاع."
      actions={<LinkButton href="/finance/stock/links" icon={Link2} variant="secondary">اربط بنودَ الفواتير</LinkButton>}
    >
      <LinkTabs
        label="المدّة"
        items={[
          { href: "/finance/stock", label: "كلّ الوقت", active: month === null },
          ...months.map((m) => ({ href: `/finance/stock?month=${m}`, label: formatMonth(m), active: m === month })),
        ]}
      />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KeyFigure
          icon={ShoppingCart}
          label={month ? "اشتُري في الشهر" : "اشتُري"}
          value={<Money minor={t.purchasedMinor} currency />}
          sub={<>من المصدرين معاً، ويُعتمَد أكملُهما لكلّ صنف: فواتيرُنا أكمل في <strong className="text-ink">{t.invoicesBetter}</strong>، وفودكس في <strong className="text-ink">{t.foodicsBetter}</strong>، واتّفقا في {t.sourcesAgree}.{b.unlinkedInvoiceMinor > 0 && <> بنودُ فواتير بـ<Money minor={b.unlinkedInvoiceMinor} /> لم تُربَط بعد.</>}</>}
          href="/finance/stock/links"
        />
        <KeyFigure
          icon={Utensils}
          label={month ? "بِيع منه في الشهر" : "بِيع منه"}
          value={<Money minor={t.soldMinor} currency />}
          sub={<>الوصفات × ما بِيع، بسعر الشراء.{b.salesWithoutRecipeMinor > 0 && <> خارجه مبيعاتٌ بلا وصفة <Money minor={b.salesWithoutRecipeMinor} />.</>}</>}
        />
        <KeyFigure
          icon={Boxes}
          label="المتوقَّع متبقّياً"
          value={<Money minor={t.expectedMinor} currency />}
          sub={<>كلُّ ما اشتُري منذ البداية ناقصاً كلَّ ما بِيع والهدرَ المسجَّل، حتى <bdi>{formatDay(b.to)}</bdi>.</>}
        />
        <KeyFigure
          icon={Scale}
          label="الضائع"
          tone={(t.lostMinor ?? 0) > 0 ? "warn" : undefined}
          value={t.lostMinor === null ? <span className="text-xl text-muted">لا عدَّ يقيسه</span> : <Money minor={t.lostMinor} currency />}
          sub={b.countDay
            ? <>المتوقَّع يومَ عدّ <bdi>{formatDay(b.countDay)}</bdi> ناقصاً ما عُدّ، في {t.counted} صنفاً.{t.foundMinor !== null && t.foundMinor < 0 && <> ووُجد في غيرها أكثر ممّا سُجّل شراؤه بـ<Money minor={-t.foundMinor} />.</>}</>
            : "لا عدَّ للرفّ بعد. «المتوقَّع» قد يكون كلُّه على الرفّ."}
          href="/inventory"
        />
      </div>

      {short.length > 0 && (
        <Callout tone="warn" icon={Info} className="mt-4" title={`${short.length} صنفاً بِيع منه أكثر ممّا سُجّل شراؤه — بقيمة ${formatRiyalsDisplay(t.shortPurchasesMinor)} ريال`}
          action={<LinkButton href="/finance/stock/links" size="sm">اربط البنود</LinkButton>}>
          ليس خطأً في المقهى: شراءٌ لم يدخل الحساب — فاتورةٌ لم تُربَط بصنفها، أو لم تُدخَل في فودكس، أو بضاعةٌ اشتُريت قبل الافتتاح. اربط بنودَ الفواتير فيكتمل.
        </Callout>
      )}

      {recurring.length > 0 && (
        <Section id="recurring" title="فروقٌ تتكرّر" icon={Scale} count={recurring.length} hint="صنفٌ فرقُه بين عدٍّ وعدّ فوق مئةٍ وخمسين ريالاً شهرين متتاليين فأكثر.">
          <ul className="space-y-2">
            {recurring.map((g) => (
              <li key={`${g.productId}${g.kind}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-bold">
                    <Link href={`/finance/stock/item?id=${g.productId}&month=all`} className="hover:underline">{g.name}</Link>
                    {" — "}{g.kind === "SHORTAGE" ? "يخرج من الرفّ أكثر ممّا تفسّره وصفتُه" : "بِيع منه أكثر ممّا اشتُري"}: <Money minor={g.totalMinor} /> في {g.months.length} أشهر
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                    {g.months.map((m) => formatMonth(m)).join(" · ")}.{" "}
                    {g.kind === "SHORTAGE" ? "راجِع الوصفة: أتطابق ما يُصرَف فعلاً؟ وسجِّل الهدرَ حين يقع." : "فاتورةٌ ناقصة؟ افتح الصنفَ وراجِع فواتيرَه."}
                  </p>
                </div>
                {canSilence && <div className="flex shrink-0 flex-wrap items-center gap-1"><SignalControls signalKey={stockGapKey(g.productId, g.kind)} dismissLabel="أعرف سببَه" snoozeDays={30} /></div>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="الأصناف" icon={PackageCheck} count={rows.length} hint="مرتَّبةٌ بقيمة الضائع ثمّ بقيمة المتوقَّع — بالريال لا بالنسبة.">
        <DataTable
          columns={columns} rows={rows} keyOf={(x) => x.productId} sort={q.sort ?? null}
          hrefOf={(x) => `/finance/stock/item?id=${x.productId}&month=${param}`}
          searchOf={(x) => x.name}
        />
      </Section>

      <Callout tone="info" icon={Info} className="mt-6" title="كيف يُقرأ">
        <ul className="list-disc space-y-0.5 ps-4">
          <li><strong className="text-ink">المتوقَّع متبقّياً = كلُّ ما اشتُري − كلُّ ما بِيع منه − الهدر المسجَّل</strong>، منذ البداية. لا يحتاج جرداً.</li>
          <li><strong className="text-ink">الضائع = المتوقَّع يومَ العدّ − ما عُدّ على الرفّ</strong>. قد يكون هدراً لم يُسجَّل، أو جرعةً أكبر من الوصفة، أو تسريباً — البياناتُ لا تحسم.</li>
          <li>المشترى يُحسَب من <strong className="text-ink">فواتيرنا المربوطة</strong> ومن <strong className="text-ink">ما أُدخل في فودكس</strong> معاً، ويُعتمَد أكملُهما: الشراءُ يسقط من سجلٍّ ولا يُخترَع فيه. والرقمان في عمود «فواتيرُنا / فودكس» منذ البداية، والغامقُ ما اعتُمد.</li>
          <li>الوحدةُ والعبوةُ من كتالوج فودكس. وكلُّ بندِ فاتورةٍ تربطه يُكمل سجلَّ صنفه.</li>
        </ul>
      </Callout>
    </PageShell>
  );
}
