import { describe, expect, it } from "vitest";
import {
  buildOrderList, buildOrderMessage, lastPurchaseFromLine, lineCost, proposeQuantity, supplierTotals,
  type LastInvoiceLine, type LastPurchase, type OrderCandidate,
} from "./order-list";

const item = (id: string, onShelfMilli: number, dailyUseMilli: number, extra: Partial<OrderCandidate> = {}): OrderCandidate => ({
  productId: id, name: `صنف ${id}`, baseUnit: "G",
  cover: { onShelfMilli, dailyUseMilli, daysLeft: dailyUseMilli > 0 ? Math.floor(onShelfMilli / dailyUseMilli) : null },
  ...extra,
});

const bought = (supplierId: string, packMilli: number | null, packPriceMinor: number | null): LastPurchase => ({
  supplierId, supplierName: `مورد ${supplierId}`, supplierSlug: supplierId, phoneE164: null,
  description: "بند", day: "2026-11-01", packMilli, packPriceMinor,
});

/* الكيلو = 1,000,000 مِلّي‑جرام؛ والصرفُ اليوميّ 500 جرام = 500,000 */
const KG = 1_000_000;

describe("قائمة الطلب", () => {
  it("تطلب ما يكفي التوصيلَ وأسبوعين ناقصاً ما على الرف، مرفوعاً إلى العبوة", () => {
    /* على الرف 2 كجم، يُصرف نصف كيلو يومياً ← يكفي 4 أيام. الحاجة 0.5 × 16 − 2 = 6 كجم */
    const [g] = buildOrderList([item("a", 2 * KG, KG / 2)], new Map([["a", bought("s1", KG * 2.5, 9000)]]));
    expect(g.lines[0].needMilli).toBe(6 * KG);
    expect(g.lines[0].packs).toBe(3); /* 6 ÷ 2.5 = 2.4 ← 3 عبوات */
    expect(g.lines[0].orderMilli).toBe(7.5 * KG);
    expect(g.lines[0].costMinor).toBe(27_000);
    expect(g.totalMinor).toBe(27_000);
  });

  it("الرف الفارغ يُطلب له كاملُ المدة", () => {
    const [g] = buildOrderList([item("a", 0, KG)], new Map([["a", bought("s1", KG, 100)]]));
    expect(g.lines[0].daysLeft).toBe(0);
    expect(g.lines[0].packs).toBe(16);
  });

  it("ما لا صرفَ له لا يدخل — لا يُعرف متى ينفد", () => {
    expect(buildOrderList([item("a", 0, 0)], new Map())).toEqual([]);
    expect(buildOrderList([{ productId: "b", name: "ب", baseUnit: "G", cover: null }], new Map())).toEqual([]);
  });

  it("ما يكفي أكثر من المدة لا يدخل، ويدخل حين تطول", () => {
    const items = [item("a", 10 * KG, KG)]; /* يكفي 10 أيام */
    expect(buildOrderList(items, new Map())).toEqual([]);
    expect(buildOrderList(items, new Map(), { horizonDays: 14 })).toHaveLength(1);
  });

  it("السعر المجهول يبقى مجهولاً، والمجموع لا يُكتب رقماً", () => {
    const [g] = buildOrderList(
      [item("a", 0, KG), item("b", 0, KG)],
      new Map([["a", bought("s1", KG, 500)], ["b", bought("s1", KG, null)]]),
    );
    expect(g.lines.find((l) => l.productId === "b")!.costMinor).toBeNull();
    expect(g.knownCostMinor).toBe(16 * 500);
    expect(g.unknownCostLines).toBe(1);
    expect(g.totalMinor).toBeNull();
  });

  it("صنفٌ لم يُشترَ بفاتورة: مورّدٌ غير معروف، آخراً، وبالوحدة الكاملة لا بالعبوة", () => {
    const groups = buildOrderList(
      [item("never", KG / 3, KG / 4), item("a", 0, KG)],
      new Map([["a", bought("s1", KG, 100)]]),
    );
    expect(groups.map((g) => g.supplierId)).toEqual(["s1", null]);
    const l = groups[1].lines[0];
    expect(l.packs).toBeNull();
    expect(l.costMinor).toBeNull();
    expect(l.description).toBeNull();
    expect(l.orderMilli % 1000).toBe(0);
    expect(l.orderMilli).toBeGreaterThanOrEqual(l.needMilli);
    expect(groups[1].totalMinor).toBeNull();
  });

  it("تُجمع الأصناف بمورّدها، والأعجلُ أوّلاً في كل مجموعة وبين المجموعات", () => {
    const groups = buildOrderList(
      [item("a", 5 * KG, KG), item("b", KG, KG), item("c", 3 * KG, KG)],
      new Map([["a", bought("s1", KG, 1)], ["b", bought("s2", KG, 1)], ["c", bought("s1", KG, 1)]]),
    );
    expect(groups.map((g) => g.supplierId)).toEqual(["s2", "s1"]);
    expect(groups[1].lines.map((l) => l.productId)).toEqual(["c", "a"]);
  });

  it("الكميات والمبالغ أعداد صحيحة", () => {
    const [g] = buildOrderList([item("a", 333_333, 77_777)], new Map([["a", bought("s1", 333_333, 1999)]]));
    for (const l of g.lines) {
      expect(Number.isInteger(l.orderMilli)).toBe(true);
      expect(Number.isInteger(l.costMinor)).toBe(true);
    }
  });
});

describe("عبوة الشراء وسعرها من آخر بند", () => {
  const line = (over: Partial<LastInvoiceLine> = {}): LastInvoiceLine => ({
    productId: "p", supplierId: "s", supplierName: "مورد", supplierSlug: "s", phoneE164: "+966500000000",
    description: "حليب كرتون", day: "2026-11-10", qty: "4", lineTotalMinor: 21_840,
    packSize: "6", contentUnit: "L", contentQuantity: "1.75", ...over,
  });

  it("كرتونٌ فيه 6 × 1.75 لتر بأربعة بـ218.40 ← العبوة 10.5 لتر بـ54.60", () => {
    const p = lastPurchaseFromLine(line(), "ML");
    expect(p.packMilli).toBe(10_500_000);
    expect(p.packPriceMinor).toBe(5460);
  });

  it("بلا مواصفة عبوة: لا عبوة ولا سعر", () => {
    const p = lastPurchaseFromLine(line({ packSize: null }), "ML");
    expect(p.packMilli).toBeNull();
    expect(p.packPriceMinor).toBeNull();
  });

  it("كمية غير مقروءة: العبوة معروفة والسعر مجهول لا صفر", () => {
    const p = lastPurchaseFromLine(line({ qty: null }), "ML");
    expect(p.packMilli).toBe(10_500_000);
    expect(p.packPriceMinor).toBeNull();
  });

  it("وزنٌ لصنفٍ يُقاس حجماً: لا عبوة", () => {
    expect(lastPurchaseFromLine(line({ contentUnit: "KG" }), "ML").packMilli).toBeNull();
  });
});

describe("أجزاء الحساب", () => {
  it("لا حاجة ← لا طلب", () => {
    expect(proposeQuantity(0, 1000)).toEqual({ packs: 0, orderMilli: 0 });
    expect(proposeQuantity(-5, null)).toEqual({ packs: null, orderMilli: 0 });
  });
  it("الكلفة تحتاج العبوة والسعر معاً", () => {
    expect(lineCost(3, 100)).toBe(300);
    expect(lineCost(null, 100)).toBeNull();
    expect(lineCost(3, null)).toBeNull();
    expect(lineCost(0, 100)).toBe(0);
  });
  it("المجموع بلا أسطر صفرٌ معروف، وبسطرٍ مجهول غير معروف", () => {
    expect(supplierTotals([])).toEqual({ knownCostMinor: 0, unknownCostLines: 0, totalMinor: 0 });
    expect(supplierTotals([100, null])).toEqual({ knownCostMinor: 100, unknownCostLines: 1, totalMinor: null });
  });
});

describe("رسالة الطلب", () => {
  it("تحيّي المورّد باسمه وتسرد الأصناف بأرقام لاتينية", () => {
    const text = buildOrderMessage("مورد", [{ label: "حليب كرتون", quantity: "3 × كرتون" }]);
    expect(text.split("\n")[0]).toBe("السلام عليكم مورد،");
    expect(text).toContain("• حليب كرتون: 3 × كرتون");
    expect(text).not.toMatch(/[٠-٩]/);
  });
  it("بلا اسم مورّد تبقى مهذّبة", () => {
    expect(buildOrderMessage(null, []).startsWith("السلام عليكم،")).toBe(true);
  });
});
