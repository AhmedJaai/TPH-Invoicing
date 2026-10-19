import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Download, FileText } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { companyConfig } from "@/config/drive";
import { mainClass } from "@/components/page-shell";
import { Money } from "@/components/money";
import { EmptyState, LinkTabs, NoAccess, buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { loadAccountantPack } from "@/services/accountant-pack.service";
import {
  INPUT_VAT_LABEL, SMALL_FEE_CATEGORIES, SOURCE_LABEL, categoryLabel, expensesByCategory, invoiceOpenMinor,
  outflowByCategory, summarize, unexplained, vatByStatus, type PackInput,
} from "@/lib/accountant-pack";
import { METHOD_LABEL, paymentStatusLabel } from "@/lib/payment-state";
import { TAX_STATUS_LABEL } from "@/lib/validation";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * حزمةُ المحاسب ورقاً — تُطبَع أو تُحفَظ PDF.
 *
 * ملفُّ Excel للمحاسب الذي يجمع ويُرحّل (`/api/export/accountant`)، وهذه
 * للمحاسب الذي يريد أن يقرأ: الشهرُ من المصدر نفسه (`loadAccountantPack`)
 * والملخّصُ من الدالّة نفسها (`summarize`) — فلا يختلف الورقُ عن الملفّ
 * بريال. وحركاتُ البنك مئاتٌ في الشهر (رسومُ الشبكة وحدها ثلاثمئة)، فيُطبَع
 * صادرُها بأبوابه وما لا تفسيرَ له وحده، والتفصيلُ في الملفّ.
 *
 * والمجهولُ «غير معروف» لا صفراً، والمبيعاتُ غير موصولة فلا إيرادَ هنا — ويُقال.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function safe(read: () => string): string {
  try {
    return read();
  } catch {
    return "";
  }
}

export default async function AccountantPackPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/close/pack");

  const title = <title>حزمة المحاسب · ذا بوبليك هاوس</title>;
  if (!can(user.role, "month:close")) {
    return (
      <main id="main" className={mainClass("page")}>
        {title}
        <NoAccess what="حزمة المحاسب" />
      </main>
    );
  }

  const q = await searchParams;
  const current = currentMonthRiyadh();
  const month = q.month && MONTH_RE.test(q.month) && q.month <= current ? q.month : previousMonth(current);

  const recent: string[] = [];
  for (let m = previousMonth(current), i = 0; i < 6; i++, m = previousMonth(m)) recent.push(m);
  if (!recent.includes(month)) recent.push(month);

  const { input } = await loadAccountantPack(month);
  const s = summarize(input);
  const unclear = input.bank.filter(unexplained);
  const outflow = outflowByCategory(input);
  const namedExpenses = input.expenses.filter((e) => !SMALL_FEE_CATEGORIES.has(e.category));
  const empty = input.invoices.length === 0 && input.payments.length === 0 && input.expenses.length === 0 && input.bank.length === 0;
  const vat = safe(() => companyConfig.vatNumber);
  const cr = safe(() => companyConfig.crNumber);

  return (
    <main id="main" className={mainClass("page")}>
      <title>{`حزمة المحاسب — ${formatMonth(month)} · ذا بوبليك هاوس`}</title>
      <style>{`@media print { @page { size: A4; margin: 14mm 12mm; } aside[aria-label="وضع التجربة"] { display: none !important; } }`}</style>

      {/* ── الشريط: رجوعٌ، والشهر، والتنزيلُ والطباعة — لا يُطبَع ── */}
      <div className="no-print mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/close#export" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-accent sm:min-h-0">
            <T s="{0}إقفال الشهر" a={[<ArrowRight key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/export/accountant?month=${month}`} download className={buttonClass("secondary")}>
              <T s="{0}نزّل Excel" a={[<Download key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></a>
            <PrintButton />
          </div>
        </div>
        <LinkTabs
          label="شهر التقرير"
          items={recent.map((m) => ({ href: `/close/pack?month=${m}`, label: formatMonth(m), active: m === month }))}
        />
      </div>

      <article className="rounded-2xl border border-line bg-raised p-5 shadow-raised sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-wide text-muted">حزمة المحاسب</p>
            <h1 className="mt-1 text-2xl font-bold leading-tight">{formatMonth(month)}</h1>
            <p className={`mt-1.5 text-xs font-bold ${input.closed ? "text-ok" : "text-warn"}`}>
              {input.closed ? "الشهر مقفل، وأرقامه ثابتة." : "الشهر مفتوح، وقد تتغيّر أرقامه بما يُضاف لاحقاً."}
            </p>
          </div>
          <div className="text-end text-xs leading-relaxed text-ink-soft">
            <p className="text-sm font-bold text-ink">{companyConfig.nameAr}</p>
            <p>النسيم، جدة</p>
            {vat && <p><T s="الرقم الضريبي {0}" a={[<bdi key="0" dir="ltr" className="font-mono">{vat}</bdi>]} /></p>}
            {cr && <p><T s="السجل التجاري {0}" a={[<bdi key="0" dir="ltr" className="font-mono">{cr}</bdi>]} /></p>}
          </div>
        </header>

        {empty ? (
          <div className="mt-6">
            <EmptyState
              compact
              icon={FileText}
              title={`لا توجد قيود في ${formatMonth(month)}.`}
              hint="لا توجد في هذا الشهر فواتير ولا دفعات ولا مصروفات ولا حركات بنكية. اختر شهراً آخر."
            />
          </div>
        ) : (
          <>
            {/* ── الملخّص ── */}
            <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2 print:grid-cols-2">
              <SummaryBlock
                title="المشتريات"
                rows={[
                  ["عدد الفواتير", <span key="n" className="nums">{s.invoiceCount}</span>],
                  ["مجموع الفواتير", <Money key="t" minor={s.invoicesTotalMinor} />],
                  ["الضريبة كما قُرئت", <Money key="v" minor={s.vatKnownMinor} />],
                  ["فواتير لم تُقرأ ضريبتها", <span key="u" className={`nums ${s.vatUnknownCount > 0 ? "text-warn" : ""}`}>{s.vatUnknownCount}</span>],
                  ["ضريبة الفواتير المستوفية (رقم الإقرار الضريبي في صفحته)", <Money key="d" minor={s.deductibleVatMinor} />],
                  ["المسدَّد منها", <Money key="p" minor={s.paidMinor} />],
                  ["المتبقي منها", <Money key="o" minor={s.openMinor} />],
                ]}
              />
              <SummaryBlock
                title="المال"
                rows={[
                  ["دفعات الشهر (السارية)", <Money key="p" minor={s.paymentsMinor} />],
                  ...creditNoteRow(s.creditNotesMinor),
                  ["المصروفات", <Money key="e" minor={s.expensesMinor} />],
                  ["الداخل إلى البنك", <Money key="i" minor={s.bankInMinor} />],
                  ["الخارج من البنك", <Money key="o" minor={s.bankOutMinor} />],
                  ["مدفوعات غير مصنّفة", <span key="u" className={`nums ${s.bankUnexplainedCount > 0 ? "text-warn" : ""}`}>{s.bankUnexplainedCount}</span>],
                ]}
              />
            </div>

            {/* ── الضريبة ── */}
            <SheetSection title="ضريبة المدخلات">
              <SheetTable
                head={["الحالة", "عدد الفواتير", "الضريبة كما قُرئت", "ملاحظة"]}
                numeric={[1, 2]}
                rows={vatByStatus(input).map((v) => ({
                  key: v.status,
                  cells: [
                    INPUT_VAT_LABEL[v.status],
                    <span key="n" className="nums">{v.count}</span>,
                    <Money key="v" minor={v.vatKnownMinor} />,
                    v.unknownVat > 0 ? `منها ${v.unknownVat} لم تُقرأ ضريبتها` : "",
                  ],
                }))}
              />
            </SheetSection>

            {/* ── الفواتير ── */}
            <SheetSection title="الفواتير" count={input.invoices.length}>
              <SheetTable
                head={["الرقم", "التاريخ", "المورّد", "قبل الضريبة", "الضريبة", "الإجمالي", "حالتها الضريبية", "الباقي"]}
                numeric={[3, 4, 5, 7]}
                rows={input.invoices.map((i, idx) => ({
                  key: `${i.number}:${idx}`,
                  cells: [
                    <bdi key="n" dir="ltr" className="font-mono text-[11px]">{i.number}</bdi>,
                    <Day key="d" day={i.date} />,
                    i.supplier,
                    <Maybe key="s" minor={i.subtotalMinor} />,
                    <Maybe key="v" minor={i.vatMinor} />,
                    <Money key="t" minor={i.totalMinor} />,
                    `${TAX_STATUS_LABEL[i.taxStatus]} · ${INPUT_VAT_LABEL[i.inputVatStatus]}`,
                    <Money key="o" minor={invoiceOpenMinor(i)} />,
                  ],
                }))}
                foot={["المجموع", "", "", "", <Money key="v" minor={s.vatKnownMinor} />, <Money key="t" minor={s.invoicesTotalMinor} />, "", <Money key="o" minor={s.openMinor} />]}
              />
            </SheetSection>

            {/* ── الدفعات ── */}
            <SheetSection title="الدفعات" count={input.payments.length}>
              <PaymentsTable input={input} total={s.paymentsMinor} />
            </SheetSection>

            {/* ── المصروفات: بأبوابها، ثمّ بنودُها عدا الرسوم الصغيرة ── */}
            <SheetSection title="المصروفات حسب التصنيف" count={input.expenses.length}>
              <SheetTable
                head={["التصنيف", "عدد القيود", "المجموع"]}
                numeric={[1, 2]}
                rows={expensesByCategory(input).map((o) => ({
                  key: o.category,
                  cells: [categoryLabel(o.category), <span key="n" className="nums">{o.count}</span>, <Money key="t" minor={o.totalMinor} />],
                }))}
                foot={["المجموع", "", <Money key="t" minor={s.expensesMinor} />]}
              />
            </SheetSection>

            <SheetSection title="بنود المصروفات" count={namedExpenses.length}>
              <p className="mb-3 text-xs leading-relaxed text-ink-soft">
                لا تشمل رسوم الشبكة والبنك وضريبتها، فهي مئات القيود الصغيرة. مجموعها في الجدول أعلاه، وتفاصيلها في ملف Excel.
              </p>
              <SheetTable
                head={["التاريخ", "التصنيف", "الوصف", "المبلغ", "المصدر"]}
                numeric={[3]}
                rows={namedExpenses.map((e, idx) => ({
                  key: `${e.date}:${idx}`,
                  cells: [<Day key="d" day={e.date} />, categoryLabel(e.category), e.label, <Money key="a" minor={e.amountMinor} />, SOURCE_LABEL[e.source] ?? e.source],
                }))}
              />
            </SheetSection>

            {/* ── البنك: الصادرُ بأبوابه، ثمّ ما لا تفسيرَ له ── */}
            <SheetSection title="الخارج من البنك حسب التصنيف" count={input.bank.filter((b) => b.direction === "DEBIT").length}>
              <SheetTable
                head={["التصنيف", "عدد الحركات", "المجموع"]}
                numeric={[1, 2]}
                rows={outflow.map((o) => ({
                  key: o.category,
                  cells: [categoryLabel(o.category), <span key="n" className="nums">{o.count}</span>, <Money key="t" minor={o.totalMinor} />],
                }))}
                foot={["المجموع", "", <Money key="t" minor={s.bankOutMinor} />]}
              />
            </SheetSection>

            <SheetSection title="مدفوعات غير مصنّفة" count={unclear.length}>
              <p className="mb-3 text-xs leading-relaxed text-ink-soft">
                مبالغ خرجت بلا تصنيف، أو خرجت لمورّد دون دفعة مسجّلة تقابلها. تفاصيل كل الحركات في ملف Excel.
              </p>
              <SheetTable
                head={["التاريخ", "الوصف", "التصنيف", "المبلغ"]}
                numeric={[3]}
                empty="كل مبلغ خرج له تصنيف أو دفعة مسجّلة لمورّده."
                rows={unclear.map((b, idx) => ({
                  key: `${b.date}:${idx}`,
                  cells: [<Day key="d" day={b.date} />, b.description, categoryLabel(b.category), <Money key="a" minor={b.amountMinor} />],
                }))}
              />
            </SheetSection>
          </>
        )}

        <footer className="mt-8 space-y-1.5 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
          <p>
            الفواتير والمصروفات حسب شهرها المحاسبي، والدفعات وحركات البنك حسب يوم حدوثها بتوقيت الرياض. لا تدخل الدفعات المردودة أو الملغاة في المجموع، وما لم يُقرأ يظهر «غير معروف» وليس صفراً.
          </p>
          <p>المبيعات غير مربوطة بالنظام، لذلك لا يظهر الإيراد في هذه الحزمة.</p>
          <p><T s="صدرت هذه الحزمة من نظام {0} بتاريخ {1}." a={[companyConfig.nameAr, formatDay(input.generatedAt)]} /></p>
        </footer>
      </article>
    </main>
  );
}

function Maybe({ minor }: { minor: number | null }) {
  return minor === null ? <span className="text-muted">غير معروف</span> : <Money minor={minor} />;
}

/** سطرُ الإشعارات الدائنة — يُعرض حين يوجد، ويُقال إنّه لم يخرج له مال. */
function creditNoteRow(minor: number): [string, React.ReactNode][] {
  return minor > 0 ? [["إشعارات دائنة (لم يخرج بها مال)", <Money key="cn" minor={minor} />]] : [];
}

function SummaryBlock({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <section className="break-inside-avoid rounded-xl border border-line p-4">
      <h2 className="mb-2 text-[13px] font-bold">{title}</h2>
      <dl className="divide-y divide-line-soft text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SheetSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-bold">
        {title}
        {count !== undefined && <span className="nums text-xs font-medium text-muted">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * جدولُ ورقة — لا جدولُ شاشة: يُطبَع كاملاً بلا بطاقات ولا تمرير، وصفوفُه لا
 * تنكسر بين صفحتين، وأعمدةُ المال مصفوفةٌ على آخر خانة.
 */
function SheetTable({
  head,
  rows,
  numeric = [],
  foot,
  empty = "لا شيء في هذا الشهر.",
}: {
  head: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  numeric?: number[];
  foot?: React.ReactNode[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-center text-xs text-muted">{empty}</p>;
  }
  const cls = (i: number) => (numeric.includes(i) ? "nums-col" : "text-start");
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[34rem] border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-line bg-sunken text-[11px] text-muted print:bg-transparent">
            {head.map((h, i) => (
              <th key={h || i} scope="col" className="px-2 py-2 text-start font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="break-inside-avoid border-b border-line-soft">
              {r.cells.map((c, i) => (
                <td key={i} className={`px-2 py-1.5 align-top ${cls(i)}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-ink font-bold">
              {foot.map((c, i) => (
                <td key={i} className={`px-2 py-2 ${cls(i)}`}>{c}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function PaymentsTable({ input, total }: { input: PackInput; total: number }) {
  return (
    <SheetTable
      head={["التاريخ", "المورّد", "المبلغ", "طريقة الدفع", "الحالة", "على الفواتير"]}
      numeric={[2]}
      rows={input.payments.map((p, idx) => ({
        key: `${p.date}:${idx}`,
        cells: [
          <Day key="d" day={p.date} />,
          p.supplier ?? "غير منسوبة لمورّد",
          <Money key="a" minor={p.amountMinor} />,
          `${METHOD_LABEL[p.method] ?? p.method}${p.fromBank ? "" : " · إضافة يدوية"}`,
          paymentStatusLabel(p.status),
          p.invoices.length > 0 ? <bdi key="i" dir="ltr" className="font-mono text-[11px]">{p.invoices.join(" · ")}</bdi> : "—",
        ],
      }))}
      foot={["الإجمالي المستحق", "", <Money key="t" minor={total} />, "", "", ""]}
    />
  );
}

/** التاريخُ في سطرٍ واحد — «17 أغسطس 2026» مكسوراً سطرين يُضاعف طول الورقة. */
function Day({ day }: { day: string }) {
  return <span className="whitespace-nowrap">{formatDay(day)}</span>;
}
