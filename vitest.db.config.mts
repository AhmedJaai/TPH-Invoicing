import { defineConfig } from "vitest/config";
import path from "node:path";
import { testDatabaseProblem } from "./src/lib/ops/test-database";
import { assertTestBranchMarker } from "./src/test/branch-marker";

/**
 * اختبارات تلمس قاعدة — `npm run test:db`.
 *
 * «الاختبارات النقيّة لا تُثبت أنّ النظام يعمل»: ١٨٠١ اختباراً خضراء بينما
 * عطوبٌ ماليّة في مساراتٍ لا يلمسها واحدٌ منها. فهذه تمرّر الخدمات نفسها على
 * المخطّط الحقيقيّ، وكلّ اختبارٍ في معاملةٍ تُلغى (`src/test/db.ts`).
 *
 * والقاعدة من `TEST_DATABASE_URL` وحده، ويُرفَض ما ليس محلّيّاً أو ليس
 * `*_test` قبل أن يُحمَّل ملفّ اختبار. وفرعُ Neon للاختبار يُقبَل بإقرارٍ يسمّي
 * نقطتَه (`TEST_DATABASE_NEON_ENDPOINT`) وبعلَمٍ فيه يُفحَص هنا (`src/test/branch-marker.ts`) —
 * الطريقة في `docs/decisions/engineering-ops.md`.
 */
const url = process.env.TEST_DATABASE_URL;
const problem = testDatabaseProblem(url, {
  TEST_DATABASE_NEON_ENDPOINT: process.env.TEST_DATABASE_NEON_ENDPOINT,
});
if (problem) throw new Error(`✕ ${problem}`);
// قاعدةٌ بعيدة لا تُمَسّ قبل أن يُرى علَمُ فرع الاختبار فيها — والمحلّيّة لا يُفتَح لها اتّصالٌ هنا
await assertTestBranchMarker(url);

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    // `@/db` يقرأ DATABASE_URL عند تحميله — فيُضبط هنا قبل أيّ استيراد
    env: { DATABASE_URL: url! },
    // الملفّات تتشارك قاعدةً واحدة؛ والمعاملات تُلغى، لكنّ الأقفال تتزاحم
    fileParallelism: false,
  },
});
