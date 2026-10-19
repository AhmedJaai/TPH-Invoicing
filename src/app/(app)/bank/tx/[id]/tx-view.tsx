import { BankBounce } from "@/components/bank-bounce";
import { findBouncePartner } from "@/services/bank-bounce.service";
import { db } from "@/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Landmark, Receipt } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DetailFrame, type DetailMode } from "@/components/detail-frame";
import { Money } from "@/components/money";
import { EmptyState, KeyValue, LinkButton, Monogram, NoAccess, Section } from "@/components/ui";
import { CategoryBadge, DirectionIcon } from "@/components/bank-bits";
import { MatchExplain } from "@/components/match-explain";
import { AccountReview } from "@/components/account-review";
import { loadHandPaymentLinks } from "@/services/account-review.service";
import { loadFocusedTx, loadTxAllocations } from "@/services/bank-view.service";
import { invoiceHref } from "@/lib/invoice-profile";
import { txHref } from "@/lib/inspector";
import { formatDay } from "@/lib/riyadh-time";
import { T } from "@/components/i18n/t";

/**
 * ملفُّ حركة البنك — ما هي، ولماذا طُوبقت، وماذا سدّدت، وكيف يُتراجع عنها.
 *
 * كانت الحركةُ تُفتح بـ`/bank?tx=` فتُبنى صفحةُ البنك كلُّها (نحو أربع
 * ثوانٍ) لتُعرض بطاقةٌ في رأسها، وصفوفُ السجلّ لا تفتح شيئاً. فصار لها
 * ملفٌّ يُفتح لوحاً فوق السجلّ من أيّ صفٍّ فيه ومن كلّ ما يشير إليها.
 */
export async function TxView({ params, mode }: { params: Promise<{ id: string }>; mode: DetailMode }) {
  const { id } = await params;
  const fullHref = txHref(id);
  const user = await currentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(fullHref)}`);
  if (!can(user.role, "bank:view")) {
    return (
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="حركة بنكية">
        <NoAccess what="كشف البنك" />
      </DetailFrame>
    );
  }

  const tx = await loadFocusedTx(id);
  if (!tx) {
    return (
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="الحركة غير موجودة">
        <EmptyState
          icon={CircleAlert}
          title="هذه الحركة غير موجودة."
          hint="ربما دُمجت مع نسخة مكررة منها أثناء تنظيف التكرار، وستجد ذلك في سجل التدقيق."
          action={<LinkButton href="/bank" variant="primary">سجل الحركات</LinkButton>}
        />
      </DetailFrame>
    );
  }

  const canUndo = can(user.role, "payment:approve");
  /* التخصيصاتُ وربطُ اليد وشريكُ الارتداد لا يعتمد أحدُها على الآخر — تُطلَب معاً */
  const [allocations, handLinks, bounce] = await Promise.all([
    tx.paymentId && can(user.role, "amounts:view") ? loadTxAllocations(tx.paymentId) : Promise.resolve([]),
    /*
      حوالةٌ لم تُربط وسدادُها مقيَّدٌ بيد — «لا فاتورة مفتوحة» صحيحٌ حرفاً، فيُقال لماذا.
      والأزواجُ تُشتقّ كلُّها ثمّ يُؤخذ زوجُ هذه الحوالة: الاشتقاقُ توزيعٌ بين الحوالات،
      فزوجُ الواحدة لا يُعرَف بمعزلٍ عن غيرها.
    */
    !tx.paymentId && canUndo ? loadHandPaymentLinks() : Promise.resolve([]),
    canUndo ? findBouncePartner(db, id) : Promise.resolve(null),
  ]);
  const allocated = allocations.reduce((s, a) => s + a.amountMinor, 0);
  const handLink = handLinks.find((l) => l.transferId === id) ?? null;
  const title = tx.who || tx.description?.trim().slice(0, 60) || "حركة بلا وصف";

  return (
    <DetailFrame
      mode={mode}
      fullHref={fullHref}
      user={user}
      width="page"
      title={title}
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <Landmark className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {tx.direction === "DEBIT" ? "خارج من حسابك" : "داخل إلى حسابك"} · <bdi>{formatDay(tx.valueDate)}</bdi>
        </span>
      }
    >
      <section aria-label="المبلغ" className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-raised p-5 shadow-raised">
        <DirectionIcon direction={tx.direction} large />
        <p className={`text-[2rem] font-bold leading-none tracking-tight ${tx.direction === "CREDIT" ? "text-ok" : ""}`}>
          <span dir="ltr" className="inline-flex">{tx.direction === "CREDIT" ? "+" : "−"}<Money minor={tx.amountMinor} /></span>{" "}
          <span className="text-xs font-bold text-muted">ر.س</span>
        </p>
        <span className="ms-auto"><CategoryBadge category={tx.category} /></span>
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-5">
          <KeyValue
            items={[
              { label: "التاريخ", value: <bdi>{formatDay(tx.valueDate)}</bdi> },
              { label: "الاتجاه", value: tx.direction === "DEBIT" ? "خارج" : "داخل" },
              { label: "التصنيف", value: <CategoryBadge category={tx.category} /> },
              { label: "نوع العملية", value: tx.transactionType ?? <span className="text-muted">غير معروف</span> },
            ]}
          />
          <div>
            <p className="text-[11px] font-medium text-muted">نص البنك كما ورد</p>
            <p className="mt-1 break-words rounded-lg bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft" dir="auto">
              {tx.description ?? "—"}
            </p>
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold text-muted">لماذا طوبقت، وكيف تتراجع عن المطابقة</p>
          <MatchExplain match={tx.match} canUndo={canUndo} inline />
          {bounce && <BankBounce pair={bounce} currentId={id} />}
          {handLink && (
            <div className="mt-3 rounded-xl border border-accent-line bg-accent-soft/50 p-3 text-xs leading-relaxed">
              <p className="font-bold">سبق أن سجّلت سدادها يدوياً</p>
              <p className="mt-1 text-ink-soft">
                <T s="في {0} سجّلت دفعة لـ{1} بمبلغ {2}{3}، فأُغلقت فاتورته، ولذلك لم يجد النظام فاتورة مفتوحة يطابقها. هذه الحوالة هي ذلك السداد نفسه{4}" a={[formatDay(handLink.paymentDay), handLink.supplierName, <Money key="2" minor={handLink.paymentMinor} />, handLink.invoices.length > 0 && <> <T s=" عن {0}" a={[handLink.invoices.map((i) => i.number).join("، ")]} /></>, handLink.exact ? "." : <><T s="، وهي أكبر منه بـ{0} (هل أُضيف رسم توصيل إلى الفاتورة؟ صحّح إجماليها)." a={[<Money key="0" minor={handLink.extraMinor} />]} /></>]} /></p>
              <div className="mt-2 flex flex-wrap gap-2">
                <AccountReview size="sm" variant="primary" />
                {!handLink.exact && handLink.invoices[0] && (
                  <LinkButton href={`/purchases/invoices/${handLink.invoices[0].id}?act=fix#fix`} size="sm"><T s="صحّح إجمالي {0}" a={[handLink.invoices[0].number]} /></LinkButton>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {allocations.length > 0 && (
        <Section
          title="ما سدّدته"
          icon={Receipt}
          count={allocations.length}
          hint={allocated < tx.amountMinor ? "المتبقي منها رصيد لك عند المورّد، يُخصم من فواتيره القادمة." : undefined}
          className="mt-8"
        >
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
            {allocations.map((a) => (
              <li key={a.invoiceId} data-href={invoiceHref(a.invoiceId)}>
                <Link
                  href={invoiceHref(a.invoiceId)}
                  scroll={false}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-hover"
                >
                  <Monogram name={a.supplierName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{a.supplierName}</span>
                    <span className="block text-[11px] text-muted">
                      <T s="فاتورة {0} · {1}" a={[<bdi key="0" className="nums">{a.invoiceNumber}</bdi>, <bdi key="1">{formatDay(a.invoiceDate)}</bdi>]} /></span>
                  </span>
                  <span className="shrink-0 text-[13px] font-bold"><Money minor={a.amountMinor} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </DetailFrame>
  );
}
