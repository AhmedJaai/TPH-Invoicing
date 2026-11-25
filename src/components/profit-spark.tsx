import Link from "next/link";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatMonth } from "@/lib/riyadh-time";
import type { TrendMonth } from "./finance-bits";

const short = (m: string) => formatMonth(m).replace(/\s+\d{4}$/, "");

/**
 * ربحُ الأشهر شريطاً صغيراً داخل بطاقة الربح — «إلى أين يمشي؟» بنظرة، والشهرُ المختار بلون العلامة.
 * والشهرُ الذي لم ينتهِ أو ينقصه بند يُرسم باهتاً (ليس صافياً بعد)، والسالبُ تحت الخطّ. كلُّ عمودٍ يفتح شهرَه.
 * والجدولُ الكامل بالأرقام في «الأشهر جنباً إلى جنب» أسفل الصفحة.
 */
export function ProfitSpark({ months, active }: { months: readonly TrendMonth[]; active: string }) {
  const list = [...months].sort((a, b) => a.month.localeCompare(b.month)).slice(-8);
  const known = list.filter((m) => m.profitMinor !== null);
  if (known.length < 2) return null;
  const top = Math.max(...known.map((m) => Math.max(m.profitMinor!, 0)), 1);
  const bottom = Math.max(...known.map((m) => Math.max(-m.profitMinor!, 0)), 0);
  const span = top + bottom;
  return (
    <figure className="no-print" aria-label="الربح شهراً بشهر">
      <div className="flex h-16 items-stretch gap-1.5">
        {list.map((m) => {
          const v = m.profitMinor;
          const on = m.month === active;
          const faded = !m.complete;
          const up = v !== null && v >= 0 ? (v / span) * 100 : 0;
          const down = v !== null && v < 0 ? (-v / span) * 100 : 0;
          return (
            <Link key={m.month} href={`/finance?month=${m.month}`} className="group relative flex min-w-0 flex-1 flex-col"
              title={`${formatMonth(m.month)}: ${v === null ? "غير معروف" : formatRiyalsDisplay(v)}${m.complete ? "" : " (ليس صافياً بعد)"}`}>
              <span className="flex flex-col justify-end" style={{ height: `${(top / span) * 100}%` }}>
                <span className={`w-full rounded-t-[4px] transition-colors ${on ? "bg-accent" : "bg-line group-hover:bg-accent/60"} ${faded ? "opacity-50" : ""}`} style={{ height: `${(up / (top / span)) || 0}%` }} />
              </span>
              {bottom > 0 && (
                <span className="flex flex-col border-t border-line-soft" style={{ height: `${(bottom / span) * 100}%` }}>
                  <span className="w-full rounded-b-[4px] bg-danger/70" style={{ height: `${(down / (bottom / span)) || 0}%` }} />
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <figcaption className="mt-1 flex gap-1.5" aria-hidden>
        {list.map((m) => (
          <span key={m.month} className={`min-w-0 flex-1 truncate text-center text-[10px] ${m.month === active ? "font-bold text-ink" : "text-muted"}`}>{short(m.month)}</span>
        ))}
      </figcaption>
    </figure>
  );
}
