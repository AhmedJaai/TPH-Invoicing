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
                {c.direction === "NEW" ? "جديد" : c.pct === null ? (
                  /*
                    السهم وحده يقول الاتّجاه ولا يقول المقدار — وهو ملوّن،
                    فيُقلق بلا أن يوجّه. فإن جُهل المقدار قيل ذلك.
                  */
                  <>{arrow} بلا مقارنة</>
                ) : (
                  <>{arrow} {Math.abs(Math.round(c.pct))}٪</>
                )}
              </span>
            </div>

            {/*
              لكل بطاقةٍ رقمُها في الخانة نفسها.
              كانت بطاقتان من الأربع بلا رقمٍ أصلاً، فيختلف تشريح البطاقة
              داخل الشبكة الواحدة ولا يجد المستعرض عموداً يمسحه بعينه.
            */}
            <p className="nums mt-2 font-display text-xl font-bold leading-none">
              {c.currentMinor !== undefined ? (
                <Money minor={c.currentMinor} />
              ) : (
                c.currentCount ?? "—"
              )}
            </p>

            <p className="mt-2 text-xs leading-relaxed text-muted">
              {c.detail} · {c.baseline}
            </p>
          </>
        );

        /*
          `h-full` على الصندوق لا على العنصر: الشبكة تمدّ `li` إلى ارتفاع
          الصفّ، والصندوق داخله كان يقف عند ارتفاع محتواه — فتظهر فجوةٌ
          أسفل بطاقات العمود الأقصر.
        */
        const box = "flex h-full flex-col rounded-2xl border border-line bg-raised px-4 py-3.5 shadow-raised";
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
