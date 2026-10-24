/**
 * التشغيلُ المجدول — ما لا يلمس القاعدة: السرّ، وأثرُ آخر تشغيل، و«أنجح قريباً؟».
 *
 * كان العملُ الخلفيّ لا يقع إلّا وصفحةٌ مفتوحة (`auto-process.tsx`): فودكس كلَّ ثلاث
 * ساعات، والدرايف والاستدراك عند فتح الصفحات. فصار جدولٌ في GitHub Actions
 * (`.github/workflows/schedule.yml`) ينادي `/api/cron/<job>` بسرّ `CRON_SECRET`،
 * والقشرةُ باقيةٌ احتياطاً تتنحّى إن نجح تشغيلٌ مجدول قريباً.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { todayInRiyadh } from "./riyadh-time";

export type CronJob = "foodics" | "drive" | "daily";

/** صفُّ آخر تشغيلٍ في `job_state`. */
export const cronStateRow = (job: CronJob) => `cron:${job}`;

export type CronAuth = "ok" | "unset" | "missing" | "wrong";

/**
 * `Authorization: Bearer <CRON_SECRET>` وحده — لا جلسةَ ولا كعكة. والمقارنةُ بزمنٍ ثابت
 * على بصمتين متساويتَي الطول، فلا يُستدلّ بالتوقيت على حرفٍ صحيح. وسرٌّ غائبٌ في
 * الخادم يرفض كلَّ طلب: «لا سرّ» ليس «كلُّ أحدٍ مأذون».
 */
export function checkCronAuth(authorization: string | null, secret: string | undefined): CronAuth {
  if (!secret || secret.trim().length === 0) return "unset";
  const m = /^Bearer\s+(.+)$/.exec(authorization?.trim() ?? "");
  if (!m) return "missing";
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(m[1].trim()), digest(secret)) ? "ok" : "wrong";
}

export interface CronRun {
  at: Date;
  ok: boolean;
  /** ما وقع بجملةٍ تُقرأ — والفشلُ بسببه. */
  result: string;
}

/** يُحفَظ في عمود `fingerprint` (نصّ) — والوقتُ في `ran_at`. */
export function encodeCronRun(run: { ok: boolean; result: string }): string {
  return JSON.stringify({ ok: run.ok, result: run.result.slice(0, 400) });
}

export function decodeCronRun(fingerprint: string, ranAt: Date): CronRun | null {
  try {
    const v: unknown = JSON.parse(fingerprint);
    if (typeof v !== "object" || v === null) return null;
    const ok = Reflect.get(v, "ok");
    const result = Reflect.get(v, "result");
    if (typeof ok !== "boolean" || typeof result !== "string") return null;
    return { at: ranAt, ok, result };
  } catch {
    return null;
  }
}

/** أنجح تشغيلٌ مجدول خلال `withinMs`؟ — الفاشلُ لا يُعدّ، فتعمل القشرةُ احتياطاً. */
export function ranRecently(run: CronRun | null, withinMs: number, now: number = Date.now()): boolean {
  if (!run || !run.ok) return false;
  const age = now - run.at.getTime();
  return age >= 0 && age < withinMs;
}

/** يومُ لقطة الأرقام — يومُ الرياض لا يومُ الخادم: ٠٢:٣٠ UTC هي ٠٥:٣٠ من اليوم نفسه، و٢١:٠٠ UTC من الغد. */
export function snapshotDay(at: Date = new Date()): string {
  return todayInRiyadh(at);
}
