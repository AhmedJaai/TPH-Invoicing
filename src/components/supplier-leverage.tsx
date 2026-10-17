import Link from "next/link";
import { Handshake } from "lucide-react";
import { Money } from "./money";
import { DAY, INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { MIN_PAY_SAMPLE } from "@/lib/supplier-leverage";
import { shareText } from "@/lib/vat-compare";
import { LEVERAGE_MONTHS, loadSupplierLeverage } from "@/services/supplier-leverage.service";

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
        <Handshake className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden />
        للتفاوض: آخر {LEVERAGE_MONTHS} شهراً
      </p>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
        <li>
          {pay.weightedDays === null ? (
            <>متوسط أيام السداد <span className="font-bold text-muted">غير معروف</span>. يلزم لحسابه {MIN_PAY_SAMPLE} فواتير مسدّدة بدفعة معروفة التاريخ، والمتوفر {pay.sampleCount}.</>
          ) : (
            <>
              تدفع في المتوسط بعد <span className="font-bold text-ink">{pay.weightedDays === 0 ? "صفر يوم" : countNoun(pay.weightedDays, DAY)}</span> من
              تاريخ الفاتورة، مرجّحاً بالمبلغ ({countNoun(pay.sampleCount, INVOICE)} مسدّدة).{" "}
              <Link href="/suppliers?view=owed" className="font-bold text-accent hover:underline">المورّدون الذين لهم مستحقات عليك الآن</Link>.
            </>
          )}
        </li>
        {spend && (
          <li>
            أكبر {spend.top.length === 1 ? "مورّد" : `${spend.top.length} مورّدين`} يمثّلون <bdi className="font-bold text-ink">{shareText(spend.topShareBp)}</bdi> من
            مشترياتك (<Money minor={spend.totalMinor} /> عند {countNoun(spend.supplierCount, SUPPLIER)}):{" "}
            {spend.top.map((t, i) => (
              <span key={t.supplierId}>
                {i > 0 && "، "}
                <Link href={`/suppliers/${t.slug}`} className="font-bold hover:underline" dir="auto">{t.name}</Link> <bdi>{shareText(t.shareBp)}</bdi>
              </span>
            ))}
            .
            {spend.dominant && (
              <span className="mt-0.5 block font-bold text-warn">
                {spend.dominant.name} وحده يتجاوز أربعين في المئة من مشترياتك. انقطاعه يوقف عملك، وحجم مشترياتك منه يتيح لك التفاوض على خصم كمية.
              </span>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
