import { describe, expect, it } from "vitest";
import { foodicsExcelAdapter } from "@/lib/sales/foodics-excel";
import { parseFoodicsMoment, quantityToMilli, riyalsToMinor } from "./money";
import { mirrorOrder, ordersToSalesFile } from "./orders";
import { FoodicsOrder, ORDER_STATUS, PAYMENT_TYPE, PRODUCT_STATUS } from "./types";

/** طلبٌ كما تُرجعه الواجهة — ومعه ما لا نريده (العميل) ليُثبَت أنّه يسقط. */
function order(over: Record<string, unknown> = {}): FoodicsOrder {
  return FoodicsOrder.parse({
    id: "o-1", reference: 22690, business_date: "2026-10-10", status: ORDER_STATUS.CLOSED, type: 1, source: 1,
    subtotal_price: 28.69565, discount_amount: 0, total_price: 33,
    opened_at: "2026-10-10 20:21:00", closed_at: "2026-10-10 20:22:10",
    created_at: "2026-10-10 20:21:00", updated_at: "2026-10-10 20:22:10",
    branch: { name: "Branch 1", reference: "B01" },
    customer: { name: "فلان", phone: "0500000000" },
    products: [
      {
        id: "p-1", quantity: 1, unit_price: 25, total_price: 29, discount_amount: 0, total_cost: 4.66897, status: PRODUCT_STATUS.CLOSED,
        product: { sku: "sk-0013", name: "Matcha" },
        taxes: [{ pivot: { amount: 3.26087 } }],
        options: [
          { id: "op-1", quantity: 1, unit_price: 4, total_price: 4, tax_exclusive_total_price: 3.47826, modifier_option: { sku: "sk-0065", name: "Special milk" } },
          { id: "op-2", quantity: 1, unit_price: 0, total_price: 0, tax_exclusive_total_price: 0, modifier_option: { sku: "sk-0047", name: "Cold" } },
        ],
      },
      { id: "p-2", quantity: 1, unit_price: 4, total_price: 4, discount_amount: 0, status: PRODUCT_STATUS.CLOSED, product: { sku: "sk-0014", name: "Water" }, taxes: [{ pivot: { amount: 0.52174 } }], options: [] },
    ],
    payments: [{ id: "pay-1", amount: 33, tips: 0, business_date: "2026-10-10", added_at: "2026-10-10 20:22:09", payment_method: { name: "Mada", type: PAYMENT_TYPE.CARD } }],
    combos: [],
    ...over,
  });
}

describe("أرقامُ فودكس بلا عائمة", () => {
  it("الريالُ بكسوره إلى هللاتٍ صحيحة", () => {
    expect(riyalsToMinor(16.52174)).toBe(1652);
    expect(riyalsToMinor(1.005)).toBe(101);
    expect(riyalsToMinor(19)).toBe(1900);
    expect(riyalsToMinor(-9.4)).toBe(-940);
  });
  it("الغائبُ «غير معروف» لا صفر", () => {
    expect(riyalsToMinor(null)).toBeNull();
    expect(riyalsToMinor(undefined)).toBeNull();
    expect(quantityToMilli(Number.NaN)).toBeNull();
  });
  it("الكمّيّةُ بالمِلّي", () => {
    expect(quantityToMilli(0.33)).toBe(330);
    expect(quantityToMilli(48)).toBe(48_000);
  });
  it("اللحظةُ تُقرأ توقيتاً عالميّاً", () => {
    expect(parseFoodicsMoment("2026-10-09 23:42:25")?.toISOString()).toBe("2026-10-09T23:42:25.000Z");
    expect(parseFoodicsMoment("ليس تاريخاً")).toBeNull();
  });
});

describe("الطلبُ من الواجهة هو الطلبُ من الإكسل", () => {
  it("المفاتيحُ وبصمةُ المحتوى تطابق ما يُخرجه محوِّلُ الملفّ صفّاً بصفّ", () => {
    /* الصفوفُ نفسُها كما في تصديرٍ حقيقيّ للطلب 22690 */
    const header = ["order_reference", "business_date", "branch_reference", "type", "sku", "parent_item_sku", "name", "quantity", "unit_price", "total_price", "total_taxes", "status", "order_status", "discount_amount"];
    const grid = [
      header,
      ["22690", "2026-10-10", "B01", "Product", "sk-0013", "", "Matcha", "1", "25.000", "29", "3.26087", "Done", "Done", "0"],
      ["22690", "2026-10-10", "B01", "Modifier Option", "sk-0065", "sk-0013", "Special milk", "1", "4.000", "4", "0.52174", "Done", "Done", "-"],
      ["22690", "2026-10-10", "B01", "Modifier Option", "sk-0047", "sk-0013", "Cold", "1", "0.000", "0", "0", "Done", "Done", "-"],
      ["22690", "2026-10-10", "B01", "Product", "sk-0014", "", "Water", "1", "4.000", "4", "0.52174", "Done", "Done", "0"],
    ];
    const excel = foodicsExcelAdapter.parse({ grid }, {}).sales[0];
    const api = ordersToSalesFile([order()]).file.sales[0];

    expect(api.externalId).toBe(excel.externalId);
    expect(api.grossMinor).toBe(excel.grossMinor);
    expect(api.vatMinor).toBe(excel.vatMinor);
    const key = (s: typeof api) => s.lines.map((l) => [l.externalId, l.contentHash, l.isModifier, l.parentLineExternalId, l.quantityMilli, l.lineTotalMinor]).sort();
    expect(key(api)).toEqual(key(excel));
  });

  it("ضريبةُ الخيار المدفوع تدخل، وما لا ضريبةَ عليه عند فودكس لا تُخترَع له", () => {
    const sale = ordersToSalesFile([order()]).file.sales[0];
    /* ‎3.26087 + (4 − 3.47826) + 0.52174‎ */
    expect(sale.vatMinor).toBe(430);
  });

  it("المرتجَعُ طلبٌ مستقلّ بكمّيّةٍ موجبة: يُنقص الضريبةَ ولا يدخل الإيراد", () => {
    const returned = order({
      id: "o-2", reference: 22681, status: ORDER_STATUS.RETURNED, total_price: 14,
      products: [{ id: "p-9", quantity: 1, unit_price: 14, total_price: 14, status: PRODUCT_STATUS.RETURNED, product: { sku: "sk-0026", name: "Iced Coffee" }, taxes: [{ pivot: { amount: 1.82609 } }] }],
      payments: [{ id: "pay-9", amount: -14, payment_method: { name: "Cash", type: PAYMENT_TYPE.CASH } }],
    });
    const sale = ordersToSalesFile([returned]).file.sales[0];
    expect(sale).toMatchObject({ grossMinor: 0, netMinor: 0, refundMinor: 1400, vatMinor: -183 });
    expect(sale.lines[0]).toMatchObject({ isRefund: true, isVoid: false, quantityMilli: 1000, sourceStatus: "Returned" });
  });

  it("الملغى لا إيرادَ له ولا ضريبة", () => {
    const voided = order({ status: ORDER_STATUS.VOID, products: [{ id: "p-1", quantity: 1, unit_price: 19, total_price: 19, status: PRODUCT_STATUS.VOID, product: { sku: "sk-1", name: "X" }, taxes: [{ pivot: { amount: 2.47826 } }] }] });
    const sale = ordersToSalesFile([voided]).file.sales[0];
    expect(sale).toMatchObject({ grossMinor: 0, vatMinor: 0, isVoid: true });
  });

  it("الطلبُ الجاري لا يُقيَّد — يأتي حين يُغلَق", () => {
    expect(ordersToSalesFile([order({ status: ORDER_STATUS.ACTIVE })]).file.sales).toHaveLength(0);
  });

  it("ما لم يُقرأ مبلغُه يُردّ بسببه ولا يُكتب بصفر", () => {
    const broken = order({ products: [{ id: "p-1", quantity: 1, unit_price: 19, total_price: null, status: PRODUCT_STATUS.CLOSED, product: { sku: "sk-1", name: "X" } }] });
    const out = ordersToSalesFile([broken]);
    expect(out.file.sales).toHaveLength(0);
    expect(out.problems[0].reference).toBe(22690);
  });

  it("طلبٌ على House Account مشروبُ موظَّف: يُستهلَك في الجرد ولا إيرادَ له ولا ضريبة", () => {
    const staff = order({ payments: [{ id: "pay-h", amount: 33, payment_method: { name: "House Account", type: PAYMENT_TYPE.HOUSE_ACCOUNT } }] });
    const sale = ordersToSalesFile([staff]).file.sales[0];
    expect(sale).toMatchObject({ grossMinor: 0, netMinor: 0, vatMinor: 0, refundMinor: 0, isVoid: false });
    const products = sale.lines.filter((l) => !l.isModifier);
    expect(products.every((l) => l.isComplimentary)).toBe(true);
    expect(products.map((l) => l.quantityMilli)).toEqual([1000, 1000]);
    /* والبصمةُ لم تتغيّر: المصدرُ لم يراجِع شيئاً، فلا يُعلَن «مُراجَع» */
    const paid = ordersToSalesFile([order()]).file.sales[0];
    expect(sale.lines.map((l) => l.contentHash)).toEqual(paid.lines.map((l) => l.contentHash));
  });

  it("الصنفُ نفسُه مرّتين في الطلب سطران لا واحد", () => {
    const p = { quantity: 1, unit_price: 19, total_price: 19, status: PRODUCT_STATUS.CLOSED, product: { sku: "sk-7", name: "Latte" } };
    const sale = ordersToSalesFile([order({ products: [{ id: "a", ...p }, { id: "b", ...p }] })]).file.sales[0];
    expect(sale.lines.map((l) => l.externalId)).toEqual(["sk-7#P#1", "sk-7#P#2"]);
  });
});

describe("مرآةُ الطلب", () => {
  it("تحفظ الإجماليَّ والدفعاتِ بنوعها — ولا شيءَ عن العميل", () => {
    const m = mirrorOrder(order());
    expect(m?.order).toMatchObject({ reference: 22690, totalMinor: 3300, vatMinor: 430, businessDate: "2026-10-10" });
    expect(m?.payments).toEqual([expect.objectContaining({ methodType: PAYMENT_TYPE.CARD, methodName: "Mada", amountMinor: 3300 })]);
    expect(JSON.stringify(order())).not.toContain("0500000000");
  });
  it("إجماليٌّ لم يُقرأ ← لا مرآة، لا صفر", () => {
    expect(mirrorOrder(order({ total_price: null }))).toBeNull();
  });
  it("أوقاتُ شاشة التحضير من `meta.foodics`، وغيابُها فراغٌ لا صفر", () => {
    const m = mirrorOrder(order({ meta: { foodics: { kitchen_received_at: "2026-10-10 20:21:05", kitchen_done_at: "2026-10-10 20:28:00", receipt_qr: "…" } } }));
    expect(m?.order.kitchenReceivedAt?.toISOString()).toBe("2026-10-10T20:21:05.000Z");
    expect(m?.order.kitchenDoneAt?.toISOString()).toBe("2026-10-10T20:28:00.000Z");
    expect(mirrorOrder(order())?.order.kitchenDoneAt).toBeNull();
  });
  it("يعدّ أسطرَ المرتجَع التي قال الكاشير إنّ مكوّناتها هُدرت", () => {
    const base = order().products!;
    const m = mirrorOrder(order({ status: ORDER_STATUS.RETURNED, products: [{ ...base[0], is_ingredients_wasted: 1 }, { ...base[1], is_ingredients_wasted: 0 }] }));
    expect(m?.order.wastedLines).toBe(1);
  });
});
