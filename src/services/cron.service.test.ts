import { describe, expect, it } from "vitest";
import {
  CronRefusal, cronGuard, dailyCronJob, driveCronJob, foodicsCronJob, readDriveReply, resolveSystemActor,
  type DriveCronDeps, type SystemActor,
} from "./cron.service";
import { runLeasedFoodicsSync, type SyncCounts, type SyncResult } from "./foodics-sync.service";
import type { DayFigures } from "./daily-figures.service";
import { snapshotDay } from "@/lib/cron";
import { tagAuditAfter } from "@/lib/audit";
import { CRON_ACTOR_LABEL, runAsSystem, systemActorLabel } from "@/lib/actor-context";

const actor: SystemActor = { id: "owner-1", role: "OWNER", label: CRON_ACTOR_LABEL };
const owner = async () => [{ id: "owner-1", role: "OWNER" as const }];
const req = (auth?: string) =>
  new Request("https://tph.test/api/cron/foodics", { method: "POST", headers: auth ? { authorization: auth } : {} });
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof CronRefusal ? e.status : "other"));

describe("حارس التشغيل المجدول", () => {
  it("بلا سرّ، أو بسرٍّ خاطئ: ٤٠١ — ولا يُسأل عن المالك", async () => {
    let asked = false;
    const load = async () => { asked = true; return owner(); };
    expect(await refusal(cronGuard(req(), "inventory:count", { secret: "s3cret", loadOwners: load }))).toBe(401);
    expect(await refusal(cronGuard(req("Bearer nope"), "inventory:count", { secret: "s3cret", loadOwners: load }))).toBe(401);
    expect(asked).toBe(false);
  });

  it("CRON_SECRET غير مضبوط في الخادم: ٥٠٣ لكلّ طلب، ولو حمل سرّاً", async () => {
    expect(await refusal(cronGuard(req("Bearer s3cret"), "inventory:count", { secret: undefined, loadOwners: owner }))).toBe(503);
    expect(await refusal(cronGuard(req("Bearer "), "inventory:count", { secret: "", loadOwners: owner }))).toBe(503);
  });

  it("السرُّ الصحيح: الفاعلُ الآليّ المالكُ الواحد باسم system:cron", async () => {
    expect(await cronGuard(req("Bearer s3cret"), "document:upload", { secret: "s3cret", loadOwners: owner }))
      .toEqual({ id: "owner-1", role: "OWNER", label: "system:cron" });
  });

  it("لا مالك نشط، أو أكثر من واحد: يُرفض ولا يُخمَّن تفويضُ أحد", async () => {
    expect(await refusal(resolveSystemActor(async () => []))).toBe(503);
    expect(await refusal(resolveSystemActor(async () => [{ id: "a", role: "OWNER" }, { id: "b", role: "OWNER" }]))).toBe(503);
  });

  it("والصلاحيّةُ تُسأل كما يسألها الحارس: دورٌ لا يملكها يُرفض ٤٠٣", async () => {
    const auditor = async () => [{ id: "x", role: "AUDITOR" as const }];
    expect(await refusal(cronGuard(req("Bearer s3cret"), "document:upload", { secret: "s3cret", loadOwners: auditor }))).toBe(403);
  });
});

describe("سجلّ التدقيق يسمّي الفاعل الآليّ", () => {
  it("داخل التشغيل المجدول يُوسَم القيد، وخارجه لا", async () => {
    expect(systemActorLabel()).toBeNull();
    const inside = await runAsSystem(CRON_ACTOR_LABEL, async () => systemActorLabel());
    expect(inside).toBe("system:cron");
    expect(systemActorLabel()).toBeNull();
  });

  it("الوسمُ يُضمّ إلى الأثر، وما ليس كائناً يُحفظ تحت «القيمة»", () => {
    expect(tagAuditAfter({ الحال: "مؤرشف" }, { "المنفّذ": "system:cron" })).toEqual({ الحال: "مؤرشف", "المنفّذ": "system:cron" });
    expect(tagAuditAfter(null, { "المنفّذ": "system:cron" })).toEqual({ القيمة: null, "المنفّذ": "system:cron" });
    expect(tagAuditAfter({ a: 1 }, {})).toEqual({ a: 1 });
    expect(tagAuditAfter(undefined, {})).toBeNull();
  });
});

/* ─────────────── العقد: تشغيلان متداخلان — الثاني لا يعمل ─────────────── */

/** عقدٌ في الذاكرة بمعنى `acquireLease` نفسه: يُؤخَذ إن لم يكن أو انقضى عمره. */
function memoryLease(clock: () => number) {
  const rows = new Map<string, { holder: string; at: number }>();
  return {
    acquire: async (name: string, holder: string, ttlMs: number) => {
      const row = rows.get(name);
      if (row && row.at >= clock() - ttlMs) return false;
      rows.set(name, { holder, at: clock() });
      return true;
    },
    release: async (name: string, holder: string) => {
      const row = rows.get(name);
      if (row?.holder === holder) rows.set(name, { holder, at: 0 });
    },
  };
}

const counts = (over: Partial<SyncCounts> = {}): SyncCounts => ({
  ordersRead: 0, ordersMirrored: 0, salesWritten: 0, salesRestated: 0, linesRevised: 0, purchases: 0, suppliers: 0,
  tills: 0, stockCounts: 0, moveDays: 0, rejected: 0, problems: [], partial: false, ...over,
});
const result = (status: SyncResult["status"], over: Partial<SyncCounts> = {}, error: string | null = null): SyncResult =>
  ({ runId: "r", status, counts: counts(over), error });

describe("مزامنةُ فودكس تحت عقدها", () => {
  it("تشغيلان معاً (المجدولُ والشاشة): واحدٌ يقرأ، والثاني `busy` بلا نداء", async () => {
    const lease = memoryLease(() => Date.now());
    let calls = 0;
    let finish!: () => void;
    const gate = new Promise<void>((r) => { finish = r; });
    const run = async () => { calls++; await gate; return result("OK"); };
    const first = runLeasedFoodicsSync({ actorId: "owner-1", budgetMs: 40_000 }, { ...lease, run });
    const second = await runLeasedFoodicsSync({ actorId: "u2", budgetMs: 40_000 }, { ...lease, run });
    expect(second).toEqual({ busy: true });
    finish();
    expect((await first).busy).toBe(false);
    expect(calls).toBe(1);
    /* وبعد ردّ العقد تعمل التالية */
    expect((await runLeasedFoodicsSync({ actorId: "u2", budgetMs: 40_000 }, { ...lease, run })).busy).toBe(false);
  });

  it("والعقدُ يُردّ وإن رمت المزامنة", async () => {
    const lease = memoryLease(() => Date.now());
    const boom = async (): Promise<SyncResult> => { throw new Error("انقطع"); };
    await expect(runLeasedFoodicsSync({ actorId: null, budgetMs: 1 }, { ...lease, run: boom })).rejects.toThrow("انقطع");
    expect((await runLeasedFoodicsSync({ actorId: null, budgetMs: 1 }, { ...lease, run: async () => result("OK") })).busy).toBe(false);
  });
});

describe("عملُ فودكس المجدول", () => {
  const deps = (replies: ({ busy: true } | { busy: false; result: SyncResult })[], configured = true) => {
    const seen: { actorId: string }[] = [];
    let i = 0;
    return {
      seen,
      deps: {
        configured: () => configured,
        run: async (o: { actorId: string; budgetMs: number }) => { seen.push(o); return replies[Math.min(i++, replies.length - 1)]; },
        now: () => 0,
      },
    };
  };

  it("مزامنةٌ أخرى تجري: نجاحٌ بلا عمل، ولا يُكتب فوق أثرها", async () => {
    const { deps: d } = deps([{ busy: true }]);
    expect(await foodicsCronJob(actor, d)).toMatchObject({ ok: true, record: false });
  });

  it("جولاتٌ حتى يكتمل ما تغيّر — باسم المالك", async () => {
    const { deps: d, seen } = deps([
      { busy: false, result: result("PARTIAL", { salesWritten: 30 }) },
      { busy: false, result: result("OK", { salesWritten: 4, linesRevised: 2 }) },
    ]);
    const out = await foodicsCronJob(actor, d);
    expect(out).toMatchObject({ ok: true, record: true });
    expect(out.result).toContain("34");
    expect(seen.map((s) => s.actorId)).toEqual(["owner-1", "owner-1"]);
  });

  it("الفشلُ يُسمَع بسببه", async () => {
    const { deps: d } = deps([{ busy: false, result: result("FAILED", {}, "401 من فودكس") }]);
    expect(await foodicsCronJob(actor, d)).toMatchObject({ ok: false, record: true, result: expect.stringContaining("401 من فودكس") });
  });

  it("غيرُ مربوط: لا نداء، ويُقال", async () => {
    const { deps: d, seen } = deps([], false);
    expect((await foodicsCronJob(actor, d)).ok).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe("عملُ الدرايف المجدول", () => {
  const ok = { status: 200, created: 0, truncated: false, pendingMonths: [] as string[] };
  const make = (replies: Awaited<ReturnType<DriveCronDeps["sync"]>>[], over: Partial<DriveCronDeps> = {}) => {
    const bodies: unknown[] = [];
    let swept = 0, deepMarked = 0, i = 0;
    const deps: DriveCronDeps = {
      paused: async () => false,
      sync: async (b) => { bodies.push(b); return replies[Math.min(i++, replies.length - 1)]; },
      sweep: async () => { swept++; return { kind: "ran", message: "اعتُمد مستندان", counts: { recorded: 0, approved: 2, renamed: [], reread: 0, notes: [], handLinked: 0, done: [] } }; },
      deepDue: async () => false,
      markDeep: async () => { deepMarked++; },
      now: () => 0,
      ...over,
    };
    return { deps, bodies, swept: () => swept, deepMarked: () => deepMarked };
  };

  it("موقوفٌ بيد صاحبه: لا مزامنة ولا مراجعة", async () => {
    const m = make([ok], { paused: async () => true });
    expect((await driveCronJob(m.deps)).ok).toBe(true);
    expect(m.bodies).toEqual([]);
    expect(m.swept()).toBe(0);
  });

  it("مزامنةٌ أخرى تقرأ الآن: الثاني لا يعمل ولا يُكتب أثره", async () => {
    const m = make([{ ...ok, busy: true }]);
    expect(await driveCronJob(m.deps)).toMatchObject({ ok: true, record: false });
    expect(m.swept()).toBe(0);
  });

  it("تفويضُ المالك غائب: فشلٌ مسمّى (٥٠٢ فيصل بريدُ GitHub)", async () => {
    const m = make([{ ...ok, needsAuth: true, error: "حسابك غير مفوَّض على الدرايف" }]);
    expect(await driveCronJob(m.deps)).toMatchObject({ ok: false, result: expect.stringContaining("غير مفوَّض") });
  });

  it("يزامن ثمّ يراجع — والمزامنةُ بالبوّابة الخلفيّة نفسها", async () => {
    const m = make([{ ...ok, created: 3 }]);
    const out = await driveCronJob(m.deps);
    expect(out.ok).toBe(true);
    expect(out.result).toContain("3");
    expect(out.result).toContain("اعتُمد مستندان");
    expect(m.bodies).toEqual([{ apply: true, readContent: true, months: 2, background: true }]);
  });

  it("الفحصُ الأسبوعيّ الأوسع يُستأنف بأشهره الباقية، ويُطبع حين يكتمل وحده", async () => {
    const m = make([
      { ...ok, created: 1, truncated: true, pendingMonths: ["2026-01", "2026-02"] },
      { ...ok, created: 2 },
    ], { deepDue: async () => true });
    await driveCronJob(m.deps);
    expect(m.bodies).toEqual([
      { apply: true, readContent: true, months: 12, background: true },
      { apply: true, readContent: true, onlyMonths: ["2026-01", "2026-02"], background: true },
    ]);
    expect(m.deepMarked()).toBe(1);

    const cut = make([{ ...ok, truncated: true, pendingMonths: ["2026-01"] }], { deepDue: async () => true, now: (() => { let t = 0; return () => (t += 100_000); })() });
    await driveCronJob(cut.deps);
    expect(cut.deepMarked()).toBe(0);
  });

  it("ردُّ المزامنة يُقرأ نصّاً — وغيرُ JSON يُقال برقمه", async () => {
    expect(await readDriveReply(new Response("FUNCTION_INVOCATION_TIMEOUT", { status: 504 })))
      .toMatchObject({ status: 504, created: 0, busy: false });
    expect(await readDriveReply(Response.json({ busy: true, error: "تجري" })))
      .toMatchObject({ status: 200, busy: true, error: "تجري" });
    expect(await readDriveReply(Response.json({ summary: { created: 4, truncated: true, pendingMonths: ["2026-05", 7] } })))
      .toMatchObject({ created: 4, truncated: true, pendingMonths: ["2026-05"] });
  });
});

describe("لقطةُ اليوم", () => {
  const figures: DayFigures = { owedMinor: 1_234_500, attentionCount: 7, cashMinor: null, cashAsOf: null };

  it("يومُ اللقطة يومُ الرياض", () => {
    /* ٠٢:٣٠ UTC = ٠٥:٣٠ الرياض من اليوم نفسه — موعدُ التشغيل */
    expect(snapshotDay(new Date("2026-10-23T02:30:00Z"))).toBe("2026-10-23");
    /* ٢١:٠٠ UTC = منتصف ليل الرياض: صار الغد */
    expect(snapshotDay(new Date("2026-10-23T21:00:00Z"))).toBe("2026-10-24");
    expect(snapshotDay(new Date("2026-10-23T20:59:59Z"))).toBe("2026-10-23");
  });

  it("مرّةً في اليوم: التشغيلُ الثاني لا يغيّر ما كُتب — والنقدُ المجهول يُقال مجهولاً", async () => {
    const store = new Map<string, DayFigures>();
    const deps = {
      day: () => "2026-10-23",
      gather: async () => figures,
      write: async (day: string, f: DayFigures) => { if (store.has(day)) return false; store.set(day, f); return true; },
    };
    const first = await dailyCronJob(deps);
    expect(first.ok).toBe(true);
    expect(first.result).toContain("النقد غير معروف");
    expect(first.result).not.toContain("0.00");
    const second = await dailyCronJob({ ...deps, gather: async () => ({ ...figures, owedMinor: 1 }) });
    expect(second).toMatchObject({ ok: true, result: expect.stringContaining("من قبل") });
    expect(store.get("2026-10-23")?.owedMinor).toBe(1_234_500);
  });
});
