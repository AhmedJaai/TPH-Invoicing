import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { ArrowLeft, ArrowRight, CircleCheck, FileText, Receipt, Scale, Upload, Wallet } from "lucide-react";
import { db } from "@/db";
import { invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { MarkInvoicePaid } from "@/components/mark-invoice-paid";
import { FilterSelect } from "@/components/filter-select";
import { formatRiyals } from "@/lib/money";
import { Money } from "@/components/money";
import {
  Badge, DataTable, EmptyState, LinkButton, LinkTabs, Monogram, NoAccess, Stat, buttonClass,
} from "@/components/ui";
import {
  OVERDUE_DAYS, PAGE_SIZE, PAID_LABEL, TAX_LABEL,
  describe as describeFilters, hasFilters, linkTo, parseFilters, type PaidFilter,
} from "@/lib/invoice-filter";
import { INVOICE, countNoun } from "@/lib/arabic";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { invoiceHref } from "@/lib/invoice-profile";

export const dynamic = "force-dynamic";

/**
 * قائمة الفواتير — ووجهة كل تنبيه يخصّها.
 *
 * كان التنبيه يقول «٦٥ فاتورة ينقصها ركن» ثمّ يرسل إلى صفحة عامّة يبحث
 * فيها المستخدم من جديد. فصار لكلّ حالٍ رابطُه (`tax` · `paid` · `month`
 * · `supplier` · `overdue` · `noLines`)، والتنبيهُ والإقفالُ يفتحانها بعينها.
 *
 * وهي نفسها شاشة المستحقّات: «ما عليّ» ليس نوعاً آخر من السجلات، بل
 * هذه القائمة مُرشَّحةً بما لم يُسدَّد. فالسدادُ ألسنةٌ فوق الجدول بأعدادها،
 * وما عداه قوائمُ منسدلة في سطرٍ واحد — كانت أربعةَ صفوفٍ من الشارات
 * تسبق أوّلَ فاتورة.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/purchases/invoices");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الفواتير">
        <NoAccess what="الفواتير" />
      </PageShell>
    );
  }

  const params = await searchParams;
  const f = parseFilters(params);
  /*
    `?fix=` كان يفتح لوحَ المعالجة فوق القائمة. وصار للفاتورة ملفُّها،
    والرابطُ القديم (تنبيهٌ محفوظ أو علامةُ متصفّح) يُوجَّه إليه.
  */
  const fixId = params.fix?.trim();
  if (fixId) redirect(invoiceHref(fixId, "tax"));

  /*
    `${invoices}.id` لا `${invoices.id}`: الثاني يُصيَّر عموداً مجرّداً في
    استعلامٍ على جدولٍ واحد فيُحلّ إلى `pa.id` ويصمت.
  */
  const allocated = sql<number>`coalesce((
    select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = ${invoices}.id
  ), 0)`;
  const remaining = sql<number>`${invoices.totalMinor} - ${allocated}`;
  const lineCount = sql<number>`(
    select count(*)::int from invoice_lines l where l.invoice_id = ${invoices}.id
  )`;

  /* حالُ السداد — العتبة نفسها في كلّ شاشةٍ تقول «عليك»: ما بقي فوق هللة */
  const PAID_WHERE: Record<PaidFilter, SQL> = {
    OPEN: sql`${remaining} > ${SETTLED_TOLERANCE_MINOR}`,
    UNPAID: sql`${allocated} = 0`,
    PARTIAL: sql`${allocated} > 0 and ${allocated} < ${invoices.totalMinor}`,
    PAID: sql`${remaining} <= ${SETTLED_TOLERANCE_MINOR}`,
  };

  /* كلُّ ترشيحٍ عدا السداد — فأعدادُ ألسنة السداد تُحسَب تحت ما عداها */
  const others: SQL[] = [];
  if (f.month) others.push(eq(invoices.periodMonth, f.month));
  if (f.supplier) others.push(eq(suppliers.slug, f.supplier));
  if (f.tax) others.push(eq(invoices.taxStatus, f.tax));
  if (f.noLines) others.push(sql`${lineCount} = 0`);
  if (f.overdue) {
    others.push(sql`${remaining} > 0`);
    others.push(sql`${invoices.invoiceDate} < now() - interval '${sql.raw(String(OVERDUE_DAYS))} days'`);
  }
  const clauses = f.paid ? [...others, PAID_WHERE[f.paid]] : others;
  const where = clauses.length ? and(...clauses) : undefined;
  const whereOthers = others.length ? and(...others) : undefined;

  const [rows, totals, buckets, months, supplierList] = await Promise.all([
    db
      .select({
        id: invoices.id,
        number: invoices.invoiceNumber,
        date: invoices.invoiceDate,
        month: invoices.periodMonth,
        total: invoices.totalMinor,
        taxStatus: invoices.taxStatus,
        supplier: suppliers.nameAr,
        supplierSlug: suppliers.slug,
        allocated,
        lineCount,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(where)
      .orderBy(desc(invoices.invoiceDate))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),

    db
      .select({
        n: sql<number>`count(*)::int`,
        billed: sql<number>`coalesce(sum(${invoices.totalMinor}), 0)::bigint`,
        outstanding: sql<number>`coalesce(sum(${remaining}) filter (where ${remaining} > ${SETTLED_TOLERANCE_MINOR}), 0)::bigint`,
        openN: sql<number>`count(*) filter (where ${remaining} > ${SETTLED_TOLERANCE_MINOR})::int`,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(where),

    /* عددُ كلّ لسان سداد — بالشروط نفسها التي يرشّح بها اللسان */
    db
      .select({
        all: sql<number>`count(*)::int`,
        OPEN: sql<number>`count(*) filter (where ${PAID_WHERE.OPEN})::int`,
        UNPAID: sql<number>`count(*) filter (where ${PAID_WHERE.UNPAID})::int`,
        PARTIAL: sql<number>`count(*) filter (where ${PAID_WHERE.PARTIAL})::int`,
        PAID: sql<number>`count(*) filter (where ${PAID_WHERE.PAID})::int`,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(whereOthers),

    db
      .select({ month: invoices.periodMonth })
      .from(invoices)
      .groupBy(invoices.periodMonth)
      .orderBy(desc(invoices.periodMonth)),

    db
      .select({ slug: suppliers.slug, nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.nameAr)),
  ]);

  const t = totals[0];
  const b = buckets[0];
  const count = Number(t.n);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const canPay = can(user.role, "payment:approve");
  const supplierName = supplierList.find((x) => x.slug === f.supplier)?.nameAr;
  const noInvoicesAtAll = months.length === 0;

  const paidTabs: { v: PaidFilter | undefined; label: string; n: number }[] = [
    { v: undefined, label: "الكلّ", n: Number(b.all) },
    { v: "OPEN", label: PAID_LABEL.OPEN, n: Number(b.OPEN) },
    { v: "UNPAID", label: PAID_LABEL.UNPAID, n: Number(b.UNPAID) },
    { v: "PARTIAL", label: PAID_LABEL.PARTIAL, n: Number(b.PARTIAL) },
    { v: "PAID", label: PAID_LABEL.PAID, n: Number(b.PAID) },
  ];

  type Row = (typeof rows)[number];

  return (
    <PageShell
      user={user}
      width="wide"
      title="الفواتير"
      intro={describeFilters(f, supplierName)}
      actions={
        hasFilters(f)
          ? <LinkButton href="/purchases/invoices" size="sm">امسح الترشيح</LinkButton>
          : undefined
      }
    >
      {noInvoicesAtAll ? (
        /* قاعدةٌ بلا فاتورة: لا «٠٫٠٠ بقي» — فالصفرُ يُقرأ «لا دَين» */
        <EmptyState
          icon={Receipt}
          title="لم تُسجَّل فاتورةٌ بعد."
          hint="تُسجَّل الفاتورة حين يُرفع مستندُها أو يُقرأ من الدرايف. صوّرها أو اختر ملفّها، ويقرأ النظامُ مورّدَها ومبالغها لتؤكّدها."
          action={<LinkButton href="/upload" variant="primary" icon={Upload}>ارفع أوّل فاتورة</LinkButton>}
        />
      ) : (
        <>
          {/* ── الأرقام: ما يُعرَض، وقيمتُه، وما بقي عليه ── */}
          {/* على الجوّال: ما بقي أوّلاً بعرض الشاشة، والرقمان الآخران تحته جنباً إلى جنب */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="order-2 sm:order-1">
              <Stat icon={FileText} label="المعروض" value={countNoun(count, INVOICE)} sub="الصفُّ كلُّه يفتح ملفَّ فاتورته." />
            </div>
            <div className="order-3 sm:order-2">
              <Stat icon={Scale} label="قيمتها" minor={Number(t.billed)} sub="مجموعُ إجماليّاتها بالضريبة." />
            </div>
            {/*
              ── ليست «عليك» ──

              مجموعُ ما بقي على **الفواتير المعروضة**. و«عليك للمورّدين» في
              صفحة المورّدين محسوبةٌ بالمورّد: يُخصَم رصيدُه عندنا من دَينه.
              فكان الرقمان يحملان الكلمة نفسها ويفترقان — فصار لكلٍّ اسمُه.
            */}
            <div className="order-1 col-span-2 sm:order-3 sm:col-span-1">
            <Stat
              icon={Wallet}
              label="بقي على هذه الفواتير"
              minor={Number(t.outstanding)}
              tone={Number(t.outstanding) > 0 ? "warn" : "ok"}
              href={f.paid === "OPEN" ? undefined : linkTo(f, { paid: "OPEN" })}
              sub={
                Number(t.openN) > 0
                  ? `على ${countNoun(Number(t.openN), INVOICE)} — وحسابُ كلّ مورّدٍ بعد رصيدك عنده في «المورّدون».`
                  : "لا شيء باقٍ على ما يُعرَض."
              }
            />
            </div>
          </div>

          {/* ── السداد ألسنةٌ بأعدادها، والباقي قوائمُ منسدلة ── */}
          <div className="mt-6 space-y-3 border-b border-line pb-3">
            <LinkTabs
              label="حال السداد"
              items={paidTabs.map((x) => ({
                href: linkTo(f, { paid: x.v }),
                label: x.label,
                count: x.n,
                active: f.paid === x.v,
              }))}
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <FilterSelect
                label="الضريبة"
                value={f.tax ?? ""}
                options={[
                  { value: "", label: "كلّ الحالات الضريبيّة", href: linkTo(f, { tax: undefined }) },
                  ...(["INVALID", "UNKNOWN", "VALID"] as const).map((v) => ({
                    value: v, label: TAX_LABEL[v], href: linkTo(f, { tax: v }),
                  })),
                ]}
              />
              <FilterSelect
                label="الشهر"
                value={f.month ?? ""}
                options={[
                  { value: "", label: "كلّ الأشهر", href: linkTo(f, { month: undefined }) },
                  ...months.filter((m) => m.month).map((m) => ({
                    value: m.month, label: formatMonth(m.month), href: linkTo(f, { month: m.month }),
                  })),
                ]}
              />
              <FilterSelect
                label="المورّد"
                value={f.supplier ?? ""}
                options={[
                  { value: "", label: "كلّ المورّدين", href: linkTo(f, { supplier: undefined }) },
                  ...supplierList.map((s) => ({ value: s.slug, label: s.nameAr, href: linkTo(f, { supplier: s.slug }) })),
                ]}
              />
              <Toggle href={linkTo(f, { overdue: !f.overdue })} on={Boolean(f.overdue)}>
                متأخّرة <span className="nums">{OVERDUE_DAYS}</span>+ يوماً
              </Toggle>
              <Toggle href={linkTo(f, { noLines: !f.noLines })} on={Boolean(f.noLines)}>
                بلا بنود
              </Toggle>
            </div>
          </div>

          <div className="mt-4">
            <DataTable
              rows={rows}
              keyOf={(r) => r.id}
              hrefOf={(r) => invoiceHref(r.id)}
              searchOf={(r) => [r.supplier, r.number, formatRiyals(r.total)].filter(Boolean).join(" ")}
              searchLabel="ابحث بالمورّد أو الرقم أو المبلغ"
              empty={
                <EmptyState
                  icon={CircleCheck}
                  title={f.paid === "OPEN" ? "لا فاتورة عليها رصيدٌ ضمن هذا الترشيح." : "لا فاتورة تطابق هذا الترشيح."}
                  hint="جرّب توسيعه، أو امسحه لترى كلّ الفواتير."
                  action={<LinkButton href="/purchases/invoices" variant="primary">امسح الترشيح</LinkButton>}
                />
              }
              columns={[
                {
                  key: "supplier",
                  header: "المورّد",
                  primary: true,
                  cell: (r) => (
                    <span className="flex min-w-0 items-center gap-3">
                      <Monogram name={r.supplier ?? "؟"} />
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{r.supplier ?? "بلا مورّد"}</span>
                        {/*
                          `isolate` يعزل ترتيب الرقم الداخليّ ويُبقي الكتلة في
                          اتّجاه الصفحة، فيقع تحت الاسم محاذياً له.
                        */}
                        <span className="nums block truncate text-[11px] font-normal text-muted" style={{ unicodeBidi: "isolate" }}>
                          {r.number ?? "بلا رقم"}
                        </span>
                      </span>
                    </span>
                  ),
                },
                { key: "date", header: "التاريخ", cell: (r) => <span className="text-ink-soft">{formatDay(r.date)}</span> },
                {
                  key: "tax",
                  header: "الضريبة",
                  /* الشارةُ بابٌ إلى سببها: من ضغطها رأى أيّ ركنٍ ينقص وصحّحه */
                  cell: (r) => {
                    const badge = (
                      <Badge tone={r.taxStatus === "VALID" ? "ok" : r.taxStatus === "INVALID" ? "danger" : "muted"} dot>
                        {TAX_LABEL[r.taxStatus as keyof typeof TAX_LABEL] ?? r.taxStatus}
                      </Badge>
                    );
                    if (r.taxStatus === "VALID" && Number(r.lineCount) > 0) return badge;
                    return (
                      <Link
                        href={invoiceHref(r.id, "tax")}
                        className="relative inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                        title="لماذا؟ وكيف تُصلَح"
                      >
                        {badge}
                        <span className="text-[11px] text-muted">لماذا؟</span>
                      </Link>
                    );
                  },
                },
                {
                  key: "lines",
                  header: "البنود",
                  numeric: true,
                  secondary: true,
                  cell: (r) =>
                    Number(r.lineCount) > 0
                      ? <span className="nums">{r.lineCount}</span>
                      : <span className="text-[11px] text-warn">لم تُقرأ</span>,
                },
                { key: "total", header: "الإجمالي", numeric: true, cell: (r) => <Money minor={r.total} /> },
                {
                  key: "remaining",
                  header: "ما بقي",
                  numeric: true,
                  cell: (r: Row) => {
                    const rem = r.total - Number(r.allocated);
                    if (rem <= SETTLED_TOLERANCE_MINOR) return <Badge tone="ok" dot>مسدَّدة</Badge>;
                    return (
                      <span className="inline-flex flex-col items-end">
                        <span className="font-bold"><Money minor={rem} tone="warn" /></span>
                        {Number(r.allocated) > 0 && <span className="text-[10px] text-muted">سُدّد بعضُها</span>}
                      </span>
                    );
                  },
                },
                {
                  /*
                    ── تسجيل السداد حيث تُرى الفاتورة ──

                    الفاتورة التي سُدّدت نقداً أو من شهرٍ أقدم لا موضعَ لتسجيلها
                    إلّا هنا — وإلّا بقيت «غير مسدَّدة» أبداً.
                  */
                  key: "pay",
                  header: "",
                  wrap: true,
                  cell: (r) => {
                    const rem = r.total - Number(r.allocated);
                    if (rem <= SETTLED_TOLERANCE_MINOR) return null;
                    /* تسجيل السداد كتابةُ مال — من لا يعتمد السداد يرى المتبقّي ولا يرى الزرّ */
                    return canPay ? <MarkInvoicePaid invoiceId={r.id} label={formatRiyals(rem)} /> : null;
                  },
                },
              ]}
            />
          </div>

          {pages > 1 && (
            <nav className="mt-5 flex items-center justify-between gap-3" aria-label="الصفحات">
              {f.page > 1 ? (
                <LinkButton href={linkTo(f, { page: f.page - 1 })} size="sm" icon={ArrowRight}>الأحدث</LinkButton>
              ) : <span />}
              <span className="text-xs text-muted">
                صفحة <span className="nums">{f.page}</span> من <span className="nums">{pages}</span>
              </span>
              {f.page < pages ? (
                <Link href={linkTo(f, { page: f.page + 1 })} className={buttonClass("secondary", "sm")}>
                  الأقدم
                  <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
                </Link>
              ) : <span />}
            </nav>
          )}
        </>
      )}
    </PageShell>
  );
}

/** مرشِّحٌ يُشغَّل ويُطفأ — والحالُ مكتوبةٌ في `aria-pressed` لا باللون وحده. */
function Toggle({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-pressed={on}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-bold transition-colors sm:min-h-9 ${
        on ? "border-accent-line bg-accent-soft text-accent" : "border-line-input bg-raised text-ink-soft hover:border-ink-soft"
      }`}
    >
      <span aria-hidden className={`grid h-3.5 w-3.5 place-items-center rounded-[4px] border ${on ? "border-accent bg-accent text-accent-ink" : "border-line-input"}`}>
        {on && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      {children}
    </Link>
  );
}
