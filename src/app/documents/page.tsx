import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageShell } from "@/components/page-shell";
import { DOCUMENT, countNoun } from "@/lib/arabic";
import { ScrollX } from "@/components/scroll-x";
import { RejectDocument } from "@/components/reject-document";
import { ConfirmDocument } from "@/components/confirm-document";
import { DataTable, EmptyState, LinkButton, buttonClass } from "@/components/ui";
import { invoiceReasons } from "@/lib/invoice-findings";
import { companyConfig } from "@/config/drive";

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

/*
  اسمٌ واحد لكلّ حال — في الشارة وفي الترشيح. كانت «قيد القراءة» في
  الترشيح «مقروءاً» في الصفّ (عكس المعنى)، و«محجور» هناك «مرفوضاً» هنا.
*/
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ARCHIVED: { text: "مؤرشف", cls: "bg-ok-bg text-ok" },
  PENDING: { text: "جديد", cls: "bg-warn-bg text-warn" },
  EXTRACTED: { text: "مقروء ولم يُعتمد", cls: "bg-sunken text-ink-soft" },
  NEEDS_REVIEW: { text: "يحتاج مراجعة", cls: "bg-warn-bg text-warn" },
  REJECTED: { text: "مرفوض", cls: "bg-danger-bg text-danger" },
};

/** رابط الملف في الدرايف — المعرّف محفوظ لكل مستند منذ الأرشفة. */
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

interface Params {
  month?: string;
  supplier?: string;
  kind?: string;
  status?: string;
  q?: string;
  page?: string;
}

/**
 * صندوق الوارد — لا متصفّح ملفات.
 *
 * الأرشيف وحده متصفّح ملفات؛ وصاحب العمل لا يحتاج تصفّح مئةٍ وثلاثةٍ
 * وثمانين ملفاً، بل يحتاج معرفة أيّها ينتظره.
 *
 * وكانت الصفحة تُفتَح على «الكل (١٨٣)»: مئةٌ وسبعةٌ وستّون منها مؤرشفةٌ
 * فُرغ منها، وخمسةَ عشرَ تنتظر. فيقع العملُ الباقي وسط ما انتهى، ويُقرأ
 * الصفُّ الأوّل بلا فرقٍ بين ما يحتاجه وما لا يحتاجه.
 *
 * فصارت تُفتَح على **ما ينتظر** — وصندوقُ الوارد الفارغ خبرٌ سارّ لا
 * صفحةٌ فارغة. و«الكل» بضغطةٍ واحدة، وتُطلَب صراحةً بـ`?status=ALL`
 * كي يبقى الفرق بين «لم يختر» و«اختار الكلّ» ظاهراً في المسار.
 */
const ALL_STATUSES = "ALL";

/** الحال الافتراضيّة: ما ينتظر قراراً. */
const INBOX_STATUS = "NEEDS_REVIEW";
const STATUS_BUCKETS: { id: string; label: string; tone?: "warn" | "ok" }[] = [
  { id: "PENDING", label: STATUS_LABEL.PENDING.text, tone: "warn" },
  { id: "EXTRACTED", label: STATUS_LABEL.EXTRACTED.text },
  { id: "NEEDS_REVIEW", label: STATUS_LABEL.NEEDS_REVIEW.text, tone: "warn" },
  { id: "ARCHIVED", label: STATUS_LABEL.ARCHIVED.text, tone: "ok" },
  { id: "REJECTED", label: STATUS_LABEL.REJECTED.text },
];

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
      className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors sm:min-h-0 ${
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
  if (!user) redirect("/login?from=/documents");

  const p = await searchParams;
  const showAmounts = can(user.role, "amounts:view");
  const canDecide = can(user.role, "document:upload");
  const page = Math.max(1, Number(p.page ?? "1") || 1);

  /*
    الترشيحات بلا الحالة أوّلاً، ثمّ الحالة فوقها — لأنّ «الكل» يعني كلَّ
    الحالات تحت الترشيحات الأخرى. كان يُحسَب بالحالة المختارة فيقول
    «الكل (٠)» تحت «يحتاج مراجعة» والمؤرشف ١٦٥.
  */
  const baseFilters: SQL[] = [];
  if (p.month) baseFilters.push(eq(documents.periodMonth, p.month));
  if (p.supplier) baseFilters.push(eq(documents.supplierId, p.supplier));
  if (p.kind) baseFilters.push(sql`${documents.kind}::text = ${p.kind}`);
  // البحث في اسم الملف كما هو في الدرايف — وهو ما يتذكّره المستخدم عادةً
  if (p.q?.trim()) baseFilters.push(ilike(documents.fileName, `%${p.q.trim()}%`));
  /*
    ما لم يُختَر شيء فالوجهةُ صندوقُ الوارد. و«الكل» اختيارٌ صريح، فلا
    يلتبس «لم يختر» بـ«اختار الكلّ».
  */
  const chosenStatus =
    p.status === ALL_STATUSES ? undefined : (p.status ?? INBOX_STATUS);
  const filters: SQL[] = chosenStatus
    ? [...baseFilters, sql`${documents.status}::text = ${chosenStatus}`]
    : baseFilters;
  const where = filters.length ? and(...filters) : undefined;
  const whereAllStatuses = baseFilters.length ? and(...baseFilters) : undefined;

  /*
    ستّة استعلامات متوازية لا متسلسلة.

    كانت تُنتظر واحداً بعد واحد، وكلٌّ رحلةُ شبكة إلى Neon — فيُجمع
    تأخيرها كلّه قبل أوّل رسم. ولا يعتمد أيّها على الآخر، فلا سبب
    لتسلسلها.
  */
  const [totalRows, rows, monthRows, supplierRows, statusRows, kindRows, allStatusRows] = await Promise.all([
    db.select({ total: count() }).from(documents).where(where),

    db
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
        taxStatus: invoices.taxStatus,
        /* ما يُبنى عليه «ما الذي يحتاج مراجعة؟» — يُشتقّ ولا يُخزَّن */
        invoiceId: invoices.id,
        sellerVat: invoices.sellerVat,
        buyerVat: invoices.buyerVat,
        subtotalMinor: invoices.subtotalMinor,
        vatMinor: invoices.vatMinor,
        issuesInvoices: suppliers.issuesInvoices,
        contractOnFile: suppliers.contractOnFile,
        lineCount: sql<number>`(
          select count(*)::int from invoice_lines l where l.invoice_id = invoices.id
        )`,
      })
      .from(documents)
      .leftJoin(suppliers, eq(documents.supplierId, suppliers.id))
      .leftJoin(invoices, eq(invoices.documentId, documents.id))
      .where(where)
      .orderBy(desc(documents.periodMonth), desc(documents.uploadedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),

    db
      .select({ month: documents.periodMonth })
      .from(documents)
      .groupBy(documents.periodMonth)
      .orderBy(desc(documents.periodMonth)),

    db
      .select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.nameAr)),

    db
      .select({ status: documents.status, n: sql<number>`count(*)::int` })
      .from(documents)
      .groupBy(documents.status),

    db
      .select({ kind: documents.kind, n: sql<number>`count(*)::int` })
      .from(documents)
      .groupBy(documents.kind)
      .orderBy(desc(sql`count(*)`)),

    db.select({ total: count() }).from(documents).where(whereAllStatuses),
  ]);

  const total = totalRows[0].total;
  const statusCount = new Map(statusRows.map((r) => [r.status as string, Number(r.n)]));

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
  const hasFilter = Boolean(p.month || p.supplier || p.kind || p.q || p.status);
  const inboxEmpty = chosenStatus === INBOX_STATUS && Number(total) === 0;

  /*
    سببُ «يحتاج مراجعة» — يُشتقّ من الصفّ نفسه، ولا يُستعلَم له ثانية.
    وما لا فاتورة له لا سبب ضريبيّ له: كشفٌ أو إيصالٌ يُراجَع بعينه.
  */
  const reasonOf = (r: (typeof rows)[number]) =>
    r.invoiceId
      ? invoiceReasons(
          {
            kind: r.kind,
            invoiceNumber: r.invoiceNumber,
            sellerVat: r.sellerVat,
            buyerVat: r.buyerVat,
            subtotalMinor: r.subtotalMinor,
            vatMinor: r.vatMinor,
            totalMinor: r.totalMinor,
            lineCount: Number(r.lineCount),
          },
          r.issuesInvoices === null
            ? null
            : { issuesInvoices: r.issuesInvoices, contractOnFile: r.contractOnFile ?? false },
          companyConfig.vatNumber,
        )
      : [];

  return (
    <PageShell
      user={user}
      width="wide"
     
      title="المستندات"
      intro="صندوق وارد: ما ينتظر قرارك أوّلاً. وكلُّ مستندٍ موصولٌ بملفّه في الدرايف."
    >
      {/* ── البحث والترشيح ── */}
      <form action="/documents" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={p.q ?? ""}
          placeholder="ابحث في اسم الملف…"
          aria-label="ابحث في اسم الملف"
          dir="auto"
          className="min-w-[12rem] flex-1 rounded-lg border border-line-input bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
        />
        {p.month && <input type="hidden" name="month" value={p.month} />}
        {p.supplier && <input type="hidden" name="supplier" value={p.supplier} />}
        {p.kind && <input type="hidden" name="kind" value={p.kind} />}
        {p.status && <input type="hidden" name="status" value={p.status} />}
        <button
          type="submit"
          className={buttonClass("primary", "sm")}
        >
          ابحث
        </button>
        {hasFilter && (
          <Link
            href="/documents"
            className={buttonClass("secondary", "sm")}
          >
            امسح الترشيح
          </Link>
        )}
      </form>

      <div className="mt-3 space-y-2">
        {/* الحالة أوّلاً: ما ينتظرك قبل ما مضى */}
        <ScrollX className="flex gap-1.5 pb-1">
          <Chip href={link({ status: ALL_STATUSES })} active={p.status === ALL_STATUSES}>
            الكل ({Number(allStatusRows[0].total)})
          </Chip>
          {STATUS_BUCKETS.map((b) => {
            const n = statusCount.get(b.id) ?? 0;
            if (n === 0 && p.status !== b.id) return null;
            return (
              <Chip key={b.id} href={link({ status: b.id })} active={chosenStatus === b.id}>
                <span className={p.status === b.id ? "" : b.tone === "warn" ? "text-warn" : b.tone === "ok" ? "text-ok" : ""}>
                  {b.label} ({n})
                </span>
              </Chip>
            );
          })}
        </ScrollX>
        <ScrollX className="flex gap-1.5 pb-1">
          <Chip href={link({ month: undefined })} active={!p.month}>كل الأشهر</Chip>
          {monthRows.map((m) => (
            <Chip key={m.month} href={link({ month: m.month ?? undefined })} active={p.month === m.month}>
              <span dir="ltr">{m.month}</span>
            </Chip>
          ))}
        </ScrollX>
        <ScrollX className="flex gap-1.5 pb-1">
          <Chip href={link({ kind: undefined })} active={!p.kind}>كل الأنواع</Chip>
          {kindRows.map((k) => (
            <Chip key={k.kind} href={link({ kind: k.kind })} active={p.kind === k.kind}>
              {KIND_LABEL[k.kind] ?? k.kind} ({k.n})
            </Chip>
          ))}
        </ScrollX>
        <ScrollX className="flex gap-1.5 pb-1">
          <Chip href={link({ supplier: undefined })} active={!p.supplier}>كل المورّدين</Chip>
          {supplierRows.map((s) => (
            <Chip key={s.id} href={link({ supplier: s.id })} active={p.supplier === s.id}>
              {s.nameAr}
            </Chip>
          ))}
        </ScrollX>
      </div>

      <p className="mt-4 text-xs text-muted">
        {countNoun(Number(total), DOCUMENT)}{hasFilter ? " ضمن الترشيح" : ""}
        {pages > 1 && ` · صفحة ${page} من ${pages}`}
      </p>

      {rows.length === 0 ? (
        <div className="mt-3">
          {/*
            صندوقُ الوارد الفارغ خبرٌ سارّ لا صفحةٌ فارغة — فيُقال ذلك،
            ويُعرَض بابُ الأرشيف لمن جاء يبحث فيه.
          */}
          {inboxEmpty ? (
            <EmptyState
              title="لا مستند ينتظر قرارك."
              hint="كلُّ ما وصل قد اعتُمد أو رُفض. وما مضى في الأرشيف."
              action={
                <LinkButton href={link({ status: ALL_STATUSES })}>
                  افتح الأرشيف ({Number(allStatusRows[0].total)})
                </LinkButton>
              }
            />
          ) : (
            <Empty
              message={
                hasFilter
                  ? "لا مستندات تطابق الترشيح. جرّب توسيعه."
                  : "لا مستندات بعد. ارفع فواتيرك أو زامن الدرايف من صفحة الرفع."
              }
            />
          )}
        </div>
      ) : (
        <div className="mt-3">
          {/*
            جدولٌ يصير بطاقات على الجوّال — كان عرضه ٤٦ ريم فيُسحب أفقيّاً.
            والعمود الأبرز المورّدُ والرقم لا اسمُ ملفّ الدرايف: الاسم
            يبقى في رابط «افتحه».
          */}
          <DataTable
            rows={rows}
            keyOf={(r) => r.id}
            columns={[
              {
                key: "doc", header: "المستند", primary: true,
                cell: (r) => (
                  <span title={r.fileName}>
                    <span className="block truncate font-medium">{r.supplierName ?? KIND_LABEL[r.kind] ?? "مستند"}</span>
                    <span className="block text-[11px] font-normal text-muted">
                      {r.invoiceNumber ? <span className="nums" style={{ unicodeBidi: "isolate" }}>{r.invoiceNumber}</span> : "بلا رقم"}
                      {r.taxStatus === "INVALID" && <span className="text-danger"> · لا يصلح لخصم الضريبة</span>}
                      {r.taxStatus === "UNKNOWN" && <span className="text-warn"> · لم تُقرأ ضريبته</span>}
                    </span>
                  </span>
                ),
              },
              { key: "kind", header: "النوع", secondary: true, cell: (r) => <span className="text-ink-soft">{KIND_LABEL[r.kind] ?? r.kind}</span> },
              { key: "month", header: "الشهر", cell: (r) => <span className="nums text-muted" dir="ltr">{r.periodMonth ?? "—"}</span> },
              ...(showAmounts
                ? [{
                    key: "amount", header: "المبلغ", numeric: true,
                    cell: (r: (typeof rows)[number]) => r.totalMinor !== null ? <Money minor={r.totalMinor} /> : <span className="text-muted">—</span>,
                  }]
                : []),
              {
                key: "status", header: "الحالة",
                cell: (r) => {
                  const st = STATUS_LABEL[r.status] ?? { text: r.status, cls: "bg-sunken text-ink-soft" };
                  return (
                    <span className="block">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.text}</span>
                      {/*
                        ── «يحتاج مراجعة» كان لا يقول ماذا ──

                        فيقف صاحب المقهى أمام زرّين — «اعتمد» و«ارفض» —
                        ولا يعرف ما الذي يُراجَع. والاعتمادُ على غير
                        علمٍ أسوأ من الرفض.

                        والسببُ مشتقٌّ من حقول الفاتورة بالدالّة نفسها
                        التي يحكم بها مسارُ الأرشفة، فيُعرَض أوّلُه هنا
                        وتفصيلُه خلف الرابط ومعه موضعُ التصحيح.
                      */}
                      {["PENDING", "EXTRACTED", "NEEDS_REVIEW"].includes(r.status) && (
                        reasonOf(r).length > 0 ? (
                          <span className="mt-1 block text-[11px] leading-relaxed text-warn">
                            {reasonOf(r)[0].what}
                            {reasonOf(r).length > 1 && ` (و${reasonOf(r).length - 1} غيره)`}
                            {r.invoiceId && (
                              <>
                                {" · "}
                                <Link
                                  href={`/purchases/invoices?fix=${encodeURIComponent(r.invoiceId)}#fix`}
                                  className="font-bold text-ink underline underline-offset-4"
                                >
                                  صحّحه
                                </Link>
                              </>
                            )}
                          </span>
                        ) : (
                          /*
                            لا نقصَ فيها — فالمراجعةُ مراجعةُ قراءةٍ لا
                            مراجعةُ عطب. وقولُ ذلك يُنهي حَيرةَ «ما الذي
                            يُراجَع؟»: افتح الملفّ وقارن الأرقام، ثمّ اعتمد.
                          */
                          <span className="mt-1 block text-[11px] leading-relaxed text-muted">
                            لا ينقصها ركن — قرأها النموذجُ ولم يؤكّدها إنسانٌ بعد. افتح الملفّ وقارن ثمّ اعتمد.
                          </span>
                        )
                      )}
                      {/* ما ينتظر قراراً له فعلٌ في موضعه — لا «راجعه» بلا زرّ */}
                      {canDecide && ["PENDING", "EXTRACTED", "NEEDS_REVIEW"].includes(r.status) && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {r.status === "NEEDS_REVIEW" && showAmounts && <ConfirmDocument documentId={r.id} />}
                          {(showAmounts || r.totalMinor === null) && <RejectDocument documentId={r.id} />}
                        </span>
                      )}
                    </span>
                  );
                },
              },
              {
                key: "drive", header: "الدرايف",
                cell: (r) => r.driveFileId ? (
                  <a href={driveUrl(r.driveFileId)} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                    افتحه
                  </a>
                ) : <span className="text-muted">—</span>,
              },
            ]}
          />
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
