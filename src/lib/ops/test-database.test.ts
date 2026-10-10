import { describe, expect, it } from "vitest";
import { needsBranchMarker, neonEndpointOf, testDatabaseProblem } from "./test-database";

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

  /*
    ── فرعُ Neon للاختبار: بإقرارٍ يسمّي نقطتَه بعينها ──
    والعلَمُ في الفرع يُفحَص عند بدء التشغيل (`src/test/branch-marker.ts`).
  */
  const BRANCH = "postgresql://u:p@ep-quiet-test-12345678.c-2.us-east-2.aws.neon.tech/tph_test?sslmode=require";
  const BRANCH_POOLED = "postgresql://u:p@ep-quiet-test-12345678-pooler.c-2.us-east-2.aws.neon.tech/tph_test?sslmode=require";
  const PROD = "postgresql://u:p@ep-prod-main-87654321-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

  it("فرعُ Neon يُقبَل حين يُسمّى معرّفُ نقطته — مجمَّعاً أو مباشراً", () => {
    const env = { TEST_DATABASE_NEON_ENDPOINT: "ep-quiet-test-12345678" };
    expect(testDatabaseProblem(BRANCH, env)).toBeNull();
    expect(testDatabaseProblem(BRANCH_POOLED, env)).toBeNull();
    expect(testDatabaseProblem(BRANCH, { TEST_DATABASE_NEON_ENDPOINT: " ep-quiet-test-12345678-pooler " })).toBeNull();
  });

  it("وقاعدةٌ في الفرع المُقَرّ لا ينتهي اسمُها بـ_test تُرفَض — نسخةُ بيانات الإنتاج `neondb` لا تُمَسّ", () => {
    const env = { TEST_DATABASE_NEON_ENDPOINT: "ep-quiet-test-12345678" };
    expect(testDatabaseProblem(BRANCH.replace("/tph_test", "/neondb"), env)).toMatch(/_test/);
  });

  it("وسلسلةُ الإنتاج لا تمرّ بإقرارِ فرعٍ آخر", () => {
    expect(testDatabaseProblem(PROD, { TEST_DATABASE_NEON_ENDPOINT: "ep-quiet-test-12345678" })).toMatch(/ليست فرعَ الاختبار/);
  });

  it("ولا يمرّ فرعٌ بلا إقرار، ولا بإقرارٍ فارغ", () => {
    expect(testDatabaseProblem(BRANCH)).toMatch(/ليس محلّيّاً/);
    expect(testDatabaseProblem(BRANCH, {})).toMatch(/ليس محلّيّاً/);
    expect(testDatabaseProblem(BRANCH, { TEST_DATABASE_NEON_ENDPOINT: "  " })).toMatch(/ليس محلّيّاً/);
  });

  it("والإقرارُ لا يفتح مضيفاً سحابيّاً غير Neon ولا مضيفاً يشبهه", () => {
    const env = { TEST_DATABASE_NEON_ENDPOINT: "ep-quiet-test-12345678" };
    expect(testDatabaseProblem("postgresql://u:p@db.example.com/x_test", env)).toMatch(/ولا نقطةَ Neon/);
    expect(testDatabaseProblem("postgresql://u:p@ep-quiet-test-12345678.neon.tech.evil.com/x", env)).toMatch(/ولا نقطةَ Neon/);
  });

  it("والإقرارُ لا يُرخي شرطَ المحلّيّة", () => {
    expect(testDatabaseProblem("postgres://tph@127.0.0.1:55432/tph_f3", { TEST_DATABASE_NEON_ENDPOINT: "ep-x" })).toMatch(/_test/);
  });

  it("معرّفُ النقطة يُقرأ من المضيف بلا لاحقة المجمِّع", () => {
    expect(neonEndpointOf("ep-quiet-test-12345678-pooler.c-2.us-east-2.aws.neon.tech")).toBe("ep-quiet-test-12345678");
    expect(neonEndpointOf("ep-quiet-test-12345678.us-east-2.aws.neon.tech")).toBe("ep-quiet-test-12345678");
    expect(neonEndpointOf("localhost")).toBeNull();
    expect(neonEndpointOf("something.neon.tech")).toBeNull();
  });

  it("العلَمُ يُطلَب من كلّ قاعدةٍ بعيدة، ولا يُطلَب من المحلّيّة", () => {
    expect(needsBranchMarker(BRANCH)).toBe(true);
    expect(needsBranchMarker("postgresql://postgres:postgres@localhost:5432/tph_ci_test")).toBe(false);
    expect(needsBranchMarker("postgresql://postgres:postgres@postgres:5432/tph_ci_test")).toBe(false);
    expect(needsBranchMarker(undefined)).toBe(false);
  });
});
