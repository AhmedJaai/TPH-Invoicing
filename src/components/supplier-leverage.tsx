import Link from "next/link";
import { Handshake } from "lucide-react";
import { Money } from "./money";
import { DAY, INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { MIN_PAY_SAMPLE } from "@/lib/supplier-leverage";
import { shareText } from "@/lib/vat-compare";
import { LEVERAGE_MONTHS, loadSupplierLeverage } from "@/services/supplier-leverage.service";
import { T } from "@/components/i18n/t";

/**
 * «للتفاوض» — سطران تحت أرقام «المورّدون»: كم يوماً تدفع بعد الفاتورة، ومن يحمل
 * مشترياتِك. لكلٍّ وجهتُه، وما قلّت عيّنتُه يُقال «غير معروف».
 */
export async function SupplierLeverage() {
  const { pay, spend } = await loadSupplierLeverage();
  if (pay.sampleCount === 0 && spend === null) return null;
  return (
    <div className="mt-3 rounded-xl border border-line bg-raised px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-bold">
        <T s="{0}للتفاوض: آخر {1} شهراً" a={[<Handshake key="0" className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden />, LEVERAGE_MONTHS]} /></p>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
        <li>
          {pay.weightedDays === null ? (
            <><T s="متوسط أيام السداد {0}. يحتاج حسابه إلى {1} فواتير مسدّدة بدفعة معروفة التاريخ، والمتوفر {2}." a={[<span key="0" className="font-bold text-muted">غير معروف</span>, MIN_PAY_SAMPLE, pay.sampleCount]} /></>
          ) : (
            <>
              <T s="تدفع في المتوسط بعد {0} من تاريخ الفاتورة، مرجّحاً بالمبلغ ({1} مسدّدة). {2}." a={[<span key="0" className="font-bold text-ink">{pay.weightedDays === 0 ? "صفر أيام" : countNoun(pay.weightedDays, DAY)}</span>, countNoun(pay.sampleCount, INVOICE), <Link key="2" href="/suppliers?view=owed" className="font-bold text-accent hover:underline">المورّدون الذين لهم مستحقات عليك الآن</Link>]} /></>
          )}
        </li>
        {spend && (
          <li>
            <T s="أكبر {0} يمثّلون {1} من مشترياتك ({2} عند {3}): {4}.{5}" a={[spend.top.length === 1 ? "مورّد" : `${spend.top.length} مورّدين`, <bdi key="1" className="font-bold text-ink">{shareText(spend.topShareBp)}</bdi>, <Money key="2" minor={spend.totalMinor} />, countNoun(spend.supplierCount, SUPPLIER), spend.top.map((t, i) => (
              <span key={t.supplierId}>
                {i > 0 && "، "}
                <Link href={`/suppliers/${t.slug}`} className="font-bold hover:underline" dir="auto">{t.name}</Link> <bdi>{shareText(t.shareBp)}</bdi>
              </span>
            )), spend.dominant && (
              <span key="5" className="mt-0.5 block font-bold text-warn">
                <T s="{0} وحده يتجاوز أربعين بالمئة من مشترياتك. انقطاعه يوقف عملك، وحجم مشترياتك منه يمنحك فرصة للتفاوض على خصم كمية." a={[spend.dominant.name]} /></span>
            )]} /></li>
        )}
      </ul>
    </div>
  );
}
