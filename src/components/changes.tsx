import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";
import { Money, Prose } from "./money";
import { notable, type Change } from "@/lib/changes";

/**
 * ما الذي تغيّر — خبرٌ في سطر لكلّ مقياس.
 *
 * السهمُ يقول الاتّجاه، واللونُ يقول أهو في صالحك. وارتفاعُ المشتريات لا
 * لون له: قد يكون نموّاً وقد يكون تسرّباً، ولا يعرف النظامُ أيَّهما.
 */
export function Changes({ changes }: { changes: readonly Change[] }) {
  const shown = notable(changes);

  if (shown.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-muted">
        لم يتغيّر شيءٌ يستحقّ الذكر منذ الأسبوع الماضي — والسكونُ خبرٌ أيضاً.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      {shown.map((c) => {
        const tone =
          c.favourable === true ? "bg-ok-bg text-ok"
          : c.favourable === false ? "bg-warn-bg text-warn"
          : "bg-sunken text-ink-soft";
        const Icon = c.direction === "NEW" ? Sparkles : c.direction === "UP" ? ArrowUpRight : c.direction === "DOWN" ? ArrowDownRight : Minus;

        const body = (
          <>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}>
              <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-bold">{c.label}</span>
                <span className="shrink-0 text-[13px] font-bold">
                  {c.currentMinor !== undefined ? <Money minor={c.currentMinor} /> : <span className="nums">{c.currentCount ?? "—"}</span>}
                </span>
              </span>
              <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] leading-relaxed text-muted">
                <span className="min-w-0 truncate"><Prose text={`${c.detail} · ${c.baseline}`} /></span>
                <span className={`shrink-0 font-bold ${c.favourable === true ? "text-ok" : c.favourable === false ? "text-warn" : ""}`}>
                  {c.direction === "NEW" ? "جديد" : c.pct === null ? "بلا مقارنة" : <><span className="nums">{Math.abs(Math.round(c.pct))}</span>٪</>}
                </span>
              </span>
            </span>
          </>
        );

        const cls = "flex items-center gap-3 px-4 py-3";
        return (
          <li key={c.id}>
            {c.href ? (
              <Link href={c.href} className={`${cls} transition-colors hover:bg-hover`}>{body}</Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
