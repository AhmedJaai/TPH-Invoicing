import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, FileWarning, Landmark, Receipt, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Callout, Card, DataTable, EmptyState, KeyFigure, LinkTabs, NoAccess, Section, type Column } from "@/components/ui";
import { VatBulk, VatTxToggle } from "@/components/vat-choice";
import { DAY, INVOICE, TRANSACTION, countNoun } from "@/lib/arabic";
import { INPUT_VAT_LABEL } from "@/lib/accountant-pack";
import { currentMonthRiyadh, daysSinceRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import {
  filingDeadline, parseVatPeriod, periodKey, periodMonths, previousQuarter, quarterLabel, quarterOfMonth,
  type VatPeriod, type VatQuarter,
} from "@/lib/vat-return";
import { loadVatReturn, type VatInvoiceRow, type VatTxRow } from "@/services/vat-return.service";

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
  const { result: r } = view;
  const deadline = filingDeadline(period);
  const daysLeft = -daysSinceRiyadh(deadline);
  const label = period.kind === "quarter" ? quarterLabel(period) : formatMonth(period.month);
  const open = view.coverage.some((c) => c.open);
  const gaps = view.coverage.filter((c) => c.gapDays === null || c.gapDays > 0);
  const nothing = view.txs.length === 0 && view.invoices.length === 0;

  const credits = view.txs.filter((t) => t.direction === "CREDIT");
  const vatLines = view.txs.filter((t) => t.direction === "DEBIT" && (t.category === "POS_VAT" || t.category === "BANK_VAT"));
  const debits = view.txs.filter((t) => t.direction === "DEBIT" && !vatLines.includes(t));
  const notDeductible = view.invoices.filter((i) => !(i.inputVatStatus === "ELIGIBLE" && i.vatMinor !== null));
  const changed = view.txs.filter((t) => t.choice !== null).map((t) => t.id);

  /*
    مجموعاتُ الصادر بتصنيفها — «احسب كلَّ الكهرباء» بنقرة. وللأبواب التي قد تحمل ضريبةً
    وحدها: زرُّ «احسب كلَّ الرواتب» يدعو إلى خطأٍ لا يُسترَدّ.
  */
  const groups = new Map<string, { label: string; ids: string[]; all: boolean }>();
  for (const t of debits) {
    if (t.coveredByInvoice || !BULK_CATEGORIES.has(t.category)) continue;
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
              label={r.netMinor >= 0 ? "تسدّده للهيئة" : "رصيدٌ لك عند الهيئة"}
              tone={r.netMinor > 0 ? "warn" : "ok"}
              value={<Money minor={Math.abs(r.netMinor)} currency />}
              sub={
                open ? "الفترةُ لم تنتهِ — الرقمُ يكبر بما يأتي."
                : daysLeft >= 0 ? `آخرُ موعدٍ للتقديم والسداد ${formatDay(deadline)} — بعد ${countNoun(daysLeft, DAY)}.`
                : `فات موعدُ التقديم (${formatDay(deadline)}) منذ ${countNoun(-daysLeft, DAY)}.`
              }
            />
            <KeyFigure
              icon={ArrowDownLeft}
              label="ضريبة المخرجات"
              value={<Money minor={r.output.vatMinor} currency />}
              sub={<>15/115 من <Money minor={r.output.grossMinor} /> وردت البنكَ مبيعاتٍ ({countNoun(r.output.count, TRANSACTION)}).</>}
            />
            <KeyFigure
              icon={ArrowUpRight}
              label="ضريبة المدخلات"
              value={<Money minor={r.input.totalMinor} currency />}
              sub={`من ${countNoun(r.input.invoices.count, INVOICE)} مستوفيةٍ وضريبةِ الرسوم وما اخترتَه من الكشف.`}
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
            <Callout tone="info" icon={Receipt}>
              المبيعاتُ هنا ما وصل البنك: تسوياتُ الشبكة وما ضممتَه من وارد. والنقدُ الذي لم يُودَع لا يظهر في الكشف —
              فإن بعتَ نقداً فأضِف ضريبتَه في الإقرار. والإقرارُ نفسُه يُقدَّم في بوّابة الهيئة؛ هذا حسابُه.
            </Callout>
          </div>

          {/* ── الحساب سطراً سطراً ── */}
          <Section title="كيف جاء الرقم" icon={CalendarClock}>
            <Card padded={false}>
              <dl className="divide-y divide-line-soft text-sm">
                <Line label="ضريبةُ المبيعات الواردة إلى البنك" hint={countNoun(r.output.count, TRANSACTION)} gross={r.output.count > 0 ? r.output.grossMinor : undefined} minor={r.output.vatMinor} />
                <Line label="− ضريبةُ الفواتير المستوفية" hint={`${countNoun(r.input.invoices.count, INVOICE)}`} minor={-r.input.invoices.vatMinor} />
                <Line label="− ضريبةُ رسوم الشبكة والبنك" hint={countNoun(r.input.bankVat.count, TRANSACTION)} minor={-r.input.bankVat.vatMinor} />
                <Line label="− ضريبةُ حركاتٍ اخترتَها من الكشف" hint={countNoun(r.input.selected.count, TRANSACTION)} gross={r.input.selected.count > 0 ? r.input.selected.grossMinor : undefined} minor={-r.input.selected.vatMinor} />
                <div className="flex items-center justify-between gap-3 bg-sunken/60 px-4 py-3 font-bold sm:px-5">
                  <dt>{r.netMinor >= 0 ? "= تسدّده للهيئة" : "= رصيدٌ لك"}</dt>
                  <dd><Money minor={Math.abs(r.netMinor)} currency tone={r.netMinor > 0 ? "warn" : "ok"} /></dd>
                </div>
              </dl>
            </Card>
          </Section>

          {/* ── الصادر: يختار ما يُستردّ ── */}
          <Section
            id="debits"
            title="اختر ما يُحسب في الاسترداد"
            count={debits.length}
            hint="صادرُ الكشف الذي دفعتَ فيه ضريبةً ولا فاتورةَ له عندنا — إيجارٌ أو كهرباءُ أو مورّدٌ لم تُرفع فاتورتُه. ما تختاره تُحسب ضريبتُه 15/115 من مبلغه. والاستردادُ عند الهيئة يحتاج فاتورةً ضريبيّةً باسم المؤسّسة — فلا تختر راتباً ولا تحويلاً شخصيّاً ولا رسماً حكوميّاً."
            action={changed.length > 0 ? <VatBulk ids={changed} included={null} variant="quiet">أعد كلَّ الاختيارات إلى الأصل</VatBulk> : undefined}
          >
            {groups.size > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {[...groups.values()].filter((g) => g.ids.length > 1).map((g) => (
                  <VatBulk key={g.label} ids={g.ids} included={!g.all}>
                    {g.all ? `أخرِج كلَّ ${g.label}` : `احسب كلَّ ${g.label}`} ({g.ids.length})
                  </VatBulk>
                ))}
              </div>
            )}
            <DataTable
              columns={txColumns("debit")}
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
              columns={txColumns("credit")}
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
                  <DataTable columns={txColumns("vat")} rows={vatLines} keyOf={(t) => t.id} />
                </div>
              </details>
            )}
          </Section>

          {/* ── الفواتير التي لا تُخصم ── */}
          <Section
            title="فواتيرُ لا تُخصم ضريبتُها"
            icon={FileWarning}
            count={notDeductible.length}
            hint={
              notDeductible.length === 0
                ? `كلُّ فواتير الفترة (${countNoun(r.input.invoices.count, INVOICE)}) مستوفيةٌ وضريبتُها محسوبة.`
                : "ينقصها ركنٌ من أركان الفاتورة الضريبيّة (رقمُ المورّد أو رقمُنا أو تفصيلُ الضريبة)، أو لم تُقرأ ضريبتُها. افتح الفاتورة: إن كانت مستوفيةً فصحّحها تُحسب، وإلّا فاطلب من المورّد فاتورةً ضريبيّة."
            }
          >
            {notDeductible.length > 0 && (
              <>
                <p className="mb-3 text-xs text-ink-soft">
                  ضريبتُها المقروءة <Money minor={r.notDeductible.vatKnownMinor} currency />
                  {r.notDeductible.vatUnknownCount > 0 && ` · و${countNoun(r.notDeductible.vatUnknownCount, INVOICE)} ضريبتُها غير معروفة`}
                  {" "}— لا تدخل الحساب.
                </p>
                <DataTable
                  columns={invoiceColumns}
                  rows={notDeductible}
                  keyOf={(i) => i.id}
                  hrefOf={(i) => `/purchases/invoices/${i.id}`}
                  searchOf={(i) => `${i.supplier} ${i.number}`}
                  searchLabel="ابحث في الفواتير"
                />
              </>
            )}
          </Section>
        </>
      )}
    </PageShell>
  );
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

function txColumns(kind: "debit" | "credit" | "vat"): Column<VatTxRow>[] {
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
          locked={t.coveredByInvoice && t.direction === "DEBIT" ? "ضريبتُها محسوبةٌ في فاتورتها" : undefined}
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
          {t.supplierHasInvoices && t.direction === "DEBIT" && <Badge tone="warn">لمورّدها فواتيرُ محسوبة — تحقّق قبل أن تحسبها</Badge>}
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

const invoiceColumns: Column<VatInvoiceRow>[] = [
  { key: "supplier", header: "المورّد", primary: true, cell: (i) => i.supplier },
  { key: "number", header: "الرقم", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.number}</bdi>, secondary: true },
  { key: "day", header: "التاريخ", cell: (i) => formatDay(i.day), secondary: true },
  { key: "status", header: "الحال", cell: (i) => <Badge tone={i.inputVatStatus === "UNKNOWN" ? "muted" : "warn"}>{i.vatMinor === null ? "ضريبتُها غير مقروءة" : INPUT_VAT_LABEL[i.inputVatStatus]}</Badge> },
  { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
  { key: "vat", header: "الضريبة", numeric: true, cell: (i) => (i.vatMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={i.vatMinor} />) },
];
