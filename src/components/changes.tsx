import Link from "next/link";
import { Money } from "./money";
import { notable, type Change } from "@/lib/changes";

/**
 * ما الذي تغيّر — أوّل ما يُقرأ في الصباح.
 *
 * السهم يقول الاتجاه، واللون يقول أهو في صالحك. وارتفاع المشتريات لا
 * لون له: قد يكون نموّاً وقد يكون تسرّباً، ولا يعرف النظام أيّهما.
 */
export function Changes({ changes }: { changes: readonly Change[] }) {
  const shown = notable(changes);

  if (shown.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
        <p className="text-sm font-bold">لم يتغيّر شيء يستحقّ الذكر.</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
          كل ما يقيسه النظام قريبٌ ممّا كان. والسكون خبرٌ أيضاً.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {shown.map((c) => {
        const tone =
          c.favourable === true ? "text-ok"
          : c.favourable === false ? "text-warn"
          : "";
        const arrow = c.direction === "UP" ? "▲" : c.direction === "DOWN" ? "▼" : "•";

        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-bold">{c.label}</p>
              <span className={`shrink-0 text-xs font-bold ${tone}`}>
                {c.direction === "NEW" ? "جديد" : (
                  <>
                    {arrow}{" "}
                    {c.pct === null ? "" : `${Math.abs(Math.round(c.pct))}٪`}
                  </>
                )}
              </span>
            </div>

            {c.currentMinor !== undefined && (
              <p className="nums mt-2 font-display text-xl font-bold leading-none">
                <Money minor={c.currentMinor} />
              </p>
            )}

            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {c.detail} · {c.baseline}
            </p>
          </>
        );

        const box = "block rounded-2xl border border-line bg-raised px-4 py-3.5 shadow-raised";
        return (
          <li key={c.id}>
            {c.href ? (
              <Link href={c.href} className={`${box} transition-all hover:border-ink-soft hover:shadow-lifted`}>
                {body}
              </Link>
            ) : (
              <div className={box}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
