import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
  كلّ نصٍّ يُفعَّل بعلم كتابة («apply» · «--apply» · «--commit») يمرّ بـ
  assertWriteAllowed. كان خمسةٌ منها محروسة وأربعة عشر لا — ومنها
  db:dedupe الذي حذف صفوفاً حقيقيّة من قبل.
*/
describe("النصوص الكاتبة", () => {
  it("كلّ علمِ كتابةٍ يمرّ بالإقرار المكتوب", () => {
    const offenders = readdirSync("scripts")
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => {
        const s = readFileSync(join("scripts", f), "utf8");
        const hasWriteFlag = /\b(?:process\.argv|args)\.includes\("(?:apply|--apply|--commit)"\)/.test(s);
        return hasWriteFlag && !s.includes("assertWriteAllowed");
      });
    expect(offenders).toEqual([]);
  });
});
