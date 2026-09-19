import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { MarkInvoicePaid } from "@/components/mark-invoice-paid";
import { formatRiyals } from "@/lib/money";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, LinkButton, NoAccess } from "@/components/ui";
import {
  OVERDUE_DAYS, PAGE_SIZE, PAID_LABEL, TAX_LABEL,
  describe as describeFilters, hasFilters, linkTo, parseFilters,
} from "@/lib/invoice-filter";
import { INVOICE, countNoun } from "@/lib/arabic";
import { ScrollX } from "@/components/scroll-x";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { formatDay } from "@/lib/riyadh-time";
import { documents } from "@/db/schema";
import { invoiceReasons } from "@/lib/invoice-findings";
import { InvoiceFix } from "@/components/invoice-fix";
import { DocumentReread } from "@/components/document-reread";
import { companyConfig } from "@/config/drive";
import { Section } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * قائمة الفواتير — ووجهة كل تنبيه يخصّها.
 *
 * كان التنبيه يقول «٦٥ فاتورة ينقصها ركن» ثمّ يرسل إلى صفحة عامّة يبحث
 * فيها المستخدم من جديد. ولم تكن في النظام قائمة فواتير أصلاً: الفواتير
 * موجودة في القاعدة ولا شاشة تعرضها مُرشَّحة.
 *
 * وهي نفسها شاشة المستحقّات: «ما عليّ» ليس نوعاً آخر من السجلات، بل
 * هذه القائمة مُرشَّحةً بما لم يُسدَّد.
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
  /* الفاتورةُ المفتوحة للمعالجة — تُختار من الجدول ويُعرَض سببُها فوقه */
  const fixId = params.fix?.trim() || null;

  /*
    `${invoices}.id` لا `${invoices.id}`: الثاني يُصيَّر عموداً مجرّداً في
    استعلامٍ على جدولٍ واحد فيُحلّ إلى `pa.id` ويصمت. وكانت هذه الصفحة
    سليمةً بفضل `leftJoin` وحده — من يحذفه يجعل كلّ فاتورة «غير مسدَّدة».
  */
  const allocated = sql<number>`coalesce((
    select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = ${invoices}.id
  ), 0)`;
  const remaining = sql<number>`${invoices.totalMinor} - ${allocated}`;
  const lineCount = sql<number>`(
    select count(*)::int from invoice_lines l where l.invoice_id = ${invoices}.id
  )`;

  const clauses: SQL[] = [];
  if (f.month) clauses.push(eq(invoices.periodMonth, f.month));
  if (f.supplier) clauses.push(eq(suppliers.slug, f.supplier));
  if (f.tax) clauses.push(eq(invoices.taxStatus, f.tax));
  /* ما بقي عليه أكثر من هللة — العتبة نفسها في كلّ شاشةٍ تقول «عليك» */
  if (f.paid === "OPEN") clauses.push(sql`${remaining} > ${SETTLED_TOLERANCE_MINOR}`);
  if (f.paid === "UNPAID") clauses.push(sql`${allocated} = 0`);
  if (f.paid === "PARTIAL") clauses.push(sql`${allocated} > 0 and ${allocated} < ${invoices.totalMinor}`);
  if (f.paid === "PAID") clauses.push(sql`${remaining} <= ${SETTLED_TOLERANCE_MINOR}`);
  if (f.noLines) clauses.push(sql`${lineCount} = 0`);
  if (f.overdue) {
    clauses.push(sql`${remaining} > 0`);
    clauses.push(sql`${invoices.invoiceDate} < now() - interval '${sql.raw(String(OVERDUE_DAYS))} days'`);
  }
  const where = clauses.length ? and(...clauses) : undefined;
  const canEditInvoices = can(user.role, "document:upload");

  const [rows, totals, months, supplierList, fixRow] = await Promise.all([
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
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(where),

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

    /*
      حقولُ الفاتورة المفتوحة كاملةً — تُقرأ عند الطلب وحده. والسببُ
      يُشتقّ منها بـ`invoiceReasons`، ولا يُخزَّن: لو خُزّن لبقي السببُ
      القديم معروضاً بعد تصحيح الحقل.
    */
    fixId
      ? db
          .select({
            id: invoices.id,
            documentId: invoices.documentId,
            kind: documents.kind,
            invoiceNumber: invoices.invoiceNumber,
            sellerVat: invoices.sellerVat,
            buyerVat: invoices.buyerVat,
            subtotalMinor: invoices.subtotalMinor,
            vatMinor: invoices.vatMinor,
            totalMinor: invoices.totalMinor,
            supplierName: suppliers.nameAr,
            issuesInvoices: suppliers.issuesInvoices,
            contractOnFile: suppliers.contractOnFile,
            lineCount: sql<number>`(
              select count(*)::int from invoice_lines l where l.invoice_id = invoices.id
            )`,
          })
          .from(invoices)
          .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
          .leftJoin(documents, eq(documents.id, invoices.documentId))
          .where(eq(invoices.id, fixId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const t = totals[0];
  const pages = Math.max(1, Math.ceil(Number(t.n) / PAGE_SIZE));

  /*
    رابطُ المعالجة يحافظ على الترشيح القائم ويضيف `fix` — فمن فتح فاتورةً
    من قائمةٍ مرشَّحة يعود إليها بإغلاقها، ولا يُلقى في القائمة كاملةً.
  */
  const fixLink = (id: string) => {
    const base = linkTo(f, {});
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}fix=${encodeURIComponent(id)}#fix`;
  };

  const fix = fixRow[0] ?? null;
  /*
    السببُ يُشتقّ من الحقول وحالِ المورّد ورقمِ المنشأة — بالدالّة نفسها
    التي يحكم بها مسارُ الأرشفة. فما تقرؤه الشاشةُ هو ما يحكم به الخادم.
  */
  const fixReasons = fix
    ? invoiceReasons(
        {
          kind: fix.kind,
          invoiceNumber: fix.invoiceNumber,
          sellerVat: fix.sellerVat,
          buyerVat: fix.buyerVat,
          subtotalMinor: fix.subtotalMinor,
          vatMinor: fix.vatMinor,
          totalMinor: fix.totalMinor,
          lineCount: Number(fix.lineCount),
        },
        fix.issuesInvoices === null
          ? null
          : { issuesInvoices: fix.issuesInvoices, contractOnFile: fix.contractOnFile ?? false },
        companyConfig.vatNumber,
      )
    : [];

  return (
    <PageShell
      user={user}
      width="wide"
      title="الفواتير"
      intro={describeFilters(f)}
      actions={
        hasFilters(f)
          ? <LinkButton href="/purchases/invoices" size="sm">امسح الترشيح</LinkButton>
          : <LinkButton href="/upload" variant="primary" size="sm">ارفع مستنداً</LinkButton>
      }
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <Box label="المعروض" value={countNoun(Number(t.n), INVOICE)} />
        <Box label="قيمتها" minor={Number(t.billed)} />
        <Box
          label="ما بقي عليك"
          minor={Number(t.outstanding)}
          tone={Number(t.outstanding) > 0 ? "warn" : "ok"}
        />
      </div>

      {/* ── الترشيح ── */}
      <div className="mt-6 space-y-2.5">
        <Row label="الضريبة">
          {(["INVALID", "UNKNOWN", "VALID"] as const).map((v) => (
            <Chip key={v} href={linkTo(f, { tax: f.tax === v ? undefined : v })} on={f.tax === v}>
              {TAX_LABEL[v]}
            </Chip>
          ))}
        </Row>

        <Row label="السداد">
          {(["OPEN", "UNPAID", "PARTIAL", "PAID"] as const).map((v) => (
            <Chip key={v} href={linkTo(f, { paid: f.paid === v ? undefined : v })} on={f.paid === v}>
              {PAID_LABEL[v]}
            </Chip>
          ))}
          <Chip href={linkTo(f, { overdue: !f.overdue })} on={Boolean(f.overdue)}>
            متأخّرة {OVERDUE_DAYS}+ يوماً
          </Chip>
          <Chip href={linkTo(f, { noLines: !f.noLines })} on={Boolean(f.noLines)}>
            بلا بنود
          </Chip>
        </Row>

        <Row label="الشهر">
          {months.map((m) => (
            <Chip key={m.month} href={linkTo(f, { month: f.month === m.month ? undefined : m.month })} on={f.month === m.month}>
              {m.month}
            </Chip>
          ))}
        </Row>

        <Row label="المورّد">
          {/* كلّ المورّدين — كان يُعرض اثنا عشر من اثنين وعشرين بلا إشارة */}
          {supplierList.map((s) => (
            <Chip key={s.slug} href={linkTo(f, { supplier: f.supplier === s.slug ? undefined : s.slug })} on={f.supplier === s.slug}>
              {s.nameAr}
            </Chip>
          ))}
        </Row>
      </div>

      {/*
        ── لوحُ المعالجة ──

        كانت الشاشة تقول «ينقصها ركن» ولا تقول أيّ ركن، ولا تعطي موضعاً
        يُصحَّح فيه ما أخطأت القراءةُ فيه. فيقف صاحب المقهى أمام فاتورةٍ
        يعرف رقمها ولا يستطيع كتابته.
      */}
      {fix && (
        <Section
          id="fix"
          className="mt-6 scroll-mt-24"
          title={`معالجة فاتورة ${fix.invoiceNumber}`}
          hint={`${fix.supplierName ?? "بلا مورّد"} — ما ينقصها، وما يُصلحه.`}
          action={
            <Link href={linkTo(f, {})} className="text-xs underline underline-offset-4">
              أغلق ←
            </Link>
          }
        >
          {/*
            بابان لعطبٍ واحد: ما أخطأت القراءةُ فيه يُصحَّح بيد الإنسان،
            وما لم تقرأه أصلاً (البنود · التفصيل الضريبيّ) يُعاد قراءتُه.
            وكان أحدهما غائباً والآخر غائباً معه.
          */}
          <div className="mb-3">
            <DocumentReread documentId={fix.documentId} canEdit={canEditInvoices} />
          </div>

          <InvoiceFix
            invoiceId={fix.id}
            canEdit={canEditInvoices}
            reasons={fixReasons}
            initial={{
              invoiceNumber: fix.invoiceNumber ?? "",
              sellerVat: fix.sellerVat ?? "",
              buyerVat: fix.buyerVat ?? "",
              /*
                حقلٌ يُكتب فيه لا نصٌّ يُقرأ — فبلا فواصل آلاف:
                `formatRiyals` لا `formatRiyalsDisplay`. والفاصلةُ في
                حقلٍ يُعاد إرسالُه تدخل التحليل وتكذب.
              */
              subtotal: fix.subtotalMinor === null ? "" : formatRiyals(fix.subtotalMinor),
              vat: fix.vatMinor === null ? "" : formatRiyals(fix.vatMinor),
              total: fix.totalMinor === null ? "" : formatRiyals(fix.totalMinor),
            }}
          />
        </Section>
      )}

      <div className="mt-6">
        <DataTable
          rows={rows}
          keyOf={(r) => r.id}
          hrefOf={(r) => (r.supplierSlug ? `/suppliers/${r.supplierSlug}` : undefined)}
          empty={
            <EmptyState
              title="لا فاتورة تطابق هذا الترشيح."
              hint="جرّب توسيعه، أو امسحه لترى كل الفواتير."
              action={<LinkButton href="/purchases/invoices" variant="primary">امسح الترشيح</LinkButton>}
            />
          }
          columns={[
            {
              key: "supplier",
              header: "المورّد",
              primary: true,
              cell: (r) => (
                <span>
                  <span className="block font-medium">{r.supplier ?? "بلا مورّد"}</span>
                  {/*
                    `dir="ltr"` على عنصرٍ كتليّ كان يزيح الرقم إلى الحافّة
                    المقابلة، فيُقرأ لافتةً منفصلة لا تابعاً للاسم.
                    و`isolate` يعزل ترتيبه الداخليّ ويُبقي الكتلة في اتّجاه
                    الصفحة، فيقع تحت الاسم محاذياً له.
                  */}
                  <span className="nums block text-[11px] text-muted" style={{ unicodeBidi: "isolate" }}>
                    {r.number ?? "بلا رقم"}
                  </span>
                </span>
              ),
            },
            {
              key: "date",
              header: "التاريخ",
              cell: (r) => <span>{formatDay(r.date)}</span>,
            },
            {
              key: "tax",
              header: "الضريبة",
              /*
                الشارةُ كانت تقول الحكمَ ولا تفتح سببَه. وصارت باباً:
                من ضغطها رأى أيّ ركنٍ ينقص وصحّحه.
              */
              cell: (r) => {
                const badge = (
                  <Badge tone={r.taxStatus === "VALID" ? "ok" : r.taxStatus === "INVALID" ? "danger" : "muted"}>
                    {TAX_LABEL[r.taxStatus as keyof typeof TAX_LABEL] ?? r.taxStatus}
                  </Badge>
                );
                if (r.taxStatus === "VALID" && Number(r.lineCount) > 0) return badge;
                return (
                  <Link
                    href={fixLink(r.id)}
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    title="لماذا؟ وكيف تُصلَح"
                  >
                    {badge}
                    <span className="text-[10px] text-muted">لماذا؟</span>
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
                  : <span className="text-warn">لم تُقرأ</span>,
            },
            {
              key: "total",
              header: "الإجمالي",
              numeric: true,
              cell: (r) => <Money minor={r.total} />,
            },
            {
              key: "remaining",
              header: "ما بقي",
              numeric: true,
              cell: (r) => {
                const rem = r.total - Number(r.allocated);
                return rem <= SETTLED_TOLERANCE_MINOR
                  ? <Badge tone="ok">مسدَّدة</Badge>
                  : <span className="font-bold"><Money minor={rem} tone="warn" /></span>;
              },
            },
            {
              /*
                ── تسجيل السداد حيث تُرى الفاتورة ──

                كان الزرّ في «دفعة أوّل الشهر» وحدها، وهي تعرض شهراً
                واحداً: ما جاز تحويلُه من الشهر المنقضي. فالفاتورة التي
                سُدّدت نقداً أو من شهرٍ أقدم لا موضعَ لتسجيلها — تبقى
                «غير مسدَّدة» أبداً، ويبقى المستحقّ أكبر من الحقّ.
              */
              key: "pay",
              header: "",
              cell: (r) => {
                const rem = r.total - Number(r.allocated);
                if (rem <= SETTLED_TOLERANCE_MINOR) return null;
                /* تسجيل السداد كتابةُ مال — من لا يعتمد السداد يرى المتبقّي ولا يرى الزرّ */
                return can(user.role, "payment:approve")
                  ? <MarkInvoicePaid invoiceId={r.id} label={formatRiyals(rem)} />
                  : <span className="nums text-[11px] text-muted" dir="ltr">{formatRiyals(rem)}</span>;
              },
            },
          ]}
        />
      </div>

      {pages > 1 && (
        <nav className="mt-5 flex flex-wrap items-center justify-center gap-2" aria-label="الصفحات">
          {f.page > 1 && (
            <Link href={linkTo(f, { page: f.page - 1 })} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink-soft">
              السابق
            </Link>
          )}
          <span className="nums text-xs text-muted">{f.page} من {pages}</span>
          {f.page < pages && (
            <Link href={linkTo(f, { page: f.page + 1 })} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink-soft">
              التالي
            </Link>
          )}
        </nav>
      )}
    </PageShell>
  );
}

function Box({
  label, value, minor, tone,
}: {
  label: string;
  value?: string;
  minor?: number;
  tone?: "warn" | "ok";
}) {
  const cls = tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="rounded-2xl border border-line bg-raised px-3 py-3 shadow-raised sm:px-4">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`nums mt-1.5 font-display text-lg font-bold leading-none sm:text-xl ${cls}`}>
        {minor !== undefined ? <Money minor={minor} /> : value}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-14 shrink-0 text-[11px] text-muted">{label}</span>
      <ScrollX className="flex gap-1.5 pb-1">{children}</ScrollX>
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-[11px] font-medium transition-colors sm:min-h-0 sm:py-1 ${
        on ? "bg-inverse-surface text-inverse-ink" : "border border-line hover:border-ink-soft"
      }`}
    >
      {children}
    </Link>
  );
}
