import { describe, expect, it } from "vitest";
import { testDatabaseProblem } from "./test-database";

describe("قاعدة اختبارات القاعدة", () => {
  it("تُقبَل المحلّيّة المنتهية بـ_test", () => {
    expect(testDatabaseProblem("postgres://tph@127.0.0.1:55432/tph_f3_test")).toBeNull();
    expect(testDatabaseProblem("postgresql://postgres:postgres@localhost:5432/tph_ci_test")).toBeNull();
  });

  it("تُرفَض سلسلة Neon ولو انتهى اسمها بـ_test", () => {
    expect(testDatabaseProblem("postgresql://u:p@ep-x-pooler.c-2.us-east-2.aws.neon.tech/neondb_test")).toMatch(/ليس محلّيّاً/);
  });

  it("تُرفَض المحلّيّة المنسوخة من الإنتاج", () => {
    expect(testDatabaseProblem("postgres://tph@127.0.0.1:55432/tph_f3")).toMatch(/_test/);
  });

  it("ويُرفَض الغياب — لا يُستعاض عنه بـDATABASE_URL", () => {
    expect(testDatabaseProblem(undefined)).toMatch(/TEST_DATABASE_URL/);
    expect(testDatabaseProblem("not a url")).toMatch(/صالحة/);
  });
});
