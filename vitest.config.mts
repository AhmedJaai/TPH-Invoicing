import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

/** حيث تعني الطفرةُ الناجية مالاً خاطئاً — هي نفسُها `mutate` في stryker.config.json */
const MONEY_IDENTITY = [
  "src/lib/money.ts",
  "src/lib/vat.ts",
  "src/lib/allocation.ts",
  "src/lib/bank/optimizer.ts",
  "src/lib/bank/sync.ts",
  "src/lib/payroll/calc.ts",
  "src/lib/payroll/saudi-rules.ts",
  "src/lib/inventory/units.ts",
] as const;

type Floor = { statements: number; branches: number; functions: number; lines: number };
/* قيسَت في ٢٣ أكتوبر ٢٠٢٦ (بعد اختبارات الطفرات): ١٠٠٪ إلّا فروعَ optimizer ٩٢ وsync ٩٦ وcalc ٩٦ وsaudi-rules ٩٦/دوالّها ٩٦ */
const THRESHOLDS: Record<(typeof MONEY_IDENTITY)[number], Floor> = {
  "src/lib/money.ts": { statements: 99, branches: 99, functions: 99, lines: 99 },
  "src/lib/vat.ts": { statements: 99, branches: 99, functions: 99, lines: 99 },
  "src/lib/allocation.ts": { statements: 99, branches: 99, functions: 99, lines: 99 },
  "src/lib/bank/optimizer.ts": { statements: 99, branches: 91, functions: 99, lines: 99 },
  "src/lib/bank/sync.ts": { statements: 99, branches: 95, functions: 99, lines: 99 },
  "src/lib/payroll/calc.ts": { statements: 99, branches: 95, functions: 99, lines: 99 },
  "src/lib/payroll/saudi-rules.ts": { statements: 99, branches: 95, functions: 95, lines: 99 },
  "src/lib/inventory/units.ts": { statements: 99, branches: 99, functions: 99, lines: 99 },
};

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // اختبارات القاعدة في vitest.db.config.mts — تحتاج قاعدةً فلا تجري مع النقيّة
    exclude: [...configDefaults.exclude, "src/**/*.db.test.ts", ".stryker-tmp/**"],
    /*
      التغطية (`npm run test:coverage`) لوحدات المال والهويّة وحدها — وعتباتُها تحت ما تبلغه
      اليوم بقليل، فيقف الفحص إن نقصت. وقوّةُ الاختبارات نفسها في `npm run test:mutation`.
    */
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: [...MONEY_IDENTITY],
      thresholds: Object.fromEntries(MONEY_IDENTITY.map((f) => [f, THRESHOLDS[f]])),
    },
  },
});
