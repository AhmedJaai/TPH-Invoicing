import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * حارسُ المفردات: **اسمٌ واحد للشيء الواحد**.
 *
 * كان المفهوم الواحد يحمل ستّة أسماء في ستّ شاشات — «المستحقّ
 * للمورّدين» و«عليك للمورّدين» و«المستحقّ عليك» و«الصافي»، و«سداد بلا
 * فاتورة» و«دفعات بلا فاتورة» و«لك عند مورّدين». فمن انتقل بين شاشتين
 * ظنّ أنّه انتقل بين مفهومين، وبحث عن فرقٍ لا وجود له.
 *
 * والرجوعُ إلى ذلك لا يكسر اختباراً ولا يرميه مترجم — يمرّ في المراجعة
 * ويُكتشَف بعد شهرٍ من الارتباك. فيُحرَس نصّاً.
 *
 * وهذا حارسُ **نصٍّ يُعرَض للمستخدم**، لا حارسُ تعليقات: التعليقُ الذي
 * يحكي تاريخ الاسم القديم مطلوب، فيُستثنى.
 */

const ROOTS = ["src/app", "src/components"];

/** الاسم المهجور ← الاسم الوحيد الذي يحلّ محلّه. */
const BANNED: { bad: RegExp; use: string; why: string }[] = [
  {
    bad: /"المستحقّ للمورّدين"|>المستحقّ للمورّدين</,
    use: "عليك للمورّدين",
    why: "الرقم نفسه كان يُعرَض في أربع شاشات بأربعة أسماء",
  },
  {
    bad: /"سداد بلا فاتورة"|>سداد بلا فاتورة</,
    use: "دفعات لم تُنسب إلى فاتورة",
    why: "كان يعدّ ١٣ دفعة بينما التنبيه يقول ١٠ تحت اسمٍ آخر",
  },
  {
    bad: /label="المستحقّ عليك"/,
    use: "عليك للمورّدين",
    why: "«عليك» و«المستحقّ عليك» مفهومٌ واحد",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** يُسقط التعليقات — فتاريخُ الاسم القديم يُكتب ولا يُعرَض. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("اسمٌ واحد للشيء الواحد", () => {
  const files = ROOTS.flatMap(walk);

  it("تُقرأ ملفّات الواجهة كلّها", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const { bad, use, why } of BANNED) {
    it(`لا يُكتب ما يخالف «${use}»`, () => {
      const offenders = files.filter((f) => bad.test(withoutComments(readFileSync(f, "utf8"))));
      expect(offenders, `${offenders.join(" · ")} — ${why}. استعمل «${use}».`).toEqual([]);
    });
  }
});
