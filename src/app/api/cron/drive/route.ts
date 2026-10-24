/**
 * التشغيلُ المجدول للدرايف — كلَّ ساعة من السابعة صباحاً إلى منتصف الليل بتوقيت الرياض.
 *
 * يزامن الجديد (شهرين، وسنةً كاملة مرّةً في الأسبوع) ثمّ يجري المراجعةَ الآليّة (الاستدراك)
 * — بالخدمتين اللتين تناديهما الشاشة وبعقديهما. بسرّ `CRON_SECRET` وحده وباسم المالك
 * وتفويض درايفه؛ وغيابُ التفويض فشلٌ يُقال (٥٠٢) فيصل بريدُ GitHub إلى صاحبه.
 */
import { cronGuard, cronRefused, defaultDriveDeps, driveCronJob, runCron } from "@/services/cron.service";
import { runDriveSync } from "@/services/drive-sync.service";
import { runBacklogSweep } from "@/services/backlog-sweep.service";
import { isAutoPaused } from "@/services/auto-process.service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let actor;
  try {
    /* الصلاحيّةُ نفسُها التي يحرس بها `/api/drive-sync` و«أكّد المؤهَّل» */
    actor = await cronGuard(request, "document:upload");
  } catch (e) {
    const refused = cronRefused(e, "cron/drive");
    if (refused) return refused;
    throw e;
  }
  return runCron("drive", () => driveCronJob(defaultDriveDeps(actor, {
    paused: () => isAutoPaused(),
    runDriveSync,
    sweep: (a) => runBacklogSweep(a, { background: true }),
  })));
}
