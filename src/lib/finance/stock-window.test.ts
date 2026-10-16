import { describe, expect, it } from "vitest";
import { nearestCountDay, stockWindow } from "./stock-window";

/* أيّامُ عدّ المقهى الحقيقيّة (سبوت) من مرآة فودكس */
const DAYS = ["2026-05-23", "2026-05-30", "2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27", "2026-07-04", "2026-07-25", "2026-08-01", "2026-08-29", "2026-09-26", "2026-10-03"];

describe("نافذة الجرد", () => {
  it("تبدأ غداة أقرب عدّ لعشيّة الشهر وتنتهي يوم أقرب عدّ لآخره", () => {
    expect(stockWindow("2026-06", DAYS)).toEqual({ month: "2026-06", from: "2026-05-31", to: "2026-06-27", openingCountDay: "2026-05-30", closingCountDay: "2026-06-27" });
  });
  it("والأشهر تتلاصق: نهاية يوليو بداية أغسطس", () => {
    const july = stockWindow("2026-07", DAYS);
    const august = stockWindow("2026-08", DAYS);
    expect(july.to).toBe("2026-08-01");
    expect(august.from).toBe("2026-08-02");
  });
  it("عند التساوي يؤخذ الأسبق، وأبعد من أربعة أيّام لا يقبل", () => {
    expect(nearestCountDay(["2026-09-26", "2026-10-04"], "2026-09-30")).toBe("2026-09-26");
    expect(nearestCountDay(["2026-09-20"], "2026-09-30")).toBeNull();
  });
  it("شهر بلا عدّ في أوّله يبقى على التقويم ويعلّم", () => {
    const may = stockWindow("2026-05", DAYS);
    expect(may).toMatchObject({ from: "2026-05-01", to: "2026-05-30", openingCountDay: null, closingCountDay: "2026-05-30" });
  });
  it("والشهر الجاري ينتهي عند آخر يوم بيع إن لم يعدّ آخره", () => {
    expect(stockWindow("2026-10", DAYS, "2026-10-11")).toMatchObject({ from: "2026-10-04", to: "2026-10-11", closingCountDay: null });
  });
});
