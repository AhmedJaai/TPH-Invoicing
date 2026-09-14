import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * فعلٌ واحد باسمٍ واحد — ويُحرَس نصّاً.
 *
 * كان تسجيل السداد بستّة أسماء، والإقرار بأربعة أفعال، و«تحتاج قرارك»
 * تُزال من شاشةٍ وتبقى في أخرى. ومن ينتقل بين شاشتين يظنّ أنّه انتقل بين
 * مفهومين. فالمعجم:
 *
 *   الموافقة على اقتراح      «أكّد»
 *   السداد على حساب المورّد  «سدِّد على حساب المورّد»
 *   الوسم اليدويّ             «سجّل أنّها سُدّدت»
 *   ما ينتظر إنساناً         «للمراجعة»
 *
 * والعدد يمرّ بـ`arabic.ts`: «{n} مرة» تُكتب «٣ مرة».
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const BANNED: [RegExp, string][] = [
  [/قيّدها على حسابه/, "سدِّد على حساب المورّد"],
  [/أعلن سدادها/, "سجّل أنّها سُدّدت"],
  [/اعتمد وطابِق/, "أكّد وطابِق"],
  [/ينتظر إقرارك/, "ينتظر تأكيدك"],
  [/تحتاج قرارك/, "للمراجعة"],
  [/سُدِّدت/, "سُدّدت"],
  [/جاهز للاعتماد/, "جاهز للتحويل"],
];

/* عددٌ في قالبٍ ثمّ تمييزٌ مكتوبٌ باليد — لا يمرّ بقاعدة العدد */
const RAW_COUNT = /\}\s*(?:يوماً|مرة|مرّة|ملفاً|ملفّاً|مجموعة|اسم بديل|سطر)(?=[\s·<`"]|$)/;

const FILES = walk("src");

describe("معجم الواجهة", () => {
  for (const file of FILES) {
    it(file, () => {
      const source = readFileSync(file, "utf8")
        /* التعليقات تحكي ما كان — لا تُعرض */
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const hits = BANNED.filter(([re]) => re.test(source)).map(([re, use]) => `«${re.source}» ← «${use}»`);
      if (RAW_COUNT.test(source)) hits.push(`عددٌ بلا تمييز: «${RAW_COUNT.exec(source)?.[0]}» ← countNoun`);
      expect(hits).toEqual([]);
    });
  }

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(RAW_COUNT.test("طُلب {i.orderCount} مرة ·")).toBe(true);
    expect(BANNED.some(([re]) => re.test("قيّدها على حسابه"))).toBe(true);
  });
});
