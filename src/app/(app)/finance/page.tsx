import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleHelp, FileSpreadsheet, Info, Lock, Scale, Snowflake, TrendingUp } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PrintButton } from "@/components/print-button";
import { PostAction } from "@/components/post-action";
import { FinanceReading } from "@/components/finance-reading";
import { MaybeMoney, MonthTabs, ProfitTrend, Unknown, type TrendMonth } from "@/components/finance-bits";
import { Badge, Callout, Card, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { formatShare } from "@/lib/finance/format";
import { INVOICE, PRODUCT, countNoun } from "@/lib/arabic";
import { currentMonthRiyadh, formatDay, formatMoment, formatMonth } from "@/lib/riyadh-time";
import { loadPnlSeries, type PnlView } from "@/services/profit.service";
import { loadStoredReading } from "@/services/finance-reading.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** كلُّ سطرٍ يفتح الصفوفَ التي كوّنته — الرقمُ بلا وجهةٍ لا يُفحَص. */
function hrefOf(id: string, month: string): string | null {
  if (id === "revenue") return `/finance/sales?month=${month}`;
  if (id === "cogs" || id === "gross") return `/finance/rows?month=${month}&line=cogs`;
  if (id === "cogs-theoretical" || id === "cogs-unexplained" || id === "cogs-waste" || id === "staff-drinks") return `/finance/stock?month=${month}`;
  if (id === "opex") return `/finance/rows?month=${month}&line=opex`;
  if (id.startsWith("op-")) return `/finance/rows?month=${month}&line=opex&category=${id.slice(3)}`;
  if (id === "excluded") return `/finance/rows?month=${month}&line=excluded`;
  return null;
}

function trendOf(v: PnlView): TrendMonth {
  const p = v.pnl;
  return {
    month: v.month,
    revenueMinor: p.revenueMinor,
    costsMinor: p.cogsMinor === null ? null : p.cogsMinor + p.opexMinor,
    profitMinor: p.profitMinor,
    profitLabel: p.profitLabel,
    complete: p.complete,
    marginBp: p.netMarginBp,
    note: v.input.open ? "لم ينتهِ" : null,
  };
}

/**
 * الربح — «هل ربحتُ هذا الشهر، وكم، وما الذي ينقص الرقم؟» (`lib/finance/pnl.ts`).
 *
 * الرقمُ يُسمّى بما يشمله: «صافي الربح» حين لا ينقصه أساسيّ، و«الربح قبل الإيجار» حين
 * ينقصه — ولا يُلوَّن أخضرَ إلّا مكتملاً. وكلُّ ناقصٍ باسمه وزرِّ إكماله.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} title="الربح">
        <NoAccess what="قائمة الدخل" />
      </PageShell>
    );
  }

  const q = await searchParams;
  const series = await loadPnlSeries();
  const months = series.map((v) => v.month);
  const current = currentMonthRiyadh();
  /* الافتراضيّ آخرُ شهرٍ انتهى — الجاري ناقصٌ بطبعه */
  const fallback = series.find((v) => v.month < current)?.month ?? months[0] ?? current;
  const month = q.month && MONTH_RE.test(q.month) && months.includes(q.month) ? q.month : fallback;
  const view = series.find((v) => v.month === month);

  if (!view || series.length === 0) {
    return (
      <PageShell user={user} title="الربح" intro="الإيراد مطروحاً منه تكلفة المبيعات والمصروفات، شهراً بشهر.">
        <Callout tone="info" icon={Info} title="لا توجد مبيعات مقروءة بعد">
          <T s="تعتمد قائمة الدخل على مبيعات فودكس. زامنها من صفحة «فودكس والبنك» ثم ارجع إلى هنا.{0}" a={[<div key="0" className="mt-3"><LinkButton href="/money/foodics" size="sm">افتح فودكس والبنك</LinkButton></div>]} /></Callout>
      </PageShell>
    );
  }

  const stored = await loadStoredReading(month, view);
  const p = view.pnl;
  const c = view.input.cogs;
  const canClose = can(user.role, "month:close");
  const tone = p.profitMinor === null ? undefined : p.profitMinor < 0 ? "danger" as const : p.complete ? "ok" as const : "warn" as const;
  const previous = series.find((v) => v.month < month);

  return (
    <PageShell
      user={user}
      width="wide"
      title="الربح"
      eyebrow={view.frozenAt ? <span className="inline-flex items-center gap-1"><T s="{0} مقفل ومجمَّد {1}" a={[<Lock key="0" className="h-3 w-3" aria-hidden />, <bdi key="1">{formatMoment(new Date(view.frozenAt))}</bdi>]} /></span> : view.closed ? "شهر مقفل، ولم يُجمَّد تقريره بعد" : undefined}
      intro="الإيراد مطروحاً منه تكلفة المبيعات والمصروفات، شهراً بشهر. كل رقم يُسمّى بحسب ما يشمله، ويُذكر بالاسم ما ينقصه."
      actions={
        <span className="no-print flex flex-wrap items-center gap-2">
          <LinkButton href={`/finance/report?month=${month}`} variant="secondary" icon={FileSpreadsheet}>تقرير المحاسب</LinkButton>
          <PrintButton variant="quiet" />
        </span>
      }
    >
      <div className="no-print"><MonthTabs base="/finance" months={months} active={month} /></div>

      {view.stale && (
        <Callout tone="warn" icon={Snowflake} className="mt-4" title="تغيّرت البيانات منذ تجميد هذا التقرير"
          action={canClose ? <PostAction url="/api/finance/freeze" body={{ month }} done="أُعيد تجميد التقرير">أعد تجميده بأرقام اليوم</PostAction> : undefined}>
          هذه الأرقام كما جُمّدت، لكن حسابها اليوم مختلف بسبب فاتورة وصلت متأخرة، أو إضافة أدخلتها، أو ربط تغيّر. يبقى التقرير المجمّد كما هو حتى تعيد تجميده.
        </Callout>
      )}
      {view.closed && !view.frozenAt && canClose && (
        <Callout tone="info" icon={Snowflake} className="mt-4" title="شهر مقفل لم يُجمَّد تقريره"
          action={<PostAction url="/api/finance/freeze" body={{ month }} done="جُمّد التقرير">جمّده كما هو الآن</PostAction>}>
          بعد التجميد يحتفظ التقرير بأرقامه لحظة التجميد، ولا يتغيّر بما يُضاف لاحقاً. أكمل ما ينقصه أولاً إن أردته كاملاً.
        </Callout>
      )}

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-4">
          <KeyFigure
            icon={Scale}
            tone={tone}
            label={`${p.profitLabel} — ${formatMonth(month)}`}
            value={p.profitMinor === null ? "غير معروف" : <Money minor={p.profitMinor} currency signed />}
            sub={
              p.profitMinor === null ? "يحتاج إلى الإيراد والتكلفة، والناقص مذكور أدناه."
              : p.complete ? <><T s="هامش صافٍ {0} من الإيراد، ولا ينقصه عنصر أساسي." a={[<strong key="0" className="text-ink">{formatShare(p.netMarginBp)}</strong>]} /></>
              : <><T s="هامشه {0}، {1} لأنه ينقصه ما في القائمة أدناه." a={[<strong key="0" className="text-ink">{formatShare(p.netMarginBp)}</strong>, <strong key="1" className="text-ink">وليس صافياً بعد</strong>]} /></>
            }
          >
            {p.gaps.length > 0 && (
              <ul className="space-y-2 text-xs leading-relaxed text-ink-soft">
                {p.gaps.map((g) => (
                  <li key={g.id} className="flex items-start gap-2">
                    <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} aria-hidden />
                    <span className="min-w-0 flex-1">
                      {g.label}
                      {g.id !== "OPEN" && (
                        <Link href={g.href} className="no-print ms-1 whitespace-nowrap font-bold text-accent hover:underline">{g.action} ←</Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </KeyFigure>

          <div className="grid grid-cols-2 gap-3">
            <Card href={`/finance/sales?month=${month}`}>
              <p className="text-[11px] font-bold text-muted">الإيراد</p>
              <p className="mt-1 text-base font-semibold"><MaybeMoney minor={p.revenueMinor} /></p>
              {previous?.pnl.revenueMinor != null && p.revenueMinor !== null && !view.input.open && (
                <p className="mt-1 text-[11px] text-muted">
                  {formatMonth(previous.month)}: <Money minor={previous.pnl.revenueMinor} />
                </p>
              )}
            </Card>
            <Card href={`/finance/rows?month=${month}&line=cogs`}>
              <p className="text-[11px] font-bold text-muted">مجمل الربح</p>
              <p className="mt-1 text-base font-semibold"><MaybeMoney minor={p.grossProfitMinor} /></p>
              <p className="mt-1 text-[11px] text-muted"><T s="هامش {0}" a={[formatShare(p.grossMarginBp)]} /></p>
            </Card>
          </div>
        </div>

        <Card padded={false}>
          <ul className="divide-y divide-line-soft">
            {p.lines.map((l) => {
              const href = hrefOf(l.id, month);
              const strong = l.kind === "total";
              return (
                <li key={l.id} className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 ${l.id === "profit" ? "bg-sunken/60" : ""} ${l.kind === "memo" ? "text-ink-soft" : ""}`}>
                  <span className={`min-w-0 flex-1 basis-48 text-[13px] ${strong ? "font-bold" : l.kind === "sub" ? "ps-4 text-[12px] text-ink-soft" : l.kind === "memo" ? "text-[12px]" : ""}`}>
                    {href ? <Link href={href} className="hover:underline">{l.label}</Link> : l.label}
                    {l.note && l.amountMinor !== null && <span className="block text-[11px] font-normal text-muted">{l.note}</span>}
                  </span>
                  {l.amountMinor === null ? (
                    <span className="text-end"><Unknown why={l.note} /></span>
                  ) : (
                    <span className={`text-sm ${strong ? "font-bold" : ""}`}>
                      {/* ما يُطرَح يُكتب بإشارته داخل الرقم نفسِه — إشارةٌ خارجه تنقلب موضعاً في سطرٍ عربيّ */}
                      <Money minor={l.negative ? -l.amountMinor : l.amountMinor} signed={l.id === "profit" || l.id === "gross" || l.id === "cogs-unexplained"} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Section title="تكلفة المبيعات بثلاث طرق" icon={Scale} hint="تُحسب الطرق الثلاث وتُعرض معاً، والفرق بينها يساعدك على كشف هدر أو تسريب أو فاتورة ناقصة.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card tone={p.cogsMethod === "STOCK" ? "accent" : undefined} href={`/finance/rows?month=${month}&line=cogs`}>
            <p className="flex items-center justify-between gap-2 text-xs font-bold"><T s="بالجرد {0}" a={[p.cogsMethod === "STOCK" && <Badge tone="accent">المعتمدة</Badge>]} /></p>
            <p className="mt-2 text-lg font-semibold"><MaybeMoney minor={c.stock?.minor ?? null} why={c.stockMissing ?? undefined} /></p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {c.stock
                ? <><T s="المشتريات + مخزون {0} ({1}) − مخزون {2} ({3}). المعدود: {4}." a={[<bdi key="0">{formatDay(c.stock.openingDay)}</bdi>, <Money key="1" minor={c.stock.openingValueMinor} />, <bdi key="2">{formatDay(c.stock.closingDay)}</bdi>, <Money key="3" minor={c.stock.closingValueMinor} />, countNoun(c.stock.countedItems, PRODUCT)]} /></>
                : "ما خرج من الرف فعلاً، ويحتاج إلى جرد قرب بداية الشهر ونهايته."}
              {c.stock && c.stock.suspectItems.length > 0 && <> <T s=" استُبعدت للاشتباه في عدّها: {0}." a={[c.stock.suspectItems.join("، ")]} /></>}
            </p>
          </Card>
          <Card tone={p.cogsMethod === "PURCHASES" ? "accent" : undefined} href={`/finance/rows?month=${month}&line=purchases`}>
            <p className="flex items-center justify-between gap-2 text-xs font-bold"><T s="بالمشتريات {0}" a={[p.cogsMethod === "PURCHASES" && <Badge tone="warn">المعتمدة (لا يوجد جرد)</Badge>]} /></p>
            <p className="mt-2 text-lg font-semibold">{c.purchasesInvoices === 0 ? <Unknown why="لا توجد فاتورة مسجّلة" /> : <Money minor={c.purchasesMinor} />}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              <T s="{0} دخلت بضاعتها في هذا الشهر، بدون ضريبتها. وما بقي منها على الرف يُحسب هنا كأنه بيع.{1}" a={[countNoun(c.purchasesInvoices, INVOICE), c.purchasesGrossOnly > 0 && <> <T s=" {0} منها بإجماليها (لم يُقرأ صافيها)." a={[c.purchasesGrossOnly]} /></>]} /></p>
          </Card>
          <Card href={`/finance/stock?month=${month}`}>
            <p className="text-xs font-bold">النظرية (الوصفات × ما بيع)</p>
            <p className="mt-2 text-lg font-semibold"><MaybeMoney minor={c.theoreticalMinor} why="لا توجد مبيعات أو وصفات" /></p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              <T s="ما كان يُفترض صرفه حسب الوصفات. {0}" a={[p.unexplainedMinor !== null && (
                p.unexplainedMinor >= 0
                  ? <><T s="خرج من الرف أكثر منها بـ{0}، وهو فرق غير مفسَّر." a={[<strong key="0" className="text-ink"><Money minor={p.unexplainedMinor} /></strong>]} /></>
                  : <><T s="وهي {0} مما خرج من الرف بـ{1}، وقد يكون السبب فاتورة لم تُسجَّل أو وصفة تفترض كمية أكبر من الواقع." a={[<strong key="0" className="text-ink">أكثر</strong>, <strong key="1" className="text-ink"><Money minor={-p.unexplainedMinor} /></strong>]} /></>
              )]} /></p>
          </Card>
          <Card>
            <p className="flex items-center justify-between gap-2 text-xs font-bold"><T s="كلفة فودكس {0}" a={[<Badge key="0" tone="muted">للمقارنة</Badge>]} /></p>
            <p className="mt-2 text-lg font-semibold"><MaybeMoney minor={c.foodicsMinor} why="لم يُقرأ صرف الشهر كاملاً" /></p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              ما حسبه فودكس من المصروف مع الطلبات. وهو أقل من النظري لأن وصفاته للحلويات تشمل التغليف دون القطعة نفسها، ولا يدخل في الحساب.
            </p>
          </Card>
        </div>
      </Section>

      <Section title="الأشهر جنباً إلى جنب" icon={TrendingUp} hint="الشريط المخطط ربحٌ ينقصه عنصر، فلا تقارنه بالصافي.">
        <ProfitTrend months={series.map(trendOf)} active={month} hrefOf={(m) => `/finance?month=${m}`} />
      </Section>

      <Section title="ملخّص الشهر" className="print:hidden">
        <FinanceReading month={month} stored={stored} canAsk={canClose} />
      </Section>

      {view.excludedRows.length > 0 && (
        <Callout tone="info" icon={Info} className="mt-6" title="ما استُبعد من المصروفات، ولماذا">
          <ul className="list-disc space-y-0.5 ps-4">
            {[...new Set(view.excludedRows.map((x) => x.reason))].map((reason) => (
              <li key={reason}>
                {reason}: <Money minor={view.excludedRows.filter((x) => x.reason === reason).reduce((s, x) => s + x.amountMinor, 0)} />
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </PageShell>
  );
}
