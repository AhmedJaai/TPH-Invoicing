import { redirect } from "next/navigation";
import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, CircleCheck, ClipboardList, Download, FileWarning, Landmark, Receipt, SearchCheck, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { formatRiyalsDisplay } from "@/lib/money";
import { Badge, Callout, Card, DataTable, EmptyState, KeyFigure, LinkButton, LinkTabs, NoAccess, Section, type Column } from "@/components/ui";
import { VatBulk, VatCashField, VatFilePanel, VatTxToggle, VatVoidFiling } from "@/components/vat-choice";
import { SalesWitnessPanel, SalesWitnessSkeleton } from "@/components/sales-witness";
import { SectionBoundary } from "@/components/ui-client";
import { WhyNumber } from "@/components/why-number";
import { FiledQuartersSection } from "@/components/vat-compare";
import { DAY, INVOICE, TRANSACTION, countNoun } from "@/lib/arabic";
import { INPUT_VAT_LABEL } from "@/lib/accountant-pack";
import { currentMonthRiyadh, daysSinceRiyadh, formatDay, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import {
  filingDeadline, parseVatPeriod, periodBounds, periodKey, periodMonths, previousQuarter, quarterLabel, quarterOfMonth,
  type VatPeriod, type VatQuarter,
} from "@/lib/vat-return";
import { formatRiyals } from "@/lib/money";
import { loadVatReturn, type VatInvoiceRow, type VatMonthSlice, type VatTxRow } from "@/services/vat-return.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const BULK_CATEGORIES: ReadonlySet<string> = new Set(["SUPPLIER", "RENT", "UTILITY", "OTHER"]);

/**
 * إقرارُ الضريبة — كم أسدّد للهيئة عن الربع، ومن أين جاء الرقم.
 *
 * المخرجاتُ من وارد البنك، والمدخلاتُ من الفواتير المستوفية وضريبة الرسوم وما يختاره صاحبُ
 * المقهى من صادر الكشف. والحسابُ في `lib/vat-return.ts`، والمتصفّحُ يرسل الاختيار وحده.
 */
export default async function VatPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/close/vat");
  if (!can(user.role, "month:close")) {
    return (
      <PageShell user={user} title="الإقرار الضريبي">
        <NoAccess what="الإقرار الضريبي" />
      </PageShell>
    );
  }

  const current = quarterOfMonth(currentMonthRiyadh());
  /* الربعُ الذي يُقدَّم إقرارُه الآن: المنقضي — الجاري لم يكتمل */
  const due = previousQuarter(current);
  const q = await searchParams;
  const period: VatPeriod = parseVatPeriod(q.period) ?? due;
  const quarter: VatQuarter = period.kind === "quarter" ? period : quarterOfMonth(period.month);

  /* أوّلُ شهرٍ في البنك (لقائمة الأرباع) والإقرارُ نفسُه لا يعتمد أحدُهما على الآخر — يُطلَبان معاً */
  const [firstRes, view] = await Promise.all([
    db.execute<{ m: string | null }>(sql`
      select to_char(min(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM') as m from bank_transactions`),
    loadVatReturn(period),
  ]);
  const [first] = firstRes.rows;
  const quarters: VatQuarter[] = [];
  for (let p = current, i = 0; i < 8; i++, p = previousQuarter(p)) {
    quarters.push(p);
    if (!first?.m || periodMonths(p)[0] <= first.m) break;
  }
  if (!quarters.some((p) => periodKey(p) === periodKey(quarter))) quarters.push(quarter);

  const { result: r, filing } = view;
  /* الإقرارُ ربعيّ: موعدُ الشهر موعدُ ربعه، لا آخرُ الشهر التالي له */
  const deadline = filingDeadline(quarter);
  const daysLeft = -daysSinceRiyadh(deadline);
  const label = period.kind === "quarter" ? quarterLabel(period) : formatMonth(period.month);
  const whole = period.kind === "quarter";
  const today = todayInRiyadh();
  const quarterEnded = today >= periodBounds(quarter).until;
  const locked = filing ? `قُدّم إقرار ${quarterLabel(quarter)}، واختياراته مقفلة` : undefined;
  const open = view.coverage.some((c) => c.open);
  const gaps = view.coverage.filter((c) => c.gapDays === null || c.gapDays > 0);
  const nothing = view.txs.length === 0 && view.invoices.length === 0;

  const credits = view.txs.filter((t) => t.direction === "CREDIT");
  const vatLines = view.txs.filter((t) => t.direction === "DEBIT" && (t.category === "POS_VAT" || t.category === "BANK_VAT"));
  const debits = view.txs.filter((t) => t.direction === "DEBIT" && !vatLines.includes(t));
  /* ما قُرئت ضريبتُه صفراً مشترياتٌ بلا ضريبة — لا «ركنٌ نقص»، فلا تزاحم ما يُنتظر فيه قرار */
  const notDeductible = view.invoices.filter((i) => !i.included && i.vatMinor !== 0);
  const confirmed = view.invoices.filter((i) => i.included && i.choice === true);
  const machine = view.invoices.filter((i) => i.included && i.choice !== true).sort((a, b) => b.vatUsedMinor - a.vatUsedMinor);
  const toReview = view.invoices.filter((i) => i.included && i.warnings.length > 0);
  /* ما يُقرّ: ضريبتُه غير صفرٍ مقروء، ولم يُخرجه صاحبُه بيده */
  const confirmable = notDeductible.filter((i) => i.choice !== false);
  const knownFromRecord = confirmable.filter((i) => i.knownFromRecord);
  /* ما اختاره صاحبُه ومنعه الحساب — يُسمّى بسببه، فلا يختفي اختيارٌ بصمت */
  const overridden = debits.filter((t) => t.choice === true && !t.included);
  /* مستوفيةٌ أخرجها انتظارُ المراجعة وحده — تُسمّى بمبلغها، فلا يرتفع المستحقّ بلا تفسير */
  const awaiting = confirmable.filter((i) => i.awaitingReview && i.inputVatStatus === "ELIGIBLE" && i.vatMinor !== null);
  const derived = confirmable.filter((i) => i.vatMinor === null);
  const lost = lostBySupplier(notDeductible);
  const supplierGroups = new Map<string, { supplierId: string; supplier: string; ids: string[] }>();
  for (const i of confirmable) {
    const g = supplierGroups.get(i.supplierId) ?? { supplierId: i.supplierId, supplier: i.supplier, ids: [] };
    g.ids.push(i.id);
    supplierGroups.set(i.supplierId, g);
  }
  const bySupplier = [...supplierGroups.values()].filter((g) => g.ids.length > 1);
  const changed = view.txs.filter((t) => t.choice !== null).map((t) => t.id);

  /*
    مجموعاتُ الصادر بتصنيفها — «احسب كلَّ الكهرباء» بنقرة. وللأبواب التي قد تحمل ضريبةً
    وحدها: زرُّ «احسب كلَّ الرواتب» يدعو إلى خطأٍ لا يُسترَدّ.
  */
  const groups = new Map<string, { label: string; ids: string[]; all: boolean }>();
  for (const t of debits) {
    if (t.blocked !== null || !BULK_CATEGORIES.has(t.category)) continue;
    const g = groups.get(t.category) ?? { label: t.categoryLabel, ids: [], all: true };
    g.ids.push(t.id);
    g.all &&= t.included;
    groups.set(t.category, g);
  }

  return (
    <PageShell
      user={user}
      title="الإقرار الضريبي"
      eyebrow={label}
      intro="المبلغ الذي تسدّده لهيئة الزكاة والضريبة والجمارك عن الفترة: ضريبة مبيعاتك التي دخلت البنك، مطروحاً منها ضريبة مشترياتك من الفواتير ومن الحركات التي تختارها من الكشف."
    >
      <div className="space-y-3">
        <LinkTabs
          label="ربع الإقرار"
          items={quarters.map((p) => ({
            href: `/close/vat?period=${periodKey(p)}`,
            label: periodKey(p) === periodKey(current) ? `${quarterLabel(p)} · الحالي` : quarterLabel(p),
            active: period.kind === "quarter" && periodKey(p) === periodKey(period),
          }))}
        />
        <LinkTabs
          label="شهر من الربع"
          items={[
            { href: `/close/vat?period=${periodKey(quarter)}`, label: "الربع كاملاً", active: period.kind === "quarter" },
            ...periodMonths(quarter).map((m) => ({
              href: `/close/vat?period=${m}`, label: formatMonth(m), active: period.kind === "month" && period.month === m,
            })),
          ]}
        />
      </div>

      {nothing ? (
        <div className="mt-6">
          <EmptyState
            icon={Landmark}
            title={`لا توجد حركات بنكية ولا فواتير في ${label}.`}
            hint="يُحسب الإقرار من كشف البنك وفواتير الفترة، فاستورد كشف البنك أولاً."
          />
        </div>
      ) : (
        <>
          {/* ── الجواب ── */}
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <KeyFigure
              icon={Landmark}
              label={!whole ? (r.netMinor >= 0 ? "حصة الشهر من الإقرار" : "حصة الشهر: رصيد لصالحك") : r.netMinor >= 0 ? "المستحق للهيئة" : "رصيد لصالحك لدى الهيئة"}
              tone={r.netMinor > 0 ? "warn" : "ok"}
              value={<Money minor={Math.abs(r.netMinor)} currency />}
              sub={
                filing ? `قُدّم إقرار ${quarterLabel(quarter)} في ${formatDay(filing.filedOn)}${filing.reference ? `، ورقمه المرجعي ${filing.reference}` : ""}.`
                : open ? "الفترة لم تنتهِ بعد، وسيزيد الرقم مع ما يُضاف."
                : !quarterEnded ? `يُقدَّم مع ${quarterLabel(quarter)}، وآخر موعد له ${formatDay(deadline)}.`
                : daysLeft >= 0 ? `آخر موعد لتقديم ${quarterLabel(quarter)} وسداده ${formatDay(deadline)}، أي بعد ${countNoun(daysLeft, DAY)}.`
                : `فات موعد تقديم ${quarterLabel(quarter)} (${formatDay(deadline)}) منذ ${countNoun(-daysLeft, DAY)}. إن كنت قدّمته فسجّل ذلك.`
              }
            >
              {can(user.role, "amounts:view") && (
                <WhyNumber figure="vat" auditHref={can(user.role, "audit:view") ? "/settings/audit?kind=money" : undefined} />
              )}
            </KeyFigure>
            <KeyFigure
              icon={ArrowDownLeft}
              label="ضريبة المخرجات"
              value={<Money minor={r.output.vatMinor} currency />}
              sub={<><T s="15/115 من {0} مبيعات دخلت البنك ({1}){2}." a={[<Money key="0" minor={r.output.grossMinor} />, countNoun(r.output.count, TRANSACTION), r.output.cashGrossMinor > 0 && <> <T s=" ومن {0} مبيعات نقدية أدخلتها" a={[<Money key="0" minor={r.output.cashGrossMinor} />]} /></>]} /></>}
            />
            <KeyFigure
              icon={ArrowUpRight}
              label="ضريبة المدخلات"
              value={<Money minor={r.input.totalMinor} currency />}
              sub={`من ${countNoun(r.input.invoices.count, INVOICE)}، وضريبة الرسوم، والحركات التي اخترتها من الكشف.`}
            />
          </div>

          <div className="mt-4 space-y-3">
            {gaps.length > 0 && (
              <Callout tone="warn" icon={TriangleAlert} title="أيام بلا كشف، فمبيعاتها غير معروفة">
                <T s="{0} الضريبة هنا أقل من الفعلية بقدر مبيعات تلك الأيام. استورد كشفها من صفحة «البنك»." a={[gaps.map((g) => g.gapDays === null
                  ? `${formatMonth(g.month)}: لا يوجد كشف لهذا الشهر.`
                  : `${formatMonth(g.month)}: ${countNoun(g.gapDays, DAY)} بلا كشف.`).join(" ")]} /></Callout>
            )}
            {whole && filing && (
              <Callout
                tone={r.netMinor === filing.netMinor ? "ok" : "warn"}
                icon={r.netMinor === filing.netMinor ? CircleCheck : TriangleAlert}
                title={`قُدّم في ${formatDay(filing.filedOn)}: ${filing.netMinor >= 0 ? "المستحق للهيئة" : "رصيد لصالحك"} ${riyalsText(Math.abs(filing.netMinor))}`}
                action={<VatVoidFiling period={periodKey(quarter)} />}
              >
                <T s="ضريبة المخرجات {0} وضريبة المدخلات {1}{2}{3}{4}.{5}" a={[riyalsText(filing.outputVatMinor), riyalsText(filing.inputVatMinor), filing.carriedInMinor > 0 && ` ورصيد مرحّل ${riyalsText(filing.carriedInMinor)}`, filing.creditDisposition === "CARRY" && "، ورُحّل الرصيد إلى الربع التالي", filing.creditDisposition === "REFUND" && "، وطُلب استرداد الرصيد", r.netMinor === filing.netMinor
                  ? " والحساب اليوم مطابق لما قُدّم."
                  : ` والحساب اليوم ${riyalsText(Math.abs(r.netMinor))}${r.netMinor < 0 ? " رصيداً لصالحك" : ""}، والفرق ${riyalsText(Math.abs(r.netMinor - filing.netMinor))} سببه تغييرات بعد التقديم (فاتورة رُفعت أو صُحّحت، أو تغيّر تصنيف حركة). راجع المحاسب، فقد يلزم تصحيح في إقرار لاحق.`]} /></Callout>
            )}
            {whole && !filing && quarterEnded && (
              <Callout
                tone={daysLeft < 0 ? "warn" : "info"}
                icon={CalendarClock}
                title={daysLeft >= 0 ? `قدّمه في بوابة الهيئة قبل ${formatDay(deadline)}` : "إن كنت قدّمته فسجّل ذلك"}
                action={<VatFilePanel period={periodKey(quarter)} today={today} credit={r.netMinor < 0} />}
              >
                بعد تقديمه في بوابة الهيئة اضغط «قدّمته للهيئة»، فيحفظ النظام الرقم الذي قدّمته ولا يغيّره ما ترفعه لاحقاً، ويختفي التذكير من «يحتاج قرارك».
              </Callout>
            )}
            {r.netMinor < 0 && whole && !filing && (
              <Callout tone="info" icon={Landmark} title="الصافي رصيد لصالحك، ولديك خياران في بوابة الهيئة">
                إما أن ترحّل الرصيد إلى إقرار الربع التالي فينقص ما تسدّده فيه، أو تطلب استرداده من الهيئة. سجّل اختيارك هنا عند التقديم، وسيظهر الرصيد المرحّل في حساب الربع التالي بسطر مستقل.
              </Callout>
            )}
            {view.carriedFrom && (
              <Callout tone="ok" icon={Landmark}>
                <T s="رصيد دائن مرحّل من {0}: {1}، وقد خُصم من المبلغ المستحق." a={[quarterLabel(view.carriedFrom), riyalsText(r.carriedInMinor)]} /></Callout>
            )}
            {overridden.length > 0 && (
              <Callout
                tone="info"
                icon={FileWarning}
                title={`${countNoun(overridden.length, TRANSACTION)} اخترتها ولم تُحسب: ${riyalsText(overridden.reduce((s, t) => s + t.vatMinor, 0))}`}
              >
                <T s="لكل منها فاتورة محسوبة في الخصم، ولو حسبنا الحوالة معها لخُصمت الضريبة مرتين. سيبقى اختيارك كما هو، وزر «احسبها من الحوالة» يُخرج الفاتورة من الخصم ويحسب الحوالة بدلاً منها.{0}" a={[<ul key="0" className="mt-2 space-y-2 text-xs">
                  {overridden.map((t) => {
                    /* الفرقُ في الخصم لو بُدّلت: ضريبةُ الحوالة بدل ضريبة فواتيرها — والمجهولُ لا يُجمَع صفراً */
                    const known = t.covering.every((c) => c.vatMinor !== null);
                    const invoiceVat = t.covering.reduce((sum, c) => sum + (c.vatMinor ?? 0), 0);
                    /* ضريبةُ الحوالة كما يحسبها الإقرار (`txVat`) — لا حسابَ ثانٍ هنا */
                    const swapVat = t.vatMinor;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 basis-56">
                          {formatDay(t.day)} — {t.label} · <Money minor={t.amountMinor} />
                          <span className="block text-[11px] text-ink-soft">{t.blocked ?? "لا تُحسب"}</span>
                        </span>
                        {!filing && t.covering.length > 0 && (
                          <VatBulk
                            kind="invoice"
                            ids={t.covering.map((c) => c.id)}
                            included={false}
                            variant="secondary"
                            confirm={{
                              title: "احسبها من الحوالة",
                              consequence: known
                                ? `تخرج ${countNoun(t.covering.length, INVOICE)} من الخصم (ضريبتها ${riyalsText(invoiceVat)}) وتُحسب الحوالة بدلاً منها (ضريبتها ${riyalsText(swapVat)})، فيتغيّر المبلغ المخصوم بمقدار ${riyalsText(Math.abs(swapVat - invoiceVat))} ${swapVat >= invoiceVat ? "زيادةً" : "نقصاً"}.`
                                : `تخرج ${countNoun(t.covering.length, INVOICE)} من الخصم وتُحسب الحوالة بدلاً منها (ضريبتها ${riyalsText(swapVat)}). لم تُقرأ ضريبة الفاتورة كاملة، فالفرق غير معروف.`,
                              acknowledgement: "أعلم أن الفاتورة هي المستند الذي تعتمده الهيئة للخصم، وأختار حساب الضريبة من الحوالة",
                            }}
                          >
                            احسبها من الحوالة
                          </VatBulk>
                        )}
                      </li>
                    );
                  })}
                </ul>]} /></Callout>
            )}
            {awaiting.length > 0 && (
              <Callout
                tone="warn"
                icon={FileWarning}
                title={`خرجت من الخصم ${countNoun(awaiting.length, INVOICE)} لأن مستنداتها لم تُراجَع: ${riyalsText(awaiting.reduce((s, i) => s + i.vatUsedMinor, 0))}`}
              >
                <T s="فواتير مستوفية للشروط قرأها النظام ولم يعتمد أحد قراءتها بعد، لذلك لا تُحسب تلقائياً. راجعها من «المراجعة» لتدخل في الخصم، أو أضفها هنا بنفسك. تفاصيلها في {0}، ولكل فاتورة زر خاص بها.{1}" a={[<a key="0" href="#invoices" className="font-bold underline underline-offset-2">«فواتير لا تُخصم ضريبتها»</a>, !filing && (
                  <span className="mt-2 block">
                    <VatBulk kind="invoice" ids={awaiting.map((i) => i.id)} included variant="subtle">
                      {`أضفها كلها (${awaiting.length})`}
                    </VatBulk>
                  </span>
                )]} /></Callout>
            )}
            {r.input.selected.count > 0 && (
              <Callout tone="warn" icon={FileWarning} title={`خصم بلا مستند لدينا: ${riyalsText(r.input.selected.vatMinor)} في ${countNoun(r.input.selected.count, TRANSACTION)}`}>
                الحركات التي اخترتها من المبالغ الخارجة في الكشف تدخل في الخصم دون فاتورة مرفوعة. عند الفحص تطلب الهيئة الفاتورة الضريبية لكل خصم، فاحتفظ بها، والأفضل أن ترفعها إلى النظام.
              </Callout>
            )}
            {view.creditNotes.count > 0 && (
              <Callout tone="warn" icon={Receipt} title={`إشعارات دائنة في الفترة: ${riyalsText(view.creditNotes.amountMinor)}`}>
                <T s="{0} خُفّض مبلغها المستحق بإشعار دائن، وضريبة الفاتورة الأصلية محسوبة هنا كاملة. يحدد المحاسب مقدار خفض ضريبة المدخلات بسبب الإشعار، فأطلعه على هذا السطر قبل التقديم." a={[countNoun(view.creditNotes.count, INVOICE)]} /></Callout>
            )}
            <Callout tone="info" icon={Receipt}>
              <T s="المبيعات هنا هي ما وصل إلى البنك: تسويات الشبكة وما أضفته من المبالغ الداخلة{0}. يُقدَّم الإقرار نفسه في بوابة الهيئة، وهذه الصفحة تعرض حسابه فقط." a={[r.output.cashGrossMinor > 0 ? "، ومعها النقد الذي أدخلته" : ". والنقد الذي لم يُودَع لا يظهر في الكشف، فأدخله في «نقد لم يُودَع» أدناه"]} /></Callout>
          </div>

          {/* ── الحساب سطراً سطراً ── */}
          <Section title="كيف حُسب الرقم" icon={CalendarClock}>
            <Card padded={false}>
              <dl className="divide-y divide-line-soft text-sm">
                <Line
                  label={r.output.cashGrossMinor > 0 ? "ضريبة المبيعات: ما دخل البنك والنقد المُدخل" : "ضريبة المبيعات التي دخلت البنك"}
                  hint={countNoun(r.output.count, TRANSACTION)}
                  gross={r.output.count > 0 || r.output.cashGrossMinor > 0 ? r.output.grossMinor + r.output.cashGrossMinor : undefined}
                  minor={r.output.vatMinor}
                />
                <Line
                  label="− ضريبة الفواتير"
                  hint={r.input.invoices.confirmed.count > 0
                    ? `${countNoun(r.input.invoices.count, INVOICE)}، منها ${r.input.invoices.confirmed.count} أضفتها بنفسك`
                    : `${countNoun(r.input.invoices.count, INVOICE)} مستوفية للشروط`}
                  minor={-r.input.invoices.vatMinor}
                />
                <Line label="− ضريبة رسوم الشبكة والبنك" hint={countNoun(r.input.bankVat.count, TRANSACTION)} minor={-r.input.bankVat.vatMinor} />
                <Line label="− ضريبة حركات اخترتها من الكشف" hint={countNoun(r.input.selected.count, TRANSACTION)} gross={r.input.selected.count > 0 ? r.input.selected.grossMinor : undefined} minor={-r.input.selected.vatMinor} />
                {r.carriedInMinor > 0 && view.carriedFrom && (
                  <Line label="− رصيد دائن مرحّل" hint={`من ${quarterLabel(view.carriedFrom)}`} minor={-r.carriedInMinor} />
                )}
                <div className="flex items-center justify-between gap-3 bg-sunken/60 px-4 py-3 font-bold sm:px-5">
                  <dt>{r.netMinor >= 0 ? "= المستحق للهيئة" : "= رصيد لصالحك"}</dt>
                  <dd><Money minor={Math.abs(r.netMinor)} currency tone={r.netMinor > 0 ? "warn" : "ok"} /></dd>
                </div>
              </dl>
            </Card>
          </Section>

          {view.byMonth.length > 0 && (
            <Section title="الربع شهراً بشهر" hint="يكشف لك الشهر غير المعتاد بنظرة، كانخفاض المبيعات بسبب كشف ناقص، أو ارتفاع الخصم فجأة. يُقرَّب كل شهر وحده، لذلك قد يختلف مجموع الأشهر عن الربع بهللة.">
              <DataTable columns={monthColumns} rows={view.byMonth} keyOf={(m) => m.month} hrefOf={(m) => `/close/vat?period=${m.month}`} />
            </Section>
          )}

          {/* ── خاناتُ نموذج الهيئة ── */}
          {whole && (
            <Section
              title="للنسخ إلى نموذج الهيئة"
              icon={ClipboardList}
              hint="يطلب نموذج الإقرار لكل خانة المبلغ قبل الضريبة والضريبة نفسها. الأرقام هنا بالريال كما حُسبت، وأرقام الخانات بترتيب نموذج الإقرار، فطابقها مع أسماء الخانات في بوابة الهيئة."
              action={<LinkButton href={`/api/export/vat?period=${periodKey(period)}`} size="sm" icon={Download} prefetch={false}>نزّل سجل الإقرار (Excel)</LinkButton>}
            >
              <DataTable columns={boxColumns} rows={formBoxes(r)} keyOf={(b) => b.key} />
            </Section>
          )}

          {/* ── النقدُ غير المودَع ── */}
          <Section
            id="cash"
            title="نقد لم يُودَع"
            icon={Banknote}
            hint="المبيعات التي قبضتها نقداً ولم تودعها في الحساب لا تظهر في الكشف. اكتب مجموعها لكل شهر شاملاً الضريبة (من تقرير فودكس) لتدخل في ضريبة المخرجات. الحقل الفارغ يعني «لم يُدخَل» وليس صفراً. ولا تكتب ما أودعته في الحساب، فهو محسوب ضمن المبالغ الداخلة."
          >
            <Card>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
                {view.cash.map((c) => (
                  <VatCashField
                    key={`${c.month}:${c.grossMinor ?? ""}`}
                    month={c.month}
                    label={formatMonth(c.month)}
                    initial={c.grossMinor === null ? "" : formatRiyals(c.grossMinor)}
                    locked={locked}
                  />
                ))}
              </div>
            </Card>
            {/* شاهدٌ لا يُنتظَر: يُقرأ من مبيعات فودكس بعد أن تُرسَم الصفحة، وعطبُه لا يُسقط الإقرار */}
            <SectionBoundary what="مقارنة مبيعات فودكس">
              <Suspense fallback={<SalesWitnessSkeleton />}>
                <SalesWitnessPanel
                  months={view.cash.map((c) => ({
                    month: c.month,
                    cashTypedGrossMinor: c.grossMinor,
                    returnOutputVatMinor: view.byMonth.find((m) => m.month === c.month)?.outputVatMinor ?? r.output.vatMinor,
                  }))}
                />
              </Suspense>
            </SectionBoundary>
          </Section>

          {toReview.length > 0 && (
            <Section
              id="review"
              title="راجع قبل التقديم"
              icon={SearchCheck}
              count={toReview.length}
              hint="فواتير محسوبة في الخصم فيها ما يستحق الانتباه: ضريبة أعلى من النسبة، أو فاتورة مسجّلة لأكثر من مورّد، أو رقم ضريبي للبائع يختلف عن رقم مورّدها، أو تاريخ بعيد. افتح الفاتورة، وإن كانت القراءة خاطئة فصحّحها أو أخرجها من الخصم."
            >
              <DataTable
                columns={reviewColumns(Boolean(filing))}
                rows={toReview}
                keyOf={(i) => i.id}
                hrefOf={(i) => `/purchases/invoices/${i.id}`}
              />
            </Section>
          )}

          {/* ── الصادر: يختار ما يُستردّ ── */}
          <Section
            id="debits"
            title="اختر ما يدخل في الاسترداد"
            count={debits.length}
            hint="حركات خارجة في الكشف دفعت فيها ضريبة وليس لدينا فاتورتها، مثل الإيجار أو الكهرباء أو مورّد لم ترفع فاتورته. تُحسب ضريبة ما تختاره بنسبة 15/115 من مبلغه. والاسترداد من الهيئة يتطلب فاتورة ضريبية باسم المؤسسة، فلا تختر راتباً ولا تحويلاً شخصياً ولا رسماً حكومياً."
            action={changed.length > 0 && !filing ? <VatBulk ids={changed} included={null} variant="quiet">أعد كل الاختيارات إلى وضعها الأصلي</VatBulk> : undefined}
          >
            {groups.size > 0 && !filing && (
              <div className="mb-3 flex flex-wrap gap-2">
                {[...groups.values()].filter((g) => g.ids.length > 1).map((g) => (
                  <VatBulk key={g.label} ids={g.ids} included={!g.all}>
                    {g.all ? `أخرج كل ${g.label}` : `احسب كل ${g.label}`} ({g.ids.length})
                  </VatBulk>
                ))}
              </div>
            )}
            <DataTable
              columns={txColumns("debit", locked)}
              rows={debits}
              keyOf={(t) => t.id}
              searchOf={(t) => `${t.label} ${t.categoryLabel}`}
              searchLabel="ابحث في المبالغ الخارجة"
              empty={<EmptyState compact title="لا توجد مبالغ خارجة في الفترة." hint="تظهر هنا المبالغ الخارجة من الحساب بعد استيراد الكشف." />}
            />
          </Section>

          {/* ── الوارد: المبيعات ── */}
          <Section
            id="credits"
            title="المبيعات التي دخلت البنك"
            count={credits.length}
            hint="تُحسب تسويات الشبكة مبيعاتٍ تلقائياً. أما المبالغ الداخلة من مصادر أخرى (تطبيق توصيل أو حوالة من عميل) فاخترها لتُحسب، واستبعد ما ليس بيعاً (مثل استرداد من مورّد أو إيداع من المالك)."
          >
            <DataTable
              columns={txColumns("credit", locked)}
              rows={credits}
              keyOf={(t) => t.id}
              searchOf={(t) => `${t.label} ${t.categoryLabel}`}
              searchLabel="ابحث في المبالغ الداخلة"
              empty={<EmptyState compact title="لا توجد مبالغ داخلة في الفترة." hint="تظهر هنا المبالغ الداخلة إلى الحساب بعد استيراد الكشف." />}
            />
          </Section>

          {/* ── ضريبة الرسوم: تُحسب كلُّها، والتفصيلُ عند الطلب ── */}
          <Section
            title="ضريبة رسوم الشبكة والبنك"
            count={vatLines.length}
            hint="يخصم البنك ضريبة رسومه في حركة مستقلة مبلغها هو الضريبة نفسها، لذلك تُحسب كاملة. وفاتورتها الضريبية في كشف التاجر الذي يصدره البنك."
          >
            {vatLines.length === 0 ? (
              <EmptyState compact title="لا توجد ضريبة رسوم في الفترة." />
            ) : (
              <details className="group rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold sm:px-5">
                  <span><T s="{0} محسوبة من أصل {1}" a={[countNoun(vatLines.filter((t) => t.included).length, TRANSACTION), vatLines.length]} /></span>
                  <Money minor={r.input.bankVat.vatMinor} currency />
                </summary>
                <div className="border-t border-line-soft p-3">
                  <DataTable columns={txColumns("vat", locked)} rows={vatLines} keyOf={(t) => t.id} />
                </div>
              </details>
            )}
          </Section>

          {/* ── الفواتير التي لا تُخصم: تُضاف بإقرارك ── */}
          <Section
            id="invoices"
            title="فواتير لا تُخصم ضريبتها"
            icon={FileWarning}
            count={notDeductible.length}
            hint={
              notDeductible.length === 0
                ? `كل فواتير الفترة (${countNoun(r.input.invoices.count, INVOICE)}) محسوبة في الخصم.`
                : "اعتبر النظام أن ضريبة هذه الفواتير لا تُخصم لأن أحد بيانات الفاتورة الضريبية لم يُقرأ، ويوضح عمود «ما لم يُقرأ» هذا البيان. افتح الفاتورة، فإن كانت فاتورة ضريبية فيها الرقم الضريبي للمورّد ورقمنا فاضغط «احسبها» لتدخل الخصم بضريبتها المقروءة، أو بنسبة 15/115 من إجماليها إن لم تُقرأ ضريبتها. هذا لا يغيّر الفاتورة نفسها. وفي الشهر المفتوح يمكنك فتحها وتصحيحها، وهذا هو الحل الدائم."
            }
            action={confirmable.length > 1 && !filing ? (
              <VatBulk
                kind="invoice"
                ids={confirmable.map((i) => i.id)}
                included
                variant="subtle"
                confirm={{
                  title: `أضف ${countNoun(confirmable.length, INVOICE)} إلى الخصم دفعة واحدة`,
                  consequence: `ضريبتها المقروءة ${riyalsText(confirmable.reduce((s, i) => s + (i.vatMinor ?? 0), 0))}`
                    + (derived.length > 0 ? `، و${countNoun(derived.length, INVOICE)} لم تُقرأ ضريبتها فتُحسب تقديراً بنسبة 15/115 من إجماليها (${riyalsText(derived.reduce((s, i) => s + i.vatUsedMinor, 0))})` : "")
                    + `. الأكبر: ${[...confirmable].sort((a, b) => b.vatUsedMinor - a.vatUsedMinor).slice(0, 3).map((i) => `${i.supplier} ${riyalsText(i.vatUsedMinor)}`).join(" · ")}. ويمكنك التراجع عنها من «فواتير أضفتها بنفسك».`,
                  acknowledgement: "راجعت الفواتير: هي فواتير ضريبية تحمل الرقم الضريبي للمورّد ورقمنا الضريبي.",
                }}
              >
                {`أضفها كلها (${confirmable.length})`}
              </VatBulk>
            ) : undefined}
          >
            {notDeductible.length > 0 && (
              <>
                <p className="mb-3 text-xs text-ink-soft">
                  <T s="ضريبتها المقروءة {0}{1} · لا تُحسب حتى تؤكدها." a={[<Money key="0" minor={r.notDeductible.vatKnownMinor} currency />, r.notDeductible.vatUnknownCount > 0 && ` · و${countNoun(r.notDeductible.vatUnknownCount, INVOICE)} لم تُقرأ ضريبتها`]} /></p>
                {!filing && (bySupplier.length > 1 || knownFromRecord.length > 1) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {knownFromRecord.length > 1 && (
                      <VatBulk kind="invoice" ids={knownFromRecord.map((i) => i.id)} included variant="subtle">
                        <T s="احسب الفواتير التي رقم مورّدها الضريبي معروف ({0})" a={[knownFromRecord.length]} /></VatBulk>
                    )}
                    {bySupplier.length > 1 && bySupplier.map((g) => (
                      <VatBulk key={g.supplierId} kind="invoice" ids={g.ids} included>
                        <T s="أضف فواتير {0} إلى الخصم ({1})" a={[g.supplier, g.ids.length]} /></VatBulk>
                    ))}
                  </div>
                )}
                {lost.length > 1 && (
                  <details className="group mb-3 rounded-xl border border-line bg-raised shadow-raised">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold sm:px-5">
                      <span>ضريبة ضائعة حسب المورّد: اطلب منهم فاتورة ضريبية باسم المؤسسة ورقمها الضريبي</span>
                    </summary>
                    <div className="border-t border-line-soft p-3">
                      <DataTable columns={lostColumns} rows={lost} keyOf={(g) => g.supplierId} hrefOf={(g) => `/suppliers/${g.supplierSlug}`} />
                    </div>
                  </details>
                )}
                <DataTable
                  columns={invoiceColumns(Boolean(filing))}
                  rows={notDeductible}
                  keyOf={(i) => i.id}
                  hrefOf={(i) => `/purchases/invoices/${i.id}`}
                  searchOf={(i) => `${i.supplier} ${i.number}`}
                  searchLabel="ابحث في الفواتير"
                />
              </>
            )}
          </Section>

          {confirmed.length > 0 && (
            <Section
              title="فواتير أضفتها بنفسك"
              count={confirmed.length}
              hint={`ضريبتها في الخصم ${riyalsText(r.input.invoices.confirmed.vatMinor)}${r.input.invoices.confirmed.derivedCount > 0 ? `، منها ${countNoun(r.input.invoices.confirmed.derivedCount, INVOICE)} حُسبت ضريبتها بنسبة 15/115 من إجماليها لأنها لم تُقرأ` : ""}. وهذه الإضافة مسجّلة في سجل التدقيق باسمك.`}
              action={filing ? undefined : <VatBulk kind="invoice" ids={confirmed.map((i) => i.id)} included={null} variant="quiet">تراجع عنها كلها</VatBulk>}
            >
              <DataTable
                columns={confirmedColumns(Boolean(filing))}
                rows={confirmed}
                keyOf={(i) => i.id}
                hrefOf={(i) => `/purchases/invoices/${i.id}`}
                searchOf={(i) => `${i.supplier} ${i.number}`}
                searchLabel="ابحث في الفواتير"
              />
            </Section>
          )}

          {/* ── المحسوبةُ آليّاً: ممّ يتكوّن أكبرُ سطرٍ في الخصم ── */}
          {machine.length > 0 && (
            <Section
              id="counted"
              title="الفواتير المحسوبة"
              count={machine.length}
              hint="الفواتير المستوفية التي اعتمدها النظام، مرتبة من الأعلى ضريبة. راجعها قبل التقديم، فالفاتورة المكررة أو الضريبة المقروءة خطأً تظهر في أعلى القائمة. واستخدم «أخرجها» لما لا يحق خصمه."
            >
              <details className="group rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold sm:px-5">
                  <span><T s="{0} مستوفية للشروط" a={[countNoun(machine.length, INVOICE)]} /></span>
                  <Money minor={machine.reduce((s, i) => s + i.vatUsedMinor, 0)} currency />
                </summary>
                <div className="border-t border-line-soft p-3">
                  <DataTable
                    columns={machineColumns(Boolean(filing))}
                    rows={machine}
                    keyOf={(i) => i.id}
                    hrefOf={(i) => `/purchases/invoices/${i.id}`}
                    searchOf={(i) => `${i.supplier} ${i.number}`}
                    searchLabel="ابحث في الفواتير"
                  />
                </div>
              </details>
            </Section>
          )}

          {r.zeroRated.count > 0 && (
            <p className="mt-6 text-xs text-ink-soft">
              <T s="مشتريات قُرئت ضريبتها صفراً: {0} بإجمالي {1}، ولا ضريبة فيها للخصم. يطلب النموذج المشتريات الصفرية والمعفاة في خانتين منفصلتين، وتصنيفها من عمل المحاسب." a={[countNoun(r.zeroRated.count, INVOICE), <Money key="1" minor={r.zeroRated.totalMinor} currency />]} /></p>
          )}
        </>
      )}
      <SectionBoundary what="مقارنة الأرباع">
        <Suspense fallback={null}>
          <FiledQuartersSection />
        </Suspense>
      </SectionBoundary>
    </PageShell>
  );
}

interface LostGroup { supplierId: string; supplierSlug: string; supplier: string; count: number; vatKnownMinor: number; unknownCount: number }

/** ما لا يُخصم مجموعاً بالمورّد — الأكبرُ ضياعاً أوّلاً. */
function lostBySupplier(rows: readonly VatInvoiceRow[]): LostGroup[] {
  const groups = new Map<string, LostGroup>();
  for (const i of rows) {
    const g = groups.get(i.supplierId) ?? { supplierId: i.supplierId, supplierSlug: i.supplierSlug, supplier: i.supplier, count: 0, vatKnownMinor: 0, unknownCount: 0 };
    g.count++;
    if (i.vatMinor === null) g.unknownCount++;
    else g.vatKnownMinor += i.vatMinor;
    groups.set(i.supplierId, g);
  }
  return [...groups.values()].sort((a, b) => b.vatKnownMinor - a.vatKnownMinor || b.count - a.count);
}

const lostColumns: Column<LostGroup>[] = [
  { key: "supplier", header: "المورّد", primary: true, cell: (g) => g.supplier },
  { key: "count", header: "فواتير لا تُخصم", numeric: true, cell: (g) => <span className="nums">{g.count}</span> },
  {
    key: "vat",
    header: "ضريبتها المقروءة",
    numeric: true,
    cell: (g) => <span><Money minor={g.vatKnownMinor} />{g.unknownCount > 0 && <span className="ms-1 text-[11px] text-muted"><T s="+ {0} لم تُقرأ" a={[g.unknownCount]} /></span>}</span>,
  },
];

const monthColumns: Column<VatMonthSlice>[] = [
  { key: "month", header: "الشهر", primary: true, cell: (m) => formatMonth(m.month) },
  { key: "gross", header: "المبيعات", numeric: true, cell: (m) => <Money minor={m.outputGrossMinor} /> },
  { key: "out", header: "ضريبة المخرجات", numeric: true, cell: (m) => <Money minor={m.outputVatMinor} /> },
  { key: "in", header: "ضريبة المدخلات", numeric: true, cell: (m) => <Money minor={m.inputVatMinor} /> },
  { key: "net", header: "الصافي", numeric: true, cell: (m) => <Money minor={m.netMinor} tone={m.netMinor > 0 ? "warn" : "ok"} /> },
];

interface FormBox { key: string; label: string; amountMinor: number | null; vatMinor: number | null }

/** خاناتُ نموذج الإقرار التي يملؤها هذا الحساب — المبلغُ قبل الضريبة والضريبة. */
function formBoxes(r: Awaited<ReturnType<typeof loadVatReturn>>["result"]): FormBox[] {
  return [
    { key: "1", label: "1 · المبيعات الخاضعة للنسبة الأساسية", amountMinor: r.output.netMinor, vatMinor: r.output.vatMinor },
    { key: "7", label: "7 · المشتريات المحلية الخاضعة للنسبة الأساسية", amountMinor: r.input.baseMinor, vatMinor: r.input.totalMinor },
    ...(r.zeroRated.count > 0 ? [{ key: "10", label: "10–11 · مشتريات بلا ضريبة (صفرية أو معفاة، ويصنّفها المحاسب)", amountMinor: r.zeroRated.totalMinor, vatMinor: null }] : []),
    ...(r.carriedInMinor > 0 ? [{ key: "15", label: "15 · ضريبة مرحّلة من فترات سابقة", amountMinor: null, vatMinor: r.carriedInMinor }] : []),
    { key: "16", label: r.netMinor >= 0 ? "16 · صافي الضريبة المستحقة" : "16 · صافي الضريبة (رصيد لصالحك)", amountMinor: null, vatMinor: Math.abs(r.netMinor) },
  ];
}

const boxColumns: Column<FormBox>[] = [
  { key: "label", header: "الخانة", primary: true, cell: (b) => b.label },
  { key: "amount", header: "المبلغ قبل الضريبة", numeric: true, cell: (b) => b.amountMinor === null ? <span className="text-muted">—</span> : <Money minor={b.amountMinor} /> },
  { key: "vat", header: "الضريبة", numeric: true, cell: (b) => b.vatMinor === null ? <span className="text-muted">—</span> : <Money minor={b.vatMinor} /> },
];

function riyalsText(minor: number): string {
  return `${formatRiyalsDisplay(minor)} ريالاً`;
}

function Line({ label, hint, gross, minor }: { label: string; hint?: string; gross?: number; minor: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <dt className="min-w-0">
        <span className="font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-muted">
            {hint}{gross !== undefined && <> <T s=" بمبلغ {0}" a={[<Money key="0" minor={gross} />]} /></>}
          </span>
        )}
      </dt>
      <dd className="shrink-0"><Money minor={minor} /></dd>
    </div>
  );
}

function txColumns(kind: "debit" | "credit" | "vat", filed?: string): Column<VatTxRow>[] {
  return [
    {
      key: "pick",
      header: "تُحسب",
      wrap: true,
      cell: (t) => (
        <VatTxToggle
          key={`${t.id}:${t.included}`}
          id={t.id}
          included={t.included}
          label={t.label}
          locked={t.blocked ?? filed}
        />
      ),
    },
    { key: "day", header: "التاريخ", cell: (t) => <span className="whitespace-nowrap">{formatDay(t.day)}</span>, secondary: true },
    {
      key: "label",
      header: kind === "credit" ? "من" : "إلى",
      primary: true,
      cell: (t) => (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate">{t.label}</span>
          {t.coveredByInvoice && t.direction === "DEBIT" && <Badge tone="ok">فاتورتها محسوبة في الخصم</Badge>}
          {t.bounced && <Badge tone="muted">مردودة</Badge>}
          {t.caution !== null && <Badge tone={t.included ? "warn" : "muted"}>{t.included ? "تصنيف لا ضريبة فيه غالباً، فاحتفظ بفاتورته" : "لا ضريبة فيه غالباً"}</Badge>}
          {t.supplierHasInvoices && t.blocked === null && t.direction === "DEBIT" && <Badge tone="warn">لمورّدها فواتير محسوبة، فتحقق قبل أن تحسبها</Badge>}
          {t.choice !== null && <Badge tone="accent">باختيارك</Badge>}
        </span>
      ),
    },
    { key: "cat", header: "التصنيف", cell: (t) => t.categoryLabel, secondary: true },
    { key: "amount", header: "المبلغ", numeric: true, cell: (t) => <Money minor={t.amountMinor} /> },
    {
      key: "vat",
      header: "الضريبة",
      numeric: true,
      cell: (t) => <span className={t.included ? "" : "text-muted line-through decoration-muted/60"}><Money minor={t.vatMinor} /></span>,
    },
  ];
}

/** تاريخُ الفاتورة — وشارةٌ لما رُحِّل من شهرٍ آخر: يُخصم في شهره المحاسبيّ لا شهر تاريخه. */
function InvoiceDay({ i }: { i: VatInvoiceRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="whitespace-nowrap">{formatDay(i.day)}</span>
      {i.carriedFromMonth && <Badge tone="muted"><T s="مرحّلة من {0}" a={[formatMonth(i.carriedFromMonth)]} /></Badge>}
    </span>
  );
}

const invoiceColumns = (filed: boolean): Column<VatInvoiceRow>[] => [
  { key: "supplier", header: "المورّد", primary: true, cell: (i) => i.supplier },
  { key: "number", header: "الرقم", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.number}</bdi>, secondary: true },
  { key: "day", header: "التاريخ", cell: (i) => <InvoiceDay i={i} />, secondary: true },
  {
    key: "missing",
    header: "ما لم يُقرأ",
    cell: (i) => (
      <span className="text-xs leading-relaxed">
        {i.reasons.join(" · ") || INPUT_VAT_LABEL[i.inputVatStatus]}
        {i.supplierVat && i.reasons.includes("رقم المورّد الضريبيّ") && (
          <span className="block text-muted"><T s="في سجل المورّد {0}" a={[<bdi key="0" dir="ltr" className="font-mono">{i.supplierVat}</bdi>]} /></span>
        )}
      </span>
    ),
  },
  { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
  {
    key: "vat",
    header: "الضريبة",
    numeric: true,
    cell: (i) => i.vatMinor === null
      ? <span className="text-muted" title="15/115 من الإجمالي إن حسبتها"><T s="{0} تقديراً" a={[<Money key="0" minor={i.vatUsedMinor} />]} /></span>
      : <Money minor={i.vatMinor} />,
  },
  {
    key: "act",
    header: "",
    wrap: true,
    cell: (i) => filed ? null
      : i.choice === false ? <VatBulk kind="invoice" ids={[i.id]} included={null} variant="quiet">أعدها إلى تقدير النظام</VatBulk>
      : <VatBulk kind="invoice" ids={[i.id]} included variant="subtle">احسبها</VatBulk>,
  },
];

const confirmedColumns = (filed: boolean): Column<VatInvoiceRow>[] => [
  { key: "supplier", header: "المورّد", primary: true, cell: (i) => i.supplier },
  { key: "number", header: "الرقم", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.number}</bdi>, secondary: true },
  { key: "day", header: "التاريخ", cell: (i) => <InvoiceDay i={i} />, secondary: true },
  { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
  {
    key: "vat",
    header: "الضريبة المخصومة",
    numeric: true,
    cell: (i) => <span><Money minor={i.vatUsedMinor} />{i.vatMinor === null && <span className="ms-1 text-[11px] text-muted">15/115</span>}</span>,
  },
  { key: "act", header: "", wrap: true, cell: (i) => filed ? null : <VatBulk kind="invoice" ids={[i.id]} included={null} variant="quiet">تراجع</VatBulk> },
];

const machineColumns = (filed: boolean): Column<VatInvoiceRow>[] => [
  { key: "supplier", header: "المورّد", primary: true, cell: (i) => i.supplier },
  { key: "number", header: "الرقم", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.number}</bdi>, secondary: true },
  { key: "day", header: "التاريخ", cell: (i) => <InvoiceDay i={i} />, secondary: true },
  { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
  { key: "vat", header: "الضريبة المخصومة", numeric: true, cell: (i) => <Money minor={i.vatUsedMinor} /> },
  { key: "act", header: "", wrap: true, reveal: true, cell: (i) => filed ? null : <VatBulk kind="invoice" ids={[i.id]} included={false} variant="quiet">أخرجها</VatBulk> },
];

const reviewColumns = (filed: boolean): Column<VatInvoiceRow>[] => [
  { key: "supplier", header: "المورّد", primary: true, cell: (i) => i.supplier },
  { key: "number", header: "الرقم", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.number}</bdi>, secondary: true },
  { key: "why", header: "ما يستحق الانتباه", cell: (i) => <span className="text-xs leading-relaxed text-warn">{i.warnings.join(" · ")}</span> },
  { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
  { key: "vat", header: "الضريبة المخصومة", numeric: true, cell: (i) => <Money minor={i.vatUsedMinor} /> },
  { key: "act", header: "", wrap: true, cell: (i) => filed ? null : <VatBulk kind="invoice" ids={[i.id]} included={false} variant="quiet">أخرجها</VatBulk> },
];
