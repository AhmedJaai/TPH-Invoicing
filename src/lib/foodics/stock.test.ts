import { describe, expect, it } from "vitest";
import { aggregateMoves, daysOf, stockCountRow, stockDayOf, toScaled } from "./stock";

describe("يومُ الرفّ: آخرُ يومِ بيعٍ سبق العدّ", () => {
  it("عدٌّ فجرَ الأحد قبل الثالثة هو رفُّ السبت", () => {
    /* ٢٢:٤٠ عالميّ = ١:٤٠ الأحد بتوقيت الرياض */
    expect(stockDayOf(new Date("2026-06-13T22:40:00Z"), "2026-06-13")).toBe("2026-06-13");
  });
  it("وعدٌّ صباحَ الأحد وقد أرّخه فودكس أحداً هو رفُّ السبت كذلك", () => {
    expect(stockDayOf(new Date("2026-06-07T02:46:27Z"), "2026-06-07")).toBe("2026-06-06");
  });
  it("وما لا تُقرأ لحظتُه يُؤخَذ يومُ عمله", () => {
    expect(stockDayOf(null, "2026-06-07")).toBe("2026-06-07");
  });
});

describe("toScaled: كسورٌ بلا ضربٍ عائم", () => {
  it("يقرأ النصَّ خانةً خانة", () => {
    expect(toScaled(1.005, 3)).toBe(1005);
    expect(toScaled(0.00025, 6)).toBe(250);
    expect(toScaled(-0.10199999999999998, 3)).toBe(-102);
    expect(toScaled(1.3639999999999999, 3)).toBe(1364);
  });
  it("والمجهولُ ليس صفراً", () => {
    expect(toScaled(null, 3)).toBeNull();
    expect(toScaled(Number.NaN, 3)).toBeNull();
  });
});

const item = (id: string, quantity: number, cost: number, factor: number | null = 1000) => ({
  id, name: `صنف ${id}`, sku: `sk-${id}`, storage_unit: "كرتون", ingredient_unit: "حبة",
  storage_to_ingredient_factor: factor, pivot: { quantity, cost },
});

describe("مجموعُ صرف اليوم", () => {
  it("يجمع الصنفَ عبر الطلبات ويعدّ الطلباتِ لا السطور", () => {
    const { rows, unread } = aggregateMoves([
      { id: "t1", type: 8, status: 4, business_date: "2026-10-10", items: [item("a", 0.002, 0.16), item("a", 0.001, 0.08)] },
      { id: "t2", type: 8, status: 4, business_date: "2026-10-10", items: [item("a", 0.002, 0.16)] },
      { id: "t3", type: 10, status: 4, business_date: "2026-10-10", items: [item("a", 0.001, 0.08)] },
    ]);
    expect(unread).toBe(0);
    const sold = rows.find((r) => r.kind === 8);
    expect(sold).toMatchObject({ storageMicro: 5000, ingredientMilli: 5000, costMicro: 40_000, txCount: 2 });
    expect(rows.find((r) => r.kind === 10)).toMatchObject({ storageMicro: 1000, txCount: 1 });
  });
  it("مصّاصةٌ من كرتون أربعة آلاف حبّةٌ واحدة لا صفر", () => {
    const { rows } = aggregateMoves([{ id: "t", type: 8, status: 4, business_date: "2026-10-10", items: [item("s", 0.00025, 0.02125, 4000)] }]);
    expect(rows[0].ingredientMilli).toBe(1000);
  });
  it("سطرٌ بلا معامِل يجعل وحدةَ الصرف مجهولةً لا ناقصة", () => {
    const { rows } = aggregateMoves([{ id: "t", type: 8, status: 4, business_date: "2026-10-10", items: [item("a", 1, 1), item("a", 1, 1, null)] }]);
    expect(rows[0].ingredientMilli).toBeNull();
    expect(rows[0].storageMicro).toBe(2_000_000);
  });
});

describe("صفوفُ الجرد", () => {
  it("المعدودُ كما كُتب، والفرقُ شاهدٌ بجانبه", () => {
    const row = stockCountRow({
      id: "c1", reference: "IC-000037", business_date: "2026-10-10", status: 2,
      created_at: "2026-10-10 22:38:50", updated_at: "2026-10-10 22:50:37", creator: { name: "Anas" },
      items: [{ ...item("x", 0, 0), pivot: { quantity: 5.931, variance_quantity: -0.10199999999999998, variance_cost: -9.8175 } }],
    });
    expect(row?.head).toMatchObject({ stockDay: "2026-10-10", creatorName: "Anas" });
    expect(row?.items[0]).toMatchObject({ quantityMilli: 5931, varianceQuantityMilli: -102, varianceCostMinor: -982, factorMilli: 1_000_000 });
  });
});

it("أيّامُ المدى شاملةَ الطرفين", () => {
  expect(daysOf("2026-09-29", "2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
});
