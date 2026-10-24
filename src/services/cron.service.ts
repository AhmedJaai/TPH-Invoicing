/**
 * التشغيلُ المجدول — بابُ `/api/cron/*` وأعمالُه الثلاثة، بالخدمات والعقود القائمة نفسها.
 *
 * **الحارس** (`cronGuard`): سرُّ `CRON_SECRET` في `Authorization: Bearer` وحده — لا جلسةَ ولا
 * كعكة، ولا يمرّ بـ`guard()` (لا جلسةَ له). وبعده فاعلٌ آليّ مسمّى: **المالكُ الواحد**
 * (دورُه OWNER ونشط) — تفويضُ درايفه هو الوحيد المحفوظ، وصلاحيّاتُه تُسأل بـ`can()` كما
 * يسألها الحارس. ومعرّفُه يُكتب فاعلاً (المفتاحُ الأجنبيّ إلى `users`)، وكلُّ قيدٍ في سجلّ
 * التدقيق يُوسَم `"المنفّذ": "system:cron"` (`lib/actor-context.ts`). لا مالكَ أو أكثرُ من
 * واحد: يُرفض بسببٍ مسجَّل، ولا يُخمَّن.
 *
 * **الأعمال**: تنادي ما تناديه الشاشة — `runLeasedFoodicsSync`، و`runDriveSync`،
 * و`runBacklogSweep` — فإن تداخل تشغيلان ردّ العقدُ القائمُ الثاني `busy` فلا يعمل.
 * والأثرُ صفٌّ في `job_state` (`cron:<job>`) تقرؤه حالُ الدرايف وفودكس، وتتنحّى به القشرة.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can, type Capability, type Role } from "@/lib/permissions";
import { logEvent } from "@/lib/log";
import { CRON_ACTOR_LABEL, runAsSystem } from "@/lib/actor-context";
import { withDeadline } from "@/lib/ai/deadline";
import { checkCronAuth, ranRecently, type CronJob } from "@/lib/cron";
import { formatRiyalsDisplay } from "@/lib/money";
import { foodicsConfigured } from "@/lib/foodics/client";
import { isDue, loadCronRun, markRan, recordCronRun } from "./job-state.service";
import type { SyncResult } from "./foodics-sync.service";
import type { DriveSyncBody } from "./drive-sync.service";
import type { SweepOutcome } from "./backlog-sweep.service";
import type { DayFigures } from "./daily-figures.service";

/**
 * إيقاعُ القشرة — مزامنةُ فودكس والدرايف من الصفحة المفتوحة كلَّ ثلاث ساعات
 * (`SYNC_EVERY_MS` في `auto-process.tsx`). تشغيلٌ مجدولٌ نجح داخلها يُغني عنها.
 */
export const BROWSER_SYNC_EVERY_MS = 3 * 60 * 60_000;

/* ─────────────────────────── الحارس ─────────────────────────── */

export interface SystemActor {
  /** معرّفُ المالك — يُكتب فاعلاً، وبتفويض درايفه يُقرأ. */
  id: string;
  role: Role;
  label: typeof CRON_ACTOR_LABEL;
}

/** رفضٌ يُقال بسببه ويُسجَّل — لا ٥٠٠ صامتة. */
export class CronRefusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CronRefusal";
  }
}

type OwnerRow = { id: string; role: Role };

async function activeOwners(): Promise<OwnerRow[]> {
  return db.select({ id: users.id, role: users.role }).from(users)
    .where(and(eq(users.role, "OWNER"), eq(users.isActive, true))).limit(2);
}

/** المالكُ الواحد النشط — غيرُه لا يُختار: من لا يُعرف تفويضُه لا يُستعار. */
export async function resolveSystemActor(load: () => Promise<OwnerRow[]> = activeOwners): Promise<SystemActor> {
  const owners = await load();
  if (owners.length !== 1) {
    throw new CronRefusal(503, owners.length === 0
      ? "لا يوجد مالك نشط يعمل التشغيل المجدول باسمه وتفويضه"
      : "يوجد أكثر من مالك نشط، فلا يُعرف تفويضُ من يُستعمل");
  }
  return { id: owners[0].id, role: owners[0].role, label: CRON_ACTOR_LABEL };
}

export interface CronGuardDeps {
  secret?: string | undefined;
  loadOwners?: () => Promise<OwnerRow[]>;
}

/** يتحقّق من السرّ ثمّ من الفاعل الآليّ وصلاحيّته. يرمي `CronRefusal`؛ والمسار يترجم بـ`cronRefused`. */
export async function cronGuard(request: Request, capability: Capability, deps: CronGuardDeps = {}): Promise<SystemActor> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  const auth = checkCronAuth(request.headers.get("authorization"), secret);
  if (auth === "unset") throw new CronRefusal(503, "CRON_SECRET غير مضبوط في الخادم، فلا يُقبل تشغيل مجدول");
  if (auth !== "ok") throw new CronRefusal(401, "سرّ التشغيل المجدول غائب أو غير صحيح");
  const actor = await resolveSystemActor(deps.loadOwners);
  if (!can(actor.role, capability)) throw new CronRefusal(403, `الفاعل الآلي لا يملك صلاحية ${capability}`);
  return actor;
}

export function cronRefused(e: unknown, route: string): NextResponse | null {
  if (!(e instanceof CronRefusal)) return null;
  logEvent("cron-refused", { route, status: e.status, reason: e.message }, e.status === 401 ? "warn" : "error");
  return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
}

/* ─────────────────────────── الأثر ─────────────────────────── */

/** أنجح تشغيلٌ مجدولٌ لهذا العمل قريباً؟ — تسأله القشرةُ قبل أن تعيد عمله. وتعذّرُ السؤال «لا». */
export async function scheduledRanRecently(job: CronJob, withinMs: number): Promise<boolean> {
  return ranRecently(await loadCronRun(job).catch(() => null), withinMs);
}

export interface CronOutcome {
  ok: boolean;
  result: string;
  /** `false`: لم يجرِ شيء لأنّ غيرَه يجري — لا يُكتب فوق أثر من يعمل. */
  record: boolean;
}

/** يجري العملَ باسم الفاعل الآليّ، ويكتب أثره، ويردّ: ٢٠٠ لما وقع أو تُرك عمداً، و٥٠٢ للفشل. */
export async function runCron(job: CronJob, work: () => Promise<CronOutcome>): Promise<NextResponse> {
  let outcome: CronOutcome;
  try {
    outcome = await runAsSystem(CRON_ACTOR_LABEL, work);
  } catch (e) {
    outcome = { ok: false, result: `تعطّل: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e)}`, record: true };
  }
  if (outcome.record) await recordCronRun(job, outcome).catch(() => undefined);
  logEvent("cron", { job, ok: outcome.ok, result: outcome.result }, outcome.ok ? "info" : "error");
  return NextResponse.json({ ok: outcome.ok, job, result: outcome.result }, { status: outcome.ok ? 200 : 502 });
}

/* ─────────────────────────── فودكس ─────────────────────────── */

export interface FoodicsCronDeps {
  configured: () => boolean;
  run: (o: { actorId: string; budgetMs: number }) => Promise<{ busy: true } | { busy: false; result: SyncResult }>;
  now: () => number;
}

/** ميزانيّةُ الجولة — عمرُ عقد المزامنة سبعون ثانية، فلا تطول جولةٌ عليه. */
const FOODICS_ROUND_MS = 40_000;
/** لا تبدأ جولةٌ بعد هذا من عمر المسار (٣٠٠ ثانية). */
const FOODICS_TOTAL_MS = 200_000;

export async function foodicsCronJob(actor: SystemActor, deps: FoodicsCronDeps): Promise<CronOutcome> {
  if (!deps.configured()) return { ok: true, record: true, result: "فودكس غير مربوط بهذا الخادم، فلم يُقرأ شيء" };
  const startedAt = deps.now();
  let written = 0, revised = 0, rounds = 0;
  for (;;) {
    const r = await deps.run({ actorId: actor.id, budgetMs: FOODICS_ROUND_MS });
    if (r.busy) {
      return rounds === 0
        ? { ok: true, record: false, result: "مزامنة أخرى مع فودكس تجري الآن، فلم يُعَد شيء" }
        : { ok: true, record: true, result: `قُرئ ${written} طلباً جديداً، والباقي تكمله المزامنة الجارية` };
    }
    rounds++;
    const { result } = r;
    if (result.status === "FAILED") return { ok: false, record: true, result: `تعذّرت مزامنة فودكس: ${result.error ?? "سبب غير معروف"}` };
    written += result.counts.salesWritten;
    revised += result.counts.linesRevised;
    if (result.status === "OK") break;
    if (deps.now() - startedAt > FOODICS_TOTAL_MS) {
      return { ok: true, record: true, result: `قُرئ ${written} طلباً جديداً، وبقي جزء يُكمَل في التشغيل القادم` };
    }
  }
  return {
    ok: true, record: true,
    result: written + revised > 0 ? `قُرئ ${written} طلباً جديداً و${revised} سطراً تغيّر` : "لا جديد في فودكس",
  };
}

export function defaultFoodicsDeps(run: FoodicsCronDeps["run"]): FoodicsCronDeps {
  return { configured: foodicsConfigured, run, now: Date.now };
}

/* ─────────────────────────── الدرايف والمراجعة ─────────────────────────── */

interface DriveReply {
  status: number;
  paused?: boolean;
  busy?: boolean;
  needsAuth?: boolean;
  error?: string;
  created: number;
  truncated: boolean;
  pendingMonths: string[];
}

export interface DriveCronDeps {
  paused: () => Promise<boolean>;
  sync: (body: DriveSyncBody) => Promise<DriveReply>;
  sweep: () => Promise<SweepOutcome>;
  deepDue: () => Promise<boolean>;
  markDeep: () => Promise<void>;
  now: () => number;
}

/** الفحصُ الأوسع (سنةٌ كاملة) مرّةً في الأسبوع — كالقشرة: فاتورةُ يوليو التي تصل في أكتوبر. */
const DEEP_EVERY_MS = 7 * 24 * 60 * 60_000;
const DEEP_MONTHS = 12;
/** لا تُستأنف أشهرٌ بعد هذا من عمر المسار — ويبقى للمراجعة ما يكفيها. */
const DRIVE_CONTINUE_MS = 150_000;
const SWEEP_START_MS = 200_000;

export async function driveCronJob(deps: DriveCronDeps): Promise<CronOutcome> {
  if (await deps.paused()) return { ok: true, record: true, result: "العمل الآلي موقوف بيد صاحبه، فلم يجرِ شيء" };
  const startedAt = deps.now();
  const deep = await deps.deepDue();
  let r = await deps.sync({ apply: true, readContent: true, months: deep ? DEEP_MONTHS : 2, background: true });
  if (r.busy) return { ok: true, record: false, result: "مزامنة أخرى تقرأ الدرايف الآن، فلم يُعَد شيء" };
  let created = 0;
  for (;;) {
    if (r.paused) return { ok: true, record: true, result: "العمل الآلي موقوف بيد صاحبه، فلم يجرِ شيء" };
    if (r.needsAuth) return { ok: false, record: true, result: `تفويض الدرايف لحساب المالك غائب أو منتهٍ: ${r.error ?? ""}`.trim() };
    if (r.status >= 400) return { ok: false, record: true, result: `تعذّرت مزامنة الدرايف: ${r.error ?? `ردّ ${r.status}`}` };
    if (r.busy) break;
    created += r.created;
    if (!(r.truncated && r.pendingMonths.length > 0) || deps.now() - startedAt > DRIVE_CONTINUE_MS) break;
    r = await deps.sync({ apply: true, readContent: true, onlyMonths: r.pendingMonths, background: true });
  }
  const finished = !r.truncated && !r.busy;
  if (deep && finished) await deps.markDeep();

  const parts = [created > 0 ? `سُجّل ${created} ملفاً جديداً من الدرايف` : "لا ملف جديد في الدرايف"];
  if (!finished) parts.push("وبقيت أشهر تُفحص في التشغيل القادم");
  if (deps.now() - startedAt < SWEEP_START_MS) {
    const s = await deps.sweep();
    if (s.kind === "ran") parts.push(s.message);
    else if (s.kind === "forbidden") return { ok: false, record: true, result: `${parts.join("، ")} · ${s.error}` };
  }
  return { ok: true, record: true, result: parts.join(" · ") };
}

/** ردُّ المزامنة كما تردّه للشاشة — يُقرأ نصّاً ثمّ يُفسَّر، بلا افتراضٍ عن شكله. */
export async function readDriveReply(res: Response): Promise<DriveReply> {
  let data: unknown = null;
  try { data = JSON.parse(await res.text()); } catch { /* ردٌّ غير JSON — يُقال برقمه */ }
  const get = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);
  const summary = get(data, "summary");
  const pending = get(summary, "pendingMonths");
  const error = get(data, "error");
  return {
    status: res.status,
    paused: get(data, "paused") === true,
    busy: get(data, "busy") === true,
    needsAuth: get(data, "needsAuth") === true,
    error: typeof error === "string" ? error : undefined,
    created: typeof get(summary, "created") === "number" ? Number(get(summary, "created")) : 0,
    truncated: get(summary, "truncated") === true,
    pendingMonths: Array.isArray(pending) ? pending.filter((m): m is string => typeof m === "string") : [],
  };
}

export function defaultDriveDeps(
  actor: SystemActor,
  services: {
    paused: () => Promise<boolean>;
    runDriveSync: (a: { id: string }, body: DriveSyncBody) => Promise<Response>;
    sweep: (a: SystemActor) => Promise<SweepOutcome>;
  },
): DriveCronDeps {
  return {
    paused: services.paused,
    /* كلُّ جولةٍ تحت موعدٍ معلَن كما في مسار الشاشة — نداءاتُ القراءة تأخذ ما بقي منه */
    sync: async (body) => readDriveReply(await withDeadline(55_000, () => services.runDriveSync(actor, body))),
    sweep: () => withDeadline(60_000, () => services.sweep(actor)),
    deepDue: () => isDue("cron:drive-deep", "deep", DEEP_EVERY_MS),
    markDeep: () => markRan("cron:drive-deep", "deep"),
    now: Date.now,
  };
}

/* ─────────────────────────── لقطةُ اليوم ─────────────────────────── */

export interface DailyCronDeps {
  day: () => string;
  gather: () => Promise<DayFigures>;
  write: (day: string, f: DayFigures) => Promise<boolean>;
}

export async function dailyCronJob(deps: DailyCronDeps): Promise<CronOutcome> {
  const day = deps.day();
  const figures = await deps.gather();
  const written = await deps.write(day, figures);
  if (!written) return { ok: true, record: true, result: `لقطة يوم ${day} مكتوبة من قبل، ولم تتغيّر` };
  const cash = figures.cashMinor === null ? "النقد غير معروف" : `النقد ${formatRiyalsDisplay(figures.cashMinor)}`;
  return {
    ok: true, record: true,
    result: `كُتبت لقطة يوم ${day}: عليك ${formatRiyalsDisplay(figures.owedMinor)} · ${figures.attentionCount} بنداً يحتاج قرارك · ${cash}`,
  };
}
