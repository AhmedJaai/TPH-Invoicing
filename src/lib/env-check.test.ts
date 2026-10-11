import { describe, expect, it } from "vitest";
import { checkEnv, describeEnvProblem } from "./env-check";

const GOOD = {
  DATABASE_URL: "postgresql://u:p@ep-x-pooler.c-2.us-east-2.aws.neon.tech/db?sslmode=require",
  AUTH_SECRET: "s".repeat(40),
  GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "secret-value",
  COMPANY_VAT_NUMBER: "310007971600003",
  DRIVE_ACCOUNTS_FOLDER_ID: "folder-a",
  DRIVE_YEAR_2026_FOLDER_ID: "folder-26",
  DRIVE_YEAR_2027_FOLDER_ID: "folder-27",
  DEEPSEEK_API_KEY: "sk-test",
};

describe("فحصُ البيئة عند الإقلاع", () => {
  it("البيئةُ السليمة لا يُقال فيها شيء — والاختياريُّ الغائب ليس مشكلة", () => {
    expect(checkEnv(GOOD)).toEqual([]);
  });

  it("الناقصُ يُسمّى باسمه", () => {
    const { DEEPSEEK_API_KEY: _omit, ...rest } = GOOD;
    void _omit;
    expect(checkEnv(rest)).toEqual([{ name: "DEEPSEEK_API_KEY", kind: "missing", why: "قراءةُ المستندات" }]);
    expect(checkEnv({ ...GOOD, AUTH_SECRET: "   " }).map((p) => p.name)).toEqual(["AUTH_SECRET"]);
  });

  it("المعطوبُ يُفرَّق عن الناقص", () => {
    expect(checkEnv({ ...GOOD, COMPANY_VAT_NUMBER: "12345" })[0]).toMatchObject({ name: "COMPANY_VAT_NUMBER", kind: "malformed" });
    expect(checkEnv({ ...GOOD, DATABASE_URL: "mysql://x" })[0]).toMatchObject({ name: "DATABASE_URL", kind: "malformed" });
  });

  it("الاختياريُّ يُفحَص إن ضُبط وحده", () => {
    expect(checkEnv({ ...GOOD, DB_POOL_MAX: "5", AI_DAILY_BUDGET_USD: "2.5", TOKEN_ENCRYPTION_KEY: "k".repeat(32) })).toEqual([]);
    expect(checkEnv({ ...GOOD, DB_POOL_MAX: "" })).toEqual([]);
    /* ما كان يُهمَل بصمت: حجمُ تجمّعٍ خارج حدّه، وسقفُ إنفاقٍ لا يُقرأ عدداً */
    expect(checkEnv({ ...GOOD, DB_POOL_MAX: "20", AI_DAILY_BUDGET_USD: "ten", TOKEN_ENCRYPTION_KEY: "short" }).map((p) => [p.name, p.kind]))
      .toEqual([["TOKEN_ENCRYPTION_KEY", "malformed"], ["DB_POOL_MAX", "malformed"], ["AI_DAILY_BUDGET_USD", "malformed"]]);
  });

  it("لا تخرج قيمةٌ في أيّ مخرج", () => {
    const secret = "do-not-print-me";
    const problems = checkEnv({ ...GOOD, COMPANY_VAT_NUMBER: secret, TOKEN_ENCRYPTION_KEY: secret, DATABASE_URL: secret });
    expect(problems.length).toBe(3);
    expect(JSON.stringify(problems) + problems.map(describeEnvProblem).join("")).not.toContain(secret);
  });

  it("بيئةٌ فارغة تُعدَّد ولا ترمي", () => {
    expect(() => checkEnv({})).not.toThrow();
    expect(checkEnv({}).every((p) => p.kind === "missing")).toBe(true);
    expect(checkEnv({}).length).toBe(9);
  });
});
