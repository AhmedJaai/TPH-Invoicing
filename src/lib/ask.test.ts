import { describe, expect, it } from "vitest";
import { matchSuppliersByText, parseQuestion, resolveAskedSupplier } from "./ask";

const NOW = "2026-10";

describe("سؤالٌ بالكلمات", () => {
  it("«كم دفعتُ للمراعي في سبتمبر؟»", () => {
    expect(parseQuestion("كم دفعتُ للمراعي في سبتمبر؟", NOW)).toEqual({ kind: "PAID", month: "2026-09", supplierText: "المراعي" });
  });

  it("الشراءُ والمستحقّ بكلماتهما", () => {
    expect(parseQuestion("كم اشتريت من بيكوف هذا الشهر", NOW)).toEqual({ kind: "BOUGHT", month: "2026-10", supplierText: "بيكوف" });
    expect(parseQuestion("كم عليّ للمراعي", NOW)).toEqual({ kind: "OWED", month: null, supplierText: "المراعي" });
  });

  it("شهرٌ بلا سنة هو آخرُ مرّةٍ مرّ، وبسنته كما كُتب", () => {
    expect(parseQuestion("كم دفعت لبيكوف في ديسمبر", NOW)?.month).toBe("2025-12");
    expect(parseQuestion("كم دفعت لبيكوف في مارس ٢٠٢٥", NOW)?.month).toBe("2025-03");
    expect(parseQuestion("كم دفعت لبيكوف الشهر الماضي", NOW)?.month).toBe("2026-09");
    expect(parseQuestion("كم دفعت لبيكوف 2026-07", NOW)?.month).toBe("2026-07");
  });

  it("حرفُ الجرّ لا يُنزَع من اسمٍ يبدأ به", () => {
    expect(parseQuestion("كم دفعت لبيكوف", NOW)?.supplierText).toBe("لبيكوف");
    expect(parseQuestion("كم دفعت للكوب الذهبي", NOW)?.supplierText).toBe("الكوب الذهبي");
  });

  it("ما ليس سؤالاً يمضي بحثاً كما كان", () => {
    expect(parseQuestion("المراعي", NOW)).toBeNull();
    expect(parseQuestion("كم", NOW)).toBeNull();
    expect(parseQuestion("كم فاتورة عندي", NOW)).toBeNull();
    expect(parseQuestion("كم دفعت في سبتمبر", NOW)).toBeNull();
  });
});

describe("أيُّ مورّدٍ يقصد", () => {
  const list = [
    { id: "a", names: ["المراعي"] },
    { id: "b", names: ["بيكوف", "Bekof"] },
    { id: "c", names: ["مراعي الجنوب"] },
  ];

  it("الاسمُ المطابقُ تماماً يغلب ما يحتويه", () => {
    expect(matchSuppliersByText(list, "المراعي").map((s) => s.id)).toEqual(["a"]);
  });

  it("الاسمُ المحتمِلُ لاثنين يُعيدهما — يُسأل ولا يُخمَّن", () => {
    expect(matchSuppliersByText(list, "مراعي").map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("«لبيكوف» تجد «بيكوف»؟ لا — لا يُنزَع حرفٌ بالتخمين", () => {
    expect(matchSuppliersByText(list, "لبيكوف")).toEqual([]);
    expect(matchSuppliersByText(list, "بيكوف").map((s) => s.id)).toEqual(["b"]);
  });

  it("لامُ الجرّ تُسقَط حين لا يطابق الاسمُ بها وحده", () => {
    expect(resolveAskedSupplier(list, "لبيكوف").map((s) => s.id)).toEqual(["b"]);
    expect(resolveAskedSupplier([...list, { id: "d", names: ["لبيكوف للتجارة"] }], "لبيكوف").map((s) => s.id)).toEqual(["d"]);
  });

  it("لا أحدَ ← فارغ", () => {
    expect(matchSuppliersByText(list, "لافا")).toEqual([]);
  });
});
