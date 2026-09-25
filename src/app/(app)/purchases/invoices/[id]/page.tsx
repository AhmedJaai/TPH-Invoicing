import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Ban, CircleAlert, CircleCheck, Copy, ExternalLink, FileText, History, Landmark, ListOrdered,
  Receipt, ScanText, ShieldCheck, TrendingUp, TriangleAlert, Wallet,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import {
  Badge, DataTable, EmptyState, LinkButton, Meter, Monogram, NoAccess, Section, Timeline, buttonClass,
  type TimelineItem, type Tone,
} from "@/components/ui";
import { MarkInvoicePaid } from "@/components/mark-invoice-paid";
import { InvoiceFix } from "@/components/invoice-fix";
import { DocumentReread } from "@/components/document-reread";
import { RejectDocument } from "@/components/reject-document";
import { loadInvoiceProfile, neighbours } from "@/services/invoice-profile.service";
import { invoiceReasons } from "@/lib/invoice-findings";
import { ISSUE } from "@/lib/issue-codes";
import { FIELD_LABEL, LOW_CONFIDENCE, amountsAddUp, invoiceHref, weakFields } from "@/lib/invoice-profile";
import { TAX_LABEL } from "@/lib/invoice-filter";
import { companyConfig } from "@/config/drive";
import { formatRiyals, formatRiyalsDisplay, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { METHOD_LABEL, paymentStatusLabel } from "@/lib/payment-state";
import { actionLabel } from "@/lib/audit-labels";
import { ITEM, PAYMENT_RECORD, REASON, countNoun } from "@/lib/arabic";

export const dynamic = "force-dynamic";

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
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(invoiceHref(id))}`);
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} title="فاتورة">
        <NoAccess what="الفواتير" />
      </PageShell>
    );
  }

  const p = await loadInvoiceProfile(id);
  if (!p) {
    /*
      رابطٌ إلى فاتورةٍ لم تعد: أُلغيت أو أُسقط مستندُها. «لم نجد الصفحة»
      العامّة لا تقول ذلك، وصاحبُ المقهى يظنّ العطبَ في النظام.
    */
    return (
      <PageShell user={user} title="فاتورة غير موجودة">
        <EmptyState
          icon={Receipt}
          title="لم تعد هذه الفاتورة في النظام."
          hint="أُلغيت أو رُفض مستندُها — والأثرُ باقٍ في سجلّ التدقيق، وملفُّها في الدرايف لا يُمسّ."
          action={
            <>
              <LinkButton href="/purchases/invoices" variant="primary">كلّ الفواتير</LinkButton>
              <LinkButton href="/documents?status=REJECTED">المستندات المرفوضة</LinkButton>
              {can(user.role, "audit:view") && <LinkButton href="/settings/audit">سجلّ التدقيق</LinkButton>}
            </>
          }
        />
      </PageShell>
    );
  }

  const { invoice: inv, supplier, document: doc } = p;
  const nav = await neighbours(supplier.id, inv.date, inv.id);
  const canEdit = can(user.role, "document:upload");
  const canPay = can(user.role, "payment:approve");

  const reasons = invoiceReasons(
    {
      kind: doc.kind,
      invoiceNumber: inv.number,
      sellerVat: inv.sellerVat,
      buyerVat: inv.buyerVat,
      subtotalMinor: inv.subtotalMinor,
      vatMinor: inv.vatMinor,
      totalMinor: inv.totalMinor,
      lineCount: p.lines.length,
    },
    { issuesInvoices: supplier.issuesInvoices, contractOnFile: supplier.contractOnFile },
    companyConfig.vatNumber,
  );
  /* وما قاله `invoiceReasons` لا يُكرَّر بنصٍّ ثانٍ */
  const addsUp = reasons.some((r) => r.code === ISSUE.VAT_MATH_MISMATCH)
    ? null
    : amountsAddUp(inv.subtotalMinor, inv.vatMinor, inv.totalMinor, TOTAL_ROUNDING_TOLERANCE_MINOR);
  const weak = weakFields(doc.fieldConfidence);
  const risen = p.lines.filter((l) => l.move?.direction === "up");
  /* ما هو للعلم (تقريبُ مورّد، بنودٌ معفاة) لا يُرفع إلى «ما يستحقّ الانتباه» */
  const problems = reasons.filter((r) => r.severity !== "INFO");
  /* الإلغاء يرفضه الخادمُ على فاتورةٍ عليها سدادٌ أو طوبقت بكشف — فلا يُعرَض زرٌّ يُرفَض */
  const cancellable = canEdit && p.allocations.length === 0 && p.statementLines.length === 0;
  const partial = !p.settled && p.paidMinor > 0;

  const taxTone: Tone = inv.taxStatus === "VALID" ? "ok" : inv.taxStatus === "INVALID" ? "danger" : "muted";
  const payBadge = p.settled
    ? { tone: "ok" as Tone, text: "مسدَّدة" }
    : partial
      ? { tone: "warn" as Tone, text: "سُدّدت جزئياً" }
      : { tone: "warn" as Tone, text: "لم تُسدَّد" };

  /* ── خطُّ السداد: كلُّ دفعةٍ خُصم منها شيءٌ لهذه الفاتورة ومن أين خرجت ── */
  const payItems: TimelineItem[] = p.allocations.map((a) => {
    const undone = a.status === "REVERSED" || a.status === "VOID";
    return {
      id: a.paymentId,
      icon: undone ? CircleAlert : a.method === "BANK_TRANSFER" ? Landmark : Wallet,
      tone: undone ? "danger" : a.bankTxId ? "ok" : "accent",
      title: <>خُصم لها <Money minor={a.amountMinor} /> — {METHOD_LABEL[a.method] ?? a.method}</>,
      meta: formatDay(a.paidAt),
      body: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {a.paymentAmountMinor !== a.amountMinor && <span>من دفعةٍ بـ<Money minor={a.paymentAmountMinor} /></span>}
          <span className={undone ? "font-bold text-danger" : ""}>{paymentStatusLabel(a.status)}</span>
          <span aria-hidden>·</span>
          {a.bankTxId ? (
            <Link href={`/bank?tx=${a.bankTxId}`} className="font-bold text-accent hover:underline">افتح حركتها في البنك</Link>
          ) : a.method === "BANK_TRANSFER" ? (
            <span className="text-warn">لم تُطابَق بكشف البنك بعد</span>
          ) : (
            <span className="text-muted">لا يظهر في كشف المقهى</span>
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
    { id: "archived", title: "أُرشِفت", meta: formatDay(inv.createdAt), icon: FileText, body: doc.uploadedBy ? <>رفعها <bdi>{doc.uploadedBy}</bdi></> : undefined },
  ];

  const confidence = doc.fieldConfidence ? Object.entries(doc.fieldConfidence).sort(([, a], [, b]) => a - b) : [];

  return (
    <PageShell
      user={user}
      width="wide"
      title={`فاتورة ${inv.number}`}
      eyebrow={
        <Link href={`/suppliers/${supplier.slug}`} className="inline-flex items-center gap-2 font-bold text-ink-soft hover:text-accent">
          <Monogram name={supplier.nameAr} className="h-5 w-5 text-[10px]" />
          {supplier.nameAr}
        </Link>
      }
      intro={`بتاريخ ${formatDay(inv.date)} · تُحسَب في ${formatMonth(inv.month)}`}
      actions={
        <nav className="flex flex-wrap gap-2" aria-label="التنقّل بين فواتير المورّد">
          {nav.newer && <LinkButton href={invoiceHref(nav.newer)} size="sm">→ الأحدث</LinkButton>}
          {nav.older && <LinkButton href={invoiceHref(nav.older)} size="sm">الأقدم ←</LinkButton>}
          <LinkButton href={`/suppliers/${supplier.slug}`} size="sm">ملفّ المورّد</LinkButton>
        </nav>
      }
    >
      {/* ── الحالُ والخطوةُ التالية ── */}
      <section
        aria-label="ما بقي عليها"
        className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-raised shadow-raised lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
      >
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={payBadge.tone} dot>{payBadge.text}</Badge>
            <Link href="#tax" className="rounded-full">
              <Badge tone={taxTone} dot>{TAX_LABEL[inv.taxStatus as keyof typeof TAX_LABEL] ?? inv.taxStatus}</Badge>
            </Link>
            {inv.isFixedAsset && <Badge tone="info">أصلٌ ثابت</Badge>}
          </div>
          <p className="mt-5 text-xs font-bold text-muted">{p.settled ? "لا شيء عليها" : "بقي عليها"}</p>
          <p className={`mt-1.5 text-[2.2rem] font-bold leading-none tracking-tight sm:text-[2.6rem] ${p.settled ? "text-ok" : ""}`}>
            {p.settled ? (
              <span className="inline-flex items-center gap-2">
                <CircleCheck className="h-8 w-8" strokeWidth={2} aria-hidden />
                <span className="text-[1.6rem] sm:text-[1.9rem]">مسدَّدة بالكامل</span>
              </span>
            ) : (
              <Money minor={p.remainingMinor} currency />
            )}
          </p>
          <div className="mt-5 max-w-md">
            {inv.totalMinor > 0 && (
              <Meter value={Math.min(p.paidMinor, inv.totalMinor)} max={inv.totalMinor} tone={p.settled ? "ok" : "accent"} label="ما سُدّد من الإجماليّ" />
            )}
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>الإجماليّ <b className="text-ink"><Money minor={inv.totalMinor} /></b></span>
              <span>
                سُدّد <b className="text-ink"><Money minor={p.paidMinor} /></b>
                {p.allocations.length > 0 ? ` في ${countNoun(p.allocations.length, PAYMENT_RECORD)}` : " — لم يُسجَّل سداد"}
              </span>
            </p>
          </div>
        </div>

        <div className="border-t border-line bg-sunken/50 p-5 sm:p-6 lg:border-s lg:border-t-0">
          <p className="mb-3 text-xs font-bold text-muted">الخطوة التالية</p>
          {p.settled ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              لا شيء عليك فيها. {p.allocations.length > 0 && <Link href="#pay" className="font-bold text-accent hover:underline">انظر من أين سُدّدت</Link>}
            </p>
          ) : canPay ? (
            <>
              <MarkInvoicePaid invoiceId={inv.id} label={formatRiyals(p.remainingMinor)} layout="panel" />
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                إن كانت حوالةً من حساب المقهى وسيصل كشفُها، فانتظره — تُطابَق حينها وحدها.
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-ink-soft">
              تُطابَق حين تصل حوالتُها في كشف البنك. وتسجيلُ السداد بيدٍ لمن يعتمد السداد.
            </p>
          )}
        </div>
      </section>

      {/*
        ── ما يستحقّ الانتباه ──

        كلُّ سطرٍ هنا مشتقٌّ لا مخزَّن، ومعه موضعُ علاجه. ولا يُعرَض القسم
        حين لا شيء: فراغُه هو الخبر.
      */}
      {(p.twins.length > 0 || addsUp === false || weak.length > 0 || problems.length > 0 || risen.length > 0) && (
        <ul className="mt-4 space-y-2" aria-label="ما يستحقّ الانتباه">
          {p.twins.map((t) => (
            <Notice key={t.id} tone="warn" icon={Copy} href={invoiceHref(t.id)} cta="قارِنها">
              فاتورةٌ أخرى من {supplier.nameAr} بالإجمالي نفسه ({formatRiyalsDisplay(t.totalMinor)}) في{" "}
              {formatDay(t.date)} — رقمها <bdi className="nums">{t.number}</bdi>. قد تكونان طلبين، وقد تكون مكرَّرة؛
              قارِن بنودهما قبل أن تسدّد الاثنتين.
            </Notice>
          ))}
          {addsUp === false && (
            <Notice tone="danger" icon={CircleAlert} href="#tax" cta="صحّحها">
              الصافي + الضريبة لا يساوي الإجمالي بأكثر من ريال — أحدُ المبالغ قُرئ خطأً.
            </Notice>
          )}
          {problems.length > 0 && (
            <Notice
              tone={problems.some((r) => r.severity === "BLOCKER") ? "danger" : "warn"}
              icon={problems.some((r) => r.severity === "BLOCKER") ? CircleAlert : TriangleAlert}
              href="#tax"
              cta="عالِجها"
            >
              {problems[0].what}
              {problems.length > 1 && ` — و${countNoun(problems.length - 1, REASON)} غيره`}.
            </Notice>
          )}
          {weak.length > 0 && (
            <Notice tone="warn" icon={ScanText} href="#source" cta="راجع المصدر">
              قرأ النموذج {weak.join(" و")} بثقةٍ ضعيفة — قارنها بالورقة قبل أن تعتمد عليها.
            </Notice>
          )}
          {risen.length > 0 && (
            <Notice tone="warn" icon={TrendingUp} href="#lines" cta="انظر البنود">
              {risen.length === 1
                ? `ارتفع سعر «${risen[0].description}» ${risen[0].move?.percent ?? "?"}٪ عن آخر شراء.`
                : `ارتفع سعر ${countNoun(risen.length, ITEM)} عن آخر شراءٍ لها.`}
            </Notice>
          )}
        </ul>
      )}

      <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] lg:gap-10">
        <div className="min-w-0">
          {/* ── البنود ── */}
          <Section
            id="lines"
            icon={ListOrdered}
            title="البنود"
            count={p.lines.length > 0 ? p.lines.length : undefined}
            hint={p.lines.length > 0 ? "وكلُّ بندٍ مقابلَ آخرِ سعرٍ اشتُري به من المورّد نفسه." : undefined}
          >
            {p.lines.length === 0 ? (
              <EmptyState
                compact
                icon={ListOrdered}
                title="لم تُقرأ بنودُها."
                hint="الإجماليّ معروف ولا يُعرَف ممّ تكوّن — فلا تدخل في مقارنة الأسعار. أعد قراءة المستند لتُستخرَج."
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
                  { key: "qty", header: "الكمّيّة", numeric: true, cell: (l) => <span className="nums">{trimQty(l.qty)}</span> },
                  { key: "unit", header: "سعر الوحدة", numeric: true, cell: (l) => <Money minor={l.unitPriceMinor} /> },
                  { key: "total", header: "المجموع", numeric: true, cell: (l) => <span className="font-bold"><Money minor={l.lineTotalMinor} /></span> },
                  {
                    key: "move",
                    header: "عن آخر شراء",
                    cell: (l) => {
                      if (!l.move) return <span className="text-[11px] text-muted">أوّلُ شراء</span>;
                      const m = l.move;
                      const pct = m.percent === null ? "?" : Math.abs(m.percent);
                      const badge = m.direction === "same"
                        ? <Badge>كما هو</Badge>
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
            hint={p.allocations.length > 0 ? "كلُّ دفعةٍ خُصم منها شيءٌ لهذه الفاتورة، ومن أين خرجت." : undefined}
          >
            {p.allocations.length === 0 ? (
              <EmptyState
                compact
                icon={Wallet}
                title="لم يُسجَّل لها سداد."
                hint={
                  canPay
                    ? "إن سُدّدت نقداً أو من حسابك فسجّلها من «الخطوة التالية» أعلاه. وإن كانت حوالةً من حساب المقهى فتُطابَق حين يصل كشف البنك."
                    : "تُطابَق حين تصل حوالتُها في كشف البنك."
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
                      كشف {formatMonth(s.periodEnd.toISOString().slice(0, 7))} · {formatDay(s.date)}
                      {s.ref && <> · <bdi className="nums">{s.ref}</bdi></>}
                    </span>
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
          <Section id="tax" icon={ShieldCheck} title="المبالغ والضريبة" className="mt-10 lg:mt-0">
            <dl className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised text-xs shadow-raised">
              <Row label="الصافي قبل الضريبة">{inv.subtotalMinor === null ? <Unknown /> : <Money minor={inv.subtotalMinor} />}</Row>
              <Row label="الضريبة">{inv.vatMinor === null ? <Unknown /> : <Money minor={inv.vatMinor} />}</Row>
              <Row label="الإجمالي"><span className="text-sm font-bold"><Money minor={inv.totalMinor} /></span></Row>
              <Row label="ضريبيّ البائع">{inv.sellerVat ? <bdi className="nums">{inv.sellerVat}</bdi> : <Unknown text="لا رقم" />}</Row>
              <Row label="ضريبيّ المشتري">{inv.buyerVat ? <bdi className="nums">{inv.buyerVat}</bdi> : <Unknown text="لا رقم" />}</Row>
              <Row label="حالُها الضريبيّ">
                <Badge tone={taxTone} dot>{TAX_LABEL[inv.taxStatus as keyof typeof TAX_LABEL] ?? inv.taxStatus}</Badge>
              </Row>
              <Row label="خصمُ ضريبة المدخلات">
                <span className={`font-bold ${inv.inputVatStatus === "ELIGIBLE" ? "text-ok" : inv.inputVatStatus === "NOT_ELIGIBLE" ? "text-danger" : "text-muted"}`}>
                  {INPUT_VAT_LABEL[inv.inputVatStatus] ?? inv.inputVatStatus}
                </span>
              </Row>
              {inv.isFixedAsset && <Row label="تصنيفُها"><span className="text-warn">أصلٌ ثابت — يُرسمَل</span></Row>}
              {inv.carriedForwardFrom && <Row label="رُحِّلت من">{formatMonth(inv.carriedForwardFrom)}</Row>}
            </dl>

            <div className="mt-3">
              <InvoiceFix
                invoiceId={inv.id}
                canEdit={canEdit}
                reasons={reasons}
                initial={{
                  invoiceNumber: inv.number,
                  sellerVat: inv.sellerVat ?? "",
                  buyerVat: inv.buyerVat ?? "",
                  /* حقلٌ يُعاد إرسالُه — بلا فواصل آلاف (`formatRiyals`) */
                  subtotal: inv.subtotalMinor === null ? "" : formatRiyals(inv.subtotalMinor),
                  vat: inv.vatMinor === null ? "" : formatRiyals(inv.vatMinor),
                  total: formatRiyals(inv.totalMinor),
                }}
              />
            </div>
          </Section>

          {/* ── المصدر وثقة القراءة ── */}
          <Section id="source" icon={ScanText} title="المصدر وثقة القراءة">
            <div className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              <div className="flex items-start gap-3 border-b border-line-soft p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                  <FileText className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold" dir="auto" title={doc.fileName}>{doc.fileName}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    وصل {formatDay(doc.uploadedAt)}{doc.uploadedBy && <> · <bdi>{doc.uploadedBy}</bdi></>}
                    {" · "}
                    {doc.textSource === "TEXT" ? "قُرئ من نصّ الملفّ — نقلاً" : doc.textSource === "VISION" ? "قُرئ من صورة الملفّ — ظنّاً" : "لم يُسجَّل مصدرُ القراءة"}
                  </p>
                </div>
              </div>

              <div className="p-4">
                <p className="mb-2.5 text-[11px] font-bold text-muted">ثقةُ النموذج في كلّ حقل</p>
                {confidence.length === 0 ? (
                  <p className="text-xs text-muted">لم تُسجَّل الثقة لهذه القراءة — غير معروفة.</p>
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
                              {low ? "ضعيفة" : "جيّدة"}
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
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    افتح الورقة في الدرايف
                  </a>
                )}
                {p.lines.length > 0 && <DocumentReread documentId={doc.id} canEdit={canEdit} />}
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              ما قرأه النموذج اقتراح؛ والمبالغ لا تُعتمَد إلّا بعد أن يحكم عليها الخادم — ورقمُ الفاتورة لا يُؤخذ من إعادة القراءة.
            </p>
          </Section>

          {/* ── ما وقع عليها ── */}
          <Section icon={History} title="ما وقع عليها">
            <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
              <Timeline items={historyItems} />
            </div>
          </Section>

          {canEdit && (
            <Section icon={Ban} title="إلغاء الفاتورة">
              {cancellable ? (
                <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
                  <p className="mb-3 text-[11px] leading-relaxed text-muted">
                    لفاتورةٍ ألغاها المورّد. تخرج من المستحقّ، ويبقى ملفُّها في الدرايف والأثرُ في السجلّ.
                  </p>
                  <RejectDocument
                    documentId={doc.id}
                    cancel
                    redirectTo={`/purchases/invoices?supplier=${encodeURIComponent(supplier.slug)}`}
                  />
                </div>
              ) : (
                <p className="rounded-xl border border-line bg-sunken px-4 py-3 text-[11px] leading-relaxed text-muted">
                  لا تُلغى: {p.allocations.length > 0 ? "عليها سدادٌ مسجَّل — فُكَّه من حركة البنك أوّلاً" : "طوبقت بسطرٍ في كشف المورّد"}.
                </p>
              )}
            </Section>
          )}
        </aside>
      </div>
    </PageShell>
  );
}

const INPUT_VAT_LABEL: Record<string, string> = {
  ELIGIBLE: "تُخصَم",
  NOT_ELIGIBLE: "لا تُخصَم",
  UNKNOWN: "غير معروف",
};

const STATEMENT_MATCH_LABEL: Record<string, string> = {
  MATCHED: "مطابَقة",
  PARTIAL: "جزئيّاً",
  DISPUTED: "فرقُ مبلغ",
  UNMATCHED: "لم تُطابَق",
  IGNORED: "مُتجاهَلة",
};

/** «١٫٠٠٠» كمّيّةٌ مخزَّنة بثلاث خانات — تُعرَض «١» كما كُتبت على الورقة. */
function trimQty(qty: string): string {
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
