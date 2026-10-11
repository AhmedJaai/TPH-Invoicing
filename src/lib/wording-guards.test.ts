import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «فعلٌ واحد باسمٍ واحد» في كلمة الخروج: **«إلغاء»** لترك نموذجٍ أو إقرارٍ لم يقع،
 * و**«تراجع»** لنقض فعلٍ وقع وحده (زرُّ الإشعار، وما يردّ اختياراً محفوظاً). كانت
 * ثلاثُ كلمات («تراجع» · «إلغاء» · «أغلق») لشيءٍ واحد، فيُظنّ أنّ «تراجع» ينقض ما كُتب.
 */
function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsx(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("كلمةُ الخروج واحدة", () => {
  it("زرٌّ يترك نموذجاً لا يُسمّى «تراجع»", () => {
    const offenders = [...tsx("src/components"), ...tsx("src/app")].filter((file) =>
      /<button\b[^>]*>\s*تراجع\s*<\/button>/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
