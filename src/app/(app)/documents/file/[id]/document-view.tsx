import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Brain, CircleAlert, CircleCheck, CircleX, ExternalLink, FileText, FileWarning, History, PenLine, Receipt,
  ScanText, Sparkles, TriangleAlert, Wrench,
} from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DetailFrame, type DetailMode } from "@/components/detail-frame";
import { Money } from "@/components/money";
import { Badge, Callout, EmptyState, LinkButton, Meter, Monogram, NoAccess, Section, Timeline, buttonClass, type TimelineItem } from "@/components/ui";
import { DocumentRecord } from "@/components/document-record";
import { DocumentReread } from "@/components/document-reread";
import { RejectDocument } from "@/components/reject-document";
import { RestoreDocument } from "@/components/restore-document";
import { ConfirmDocument } from "@/components/confirm-document";
import { loadDocumentProfile } from "@/services/document-profile.service";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_BADGE, documentHref } from "@/lib/document-labels";
import { GAP_TEXT, type AutoArchiveGap } from "@/lib/extraction/auto-archive";
import { FIELD_LABEL, LOW_CONFIDENCE, invoiceHref } from "@/lib/invoice-profile";
import { actionLabel } from "@/lib/audit-labels";
import { formatDay, formatMonth } from "@/lib/riyadh-time";

/**
 * ملفُّ المستند — ما هو، وما يمنعه، وكيف قرّر النظامُ فيه، وماذا تفعل به.
 *
 * كان «أكمِل الناقص» (الدرايف ← التسمية) يفتح قائمةً مصفّاة لا يُكمَل فيها
 * شيء. فصار لكلّ مستندٍ ملفّ: الناقصُ يُكتب في مكانه وتُقيَّد فاتورتُه،
 * ويُرفض أو يُعاد أو يُقرأ من جديد، ويُقال بصراحةٍ ما قرأه النموذج وأيُّ
 * شرطٍ منعه من الدخول وحده — **من الدوالّ التي قرّرت** لا بنصٍّ يُكتب ثانيةً.
 */
export async function DocumentView({ params, mode }: { params: Promise<{ id: string }>; mode: DetailMode }) {
  const { id } = await params;
  const fullHref = documentHref(id);
  const user = await currentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(fullHref)}`);
  if (!can(user.role, "document:view")) {
    return (
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="مستند">
        <NoAccess what="المستندات" />
      </DetailFrame>
    );
  }

  const p = await loadDocumentProfile(id);
  if (!p) {
    return (
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="مستندٌ غير موجود">
        <EmptyState
          icon={FileWarning}
          title="لم يعد هذا المستند في النظام."
          hint="ربما دُمج بنسخته — والأثرُ في سجلّ التدقيق، وملفُّه في الدرايف لا يُمسّ."
          action={<LinkButton href="/documents" variant="primary">كلّ المستندات</LinkButton>}
        />
      </DetailFrame>
    );
  }

  const canEdit = can(user.role, "document:upload");
  const showAmounts = can(user.role, "amounts:view");
  const status = DOCUMENT_STATUS_BADGE[p.status] ?? { text: p.status, tone: "muted" as const };
  const isInvoiceKind = p.kind === "TAX_INVOICE" || p.kind === "SIMPLIFIED_INVOICE";
  const recordable = !p.invoice && !p.statementId && p.status !== "REJECTED";
  const byDesign = !isInvoiceKind && p.kind !== "STATEMENT";
  const waiting = p.status === "PENDING" || p.status === "EXTRACTED" || p.status === "NEEDS_REVIEW";

  const supplierOptions = recordable && canEdit && showAmounts
    ? await db.select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug, folder: suppliers.driveFolderName })
        .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.nameAr))
    : [];

  /* ── الجوابُ في سطر: ما حالُه وما يمنعه ── */
  const headline = p.invoice
    ? { tone: "ok" as const, icon: CircleCheck, text: "قُيِّدت له فاتورة" }
    : p.statementId
      ? { tone: "ok" as const, icon: CircleCheck, text: "قُيِّد كشفاً" }
      : p.status === "REJECTED"
        ? { tone: "danger" as const, icon: CircleX, text: "رُفض — لا يدخل الحساب" }
        : p.twin && isInvoiceKind
          ? { tone: "warn" as const, icon: TriangleAlert, text: `نسخةٌ من الفاتورة ${p.twin.number} المقيَّدة — ارفضه ولا تقيّده ثانيةً` }
        : p.twin
          /* عرضُ السعر برقم فاتورةٍ قُيِّدت: هو عرضُ الطلب نفسه، لا نسخة — لا شيء عليك */
          ? { tone: "ok" as const, icon: CircleCheck, text: `${DOCUMENT_KIND_LABEL[p.kind] ?? p.kind} — قُيِّدت فاتورتُه برقمه ${p.twin.number}، لا شيء عليك` }
        : byDesign
          ? { tone: "muted" as const, icon: FileText, text: `${DOCUMENT_KIND_LABEL[p.kind] ?? p.kind} — لا يُقيَّد فاتورةً` }
          : p.missing.length > 0
            ? { tone: "danger" as const, icon: CircleAlert, text: "لم تُقيَّد له فاتورة — ينقصه ما يُقيَّد به" }
            /* كلُّ ما يلزم مقروءٌ ولم يُقيَّد (أُرشف قبل القيد) — فالخطوةُ «عاين وقيّد» لا «أكمِل» */
            : { tone: "warn" as const, icon: TriangleAlert, text: "لم تُقيَّد له فاتورة — وكلُّ ما يلزم مقروء: عاينه وقيّده أدناه" };

  /* ── الشروطُ الأربعة كما حكمت `autoArchive` ── */
  const gaps = new Set<AutoArchiveGap>(p.verdict.gaps);
  const conditions: { ok: boolean; title: string; gap: AutoArchiveGap }[] = [
    { gap: gaps.has("NOT_INVOICE") ? "NOT_INVOICE" : "NOT_RECORDED", ok: !gaps.has("NOT_INVOICE") && !gaps.has("NOT_RECORDED"), title: "فاتورةٌ مقيَّدة: رقمٌ وتاريخٌ وإجماليّ" },
    { gap: "SUPPLIER_UNKNOWN", ok: !gaps.has("SUPPLIER_UNKNOWN"), title: "مورّدٌ معروفٌ عندنا" },
    { gap: "ARITHMETIC", ok: !gaps.has("ARITHMETIC"), title: "حسابٌ مستقيم: الصافي + الضريبة = الإجماليّ" },
    { gap: "UNVERIFIED_IMAGE", ok: !gaps.has("UNVERIFIED_IMAGE"), title: "قراءةٌ موثوقة: نصٌّ مكتوب، أو صورةٌ لها شاهد" },
  ];

  const lastReason = p.history
    .map((h) => (h.after && typeof h.after === "object" && "السبب" in h.after ? String((h.after as Record<string, unknown>)["السبب"]) : null))
    .find(Boolean);

  const historyItems: TimelineItem[] = [
    ...p.history.map((h) => ({
      id: h.id,
      title: actionLabel(h.action),
      meta: formatDay(h.at),
      body: (
        <>
          <bdi>{h.actor ?? "النظام"}</bdi>
          {h.after && typeof h.after === "object" && "السبب" in h.after
            ? <> — {String((h.after as Record<string, unknown>)["السبب"])}</>
            : null}
        </>
      ),
    })),
    { id: "arrived", title: "وصل", meta: formatDay(p.uploadedAt), icon: FileText, body: p.uploadedBy ? <>رفعه <bdi>{p.uploadedBy}</bdi></> : "من مزامنة الدرايف" },
  ];

  const confidence = p.confidence ? Object.entries(p.confidence).sort(([, a], [, b]) => a - b) : [];
  const supplierText = [p.reading?.supplierName, p.fileName].filter(Boolean).join(" ");

  return (
    <DetailFrame
      mode={mode}
      fullHref={fullHref}
      user={user}
      width="page"
      title={p.fileName.replace(/\.(pdf|jpe?g|png|webp|heic)$/i, "")}
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          <FileText className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {DOCUMENT_KIND_LABEL[p.kind] ?? p.kind}
          <Badge tone={status.tone} dot>{status.text}</Badge>
          {p.periodMonth && <span>· {formatMonth(p.periodMonth)}</span>}
        </span>
      }
      actions={
        <>
          {p.driveFileId && (
            <a href={`https://drive.google.com/file/d/${p.driveFileId}/view`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              افتح الورقة
            </a>
          )}
          {p.invoice && showAmounts && (
            <LinkButton href={invoiceHref(p.invoice.id)} size="sm" icon={Receipt}>فاتورتُه</LinkButton>
          )}
          {p.supplier && <LinkButton href={`/suppliers/${p.supplier.slug}`} size="sm">ملفّ المورّد</LinkButton>}
        </>
      }
    >
      {/* ── الحال ── */}
      <section aria-label="حالُه" className="rounded-2xl border border-line bg-raised p-5 shadow-raised">
        <p className={`flex items-center gap-2 text-base font-bold ${headline.tone === "ok" ? "text-ok" : headline.tone === "danger" ? "text-danger" : headline.tone === "warn" ? "text-warn" : "text-ink-soft"}`}>
          <headline.icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
          {headline.text}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs @xl:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted">المورّد</dt>
            <dd className="mt-1 font-bold">
              {p.supplier ? (
                <span className="inline-flex items-center gap-1.5"><Monogram name={p.supplier.nameAr} className="h-5 w-5 text-[10px]" />{p.supplier.nameAr}</span>
              ) : <span className="text-danger">غير معروف</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">الإجماليّ</dt>
            <dd className="mt-1 font-bold">
              {p.invoice && showAmounts ? <Money minor={p.invoice.totalMinor} /> : p.reading?.total ? <bdi className="nums">{p.reading.total}</bdi> : <span className="text-muted">غير معروف</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">رقمُ الفاتورة</dt>
            <dd className="mt-1 font-bold"><bdi className="nums">{p.invoice?.number || p.reading?.invoiceNumber || "—"}</bdi></dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">وصل</dt>
            <dd className="mt-1 font-bold">{formatDay(p.uploadedAt)}</dd>
          </div>
        </dl>

        {p.twin && showAmounts && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            {isInvoiceKind ? "برقمها المقروء نفسه ولمورّدها نفسه — قارِن ثمّ ارفض هذه النسخة." : "الفاتورةُ التي تلته برقمه نفسه:"}
            <LinkButton href={invoiceHref(p.twin.id)} size="sm" icon={Receipt}>افتح الفاتورة المقيَّدة</LinkButton>
          </p>
        )}

        {p.missing.length > 0 && !p.twin && (
          <ul className="mt-4 space-y-1.5" aria-label="ما ينقصه">
            {p.missing.map((m) => (
              <li key={m} className="flex items-start gap-2 rounded-lg bg-danger-bg px-3 py-2 text-xs text-ink-soft">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={2.25} aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        )}

        {/* اسمُه في الدرايف — ما تقوله شاشةُ التسمية عنه، بجملتها */}
        {p.name && p.name.status !== "OK" && (
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
            <PenLine className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden />
            {p.name.status === "RENAME" ? (
              <>اسمُه خارج الصيغة، ويُسمّى <bdi dir="ltr" className="font-bold text-ink">{p.name.proposed}</bdi> في المزامنة القادمة.</>
            ) : byDesign ? (
              <>لا يُسمّى بالصيغة القياسيّة: {p.name.reason}. وهذا مقصود — لا شيء عليك فيه.</>
            ) : (
              <>لا يُبنى له اسمٌ قياسيّ: {p.name.reason}. يُسمّى وحده حين تُقيَّد فاتورتُه أدناه.</>
            )}
          </p>
        )}

        {/* الأفعال على المستند نفسه */}
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-line-soft pt-4">
            {waiting && showAmounts && (p.invoice || p.statementId) && <ConfirmDocument documentId={p.id} variant="primary" />}
            {p.status === "REJECTED" ? (
              <RestoreDocument documentId={p.id} />
            ) : (
              !p.invoice && <RejectDocument documentId={p.id} />
            )}
            {p.driveFileId && (p.invoice || waiting) && <DocumentReread documentId={p.id} canEdit={canEdit} />}
          </div>
        )}
      </section>

      {/* ── أكمِل الناقص وقيّدها ── */}
      {recordable && !p.twin && canEdit && showAmounts && (
        <Section id="fix" icon={Wrench} title={byDesign ? "هو فاتورةٌ في الحقيقة؟ قيّدها" : p.missing.length > 0 ? "أكمِل الناقص وقيّدها" : "عاينها وقيّدها"} className="mt-8 scroll-mt-24">
          {byDesign && (
            <Callout tone="info" className="mb-3" title={`قرأه النموذجُ «${DOCUMENT_KIND_LABEL[p.kind] ?? p.kind}»`}>
              وما كان كذلك لا يُقيَّد ولا يدخل المستحقّ — وهذا صحيح إن كان عرضاً فعلاً. فإن كانت الورقةُ فاتورةً
              أخطأ النموذجُ نوعَها، فأكملها هنا وتُقيَّد فاتورةً. وإن كان خطأً كلُّه فارفضه أعلاه.
            </Callout>
          )}
          <div className="rounded-2xl border border-accent-line bg-raised p-4 shadow-raised sm:p-5">
            <DocumentRecord
              documentId={p.id}
              initial={{ ...p.proposal, supplierId: p.proposal.supplierId }}
              suppliers={supplierOptions}
              missing={p.missing}
              fromName={p.proposal.fromName}
              canCreateSupplier={can(user.role, "supplier:edit")}
              supplierText={supplierText}
            />
          </div>
        </Section>
      )}

      {/* ── كيف قرّر النظام ── */}
      <Section id="why" icon={Brain} title="كيف قرّر النظام" className="mt-8 scroll-mt-24"
        hint="ما قرأه النموذجُ اقتراح، والحكمُ لشروطٍ مكتوبة في الشيفرة — لا لرأي النموذج.">
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
            <p className="flex items-center gap-2 text-xs font-bold">
              <ScanText className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
              {p.textSource === "TEXT"
                ? "قُرئ من النصّ المكتوب في الملفّ — نقلاً لا ظنّاً"
                : p.textSource === "VISION"
                  ? "قُرئ من صورة الملفّ بالنظر — ظنٌّ يحتاج شاهداً"
                  : p.reading ? "لم يُسجَّل مصدرُ القراءة" : "لم يُقرأ بالذكاء — عُرف من اسمه أو رُحّل"}
              {p.model && <span className="ms-auto font-normal text-muted" dir="ltr">{p.model}</span>}
            </p>
            {p.reading && (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] @xl:grid-cols-3">
                <Read label="النوع" value={p.reading.kind ? DOCUMENT_KIND_LABEL[p.reading.kind] ?? p.reading.kind : null} />
                <Read label="المورّد" value={p.reading.supplierName} />
                <Read label="رقمُ البائع الضريبيّ" value={p.reading.sellerVat} ltr />
                <Read label="رقمُ الفاتورة" value={p.reading.invoiceNumber} ltr />
                <Read label="التاريخ" value={p.reading.invoiceDate} ltr />
                <Read label="الإجماليّ" value={showAmounts ? p.reading.total : null} ltr />
                <Read label="الضريبة" value={showAmounts ? p.reading.vat : null} ltr />
                <Read label="البنود" value={p.reading.lineCount > 0 ? `${p.reading.lineCount}` : null} ltr />
              </dl>
            )}
          </div>

          {isInvoiceKind && (
            <div className="rounded-xl border border-line bg-raised shadow-raised">
              <p className="flex items-center gap-2 border-b border-line-soft px-4 py-3 text-xs font-bold">
                <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
                {p.verdict.auto ? "اجتمعت فيه شروطُ الدخول وحده الأربعة" : "لم يدخل وحده — لم يجتمع فيه كلُّ شرط"}
              </p>
              <ul className="divide-y divide-line-soft">
                {conditions.map((c) => (
                  <li key={c.title} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
                    {c.ok
                      ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-label="تحقّق" />
                      : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-label="لم يتحقّق" />}
                    <span className="min-w-0">
                      <span className={c.ok ? "" : "font-bold"}>{c.title}</span>
                      {!c.ok && <span className="mt-0.5 block text-[11px] text-muted">{GAP_TEXT[c.gap]}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lastReason && (
            <p className="rounded-lg bg-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
              <b>آخرُ ما وقع عليه:</b> {lastReason}
            </p>
          )}

          {confidence.length > 0 && (
            <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
              <p className="mb-2.5 text-[11px] font-bold text-muted">ثقةُ النموذج في كلّ حقل</p>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2.5 @xl:grid-cols-2">
                {confidence.map(([k, v]) => {
                  const low = v < LOW_CONFIDENCE;
                  return (
                    <li key={k}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span>{FIELD_LABEL[k] ?? k}</span>
                        <span className={`text-[11px] font-bold ${low ? "text-warn" : "text-ok"}`}>{low ? "ضعيفة" : "جيّدة"}</span>
                      </div>
                      <Meter value={Math.round(v * 100)} max={100} tone={low ? "warn" : "ok"} label={`ثقة ${FIELD_LABEL[k] ?? k}`} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section icon={History} title="ما وقع عليه" className="mt-8">
        <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
          <Timeline items={historyItems} />
        </div>
      </Section>

      <p className="mt-6 text-[11px] text-muted">
        <Link href="/documents" className="font-bold text-accent hover:underline">كلّ المستندات</Link>
        {" · "}الملفّ في الدرايف لا يُحذف ولا يُنقل من هنا — الرفضُ يُخرجه من الحساب وحده.
      </p>
    </DetailFrame>
  );
}

function Read({ label, value, ltr = false }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-bold">
        {value ? <bdi dir={ltr ? "ltr" : undefined} className={ltr ? "nums" : ""}>{value}</bdi> : <span className="font-normal text-muted">لم يُقرأ</span>}
      </dd>
    </div>
  );
}
