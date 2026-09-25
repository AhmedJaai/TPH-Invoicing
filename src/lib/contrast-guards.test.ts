import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  التباينُ مضمونٌ في الرموز لا في العين.

  نظامُ التصميم الثاني ألوانٌ لا أبيضُ وأسودُ خالصان — والنصُّ الخافت على
  الأرضيّة الورقيّة أقربُ الأزواج إلى السقوط. فيُقرأ `globals.css` نفسُه،
  ويُحسب تباينُ كلّ زوجٍ يُكتب به نصٌّ في الواجهة، بالفاتح والداكن معاً،
  على حدّ WCAG AA: ٤٫٥ للنصّ، و٣ لحدود الحقول. فمن غيّر رمزاً فأسقط زوجاً
  سقط هذا قبل أن تسقط عينُ صاحب المقهى.
*/
const css = readFileSync("src/app/globals.css", "utf8");

function block(selector: string): string {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`لا كتلة ${selector} في globals.css`);
  const open = css.indexOf("{", i);
  let depth = 0;
  for (let k = open; k < css.length; k++) {
    if (css[k] === "{") depth++;
    else if (css[k] === "}" && --depth === 0) return css.slice(open + 1, k);
  }
  throw new Error(`كتلة ${selector} لا تنغلق`);
}

function tokens(body: string): Map<string, string> {
  return new Map([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(block(":root {"));
const dark = new Map([...light, ...tokens(block(':root[data-theme="dark"]'))]);

/** [النصّ، الخلفيّة، الحدّ الأدنى] — كلُّ زوجٍ يُكتب به نصٌّ أو يُرسم به حدُّ حقل. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["ink", "surface", 4.5], ["ink-soft", "surface", 4.5],
  ["muted", "surface", 4.5], ["muted", "raised", 4.5], ["muted", "sunken", 4.5], ["muted", "hover", 4.5],
  ["accent", "raised", 4.5], ["accent", "surface", 4.5], ["accent-ink", "accent", 4.5], ["accent", "accent-soft", 4.5],
  ["ok", "ok-bg", 4.5], ["warn", "warn-bg", 4.5], ["danger", "danger-bg", 4.5], ["info", "info-bg", 4.5],
  ["ok", "raised", 4.5], ["warn", "raised", 4.5], ["danger", "raised", 4.5], ["info", "raised", 4.5],
  ["frame-ink", "frame", 4.5], ["frame-muted", "frame", 4.5], ["frame-accent", "frame", 4.5],
  ["line-input", "raised", 3],
];

describe("تباينُ الرموز على حدّ AA", () => {
  for (const [name, set] of [["الفاتح", light], ["الداكن", dark]] as const) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${name}: ${fg} على ${bg} ≥ ${min}`, () => {
        const a = set.get(fg);
        const b = set.get(bg);
        expect(a, `الرمز --${fg} غائب`).toBeDefined();
        expect(b, `الرمز --${bg} غائب`).toBeDefined();
        expect(contrast(a!, b!)).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

/*
  والداكنُ يُكتب مرّتين: لمن يتبع نظامَ جهازه (`prefers-color-scheme`) ولمن
  اختاره بزرّه (`data-theme`). فإن اختلفت الكتلتان رأى صاحبُ الجهاز الداكن
  لوناً غير الذي رآه من ضغط الزرّ — وسقط تباينٌ لا يفحصه أحد.
*/
describe("الداكنُ واحدٌ بطريقَيه", () => {
  it("كتلةُ نظام الجهاز تطابق كتلةَ الزرّ رمزاً رمزاً", () => {
    const media = tokens(block(':root:not([data-theme="light"]) {'));
    const button = tokens(block(':root[data-theme="dark"] {'));
    expect(media.size).toBeGreaterThan(10);
    expect(Object.fromEntries(media)).toEqual(Object.fromEntries(button));
  });
});
