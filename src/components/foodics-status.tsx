import { ORDER, TRANSACTION, countNoun } from "@/lib/arabic";
import { Fragment } from "react";
import { CircleAlert, CircleCheck, PlugZap, RefreshCw } from "lucide-react";
import { formatDay, formatMoment } from "@/lib/riyadh-time";
import type { FoodicsStatus } from "@/services/foodics-sync.service";
import { PostAction } from "./post-action";
import { T } from "@/components/i18n/t";
import { ScheduledRunLine } from "./scheduled-run";

/**
 * حالُ وصل فودكس — يظهر فوق كلّ مقارنةٍ تُبنى عليه.
 *
 * مقارنةٌ على بياناتٍ قديمة تُقرأ فرقاً وهي تأخّرُ مزامنة. فيُقال متى قُرئ فودكس
 * آخرَ مرّة وإلى أيّ يوم، قبل أيّ رقم — ومعه زرُّ القراءة لمن يملكها.
 */
export function FoodicsStatusBar({ status, canSync }: { status: FoodicsStatus; canSync: boolean }) {
  if (!status.configured) {
    return (
      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-warn/30 bg-warn-bg px-4 py-3.5">
        <PlugZap className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1 basis-56 text-xs leading-relaxed text-ink-soft">
          <p className="text-[13px] font-bold text-warn">فودكس غير مربوط بهذا الخادم</p>
          <p className="mt-0.5">
            <T s="مفتاح الربط {0} غير مضبوط في هذه البيئة، فلا تُقرأ بيانات جديدة.{1}" a={[<bdi key="0" dir="ltr" className="font-mono">FOODICS_API_TOKEN</bdi>, status.orders > 0 && <Fragment key="1"> <T s=" والمعروض أدناه بيانات قُرئت من قبل حتى {0}." a={[<bdi key="0">{formatDay(status.lastDay)}</bdi>]} /></Fragment>]} /></p>
        </div>
      </div>
    );
  }

  const failed = status.lastRun?.status === "FAILED";
  const Icon = failed ? CircleAlert : CircleCheck;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border bg-raised px-4 py-3.5 shadow-raised ${failed ? "border-danger/30" : "border-line"}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${failed ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok"}`}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className={`text-[13px] font-bold ${failed ? "text-danger" : ""}`}>
          {failed
            ? "فشلت آخر مزامنة مع فودكس"
            : status.lastOkAt
              ? <><T s="بيانات فودكس محدّثة حتى {0}" a={[<bdi key="0">{formatMoment(status.lastOkAt)}</bdi>]} /></>
              : "فودكس مربوط، ولم تُقرأ منه بيانات بعد"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {failed && status.lastRun?.error ? <>{status.lastRun.error} · </> : null}
          {status.orders > 0
            ? <><T s="{0} من {1} إلى {2} · {3} شراء. القراءة فقط، ولا يُكتب شيء في فودكس." a={[<span key="0" className="nums">{countNoun(status.orders, ORDER).replace(/^\d+/, (d) => Number(d).toLocaleString("en-US"))}</span>, <bdi key="1">{formatDay(status.firstDay)}</bdi>, <bdi key="2">{formatDay(status.lastDay)}</bdi>, <span key="3" className="nums">{countNoun(status.purchases, TRANSACTION)}</span>]} /></>
            : "لم تُقرأ أي طلبات بعد. اضغط «زامن الآن» لقراءة الأيام الأخيرة."}
        </p>
        <div className="mt-1.5"><ScheduledRunLine run={status.scheduled} cadence="كل ثلاث ساعات" /></div>
      </div>
      {canSync && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <PostAction url="/api/foodics-sync" body={{}} variant="secondary" size="md" done="زُومن فودكس">
            <T s="{0}زامن الآن" a={[<RefreshCw key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></PostAction>
        </div>
      )}
    </div>
  );
}
