import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMonths, forecastRunSchema } from "./forecast.service";

const valid = {
  issuedOn: "2026-11-25", historyFrom: "2026-05-24", historyTo: "2026-11-24",
  engineVersion: "1.0.0", durationMs: 1000, models: {}, summary: {},
  points: [["total", "NET_MINOR", "2026-11-25", null, 300_000, 420_000, 530_000], ["item:abc", "QTY_MILLI", "2026-11-25", 20, 1000, 2000, 3000]],
  context: [{ day: "2026-11-25", context: { tags: [] } }],
  backtests: [{ model: "ensemble", series: "total", metric: "NET_MINOR", horizon: "D1", wapeBp: 1013, biasBp: 72, coverageBp: 8900, n: 49 }],
};

describe("forecastRunSchema — ما يرسله المحرّك يُفحص لا يُصدَّق", () => {
  it("يقبل التشغيل السليم", () => {
    expect(forecastRunSchema.safeParse(valid).success).toBe(true);
  });

  it("يرفض العدد العشريّ في المال — الهللاتُ أعدادٌ صحيحة", () => {
    const bad = { ...valid, points: [["total", "NET_MINOR", "2026-11-25", null, 300_000.5, 420_000, 530_000]] };
    expect(forecastRunSchema.safeParse(bad).success).toBe(false);
  });

  it("يرفض حدوداً مقلوبة (p10 فوق p50)", () => {
    const bad = { ...valid, points: [["total", "NET_MINOR", "2026-11-25", null, 500_000, 420_000, 530_000]] };
    expect(forecastRunSchema.safeParse(bad).success).toBe(false);
  });

  it("يرفض سلسلةً ليست مجموعاً ولا صنفاً، وساعةً خارج اليوم، ومقياساً مجهولاً", () => {
    for (const p of [
      ["sales", "NET_MINOR", "2026-11-25", null, 1, 2, 3],
      ["total", "NET_MINOR", "2026-11-25", 24, 1, 2, 3],
      ["total", "PROFIT", "2026-11-25", null, 1, 2, 3],
      ["total", "NET_MINOR", "25-11-2026", null, 1, 2, 3],
      ["total", "NET_MINOR", "2026-11-25", null, -1, 2, 3],
    ]) {
      expect(forecastRunSchema.safeParse({ ...valid, points: [p] }).success, JSON.stringify(p)).toBe(false);
    }
  });

  it("يرفض تشغيلاً بلا نقطة", () => {
    expect(forecastRunSchema.safeParse({ ...valid, points: [] }).success).toBe(false);
  });
});

describe("التنبّؤ منعزل — لا يكتب إلّا في جداوله", () => {
  const src = readFileSync("src/services/forecast.service.ts", "utf8");

  it("كلُّ إدخالٍ وتعديلٍ وحذفٍ في جدولٍ من forecast_*", () => {
    const writes = [...src.matchAll(/\.(insert|update)\((\w+)\)/g)].map((m) => m[2]);
    expect(writes.length).toBeGreaterThan(0);
    for (const table of writes) expect(table, `${table} ليس من جداول التنبّؤ`).toMatch(/^forecast[A-Z]/);
    const deletes = [...src.matchAll(/delete from (\w+)/g)].map((m) => m[1]);
    for (const table of deletes) expect(table).toMatch(/^forecast_/);
  });

  it("ولا تقرؤه خدمةٌ ماليّة: لا يستورده إلّا مساراه وصفحتُه", () => {
    const users = execSync("grep -rl 'forecast.service' src --include=*.ts --include=*.tsx || true", { encoding: "utf8" })
      .split("\n").filter(Boolean).filter((f) => !f.endsWith("forecast.service.ts") && !f.endsWith("forecast.service.test.ts")).sort();
    expect(users).toEqual([
      "src/app/(app)/finance/forecast/page.tsx",
      "src/app/api/cron/forecast/route.ts",
      "src/app/api/forecast-event/route.ts",
    ]);
  });
});

describe("buildMonths — إقفالُ الشهر: ما بيع + اليوم + الباقي", () => {
  const days = (from: string, n: number, p50: number) => Array.from({ length: n }, (_, k) => {
    const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k);
    return { day: d.toISOString().slice(0, 10), p10: p50 - 10, p50, p90: p50 + 10 };
  });
  const net = days("2026-11-26", 31, 100); // ٢٦ نوفمبر … ٢٦ ديسمبر
  const periods = [
    { period: "2026-11", metric: "NET_MINOR", fromDay: "2026-11-26", days: 5, p10: 400, p50: 500, p90: 600, meta: { source: "daily" } },
    { period: "2026-12", metric: "NET_MINOR", fromDay: "2026-12-01", days: 31, p10: 2480, p50: 3100, p90: 3720, meta: { source: "mixed" } },
    { period: "2027-02", metric: "NET_MINOR", fromDay: "2027-02-01", days: 28, p10: 1400, p50: 2800, p90: 4200, meta: { unmeasured: ["رمضان"] } },
  ];
  const m = buildMonths({ today: "2026-11-26", periods, netDays: net, ordDays: [], past: [{ period: "2026-11", actualMinor: 9_000, orders: 300 }] });

  it("الشهرُ الجاري: الفعليُّ حتى أمس، واليومُ وحده، وما بعده من نقاط اليوم", () => {
    expect(m[0]).toMatchObject({ period: "2026-11", actualMinor: 9_000, ordersActual: 300, today: { p50: 100 } });
    expect(m[0].rest.p50).toBe(4 * 100); // ٢٧–٣٠ نوفمبر
    expect(m[0].source).toBe("daily");
  });

  it("شهرٌ يمتدّ بعد الأيّام اليوميّة: أيّامُه اليوميّة ثمّ معدّلُ المحرّك لما بعدها", () => {
    // ١–٢٦ ديسمبر يوميّة (٢٦ × ١٠٠)، و٢٧–٣١ بمعدّل المحرّك (٣١٠٠ ÷ ٣١ = ١٠٠)
    expect(m[1].rest.p50).toBe(26 * 100 + 5 * 100);
    expect(m[1].today).toBeNull();
    expect(m[1].actualMinor).toBe(0);
    expect(m[1].source).toBe("mixed");
  });

  it("الشهرُ البعيد كلُّه بنيويّ، ومداه نسبةُ مدى المحرّك، وما لم يُقَس يُقال", () => {
    expect(m[2]).toMatchObject({ period: "2027-02", source: "structural", unmeasured: ["رمضان"] });
    expect(m[2].rest).toEqual({ p10: 1400, p50: 2800, p90: 4200 });
  });
});
