import { Money } from "./money";
import { AGE_BUCKETS } from "@/lib/supplier-intel";

/**
 * عناصرُ مساحة المورّدين — تُرسَم في الخادم.
 *
 * `AgeingBar` و`Figure` مرشّحان للرفع إلى `ui.tsx`: الأوّل يصلح لكلّ
 * «منذ متى؟» (الفواتير، المستحقّات)، والثاني هو رقمُ الرأس في «النقد القادم»
 * و«اليوم» مكتوباً مرّةً ثالثة.
 */

/* تدرّجٌ من الحديث إلى القديم — واللونُ لا يأتي وحده: تحت الشريط اسمُ كلّ شريحةٍ ومبلغُها */
const SEGMENT = ["bg-accent", "bg-sand", "bg-warn", "bg-danger"] as const;

/**
 * «منذ متى؟» في شريطٍ واحد: الدَّينُ موزَّعاً على أعماره.
 * مجموعُ الشرائح هو «عليك» نفسُه — يُوزَّع ولا يُعاد حسابُه.
 */
export function AgeingBar({
  buckets,
  compact = false,
}: {
  buckets: readonly [number, number, number, number];
  compact?: boolean;
}) {
  const total = buckets.reduce((s, x) => s + x, 0);
  if (total <= 0) return null;
  return (
    <div>
      <div
        role="img"
        aria-label={`توزيعُ الدَّين على أعماره: ${AGE_BUCKETS.map((b, i) => `${b.label} ${Math.round((buckets[i] * 100) / total)}٪`).join("، ")}`}
        className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-sunken ${compact ? "h-1.5" : "h-2.5"}`}
      >
        {buckets.map((v, i) =>
          v > 0 ? (
            <span key={i} className={`h-full ${SEGMENT[i]} first:rounded-s-full last:rounded-e-full`} style={{ width: `${Math.max(2, (v * 100) / total)}%` }} />
          ) : null,
        )}
      </div>
      {!compact && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          {AGE_BUCKETS.map((b, i) => (
            <div key={b.id} className={`min-w-0 ${buckets[i] === 0 ? "opacity-55" : ""}`}>
              <dt className="flex items-center gap-1.5 text-[11px] text-muted">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${SEGMENT[i]}`} />
                {b.label}
              </dt>
              <dd className={`mt-0.5 text-[13px] font-bold ${i >= 2 && buckets[i] > 0 ? (i === 3 ? "text-danger" : "text-warn") : ""}`}>
                {buckets[i] > 0 ? <Money minor={buckets[i]} /> : <span className="font-normal text-muted">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** رقمُ الرأس صار عنصراً مشتركاً — يُعاد تصديره باسمه القديم لمستورديه. */
export { KeyFigure as Figure } from "./ui";
