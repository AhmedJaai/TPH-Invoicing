import { Fragment } from "react";
import { Scale } from "lucide-react";
import { Money } from "./money";
import { Badge, LinkButton } from "./ui";
import { DAY, countNoun } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import type { SalesWitness } from "@/lib/sales/witness";
import { loadFoodicsCashByMonth, loadSalesWitness, type WitnessMonthInput } from "@/services/sales-witness.service";
import { T } from "@/components/i18n/t";

/**
 * «فودكس يقول…» — شاهدٌ بجانب مبيعات النقد المكتوبة بيد.
 *
 * يعرض ضريبةَ الشهر في ملفّ فودكس المستورَد وضريبةَ المبيعات التي حسبها الإقرار،
 * والفرقَ بينهما وما يقابله مبيعاتٍ. **لا يغيّر رقماً**: ما كتبه صاحبُه يبقى كما كتبه،
 * والشاهدُ الناقص يُقال ناقصاً، والشهرُ بلا ملفٍّ يُقال «لا ملفّ» لا صفراً.
 */
function Line({ w, foodicsCashMinor }: { w: SalesWitness; foodicsCashMinor: number | null }) {
  if (w.verdict === "NO_FILE") {
    return (
      <li className="px-4 py-3 text-xs">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold">{formatMonth(w.month)}</span>
          <Badge tone="muted">لا مبيعات فودكس لهذا الشهر</Badge>
        </span>
        <span className="mt-1 block text-[11px] leading-relaxed text-muted">
          لا يوجد ما نقارن به الرقم المكتوب، لأن مبيعات هذا الشهر لم تُقرأ من فودكس. والإقرار لا يتوقف على ذلك.
        </span>
      </li>
    );
  }
  const missing = Math.max(0, w.expectedDays - w.coveredDays);
  const gap = w.vatGapMinor ?? 0;
  const gross = Math.abs(w.grossGapMinor ?? 0);
  return (
    <li className="px-4 py-3 text-xs">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{formatMonth(w.month)}</span>
        {w.verdict === "AGREES" ? (
          <Badge tone="ok" dot>متطابقان</Badge>
        ) : w.verdict === "FOODICS_HIGHER" ? (
          <Badge tone="warn" dot>فودكس أعلى</Badge>
        ) : (
          <Badge tone="info" dot>الإقرار أعلى</Badge>
        )}
      </span>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-[11px]">
        <dt className="text-muted">
          <T s="ضريبة المبيعات في فودكس{0}" a={[<span key="0" className="block">
            <T s="يغطي {0} من {1}{2}" a={[countNoun(w.coveredDays, DAY), w.expectedDays, missing > 0 && <span key="2" className="font-bold text-warn"> <T s=" · ينقصه {0}" a={[countNoun(missing, DAY)]} /></span>]} /></span>]} /></dt>
        <dd className="text-end text-xs font-bold"><Money minor={w.vatMinor ?? 0} /></dd>
        <dt className="text-muted">
          <T s="ضريبة المبيعات في الإقرار{0}" a={[<span key="0" className="block">
            <T s="من الداخل إلى البنك{0}" a={[w.cashTypedGrossMinor === null ? "، ولم تُدخل مبيعات نقدية لهذا الشهر" : <Fragment key="0"> <T s=" ومن {0} نقداً أدخلتها" a={[<Money key="0" minor={w.cashTypedGrossMinor} />]} /></Fragment>]} /></span>]} /></dt>
        <dd className="text-end text-xs font-bold"><Money minor={w.returnOutputVatMinor} /></dd>
        {foodicsCashMinor !== null && (
          <>
            <dt className="text-muted">
              <T s="المبيعات النقدية في فودكس هذا الشهر{0}" a={[<span key="0" className="block">
                {w.cashTypedGrossMinor === null
                  ? <span className="font-bold text-warn">لم تُدخل المبيعات النقدية بعد، وهذا هو الرقم الذي ستدخله</span>
                  : w.cashTypedGrossMinor === foodicsCashMinor
                    ? "وهو ما أدخلته"
                    : <><T s="وأدخلتَ {0}" a={[<Money key="0" minor={w.cashTypedGrossMinor} />]} /></>}
              </span>]} /></dt>
            <dd className="text-end text-xs font-bold"><Money minor={foodicsCashMinor} /></dd>
          </>
        )}
        {w.verdict !== "AGREES" && (
          <>
            <dt className="font-bold text-ink">الفرق</dt>
            <dd className="text-end text-xs font-bold"><Money minor={Math.abs(gap)} tone={w.verdict === "FOODICS_HIGHER" ? "warn" : undefined} /></dd>
          </>
        )}
      </dl>
      {w.verdict === "FOODICS_HIGHER" && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          <T s="يقابل ذلك نحو {0} مبيعات شاملة للضريبة لم تدخل الإقرار. قد يكون السبب نقداً لم تُدخله، أو تسوية شبكة لم تصل البنك بعد، أو مبلغاً داخلاً لم يُضَف. الرقم الذي أدخلته باقٍ كما هو، ويمكنك تعديله من الخانة أعلاه." a={[<Money key="0" minor={gross} />]} /></p>
      )}
      {w.verdict === "RETURN_HIGHER" && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          <T s="يزيد الإقرار على فودكس بنحو {0} مبيعات. {1}مبلغاً داخلاً أُضيف وهو ليس بيعاً، أو نقداً أُدخل وقد أُودع في البنك." a={[<Money key="0" minor={gross} />, missing > 0 ? "قد يكون السبب أياماً لم تُقرأ من فودكس، أو " : "قد يكون السبب "]} /></p>
      )}
      {(w.refundMinor ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-muted"><T s="وفي فودكس مرتجعات بـ{0}، معروضة هنا ولا تُخصم." a={[<Money key="0" minor={w.refundMinor ?? 0} />]} /></p>
      )}
    </li>
  );
}

export async function SalesWitnessPanel({ months }: { months: readonly WitnessMonthInput[] }) {
  const [witness, cash] = await Promise.all([loadSalesWitness(months), loadFoodicsCashByMonth(months.map((m) => m.month))]);
  const any = witness.some((w) => w.verdict !== "NO_FILE");
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <p className="flex items-center gap-2 text-xs font-bold">
          <T s="{0}مقارنة بمبيعات فودكس" a={[<Scale key="0" className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden />]} /></p>
        <span className="text-[11px] text-muted">للمقارنة فقط، لا يدخل الإقرار ولا يغيّر ما أدخلته</span>
      </div>
      <ul className="divide-y divide-line-soft">
        {witness.map((w) => <Line key={w.month} w={w} foodicsCashMinor={cash.get(w.month) ?? null} />)}
      </ul>
      {!any && (
        <div className="border-t border-line-soft px-4 py-2.5">
          <LinkButton href="/money/foodics" size="sm">حالة ربط فودكس</LinkButton>
        </div>
      )}
    </div>
  );
}

export function SalesWitnessSkeleton() {
  return <div className="mt-3 h-24 animate-pulse rounded-xl border border-line bg-sunken/60" role="status" aria-label="يقرأ مبيعات فودكس" />;
}
