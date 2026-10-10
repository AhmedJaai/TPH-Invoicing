import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, formatLogLine, logEvent } from "./log";

const AT = new Date("2026-10-10T08:00:00.000Z");
const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe("describeError", () => {
  it("يقصّ قيمَ الإدخال من رسالة Drizzle ومن أثرها — المبالغُ والأسماءُ لا تدخل السجلّ", () => {
    const e = new Error('Failed query: insert into "payments" ("amount_minor","payee") values ($1,$2)\nparams: 150000,مؤسسة عمار');
    const facts = describeError(e);
    expect(facts.message).toContain("Failed query");
    expect(JSON.stringify(facts)).not.toContain("150000");
    expect(JSON.stringify(facts)).not.toContain("عمار");
  });

  it("رمزُ القاعدة يُؤخَذ من السبب حين يلفّه Drizzle، ورسالةُ السبب تُلحَق", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const e = Object.assign(new Error("Failed query: insert …\nparams: 1,2"), { cause });
    expect(describeError(e)).toMatchObject({ code: "23505" });
    expect(describeError(e).message).toContain("duplicate key");
    expect(describeError(e).message).not.toContain("params");
  });

  it("الأثرُ أربعةُ أسطرٍ في سطر، والرسالةُ ثلاثمئة حرفٍ على الأكثر", () => {
    const facts = describeError(new Error("x".repeat(900)));
    expect(facts.message).toHaveLength(300);
    expect(facts.stack?.split(" | ").length).toBeLessThanOrEqual(4);
    expect(facts.stack).not.toContain("\n");
  });

  it("وما ليس خطأً يُوصَف ولا يرمي", () => {
    expect(describeError("انقطع")).toEqual({ message: "انقطع" });
    expect(describeError(null)).toEqual({ message: "null" });
    expect(describeError(undefined)).toEqual({ message: "undefined" });
    expect(describeError({})).toEqual({ message: "خطأٌ بلا رسالة" });
    expect(describeError(Object.assign(new TypeError("لا"), { code: "ECONNRESET" }))).toMatchObject({ name: "TypeError", code: "ECONNRESET" });
  });
});

describe("formatLogLine", () => {
  it("سطرٌ واحد JSON: الحدثُ ووقتُه ثمّ الحقول", () => {
    const line = formatLogLine("slow-query", { durationMs: 812, route: "/api/bank-import" }, AT);
    expect(line).not.toContain("\n");
    expect(parse(line)).toEqual({ kind: "slow-query", at: "2026-10-10T08:00:00.000Z", durationMs: 812, route: "/api/bank-import" });
  });

  it("الحقولُ لا تغلب اسمَ الحدث ولا وقتَه", () => {
    expect(parse(formatLogLine("a", { kind: "b", at: "أمس" }, AT))).toEqual({ kind: "a", at: AT.toISOString() });
  });

  it("الأسرارُ تُحجَب باسم الحقل — كعكةٌ ورمزٌ وآيبان", () => {
    const got = parse(formatLogLine("x", {
      cookie: "session=abc", Authorization: "Bearer s3cr3t", apiKey: "sk-1", iban: "SA0380000000608010167519",
      nested: { refreshToken: "r-1", ok: 1 },
    }, AT));
    expect(JSON.stringify(got)).not.toMatch(/abc|s3cr3t|sk-1|SA038|r-1/);
    expect(got.nested).toEqual({ refreshToken: "[محجوب]", ok: 1 });
  });

  it("الخطأُ في حقلٍ يُختصَر، والنصُّ الطويل يُقصّ، والكائنُ العميق لا يُصبّ", () => {
    const got = parse(formatLogLine("x", {
      error: new Error("Failed query: select 1\nparams: 99"),
      long: "ن".repeat(2_000),
      row: { id: "inv-1", supplier: { name: "مورّد" }, at: new Date("2026-09-01T00:00:00Z") },
      big: BigInt(12),
      nan: Number.NaN,
      skip: undefined,
      fn: () => 1,
    }, AT));
    expect((got.error as { message: string }).message).toBe("Failed query: select 1");
    expect((got.long as string).length).toBe(501);
    expect(got.row).toEqual({ id: "inv-1", supplier: "[كائن]", at: "2026-09-01T00:00:00.000Z" });
    expect(got.big).toBe("12");
    expect(got.nan).toBe("NaN");
    expect("skip" in got).toBe(false);
    expect("fn" in got).toBe(false);
  });

  it("ومرجعٌ دائريّ لا يُسقط السطر", () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(parse(formatLogLine("x", { loop }, AT))).toMatchObject({ kind: "x", loop: { a: 1, self: "[كائن]" } });
  });
});

describe("logEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("يكتب سطراً واحداً على مستواه", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logEvent("request-error", { route: "/api/x" });
    logEvent("ai-usage-skipped", {}, "warn");
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(parse(String(error.mock.calls[0][0]))).toMatchObject({ kind: "request-error", route: "/api/x" });
  });

  it("ولا يرمي ولو تعذّرت الكتابة", () => {
    vi.spyOn(console, "error").mockImplementation(() => { throw new Error("stdout مغلق"); });
    expect(() => logEvent("x")).not.toThrow();
  });
});
