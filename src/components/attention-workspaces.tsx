import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { Money } from "@/components/money";
import { Card, LinkButton, buttonClass } from "./ui";
import { ConfirmDocument } from "./confirm-document";
import { ConfirmEligible } from "./confirm-eligible";
import { RejectDocument } from "./reject-document";
import { SupplierPolicy } from "./supplier-policy";
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

/** «دفعاتٌ لم تُنسب إلى فاتورة» — تُطلَب فواتيرُها من هنا. */
export async function UnbackedWorkspace() {
  const groups = groupUnbackedBySupplier(await loadUnbackedPayments());
  if (groups.length === 0) {
    return <p className="text-xs text-ok">لا دفعة بلا مستند — كلّ ما دُفع له مستندُه.</p>;
  }

  return (
    <ul className="grid gap-2.5 xl:grid-cols-2">
      {groups.map((g) => (
        <li key={g.supplierId ?? "none"}>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                {g.supplierSlug ? (
                  <Link
                    href={`/suppliers/${g.supplierSlug}`}
                    className="block text-sm font-bold underline-offset-4 hover:underline"
                  >
                    {g.supplierName}
                  </Link>
                ) : (
                  <span className="block text-sm font-bold">{g.supplierName}</span>
                )}
                <span className="block text-[11px] text-muted">
                  {countNoun(g.payments.length, PAYMENT_RECORD)}
                  {g.supplierId ? " بلا مستند" : " لم تُعرَف جهتها — افتح حركتها وحدّد مورّدها"}
                </span>
              </span>
              <span className="nums-col shrink-0 text-sm font-bold text-warn">
                <Money minor={g.totalMinor} />
              </span>
            </div>

            {g.supplierId ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
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
                  {g.payments.every((p) => !p.issuesInvoices)
                    ? "اطلب عقد التوريد (واتساب)"
                    : "اطلب الفاتورة (واتساب)"}
                </a>
                {g.supplierSlug && <LinkButton href={`/suppliers/${g.supplierSlug}`} size="sm">ملفّه</LinkButton>}
              </div>
            ) : (
              /*
                دفعةٌ لا جهةَ لها: إن كانت لها حركةُ بنك فُتحت لتُعرَّف
                جهتُها؛ وإن لم تكن فهي دفعةٌ بلا أصل — تُعرَض ولا تُطوى
                (طيُّها يُعيد الفاتورة مستحقّةً بلا سببٍ ظاهر فتُدفَع
                مرّتين)، ويُقال لصاحبها ما يفعل بدل أن يُترَك بلا زرّ.
              */
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {g.payments.some((p) => p.bankTransactionId) ? (
                  g.payments
                    .filter((p) => p.bankTransactionId)
                    .slice(0, 3)
                    .map((p) => (
                      <LinkButton key={p.paymentId} href={`/bank?tx=${p.bankTransactionId}`} size="sm">
                        عرّف جهة حركة <bdi className="nums">{p.paidOn}</bdi>
                      </LinkButton>
                    ))
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted">
                    لا حركةَ بنكٍ لهذه الدفعة ولا مورّد — قُيّدت بيد، أو بقيت من دمجٍ قديم.
                    راجِعها في{" "}
                    <Link href="/settings/audit" className="underline underline-offset-4 hover:text-ink">
                      سجلّ التدقيق
                    </Link>{" "}
                    لتعرف من قيّدها ومتى.
                  </p>
                )}
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** «مستنداتٌ لم يُبتّ فيها» — تُعتمَد أو تُرفَض من هنا. */
export async function InboxWorkspace({ canUpload, canConfirm }: { canUpload: boolean; canConfirm: boolean }) {
  const all = await loadPendingReview();
  const eligible = all.filter((d) => d.verdict.auto);
  const rows = all.slice(0, 40);

  if (rows.length === 0) {
    return <p className="text-xs text-ok">لا مستند ينتظر — كلُّ ما وصل اعتُمد أو رُفض.</p>;
  }

  /*
    ── ما المطلوب، ولماذا، وماذا يتغيّر ──

    كانت القائمةُ اسماً ومبلغاً وزرَّين، فيسأل صاحبُ المقهى: لماذا لم
    يدخل وحده؟ وماذا أراجع؟ وما الذي يتغيّر إن أكّدت؟ والجوابُ كان في
    تعليقات الشيفرة لا على الشاشة. فيُعرَض ما قرأه النموذج حقلاً حقلاً
    ليُقارَن بالورقة، ويُقال من أين قُرئ (نصٌّ مكتوب أم صورة)، وأيطابق
    الرقمُ الضريبيّ المورّدَ المسجَّل — ثمّ ما يقع بعد التأكيد.
  */
  return (
    <div className="space-y-3">
      {/*
        ما انتظر قبل أن توجد قاعدةُ الأرشفة الآليّة وتجتمع فيه شروطُها —
        يُعتمَد دفعةً بضغطة، والخادمُ يعيد الحكمَ على كلٍّ منها.
      */}
      {eligible.length > 0 && canConfirm && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/40 bg-ok-bg px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-relaxed">
            <strong>{countNoun(eligible.length, DOCUMENT)} تجتمع فيها الشروطُ الأربعة</strong> — كانت تنتظر قبل أن
            يدخل مثلُها وحده. اعتمادُها يُدخل فواتيرَها دفعةَ الشهر ويسمّي ملفّاتها.
          </p>
          <ConfirmEligible count={eligible.length} />
        </div>
      )}
      <p className="rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        يدخل المستندُ وحده إذا اجتمعت فيه أربعة: قُرئ من <strong>نصٍّ مكتوب</strong> لا من صورة،
        و<strong>رقمُه الضريبيّ</strong> يطابق المورّد، و<strong>حسابُه مستقيم</strong>، و<strong>مورّدُه معروف</strong>.
        وما لم تجتمع فيه يُكتَب تحته ما نقصه. <strong>المطلوب:</strong> افتح المستند وقارن الأرقام
        بالورقة؛ إن طابقت فاعتمده — فتدخل فاتورتُه دفعةَ الشهر، ويُخصم منها ما دفعتَه للمورّد مقدَّماً،
        ويُسمّى ملفُّه على الصيغة. وإن اختلف شيءٌ فارفضه وارفعه من صفحة الرفع لتصحّح الحقل.
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
        {rows.map((d) => {
          /* الشرحُ من الدالّة التي قرّرت — فلا يفترق القرارُ عن تفسيره */
          const { gaps } = d.verdict;
          return (
            <li key={d.id} className="px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">
                    {d.supplierName ?? "مورّدٌ لم يُعرَف"}
                  </span>
                  <span className="block truncate text-[11px] text-muted" dir="ltr">{d.fileName}</span>
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
                      افتح المستند
                    </a>
                  )}
                  {canUpload && <ConfirmDocument documentId={d.id} />}
                  {canUpload && <RejectDocument documentId={d.id} />}
                </span>
              </div>
              {d.invoiceNumber === null ? (
                <p className="mt-2 text-[11px] leading-relaxed text-warn">
                  لم تُقيَّد له فاتورة — القراءةُ لم تكفِ لقيدها (مورّدٌ أو مبلغٌ أو تاريخٌ لم يُعرَف).
                  ارفضه وارفعه من صفحة الرفع لتكمل ما نقص.
                </p>
              ) : (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                  <ReadField label="رقم الفاتورة" value={<bdi className="nums">{d.invoiceNumber}</bdi>} />
                  <ReadField label="التاريخ" value={d.invoiceDate ? <bdi className="nums">{formatDay(d.invoiceDate)}</bdi> : "غير معروف"} />
                  <ReadField label="قبل الضريبة" value={d.subtotalMinor === null ? "غير معروف" : <Money minor={d.subtotalMinor} />} />
                  <ReadField label="الضريبة" value={d.vatMinor === null ? "غير معروف" : <Money minor={d.vatMinor} />} />
                  <ReadField label="الإجمالي" value={d.totalMinor === null ? "غير معروف" : <Money minor={d.totalMinor} />} />
                </dl>
              )}
              {gaps.length === 0 && (
                <p className="mt-2 text-[11px] text-ok">تجتمع فيه الشروطُ الأربعة — يُعتمَد مع ما فوقه بضغطةٍ واحدة.</p>
              )}
              {gaps.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11px] text-warn">
                  {gaps.filter((g) => g !== "NOT_RECORDED").map((g) => (
                    <li key={g}>لم يدخل وحده: {GAP_TEXT[g]}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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
    return <p className="text-xs text-ok">لا مورّد بلا مستندٍ مطلوب — كلٌّ أُعلنت سياستُه.</p>;
  }

  return (
    <ul className="space-y-2.5">
      {need.map((r) => (
        <li key={r.id}>
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/suppliers/${r.slug}`}
                className="text-sm font-bold underline-offset-4 hover:underline"
              >
                {r.nameAr}
              </Link>
              <span className="text-[11px] text-muted">لا يصدر فواتير ضريبية، ولا عقدَ عندنا</span>
            </div>
            {/*
              ثلاثةُ أجوبةٍ صحيحة لا جوابٌ واحد: وقّع عقداً، أو أعلِن
              أنّه لا يُطلَب منه عقد، أو أنّ فواتيره ورقيّةٌ تُرفَع.
              والتنبيهُ الذي لا يُسكَت ولا يُفعَل فيه شيء يُعلّم صاحبَه
              تجاهلَ ما عداه — فالإعلانُ هنا بيد الإنسان لا يُشتقّ.
            */}
            <div className="mt-3">
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
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** «مورّدون لم يصل كشفهم» — يُطلَب الكشف من هنا. */
export async function StatementRequestWorkspace() {
  const month = previousMonth(currentMonthRiyadh());
  const rows = await loadMissingStatementSuppliers(month);

  if (rows.length === 0) {
    return <p className="text-xs text-ok">وصل كشفُ كلّ مورّدٍ له تعامل.</p>;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((m) => (
        <li
          key={m.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3.5 py-2.5"
        >
          <span className="min-w-0">
            <Link
              href={`/suppliers/${m.slug}`}
              className="block truncate text-xs font-bold underline-offset-4 hover:underline"
            >
              {m.nameAr}
            </Link>
            <span className="block text-[11px] text-muted">
              آخر فاتورة <bdi className="nums">{m.lastInvoiceDate ? formatDay(m.lastInvoiceDate) : "—"}</bdi>
            </span>
          </span>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(buildStatementRequest(m.nameAr, month))}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("primary", "sm")}
          >
            اطلب الكشف (واتساب)
          </a>
        </li>
      ))}
    </ul>
  );
}
