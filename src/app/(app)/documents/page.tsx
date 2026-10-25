import { DocumentsBulk } from "@/components/documents-bulk";
import { Suspense, Fragment } from "react";
import { SavedViews } from "@/components/saved-views";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import {
  Archive, ArrowLeft, ArrowRight, CircleCheck, ExternalLink, FileSearch, FolderSync, Search, Upload,
} from "lucide-react";
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { DOCUMENT, countNoun, timeAgo } from "@/lib/arabic";
import { ConfirmEligible } from "@/components/confirm-eligible";
import { RestoreDocument } from "@/components/restore-document";
import { FilterSelect } from "@/components/filter-select";
import { WaitingCard } from "@/components/document-waiting-card";
import {
  Badge, Callout, DataTable, EmptyState, LinkButton, LinkTabs, Monogram, buttonClass, type Tone,
} from "@/components/ui";
import { invoiceReasons } from "@/lib/invoice-findings";
import { invoiceHref } from "@/lib/invoice-profile";
import { escapeLike } from "@/lib/search";
import { loadPendingReview } from "@/services/document-review.service";
import { GAP_TEXT } from "@/lib/extraction/auto-archive";
import { companyConfig } from "@/config/drive";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadDriveHeartbeat, type DriveHeartbeat } from "@/services/drive-status.service";

import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_BADGE, documentHref, driveFileUrl } from "@/lib/document-labels";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const KIND_LABEL = DOCUMENT_KIND_LABEL;
const STATUS_BADGE = DOCUMENT_STATUS_BADGE;

/** ما لم يُبتّ فيه — «ينتظر المراجعة» بأحواله الثلاث، كعدّاد الشريط. */
const WAITING = ["PENDING", "EXTRACTED", "NEEDS_REVIEW"] as const;
const isWaiting = (s: string) => (WAITING as readonly string[]).includes(s);


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
 * صاحب العمل لا يحتاج تصفّح مئةٍ وثلاثةٍ وثمانين ملفاً، بل معرفةَ أيّها
 * ينتظره. فتُفتَح الصفحة على **ما ينتظر المراجعة** — وصندوقُ الوارد
 * الفارغ خبرٌ سارّ لا صفحةٌ فارغة. و«الكلّ» اختيارٌ صريح بـ`?status=ALL`
 * كي يبقى الفرق بين «لم يختر» و«اختار الكلّ» ظاهراً في المسار.
 *
 * و«ينتظر المراجعة» بطاقاتٌ لا صفوف: لكلّ مستندٍ سببُ انتظاره وما قرأه
 * النموذج وفعلُه في موضعه. وما فُرغ منه جدولٌ يُبحث فيه.
 */
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
  const q = p.q?.trim() || undefined;

  /*
    ── أيّ الأحوال؟ ──

    بلا اختيارٍ فالوجهةُ صندوقُ الوارد. إلّا حين يصل بحثٌ بلا حال — من
    البحث العامّ أو من «أكمِل الناقص» في التسمية — فالمطلوبُ ملفٌّ بعينه
    أينما كان: كان يُفتَح على «ينتظر» فلا يجد المؤرشَف ويقول «لا شيء».
  */
  const tab: "WAITING" | "ARCHIVED" | "REJECTED" | "ALL" =
    p.status === "ALL" || (!p.status && q) ? "ALL"
    : p.status === "ARCHIVED" ? "ARCHIVED"
    : p.status === "REJECTED" ? "REJECTED"
    : "WAITING";
  /* `PENDING` و`EXTRACTED` روابطُ قديمة — تُحترَم بعينها تحت لسان «ينتظر» */
  const exact = p.status === "PENDING" || p.status === "EXTRACTED" ? p.status : null;
  const statusFilter: SQL | undefined =
    tab === "ALL" ? undefined
    : exact ? sql`${documents.status}::text = ${exact}`
    : tab === "WAITING" ? inArray(documents.status, [...WAITING])
    : eq(documents.status, tab);

  /*
    الترشيحات بلا الحالة أوّلاً، ثمّ الحالة فوقها — فعددُ كلّ لسانٍ يُحسب
    تحت الترشيحات الأخرى. كان يُحسَب بالحالة المختارة فيقول «الكل (٠)»
    تحت «يحتاج مراجعة» والمؤرشف ١٦٥.
  */
  const base: SQL[] = [];
  if (p.month) base.push(eq(documents.periodMonth, p.month));
  if (p.supplier) base.push(eq(documents.supplierId, p.supplier));
  if (p.kind) base.push(sql`${documents.kind}::text = ${p.kind}`);
  // البحث في اسم الملف كما هو في الدرايف — وهو ما يتذكّره المستخدم عادةً
  if (q) base.push(ilike(documents.fileName, `%${escapeLike(q)}%`));
  const where = and(...base, ...(statusFilter ? [statusFilter] : []));
  const whereBase = base.length ? and(...base) : undefined;

  /* استعلاماتٌ متوازية لا متسلسلة — لا يعتمد أيّها على الآخر */
  const [totalRows, rows, monthRows, supplierRows, statusRows, kindRows, anyDoc, pending, beat] = await Promise.all([
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
        textSource: documents.textSource,
        supplierName: suppliers.nameAr,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        totalMinor: invoices.totalMinor,
        taxStatus: invoices.taxStatus,
        /* ما يُبنى عليه «ما الذي يحتاج مراجعة؟» — يُشتقّ ولا يُخزَّن */
        invoiceId: invoices.id,
        sellerVat: invoices.sellerVat,
        buyerVat: invoices.buyerVat,
        subtotalMinor: invoices.subtotalMinor,
        discountMinor: invoices.discountMinor,
        chargesMinor: invoices.chargesMinor,
        vatMinor: invoices.vatMinor,
        issuesInvoices: suppliers.issuesInvoices,
        contractOnFile: suppliers.contractOnFile,
        lineCount: sql<number>`(
          select count(*)::int from invoice_lines l where l.invoice_id = ${invoices}.id
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
      .where(whereBase)
      .groupBy(documents.status),

    db
      .select({ kind: documents.kind, n: sql<number>`count(*)::int` })
      .from(documents)
      .groupBy(documents.kind)
      .orderBy(desc(sql`count(*)`)),

    db.select({ id: documents.id }).from(documents).limit(1),

    /*
      حكمُ الأرشفة الآليّة على ما ينتظر — ليُقال لماذا لم يدخل وحده بعينه،
      لا «لا ينقصها ركن» عن مستندٍ ينتظر بلا سببٍ ظاهر.
    */
    loadPendingReview(500),

    /* نبضُ الدرايف في الرأس — «هل تعمل المزامنة وحدها؟» جوابُه هنا لا في صفحةٍ أخرى */
    canDecide ? loadDriveHeartbeat(user.id).catch(() => null) : Promise.resolve(null),
  ]);

  const total = Number(totalRows[0].total);
  const byStatus = new Map(statusRows.map((r) => [r.status as string, Number(r.n)]));
  const nWaiting = WAITING.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0);
  const nArchived = byStatus.get("ARCHIVED") ?? 0;
  const nRejected = byStatus.get("REJECTED") ?? 0;
  const nAll = [...byStatus.values()].reduce((s, n) => s + n, 0);
  const verdicts = new Map(pending.map((d) => [d.id, d] as const));
  const eligible = pending.filter((d) => d.verdict.auto || d.recordable).length;
  const freshDb = anyDoc.length === 0;

  /*
    ── لماذا رُفض؟ ──

    «في فاتورة مرفوضة مدري ليش» (أحمد). الرفضُ فعلُ إنسانٍ وحده، وسببُه
    ومن رفعه في سجلّ التدقيق — لا في الصفحة. فيُعرَض بجانب الشارة، ومعه
    «أعِده للمراجعة»: القراءةُ محفوظة، فيُقيَّد ويُحكَم عليه من جديد.
  */
  const rejectedIds = rows.filter((r) => r.status === "REJECTED").map((r) => r.id);
  const rejections = new Map<string, { at: Date; by: string | null; reason: string | null }>();
  if (rejectedIds.length > 0) {
    const found = await db.execute<{ entity_id: string; at: Date; by: string | null; reason: string | null }>(sql`
      select distinct on (a.entity_id) a.entity_id, a.at, u.name as by, a.after->>'السبب' as reason
      from audit_logs a left join users u on u.id = a.actor_id
      where a.action = 'DOCUMENT_REJECTED' and a.entity_id in (${sql.join(rejectedIds.map((id) => sql`${id}`), sql`, `)})
      order by a.entity_id, a.at desc
    `);
    for (const f of found.rows) rejections.set(f.entity_id, { at: new Date(f.at), by: f.by, reason: f.reason });
  }

  type Row = (typeof rows)[number];

  /*
    سببُ الانتظار — يُشتقّ من الصفّ نفسه بالدالّة التي يحكم بها مسارُ
    الأرشفة، ولا يُستعلَم له ثانية. وما لا فاتورة له لا سبب ضريبيّ له.
  */
  const reasonsOf = (r: Row) =>
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
            discountMinor: r.discountMinor,
            chargesMinor: r.chargesMinor,
            lineCount: Number(r.lineCount),
          },
          r.issuesInvoices === null
            ? null
            : { issuesInvoices: r.issuesInvoices, contractOnFile: r.contractOnFile ?? false },
          companyConfig.vatNumber,
        ).filter((x) => x.severity !== "INFO")
      : [];

  /** لماذا ينتظر — بالعبارة التي قرّرت، لا «راجعه» بلا سبب. */
  const whyWaiting = (r: Row): { tone: "warn" | "ok" | "muted"; lines: string[] } => {
    const reasons = reasonsOf(r);
    if (reasons.length > 0) return { tone: "warn", lines: reasons.map((x) => x.what) };
    const v = verdicts.get(r.id);
    if (!v) return { tone: "muted", lines: ["قرأه النموذج. افتح الملف وقارن، ثم اعتمد."] };
    if (v.verdict.auto || v.recordable) return { tone: "ok", lines: ["اجتمعت فيه الشروط، فسيُعتمد تلقائياً أو بزر «اعتمدها كلها» أعلاه."] };
    const texts = v.missing.length > 0 ? v.missing : v.verdict.gaps.map((g) => GAP_TEXT[g]);
    return { tone: "warn", lines: texts.length > 0 ? texts : ["قرأه النموذج. افتح الملف وقارن، ثم اعتمد."] };
  };

  /* ── الروابط: الترشيحُ في العنوان ── */
  const statusParam = tab === "WAITING" ? undefined : tab;
  const link = (patch: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged: Params = { ...p, status: exact ?? statusParam, ...patch, page: undefined };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, String(v));
    const qs = next.toString();
    return qs ? `/documents?${qs}` : "/documents";
  };
  const pageLink = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, page: String(n) })) if (v) next.set(k, String(v));
    return `/documents?${next.toString()}`;
  };

  const pages = Math.ceil(total / PAGE_SIZE);
  const filtered = Boolean(p.month || p.supplier || p.kind || q);

  /*
    صندوقُ الوارد الفارغ خبرٌ سارّ — ويبقى نافعاً: ما وصل مؤخّراً تحته،
    فمن فتح الصفحة يسأل «هل قُرئت فاتورةُ اليوم؟» يجد جوابه بلا لسانٍ آخر.
  */
  const recent = tab === "WAITING" && !filtered && rows.length === 0
    ? await db
        .select({ id: documents.id, fileName: documents.fileName, status: documents.status, at: documents.uploadedAt, supplier: suppliers.nameAr })
        .from(documents)
        .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
        .orderBy(desc(documents.uploadedAt))
        .limit(6)
    : [];

  const tabs = [
    { id: "WAITING", label: "ينتظر المراجعة", count: nWaiting, href: link({ status: "NEEDS_REVIEW" }) },
    { id: "ARCHIVED", label: "المؤرشف", count: nArchived, href: link({ status: "ARCHIVED" }) },
    { id: "REJECTED", label: "المرفوض", count: nRejected, href: link({ status: "REJECTED" }) },
    { id: "ALL", label: "الكل", count: nAll, href: link({ status: "ALL" }) },
  ] as const;

  return (
    <PageShell
      user={user}
      width="wide"
      title="المستندات"
      intro="الفواتير والكشوف والإيصالات التي وصلتك. يظهر أولاً ما ينتظر قرارك، وكل مستند مرتبط بملفه في الدرايف."
      actions={beat ? <DrivePulse beat={beat} /> : undefined}
    >
      {freshDb ? (
        /* قاعدةٌ بلا مستند: لا ألسنة ولا أصفار — الخطوةُ الأولى وحدها */
        <EmptyState
          icon={Upload}
          title="لم يصل أي مستند بعد."
          hint="ارفع أول فاتورة بتصويرها بجوالك أو باختيار ملفها، أو زامن الدرايف ليقرأ النظام ما فيه، وسيظهر هنا كل ما يصل."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/upload" variant="primary" icon={Upload}>ارفع مستنداً</LinkButton>
              {canDecide && <LinkButton href="/documents/drive" variant="secondary" icon={FolderSync}>زامن الدرايف</LinkButton>}
            </div>
          }
        />
      ) : (
        <>
          {/* ── الحال أوّلاً، ثمّ البحث والترشيح في سطرٍ واحد ── */}
          <div className="space-y-3 border-b border-line pb-3">
            <LinkTabs
              label="حالة المستندات"
              items={tabs.map((t) => ({ href: t.href, label: t.label, count: t.count, active: tab === t.id }))}
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <form action="/documents" className="relative col-span-2 flex min-w-0 items-center sm:w-72" role="search">
                <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <input
                  name="q"
                  type="search"
                  defaultValue={q ?? ""}
                  placeholder="ابحث باسم الملف…"
                  aria-label="ابحث باسم الملف"
                  dir="auto"
                  className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-9 pe-3 text-sm sm:min-h-9"
                />
                {p.month && <input type="hidden" name="month" value={p.month} />}
                {p.supplier && <input type="hidden" name="supplier" value={p.supplier} />}
                {p.kind && <input type="hidden" name="kind" value={p.kind} />}
                {/* البحثُ داخل اللسان المفتوح — و«الكلّ» لسانٌ لمن أراده */}
                <input type="hidden" name="status" value={exact ?? statusParam ?? "NEEDS_REVIEW"} />
              </form>
              <FilterSelect
                label="الشهر"
                value={p.month ?? ""}
                options={[
                  { value: "", label: "كلّ الأشهر", href: link({ month: undefined }) },
                  ...monthRows.filter((m) => m.month).map((m) => ({
                    value: m.month as string,
                    label: formatMonth(m.month as string),
                    href: link({ month: m.month as string }),
                  })),
                ]}
              />
              <FilterSelect
                label="النوع"
                value={p.kind ?? ""}
                options={[
                  { value: "", label: "كلّ الأنواع", href: link({ kind: undefined }) },
                  ...kindRows.map((k) => ({
                    value: k.kind,
                    label: `${KIND_LABEL[k.kind] ?? k.kind} (${k.n})`,
                    href: link({ kind: k.kind }),
                  })),
                ]}
              />
              <FilterSelect
                label="المورّد"
                value={p.supplier ?? ""}
                options={[
                  { value: "", label: "كلّ المورّدين", href: link({ supplier: undefined }) },
                  ...supplierRows.map((s) => ({ value: s.id, label: s.nameAr, href: link({ supplier: s.id }) })),
                ]}
              />
              {filtered && (
                <Link href={link({ month: undefined, supplier: undefined, kind: undefined, q: undefined })} className={buttonClass("quiet", "sm")}>
                  امسح التصفية
                </Link>
              )}
            </div>
            {/* الترشيحُ الذي يُفتح كلَّ أسبوع يُحفَظ باسمه — على هذا الجهاز */}
            <Suspense fallback={null}>
              <SavedViews
                scope="documents"
                suggestedName={[
                  p.month ? formatMonth(p.month) : null,
                  p.kind ? KIND_LABEL[p.kind] ?? p.kind : null,
                  p.supplier ? supplierRows.find((r) => r.id === p.supplier)?.nameAr ?? null : null,
                  q ? `«${q}»` : null,
                ].filter(Boolean).join(" · ") || "طريقة العرض"}
              />
            </Suspense>
          </div>

          {/* العدُّ فوق الفراغ يكرّر ما يقوله الفراغ نفسه */}
          {rows.length > 0 && (
            <p className="mt-4 text-xs text-muted">
              {countNoun(total, DOCUMENT)}
              {filtered ? " ضمن نتائج التصفية" : ""}
              {q ? <> <T s=" · نتائج البحث عن «{0}»" a={[<bdi key="0">{q}</bdi>]} /></> : null}
              {pages > 1 && <> <T s=" · صفحة {0} من {1}" a={[<span key="0" className="nums">{page}</span>, <span key="1" className="nums">{pages}</span>]} /></>}
            </p>
          )}

          <div className="mt-3">
            {rows.length === 0 ? (
              tab === "WAITING" && !filtered ? (
                /* صندوقُ الوارد الفارغ خبرٌ سارّ — ويُعرَض بابُ الأرشيف لمن جاء يبحث فيه */
                <>
                <EmptyState
                  compact
                  icon={CircleCheck}
                  title="لا توجد مستندات تنتظر قرارك."
                  hint="تمّ اعتماد كل ما وصل أو رفضه. وما يصل لاحقاً بالرفع أو من الدرايف ويحتاج مراجعتك سيظهر هنا."
                  action={
                    <>
                      <LinkButton href={link({ status: "ARCHIVED" })} icon={Archive}>
                        <T s="اعرض المؤرشف ({0})" a={[nArchived]} /></LinkButton>
                      <LinkButton href="/upload" variant="primary" icon={Upload}>ارفع مستنداً</LinkButton>
                    </>
                  }
                />
                {recent.length > 0 && (
                  <section aria-labelledby="recent-docs" className="mt-8">
                    <h2 id="recent-docs" className="mb-3 text-[15px] font-bold">وصل مؤخراً</h2>
                    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                      {recent.map((d) => (
                        <li key={d.id}>
                          <Link
                            href={link({ status: "ALL", q: d.fileName })}
                            className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-bold" dir="auto">{d.supplier ?? d.fileName}</span>
                              <span className="block truncate text-[11px] text-muted" dir="auto">{d.fileName}</span>
                            </span>
                            <Badge tone={STATUS_BADGE[d.status]?.tone} dot>{STATUS_BADGE[d.status]?.text ?? d.status}</Badge>
                            <span className="hidden shrink-0 text-[11px] text-muted sm:block">{formatDay(d.at)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                </>
              ) : (
                <EmptyState
                  icon={FileSearch}
                  title={q ? `لا توجد هنا مستندات يحتوي اسمها على «${q}».` : "لا توجد مستندات تطابق هذه التصفية."}
                  hint={tab !== "ALL" ? "جرّب «الكل»، فقد تكون حالة المستند مختلفة، أو امسح التصفية." : "جرّب توسيع التصفية أو امسحها."}
                  action={
                    <>
                      {tab !== "ALL" && <LinkButton href={link({ status: "ALL" })}>ابحث في الكل</LinkButton>}
                      <LinkButton href={link({ month: undefined, supplier: undefined, kind: undefined, q: undefined })} variant="primary">
                        امسح التصفية
                      </LinkButton>
                    </>
                  }
                />
              )
            ) : tab === "WAITING" ? (
              <>
                {eligible > 0 && canDecide && showAmounts && (
                  <Callout
                    tone="ok"
                    icon={CircleCheck}
                    className="mb-4"
                    title={`${countNoun(eligible, DOCUMENT)} يمكن اعتمادها الآن دون مراجعة`}
                    action={<ConfirmEligible count={eligible} />}
                  >
                    هذه المستندات اجتمعت فيها الشروط، أو قُرئت كاملة ولم تُسجَّل فاتورتها بعد. بالضغط تُسجَّل وتُعتمد، وما لا يصح منها يبقى هنا مع سببه.
                  </Callout>
                )}
                <ul className="space-y-3" aria-label="مستندات تنتظر المراجعة">
                  {rows.map((r) => (
                    <WaitingCard
                      key={r.id}
                      row={r}
                      kindLabel={KIND_LABEL[r.kind] ?? r.kind}
                      why={whyWaiting(r)}
                      showAmounts={showAmounts}
                      canDecide={canDecide}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <DataTable
                rows={rows}
                keyOf={(r) => r.id}
                /* كلُّ صفٍّ يفتح ملفًّا: فاتورتَه إن قُيِّدت، وإلّا ملفَّ المستند — لا صفَّ ميّتاً */
                hrefOf={(r) => (r.invoiceId && showAmounts ? invoiceHref(r.invoiceId) : documentHref(r.id))}
                /* ما ينتظر يُحدَّد ويُعتمَد جماعةً — لمن يعتمد ويرى المبالغ، كالاعتماد صفّاً صفّاً */
                selectable={canDecide && showAmounts
                  ? { label: (r) => r.invoiceNumber ? `${r.supplierName ?? "مستند"} ${r.invoiceNumber}` : r.fileName, when: (r) => isWaiting(r.status) }
                  : undefined}
                bulk={canDecide && showAmounts ? <DocumentsBulk /> : undefined}
                columns={[
                  {
                    key: "doc",
                    header: "المستند",
                    primary: true,
                    cell: (r) => (
                      <span className="flex min-w-0 items-center gap-3" title={r.fileName}>
                        <Monogram name={r.supplierName ?? KIND_LABEL[r.kind] ?? "م"} />
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{r.supplierName ?? "مورّد غير معروف"}</span>
                          <span className="block truncate text-[11px] font-normal text-muted">
                            {r.invoiceNumber
                              ? <bdi className="nums">{r.invoiceNumber}</bdi>
                              : <span dir="ltr">{r.fileName}</span>}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                  { key: "kind", header: "النوع", secondary: true, cell: (r) => <span className="text-ink-soft">{KIND_LABEL[r.kind] ?? r.kind}</span> },
                  { key: "month", header: "الشهر", cell: (r) => <span className="text-ink-soft">{r.periodMonth ? formatMonth(r.periodMonth) : "غير معروف"}</span> },
                  ...(showAmounts
                    ? [{
                        key: "amount", header: "المبلغ", numeric: true,
                        /* بلا فاتورةٍ لا مبلغ مقيَّد — «—» لا «0.00» */
                        cell: (r: Row) => r.totalMinor !== null ? <Money minor={r.totalMinor} /> : <span className="text-muted">—</span>,
                      }]
                    : []),
                  {
                    key: "status",
                    header: "الحالة",
                    wrap: true,
                    cell: (r) => {
                      const st = STATUS_BADGE[r.status] ?? { text: r.status, tone: "muted" as Tone };
                      const j = rejections.get(r.id);
                      return (
                        <span className="block space-y-1.5">
                          <Badge tone={st.tone} dot>{st.text}</Badge>
                          {r.status === "ARCHIVED" && r.taxStatus === "INVALID" && (
                            <span className="block text-[11px] text-danger">لا يصلح لخصم الضريبة</span>
                          )}
                          {r.status === "REJECTED" && (
                            <span className="block text-[11px] leading-relaxed text-muted">
                              {j
                                ? <><T s="رُفض في {0}{1}: {2}" a={[formatDay(j.at), j.by ? <Fragment key="1"> <T s=" بواسطة {0}" a={[<bdi key="0">{j.by}</bdi>]} /></Fragment> : null, j.reason ?? "بلا سبب مكتوب"]} /></>
                                : "مرفوض، ولا يوجد سبب مسجّل."}
                            </span>
                          )}
                          {r.status === "REJECTED" && canDecide && showAmounts && <RestoreDocument documentId={r.id} />}
                          {isWaiting(r.status) && (
                            <Link href={link({ status: "NEEDS_REVIEW", q: r.fileName })} className="relative block text-[11px] font-bold text-accent hover:underline">
                              راجعه ←
                            </Link>
                          )}
                        </span>
                      );
                    },
                  },
                  {
                    key: "drive",
                    header: "الملف",
                    cell: (r) =>
                      r.driveFileId ? (
                        <a
                          href={driveFileUrl(r.driveFileId)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-8 items-center gap-1 text-xs font-bold text-ink-soft hover:text-accent"
                        >
                          <T s="{0}الدرايف" a={[<ExternalLink key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></a>
                      ) : (
                        <span className="text-xs text-muted">لا يوجد ملف</span>
                      ),
                  },
                ]}
              />
            )}
          </div>

          {pages > 1 && (
            <nav className="mt-5 flex items-center justify-between gap-3" aria-label="الصفحات">
              {page > 1 ? (
                <LinkButton href={pageLink(page - 1)} size="sm" icon={ArrowRight}>الأحدث</LinkButton>
              ) : <span />}
              <span className="text-xs text-muted">
                <T s="صفحة {0} من {1}" a={[<span key="0" className="nums">{page}</span>, <span key="1" className="nums">{pages}</span>]} /></span>
              {page < pages ? (
                <Link href={pageLink(page + 1)} className={buttonClass("secondary", "sm")}>
                  <T s="الأقدم{0}" a={[<ArrowLeft key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></Link>
              ) : <span />}
            </nav>
          )}
        </>
      )}
    </PageShell>
  );
}

/**
 * نبضُ الدرايف في رأس «المستندات»: آخرُ فحصٍ وحاله بلونٍ وكلمة، ويفتح لسان
 * «الدرايف». التعثّرُ أحمرُ بكلمته، والجهلُ «لم يُفحص بعد» — لا «يعمل» عن غير علم.
 */
function DrivePulse({ beat }: { beat: DriveHeartbeat }) {
  const state =
    beat.state === "preview" ? { dot: "bg-muted", text: "الدرايف: غير مربوط في نسخة التجربة" }
    : beat.state === "disconnected" ? { dot: "bg-danger", text: "الدرايف: غير مربوط بحسابك" }
    : beat.state === "failing" && beat.failure ? { dot: "bg-danger", text: `الدرايف: فشلت المزامنة ${timeAgo(beat.failure.at)}` }
    : beat.state === "ok" && beat.checkedAt ? { dot: "bg-ok", text: `الدرايف: آخر فحص ${timeAgo(beat.checkedAt)}` }
    : { dot: "bg-warn", text: "الدرايف: لم يُفحص بعد" };
  return (
    <Link href="/documents/drive" className={buttonClass("secondary", "sm")}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${state.dot}`} />
      {state.text}
    </Link>
  );
}
