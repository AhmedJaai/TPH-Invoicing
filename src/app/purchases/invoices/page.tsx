import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, LinkButton } from "@/components/ui";
import {
  OVERDUE_DAYS, PAGE_SIZE, PAID_LABEL, TAX_LABEL,
  describe as describeFilters, hasFilters, linkTo, parseFilters,
} from "@/lib/invoice-filter";
import { INVOICE, countNoun } from "@/lib/arabic";

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
  if (!user) redirect("/login");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الفواتير">
        <EmptyState title="دورك لا يشمل الأرقام المالية." hint="هذه الصفحة محجوبة عنك." />
      </PageShell>
    );
  }

  const f = parseFilters(await searchParams);

  const allocated = sql<number>`coalesce((
    select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = ${invoices.id}
  ), 0)`;
  const remaining = sql<number>`${invoices.totalMinor} - ${allocated}`;
  const lineCount = sql<number>`(
    select count(*)::int from invoice_lines l where l.invoice_id = ${invoices.id}
  )`;

  const clauses: SQL[] = [];
  if (f.month) clauses.push(eq(invoices.periodMonth, f.month));
  if (f.supplier) clauses.push(eq(suppliers.slug, f.supplier));
  if (f.tax) clauses.push(eq(invoices.taxStatus, f.tax));
  if (f.paid === "UNPAID") clauses.push(sql`${allocated} = 0`);
  if (f.paid === "PARTIAL") clauses.push(sql`${allocated} > 0 and ${allocated} < ${invoices.totalMinor}`);
  if (f.paid === "PAID") clauses.push(sql`${allocated} >= ${invoices.totalMinor}`);
  if (f.noLines) clauses.push(sql`${lineCount} = 0`);
  if (f.overdue) {
    clauses.push(sql`${remaining} > 0`);
    clauses.push(sql`${invoices.invoiceDate} < now() - interval '${sql.raw(String(OVERDUE_DAYS))} days'`);
  }
  const where = clauses.length ? and(...clauses) : undefined;

  const [rows, totals, months, supplierList] = await Promise.all([
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
        outstanding: sql<number>`coalesce(sum(greatest(0, ${remaining})), 0)::bigint`,
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
  ]);

  const t = totals[0];
  const pages = Math.max(1, Math.ceil(Number(t.n) / PAGE_SIZE));

  return (
    <PageShell
      user={user}
      width="wide"
      title="الفواتير"
      intro={describeFilters(f)}
      actions={
        hasFilters(f)
          ? <LinkButton href="/purchases/invoices" size="sm">امسح الترشيح</LinkButton>
          : <LinkButton href="/upload" variant="primary" size="sm">أضف فاتورة</LinkButton>
      }
    >
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Box label="المعروض" value={countNoun(Number(t.n), INVOICE)} />
        <Box label="قيمتها" minor={Number(t.billed)} />
        <Box
          label="ما بقي عليها"
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
          {(["UNPAID", "PARTIAL", "PAID"] as const).map((v) => (
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
          {supplierList.slice(0, 12).map((s) => (
            <Chip key={s.slug} href={linkTo(f, { supplier: f.supplier === s.slug ? undefined : s.slug })} on={f.supplier === s.slug}>
              {s.nameAr}
            </Chip>
          ))}
        </Row>
      </div>

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
                  <span className="nums block text-[11px] text-muted" dir="ltr">
                    {r.number ?? "بلا رقم"}
                  </span>
                </span>
              ),
            },
            {
              key: "date",
              header: "التاريخ",
              cell: (r) => <span className="nums">{r.date.toISOString().slice(0, 10)}</span>,
            },
            {
              key: "tax",
              header: "الضريبة",
              cell: (r) => (
                <Badge tone={r.taxStatus === "VALID" ? "ok" : r.taxStatus === "INVALID" ? "danger" : "muted"}>
                  {TAX_LABEL[r.taxStatus as keyof typeof TAX_LABEL] ?? r.taxStatus}
                </Badge>
              ),
            },
            {
              key: "lines",
              header: "البنود",
              align: "end",
              secondary: true,
              cell: (r) =>
                Number(r.lineCount) > 0
                  ? <span className="nums">{r.lineCount}</span>
                  : <span className="text-warn">لم تُقرأ</span>,
            },
            {
              key: "total",
              header: "الإجمالي",
              align: "end",
              cell: (r) => <Money minor={r.total} />,
            },
            {
              key: "remaining",
              header: "ما بقي",
              align: "end",
              cell: (r) => {
                const rem = r.total - Number(r.allocated);
                return rem <= 0
                  ? <Badge tone="ok">مسدَّدة</Badge>
                  : <span className="font-bold"><Money minor={rem} tone="warn" /></span>;
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
      <div className="scroll-x flex gap-1.5 pb-1">{children}</div>
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-pressed={on}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
        on ? "bg-inverse-surface text-inverse-ink" : "border border-line hover:border-ink-soft"
      }`}
    >
      {children}
    </Link>
  );
}
