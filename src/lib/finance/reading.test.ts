import { describe, expect, it } from "vitest";
import { FactList, factsHash, numbersIn, validateReading } from "./reading";

function facts() {
  const f = new FactList();
  f.sar("إيراد سبتمبر", 13_219_116);          // F1 = 132191
  f.sar("إيراد أغسطس", 13_350_543);           // F2 = 133505
  f.pct("هامش مجمل الربح", 7_922);            // F3 = 79.2
  f.note("اكتمال الشهر", "ينقصه الإيجار");     // F4
  f.sar("الإيجار", null);                      // F5 غير معروف
  f.count("عدد الطلبات", 4612);               // F6
  return f.facts;
}

describe("أرقام النصّ", () => {
  it("تقرأ بالأرقام العربيّة واللاتينيّة وبفواصل الآلاف", () => {
    expect(numbersIn("بلغ ١٣٢٬١٩١ ريالاً و79.2٪ و4,612 طلباً")).toEqual([132191, 79.2, 4612]);
  });
});

describe("ما ليس قياساً لا يعدّ رقماً", () => {
  it("السنة بعد اسم شهرها، وما في اسم صنف، وما التصق بحرف", () => {
    expect(numbersIn("في سبتمبر 2026 بيع «كاسات ١٢ اونص» وIced V60 بـ 21772 ريالاً")).toEqual([21772]);
  });
  it("وسنة بلا شهر قبلها رقم كغيره", () => {
    expect(numbersIn("بلغ 2026 ريالاً")).toEqual([2026]);
  });
});

describe("التحقّق من قراءة النموذج", () => {
  it("جملة أرقامها من حقائقها تبقى", () => {
    const r = validateReading({ sentences: [{ section: "CHANGED", text: "الإيراد ١٣٢٬١٩١ ريالاً مقابل 133505 في أغسطس.", facts: ["F1", "F2"] }] }, facts());
    expect(r.sentences).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });
  it("رقم مخترع يسقط جملته", () => {
    const r = validateReading({ sentences: [{ section: "CHANGED", text: "تراجع الإيراد 1314 ريالاً.", facts: ["F1", "F2"] }] }, facts());
    expect(r.sentences).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });
  it("ورقم صحيح من حقيقة لم تسمّ يبقى — ويربط بأصله", () => {
    const r = validateReading({ sentences: [{ section: "CHANGED", text: "الإيراد 132191 ريالاً.", facts: ["F6"] }] }, facts());
    expect(r.sentences).toHaveLength(1);
    expect(r.sentences[0].facts).toEqual(["F6", "F1"]);
  });
  it("حقيقة لا وجود لها تسقطها", () => {
    expect(validateReading({ sentences: [{ section: "WHY", text: "السبب قد يكون الموسم.", facts: ["F99"] }] }, facts()).sentences).toHaveLength(0);
  });
  it("النسبة تقبل كما هي أو مقرّبة، والأعداد الصغيرة ليست ادّعاءً", () => {
    const r = validateReading({ sentences: [
      { section: "CHANGED", text: "الهامش 79.2٪ — نحو 79٪.", facts: ["F3"] },
      { section: "DO", text: "وزّع الإيجار على 6 أشهر ليكتمل الشهر.", facts: ["F4"] },
    ] }, facts());
    expect(r.sentences).toHaveLength(2);
  });
  it("قيمة غير معروفة لا ينسب إليها رقم", () => {
    expect(validateReading({ sentences: [{ section: "CHANGED", text: "الإيجار 47500 ريالاً.", facts: ["F5"] }] }, facts()).sentences).toHaveLength(0);
  });
  it("شكل فاسد لا يسقط الصفحة: قراءة فارغة", () => {
    expect(validateReading("ليس JSON", facts())).toEqual({ sentences: [], dropped: 0 });
    expect(validateReading({ sentences: [{ section: "X", text: "…", facts: [] }] }, facts()).dropped).toBe(1);
  });
});

it("البصمة تتغيّر بتغيّر رقم واحد", () => {
  const a = facts();
  const b = facts();
  b[0] = { ...b[0], value: 132192 };
  expect(factsHash(a)).not.toBe(factsHash(b));
  expect(factsHash(a)).toBe(factsHash(facts()));
});
