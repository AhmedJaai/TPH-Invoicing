import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dailyFigures, jobState } from "@/db/schema";
import { withRollback } from "@/test/db";
import { ranRecently } from "@/lib/cron";
import { acquireLease, loadCronRun, recordCronRun, releaseLease } from "./job-state.service";
import { writeDailyFigures } from "./daily-figures.service";

/*
  التشغيلُ المجدول على القاعدة الحقيقيّة: العقدُ يردّ الثاني، وأثرُ التشغيل يُقرأ كما كُتب،
  ولقطةُ اليوم تُكتب مرّةً ولا تتغيّر. (لقطةُ اليوم تحتاج هجرة `daily_figures`.)
*/
describe("التشغيل المجدول والعقد القائم", () => {
  it("عقدُ المزامنة: الثاني يُردّ وهو قائم، ويأخذه بعد ردّه — من أيّ باب", () =>
    withRollback(async (tx) => {
      const name = `test-lease-${Math.random()}`;
      expect(await acquireLease(name, "cron", 70_000, tx)).toBe(true);
      expect(await acquireLease(name, "browser", 70_000, tx)).toBe(false);
      /* ردُّ غير صاحبه لا يحرّره */
      await releaseLease(name, "browser", tx);
      expect(await acquireLease(name, "browser", 70_000, tx)).toBe(false);
      await releaseLease(name, "cron", tx);
      expect(await acquireLease(name, "browser", 70_000, tx)).toBe(true);
    }));

  it("أثرُ آخر تشغيل يُكتب فوق ما قبله ويُقرأ كما هو — وبه تتنحّى القشرة", () =>
    withRollback(async (tx) => {
      await tx.delete(jobState).where(eq(jobState.name, "cron:drive"));
      expect(await loadCronRun("drive", tx)).toBeNull();
      await recordCronRun("drive", { ok: false, result: "تفويض الدرايف لحساب المالك غائب" }, tx);
      const failed = await loadCronRun("drive", tx);
      expect(failed).toMatchObject({ ok: false, result: "تفويض الدرايف لحساب المالك غائب" });
      expect(ranRecently(failed, 3 * 3_600_000)).toBe(false);

      await recordCronRun("drive", { ok: true, result: "لا ملف جديد في الدرايف" }, tx);
      const ok = await loadCronRun("drive", tx);
      expect(ok?.ok).toBe(true);
      expect(ranRecently(ok, 3 * 3_600_000)).toBe(true);
      const rows = await tx.select().from(jobState).where(eq(jobState.name, "cron:drive"));
      expect(rows).toHaveLength(1);
    }));
});

describe("لقطةُ أرقام اليوم", () => {
  it("مرّةً في يوم الرياض: الثانيةُ لا تكتب ولا تغيّر — والنقدُ المجهول NULL لا صفر", () =>
    withRollback(async (tx) => {
      const day = "2099-01-15";
      expect(await writeDailyFigures(day, { owedMinor: 12_345_00, attentionCount: 4, cashMinor: null, cashAsOf: null }, tx)).toBe(true);
      expect(await writeDailyFigures(day, { owedMinor: 1, attentionCount: 99, cashMinor: 5_00, cashAsOf: "2099-01-14" }, tx)).toBe(false);
      const rows = await tx.select().from(dailyFigures).where(eq(dailyFigures.day, day));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ owedMinor: 12_345_00, attentionCount: 4, cashMinor: null, cashAsOf: null });
      /* واليومُ التالي يُكتب */
      expect(await writeDailyFigures("2099-01-16", { owedMinor: 0, attentionCount: 0, cashMinor: 0, cashAsOf: "2099-01-15" }, tx)).toBe(true);
    }));

  it("والقاعدةُ ترفض يوماً بغير صيغته", () =>
    withRollback(async (tx) => {
      const err = await tx.execute(sql`
        insert into daily_figures (day, owed_minor, attention_count) values ('15/01/2099', 0, 0)
      `).then(() => null, (e: unknown) => e);
      expect(err).not.toBeNull();
    }));
});
