import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const KIND_LABEL: Record<string, string> = {
  TAX_INVOICE: "فاتورة ضريبية",
  SIMPLIFIED_INVOICE: "فاتورة مبسطة",
  STATEMENT: "كشف حساب",
  QUOTATION: "عرض سعر",
  PROFORMA: "فاتورة مبدئية",
  RECEIPT: "إيصال سداد",
  CASH_RECEIPT: "إيصال نقدي",
  CONTRACT: "عقد",
  UTILITY: "مرافق وحكومي",
  UNKNOWN: "غير محدَّد",
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ARCHIVED: { text: "مؤرشف", cls: "bg-ok-bg text-ok" },
  PENDING: { text: "معلّق", cls: "bg-warn-bg text-warn" },
  EXTRACTED: { text: "مقروء", cls: "bg-sunken text-ink-soft" },
  NEEDS_REVIEW: { text: "يحتاج مراجعة", cls: "bg-warn-bg text-warn" },
  REJECTED: { text: "مرفوض", cls: "bg-danger-bg text-danger" },
};

/** رابط الملف في الدرايف — المعرّف محفوظ لكل مستند منذ الأرشفة. */
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

interface Params {
  month?: string;
  supplier?: string;
  kind?: string;
  q?: string;
  page?: string;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? "bg-inverse-surface text-inverse-ink" : "border border-line text-ink-soft hover:border-ink-soft"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const p = await searchParams;
  const showAmounts = can(user.role, "amounts:view");
  const page = Math.max(1, Number(p.page ?? "1") || 1);

  const filters: SQL[] = [];
  if (p.month) filters.push(eq(documents.periodMonth, p.month));
  if (p.supplier) filters.push(eq(documents.supplierId, p.supplier));
  if (p.kind) filters.push(sql`${documents.kind}::text = ${p.kind}`);
  // البحث في اسم الملف كما هو في الدرايف — وهو ما يتذكّره المستخدم عادةً
  if (p.q?.trim()) filters.push(ilike(documents.fileName, `%${p.q.trim()}%`));
  const where = filters.length ? and(...filters) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(documents)
    .where(where);

  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      driveFileId: documents.driveFileId,
      kind: documents.kind,
      status: documents.status,
      periodMonth: documents.periodMonth,
      uploadedAt: documents.uploadedAt,
      supplierName: suppliers.nameAr,
      invoiceNumber: invoices.invoiceNumber,
      totalMinor: invoices.totalMinor,
      isTaxValid: invoices.isTaxValid,
    })
    .from(documents)
    .leftJoin(suppliers, eq(documents.supplierId, suppliers.id))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .where(where)
    .orderBy(desc(documents.periodMonth), desc(documents.uploadedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const monthRows = await db
    .select({ month: documents.periodMonth })
    .from(documents)
    .groupBy(documents.periodMonth)
    .orderBy(desc(documents.periodMonth));

  const supplierRows = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  const kindRows = await db
    .select({ kind: documents.kind, n: sql<number>`count(*)::int` })
    .from(documents)
    .groupBy(documents.kind)
    .orderBy(desc(sql`count(*)`));

  const link = (patch: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged = { ...p, ...patch, page: undefined };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, String(v));
    const qs = next.toString();
    return qs ? `/documents?${qs}` : "/documents";
  };

  const pageLink = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, page: String(n) })) if (v) next.set(k, String(v));
    return `/documents?${next.toString()}`;
  };

  const pages = Math.ceil(Number(total) / PAGE_SIZE);
  const hasFilter = Boolean(p.month || p.supplier || p.kind || p.q);

  return (
    <PageShell
      user={user}
      active="/documents"
      title="المستندات"
      intro="كل ما أُرشِف، وكلٌّ منها موصول بملفه في الدرايف. ابحث باسم الملف أو رشّح بالشهر أو المورّد أو النوع."
    >
      {/* ── البحث والترشيح ── */}
      <form action="/documents" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={p.q ?? ""}
          placeholder="ابحث في اسم الملف…"
          dir="auto"
          className="min-w-[12rem] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
        {p.month && <input type="hidden" name="month" value={p.month} />}
        {p.supplier && <input type="hidden" name="supplier" value={p.supplier} />}
        {p.kind && <input type="hidden" name="kind" value={p.kind} />}
        <button
          type="submit"
          className="rounded-lg bg-inverse-surface px-4 py-2 text-xs font-bold text-inverse-ink"
        >
          ابحث
        </button>
        {hasFilter && (
          <Link
            href="/documents"
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:border-ink-soft"
          >
            امسح الترشيح
          </Link>
        )}
      </form>

      <div className="mt-3 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip href={link({ month: undefined })} active={!p.month}>كل الأشهر</Chip>
          {monthRows.map((m) => (
            <Chip key={m.month} href={link({ month: m.month ?? undefined })} active={p.month === m.month}>
              <span dir="ltr">{m.month}</span>
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip href={link({ kind: undefined })} active={!p.kind}>كل الأنواع</Chip>
          {kindRows.map((k) => (
            <Chip key={k.kind} href={link({ kind: k.kind })} active={p.kind === k.kind}>
              {KIND_LABEL[k.kind] ?? k.kind} ({k.n})
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip href={link({ supplier: undefined })} active={!p.supplier}>كل المورّدين</Chip>
          {supplierRows.map((s) => (
            <Chip key={s.id} href={link({ supplier: s.id })} active={p.supplier === s.id}>
              {s.nameAr}
            </Chip>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted">
        {Number(total)} مستنداً{hasFilter ? " ضمن الترشيح" : ""}
        {pages > 1 && ` · صفحة ${page} من ${pages}`}
      </p>

      {rows.length === 0 ? (
        <div className="mt-3">
          <Empty
            message={
              hasFilter
                ? "لا مستندات تطابق الترشيح. جرّب توسيعه."
                : "لا مستندات بعد. ارفع فواتيرك أو زامن الدرايف من الصفحة الرئيسية."
            }
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-sunken text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-right font-medium">الملف</th>
                <th className="px-3 py-2 text-right font-medium">النوع</th>
                <th className="px-3 py-2 text-right font-medium">المورّد</th>
                <th className="px-3 py-2 text-right font-medium">الشهر</th>
                {showAmounts && <th className="px-3 py-2 text-right font-medium">المبلغ</th>}
                <th className="px-3 py-2 text-right font-medium">الحالة</th>
                <th className="px-3 py-2 text-right font-medium">الدرايف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-raised">
              {rows.map((r) => {
                const st = STATUS_LABEL[r.status] ?? { text: r.status, cls: "bg-sunken text-ink-soft" };
                return (
                  <tr key={r.id}>
                    <td className="max-w-[22rem] px-3 py-2.5">
                      <p className="truncate font-mono text-[11px]" dir="ltr" title={r.fileName}>
                        {r.fileName}
                      </p>
                      {r.invoiceNumber && (
                        <p className="text-[11px] text-muted" dir="ltr">
                          {r.invoiceNumber}
                          {r.isTaxValid === false && <span className="text-warn"> · لا خصم</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-soft">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.supplierName ?? "—"}</td>
                    <td className="nums px-3 py-2.5 text-xs text-muted" dir="ltr">
                      {r.periodMonth ?? "—"}
                    </td>
                    {showAmounts && (
                      <td className="px-3 py-2.5">
                        {r.totalMinor !== null ? <Money minor={r.totalMinor} /> : <span className="text-muted">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>
                        {st.text}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.driveFileId ? (
                        <a
                          href={driveUrl(r.driveFileId)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline underline-offset-4 hover:text-ink"
                        >
                          افتحه
                        </a>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageLink(page - 1)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-ink-soft">
              الأحدث
            </Link>
          ) : <span />}
          {page < pages ? (
            <Link href={pageLink(page + 1)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-ink-soft">
              الأقدم
            </Link>
          ) : <span />}
        </div>
      )}
    </PageShell>
  );
}
