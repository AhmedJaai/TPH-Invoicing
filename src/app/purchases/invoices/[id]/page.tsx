import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, LinkButton, NoAccess, Section, type Tone } from "@/components/ui";
import { MarkInvoicePaid } from "@/components/mark-invoice-paid";
import { InvoiceFix } from "@/components/invoice-fix";
import { DocumentReread } from "@/components/document-reread";
import { RejectDocument } from "@/components/reject-document";
import { loadInvoiceProfile, neighbours } from "@/services/invoice-profile.service";
import { invoiceReasons } from "@/lib/invoice-findings";
import { ISSUE } from "@/lib/issue-codes";
import { amountsAddUp, invoiceHref, weakFields } from "@/lib/invoice-profile";
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
 * كانت الفاتورة — وهي ما يدور عليه النظام كلُّه — بلا صفحة. من بحث عن
 * رقمها فُتحت له صفحةُ مورّدها يفتّش فيها ثانيةً؛ ومن أراد سببَ نقصها
 * فتح لوحاً فوق قائمةٍ مرشَّحة؛ ومن سأل «من أيّ حوالةٍ سُدّدت؟» ذهب
 * إلى البنك يبحث بالمبلغ. وما قرأه النموذجُ منها وبأيّ ثقةٍ لم يكن
 * يُرى في أيّ موضع.
 *
 * فصار لها ملفٌّ واحد يجيب بالترتيب الذي يُسأل به:
 *   كم بقي عليها؟ ← ما الذي فيها غير سليم؟ ← ممّ تكوّنت، وأتغيّر سعرٌ
 *   فيها؟ ← من أين دُفعت؟ ← من أين جاءت، ومن قرأها؟ ← ما الذي وقع عليها؟
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
          title="لم تعد هذه الفاتورة في النظام."
          hint="أُلغيت أو رُفض مستندُها — والأثرُ باقٍ في سجلّ التدقيق، وملفُّها في الدرايف لا يُمسّ."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/purchases/invoices" variant="primary">كلّ الفواتير</LinkButton>
              {can(user.role, "audit:view") && <LinkButton href="/settings/audit">سجلّ التدقيق</LinkButton>}
            </div>
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

  const taxTone: Tone = inv.taxStatus === "VALID" ? "ok" : inv.taxStatus === "INVALID" ? "danger" : "muted";

  return (
    <PageShell
      user={user}
      width="wide"
      title={`فاتورة ${inv.number}`}
      intro={`${supplier.nameAr} · ${formatDay(inv.date)} · شهر ${formatMonth(inv.month)}`}
      actions={
        <nav className="flex flex-wrap gap-2" aria-label="التنقّل بين فواتير المورّد">
          {nav.newer && <LinkButton href={invoiceHref(nav.newer)} size="sm">→ الأحدث</LinkButton>}
          {nav.older && <LinkButton href={invoiceHref(nav.older)} size="sm">الأقدم ←</LinkButton>}
          <LinkButton href={`/suppliers/${supplier.slug}`} size="sm">ملفّ {supplier.nameAr}</LinkButton>
        </nav>
      }
    >
      {/*
        ── الحال في سطر: كم، وكم دُفع، وكم بقي ──

        ثلاثةُ أعمدةٍ على كلّ مقاس: مكدَّسةً على الجوّال كانت تأخذ نصفَ
        الشاشة الأولى لثلاثة أرقام. والفعلُ تحتها لا داخلها — زرٌّ في عمودٍ
        عرضُه ثلثُ هاتفٍ لا يُضغط.
      */}
      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-line rounded-2xl border border-line bg-raised shadow-raised">
        <Fact label="الإجمالي"><Money minor={inv.totalMinor} /></Fact>
        <Fact label="دُفع لها" sub={p.allocations.length > 0 ? `في ${countNoun(p.allocations.length, PAYMENT_RECORD)}` : "لم يُسجَّل سداد"}>
          <Money minor={p.paidMinor} />
        </Fact>
        <Fact label={p.settled ? "مسدَّدة" : "بقي عليها"} sub={p.settled ? "لا شيء عليها." : undefined}>
          {p.settled ? <span className="text-ok">✓</span> : <Money minor={p.remainingMinor} tone="warn" />}
        </Fact>
      </div>
      {!p.settled && canPay && (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
          <MarkInvoicePaid invoiceId={inv.id} label={formatRiyals(p.remainingMinor)} />
        </div>
      )}

      {/*
        ── ما يستحقّ الانتباه ──

        كلُّ سطرٍ هنا مشتقٌّ لا مخزَّن، ومعه موضعُ علاجه. ولا يُعرَض القسم
        حين لا شيء: فراغُه هو الخبر.
      */}
      {(p.twins.length > 0 || addsUp === false || weak.length > 0 || problems.length > 0 || risen.length > 0) && (
        <ul className="mt-4 space-y-2" aria-label="ما يستحقّ الانتباه">
          {p.twins.map((t) => (
            <Notice key={t.id} tone="warn" href={invoiceHref(t.id)} cta="قارِنها">
              فاتورةٌ أخرى من {supplier.nameAr} بالإجمالي نفسه ({formatRiyalsDisplay(t.totalMinor)}) في{" "}
              {formatDay(t.date)} — رقمها <bdi className="nums">{t.number}</bdi>. قد تكونان طلبين، وقد تكون مكرَّرة؛
              قارِن بنودهما قبل أن تسدّد الاثنتين.
            </Notice>
          ))}
          {addsUp === false && (
            <Notice tone="danger" href="#tax" cta="صحّحها">
              الصافي + الضريبة لا يساوي الإجمالي بأكثر من ريال — أحدُ المبالغ قُرئ خطأً.
            </Notice>
          )}
          {problems.length > 0 && (
            <Notice tone={problems.some((r) => r.severity === "BLOCKER") ? "danger" : "warn"} href="#tax" cta="عالِجها">
              {problems[0].what}
              {problems.length > 1 && ` — و${countNoun(problems.length - 1, REASON)} غيره`}.
            </Notice>
          )}
          {weak.length > 0 && (
            <Notice tone="warn" href="#source" cta="راجع المصدر">
              قرأ النموذج {weak.join(" و")} بثقةٍ ضعيفة — قارنها بالورقة قبل أن تعتمد عليها.
            </Notice>
          )}
          {risen.length > 0 && (
            <Notice tone="warn" href="#lines" cta="انظر البنود">
              {risen.length === 1
                ? `ارتفع سعر «${risen[0].description}» ${risen[0].move?.percent ?? "?"}٪ عن آخر شراء.`
                : `ارتفع سعر ${countNoun(risen.length, ITEM)} عن آخر شراءٍ لها.`}
            </Notice>
          )}
        </ul>
      )}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-10">
        <div className="min-w-0">
          {/* ── البنود ── */}
          <Section
            id="lines"
            title="البنود"
            hint={p.lines.length > 0 ? "وكلُّ بندٍ مقابلَ آخرِ سعرٍ اشتُري به من المورّد نفسه." : undefined}
            className="scroll-mt-24"
          >
            {p.lines.length === 0 ? (
              <EmptyState
                title="لم تُقرأ بنودُها."
                hint="الإجماليّ معروف ولا يُعرَف ممّ تكوّن — فلا تدخل في مقارنة الأسعار. أعد قراءة المستند لتُستخرَج."
                action={<DocumentReread documentId={doc.id} canEdit={canEdit} />}
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
                    cell: (l) => <span className="font-medium" dir="auto">{l.description}</span>,
                  },
                  { key: "qty", header: "الكمّيّة", numeric: true, cell: (l) => <span className="nums">{trimQty(l.qty)}</span> },
                  { key: "unit", header: "سعر الوحدة", numeric: true, cell: (l) => <Money minor={l.unitPriceMinor} /> },
                  { key: "total", header: "المجموع", numeric: true, cell: (l) => <span className="font-medium"><Money minor={l.lineTotalMinor} /></span> },
                  {
                    key: "move",
                    header: "عن آخر شراء",
                    cell: (l) => {
                      if (!l.move) return <span className="text-[11px] text-muted">أوّلُ شراء</span>;
                      const m = l.move;
                      const label = m.direction === "same"
                        ? "كما هو"
                        : `${m.direction === "up" ? "▲" : "▼"} ${m.percent === null ? "?" : Math.abs(m.percent)}٪`;
                      const tone = m.direction === "up" ? "text-warn font-bold" : m.direction === "down" ? "text-ok" : "text-muted";
                      const title = `كان ${formatRiyalsDisplay(m.previousMinor)} في ${formatDay(m.previousDate)}`;
                      return m.previousInvoiceId ? (
                        <Link href={invoiceHref(m.previousInvoiceId, "lines")} title={title} className={`relative text-[11px] underline-offset-4 hover:underline ${tone}`}>
                          {label}
                        </Link>
                      ) : (
                        <span title={title} className={`text-[11px] ${tone}`}>{label}</span>
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
            title="السداد"
            hint={p.allocations.length > 0 ? "كلُّ دفعةٍ خُصم منها شيءٌ لهذه الفاتورة، ومن أين خرجت." : undefined}
            className="scroll-mt-24"
          >
            {p.allocations.length === 0 ? (
              <EmptyState
                title="لم يُسجَّل لها سداد."
                hint={
                  canPay
                    ? "إن سُدّدت نقداً أو من حسابك فسجّلها من «بقي عليها» أعلاه. وإن كانت حوالةً من حساب المقهى فتُطابَق حين يصل كشف البنك."
                    : "تُطابَق حين تصل حوالتُها في كشف البنك."
                }
              />
            ) : (
              <DataTable
                rows={p.allocations}
                keyOf={(a) => a.paymentId}
                columns={[
                  { key: "date", header: "التاريخ", primary: true, cell: (a) => <span>{formatDay(a.paidAt)}</span> },
                  { key: "amount", header: "خُصم لها", numeric: true, cell: (a) => <span className="font-medium"><Money minor={a.amountMinor} /></span> },
                  { key: "payment", header: "من دفعةٍ بـ", numeric: true, secondary: true, cell: (a) => <Money minor={a.paymentAmountMinor} /> },
                  { key: "method", header: "طريقتها", cell: (a) => <span className="text-ink-soft">{METHOD_LABEL[a.method] ?? a.method}</span> },
                  {
                    key: "status",
                    header: "حالها",
                    cell: (a) => (
                      <span className={a.status === "REVERSED" || a.status === "VOID" ? "text-danger" : "text-muted"}>
                        {paymentStatusLabel(a.status)}
                      </span>
                    ),
                  },
                  {
                    key: "tx",
                    header: "في كشف البنك",
                    cell: (a) =>
                      a.bankTxId ? (
                        <Link href={`/bank?tx=${a.bankTxId}`} className="relative underline underline-offset-4">افتح الحركة</Link>
                      ) : a.method === "BANK_TRANSFER" ? (
                        <span className="text-warn">لم تُطابَق بعد</span>
                      ) : (
                        <span className="text-muted">لا يظهر في كشف المقهى</span>
                      ),
                  },
                ]}
              />
            )}
          </Section>

          {p.statementLines.length > 0 && (
            <Section title="في كشف المورّد" hint="أين ظهرت هذه الفاتورة في كشوف حساب المورّد.">
              <ul className="divide-y divide-line rounded-2xl border border-line bg-raised text-xs shadow-raised">
                {p.statementLines.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                    <span>
                      كشف {formatMonth(s.periodEnd.toISOString().slice(0, 7))} · {formatDay(s.date)}
                      {s.ref && <> · <bdi className="nums">{s.ref}</bdi></>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Money minor={s.debitMinor} />
                      <Badge tone={s.matchStatus === "MATCHED" ? "ok" : s.matchStatus === "DISPUTED" ? "danger" : "muted"}>
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
          <Section id="tax" title="المبالغ والضريبة" className="scroll-mt-24">
            <dl className="divide-y divide-line rounded-2xl border border-line bg-raised text-xs shadow-raised">
              <Row label="الصافي قبل الضريبة">{inv.subtotalMinor === null ? <Unknown /> : <Money minor={inv.subtotalMinor} />}</Row>
              <Row label="الضريبة">{inv.vatMinor === null ? <Unknown /> : <Money minor={inv.vatMinor} />}</Row>
              <Row label="الإجمالي"><span className="font-bold"><Money minor={inv.totalMinor} /></span></Row>
              <Row label="ضريبيّ البائع">{inv.sellerVat ? <bdi className="nums">{inv.sellerVat}</bdi> : <Unknown text="لا رقم" />}</Row>
              <Row label="ضريبيّ المشتري">{inv.buyerVat ? <bdi className="nums">{inv.buyerVat}</bdi> : <Unknown text="لا رقم" />}</Row>
              <Row label="حالُها الضريبيّ">
                <Badge tone={taxTone}>{TAX_LABEL[inv.taxStatus as keyof typeof TAX_LABEL] ?? inv.taxStatus}</Badge>
              </Row>
              <Row label="خصمُ ضريبة المدخلات">
                <span className={inv.inputVatStatus === "ELIGIBLE" ? "text-ok" : inv.inputVatStatus === "NOT_ELIGIBLE" ? "text-danger" : "text-muted"}>
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

          {/* ── المصدر ── */}
          <Section id="source" title="المصدر" className="scroll-mt-24">
            <dl className="divide-y divide-line rounded-2xl border border-line bg-raised text-xs shadow-raised">
              <Row label="الملف">
                <span className="block max-w-[14rem] truncate" dir="auto" title={doc.fileName}>{doc.fileName}</span>
              </Row>
              <Row label="وصل">{formatDay(doc.uploadedAt)}{doc.uploadedBy && <> · <bdi>{doc.uploadedBy}</bdi></>}</Row>
              <Row label="قرأه">
                {doc.extractionModel
                  ? <span><bdi className="nums">{doc.extractionModel}</bdi>{doc.textSource ? ` · ${TEXT_SOURCE_LABEL[doc.textSource] ?? doc.textSource}` : ""}</span>
                  : <Unknown text="لم يُسجَّل" />}
              </Row>
              <Row label="الثقة">
                {!doc.fieldConfidence
                  ? <Unknown text="لم تُسجَّل" />
                  : weak.length === 0
                    ? <span className="text-ok">كلُّ الحقول فوق الحدّ</span>
                    : <span className="text-warn">ضعيفة في {weak.join(" و")}</span>}
              </Row>
            </dl>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              {doc.driveFileId && (
                <a
                  href={`https://drive.google.com/file/d/${doc.driveFileId}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-[11px] font-bold hover:border-ink-soft sm:min-h-9"
                >
                  افتح الورقة في الدرايف ↗
                </a>
              )}
              {p.lines.length > 0 && <DocumentReread documentId={doc.id} canEdit={canEdit} />}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              ما قرأه النموذج اقتراح؛ والمبالغ لا تُعتمَد إلّا بعد أن يحكم عليها الخادم — ورقمُ الفاتورة لا يُؤخذ من إعادة القراءة.
            </p>
          </Section>

          {/* ── ما وقع عليها ── */}
          <Section title="ما وقع عليها">
            {p.history.length === 0 ? (
              <p className="text-xs text-muted">
                أُرشِفت في {formatDay(inv.createdAt)} ولم يُعدَّل فيها شيءٌ منذئذ.
              </p>
            ) : (
              <ol className="space-y-2.5 border-s border-line ps-4 text-xs">
                {p.history.map((h) => (
                  <li key={h.id}>
                    <p className="font-bold">{actionLabel(h.action)}</p>
                    <p className="text-[11px] text-muted">
                      {formatDay(h.at)} · {h.actor ?? "النظام"}
                    </p>
                  </li>
                ))}
                <li>
                  <p className="font-bold">أُرشِفت</p>
                  <p className="text-[11px] text-muted">{formatDay(inv.createdAt)}</p>
                </li>
              </ol>
            )}
          </Section>

          {canEdit && (
            <Section title="إلغاء الفاتورة">
              {cancellable ? (
                <>
                  <p className="mb-2 text-[11px] leading-relaxed text-muted">
                    لفاتورةٍ ألغاها المورّد. تخرج من المستحقّ، ويبقى ملفُّها في الدرايف والأثرُ في السجلّ.
                  </p>
                  <RejectDocument
                    documentId={doc.id}
                    cancel
                    redirectTo={`/purchases/invoices?supplier=${encodeURIComponent(supplier.slug)}`}
                  />
                </>
              ) : (
                <p className="text-[11px] leading-relaxed text-muted">
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

const TEXT_SOURCE_LABEL: Record<string, string> = {
  TEXT: "من نصّ الملف",
  VISION: "من صورة الملف",
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

function Fact({
  label, sub, children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <span className="block text-[11px] font-medium text-muted">{label}</span>
      <span className="mt-1 block truncate font-display text-lg font-black leading-none sm:text-2xl">{children}</span>
      {sub && <span className="mt-1.5 block truncate text-[11px] text-muted">{sub}</span>}
    </div>
  );
}

function Notice({
  tone, href, cta, children,
}: {
  tone: "warn" | "danger";
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
        tone === "danger" ? "border-danger/40 bg-danger-bg" : "border-warn/40 bg-warn-bg"
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <Link href={href} className="shrink-0 font-bold underline underline-offset-4">{cta} ←</Link>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  );
}

/** المجهولُ ليس صفراً — يُقال بنصّه. */
function Unknown({ text = "غير معروف" }: { text?: string }) {
  return <span className="text-muted">{text}</span>;
}
