import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // اختبارات القاعدة في vitest.db.config.mts — تحتاج قاعدةً فلا تجري مع النقيّة
    exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"],
  },
});
