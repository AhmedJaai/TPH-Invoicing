import Link from "next/link";
import { Money } from "./money";
import { formatMonth } from "@/lib/riyadh-time";
import type { CashFlowMonth } from "@/lib/cashflow";

/**
 * الوارد والصادر شهراً بشهر — شريطان لكلّ شهر على محورٍ واحد.
 *
 * محورٌ واحد لأنّ المقياسين مالٌ بالوحدة نفسها، والنسبةُ من أكبر رقمٍ في
 * الأشهر كلّها — فشهرٌ أثقل يبدو أثقل. والقيمُ مكتوبةٌ بجانب أشرطتها
 * (لا يُقرأ الشريطُ وحده)، والشهرُ الذي لم يغطّه الكشفُ كلَّه يُعلَن
 * «جزئيّاً»: سبتمبر بثلاثة أيّامٍ صافيه سالب لا لأنّ المقهى خسر، بل لأنّ
 * الكشف وقف.
 *
 * واللونان من هويّة النظام لا من ألوان الحال: الأخضرُ والأحمر حكمٌ، والوارد
 * والصادر ليسا حكماً.
 */
export function CashFlowChart({
  months,
  partial,
  hrefOf,
  active,
}: {
  months: readonly CashFlowMonth[];
  /** ما لم يغطّه الكشفُ كاملاً — ونصُّ ما غطّاه. */
  partial: ReadonlyMap<string, string>;
  hrefOf: (month: string) => string;
  active: string | null;
}) {
  const max = Math.max(1, ...months.flatMap((m) => [m.inMinor, m.outMinor]));
  const pct = (v: number) => `${Math.max(v > 0 ? 1.5 : 0, (v / max) * 100)}%`;

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-4 text-[11px] font-bold text-ink-soft" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" /> وارد</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sand" /> صادر</span>
      </div>
      <ol className="space-y-1">
        {[...months].reverse().map((m) => {
          const note = partial.get(m.month);
          const on = active === m.month;
          return (
            <li key={m.month}>
              <Link
                href={hrefOf(m.month)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={`grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2.5 transition-colors hover:bg-hover sm:grid-cols-[7rem_minmax(0,1fr)_7.5rem] ${on ? "bg-accent-soft/60 ring-1 ring-accent-line" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold">{formatMonth(m.month)}</span>
                  {note && <span className="block text-[10px] font-bold text-warn">جزئيّ · {note}</span>}
                </span>
                <span className="min-w-0 space-y-1.5">
                  <Bar tone="bg-accent" width={pct(m.inMinor)} label="وارد" minor={m.inMinor} />
                  <Bar tone="bg-sand" width={pct(m.outMinor)} label="صادر" minor={m.outMinor} />
                </span>
                <span className="col-span-2 flex items-baseline justify-between gap-2 border-t border-line-soft pt-1.5 text-end sm:col-span-1 sm:block sm:border-0 sm:pt-0">
                  <span className="text-[10px] font-bold text-muted sm:block">الصافي</span>
                  <span className={`text-[13px] font-bold ${m.netMinor < 0 ? "text-danger" : ""}`}>
                    <Money minor={m.netMinor} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Bar({ tone, width, label, minor }: { tone: string; width: string; label: string; minor: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
        <span className={`absolute inset-y-0 start-0 rounded-full ${tone}`} style={{ width }} title={label} />
      </span>
      <span className="relative w-[5.5rem] shrink-0 text-end text-[11px] font-bold text-ink-soft">
        <span className="sr-only">{label} </span>
        <Money minor={minor} />
      </span>
    </span>
  );
}
