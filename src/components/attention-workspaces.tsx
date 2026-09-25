import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { Money } from "@/components/money";
import { ChevronDown, CircleCheck, CircleHelp, ExternalLink, FileText, MessageCircle, TriangleAlert } from "lucide-react";
import { LinkButton, Monogram, buttonClass } from "./ui";
import { ConfirmDocument } from "./confirm-document";
import { ConfirmEligible } from "./confirm-eligible";
import { NoStatementsButton } from "./no-statements-button";
import { RejectDocument } from "./reject-document";
import { SupplierPolicy } from "./supplier-policy";
import { OrphanPayment } from "./orphan-payment";
import { buildInvoiceRequest, buildStatementRequest, groupUnbackedBySupplier } from "@/lib/supplier-requests";
import { loadMissingStatementSuppliers, loadUnbackedPayments } from "@/services/supplier-followups.service";
import { DOCUMENT, PAYMENT_RECORD, countNoun } from "@/lib/arabic";
import { needsContract } from "@/lib/supplier-policy-rules";
import { GAP_TEXT } from "@/lib/extraction/auto-archive";
import { loadPendingReview } from "@/services/document-review.service";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh, formatDay } from "@/lib/riyadh-time";

/**
 * ألواحُ الفعل داخل «يحتاج قرارك».
 *
 * ── لماذا ──
 *
 * كان ستّةٌ من ثمانية بنودٍ زرُّها يخرج بصاحب المقهى من الطابور:
 * «افتح الدفعات…»، «افتح الوارد»، «افتح من يحتاج عقداً». فيفقد
 * القائمة، ويصل إلى صفحةٍ فيها ترشيحٌ وجدولٌ وأعمدةٌ ليست من شأنه،
 * ويعود من أوّلها — أو لا يعود.
 *
 * والعملُ في هذه البنود **صغير**: رسالةُ واتساب تُرسَل، ومستندٌ
 * يُعتمَد، وسياسةُ مورّدٍ تُعلَن. لا شيء منها يستحقّ انتقالَ صفحة.
 *
 * ── وما لم يُنقَل ──
 *
 * بندان يبقى زرُّهما خارجاً، وذلك صواب لا نقص:
 *
 *   • **«ضريبة مدخلات معرّضة للضياع»** — ثمانٍ وستّون فاتورة، ولكلٍّ
 *     سببُها ومُصلِحُها. جدولُ الفواتير المرشَّح هو موضعُها.
 *   • **«مورّدون تأخّرت مستحقّاتهم»** — فعلُها إدراجٌ في دفعة الشهر،
 *     وتلك شاشةٌ تبني ملفَّ تحويلات.
 *
 * فالقاعدة ليست «كلُّ شيءٍ هنا»، بل: **لا يُخرَج من الطابور إلّا لعملٍ
 * لا يقع إلّا هناك**.
 *
 * وهذه ألواحٌ تقرأ من الخدمات نفسها التي تقرأ منها صفحاتُها — لا
 * استعلامَ ثانٍ ولا عددٌ ثانٍ.
 */

/** صفوفُ لوحٍ واحد — بطاقةٌ مرفوعة بفواصل، كما في مخطِّط الدفعة. */
const LIST = "divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised";

/** «دفعاتٌ لم تُنسب إلى فاتورة» — تُطلَب فواتيرُها من هنا. */
export async function UnbackedWorkspace({ canApprove }: { canApprove: boolean }) {
  const groups = groupUnbackedBySupplier(await loadUnbackedPayments());
  /* قائمةُ المورّدين لا تُقرأ إلّا حين توجد دفعةٌ بلا جهة تُنسَب إلى أحدهم */
  const hasOrphans = groups.some((g) => !g.supplierId && g.payments.some((p) => !p.bankTransactionId));
  const supplierOptions = hasOrphans && canApprove
    ? await db
        .select({ id: suppliers.id, nameAr: suppliers.nameAr })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(asc(suppliers.nameAr))
    : [];
  if (groups.length === 0) {
    return <Done>لا دفعة بلا مستند — كلّ ما دُفع له مستندُه.</Done>;
  }

  return (
    <ul className={LIST}>
      {groups.map((g) => (
        <li key={g.supplierId ?? "none"} className="px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <Monogram name={g.supplierName} />
            <span className="min-w-0 flex-1">
              {g.supplierSlug ? (
                <Link
                  href={`/suppliers/${g.supplierSlug}`}
                  className="block truncate text-[14px] font-bold hover:text-accent"
                >
                  {g.supplierName}
                </Link>
              ) : (
                <span className="block truncate text-[14px] font-bold">{g.supplierName}</span>
              )}
              <span className="block text-[11px] text-muted">
                {countNoun(g.payments.length, PAYMENT_RECORD)}
                {g.supplierId
                  ? " بلا مستند"
                  : g.payments.some((p) => p.bankTransactionId)
                    ? " لم تُعرَف جهتها — افتح حركتها وحدّد مورّدها"
                    : " لم تُعرَف جهتها"}
              </span>
            </span>
            <span className="shrink-0 text-[14px] font-bold"><Money minor={g.totalMinor} /></span>
          </div>

          {g.supplierId ? (
            <div className="mt-3 flex flex-wrap gap-2 sm:ps-11">
              {/*
                الرسالةُ تُبنى من الوقائع — تواريخُ الدفعات ومبالغُها —
                ومن لا يصدر فواتير يُطلَب منه عقدُ توريد لا فاتورة.
              */}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(buildInvoiceRequest(g))}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("primary", "sm")}
              >
                <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {g.payments.every((p) => !p.issuesInvoices)
                  ? "اطلب عقد التوريد (واتساب)"
                  : "اطلب الفاتورة (واتساب)"}
              </a>
              {g.supplierSlug && <LinkButton href={`/suppliers/${g.supplierSlug}`} size="sm" variant="quiet">ملفّه</LinkButton>}
            </div>
          ) : (
            /*
              دفعةٌ لا جهةَ لها: إن كانت لها حركةُ بنك فُتحت لتُعرَّف
              جهتُها؛ وإن لم تكن فهي دفعةٌ بلا أصل — تُعرَض ولا تُطوى
              (طيُّها يُعيد الفاتورة مستحقّةً بلا سببٍ ظاهر فتُدفَع
              مرّتين)، ويُقال لصاحبها ما يفعل بدل أن يُترَك بلا زرّ.
            */
            <div className="mt-3 flex flex-wrap items-center gap-2 sm:ps-11">
              {g.payments
                .filter((p) => p.bankTransactionId)
                .slice(0, 3)
                .map((p) => (
                  <LinkButton key={p.paymentId} href={`/bank?tx=${p.bankTransactionId}`} size="sm">
                    عرّف جهة حركة <bdi className="nums">{p.paidOn}</bdi>
                  </LinkButton>
                ))}
              {/*
                ولا حركةَ لها ولا مورّد: قُيّدت من إيصالٍ لم يُقرأ مستفيدُه.
                والجوابُ في الإيصال نفسه.
              */}
              {g.payments.filter((p) => !p.bankTransactionId).map((p) => (
                <div key={p.paymentId} className="w-full rounded-lg border border-line-soft bg-sunken/60 p-3">
                  <p className="mb-2 text-[11px] leading-relaxed text-ink-soft">
                    <Money minor={p.unbackedMinor} /> في {formatDay(p.paidOn)} — لا حركةَ بنكٍ لها ولا مورّد.
                    {p.receiptDriveFileId ? " افتح إيصالها لترى لمن حُوّلت." : ""}
                  </p>
                  {canApprove ? (
                    <OrphanPayment
                      paymentId={p.paymentId}
                      suppliers={supplierOptions}
                      receiptUrl={p.receiptDriveFileId ? `https://drive.google.com/file/d/${p.receiptDriveFileId}/view` : null}
                    />
                  ) : (
                    <p className="text-[11px] text-muted">حسمُها لمن يعتمد السداد.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** لوحٌ فرغ — حُسم ما فيه والصفحةُ لم تُحدَّث بعد. */
function Done({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-xs font-bold text-ok">
      <CircleCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      {children}
    </p>
  );
}

/** «مستنداتٌ لم يُبتّ فيها» — تُعتمَد أو تُرفَض من هنا. */
export async function InboxWorkspace({ canUpload, canConfirm }: { canUpload: boolean; canConfirm: boolean }) {
  const all = await loadPendingReview();
  /* ما يُعتمَد الآن، وما تُقيَّد فاتورتُه أوّلاً ثمّ يُحكَم عليه — كلاهما بضغطةٍ واحدة */
  const eligible = all.filter((d) => d.verdict.auto || d.recordable);
  const rows = all.slice(0, 40);

  if (rows.length === 0) {
    return <Done>لا مستند ينتظر — كلُّ ما وصل اعتُمد أو رُفض.</Done>;
  }

  /*
    ── ما المطلوب، ولماذا، وماذا يتغيّر ──

    كانت القائمةُ اسماً ومبلغاً وزرَّين، فيسأل صاحبُ المقهى: لماذا لم
    يدخل وحده؟ وماذا أراجع؟ وما الذي يتغيّر إن أكّدت؟ فيُعرَض ما قرأه
    النموذج حقلاً حقلاً ليُقارَن بالورقة، وما نقص بعينه تحته. والقاعدةُ
    العامّة خلف «متى يدخل المستند وحده؟» — تُقرأ مرّةً لا في كلّ زيارة.
  */
  return (
    <div className="space-y-3">
      {/*
        ما انتظر قبل أن توجد قاعدةُ الأرشفة الآليّة وتجتمع فيه شروطُها —
        يُعتمَد دفعةً بضغطة، والخادمُ يعيد الحكمَ على كلٍّ منها.
      */}
      {eligible.length > 0 && canConfirm && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-relaxed">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-hidden />
            <span>
              <strong>{countNoun(eligible.length, DOCUMENT)} يُحسَم الآن بلا مراجعة</strong> — تجتمع فيها الشروط، أو
              قراءتُها كاملة وفاتورتُها لم تُقيَّد. الضغطُ يقيّد الفواتير ويعتمدها ويسمّي ملفّاتها، ويبقى ما لا
              يستقيم بعد القيد بسببه.
            </span>
          </p>
          <ConfirmEligible count={eligible.length} />
        </div>
      )}
      <details className="group rounded-xl border border-line-soft bg-sunken/60">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-xs font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
          <CircleHelp className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
          متى يدخل المستندُ وحده، وماذا يتغيّر إن اعتمدته؟
          <ChevronDown className="ms-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" strokeWidth={2} aria-hidden />
        </summary>
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-ink-soft">
          يدخل المستندُ وحده إذا عُرف <strong>مورّدُه</strong>، وقُيّدت له <strong>فاتورة</strong> (رقمٌ وتاريخٌ وإجماليّ)،
          و<strong>استقام حسابُه</strong>، وكانت <strong>قراءتُه موثوقة</strong> (نصٌّ مكتوب، أو صورةٌ ضريبتُها ١٥٪ من صافيها
          أو رقمُها في اسم الملفّ). وما لم يجتمع فيه ذلك يُكتَب تحته ما نقص بعينه.{" "}
          <strong>المطلوب:</strong> أصلح الناقص أو قارن بالورقة ثمّ اعتمد — فتدخل الفاتورةُ دفعةَ الشهر، ويُخصم منها
          ما دفعتَه للمورّد مقدَّماً، ويُسمّى ملفُّها. وإن كان المستندُ خطأً فارفضه.
        </p>
      </details>
      <ul className={LIST}>
        {rows.map((d) => {
          /* الشرحُ من الدالّة التي قرّرت — فلا يفترق القرارُ عن تفسيره */
          const { gaps } = d.verdict;
          return (
            <li key={d.id} className="px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                    <FileText className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold">
                      {d.supplierName ?? "مورّدٌ لم يُعرَف"}
                    </span>
                    <span className="block truncate text-[11px] text-muted" dir="ltr">{d.fileName}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {/*
                    «افتحه» قبل «أكّده» عمداً: التأكيدُ شهادةٌ بأنّ ما قرأه
                    النموذج يطابق الورقة، ولا تُعطى شهادةٌ بلا نظر.
                  */}
                  {d.driveFileId && (
                    <a
                      href={`https://drive.google.com/file/d/${d.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass("quiet", "sm")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      افتح المستند
                    </a>
                  )}
                  {canUpload && <ConfirmDocument documentId={d.id} />}
                  {canUpload && <RejectDocument documentId={d.id} />}
                </span>
              </div>
              <div className="sm:ps-11">
                {d.recordable ? (
                  <Note tone="ok">قراءتُه كاملة — يُقيَّد ويُحسَم تلقائياً الآن، أو بالضغط أعلاه.</Note>
                ) : d.invoiceId === null && d.statementId === null ? (
                  <div className="mt-2 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn">
                    <p className="font-bold">لم يُقيَّد — ينقصه:</p>
                    <ul className="list-inside list-disc">
                      {(d.missing.length > 0 ? d.missing : ["ليس فاتورةً ولا كشفاً — إيصالٌ أو نوعٌ يُحسَم بيد"]).map((m) => <li key={m}>{m}</li>)}
                    </ul>
                    <p className="text-ink-soft">ارفضه وارفعه من صفحة الرفع لتكتب الناقص بيدك.</p>
                  </div>
                ) : d.statementId !== null ? (
                  <Note>كشفُ حسابٍ مقيَّد — لا يُسأل عن رقم فاتورة.</Note>
                ) : (
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-sunken/60 px-3 py-2.5 sm:grid-cols-5">
                    <ReadField label="رقم الفاتورة" value={<bdi className="nums">{d.invoiceNumber}</bdi>} />
                    <ReadField label="التاريخ" value={d.invoiceDate ? <bdi className="nums">{formatDay(d.invoiceDate)}</bdi> : "غير معروف"} />
                    <ReadField label="قبل الضريبة" value={d.subtotalMinor === null ? "غير معروف" : <Money minor={d.subtotalMinor} />} />
                    <ReadField label="الضريبة" value={d.vatMinor === null ? "غير معروف" : <Money minor={d.vatMinor} />} />
                    <ReadField label="الإجمالي" value={d.totalMinor === null ? "غير معروف" : <Money minor={d.totalMinor} />} />
                  </dl>
                )}
                {(d.invoiceId !== null || d.statementId !== null) && gaps.length === 0 && (
                  <Note tone="ok">تجتمع فيه الشروط — يُعتمَد تلقائياً.</Note>
                )}
                {(d.invoiceId !== null || d.statementId !== null) && gaps.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-warn">
                    {gaps.filter((g) => g !== "NOT_RECORDED").map((g) => (
                      <li key={g} className="flex items-start gap-1.5">
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
                        لم يدخل وحده: {GAP_TEXT[g]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {all.length > rows.length && (
        <p className="text-[11px] text-muted">
          يُعرض أوّلُ {rows.length} — وبقي <span className="nums">{all.length - rows.length}</span> يظهر حين يُحسم ما هنا.
        </p>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone?: "ok"; children: React.ReactNode }) {
  return (
    <p className={`mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed ${tone === "ok" ? "text-ok" : "text-muted"}`}>
      {tone === "ok" && <CircleCheck className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />}
      {children}
    </p>
  );
}

function ReadField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate text-xs font-bold">{value}</dd>
    </div>
  );
}

/** «مورّدون لا يصدرون فواتير وبلا عقد» — تُعلَن سياستُهم من هنا. */
export async function ContractPolicyWorkspace({ canEdit }: { canEdit: boolean }) {
  const rows = await db
    .select({
      id: suppliers.id,
      slug: suppliers.slug,
      nameAr: suppliers.nameAr,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
      contractRequired: suppliers.contractRequired,
      paperInvoices: suppliers.paperInvoices,
    })
    .from(suppliers)
    .where(and(eq(suppliers.isActive, true), eq(suppliers.issuesInvoices, false)))
    .orderBy(asc(suppliers.nameAr));

  const need = rows.filter(needsContract);
  if (need.length === 0) {
    return <Done>لا مورّد بلا مستندٍ مطلوب — كلٌّ أُعلنت سياستُه.</Done>;
  }

  return (
    <ul className={LIST}>
      {need.map((r) => (
        <li key={r.id} className="px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <Monogram name={r.nameAr} />
            <span className="min-w-0 flex-1">
              <Link href={`/suppliers/${r.slug}`} className="block truncate text-[14px] font-bold hover:text-accent">
                {r.nameAr}
              </Link>
              <span className="block text-[11px] text-muted">لا يصدر فواتير ضريبية، ولا عقدَ عندنا</span>
            </span>
          </div>
          {/*
            ثلاثةُ أجوبةٍ صحيحة لا جوابٌ واحد: وقّع عقداً، أو أعلِن
            أنّه لا يُطلَب منه عقد، أو أنّ فواتيره ورقيّةٌ تُرفَع.
            والتنبيهُ الذي لا يُسكَت ولا يُفعَل فيه شيء يُعلّم صاحبَه
            تجاهلَ ما عداه — فالإعلانُ هنا بيد الإنسان لا يُشتقّ.
          */}
          <div className="mt-3 sm:ps-11">
            {canEdit ? (
              <SupplierPolicy
                supplierId={r.id}
                canEdit={canEdit}
                initial={{
                  issuesInvoices: r.issuesInvoices,
                  paperInvoices: r.paperInvoices,
                  contractRequired: r.contractRequired,
                  contractOnFile: r.contractOnFile,
                }}
              />
            ) : (
              <p className="text-[11px] text-muted">تعديل سياسة المورّد خارج صلاحيتك.</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** «مورّدون لم يصل كشفهم» — يُطلَب الكشف من هنا. */
export async function StatementRequestWorkspace({ canEdit = false }: { canEdit?: boolean }) {
  const month = previousMonth(currentMonthRiyadh());
  const rows = await loadMissingStatementSuppliers(month);

  if (rows.length === 0) {
    return <Done>وصل كشفُ كلّ مورّدٍ له تعامل.</Done>;
  }

  return (
    <ul className={LIST}>
      {rows.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-5">
          <Monogram name={m.nameAr} />
          <span className="min-w-0 flex-1">
            <Link href={`/suppliers/${m.slug}`} className="block truncate text-[13px] font-bold hover:text-accent">
              {m.nameAr}
            </Link>
            <span className="block text-[11px] text-muted">
              آخر فاتورة{" "}
              {m.lastInvoiceDate ? <bdi className="nums">{formatDay(m.lastInvoiceDate)}</bdi> : "غير معروف"}
            </span>
          </span>
          <span className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(buildStatementRequest(m.nameAr, month))}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary", "sm")}
            >
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              اطلب الكشف (واتساب)
            </a>
            {/* «كشوف الحساب مو كلّهم يصدرونها» — يُعلَن فيخرج من القائمة */}
            {canEdit && <NoStatementsButton supplierId={m.id} />}
          </span>
        </li>
      ))}
    </ul>
  );
}
