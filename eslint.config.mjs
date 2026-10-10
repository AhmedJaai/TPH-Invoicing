import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tph from "./eslint-rules/index.mjs";

/*
  حرّاسُ المستودع — قواعدُ محلّيّة في `eslint-rules/index.mjs`، كلٌّ منها عطبٌ وقع.
  كانت انتظاماً في `code-guards.test.ts` و`allocation-sql.test.ts`؛ وهي الآن تُرى
  في المحرّر عند السطر. واختبارُها `src/lib/lint-rules.test.ts`.
*/
/** @type {import("eslint").Linter.Config[]} */
export const tphGuards = [
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    plugins: { tph },
    rules: {
      "tph/no-db-in-transaction": "error",
      "tph/no-column-in-correlated-subquery": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/drive.ts", "src/services/drive-rename.service.ts"],
    rules: { "tph/rename-file-only-in-service": "error" },
  },
  {
    // ما يُقرأ آلةً لا إنساناً: ملفُّ التحويل للبنك، ونصُّ النموذج، ومخرَجُ القراءة
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.ts",
      "src/lib/money.ts",
      "src/lib/payment-run.ts",
      "src/lib/extraction/validate-extraction.ts",
      "src/services/adjudicator.service.ts",
      "src/lib/bank/adjudicator-prompt.ts",
    ],
    rules: { "tph/no-inline-riyals-format": "error" },
  },
  {
    files: ["src/**/*.tsx", "src/components/**/*.ts"],
    rules: { "tph/no-bare-response-json": "error" },
  },
  {
    files: ["src/app/api/**/*.ts"],
    rules: {
      "tph/no-raw-error-body": "error",
      "tph/no-cast-request-body": "error",
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tphGuards,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // مساحةُ فحصٍ مؤقّتة، خارج الشجرة المتعقَّبة
    ".scratch/**",
  ]),
]);

export default eslintConfig;
