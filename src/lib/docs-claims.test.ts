import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";

/**
 * الوثيقة تُقارَن بالشيفرة — لا تُصدَّق.
 *
 * وجدت مراجعة سبتمبر أحدَ عشر موضعاً يخالف فيه `CLAUDE.md` الواقع: جدول
 * هجراتٍ ينقصه ملفّ، وأوامر محذوفة ما زالت موصوفة، وملفّاتٌ في جدول
 * المكتبات. وثلاث روايات لعددٍ واحد تُسقط الثقة بالبقيّة. فما يمكن فحصه
 * آلياً يُفحَص هنا.
 */
const claude = readFileSync("CLAUDE.md", "utf8");
const scripts = Object.keys(
  (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts,
);

describe("CLAUDE.md يطابق المستودع", () => {
  it("جدول الهجرات هو عينُ مجلّد drizzle/sql", () => {
    const listed = [...claude.matchAll(/^\| `(\d{3}_[\w-]+\.sql)` \|/gm)].map((m) => m[1]).sort();
    const onDisk = readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql")).sort();
    expect(listed).toEqual(onDisk);
  });

  it("كلّ أمرٍ مذكور موجودٌ في package.json", () => {
    const named = new Set(
      [...claude.matchAll(/`(?:npm run )?((?:db|drive|ops|bench|try):[\w-]+)`/g)].map((m) => m[1]),
    );
    expect([...named].filter((n) => !scripts.includes(n))).toEqual([]);
  });

  it("كلّ ملفٍّ في جدول المكتبات موجود", () => {
    const files = [...claude.matchAll(/^\| `((?:src|scripts)\/[^`]+\.tsx?)` \|/gm)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("لا أمرَ يطبّق المخطّط بلا هجرة", () => {
    expect(scripts).not.toContain("db:push");
  });
});
