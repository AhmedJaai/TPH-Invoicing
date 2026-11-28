import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Brain, CircleAlert, CircleCheck, CircleX, FileText, FileWarning, History, PenLine, Receipt,
  ScanText, Sparkles, TriangleAlert, Wrench,
} from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DetailFrame, type DetailMode } from "@/components/detail-frame";
import { Money } from "@/components/money";
import { Badge, Callout, EmptyState, LinkButton, Monogram, NoAccess, Section, Timeline, type TimelineItem } from "@/components/ui";
import { DocumentRecord } from "@/components/document-record";
import { DocumentReread } from "@/components/document-reread";
import { DocumentPaper } from "@/components/document-paper";
import { RejectDocument } from "@/components/reject-document";
import { RestoreDocument } from "@/components/restore-document";
import { ConfirmDocument } from "@/components/confirm-document";
import { ReplaceInvoice } from "@/components/replace-invoice";
import { formatRiyalsDisplay } from "@/lib/money";
import { loadDocumentProfile } from "@/services/document-profile.service";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_BADGE, documentHref } from "@/lib/document-labels";
import { GAP_TEXT, type AutoArchiveGap } from "@/lib/extraction/auto-archive";
import { ExtractionEvidencePanel } from "@/components/extraction-evidence";
import { invoiceHref } from "@/lib/invoice-profile";
import { readback, readbackSummary, type ReadbackRow } from "@/lib/document-readback";
import { loadWaitingQueue } from "@/services/document-queue.service";
import { DocumentQueueNav } from "@/components/document-queue-nav";
import { actionLabel } from "@/lib/audit-labels";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { T } from "@/components/i18n/t";

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
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="مستند غير موجود">
        <EmptyState
          icon={FileWarning}
          title="هذا المستند لم يعد موجوداً في النظام."
          hint="ربما دُمج مع نسخته المكررة، وستجد ذلك في سجل التدقيق. أما ملفه في الدرايف فلم يُمسّ."
          action={<LinkButton href="/documents" variant="primary">كل المستندات</LinkButton>}
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

  const [supplierOptions, queue] = await Promise.all([
    recordable && canEdit && showAmounts
      ? db.select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug, folder: suppliers.driveFolderName })
          .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.nameAr))
      : Promise.resolve([]),
    loadWaitingQueue(id),
  ]);
  /* التالي بعد الحسم: التالي في الطابور، وإلّا صندوقُ الوارد — لا بقاءَ على ما حُسم */
  const nextHref = queue.nextId ? documentHref(queue.nextId) : "/documents";
  /*
    شريطُ الطابور لما ينتظر، ولما حُسم للتوّ (آخرُ إجراءٍ قبل دقائق) — كي يمضي من
    اعتمد إلى التالي. أمّا مؤرشفٌ قديم فلا يُقال عنه «خرج من الطابور».
  */
  const justDecided = p.history[0] ? Date.now() - new Date(p.history[0].at).getTime() < 15 * 60_000 : false;
  const showQueue = waiting || (justDecided && queue.total > 0);

  const rb = readback({
    reading: p.reading,
    recorded: { kind: p.kind, supplierName: p.supplier?.nameAr ?? null, invoice: p.invoice },
    confidence: p.confidence,
    kindLabel: (k) => DOCUMENT_KIND_LABEL[k] ?? k,
    showAmounts,
  });
  const rbSum = readbackSummary(rb);

  /* ── الجوابُ في سطر: ما حالُه وما يمنعه ── */
  /* الرقمُ نفسه بأيّ صيغة نسخةٌ يقيناً؛ واليومُ والمبلغ نفسهما شبهٌ يُقارَن ولا يُحسَم */
  const sureTwin = p.twin?.how === "same-number" ? p.twin : null;
  /* الرقمُ نفسُه والمبلغُ غيرُه: أعاد المورّدُ إصدارَها (خصمٌ أو تصحيح) — لا نسخة */
  const corrected = sureTwin && isInvoiceKind && sureTwin.totalMinor !== null && sureTwin.readTotalMinor !== null
    && sureTwin.totalMinor !== sureTwin.readTotalMinor && p.status !== "REJECTED" && !p.invoice ? sureTwin : null;
  const likeTwin = p.twin?.how === "same-day-and-total" && isInvoiceKind ? p.twin : null;
  const headline = p.invoice
    ? { tone: "ok" as const, icon: CircleCheck, text: "سُجّلت له فاتورة" }
    : p.statementId
      ? { tone: "ok" as const, icon: CircleCheck, text: "سُجّل كشف حساب" }
      : p.status === "REJECTED"
        ? { tone: "danger" as const, icon: CircleX, text: "مرفوض، ولا يدخل في الحساب" }
        : corrected
          ? { tone: "warn" as const, icon: TriangleAlert, text: `نسخة مصحّحة من الفاتورة ${corrected.number}: مبلغها ${formatRiyalsDisplay(corrected.readTotalMinor!)} والمسجّلة ${formatRiyalsDisplay(corrected.totalMinor!)}. استبدل بها الفاتورة المسجّلة، أو ارفضها إن كانت خطأ` }
        : sureTwin && isInvoiceKind
          ? { tone: "warn" as const, icon: TriangleAlert, text: `نسخة مكررة من الفاتورة المسجّلة ${sureTwin.number}. ارفضها ولا تسجّلها مرة ثانية` }
        : sureTwin
          /* عرضُ السعر برقم فاتورةٍ قُيِّدت: هو عرضُ الطلب نفسه، لا نسخة — لا شيء عليك */
          ? { tone: "ok" as const, icon: CircleCheck, text: `${DOCUMENT_KIND_LABEL[p.kind] ?? p.kind}: سُجّلت فاتورته برقم ${sureTwin.number}، ولا يلزمك أي إجراء` }
        : likeTwin
          ? { tone: "warn" as const, icon: TriangleAlert, text: `يشبه الفاتورة المسجّلة ${likeTwin.number} (اليوم والمبلغ نفسهما). قارن بينهما: إن كان نسخة منها فارفضه، وإلا فسجّله` }
        : byDesign
          ? { tone: "muted" as const, icon: FileText, text: `${DOCUMENT_KIND_LABEL[p.kind] ?? p.kind}: لا يُسجَّل فاتورة` }
          : p.missing.length > 0
            ? { tone: "danger" as const, icon: CircleAlert, text: "لم تُسجَّل له فاتورة، وتنقصه بيانات لازمة للتسجيل" }
            /* كلُّ ما يلزم مقروءٌ ولم يُقيَّد (أُرشف قبل القيد) — فالخطوةُ «عاين وقيّد» لا «أكمِل» */
            : { tone: "warn" as const, icon: TriangleAlert, text: "لم تُسجَّل له فاتورة، وكل البيانات اللازمة مقروءة. راجعه وسجّله أدناه" };

  /* ── الشروطُ الأربعة كما حكمت `autoArchive` ── */
  const gaps = new Set<AutoArchiveGap>(p.verdict.gaps);
  const conditions: { ok: boolean; title: string; gap: AutoArchiveGap }[] = [
    { gap: gaps.has("NOT_INVOICE") ? "NOT_INVOICE" : "NOT_RECORDED", ok: !gaps.has("NOT_INVOICE") && !gaps.has("NOT_RECORDED"), title: "فاتورة مسجّلة برقم وتاريخ وإجمالي" },
    { gap: "SUPPLIER_UNKNOWN", ok: !gaps.has("SUPPLIER_UNKNOWN"), title: "مورّد معروف لدينا" },
    { gap: "ARITHMETIC", ok: !gaps.has("ARITHMETIC"), title: "الحساب صحيح: الصافي + الضريبة = الإجمالي" },
    { gap: "UNVERIFIED_IMAGE", ok: !gaps.has("UNVERIFIED_IMAGE"), title: "قراءة موثوقة: نص مكتوب في الملف، أو صورة يدعمها دليل" },
    /* لا يظهران إلّا إن منعا: رمزٌ يخالف المقيَّد، أو مبلغٌ تبدّل عند إعادة السؤال */
    ...(gaps.has("QR_MISMATCH") ? [{ gap: "QR_MISMATCH" as const, ok: false, title: "رمز الفاتورة (QR) يطابق المسجّل" }] : []),
    ...(gaps.has("REASK_CHANGED") ? [{ gap: "REASK_CHANGED" as const, ok: false, title: "المبلغ نفسه عند إعادة القراءة" }] : []),
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
    {
      id: "arrived", title: "وصل المستند", meta: formatDay(p.uploadedAt), icon: FileText,
      /*
        ما جاءت به المزامنةُ لا يُنسب إلى من فتح المتصفّح وقتَها: يُقال من وضعه في الدرايف
        ومتى، إن عُرف. وما سبق عمودَ المصدر يبقى على ما كان يُقال.
      */
      body: p.source === "DRIVE_SYNC"
        ? <><T s="من مزامنة الدرايف{0}{1}" a={[p.driveModifiedBy ? <Fragment key="0"><T s="، وآخر من عدّله هناك {0}" a={[<bdi key="0">{p.driveModifiedBy}</bdi>]} /></Fragment> : null, p.driveCreatedAt ? <Fragment key="1"> <T s=" · أُضيف إلى الدرايف في {0}" a={[formatDay(p.driveCreatedAt)]} /></Fragment> : null]} /></>
        : p.uploadedBy ? <><T s="رفعه {0}" a={[<bdi key="0">{p.uploadedBy}</bdi>]} /></> : "من مزامنة الدرايف",
    },
  ];

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
          {p.invoice && showAmounts && (
            <LinkButton href={invoiceHref(p.invoice.id)} size="sm" icon={Receipt}>فاتورته</LinkButton>
          )}
          {p.supplier && <LinkButton href={`/suppliers/${p.supplier.slug}`} size="sm">صفحة المورّد</LinkButton>}
        </>
      }
    >
      {showQueue && canEdit && (
        <DocumentQueueNav position={queue.position} total={queue.total} prevId={queue.prevId} nextId={queue.nextId} />
      )}

      {/* ── الحال ── */}
      <section aria-label="الحالة" className="rounded-2xl border border-line bg-raised p-5 shadow-raised">
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
            <dt className="text-[11px] text-muted">الإجمالي</dt>
            <dd className="mt-1 font-bold">
              {p.invoice && showAmounts ? <Money minor={p.invoice.totalMinor} /> : p.reading?.total ? <bdi className="nums">{p.reading.total}</bdi> : <span className="text-muted">غير معروف</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">رقم الفاتورة</dt>
            <dd className="mt-1 font-bold"><bdi className="nums">{p.invoice?.number || p.reading?.invoiceNumber || "—"}</bdi></dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">تاريخ الوصول</dt>
            <dd className="mt-1 font-bold">{formatDay(p.uploadedAt)}</dd>
          </div>
        </dl>

        {p.lastReadError && !p.reading && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-xs text-ink-soft">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2.25} aria-hidden />
            <span><b>لم يُقرأ:</b> {p.lastReadError}</span>
          </p>
        )}
        {p.status === "REJECTED" && p.statusNote && (
          <p className="mt-4 text-xs text-ink-soft"><b>سبب الرفض:</b> {p.statusNote}</p>
        )}
        {p.originalFileName && (
          <p className="mt-3 text-[11px] text-muted"><T s="وصل باسم الملف {0}" a={[<bdi key="0" dir="ltr">{p.originalFileName}</bdi>]} /></p>
        )}

        {p.twin && (sureTwin || likeTwin) && showAmounts && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            {likeTwin ? "فاتورة من المورّد نفسه، في اليوم نفسه وبالمبلغ نفسه، لكن برقم مختلف:" : corrected ? "فاتورة بالرقم نفسه ومن المورّد نفسه لكن بمبلغ مختلف. هل أعاد المورّد إصدارها؟" : isInvoiceKind ? "فاتورة بالرقم نفسه ومن المورّد نفسه. قارن بينهما ثم ارفض هذه النسخة." : "الفاتورة التي تحمل الرقم نفسه:"}
            <LinkButton href={invoiceHref(p.twin.id)} size="sm" icon={Receipt}>افتح الفاتورة المسجّلة</LinkButton>
          </p>
        )}

        {p.missing.length > 0 && !sureTwin && (
          <ul className="mt-4 space-y-1.5" aria-label="الناقص">
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
              <><T s="اسمه ليس بالصيغة القياسية، وستُعاد تسميته إلى {0} في المزامنة القادمة." a={[<bdi key="0" dir="ltr" className="font-bold text-ink">{p.name.proposed}</bdi>]} /></>
            ) : byDesign ? (
              <><T s="لا يُسمّى بالصيغة القياسية: {0}. وهذا مقصود، ولا يلزمك أي إجراء." a={[p.name.reason]} /></>
            ) : (
              <><T s="تعذّر تكوين اسم قياسي له: {0}. ستُعاد تسميته تلقائياً عند تسجيل فاتورته أدناه." a={[p.name.reason]} /></>
            )}
          </p>
        )}

        {/* الأفعال على المستند نفسه */}
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-line-soft pt-4">
            {waiting && showAmounts && (p.invoice || p.statementId) && <ConfirmDocument documentId={p.id} variant="primary" nextHref={showQueue ? nextHref : null} />}
            {corrected && showAmounts && (
              <ReplaceInvoice documentId={p.id} number={corrected.number} before={formatRiyalsDisplay(corrected.totalMinor!)} after={formatRiyalsDisplay(corrected.readTotalMinor!)} />
            )}
            {p.status === "REJECTED" ? (
              p.sameFile ? (
                /* نسخةٌ مكرّرة من ملفٍّ قائم: لا إعادة — يُفتح القائم */
                <span className="inline-flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <T s="نسخةٌ مكرّرة من ملفٍّ قائم، فلا تُعاد إلى المراجعة." />
                  <LinkButton href={`/documents/file/${p.sameFile.id}`} size="sm" icon={FileText}>افتح الملفّ القائم</LinkButton>
                </span>
              ) : (
                <RestoreDocument documentId={p.id} />
              )
            ) : (
              !p.invoice && <RejectDocument documentId={p.id} redirectTo={waiting ? nextHref : undefined} />
            )}
            {/* وما أُرشف بلا قيدٍ يُقرأ من جديد كذلك — زاكوباك 3068 لم يكن له طريقٌ إلى القراءة */}
            {p.driveFileId && (p.invoice || waiting || recordable) && <DocumentReread documentId={p.id} canEdit={canEdit} />}
          </div>
        )}
      </section>

      {/*
        ── الورقةُ بجانب ما قُرئ منها ──
        المراجعةُ مقارنة: الورقةُ في عمودٍ ثابت، وما قرأه النموذج وما سُجّل — ونموذجُ
        الإكمال إن لزم — في الآخر. كانت الورقةُ فوق والنموذجُ تحتها بشاشتين، فيُقارَن
        الرقمُ بالذاكرة. وعلى الضيّق تبقى الورقةُ أوّلاً والحقولُ تحتها.
      */}
      <div className={`mt-8 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-8 ${p.driveFileId ? "@4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" : ""}`}>
        {p.driveFileId && (
          <Section id="paper" icon={FileText} title="الورقة" className="scroll-mt-24">
            <div className="@4xl:sticky @4xl:top-24">
              <DocumentPaper documentId={p.id} driveFileId={p.driveFileId} fileName={p.fileName} defaultOpen />
            </div>
          </Section>
        )}

        <div className="min-w-0 space-y-8">
          {/* ── أكمِل الناقص وقيّدها ── */}
          {recordable && !sureTwin && canEdit && showAmounts && (
            <Section id="fix" icon={Wrench} title={byDesign ? "هل هو فاتورة فعلاً؟ سجّلها" : p.missing.length > 0 ? "أكمل البيانات الناقصة وسجّلها" : "راجعها وسجّلها"} className="scroll-mt-24">
              {byDesign && (
                <Callout tone="info" className="mb-3" title={`صنّفه النموذج «${DOCUMENT_KIND_LABEL[p.kind] ?? p.kind}»`}>
                  هذا النوع لا يُسجَّل فاتورة ولا يدخل في المبالغ المستحقة، وهذا صحيح إن كان عرض سعر فعلاً. أما إن كان فاتورة أخطأ النموذج في تصنيفها فأكمل بياناتها هنا لتُسجَّل فاتورة، وإن كان خطأً كله فارفضه من الأعلى.
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

          {/* ── ما قُرئ وما سُجّل، حقلاً حقلاً ── */}
          <Section
            id="read"
            icon={ScanText}
            title="ما قرأه النموذج وما سُجّل"
            className="scroll-mt-24"
            hint={p.textSource === "TEXT"
              ? "مأخوذ حرفياً من النص المكتوب في الملف، لا تخميناً."
              : p.textSource === "VISION"
                ? "مقروء بالنظر من صورة الملف، وهو تقدير يحتاج إلى ما يؤكده."
                : p.reading ? "مصدر القراءة غير مسجّل." : "لم يُقرأ بالذكاء الاصطناعي، بل عُرف من اسم الملف أو نُقل من قراءة سابقة."}
          >
            {p.reading ? (
              <ReadbackTable rows={rb} summary={rbSum} model={p.model} hasInvoice={Boolean(p.invoice)} />
            ) : (
              <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا توجد قراءة محفوظة لهذا المستند.</p>
            )}
          </Section>
        </div>
      </div>

      {/* ── كيف قرّر النظام ── */}
      <Section id="why" icon={Brain} title="كيف قرّر النظام" className="mt-8 scroll-mt-24"
        hint="ما قرأه النموذج اقتراح فقط، والقرار مبني على شروط ثابتة في النظام لا على رأي النموذج.">
        <div className="space-y-4">
          {isInvoiceKind && (
            <div className="rounded-xl border border-line bg-raised shadow-raised">
              <p className="flex items-center gap-2 border-b border-line-soft px-4 py-3 text-xs font-bold">
                <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
                {p.verdict.auto ? "اجتمعت فيه شروط الدخول التلقائي" : "لم يدخل تلقائياً لأن بعض الشروط لم تجتمع، والقرار لك"}
              </p>
              <ul className="divide-y divide-line-soft">
                {conditions.map((c) => (
                  <li key={c.title} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
                    {c.ok
                      ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-label="متحقق" />
                      : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-label="غير متحقق" />}
                    <span className="min-w-0">
                      <span className={c.ok ? "" : "font-bold"}>{c.title}</span>
                      {!c.ok && <span className="mt-0.5 block text-[11px] text-muted">{GAP_TEXT[c.gap]}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ExtractionEvidencePanel evidence={p.evidence} showAmounts={showAmounts} />

          {lastReason && (
            <p className="rounded-lg bg-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
              <b>آخر إجراء:</b> {lastReason}
            </p>
          )}

        </div>
      </Section>

      <Section icon={History} title="سجل الإجراءات" className="mt-8">
        <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
          <Timeline items={historyItems} />
        </div>
      </Section>

      <p className="mt-6 text-[11px] text-muted">
        <T s="{0} · لا يُحذف الملف من الدرايف ولا يُنقل، والرفض يُخرج المستند من الحسابات فقط." a={[<Link key="0" href="/documents" className="font-bold text-accent hover:underline">كل المستندات</Link>]} /></p>
    </DetailFrame>
  );
}

const MATCH_TEXT: Record<ReadbackRow["match"], string> = {
  same: "كما قُرئ",
  changed: "سُجّل غيرُه",
  unrecorded: "—",
  unread: "لم يُقرأ وسُجّل",
};

const plainText = (f: ReadbackRow["field"]) => f === "supplier" || f === "kind";

/** «حقل واحد» · «حقلين» · «٣ حقول» — بعددٍ لاتينيّ كسائر الأعداد. */
function fieldsText(n: number) {
  return n === 1 ? "حقل واحد" : n === 2 ? "حقلين" : <T s="{0} حقول" a={[<span key="0" className="nums">{n}</span>]} />;
}

/**
 * جدولُ المقارنة: لكلّ حقلٍ ما قرأه النموذج، وثقتُه بنفسه، وما سجّله الخادم.
 * الثقةُ رقمُ النموذج كما قاله — كلمةٌ ورمزٌ لا لونٌ وحده، والمجهولةُ «لم يقلها».
 * وعلى الجوّال يصير كلُّ صفٍّ بطاقةً صغيرة (الحقلُ فوق، والقيمُ تحته).
 */
function ReadbackTable({ rows, summary, model, hasInvoice }: {
  rows: ReadbackRow[];
  summary: { low: number; changed: number; unknownTrust: boolean };
  model: string | null;
  hasInvoice: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 text-xs">
        {summary.low > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-bold text-warn">
            <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            <T s="ثقة النموذج ضعيفة في {0}، فقارنها بالورقة" a={[<Fragment key="0">{fieldsText(summary.low)}</Fragment>]} />
          </span>
        ) : summary.unknownTrust ? (
          <span className="font-bold text-ink-soft">لم يقل النموذج مدى ثقته في هذه القراءة</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-bold text-ok">
            <CircleCheck className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            قرأ النموذج كل الحقول بثقة جيدة
          </span>
        )}
        {hasInvoice && summary.changed > 0 && (
          <span className="inline-flex items-center gap-1.5 font-bold text-info">
            <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            <T s="سُجّل غير المقروء في {0}" a={[<Fragment key="0">{fieldsText(summary.changed)}</Fragment>]} />
          </span>
        )}
        {model && <span className="ms-auto text-[11px] text-muted" dir="ltr">{model}</span>}
      </p>
      <table className="w-full text-xs">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-line-soft text-[11px] text-muted">
            <th scope="col" className="px-4 py-2 text-start font-bold">الحقل</th>
            <th scope="col" className="px-2 py-2 text-start font-bold">قرأه النموذج</th>
            <th scope="col" className="px-2 py-2 text-start font-bold">ثقته</th>
            <th scope="col" className="px-4 py-2 text-start font-bold">المسجَّل</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((r) => (
            <tr key={r.field} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-2.5 sm:table-row sm:p-0 ${r.trust === "low" ? "bg-warn-bg" : ""}`}>
              <th scope="row" className="col-span-2 text-start text-[11px] font-normal text-muted sm:px-4 sm:py-2.5 sm:text-xs">{r.label}</th>
              <td className="min-w-0 break-words font-bold sm:px-2 sm:py-2.5">
                {r.read
                  ? <bdi dir={plainText(r.field) ? undefined : "ltr"} className={plainText(r.field) ? "" : "nums"}>{r.read}</bdi>
                  : <span className="font-normal text-muted">لم يُقرأ</span>}
              </td>
              <td className="sm:px-2 sm:py-2.5">
                {r.trust === "unknown" ? (
                  <span className="text-[11px] text-muted">لم يقلها</span>
                ) : (
                  <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold ${r.trust === "low" ? "text-warn" : "text-ok"}`}>
                    {r.trust === "low"
                      ? <TriangleAlert className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
                      : <CircleCheck className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />}
                    {r.trust === "low" ? "ضعيفة" : "جيدة"}
                    <span className="nums nums-count font-normal text-ink-soft">{Math.round((r.confidence ?? 0) * 100)}%</span>
                  </span>
                )}
              </td>
              <td className="col-span-2 min-w-0 break-words sm:px-4 sm:py-2.5">
                {r.recorded === null ? (
                  <span className="text-[11px] text-muted">{hasInvoice || r.field === "lines" || r.field === "sellerVat" ? "—" : "لم يُسجَّل بعد"}</span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[11px] text-muted sm:hidden">المسجَّل:</span>
                    <bdi dir={plainText(r.field) ? undefined : "ltr"} className={`font-bold ${plainText(r.field) ? "" : "nums"}`}>{r.recorded}</bdi>
                    <span className={`inline-flex items-center gap-0.5 text-[11px] ${r.match === "changed" ? "font-bold text-info" : "text-muted"}`}>
                      {r.match === "changed" && <PenLine className="h-3 w-3" strokeWidth={2} aria-hidden />}
                      {MATCH_TEXT[r.match]}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line-soft px-4 py-2 text-[11px] leading-relaxed text-muted">
        الثقة رقم يقوله النموذج عن نفسه، لا حكم النظام. والمسجَّل يحسبه الخادم ويتحقق منه عند الحفظ، فما سُجّل غير ما قُرئ صحّحه إنسان أو أعاد الخادم حسابه.
      </p>
    </div>
  );
}
