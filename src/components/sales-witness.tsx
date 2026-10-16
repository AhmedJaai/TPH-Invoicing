import { Scale } from "lucide-react";
import { Money } from "./money";
import { Badge, LinkButton } from "./ui";
import { DAY, countNoun } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import type { SalesWitness } from "@/lib/sales/witness";
import { loadFoodicsCashByMonth, loadSalesWitness, type WitnessMonthInput } from "@/services/sales-witness.service";

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
          لا شاهد على الرقم المكتوب: لم تقرأ مبيعات هذا الشهر من فودكس. والإقرار لا يتوقّف عليه.
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
          <Badge tone="ok" dot>يتّفقان</Badge>
        ) : w.verdict === "FOODICS_HIGHER" ? (
          <Badge tone="warn" dot>فودكس أعلى</Badge>
        ) : (
          <Badge tone="info" dot>الإقرار أعلى</Badge>
        )}
      </span>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-[11px]">
        <dt className="text-muted">
          ضريبة المبيعات في فودكس
          <span className="block">
            يغطّي {countNoun(w.coveredDays, DAY)} من {w.expectedDays}
            {missing > 0 && <span className="font-bold text-warn"> — ينقصه {countNoun(missing, DAY)}</span>}
          </span>
        </dt>
        <dd className="text-end text-xs font-bold"><Money minor={w.vatMinor ?? 0} /></dd>
        <dt className="text-muted">
          ضريبة المبيعات في الإقرار
          <span className="block">
            من وارد البنك{w.cashTypedGrossMinor === null ? " — ولم تكتب نقداً لهذا الشهر" : <> ومن <Money minor={w.cashTypedGrossMinor} /> نقداً كتبته</>}
          </span>
        </dt>
        <dd className="text-end text-xs font-bold"><Money minor={w.returnOutputVatMinor} /></dd>
        {foodicsCashMinor !== null && (
          <>
            <dt className="text-muted">
              ما قبضه فودكس نقداً هذا الشهر
              <span className="block">
                {w.cashTypedGrossMinor === null
                  ? <span className="font-bold text-warn">لم تكتب نقداً بعد — هذا الرقم الذي يكتب</span>
                  : w.cashTypedGrossMinor === foodicsCashMinor
                    ? "وهو ما كتبته"
                    : <>وكتبت <Money minor={w.cashTypedGrossMinor} /></>}
              </span>
            </dt>
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
          يقابله نحو <Money minor={gross} /> مبيعات شاملة الضريبة لم تدخل الإقرار: نقد لم يكتب، أو تسوية شبكة لم تصل البنك بعد، أو وارد لم يضمّ.
          رقمك المكتوب باق كما هو — غيّره من الخانة أعلاه إن رأيت.
        </p>
      )}
      {w.verdict === "RETURN_HIGHER" && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          الإقرار يحسب نحو <Money minor={gross} /> مبيعات فوق ما في فودكس: {missing > 0 ? "قد تكون أيّاماً لم تقرأ من فودكس، أو " : ""}وارد ضمّ وليس بيعاً، أو نقد كتب وقد أودع.
        </p>
      )}
      {(w.refundMinor ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-muted">وفي فودكس مرتجعات بـ<Money minor={w.refundMinor ?? 0} /> — معروضة ولا تطرح هنا.</p>
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
          <Scale className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden />
          شاهد من فودكس
        </p>
        <span className="text-[11px] text-muted">للمقابلة وحدها — لا يدخل الإقرار ولا يغيّر ما كتبته</span>
      </div>
      <ul className="divide-y divide-line-soft">
        {witness.map((w) => <Line key={w.month} w={w} foodicsCashMinor={cash.get(w.month) ?? null} />)}
      </ul>
      {!any && (
        <div className="border-t border-line-soft px-4 py-2.5">
          <LinkButton href="/money/foodics" size="sm">حال وصل فودكس</LinkButton>
        </div>
      )}
    </div>
  );
}

export function SalesWitnessSkeleton() {
  return <div className="mt-3 h-24 animate-pulse rounded-xl border border-line bg-sunken/60" role="status" aria-label="تقرأ مبيعات فودكس" />;
}
