import Link from "next/link";
import type { LucideIcon } from "lucide-react";
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

/**
 * رقمُ الرأس: أيقونةٌ وتسمية، والرقمُ كبيراً، وجملةٌ تقول معناه — وكلُّه
 * يفتح موضعه حين يكون له موضع.
 */
export function Figure({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
  children,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: "warn" | "danger" | "ok";
  children?: React.ReactNode;
  className?: string;
}) {
  const chip =
    tone === "danger" ? "bg-danger-bg text-danger"
    : tone === "warn" ? "bg-warn-bg text-warn"
    : tone === "ok" ? "bg-ok-bg text-ok"
    : "bg-sunken text-ink-soft";
  const ink = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "";
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-bold text-muted">
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${chip}`}>
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
        {label}
      </span>
      <span className={`mt-4 block text-[1.45rem] font-bold leading-none tracking-tight sm:text-[2rem] ${ink}`}>{value}</span>
      {sub && <span className="mt-3 block text-xs leading-relaxed text-muted">{sub}</span>}
    </>
  );
  const cls = `flex flex-col rounded-2xl border border-line bg-raised p-4 shadow-raised transition-[border-color,box-shadow] sm:p-5 ${href ? "has-[a:hover]:border-accent-line has-[a:hover]:shadow-lifted" : ""} ${className}`;
  return (
    <div className={cls}>
      {href ? (
        <Link href={href} className="group -m-1 block rounded-xl p-1 transition-colors hover:text-inherit focus-visible:outline-2">
          {body}
        </Link>
      ) : (
        body
      )}
      {children && <div className="mt-auto pt-4">{children}</div>}
    </div>
  );
}
