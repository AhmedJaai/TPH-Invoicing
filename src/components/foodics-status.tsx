import { CircleAlert, CircleCheck, PlugZap, RefreshCw } from "lucide-react";
import { formatDay, formatMoment } from "@/lib/riyadh-time";
import type { FoodicsStatus } from "@/services/foodics-sync.service";
import { PostAction } from "./post-action";

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
          <p className="text-[13px] font-bold text-warn">فودكس غير موصولٍ على هذا الخادم</p>
          <p className="mt-0.5">
            مفتاحُ الربط <bdi dir="ltr" className="font-mono">FOODICS_API_TOKEN</bdi> غير مضبوطٍ في بيئته — فلا تُقرأ بياناتٌ جديدة.
            {status.orders > 0 && <> وما يُعرَض أدناه ممّا قُرئ من قبل، حتى <bdi>{formatDay(status.lastDay)}</bdi>.</>}
          </p>
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
            ? "آخرُ مزامنةٍ لفودكس تعثّرت"
            : status.lastOkAt
              ? <>فودكس مقروءٌ حتى <bdi>{formatMoment(status.lastOkAt)}</bdi></>
              : "فودكس موصول — لم يُقرأ بعد"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {failed && status.lastRun?.error ? <>{status.lastRun.error} · </> : null}
          {status.orders > 0
            ? <><span className="nums">{status.orders.toLocaleString("ar-SA-u-nu-latn")}</span> طلباً من <bdi>{formatDay(status.firstDay)}</bdi> إلى <bdi>{formatDay(status.lastDay)}</bdi> · <span className="nums">{status.purchases}</span> حركةَ شراء. قراءةٌ فقط — لا يُكتب في فودكس شيء.</>
            : "لا طلباتٍ مقروءة بعد — اضغط «زامن» لتُقرأ الأيّامُ الأخيرة."}
        </p>
      </div>
      {canSync && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <PostAction url="/api/foodics-sync" body={{}} variant="secondary" size="md" done="تمّت مزامنةُ فودكس">
            <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden />
            زامن الآن
          </PostAction>
        </div>
      )}
    </div>
  );
}
