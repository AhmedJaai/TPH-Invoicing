import { Fragment } from "react";
import { redirect } from "next/navigation";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PrintButton } from "@/components/print-button";
import { LinkButton, NoAccess } from "@/components/ui";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { OPEX_SOURCE_LABEL } from "@/lib/finance/pnl";
import { formatShare } from "@/lib/finance/format";
import { formatDay, formatMoment, formatMonth, monthEndDay } from "@/lib/riyadh-time";
import { INVOICE, PRODUCT, countNoun } from "@/lib/arabic";
import { loadPnl, loadPurchaseInvoices, visibleOpexRows } from "@/services/profit.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * تقريرُ الشهر للمحاسب — ورقةٌ تُطبَع أو تُحفَظ PDF: قائمةُ الدخل بما تشمله وما ينقصها،
 * ثمّ ما كوّن كلَّ رقم. الأرقامُ من `loadPnl` نفسِها. ودفاترُ الشهر (الفواتير، الدفعات،
 * حركات البنك) في «حزمة المحاسب» بملفّ Excel.
 */
export default async function FinanceReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="تقرير الشهر"><NoAccess what="تقرير الشهر" /></PageShell>;
  }
  const q = await searchParams;
  if (!q.month || !MONTH_RE.test(q.month)) redirect("/finance");
  const month = q.month;
  const [view, invoices] = await Promise.all([loadPnl(month), loadPurchaseInvoices(`${month}-01`, monthEndDay(month))]);
  /* الرواتبُ سطراً واحداً لمن لا يملك `payroll:view` */
  const opexShown = visibleOpexRows(view.opexRows, user.role);
  const p = view.pnl;
  const c = view.input.cogs;
  const th = "border-b border-line-strong px-2 py-1.5 text-start text-[11px] font-bold";
  const td = "border-b border-line-soft px-2 py-1.5 text-[12px]";

  return (
    <PageShell
      user={user}
      title={`تقرير ${formatMonth(month)}`}
      eyebrow="مؤسسة ذا بوبليك هاوس · الرقم الضريبي 310007971600003"
      intro={view.frozenAt ? `شهر مقفل، والتقرير مجمَّد في ${formatMoment(new Date(view.frozenAt))}.` : view.closed ? "شهر مقفل، ولم يُجمَّد تقريره بعد." : "شهر مفتوح، وتتغيّر أرقامه بما يُسجَّل فيه."}
      actions={
        <span className="no-print flex flex-wrap items-center gap-2">
          <LinkButton href={`/finance?month=${month}`} variant="quiet" size="sm" icon={ArrowRight}>قائمة الدخل</LinkButton>
          <LinkButton href={`/close/pack?month=${month}`} variant="secondary" icon={FileSpreadsheet}>حزمة المحاسب (Excel)</LinkButton>
          <PrintButton />
        </span>
      }
    >
      <section aria-label="قائمة الدخل">
        <h2 className="mb-2 text-sm font-bold">قائمة الدخل</h2>
        <table className="w-full border-collapse">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id} className={l.kind === "total" ? "font-bold" : l.kind === "memo" ? "text-ink-soft" : ""}>
                <td className={`${td} ${l.kind === "sub" ? "ps-6" : ""}`}>
                  {l.label}
                  {l.note && <span className="block text-[10px] font-normal text-muted">{l.note}</span>}
                </td>
                <td className={`${td} w-40 text-end`}>
                  {l.amountMinor === null ? "غير معروف" : <Money minor={l.negative ? -l.amountMinor : l.amountMinor} signed={l.id === "profit"} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-ink-soft">
          <T s="هامش مجمل الربح {0} · هامش «{1}» {2}." a={[formatShare(p.grossMarginBp), p.profitLabel, formatShare(p.netMarginBp)]} /></p>
      </section>

      <section aria-label="ما يشمله وما ينقصه" className="mt-6">
        <h2 className="mb-2 text-sm font-bold">ما يشمله هذا الرقم وما ينقصه</h2>
        <ul className="list-disc space-y-1 ps-5 text-[12px] leading-relaxed">
          <li><T s="الإيراد: ما دفعه الزبائن في فودكس (نقداً وبالبطاقة) بعد المرتجعات {0}، مطروحاً منه ضريبة المبيعات {1}. ومشروبات الموظفين («House Account») ليست إيراداً." a={[<Money key="0" minor={view.revenue?.paidMinor ?? 0} />, <Money key="1" minor={view.revenue?.vatMinor ?? 0} />]} /></li>
          <li>
            <T s="تكلفة المبيعات: {0}" a={[p.cogsMethod === "STOCK" && c.stock
              ? <Fragment key="0"><T s="بالجرد: مشتريات الشهر + مخزون عُدّ في {0} ({1}) − مخزون عُدّ في {2} ({3})، والمعدود {4}، مقيَّماً بآخر تكلفة معروفة." a={[<bdi key="0">{formatDay(c.stock.openingDay)}</bdi>, <Money key="1" minor={c.stock.openingValueMinor} />, <bdi key="2">{formatDay(c.stock.closingDay)}</bdi>, <Money key="3" minor={c.stock.closingValueMinor} />, countNoun(c.stock.countedItems, PRODUCT)]} /></Fragment>
              : <Fragment key="0"><T s="مشتريات الشهر ({0})، وهي ليست تكلفة ما بيع." a={[c.stockMissing ?? "لا يوجد جرد"]} /></Fragment>]} /></li>
          <li>المصروفات: ما سُجّل من كشف البنك بتصنيفه، وما أضافه المالك مما لا يظهر في الكشف. سداد المورّدين محسوب في المشتريات لا هنا، وضريبة الرسوم وسداد الهيئة ليسا مصروفاً.</li>
          {p.gaps.length === 0
            ? <li className="font-bold">لا ينقصه عنصر أساسي.</li>
            : p.gaps.map((g) => <li key={g.id} className="font-bold"><T s="ينقصه: {0}." a={[g.label]} /></li>)}
        </ul>
      </section>

      <section aria-label="المصروفات" className="mt-6">
        <h2 className="mb-2 text-sm font-bold">المصروفات التشغيلية بالتفصيل</h2>
        {opexShown.length === 0 ? <p className="text-[12px] text-muted">لا توجد مصروفات مسجّلة لهذا الشهر.</p> : (
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>الوصف</th><th className={th}>التصنيف</th><th className={th}>المصدر</th><th className={`${th} text-end`}>المبلغ</th></tr></thead>
            <tbody>
              {opexShown.filter((r) => r.category !== "POS_FEE" && r.category !== "BANK_FEE").map((r) => (
                <tr key={r.id}>
                  <td className={td}>{r.label}{r.occurredOn && <span className="ms-2 text-[10px] text-muted"><bdi>{formatDay(r.occurredOn)}</bdi></span>}</td>
                  <td className={td}>{CATEGORY_LABEL[r.category]}</td>
                  <td className={td}>{OPEX_SOURCE_LABEL[r.source]}</td>
                  <td className={`${td} text-end`}><Money minor={r.amountMinor} /></td>
                </tr>
              ))}
              {p.opexByCategory.filter((o) => o.category === "POS_FEE" || o.category === "BANK_FEE").map((o) => (
                <tr key={o.category}>
                  <td className={td}><T s="{0} (مجموع حركاتها الصغيرة)" a={[o.label]} /></td>
                  <td className={td}>{o.label}</td>
                  <td className={td}>{OPEX_SOURCE_LABEL.BANK}</td>
                  <td className={`${td} text-end`}><Money minor={o.amountMinor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="المشتريات" className="mt-6">
        <h2 className="mb-2 text-sm font-bold"><T s="مشتريات الشهر: {0}" a={[countNoun(invoices.length, INVOICE)]} /></h2>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>المورّد</th><th className={th}>الفاتورة</th><th className={th}>تاريخ الاستلام</th><th className={`${th} text-end`}>بدون ضريبة</th></tr></thead>
          <tbody>
            {invoices.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.supplierName}</td>
                <td className={td}><bdi dir="ltr">{r.invoiceNumber}</bdi></td>
                <td className={td}><bdi>{formatDay(r.day)}</bdi></td>
                <td className={`${td} text-end`}><Money minor={r.netMinor} />{r.grossOnly ? " *" : ""}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={td} colSpan={3}>المجموع</td>
              <td className={`${td} text-end`}><Money minor={invoices.reduce((s, r) => s + r.netMinor, 0)} /></td>
            </tr>
          </tbody>
        </table>
        {invoices.some((r) => r.grossOnly) && <p className="mt-1 text-[10px] text-muted">* لم يُقرأ صافيها ولا ضريبتها، فدخلت بإجماليها.</p>}
      </section>
    </PageShell>
  );
}
