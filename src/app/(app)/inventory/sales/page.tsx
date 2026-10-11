import { redirect } from "next/navigation";
import { Ban, CalendarDays, CircleAlert, Coffee, Info, ReceiptText, ShoppingBag, TrendingDown, Upload } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import {
  Badge, Callout, DataTable, Delta, EmptyState, KeyFigure, LinkButton, LinkTabs, NoAccess, Section, Sparkline,
} from "@/components/ui";
import { DAY, PRODUCT, countNoun } from "@/lib/arabic";
import { formatDay, formatRange, formatWeekday } from "@/lib/riyadh-time";
import {
  COMPARE_MIN_WEEKS, LEAK_LABEL, SPIKE_MULTIPLE, changeBp, formatShare, formatUnits,
  type DayRow, type LeakTotal, type MenuRow,
} from "@/lib/sales/overview";
import { PERIOD_CHOICES, loadSalesOverview, parsePeriod } from "@/services/sales-overview.service";

export const dynamic = "force-dynamic";

const PERIOD_LABEL: Record<number, string> = { 7: "٧ أيّام", 28: "٢٨ يوماً", 90: "٩٠ يوماً" };
/** كم صنفاً يُعرض ممّا توقّف بيعُه. */
const STOPPED_SHOWN = 12;

/**
 * المبيعات — ما استُورد من ملفّ فودكس، يوماً بيوم وصنفاً بصنف.
 *
 * قراءةٌ لما هو مخزَّن (`lib/sales/overview.ts`): اليومُ بلا ملفٍّ «غير مستورَد» لا
 * صفر، والتغطيةُ فوق الأرقام، والمقارنةُ تُحجَب حين تنقص تغطيةُ إحدى الفترتين.
 * لا كلفةَ ولا هامش هنا — ذاك يحتاج وصفاتٍ كاملةَ الكلفة.
 */
export default async function SalesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/sales");
  if (!can(user.role, "inventory:view") || !can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="المبيعات">
        <NoAccess what="المبيعات" />
      </PageShell>
    );
  }

  const period = parsePeriod((await searchParams).days);
  const o = await loadSalesOverview(period);
  const canImport = can(user.role, "inventory:count");

  if (o.lastDay === null) {
    return (
      <PageShell user={user} width="wide" title="المبيعات" intro="من ملفّ فودكس الذي ترفعه — لا من تقدير.">
        <EmptyState
          icon={ShoppingBag}
          title="لم يُستورَد ملفُّ مبيعاتٍ بعد."
          hint="تُقرأ المبيعاتُ من ملفّ فودكس الحقيقيّ وحده، ولا يُعرض هنا رقمٌ قبل أن يُرفع ملفّ — صفرٌ هنا يقول إنّ المقهى لم يبع شيئاً. صدِّر تقريرَ المبيعات من فودكس وارفعه."
          action={canImport ? <LinkButton href="/inventory/import" variant="primary" icon={Upload}>استورد مبيعات فودكس</LinkButton> : undefined}
        />
      </PageShell>
    );
  }

  const c = o.current;
  const partial = c.coveredDays < c.expectedDays;
  const deltaBp = o.canCompare && c.salesMinor !== null ? changeBp(c.salesMinor, o.previous.salesMinor) : null;
  const perDayMinor = c.salesMinor !== null && c.coveredDays > 0 ? Math.round(c.salesMinor / c.coveredDays) : null;
  /* الخطُّ من الأقدم إلى الأحدث — واليومُ غير المستورَد يقطعه ولا يُرسَم صفراً */
  const trail = [...c.rows].reverse().map((r) => r.salesMinor);

  return (
    <PageShell
      user={user}
      width="wide"
      title="المبيعات"
      eyebrow={
        <span className={partial ? "font-bold text-warn" : ""}>
          {partial && <CircleAlert className="me-1 inline-block h-3.5 w-3.5 align-[-2px]" strokeWidth={2} aria-hidden />}
          {formatRange(c.from, c.to)} — مستورَدٌ {c.coveredDays} من {countNoun(c.expectedDays, DAY)}
        </span>
      }
      intro="ما بِعتَه كما في ملفّ فودكس المستورَد: يوماً بيوم، وصنفاً بصنف، وما خرج بلا مال. الفترةُ تنتهي عند آخر يومٍ مستورَد."
      actions={canImport ? <LinkButton href="/inventory/import" icon={Upload} variant="secondary">استورد ملفّاً</LinkButton> : undefined}
    >
      <div className="mb-5">
        <LinkTabs
          label="الفترة"
          items={PERIOD_CHOICES.map((p) => ({ href: p === 28 ? "/inventory/sales" : `/inventory/sales?days=${p}`, label: `آخر ${PERIOD_LABEL[p]}`, active: p === period }))}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={ShoppingBag}
          label="المبيعات في الفترة"
          value={c.salesMinor === null ? <span className="text-xl text-muted">غير مستورَد</span> : <Money minor={c.salesMinor} />}
          delta={o.canCompare ? (deltaBp === null ? null : deltaBp / 100) : undefined}
          sub={
            c.salesMinor === null
              ? "لا ملفَّ يغطّي هذه الأيّام."
              : partial
                ? `مجموعُ ${countNoun(c.coveredDays, DAY)} مستورَدة وحدها — وينقصها ${countNoun(c.expectedDays - c.coveredDays, DAY)}، فلا تُقارَن بما قبلها.`
                : o.canCompare
                  ? "مقابل الفترة التي قبلها بطولها."
                  : "الفترةُ السابقة ناقصةُ التغطية — بلا مقارنة."
          }
        >
          <Sparkline values={trail} label="المبيعات يوماً بيوم" className="h-8 w-full" />
        </KeyFigure>
        <KeyFigure
          icon={CalendarDays}
          label="متوسّطُ اليوم المستورَد"
          value={perDayMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={perDayMinor} />}
          sub={
            o.hasOrders && c.orders
              ? <>من <span className="nums nums-count">{c.orders.toLocaleString("en-US")}</span> طلباً — متوسّطُ الطلب <Money minor={Math.round((c.salesMinor ?? 0) / c.orders)} /></>
              : "الملفُّ المستورَد تقريرُ أصنافٍ مجمَّع لا يحمل الطلبات — فلا متوسّطَ طلبٍ ولا ساعات."
          }
          href="#days"
        />
        <KeyFigure
          icon={Ban}
          tone={o.leaks.spikes.length > 0 ? "warn" : undefined}
          label="خرج بلا مال"
          value={<Money minor={o.leaks.valueMinor} />}
          sub={
            o.leaks.valueMinor === 0
              ? "لا ملغى ولا مرتجع ولا مجّانيّ في الأيّام المستورَدة."
              : <>ملغى ومرتجع وضيافة — {formatShare(o.leaks.ofSalesBp)} من المبيعات{o.leaks.spikes.length > 0 && <> · وقفزةٌ في {countNoun(o.leaks.spikes.length, DAY)}</>}</>
          }
          href="#leaks"
        />
      </div>

      {c.missingDays.length > 0 && (
        <Callout
          tone="warn"
          icon={CircleAlert}
          className="mt-4"
          title={`${countNoun(c.missingDays.length, DAY)} من الفترة بلا ملفّ`}
          action={canImport ? <LinkButton href="/inventory/import" variant="primary" size="sm" icon={Upload}>استورد ما ينقص</LinkButton> : undefined}
        >
          {c.missingDays.slice(0, 8).map((d) => formatDay(d)).join("، ")}
          {c.missingDays.length > 8 && ` وغيرها (${c.missingDays.length - 8})`} — تُعرض «غير مستورَد» لا صفراً، ولا تدخل مجموعاً ولا متوسّطاً.
        </Callout>
      )}

      {/* ── يوماً بيوم ── */}
      <Section
        id="days"
        title="يوماً بيوم"
        icon={CalendarDays}
        hint={`«عادتُه» وسيطُ مثل هذا اليوم من الأسابيع الأربعة السابقة — وتُحجَب دون ${COMPARE_MIN_WEEKS === 2 ? "أسبوعين مستورَدين" : `${COMPARE_MIN_WEEKS} أسابيع مستورَدة`}.`}
      >
        <DataTable<DayRow>
          rows={c.rows}
          keyOf={(r) => r.day}
          columns={[
            {
              key: "day",
              header: "اليوم",
              primary: true,
              cell: (r) => (
                <span>
                  <span className="font-bold"><bdi>{formatDay(r.day)}</bdi></span>
                  <span className="ms-2 text-xs text-muted">{formatWeekday(r.day)}</span>
                </span>
              ),
            },
            { key: "sales", header: "المبيعات", numeric: true, cell: (r) => (r.salesMinor === null ? <Badge tone="warn">غير مستورَد</Badge> : <Money minor={r.salesMinor} />) },
            { key: "usual", header: "عادتُه", numeric: true, secondary: true, cell: (r) => (r.usualMinor === null ? <span className="text-muted">—</span> : <Money minor={r.usualMinor} />) },
            {
              key: "vs",
              header: "عن عادته",
              align: "end",
              cell: (r) => (r.salesMinor === null ? <span className="text-muted">—</span> : <Delta pct={r.vsUsualBp === null ? null : r.vsUsualBp / 100} favourable={r.vsUsualBp === null || r.vsUsualBp === 0 ? null : r.vsUsualBp > 0} />),
            },
            { key: "vat", header: "ضريبتُها في الملفّ", numeric: true, secondary: true, cell: (r) => (r.vatMinor === null ? <span className="text-muted">—</span> : <Money minor={r.vatMinor} />) },
            ...(o.hasOrders
              ? [{ key: "orders", header: "الطلبات", numeric: true, secondary: true, cell: (r: DayRow) => (r.orders === null ? <span className="text-muted">—</span> : <span className="nums nums-count">{r.orders}</span>) }]
              : []),
          ]}
        />
      </Section>

      {/* ── ما يُباع ── */}
      <Section
        id="menu"
        title="ما يُباع وما يحمل المبيعات"
        icon={Coffee}
        count={o.menu.rows.length}
        hint={
          o.menu.carry80 > 0
            ? `${countNoun(o.menu.carry80, PRODUCT)} من ${o.menu.rows.length} تحمل ٨٠٪ من مبيعات الفترة. الإضافاتُ (الخيارات) مشمولةٌ في سعر أصلها ولا تُعدّ صنفاً.`
            : "الإضافاتُ (الخيارات) مشمولةٌ في سعر أصلها ولا تُعدّ صنفاً."
        }
      >
        <DataTable<MenuRow>
          rows={o.menu.rows}
          keyOf={(r) => r.key}
          searchOf={(r) => `${r.name} ${r.category ?? ""}`}
          columns={[
            {
              key: "name",
              header: "الصنف",
              primary: true,
              cell: (r) => (
                <span className="min-w-0">
                  <span className="block truncate font-bold">{r.name}</span>
                  {r.category && <span className="block text-[11px] text-muted">{r.category}</span>}
                </span>
              ),
            },
            { key: "qty", header: "الكمّيّة", numeric: true, cell: (r) => <span className="nums nums-count">{formatUnits(r.quantityMilli)}</span> },
            { key: "sales", header: "المبيعات", numeric: true, cell: (r) => <Money minor={r.salesMinor} /> },
            { key: "share", header: "حصّتُه", numeric: true, cell: (r) => <span className="nums nums-count">{formatShare(r.shareBp)}</span> },
            { key: "cum", header: "تراكميّاً", numeric: true, secondary: true, cell: (r) => <span className="nums nums-count text-muted">{formatShare(r.cumulativeBp)}</span> },
            ...(o.canCompare
              ? [{
                  key: "trend",
                  header: "عن الفترة السابقة",
                  align: "end" as const,
                  secondary: true,
                  cell: (r: MenuRow) =>
                    r.previousMinor === 0
                      ? <Badge tone="info">جديد</Badge>
                      : <Delta pct={r.trendBp === null ? null : r.trendBp / 100} favourable={r.trendBp === null || r.trendBp === 0 ? null : r.trendBp > 0} />,
                }]
              : []),
          ]}
        />
        {!o.canCompare && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            اتّجاهُ كلّ صنفٍ وما توقّف بيعُه يُعرضان حين تكتمل تغطيةُ هذه الفترة والتي قبلها — مقارنةُ فترةٍ كاملة بناقصة تكذب.
          </p>
        )}
      </Section>

      {o.menu.stopped !== null && o.menu.stopped.length > 0 && (
        <Section
          title="بيع في الفترة السابقة ولم يُبَع في هذه"
          icon={TrendingDown}
          count={o.menu.stopped.length}
          hint="مرشّحٌ للمراجعة: خرج من القائمة، أو نفد مكوّنُه، أو تغيّر اسمُه في فودكس — ومكوّناتُه إن بقيت مخزونٌ راكد."
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {o.menu.stopped.slice(0, STOPPED_SHOWN).map((i) => (
              <li key={i.key} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-2.5 shadow-raised">
                <span className="min-w-0 truncate text-[13px] font-bold">{i.name}</span>
                <span className="shrink-0 text-xs text-muted">كان <Money minor={i.salesMinor} /></span>
              </li>
            ))}
          </ul>
          {o.menu.stopped.length > STOPPED_SHOWN && (
            <p className="mt-2 text-xs text-muted">وغيرها {o.menu.stopped.length - STOPPED_SHOWN} — الأعلى مبيعاً أوّلاً.</p>
          )}
        </Section>
      )}

      {/* ── ما خرج بلا مال ── */}
      <Section
        id="leaks"
        title="خرج بلا مال"
        icon={ReceiptText}
        hint="الملغى والمرتجعُ بإجماليّ سطرهما في الملفّ، والمجّانيُّ بسعر بيعه × كمّيّته (لا بكلفته — الكلفةُ تحتاج وصفةً كاملة). والمجّانيُّ يُشتقّ من السطر: صنفٌ له سعرٌ وخرج بلا ثمن."
      >
        <DataTable<LeakTotal>
          rows={o.leaks.totals}
          keyOf={(t) => t.kind}
          columns={[
            { key: "kind", header: "النوع", primary: true, cell: (t) => <span className="font-bold">{LEAK_LABEL[t.kind]}</span> },
            { key: "lines", header: "سطور", numeric: true, cell: (t) => <span className="nums nums-count">{t.lines}</span> },
            { key: "qty", header: "الكمّيّة", numeric: true, secondary: true, cell: (t) => <span className="nums nums-count">{formatUnits(t.quantityMilli)}</span> },
            { key: "value", header: "القيمة", numeric: true, cell: (t) => <Money minor={t.valueMinor} /> },
            { key: "share", header: "من المبيعات", numeric: true, cell: (t) => <span className="nums nums-count">{formatShare(t.ofSalesBp)}</span> },
          ]}
        />
        {o.leaks.spikes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {o.leaks.spikes.map((s) => (
              <li key={s.day} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-xs leading-relaxed text-ink-soft">
                <span className="text-sm font-bold text-ink">{formatWeekday(s.day)} <bdi>{formatDay(s.day)}</bdi></span>
                <span>
                  خرج فيه <Money minor={s.valueMinor} /> — أكثر من {SPIKE_MULTIPLE} أمثال وسيط الأيّام (<Money minor={s.usualMinor} />). راجِع تقريرَ ذلك اليوم في فودكس.
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Callout tone="info" icon={Info} className="mt-8">
        <strong className="text-ink">ما لا تقوله هذه الصفحة:</strong> الربحُ والهامش — يلزمهما كلفةُ كلّ صنفٍ من وصفته كاملةً. و«المبيعات» هنا إجماليُّ
        سطور الملفّ كما صدّره فودكس (قبل الضريبة أو شاملَها بحسب إعداد التقرير)، وضريبتُها في عمودها.
      </Callout>
    </PageShell>
  );
}
