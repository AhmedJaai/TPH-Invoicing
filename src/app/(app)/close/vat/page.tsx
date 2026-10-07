import { redirect } from "next/navigation";
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
import { DAY, INVOICE, TRANSACTION, countNoun } from "@/lib/arabic";
import { INPUT_VAT_LABEL } from "@/lib/accountant-pack";
import { currentMonthRiyadh, daysSinceRiyadh, formatDay, formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import {
  filingDeadline, parseVatPeriod, periodBounds, periodKey, periodMonths, previousQuarter, quarterLabel, quarterOfMonth,
  type VatPeriod, type VatQuarter,
} from "@/lib/vat-return";
import { formatRiyals } from "@/lib/money";
import { loadVatReturn, type VatInvoiceRow, type VatMonthSlice, type VatTxRow } from "@/services/vat-return.service";

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
      <PageShell user={user} title="إقرار الضريبة">
        <NoAccess what="إقرار الضريبة" />
      </PageShell>
    );
  }

  const current = quarterOfMonth(currentMonthRiyadh());
  /* الربعُ الذي يُقدَّم إقرارُه الآن: المنقضي — الجاري لم يكتمل */
  const due = previousQuarter(current);
  const q = await searchParams;
  const period: VatPeriod = parseVatPeriod(q.period) ?? due;
  const quarter: VatQuarter = period.kind === "quarter" ? period : quarterOfMonth(period.month);

  const [first] = (await db.execute<{ m: string | null }>(sql`
    select to_char(min(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM') as m from bank_transactions`)).rows;
  const quarters: VatQuarter[] = [];
  for (let p = current, i = 0; i < 8; i++, p = previousQuarter(p)) {
    quarters.push(p);
    if (!first?.m || periodMonths(p)[0] <= first.m) break;
  }
  if (!quarters.some((p) => periodKey(p) === periodKey(quarter))) quarters.push(quarter);

  const view = await loadVatReturn(period);
  const { result: r, filing } = view;
  /* الإقرارُ ربعيّ: موعدُ الشهر موعدُ ربعه، لا آخرُ الشهر التالي له */
  const deadline = filingDeadline(quarter);
  const daysLeft = -daysSinceRiyadh(deadline);
  const label = period.kind === "quarter" ? quarterLabel(period) : formatMonth(period.month);
  const whole = period.kind === "quarter";
  const today = todayInRiyadh();
  const quarterEnded = today >= periodBounds(quarter).until;
  const locked = filing ? `إقرارُ ${quarterLabel(quarter)} قُدِّم — اختياراتُه مقفلة` : undefined;
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
      title="إقرار الضريبة"
      eyebrow={label}
      intro="كم تسدّد لهيئة الزكاة والضريبة عن الفترة: ضريبةُ ما بعتَه من وارد البنك، ناقصاً ضريبةَ ما اشتريتَه من فواتيرك وما تختاره من حركات الكشف."
    >
      <div className="space-y-3">
        <LinkTabs
          label="ربع الإقرار"
          items={quarters.map((p) => ({
            href: `/close/vat?period=${periodKey(p)}`,
            label: periodKey(p) === periodKey(current) ? `${quarterLabel(p)} · جارٍ` : quarterLabel(p),
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
            title={`لا حركةَ بنكٍ ولا فاتورةَ في ${label}.`}
            hint="الإقرارُ يُحسب من كشف البنك وفواتير الفترة — استورد كشف البنك أوّلاً."
          />
        </div>
      ) : (
        <>
          {/* ── الجواب ── */}
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <KeyFigure
              icon={Landmark}
              label={!whole ? (r.netMinor >= 0 ? "نصيبُ الشهر من الإقرار" : "نصيبُ الشهر: رصيدٌ لك") : r.netMinor >= 0 ? "تسدّده للهيئة" : "رصيدٌ لك عند الهيئة"}
              tone={r.netMinor > 0 ? "warn" : "ok"}
              value={<Money minor={Math.abs(r.netMinor)} currency />}
              sub={
                filing ? `قُدِّم إقرارُ ${quarterLabel(quarter)} في ${formatDay(filing.filedOn)}${filing.reference ? ` — مرجعُه ${filing.reference}` : ""}.`
                : open ? "الفترةُ لم تنتهِ — الرقمُ يكبر بما يأتي."
                : !quarterEnded ? `يُقدَّم مع ${quarterLabel(quarter)} — آخرُ موعده ${formatDay(deadline)}.`
                : daysLeft >= 0 ? `آخرُ موعدٍ لتقديم ${quarterLabel(quarter)} وسداده ${formatDay(deadline)} — بعد ${countNoun(daysLeft, DAY)}.`
                : `فات موعدُ تقديم ${quarterLabel(quarter)} (${formatDay(deadline)}) منذ ${countNoun(-daysLeft, DAY)} — إن كنتَ قدّمتَه فسجّله.`
              }
            />
            <KeyFigure
              icon={ArrowDownLeft}
              label="ضريبة المخرجات"
              value={<Money minor={r.output.vatMinor} currency />}
              sub={<>15/115 من <Money minor={r.output.grossMinor} /> وردت البنكَ مبيعاتٍ ({countNoun(r.output.count, TRANSACTION)}){r.output.cashGrossMinor > 0 && <> ومن <Money minor={r.output.cashGrossMinor} /> نقداً كتبتَه</>}.</>}
            />
            <KeyFigure
              icon={ArrowUpRight}
              label="ضريبة المدخلات"
              value={<Money minor={r.input.totalMinor} currency />}
              sub={`من ${countNoun(r.input.invoices.count, INVOICE)} وضريبةِ الرسوم وما اخترتَه من الكشف.`}
            />
          </div>

          <div className="mt-4 space-y-3">
            {gaps.length > 0 && (
              <Callout tone="warn" icon={TriangleAlert} title="أيّامٌ بلا كشف — مبيعاتُها غير معروفة">
                {gaps.map((g) => g.gapDays === null
                  ? `${formatMonth(g.month)}: لا كشفَ له أصلاً.`
                  : `${formatMonth(g.month)}: ${countNoun(g.gapDays, DAY)} بلا كشف.`).join(" ")}
                {" "}الضريبةُ هنا أقلُّ من الحقيقة بقدر ما وصل البنكَ في تلك الأيّام. استورد كشفها من «البنك».
              </Callout>
            )}
            {whole && filing && (
              <Callout
                tone={r.netMinor === filing.netMinor ? "ok" : "warn"}
                icon={r.netMinor === filing.netMinor ? CircleCheck : TriangleAlert}
                title={`قُدِّم في ${formatDay(filing.filedOn)}: ${filing.netMinor >= 0 ? "سُدِّد للهيئة" : "رصيدٌ لك"} ${riyalsText(Math.abs(filing.netMinor))}`}
                action={<VatVoidFiling period={periodKey(quarter)} />}
              >
                ضريبةُ المخرجات {riyalsText(filing.outputVatMinor)} وضريبةُ المدخلات {riyalsText(filing.inputVatMinor)}
                {filing.carriedInMinor > 0 && ` ورصيدٌ مرحَّل ${riyalsText(filing.carriedInMinor)}`}
                {filing.creditDisposition === "CARRY" && " — والرصيدُ رُحِّل إلى الربع التالي"}
                {filing.creditDisposition === "REFUND" && " — وطُلب استردادُ الرصيد"}.
                {r.netMinor === filing.netMinor
                  ? " والحسابُ اليوم يطابق ما قُدِّم."
                  : ` والحسابُ اليوم ${riyalsText(Math.abs(r.netMinor))}${r.netMinor < 0 ? " رصيداً لك" : ""} — الفرقُ ${riyalsText(Math.abs(r.netMinor - filing.netMinor))} ممّا تغيّر بعد التقديم (فاتورةٌ رُفعت أو صُحّحت، أو تصنيفُ حركةٍ تغيّر). راجِعه مع المحاسب: قد يلزمه تصحيحٌ في إقرارٍ لاحق.`}
              </Callout>
            )}
            {whole && !filing && quarterEnded && (
              <Callout
                tone={daysLeft < 0 ? "warn" : "info"}
                icon={CalendarClock}
                title={daysLeft >= 0 ? `يُقدَّم في بوّابة الهيئة قبل ${formatDay(deadline)}` : "إن كنتَ قدّمتَه فسجّله"}
                action={<VatFilePanel period={periodKey(quarter)} today={today} credit={r.netMinor < 0} />}
              >
                بعد أن تقدّمه في البوّابة اضغط «قدّمتُه للهيئة»: يُحفَظ الرقمُ الذي قُدِّم ولا يتغيّر بما يُرفع بعده، ويخرج التذكيرُ من «يحتاج قرارك».
              </Callout>
            )}
            {r.netMinor < 0 && whole && !filing && (
              <Callout tone="info" icon={Landmark} title="الصافي رصيدٌ لك — خياران في البوّابة">
                يُرحَّل إلى إقرار الربع التالي فيُنقص ما تسدّده فيه، أو تطلب استردادَه من الهيئة. وما تختاره تسجّله هنا مع التقديم؛ والمرحَّلُ يدخل حسابَ الربع التالي بسطره.
              </Callout>
            )}
            {view.carriedFrom && (
              <Callout tone="ok" icon={Landmark}>
                رصيدٌ دائنٌ مرحَّل من {quarterLabel(view.carriedFrom)}: {riyalsText(r.carriedInMinor)} — أُنقص من المستحقّ.
              </Callout>
            )}
            {r.input.selected.count > 0 && (
              <Callout tone="warn" icon={FileWarning} title={`خصمٌ بلا مستندٍ عندنا: ${riyalsText(r.input.selected.vatMinor)} في ${countNoun(r.input.selected.count, TRANSACTION)}`}>
                ما اخترتَه من صادر الكشف يدخل الخصمَ بلا فاتورةٍ مرفوعة. والهيئةُ عند الفحص تطلب الفاتورةَ الضريبيّة لكلّ خصم — احتفظ بها، والأسلمُ أن ترفعها فتُحسب من بابها.
              </Callout>
            )}
            {view.creditNotes.count > 0 && (
              <Callout tone="warn" icon={Receipt} title={`إشعاراتٌ دائنة في الفترة: ${riyalsText(view.creditNotes.amountMinor)}`}>
                {countNoun(view.creditNotes.count, INVOICE)} أُنقص مستحقُّها بإشعارٍ دائن، وضريبةُ الفاتورة الأصليّة محسوبةٌ هنا كاملة. إنقاصُ ضريبة المدخلات بالإشعار يحدّده المحاسب — أرِه هذا السطر قبل التقديم.
              </Callout>
            )}
            <Callout tone="info" icon={Receipt}>
              المبيعاتُ هنا ما وصل البنك: تسوياتُ الشبكة وما ضممتَه من وارد{r.output.cashGrossMinor > 0 ? "، ومعها النقدُ الذي كتبتَه" : ". والنقدُ الذي لم يُودَع لا يظهر في الكشف — اكتبه في «نقدٌ لم يُودَع» أدناه"}.
              والإقرارُ نفسُه يُقدَّم في بوّابة الهيئة؛ هذا حسابُه.
            </Callout>
          </div>

          {/* ── الحساب سطراً سطراً ── */}
          <Section title="كيف جاء الرقم" icon={CalendarClock}>
            <Card padded={false}>
              <dl className="divide-y divide-line-soft text-sm">
                <Line
                  label={r.output.cashGrossMinor > 0 ? "ضريبةُ المبيعات: واردُ البنك والنقدُ المكتوب" : "ضريبةُ المبيعات الواردة إلى البنك"}
                  hint={countNoun(r.output.count, TRANSACTION)}
                  gross={r.output.count > 0 || r.output.cashGrossMinor > 0 ? r.output.grossMinor + r.output.cashGrossMinor : undefined}
                  minor={r.output.vatMinor}
                />
                <Line
                  label="− ضريبةُ الفواتير"
                  hint={r.input.invoices.confirmed.count > 0
                    ? `${countNoun(r.input.invoices.count, INVOICE)} — منها ${r.input.invoices.confirmed.count} بإقرارك`
                    : `${countNoun(r.input.invoices.count, INVOICE)} مستوفية`}
                  minor={-r.input.invoices.vatMinor}
                />
                <Line label="− ضريبةُ رسوم الشبكة والبنك" hint={countNoun(r.input.bankVat.count, TRANSACTION)} minor={-r.input.bankVat.vatMinor} />
                <Line label="− ضريبةُ حركاتٍ اخترتَها من الكشف" hint={countNoun(r.input.selected.count, TRANSACTION)} gross={r.input.selected.count > 0 ? r.input.selected.grossMinor : undefined} minor={-r.input.selected.vatMinor} />
                {r.carriedInMinor > 0 && view.carriedFrom && (
                  <Line label="− رصيدٌ دائنٌ مرحَّل" hint={`من ${quarterLabel(view.carriedFrom)}`} minor={-r.carriedInMinor} />
                )}
                <div className="flex items-center justify-between gap-3 bg-sunken/60 px-4 py-3 font-bold sm:px-5">
                  <dt>{r.netMinor >= 0 ? "= تسدّده للهيئة" : "= رصيدٌ لك"}</dt>
                  <dd><Money minor={Math.abs(r.netMinor)} currency tone={r.netMinor > 0 ? "warn" : "ok"} /></dd>
                </div>
              </dl>
            </Card>
          </Section>

          {view.byMonth.length > 0 && (
            <Section title="الربعُ شهراً بشهر" hint="يُري الشهرَ الشاذّ بنظرة — مبيعاتٌ هبطت لأنّ كشفَه ناقص، أو خصمٌ قفز. والتقريبُ لكلّ شهرٍ، فقد يخالف مجموعُها الربعَ بهللة.">
              <DataTable columns={monthColumns} rows={view.byMonth} keyOf={(m) => m.month} hrefOf={(m) => `/close/vat?period=${m.month}`} />
            </Section>
          )}

          {/* ── خاناتُ نموذج الهيئة ── */}
          {whole && (
            <Section
              title="للنسخ إلى نموذج الهيئة"
              icon={ClipboardList}
              hint="النموذجُ يطلب لكلّ خانةٍ المبلغَ قبل الضريبة والضريبة. الأرقامُ بالهللة كما حُسبت هنا — وأرقامُ الخانات بترتيب نموذج الإقرار؛ طابِقها بأسمائها في البوّابة."
              action={<LinkButton href={`/api/export/vat?period=${periodKey(period)}`} size="sm" icon={Download} prefetch={false}>نزّل سجلَّ الإقرار (Excel)</LinkButton>}
            >
              <DataTable columns={boxColumns} rows={formBoxes(r)} keyOf={(b) => b.key} />
            </Section>
          )}

          {/* ── النقدُ غير المودَع ── */}
          <Section
            id="cash"
            title="نقدٌ لم يُودَع"
            icon={Banknote}
            hint="مبيعاتٌ قبضتَها نقداً ولم تُودِعها في الحساب لا يراها الكشف. اكتب مجموعَها لكلّ شهر شاملاً الضريبة (من تقرير فودكس)، فتدخل ضريبةَ المخرجات بسطرها. والفارغُ «لم يُكتب» لا صفر — وما أودعتَه لا تكتبه: إيداعُه يُضمّ من الوارد."
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
          </Section>

          {toReview.length > 0 && (
            <Section
              id="review"
              title="راجِع قبل التقديم"
              icon={SearchCheck}
              count={toReview.length}
              hint="فواتيرُ محسوبةٌ في الخصم وفيها ما يستوقف: ضريبةٌ فوق النسبة، أو الفاتورةُ نفسُها تحت مورّدَين، أو رقمُ بائعٍ غيرُ رقم مورّدها، أو تاريخٌ بعيد. افتح الورقة — فإن كانت القراءةُ خطأً فصحّحها أو أخرِجها."
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
            title="اختر ما يُحسب في الاسترداد"
            count={debits.length}
            hint="صادرُ الكشف الذي دفعتَ فيه ضريبةً ولا فاتورةَ له عندنا — إيجارٌ أو كهرباءُ أو مورّدٌ لم تُرفع فاتورتُه. ما تختاره تُحسب ضريبتُه 15/115 من مبلغه. والاستردادُ عند الهيئة يحتاج فاتورةً ضريبيّةً باسم المؤسّسة — فلا تختر راتباً ولا تحويلاً شخصيّاً ولا رسماً حكوميّاً."
            action={changed.length > 0 && !filing ? <VatBulk ids={changed} included={null} variant="quiet">أعد كلَّ الاختيارات إلى الأصل</VatBulk> : undefined}
          >
            {groups.size > 0 && !filing && (
              <div className="mb-3 flex flex-wrap gap-2">
                {[...groups.values()].filter((g) => g.ids.length > 1).map((g) => (
                  <VatBulk key={g.label} ids={g.ids} included={!g.all}>
                    {g.all ? `أخرِج كلَّ ${g.label}` : `احسب كلَّ ${g.label}`} ({g.ids.length})
                  </VatBulk>
                ))}
              </div>
            )}
            <DataTable
              columns={txColumns("debit", locked)}
              rows={debits}
              keyOf={(t) => t.id}
              searchOf={(t) => `${t.label} ${t.categoryLabel}`}
              searchLabel="ابحث في الصادر"
              empty={<EmptyState compact title="لا صادرَ في الفترة." hint="يظهر هنا ما خرج من الحساب بعد استيراد كشفه." />}
            />
          </Section>

          {/* ── الوارد: المبيعات ── */}
          <Section
            id="credits"
            title="المبيعات الواردة إلى البنك"
            count={credits.length}
            hint="تسوياتُ الشبكة تُحسب مبيعاتٍ تلقائياً. وما ورد من غيرها (تطبيقُ توصيل، حوالةُ زبون) اختره ليُحسب، وأخرِج ما ليس بيعاً (ردُّ مورّدٍ أو إيداعٌ من المالك)."
          >
            <DataTable
              columns={txColumns("credit", locked)}
              rows={credits}
              keyOf={(t) => t.id}
              searchOf={(t) => `${t.label} ${t.categoryLabel}`}
              searchLabel="ابحث في الوارد"
              empty={<EmptyState compact title="لا واردَ في الفترة." hint="يظهر هنا ما دخل الحساب بعد استيراد كشفه." />}
            />
          </Section>

          {/* ── ضريبة الرسوم: تُحسب كلُّها، والتفصيلُ عند الطلب ── */}
          <Section
            title="ضريبة رسوم الشبكة والبنك"
            count={vatLines.length}
            hint="البنكُ يخصم ضريبةَ رسومه في حركةٍ مستقلّة — مبلغُها هو الضريبة، فتُحسب كاملة. فاتورتُها الضريبيّة في كشف التاجر من البنك."
          >
            {vatLines.length === 0 ? (
              <EmptyState compact title="لا ضريبةَ رسومٍ في الفترة." />
            ) : (
              <details className="group rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold sm:px-5">
                  <span>{countNoun(vatLines.filter((t) => t.included).length, TRANSACTION)} محسوبة من {vatLines.length}</span>
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
            title="فواتيرُ لا تُخصم ضريبتُها"
            icon={FileWarning}
            count={notDeductible.length}
            hint={
              notDeductible.length === 0
                ? `كلُّ فواتير الفترة (${countNoun(r.input.invoices.count, INVOICE)}) محسوبةٌ في الخصم.`
                : "حكم النظامُ أنّها لا تُخصم لأنّ ركناً من الفاتورة الضريبيّة لم يُقرأ — والعمودُ «ما لم يُقرأ» يسمّيه. انظر الورقة: إن كانت فاتورةً ضريبيّةً فيها رقمُ المورّد الضريبيّ ورقمُنا فاضغط «احسبها»، فتدخل الخصمَ بضريبتها المقروءة، أو 15/115 من إجماليّها إن لم تُقرأ ضريبتُها. ولا تتغيّر الفاتورةُ نفسُها؛ وفي الشهر المفتوح افتحها وصحّحها، فذلك العلاجُ الدائم."
            }
            action={confirmable.length > 1 && !filing ? (
              <VatBulk
                kind="invoice"
                ids={confirmable.map((i) => i.id)}
                included
                variant="subtle"
                confirm={{
                  title: `${countNoun(confirmable.length, INVOICE)} تدخل الخصمَ بإقرارٍ واحد`,
                  consequence: `ضريبتُها المقروءة ${riyalsText(confirmable.reduce((s, i) => s + (i.vatMinor ?? 0), 0))}`
                    + (derived.length > 0 ? `، و${countNoun(derived.length, INVOICE)} لم تُقرأ ضريبتُها فتُحسب 15/115 من إجماليّها تقديراً (${riyalsText(derived.reduce((s, i) => s + i.vatUsedMinor, 0))})` : "")
                    + `. أكبرُها: ${[...confirmable].sort((a, b) => b.vatUsedMinor - a.vatUsedMinor).slice(0, 3).map((i) => `${i.supplier} ${riyalsText(i.vatUsedMinor)}`).join(" · ")}. ويُتراجَع عنها من «فواتيرُ حسبتَها بإقرارك».`,
                  acknowledgement: "نظرتُ في أوراقها: فواتيرُ ضريبيّة فيها رقمُ المورّد الضريبيّ ورقمُنا.",
                }}
              >
                {`احسبها كلَّها (${confirmable.length})`}
              </VatBulk>
            ) : undefined}
          >
            {notDeductible.length > 0 && (
              <>
                <p className="mb-3 text-xs text-ink-soft">
                  ضريبتُها المقروءة <Money minor={r.notDeductible.vatKnownMinor} currency />
                  {r.notDeductible.vatUnknownCount > 0 && ` · و${countNoun(r.notDeductible.vatUnknownCount, INVOICE)} ضريبتُها غير مقروءة`}
                  {" "}— لا تدخل الحساب حتى تُقرّها.
                </p>
                {!filing && (bySupplier.length > 1 || knownFromRecord.length > 1) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {knownFromRecord.length > 1 && (
                      <VatBulk kind="invoice" ids={knownFromRecord.map((i) => i.id)} included variant="subtle">
                        احسب ما رقمُ مورّده معلومٌ من سجلّه ({knownFromRecord.length})
                      </VatBulk>
                    )}
                    {bySupplier.length > 1 && bySupplier.map((g) => (
                      <VatBulk key={g.supplierId} kind="invoice" ids={g.ids} included>
                        احسب فواتير {g.supplier} ({g.ids.length})
                      </VatBulk>
                    ))}
                  </div>
                )}
                {lost.length > 1 && (
                  <details className="group mb-3 rounded-xl border border-line bg-raised shadow-raised">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold sm:px-5">
                      <span>ضريبةٌ تضيع بالمورّد — من تطالبه بفاتورةٍ ضريبيّة باسم المؤسّسة ورقمها</span>
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
              title="فواتيرُ حسبتَها بإقرارك"
              count={confirmed.length}
              hint={`ضريبتُها في الخصم ${riyalsText(r.input.invoices.confirmed.vatMinor)}${r.input.invoices.confirmed.derivedCount > 0 ? ` — منها ${countNoun(r.input.invoices.confirmed.derivedCount, INVOICE)} حُسبت ضريبتُها 15/115 من إجماليّها لأنّها لم تُقرأ` : ""}. والإقرارُ في سجلّ التدقيق باسمك.`}
              action={filing ? undefined : <VatBulk kind="invoice" ids={confirmed.map((i) => i.id)} included={null} variant="quiet">تراجع عنها كلِّها</VatBulk>}
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
              title="الفواتيرُ المحسوبة"
              count={machine.length}
              hint="المستوفيةُ التي حكم لها النظام — بالأكبر ضريبةً أوّلاً. انظر فيها قبل التقديم: فاتورةٌ مكرّرة أو ضريبةٌ قُرئت خطأً تظهر في رأسها. و«أخرِجها» لما لا يحقّ خصمُه."
            >
              <details className="group rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold sm:px-5">
                  <span>{countNoun(machine.length, INVOICE)} مستوفية</span>
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
              مشترياتٌ قُرئت ضريبتُها صفراً: {countNoun(r.zeroRated.count, INVOICE)} بإجماليّ <Money minor={r.zeroRated.totalMinor} currency /> — لا ضريبةَ فيها تُخصم.
              النموذجُ يسأل عن المشتريات الصفريّة والمعفاة في خانتيهما؛ تصنيفُها للمحاسب.
            </p>
          )}
        </>
      )}
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
    header: "ضريبتُها المقروءة",
    numeric: true,
    cell: (g) => <span><Money minor={g.vatKnownMinor} />{g.unknownCount > 0 && <span className="ms-1 text-[11px] text-muted">+ {g.unknownCount} غير مقروءة</span>}</span>,
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
    { key: "1", label: "1 · المبيعات الخاضعة للنسبة الأساسيّة", amountMinor: r.output.netMinor, vatMinor: r.output.vatMinor },
    { key: "7", label: "7 · المشتريات المحلّيّة الخاضعة للنسبة الأساسيّة", amountMinor: r.input.baseMinor, vatMinor: r.input.totalMinor },
    ...(r.zeroRated.count > 0 ? [{ key: "10", label: "10–11 · مشترياتٌ بلا ضريبة (صفريّة أو معفاة — يصنّفها المحاسب)", amountMinor: r.zeroRated.totalMinor, vatMinor: null }] : []),
    ...(r.carriedInMinor > 0 ? [{ key: "15", label: "15 · ضريبةٌ مرحَّلة من فتراتٍ سابقة", amountMinor: null, vatMinor: r.carriedInMinor }] : []),
    { key: "16", label: r.netMinor >= 0 ? "16 · صافي الضريبة المستحقّة" : "16 · صافي الضريبة — رصيدٌ لك", amountMinor: null, vatMinor: Math.abs(r.netMinor) },
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
            {hint}{gross !== undefined && <> بمبلغ <Money minor={gross} /></>}
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
      header: "يُحسب",
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
          {t.coveredByInvoice && t.direction === "DEBIT" && <Badge tone="ok">فاتورتُها محسوبة</Badge>}
          {t.bounced && <Badge tone="muted">ارتدّت</Badge>}
          {t.blocked !== null && !t.coveredByInvoice && !t.bounced && <Badge tone="muted">{t.blocked}</Badge>}
          {t.supplierHasInvoices && t.blocked === null && t.direction === "DEBIT" && <Badge tone="warn">لمورّدها فواتيرُ محسوبة — تحقّق قبل أن تحسبها</Badge>}
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
      {i.carriedFromMonth && <Badge tone="muted">مرحَّلة من {formatMonth(i.carriedFromMonth)}</Badge>}
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
        {i.supplierVat && i.reasons.includes("رقمُ المورّد الضريبيّ") && (
          <span className="block text-muted">في سجلّ المورّد <bdi dir="ltr" className="font-mono">{i.supplierVat}</bdi></span>
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
      ? <span className="text-muted" title="15/115 من الإجمالي إن حسبتَها"><Money minor={i.vatUsedMinor} /> تقديراً</span>
      : <Money minor={i.vatMinor} />,
  },
  {
    key: "act",
    header: "",
    wrap: true,
    cell: (i) => filed ? null
      : i.choice === false ? <VatBulk kind="invoice" ids={[i.id]} included={null} variant="quiet">أعِدها لحكم النظام</VatBulk>
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
  { key: "act", header: "", wrap: true, reveal: true, cell: (i) => filed ? null : <VatBulk kind="invoice" ids={[i.id]} included={false} variant="quiet">أخرِجها</VatBulk> },
];

const reviewColumns = (filed: boolean): Column<VatInvoiceRow>[] => [
  { key: "supplier", header: "المورّد", primary: true, cell: (i) => i.supplier },
  { key: "number", header: "الرقم", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.number}</bdi>, secondary: true },
  { key: "why", header: "ما يستوقف", cell: (i) => <span className="text-xs leading-relaxed text-warn">{i.warnings.join(" · ")}</span> },
  { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
  { key: "vat", header: "الضريبة المخصومة", numeric: true, cell: (i) => <Money minor={i.vatUsedMinor} /> },
  { key: "act", header: "", wrap: true, cell: (i) => filed ? null : <VatBulk kind="invoice" ids={[i.id]} included={false} variant="quiet">أخرِجها</VatBulk> },
];
