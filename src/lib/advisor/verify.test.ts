import { describe, expect, it } from "vitest";
import { verifiedNumbers } from "./verify";
import { splitNumbers } from "./numbers";
import type { Fact } from "@/lib/finance/reading";

const facts: Fact[] = [
  { id: "F1", label: "الإيراد بلا ضريبة في سبتمبر", kind: "SAR", value: 98_450 },
  { id: "F2", label: "تكلفة المبيعات من الإيراد", kind: "PCT", value: 28.4 },
];

describe("أرقامُ المستشار", () => {
  it("ما طابق حقيقةً يُقال من دفاترك، والعامُّ لا يُذكر", () => {
    const v = verifiedNumbers("بلغ الإيراد 98,450 ريالاً، وتكلفتك 28.4٪ والمعتاد بين 25٪ و35٪.", facts);
    expect(v).toEqual({ "num:98450": "الإيراد بلا ضريبة في سبتمبر", "pct:28.4": "تكلفة المبيعات من الإيراد" });
  });

  it("أعدادُ العدّ والسنواتُ وآفاقُ الخطّة لا تُوسَم", () => {
    expect(verifiedNumbers("خطة 90 يوماً في 2026 بثلاث 3 خطوات", facts)).toEqual({});
    expect(splitNumbers("خلال 90 يوماً").find((p) => p.kind === "number")).toMatchObject({ key: null });
  });

  it("يقطع النصّ عند كلّ رقم، ويترك اسماً فيه رقمٌ لاتينيّ", () => {
    const pieces = splitNumbers("الوسيط ٧ د، و V60 بـ 1,250 ريالاً");
    expect(pieces.filter((p) => p.kind === "number").map((p) => p.text)).toEqual(["٧", "1,250"]);
    expect(pieces.find((p) => p.kind === "number" && p.text === "1,250")).toMatchObject({ key: "num:1250" });
  });

  it("الساعةُ والتاريخُ لا يُوسمان، والنسبةُ لا تطابق إلّا نسبة", () => {
    const pctFact: Fact[] = [{ id: "F1", label: "تكلفة المبيعات", kind: "PCT", value: 20.7 }, { id: "F2", label: "الإيراد", kind: "SAR", value: 25 }];
    expect(verifiedNumbers("ذروة الساعة 21:00 وكشف 2026-10-27", pctFact)).toEqual({});
    /* 21 بلا ٪ ليس نسبة؛ و25٪ لا يطابق مبلغ 25 */
    expect(verifiedNumbers("بيع 21 كوباً، والتكلفة 25٪", pctFact)).toEqual({});
    expect(verifiedNumbers("التكلفة 20.7٪", pctFact)).toEqual({ "pct:20.7": "تكلفة المبيعات" });
    /* افتراضٌ عامّ «1٪» لا يطابق 0.7٪ بالتقريب؛ و21٪ يطابق 20.7٪ */
    const small: Fact[] = [{ id: "F1", label: "رسوم الشبكة", kind: "PCT", value: 0.7 }];
    expect(verifiedNumbers("رسوم 1٪", small)).toEqual({});
    expect(verifiedNumbers("نحو 21٪", pctFact)).toEqual({ "pct:21": "تكلفة المبيعات" });
  });
});
