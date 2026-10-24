/**
 * التشغيلُ المجدول لمزامنة فودكس — كلَّ ثلاث ساعات من `.github/workflows/schedule.yml`.
 *
 * بسرّ `CRON_SECRET` وحده (`cronGuard`) وباسم المالك، وبالعقد نفسه الذي يأخذه «زامن الآن»:
 * إن كانت مزامنةٌ تجري ردّ هذا `200` بلا عمل. وجولاتٌ متتالية حتى يكتمل ما تغيّر أو يضيق العمر.
 */
import { cronGuard, cronRefused, defaultFoodicsDeps, foodicsCronJob, runCron } from "@/services/cron.service";
import { runLeasedFoodicsSync } from "@/services/foodics-sync.service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let actor;
  try {
    /* الصلاحيّةُ نفسُها التي يحرس بها `/api/foodics-sync` */
    actor = await cronGuard(request, "inventory:count");
  } catch (e) {
    const refused = cronRefused(e, "cron/foodics");
    if (refused) return refused;
    throw e;
  }
  return runCron("foodics", () => foodicsCronJob(actor, defaultFoodicsDeps((o) => runLeasedFoodicsSync(o))));
}
