import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
  رمزُ الدرايف يُقرأ من الحارس وحده (`refreshTokenFor`).
  كان مساران يقرآن `accounts.refresh_token` مباشرةً، فمشى وضعُ التجربة
  — بلا دخول — على الأرشيف الحقيقيّ بتفويض المالك.
*/
const ALLOWED = new Set([
  "src/services/drive.service.ts",
  "src/auth.ts",
  "src/app/api/health/route.ts",
  "src/db/schema.ts",
  "src/lib/token-crypto.ts", // تعليقٌ يصف العمود، لا قراءة
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("رمز الدرايف", () => {
  it("لا يُقرأ accounts.refresh_token إلّا من مواضعه", () => {
    const offenders = walk("src").filter((f) => !ALLOWED.has(f) && readFileSync(f, "utf8").includes("accounts.refresh_token"));
    expect(offenders).toEqual([]);
  });
});
