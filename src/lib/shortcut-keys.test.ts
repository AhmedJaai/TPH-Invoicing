import { describe, expect, it } from "vitest";
import { shortcutKey } from "./shortcut-keys";

describe("shortcutKey — الاختصارُ بموضع المفتاح حين يكون التخطيطُ عربيّاً", () => {
  it("التخطيطُ اللاتينيّ: الحرفُ كما وصل، كبيراً أو صغيراً", () => {
    expect(shortcutKey({ key: "g", code: "KeyG" })).toBe("g");
    expect(shortcutKey({ key: "K", code: "KeyK", shiftKey: true })).toBe("k");
  });

  it("التخطيطُ العربيّ: «ل» على مفتاح G هي g، و«ت» j، و«ن» k، و«ع» u", () => {
    expect(shortcutKey({ key: "ل", code: "KeyG" })).toBe("g");
    expect(shortcutKey({ key: "ت", code: "KeyJ" })).toBe("j");
    expect(shortcutKey({ key: "ن", code: "KeyK" })).toBe("k");
    expect(shortcutKey({ key: "ع", code: "KeyU" })).toBe("u");
    expect(shortcutKey({ key: "س", code: "KeyS" })).toBe("s");
  });

  it("علامةُ الاستفهام العربيّة واللاتينيّة سواء", () => {
    expect(shortcutKey({ key: "?", code: "Slash", shiftKey: true })).toBe("?");
    expect(shortcutKey({ key: "؟", code: "Slash", shiftKey: true })).toBe("?");
    /* في تخطيط ماك العربيّ تقع «؟» على مفتاحٍ آخر — الحرفُ يكفي */
    expect(shortcutKey({ key: "؟", code: "KeyQ", shiftKey: true })).toBe("?");
  });

  it("«/» بحرفه، أو بموضعه حين يكتب المفتاحُ «ظ»", () => {
    expect(shortcutKey({ key: "/", code: "Slash" })).toBe("/");
    expect(shortcutKey({ key: "ظ", code: "Slash" })).toBe("/");
    /* «/» العربيّة على مفتاحٍ آخر (Z في بعض التخطيطات) تبقى بحثاً لا حرفاً */
    expect(shortcutKey({ key: "/", code: "KeyZ" })).toBe("/");
  });

  it("تخطيطٌ لاتينيٌّ غير QWERTY يبقى على حرفه المطبوع لا موضعه", () => {
    /* Dvorak: المفتاحُ في موضع KeyG يكتب i */
    expect(shortcutKey({ key: "i", code: "KeyG" })).toBe("i");
  });

  it("مفاتيحُ التحكّم والأرقام ليست اختصاراً", () => {
    expect(shortcutKey({ key: "Enter", code: "Enter" })).toBeNull();
    expect(shortcutKey({ key: "Escape", code: "Escape" })).toBeNull();
    expect(shortcutKey({ key: "ArrowDown", code: "ArrowDown" })).toBeNull();
    expect(shortcutKey({ key: "١", code: "Digit1" })).toBeNull();
    expect(shortcutKey({ key: "Dead", code: "KeyE" })).toBeNull();
  });

  it("حدثٌ بلا code (متصفّحٌ قديم) لا يرمي", () => {
    expect(shortcutKey({ key: "ل" })).toBeNull();
    expect(shortcutKey({ key: "j" })).toBe("j");
  });
});
