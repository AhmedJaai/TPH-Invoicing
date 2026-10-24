import { Money } from "./money";
import { T } from "@/components/i18n/t";
import { formatDay } from "@/lib/riyadh-time";
import { ITEM, countNoun } from "@/lib/arabic";
import type { SinceYesterday } from "@/lib/since-yesterday";

/**
 * «زاد ١٬٢٠٠٫٠٠ منذ صباح أمس · لقطة ٢٣ أكتوبر» تحت الرقم — من لقطة أمس (`daily_figures`).
 * و«زاد/نقص» بالكلمة لا بإشارةٍ تنقلب في سطرٍ من اليمين. ولا لقطةَ: «غير معروف» بسببه، لا صفر.
 */
export function SinceYesterdayLine({ s, kind }: { s: SinceYesterday; kind: "money" | "count" }) {
  const day = formatDay(s.day);
  const cls = "text-[11px] leading-relaxed text-muted";
  if (!s.known) {
    return (
      <p className={cls}>
        {s.reason === "no-snapshot"
          ? <T s="منذ صباح أمس: غير معروف، لا لقطة ليوم {0}" a={[day]} />
          : <T s="منذ صباح أمس: غير معروف · لقطة {0}" a={[day]} />}
      </p>
    );
  }
  if (s.delta === 0) return <p className={cls}><T s="لم يتغيّر منذ صباح أمس · لقطة {0}" a={[day]} /></p>;
  const amount = kind === "money"
    ? <Money key="0" minor={Math.abs(s.delta)} />
    : countNoun(Math.abs(s.delta), ITEM);
  return (
    <p className={cls}>
      {s.delta > 0
        ? <T s="زاد {0} منذ صباح أمس · لقطة {1}" a={[amount, day]} />
        : <T s="نقص {0} منذ صباح أمس · لقطة {1}" a={[amount, day]} />}
    </p>
  );
}
