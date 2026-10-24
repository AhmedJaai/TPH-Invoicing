import { CircleAlert, Clock } from "lucide-react";
import { formatMoment } from "@/lib/riyadh-time";
import type { CronRun } from "@/lib/cron";
import { T } from "@/components/i18n/t";

/**
 * «آخر تشغيل آلي: <وقت الرياض> — <ما وقع>» — أثرُ التشغيل المجدول (`/api/cron/*`) من
 * `job_state`، تحت حال الدرايف وفودكس. والفشلُ بسببه بلونه وكلمته، لا بلونٍ وحده.
 * و«لم يجرِ» يُقال كما هو: لا تشغيلَ لا يُعرض نجاحاً.
 */
export function ScheduledRunLine({ run, cadence }: { run: CronRun | null; cadence: string }) {
  if (!run) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span><T s="لم يجرِ تشغيل آلي بعد. يعمل {0} ولو لم يُفتح التطبيق." a={[<span key="0">{cadence}</span>]} /></span>
      </p>
    );
  }
  const Icon = run.ok ? Clock : CircleAlert;
  return (
    <p className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${run.ok ? "text-muted" : "font-bold text-danger"}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span>
        <T
          s={run.ok ? "آخر تشغيل آلي: {0} — {1}" : "آخر تشغيل آلي: {0} — فشل: {1}"}
          a={[<bdi key="0">{formatMoment(run.at)}</bdi>, <span key="1" data-no-translate>{run.result}</span>]}
        />
      </span>
    </p>
  );
}
