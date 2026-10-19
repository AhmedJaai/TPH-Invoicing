import { asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { CreditNoteForm } from "@/components/credit-note-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Ban, CircleAlert, CircleCheck, Copy, ExternalLink, FileText, History, Landmark, ListOrdered,
  Receipt, ScanText, ShieldCheck, TrendingUp, TriangleAlert, Wallet,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DetailFrame, type DetailMode } from "@/components/detail-frame";
import { Money } from "@/components/money";
import { LiveMoney } from "@/components/live-money";
import {
  Badge, DataTable, EmptyState, LinkButton, Meter, Monogram, NoAccess, Section, Timeline, buttonClass,
  type TimelineItem, type Tone,
} from "@/components/ui";
import { MarkInvoicePaid } from "@/components/mark-invoice-paid";
import { InvoiceFix } from "@/components/invoice-fix";
import { DocumentReread } from "@/components/document-reread";
import { RejectDocument } from "@/components/reject-document";
import { loadInvoiceProfile, neighbours } from "@/services/invoice-profile.service";
import { evaluateInvoice, missingPillars } from "@/lib/invoice-findings";
import { InvoiceRejudge } from "@/components/invoice-rejudge";
import { firstClosedMonth } from "@/services/month-guard";
import { ISSUE } from "@/lib/issue-codes";
import { FIELD_LABEL, LOW_CONFIDENCE, amountsAddUp, invoiceHref, weakFields } from "@/lib/invoice-profile";
import { TAX_LABEL } from "@/lib/invoice-filter";
import { companyConfig } from "@/config/drive";
import { formatRiyals, formatRiyalsDisplay, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { METHOD_LABEL, paymentStatusLabel } from "@/lib/payment-state";
import { actionLabel } from "@/lib/audit-labels";
import { ITEM, PAYMENT_RECORD, REASON, countNoun } from "@/lib/arabic";
import { txHref } from "@/lib/inspector";
import { monthOf } from "@/lib/filing";
import { T } from "@/components/i18n/t";


/**
 * ملفّ الفاتورة.
 *
 * كانت الفاتورة — وهي ما يدور عليه النظام كلُّه — بلا صفحة. فصار لها ملفٌّ
 * واحد يجيب بالترتيب الذي يُسأل به:
 *   كم بقي عليها، وما الخطوةُ التالية؟ ← ما الذي فيها غير سليم؟ ← ممّ
 *   تكوّنت، وأتغيّر سعرٌ فيها؟ ← من أين دُفعت؟ ← من أين جاءت، ومن قرأها
 *   وبأيّ ثقة؟ ← ما الذي وقع عليها؟
 *
 * والرقمُ الأوّل «بقي عليها» لا «الإجمالي»: السؤالُ حين تُفتَح الفاتورة
 * «أعليّ شيء؟»، والإجمالي تحته بشريطٍ يقول كم سُدّد منه.
 */
export async function InvoiceView({
  params,
  searchParams,
  mode,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ act?: string }>;
  mode: DetailMode;
}) {
  const { id } = await params;
  /* «سجّل سدادها» من لوحة الأوامر يفتح الملفَّ والسؤالُ مطروح — لا «افتح ثمّ ابحث عن الزرّ» */
  const act = (await searchParams)?.act;
  const fullHref = invoiceHref(id);
  const user = await currentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(invoiceHref(id))}`);
  if (!can(user.role, "amounts:view")) {
    return (
      <DetailFrame mode={mode} fullHref={fullHref} width="page" user={user} title="فاتورة">
        <NoAccess what="الفواتير" />
      </DetailFrame>
    );
  }

  const p = await loadInvoiceProfile(id);
  if (!p) {
    /*
      رابطٌ إلى فاتورةٍ لم تعد: أُلغيت أو أُسقط مستندُها. «لم نجد الصفحة»
      العامّة لا تقول ذلك، وصاحبُ المقهى يظنّ العطبَ في النظام.
    */
    return (
      <DetailFrame mode={mode} fullHref={fullHref} width="page" user={user} title="فاتورة غير موجودة">
        <EmptyState
          icon={Receipt}
          title="هذه الفاتورة لم تعد في النظام."
          hint="ربما أُلغيت الفاتورة أو رُفض مستندها. يبقى أثر ذلك في سجل التدقيق، ولا يُمسّ ملفها في الدرايف."
          action={
            <>
              <LinkButton href="/purchases/invoices" variant="primary">كل الفواتير</LinkButton>
              <LinkButton href="/documents?status=REJECTED">المستندات المرفوضة</LinkButton>
              {can(user.role, "audit:view") && <LinkButton href="/settings/audit">سجل التدقيق</LinkButton>}
            </>
          }
        />
      </DetailFrame>
    );
  }

  const { invoice: inv, supplier, document: doc } = p;
  const canEdit = can(user.role, "document:upload");
  const canPay = can(user.role, "payment:approve");
  /* الجارتان وقائمةُ المورّدين لا يعتمد أحدُهما على الآخر — يُطلَبان معاً */
  const [nav, supplierOptions] = await Promise.all([
    neighbours(supplier.id, inv.date, inv.id),
    canEdit
      ? db.select({ id: suppliers.id, name: suppliers.nameAr }).from(suppliers)
        .where(or(eq(suppliers.isActive, true), eq(suppliers.id, supplier.id))).orderBy(asc(suppliers.nameAr))
      : Promise.resolve([]),
  ]);

  const verdict = evaluateInvoice(
    {
      kind: doc.kind,
      invoiceNumber: inv.number,
      sellerVat: inv.sellerVat,
      buyerVat: inv.buyerVat,
      subtotalMinor: inv.subtotalMinor,
      vatMinor: inv.vatMinor,
      totalMinor: inv.totalMinor,
      discountMinor: inv.discountMinor,
      chargesMinor: inv.chargesMinor,
      lineCount: p.lines.length,
    },
    { issuesInvoices: supplier.issuesInvoices, contractOnFile: supplier.contractOnFile },
    companyConfig.vatNumber,
  );
  const reasons = verdict.reasons;
  /* الركنُ الناقص باسمه — يُقال بجانب «غير صالحة» */
  const gaps = verdict.taxStatus === "VALID" ? [] : missingPillars(reasons);
  /*
    الحالُ المحفوظة قديمة: حُسبت على قراءةٍ غيرِ ما في الصفّ اليوم. كانت الصفحةُ تقول
    «غير صالحة» وقائمةُ ما ينقص فارغة — تناقضٌ لا يُفهم. فيُقال، ويُعاد الحكمُ بضغطة.
  */
  const stale = verdict.taxStatus !== inv.taxStatus;
  const monthClosed = stale ? (await firstClosedMonth(db, [inv.month])) !== null : false;
  /* وما قاله `invoiceReasons` لا يُكرَّر بنصٍّ ثانٍ */
  const addsUp = reasons.some((r) => r.code === ISSUE.VAT_MATH_MISMATCH)
    ? null
    : amountsAddUp(inv.subtotalMinor, inv.vatMinor, inv.totalMinor, TOTAL_ROUNDING_TOLERANCE_MINOR, inv.discountMinor, inv.chargesMinor);
  const weak = weakFields(doc.fieldConfidence);
  const risen = p.lines.filter((l) => l.move?.direction === "up");
  /* ما هو للعلم (تقريبُ مورّد، بنودٌ معفاة) لا يُرفع إلى «ما يستحقّ الانتباه» */
  const problems = reasons.filter((r) => r.severity !== "INFO");
  /* الإلغاء يرفضه الخادمُ على فاتورةٍ عليها سدادٌ أو طوبقت بكشف — فلا يُعرَض زرٌّ يُرفَض */
  const cancellable = canEdit && p.allocations.length === 0 && p.statementLines.length === 0;
  const partial = !p.settled && p.paidMinor > 0;

  const taxTone: Tone = inv.taxStatus === "VALID" ? "ok" : inv.taxStatus === "INVALID" ? "danger" : "muted";
  const payBadge = p.settled
    ? { tone: "ok" as Tone, text: "مسدّدة" }
    : partial
      ? { tone: "warn" as Tone, text: "مسدّدة جزئياً" }
      : { tone: "warn" as Tone, text: "غير مسدّدة" };

  /* ── خطُّ السداد: كلُّ دفعةٍ خُصم منها شيءٌ لهذه الفاتورة ومن أين خرجت ── */
  const payItems: TimelineItem[] = p.allocations.map((a) => {
    const undone = a.status === "REVERSED" || a.status === "VOID";
    return {
      id: a.paymentId,
      icon: undone ? CircleAlert : a.method === "BANK_TRANSFER" ? Landmark : Wallet,
      tone: undone ? "danger" : a.bankTxId ? "ok" : "accent",
      title: <><T s="خُصم لها {0} · {1}" a={[<Money key="0" minor={a.amountMinor} />, METHOD_LABEL[a.method] ?? a.method]} /></>,
      meta: formatDay(a.paidAt),
      body: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {a.paymentAmountMinor !== a.amountMinor && <span><T s="من دفعة بمبلغ {0}" a={[<Money key="0" minor={a.paymentAmountMinor} />]} /></span>}
          <span className={undone ? "font-bold text-danger" : ""}>{paymentStatusLabel(a.status)}</span>
          <span aria-hidden>·</span>
          {a.bankTxId ? (
            <Link href={txHref(a.bankTxId)} className="font-bold text-accent hover:underline">افتح الحركة في البنك</Link>
          ) : a.method === "BANK_TRANSFER" ? (
            <span className="text-warn">لم تُطابَق بكشف البنك بعد</span>
          ) : (
            <span className="text-muted">لا تظهر في كشف البنك</span>
          )}
        </span>
      ),
    };
  });

  /* ── ما وقع عليها: السجلّ بترتيبه، وأوّلُه أرشفتُها ── */
  const historyItems: TimelineItem[] = [
    ...p.history.map((h) => ({
      id: h.id,
      title: actionLabel(h.action),
      meta: formatDay(h.at),
      body: <bdi>{h.actor ?? "النظام"}</bdi>,
    })),
    { id: "archived", title: "أُرشفت الفاتورة", meta: formatDay(inv.createdAt), icon: FileText, body: doc.uploadedBy ? <><T s="رفعها {0}" a={[<bdi key="0">{doc.uploadedBy}</bdi>]} /></> : undefined },
  ];

  const confidence = doc.fieldConfidence ? Object.entries(doc.fieldConfidence).sort(([, a], [, b]) => a - b) : [];

  return (
    <DetailFrame
      mode={mode}
      fullHref={fullHref}
      user={user}
      width="wide"
      title={`فاتورة ${inv.number}`}
      eyebrow={
        <Link href={`/suppliers/${supplier.slug}`} className="inline-flex items-center gap-2 font-bold text-ink-soft hover:text-accent">
          <Monogram name={supplier.nameAr} className="h-5 w-5 text-[10px]" />
          {supplier.nameAr}
        </Link>
      }
      intro={`بتاريخ ${formatDay(inv.date)} · تُحتسب في ${formatMonth(inv.month)}`}
      actions={
        <nav className="flex flex-wrap gap-2" aria-label="التنقل بين فواتير المورّد">
          {nav.newer && <LinkButton href={invoiceHref(nav.newer)} size="sm">→ الأحدث</LinkButton>}
          {nav.older && <LinkButton href={invoiceHref(nav.older)} size="sm">الأقدم ←</LinkButton>}
          <LinkButton href={`/suppliers/${supplier.slug}`} size="sm">صفحة المورّد</LinkButton>
        </nav>
      }
    >
      {/* ── الحالُ والخطوةُ التالية ── */}
      <section
        aria-label="المبلغ المتبقي"
        className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-raised shadow-raised @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
      >
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={payBadge.tone} dot>{payBadge.text}</Badge>
            <Link href="#tax" className="rounded-full">
              <Badge tone={taxTone} dot>{TAX_LABEL[inv.taxStatus as keyof typeof TAX_LABEL] ?? inv.taxStatus}</Badge>
            </Link>
            {inv.taxStatus !== "VALID" && gaps.length > 0 && (
              <span className="text-xs text-ink-soft"><T s="ينقصها: {0}" a={[<b key="0" className="text-ink">{gaps.join("، ")}</b>]} /></span>
            )}
            {inv.isFixedAsset && <Badge tone="info">أصل ثابت</Badge>}
          </div>
          <p className="mt-5 text-xs font-bold text-muted">{p.settled ? "لا شيء متبقٍ" : "المتبقي عليها"}</p>
          <p className={`mt-1.5 text-[2.2rem] font-bold leading-none tracking-tight sm:text-[2.6rem] ${p.settled ? "text-ok" : ""}`}>
            {p.settled ? (
              <span className="inline-flex items-center gap-2">
                <CircleCheck className="h-8 w-8" strokeWidth={2} aria-hidden />
                <span className="text-[1.6rem] sm:text-[1.9rem]">مسدّدة بالكامل</span>
              </span>
            ) : (
              <LiveMoney minor={p.remainingMinor} currency />
            )}
          </p>
          <div className="mt-5 max-w-md">
            {inv.totalMinor > 0 && (
              <Meter value={Math.min(p.paidMinor, inv.totalMinor)} max={inv.totalMinor} tone={p.settled ? "ok" : "accent"} label="ما سُدّد من الإجمالي" />
            )}
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span><T s="الإجمالي {0}" a={[<b key="0" className="text-ink"><Money minor={inv.totalMinor} /></b>]} /></span>
              <span>
                <T s="المسدّد {0}{1}" a={[<b key="0" className="text-ink"><Money minor={p.paidMinor} /></b>, p.allocations.length > 0 ? ` في ${countNoun(p.allocations.length, PAYMENT_RECORD)}` : " · لم يُسجَّل سداد"]} /></span>
            </p>
          </div>
        </div>

        <div className="border-t border-line bg-sunken/50 p-5 sm:p-6 @3xl:border-s @3xl:border-t-0">
          <p className="mb-3 text-xs font-bold text-muted">الخطوة التالية</p>
          {p.settled ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              <T s="لا شيء مطلوب منك. {0}" a={[p.allocations.length > 0 && <Link href="#pay" className="font-bold text-accent hover:underline">انظر كيف سُدّدت</Link>]} /></p>
          ) : canPay ? (
            <>
              <MarkInvoicePaid invoiceId={inv.id} label={formatRiyals(p.remainingMinor)} layout="panel" startOpen={act === "pay"} invoiceDay={todayInRiyadh(inv.date)} />
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                إن سُدّدت بحوالة من حساب المقهى وكشفها في الطريق، فانتظر الكشف لتُطابَق الدفعة تلقائياً.
              </p>
              <CreditNoteForm invoiceId={inv.id} today={todayInRiyadh()} />
            </>
          ) : (
            <p className="text-sm leading-relaxed text-ink-soft">
              تُطابَق الفاتورة حين تظهر حوالتها في كشف البنك. أما تسجيل السداد فلمن يملك صلاحية اعتماده.
            </p>
          )}
        </div>
      </section>

      {/*
        ── ما يستحقّ الانتباه ──

        كلُّ سطرٍ هنا مشتقٌّ لا مخزَّن، ومعه موضعُ علاجه. ولا يُعرَض القسم
        حين لا شيء: فراغُه هو الخبر.
      */}
      {(stale || doc.origin === "STATEMENT_LINE" || p.twins.length > 0 || addsUp === false || weak.length > 0 || problems.length > 0 || risen.length > 0) && (
        <ul className="mt-4 space-y-2" aria-label="تنبيهات تستحق انتباهك">
          {p.twins.map((t) => (
            <Notice key={t.id} tone="warn" icon={Copy} href={invoiceHref(t.id)} cta="قارنها">
              <T s="توجد فاتورة أخرى من {0} بالإجمالي نفسه ({1}) بتاريخ {2}، ورقمها {3}. قد يكونان طلبين مختلفين أو فاتورة مكررة، فقارن بنودهما قبل أن تسدّد الاثنتين." a={[supplier.nameAr, formatRiyalsDisplay(t.totalMinor), formatDay(t.date), <bdi key="3" className="nums">{t.number}</bdi>]} /></Notice>
          ))}
          {doc.origin === "STATEMENT_LINE" && (
            <Notice tone="warn" icon={ScanText} href="#tax" cta="اطلبها">
              <T s="سُجّلت هذه الفاتورة من كشف المورّد وليس لها ملف عندنا. تدخل في المبلغ المستحق، ولا تُخصم ضريبتها حتى يصل ملفها. اطلبها من {0}، وحين ترفعها تحل محل هذا السجل نفسه دون تكرار." a={[supplier.nameAr]} /></Notice>
          )}
          {stale && (
            <li className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn">
              <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
              <span className="min-w-0 flex-1 leading-relaxed">
                <T s="الحالة الضريبية المحفوظة «{0}» قديمة، وبيانات الفاتورة الحالية تجعلها «{1}»{2}.{3}" a={[TAX_LABEL[inv.taxStatus as keyof typeof TAX_LABEL] ?? inv.taxStatus, TAX_LABEL[verdict.taxStatus as keyof typeof TAX_LABEL] ?? verdict.taxStatus, gaps.length > 0 && <> <T s=" (ينقصها: {0})" a={[gaps.join("، ")]} /></>, monthClosed && <> <T s=" وشهر {0} مقفل، فأعد فتحه لتصحيحها، لأنها تؤثر في إقراره الضريبي." a={[formatMonth(inv.month)]} /></>]} /></span>
              {canEdit && !monthClosed && <InvoiceRejudge invoiceId={inv.id} />}
            </li>
          )}
          {addsUp === false && (
            <Notice tone="danger" icon={CircleAlert} href="#tax" cta="صحّحها">
              مجموع الصافي والضريبة يختلف عن الإجمالي بأكثر من ريال، فربما قُرئ أحد المبالغ خطأً.
            </Notice>
          )}
          {problems.length > 0 && (
            <Notice
              tone={problems.some((r) => r.severity === "BLOCKER") ? "danger" : "warn"}
              icon={problems.some((r) => r.severity === "BLOCKER") ? CircleAlert : TriangleAlert}
              href="#tax"
              cta="عالجها"
            >
              {problems[0].what}
              {problems.length > 1 && ` و${countNoun(problems.length - 1, REASON)} أخرى`}.
            </Notice>
          )}
          {weak.length > 0 && (
            <Notice tone="warn" icon={ScanText} href="#source" cta="راجع المصدر">
              <T s="قرأ النظام {0} بثقة ضعيفة، فقارنها بالورقة قبل اعتمادها." a={[weak.join(" و")]} /></Notice>
          )}
          {risen.length > 0 && (
            <Notice tone="warn" icon={TrendingUp} href="#lines" cta="انظر البنود">
              {risen.length === 1
                ? `ارتفع سعر «${risen[0].description}» ${risen[0].move?.percent ?? "?"}٪ عن آخر شراء.`
                : `ارتفعت أسعار ${countNoun(risen.length, ITEM)} عن آخر شراء.`}
            </Notice>
          )}
        </ul>
      )}

      <div className="mt-10 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] @4xl:gap-10">
        <div className="min-w-0">
          {/* ── البنود ── */}
          <Section
            id="lines"
            icon={ListOrdered}
            title="البنود"
            count={p.lines.length > 0 ? p.lines.length : undefined}
            hint={p.lines.length > 0 ? "كل بند مقارن بآخر سعر اشتريته به من المورّد نفسه." : undefined}
          >
            {p.lines.length === 0 ? (
              <EmptyState
                compact
                icon={ListOrdered}
                title="لم تُقرأ بنود الفاتورة."
                hint="الإجمالي معروف وتفاصيله غير معروفة، فلا تدخل الفاتورة في مقارنة الأسعار. أعد قراءة المستند لاستخراج البنود."
                action={canEdit ? <DocumentReread documentId={doc.id} canEdit={canEdit} /> : undefined}
              />
            ) : (
              <DataTable
                rows={p.lines}
                keyOf={(l) => l.id}
                columns={[
                  {
                    key: "desc",
                    header: "الصنف",
                    primary: true,
                    cell: (l) => <span className="font-bold" dir="auto">{l.description}</span>,
                  },
                  { key: "qty", header: "الكمية", numeric: true, cell: (l) => <span className="nums">{trimQty(l.qty)}</span> },
                  { key: "unit", header: "سعر الوحدة", numeric: true, cell: (l) => <Money minor={l.unitPriceMinor} /> },
                  { key: "total", header: "المجموع", numeric: true, cell: (l) => <span className="font-bold"><Money minor={l.lineTotalMinor} /></span> },
                  {
                    key: "move",
                    header: "عن آخر شراء",
                    cell: (l) => {
                      if (!l.move) return <span className="text-[11px] text-muted">أول شراء</span>;
                      const m = l.move;
                      const pct = m.percent === null ? "?" : Math.abs(m.percent);
                      const badge = m.direction === "same"
                        ? <Badge>بلا تغيير</Badge>
                        : <Badge tone={m.direction === "up" ? "warn" : "ok"}>{m.direction === "up" ? "▲ ارتفع" : "▼ انخفض"} <span className="nums">{pct}</span>٪</Badge>;
                      const title = `كان ${formatRiyalsDisplay(m.previousMinor)} في ${formatDay(m.previousDate)}`;
                      return m.previousInvoiceId ? (
                        <Link href={invoiceHref(m.previousInvoiceId, "lines")} title={title} className="relative inline-flex">
                          {badge}
                        </Link>
                      ) : (
                        <span title={title}>{badge}</span>
                      );
                    },
                  },
                ]}
              />
            )}
          </Section>

          {/* ── السداد ── */}
          <Section
            id="pay"
            icon={Wallet}
            title="السداد"
            count={p.allocations.length > 0 ? p.allocations.length : undefined}
            hint={p.allocations.length > 0 ? "كل دفعة خُصم منها مبلغ لهذه الفاتورة، ومن أين جاءت الدفعة." : undefined}
          >
            {p.allocations.length === 0 ? (
              <EmptyState
                compact
                icon={Wallet}
                title="لم يُسجَّل لها أي سداد."
                hint={
                  canPay
                    ? "إن سدّدتها نقداً أو من حسابك الشخصي فسجّل السداد من «الخطوة التالية» أعلاه. وإن سُدّدت بحوالة من حساب المقهى فستُطابَق حين يصل كشف البنك."
                    : "ستُطابَق حين تظهر حوالتها في كشف البنك."
                }
              />
            ) : (
              <div className="rounded-xl border border-line bg-raised p-4 shadow-raised sm:p-5">
                <Timeline items={payItems} />
              </div>
            )}
          </Section>

          {p.statementLines.length > 0 && (
            <Section title="في كشف المورّد" icon={FileText} hint="أين ظهرت هذه الفاتورة في كشوف حساب المورّد.">
              <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised text-xs shadow-raised">
                {p.statementLines.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span>
                      <T s="كشف {0} · {1}{2}" a={[formatMonth(monthOf(s.periodEnd)), formatDay(s.date), s.ref && <> · <bdi className="nums">{s.ref}</bdi></>]} /></span>
                    <span className="flex items-center gap-2">
                      <Money minor={s.debitMinor} />
                      <Badge tone={s.matchStatus === "MATCHED" ? "ok" : s.matchStatus === "DISPUTED" ? "danger" : "muted"} dot>
                        {STATEMENT_MATCH_LABEL[s.matchStatus] ?? s.matchStatus}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <aside className="min-w-0">
          {/* ── المبالغ والضريبة ── */}
          <Section id="tax" icon={ShieldCheck} title="المبالغ والضريبة" className="mt-10 @4xl:mt-0">
            <dl className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised text-xs shadow-raised">
              <Row label="الصافي قبل الضريبة">{inv.subtotalMinor === null ? <Unknown /> : <Money minor={inv.subtotalMinor} />}</Row>
              <Row label="الضريبة">{inv.vatMinor === null ? <Unknown /> : <Money minor={inv.vatMinor} />}</Row>
              {inv.discountMinor !== null && (
                <Row label="خصم بعد الضريبة"><span className="text-ok">− <Money minor={inv.discountMinor} /></span></Row>
              )}
              {inv.chargesMinor !== null && (
                <Row label="رسوم بعد الضريبة (كالتوصيل)"><span>+ <Money minor={inv.chargesMinor} /></span></Row>
              )}
              <Row label={inv.discountMinor !== null || inv.chargesMinor !== null ? "المستحق" : "الإجمالي"}><span className="text-sm font-bold"><Money minor={inv.totalMinor} /></span></Row>
              <Row label="الرقم الضريبي للبائع">{inv.sellerVat ? <bdi className="nums">{inv.sellerVat}</bdi> : <Unknown text="لا رقم" />}</Row>
              <Row label="الرقم الضريبي للمشتري">{inv.buyerVat ? <bdi className="nums">{inv.buyerVat}</bdi> : <Unknown text="لا رقم" />}</Row>
              <Row label="الحالة الضريبية">
                <Badge tone={taxTone} dot>{TAX_LABEL[inv.taxStatus as keyof typeof TAX_LABEL] ?? inv.taxStatus}</Badge>
                {inv.taxStatus !== "VALID" && gaps.length > 0 && (
                  <span className="mt-1 block text-[11px] text-ink-soft"><T s="ينقصها: {0}" a={[gaps.join("، ")]} /></span>
                )}
              </Row>
              <Row label="خصم ضريبة المدخلات">
                <span className={`font-bold ${inv.inputVatStatus === "ELIGIBLE" ? "text-ok" : inv.inputVatStatus === "NOT_ELIGIBLE" ? "text-danger" : "text-muted"}`}>
                  {INPUT_VAT_LABEL[inv.inputVatStatus] ?? inv.inputVatStatus}
                </span>
              </Row>
              {inv.isFixedAsset && <Row label="التصنيف"><span className="text-warn">أصل ثابت (يُرسمَل)</span></Row>}
              {inv.carriedForwardFrom && <Row label="مُرحّلة من">{formatMonth(inv.carriedForwardFrom)}</Row>}
            </dl>

            <div id="fix" className="mt-3 scroll-mt-24">
              <InvoiceFix
                invoiceId={inv.id}
                canEdit={canEdit}
                startOpen={act === "fix"}
                reasons={reasons}
                initial={{
                  invoiceNumber: inv.number,
                  sellerVat: inv.sellerVat ?? "",
                  buyerVat: inv.buyerVat ?? "",
                  /* حقلٌ يُعاد إرسالُه — بلا فواصل آلاف (`formatRiyals`) */
                  subtotal: inv.subtotalMinor === null ? "" : formatRiyals(inv.subtotalMinor),
                  vat: inv.vatMinor === null ? "" : formatRiyals(inv.vatMinor),
                  total: formatRiyals(inv.totalMinor),
                  discount: inv.discountMinor === null ? "" : formatRiyals(inv.discountMinor),
                  charges: inv.chargesMinor === null ? "" : formatRiyals(inv.chargesMinor),
                  invoiceDate: todayInRiyadh(inv.date),
                  supplierId: supplier.id,
                }}
                suppliers={supplierOptions}
                paidMinor={p.paidMinor}
              />
            </div>
          </Section>

          {/* ── المصدر وثقة القراءة ── */}
          <Section id="source" icon={ScanText} title="المصدر ودقة القراءة">
            <div className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              <div className="flex items-start gap-3 border-b border-line-soft p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                  <FileText className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold" dir="auto" title={doc.fileName}>{doc.fileName}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    <T s="وصلت {0}{1} · {2}" a={[formatDay(doc.uploadedAt), doc.uploadedBy && <> · <bdi>{doc.uploadedBy}</bdi></>, doc.textSource === "TEXT" ? "قُرئت من نص الملف مباشرة" : doc.textSource === "VISION" ? "قُرئت من صورة الملف (قراءة تقريبية)" : "لم يُسجَّل مصدر القراءة"]} /></p>
                </div>
              </div>

              <div className="p-4">
                <p className="mb-2.5 text-[11px] font-bold text-muted">درجة الثقة في كل حقل</p>
                {confidence.length === 0 ? (
                  <p className="text-xs text-muted">لم تُحفظ درجة الثقة لهذه القراءة.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {confidence.map(([k, v]) => {
                      const low = v < LOW_CONFIDENCE;
                      return (
                        <li key={k}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                            <span>{FIELD_LABEL[k] ?? k}</span>
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${low ? "text-warn" : "text-ok"}`}>
                              {low ? <TriangleAlert className="h-3 w-3" strokeWidth={2.25} aria-hidden /> : <CircleCheck className="h-3 w-3" strokeWidth={2.25} aria-hidden />}
                              {low ? "ضعيفة" : "جيدة"}
                            </span>
                          </div>
                          <Meter value={Math.round(v * 100)} max={100} tone={low ? "warn" : "ok"} label={`ثقة ${FIELD_LABEL[k] ?? k}`} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap items-start gap-2 border-t border-line-soft bg-sunken/40 p-4">
                {doc.driveFileId && (
                  <a
                    href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass("secondary", "sm")}
                  >
                    <T s="{0}افتح الورقة في الدرايف" a={[<ExternalLink key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></a>
                )}
                {p.lines.length > 0 && <DocumentReread documentId={doc.id} canEdit={canEdit} />}
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              ما يقرأه النظام اقتراح فقط، ولا تُعتمد المبالغ إلا بعد أن يتحقق منها النظام. ولا يُؤخذ رقم الفاتورة من إعادة القراءة.
            </p>
          </Section>

          {/* ── ما وقع عليها ── */}
          <Section icon={History} title="سجل الفاتورة">
            <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
              <Timeline items={historyItems} />
            </div>
          </Section>

          {canEdit && (
            <Section icon={Ban} title="إلغاء الفاتورة">
              {cancellable ? (
                <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
                  <p className="mb-3 text-[11px] leading-relaxed text-muted">
                    لفاتورة ألغاها المورّد. تخرج من المبلغ المستحق، ويبقى ملفها في الدرايف وأثرها في السجل.
                  </p>
                  <RejectDocument
                    documentId={doc.id}
                    cancel
                    redirectTo={`/purchases/invoices?supplier=${encodeURIComponent(supplier.slug)}`}
                  />
                </div>
              ) : (
                <p className="rounded-xl border border-line bg-sunken px-4 py-3 text-[11px] leading-relaxed text-muted">
                  <T s="لا يمكن إلغاؤها: {0}." a={[p.allocations.length > 0 ? "عليها سداد مسجّل، فافصله عن حركة البنك أولاً" : "لأنها مطابقة بسطر في كشف المورّد"]} /></p>
              )}
            </Section>
          )}
        </aside>
      </div>
    </DetailFrame>
  );
}

const INPUT_VAT_LABEL: Record<string, string> = {
  ELIGIBLE: "تُخصم",
  NOT_ELIGIBLE: "لا تُخصم",
  UNKNOWN: "غير معروف",
};

const STATEMENT_MATCH_LABEL: Record<string, string> = {
  MATCHED: "مطابقة",
  PARTIAL: "جزئياً",
  DISPUTED: "فرق مبلغ",
  UNMATCHED: "غير مطابقة",
  IGNORED: "متجاهلة",
};

/** «١٫٠٠٠» كمّيّةٌ مخزَّنة بثلاث خانات — تُعرَض «١» كما كُتبت على الورقة. */
function trimQty(qty: string | null): string {
  if (qty === null) return "غير مقروءة";
  return qty.includes(".") ? qty.replace(/\.?0+$/, "") : qty;
}

function Notice({
  tone, icon: Icon, href, cta, children,
}: {
  tone: "warn" | "danger";
  icon: typeof CircleAlert;
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-xs leading-relaxed ${
        tone === "danger" ? "border-danger/25 bg-danger-bg" : "border-warn/25 bg-warn-bg"
      }`}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "danger" ? "text-danger" : "text-warn"}`} strokeWidth={2} aria-hidden />
        <span className="min-w-0 text-ink-soft">{children}</span>
      </span>
      <Link href={href} className="inline-flex min-h-11 shrink-0 items-center font-bold text-ink underline underline-offset-4 sm:min-h-0">
        {cta} ←
      </Link>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  );
}

/** المجهولُ ليس صفراً — يُقال بنصّه. */
function Unknown({ text = "غير معروف" }: { text?: string }) {
  return <span className="text-muted">{text}</span>;
}
