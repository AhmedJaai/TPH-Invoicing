import { describe, expect, it } from "vitest";
import { placeIn } from "./document-queue.service";

describe("placeIn — موضعُ المستند في طابور «ينتظر»", () => {
  const ids = ["a", "b", "c"];

  it("في الوسط: سابقٌ وتالٍ وترتيبٌ من واحد", () => {
    expect(placeIn(ids, "b")).toEqual({ position: 2, total: 3, prevId: "a", nextId: "c" });
  });

  it("الأخير بلا تالٍ — فيعود الحسمُ إلى صندوق الوارد", () => {
    expect(placeIn(ids, "c").nextId).toBeNull();
  });

  it("خرج من الطابور للتوّ: التالي أوّلُ ما بقي", () => {
    expect(placeIn(["b", "c"], "a")).toEqual({ position: null, total: 2, prevId: null, nextId: "b" });
  });

  it("طابورٌ فارغ: لا تالٍ ولا موضع", () => {
    expect(placeIn([], "a")).toEqual({ position: null, total: 0, prevId: null, nextId: null });
  });
});
