import { describe, expect, it } from "vitest";
import { adapterFor, findHeader, foodicsExcelAdapter } from "./foodics-excel";
import { mapColumns, normaliseHeader } from "./columns";
import { detectDateOrder, parseBusinessDate, parseFlag, parseQuantityMilli } from "./values";
import { toSalesTransactions } from "./file-import";

const ORDERS_HEADER = [
  "Order Number", "Business Date", "Branch", "SKU", "Product", "Category",
  "Quantity", "Unit Price", "Net Sales", "Is Refund", "Voided", "Modifiers",
];

function ordersGrid(rows: string[][]): string[][] {
  return [
    ["تقرير الطلبات — مؤسسة ذا بوبليك هاوس"],
    [],
    ORDERS_HEADER,
    ...rows,
  ];
}

const PMIX_HEADER = ["التاريخ", "الصنف", "الكمية", "صافي المبيعات"];

describe("فهمُ الترويسة بالاسم لا بالموضع", () => {
  it("يوحّد الفراغَ والشرطةَ والهمزةَ والتاء المربوطة", () => {
    expect(normaliseHeader("Net Sales")).toBe("netsales");
    expect(normaliseHeader("net_sales")).toBe("netsales");
    expect(normaliseHeader(" صافي  المبيعات ")).toBe("صافيالمبيعات");
    expect(normaliseHeader("الكمّيّة")).toBe("الكميه");
  });

  it("يربط الإنجليزيّة والعربيّة بالحقول نفسها", () => {
    const en = mapColumns(ORDERS_HEADER);
    expect(en.index.orderId).toBe(0);
    expect(en.index.businessDate).toBe(1);
    expect(en.index.productName).toBe(4);
    expect(en.index.quantity).toBe(6);

    const ar = mapColumns(PMIX_HEADER);
    expect(ar.index.businessDate).toBe(0);
    expect(ar.index.productName).toBe(1);
    expect(ar.index.quantity).toBe(2);
    expect(ar.index.lineTotal).toBe(3);
  });

  it("وما لم يُفهَم يُعلَن بأسمائه — لا يُتجاهَل صامتاً", () => {
    const m = mapColumns(["Product", "Quantity", "Loyalty Points", "Cashier"]);
    expect(m.unrecognised).toEqual(["Loyalty Points", "Cashier"]);
    expect(m.recognised.length).toBe(2);
  });

  it("والترويسةُ تُطلَب بعد أسطرِ العنوان — لا تُفترَض أوّلَ صفّ", () => {
    expect(findHeader(ordersGrid([]))?.rowIndex).toBe(2);
    expect(findHeader([["عنوان"], ["فترة"]])).toBeNull();
  });
});

describe("التواريخ", () => {
  it("‏`YYYY-MM-DD` لا لبسَ فيه", () => {
    expect(parseBusinessDate("2026-09-03")).toBe("2026-09-03");
    expect(parseBusinessDate("2026-09-03 14:32:11")).toBe("2026-09-03");
  });

  it("وترتيبُ اليوم والشهر يُستنتَج من الملفّ كلِّه — صفٌّ فيه ١٣ يقطع", () => {
    expect(detectDateOrder(["03/09/2026", "13/09/2026"])).toBe("DMY");
    expect(detectDateOrder(["09/13/2026", "09/03/2026"])).toBe("MDY");
    expect(detectDateOrder(["03/09/2026", "04/09/2026"])).toBe("AMBIGUOUS");
    expect(detectDateOrder(["2026-09-03"])).toBe("ISO");
  });

  it("والمُلتبِسُ يُقرأ اليومَ أوّلاً — والافتراضُ يُعلَن في التحذيرات", () => {
    expect(parseBusinessDate("03/09/2026", "AMBIGUOUS")).toBe("2026-09-03");
    /* و«09/03» في ترتيب الشهرِ أوّلاً هو الثالث من سبتمبر */
    expect(parseBusinessDate("09/03/2026", "MDY")).toBe("2026-09-03");
    expect(parseBusinessDate("03/09/2026", "MDY")).toBe("2026-03-09");
    const parsed = foodicsExcelAdapter.parse(
      [PMIX_HEADER, ["03/09/2026", "لاتيه", "2", "36.00"]],
      {},
    );
    expect(parsed.warnings.some((w) => w.includes("ترتيب اليوم والشهر"))).toBe(true);
  });

  it("وما ليس تاريخاً يُرجع `null` — لا يُقرأ اليوم", () => {
    expect(parseBusinessDate("—")).toBeNull();
    expect(parseBusinessDate("2026-13-40")).toBeNull();
  });
});

describe("القيم", () => {
  it("الأرقامُ العربيّة وفواصلُ الآلاف تُقرأ", () => {
    expect(parseQuantityMilli("١٢٣")).toBe(123_000);
    expect(parseQuantityMilli("1,234.5")).toBe(1_234_500);
    expect(parseQuantityMilli("")).toBeNull();
  });

  it("والعَلَمُ المجهولُ `null` لا «لا» — وقراءتُه «لا» في «ملغاة» تُدخل بيعةً لم تقع", () => {
    expect(parseFlag("true")).toBe(true);
    expect(parseFlag("نعم")).toBe(true);
    expect(parseFlag("0")).toBe(false);
    expect(parseFlag("ربّما")).toBeNull();
  });
});

describe("تصديرُ الطلبات", () => {
  const grid = ordersGrid([
    ["ORD-1", "2026-09-03", "النسيم", "SKU-1", "Spanish Latte", "Hot", "2", "18.00", "36.00", "", "", "Extra Shot"],
    ["ORD-1", "2026-09-03", "النسيم", "SKU-2", "Croissant", "Bakery", "1", "12.00", "12.00", "", "", ""],
    ["ORD-2", "2026-09-04", "النسيم", "SKU-1", "Spanish Latte", "Hot", "1", "18.00", "18.00", "", "", ""],
  ]);

  it("يُعرَف بترويسته، ويصير بيعةً لكلّ طلب", () => {
    expect(adapterFor(grid)).toBe(foodicsExcelAdapter);
    const parsed = foodicsExcelAdapter.parse(grid, {});

    expect(parsed.shape).toBe("FOODICS_ORDERS");
    expect(parsed.sales).toHaveLength(2);
    expect(parsed.sales[0].externalId).toBe("FDX:ORD-1");
    expect(parsed.sales[0].lines).toHaveLength(2);
    expect(parsed.sales[0].netMinor).toBe(48_00);
    expect(parsed.periodStart).toBe("2026-09-03");
    expect(parsed.periodEnd).toBe("2026-09-04");
  });

  it("والمُعدِّلاتُ تُحفَظ خاماً", () => {
    const parsed = foodicsExcelAdapter.parse(grid, {});
    expect(parsed.sales[0].lines[0].modifiers).toEqual(["Extra Shot"]);
    expect(parsed.sales[0].lines[1].modifiers).toBeNull();
  });

  it("والكمّيّةُ السالبة مرتجَعٌ ضمنيّ — تُقلَب وتُوسَم", () => {
    const parsed = foodicsExcelAdapter.parse(
      ordersGrid([["ORD-9", "2026-09-03", "النسيم", "SKU-1", "Latte", "Hot", "-1", "18.00", "-18.00", "", "", ""]]),
      {},
    );
    const line = parsed.sales[0].lines[0];
    expect(line.isRefund).toBe(true);
    expect(line.quantityMilli).toBe(1000);
    expect(parsed.sales[0].refundMinor).toBe(18_00);
    expect(parsed.sales[0].netMinor).toBe(0);
  });

  it("والملغاةُ تُوسَم ولا تدخل الإجماليّ", () => {
    const parsed = foodicsExcelAdapter.parse(
      ordersGrid([["ORD-8", "2026-09-03", "النسيم", "SKU-1", "Latte", "Hot", "1", "18.00", "18.00", "", "true", ""]]),
      {},
    );
    expect(parsed.sales[0].lines[0].isVoid).toBe(true);
    expect(parsed.sales[0].netMinor).toBe(0);
  });

  it("وصنفان متطابقان في الطلب الواحد يبقيان سطرين — الترتيبُ آخرُ ما يدخل المفتاح", () => {
    const parsed = foodicsExcelAdapter.parse(
      ordersGrid([
        ["ORD-7", "2026-09-03", "النسيم", "SKU-1", "Latte", "Hot", "1", "18.00", "18.00", "", "", "بلا سكّر"],
        ["ORD-7", "2026-09-03", "النسيم", "SKU-1", "Latte", "Hot", "1", "18.00", "18.00", "", "", "مزدوج"],
      ]),
      {},
    );
    expect(parsed.sales[0].lines).toHaveLength(2);
    expect(new Set(parsed.sales[0].lines.map((l) => l.externalId)).size).toBe(2);
  });

  it("ومخرَجُه هو نوعُ الموصل نفسُه — فالواجهةُ حين تأتي تُغذّي المسار ذاته", () => {
    const tx = toSalesTransactions(foodicsExcelAdapter.parse(grid, {}));
    expect(tx[0].externalId).toBe("FDX:ORD-1");
    expect(tx[0].lines[0].quantity).toBe(2);
    expect(tx[0].businessDate).toBe("2026-09-03");
  });
});

describe("تصديرُ مزيج الأصناف", () => {
  it("بيعةٌ مصطنَعة لكلّ يومٍ وفرع — فملفّان عن يومٍ واحد لا يضاعفانه", () => {
    const parsed = foodicsExcelAdapter.parse(
      [PMIX_HEADER, ["2026-09-03", "لاتيه", "100", "1800.00"], ["2026-09-03", "كرواسون", "20", "240.00"]],
      {},
    );
    expect(parsed.shape).toBe("FOODICS_PRODUCT_MIX");
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0].externalId).toBe("PMIX:الفرع:2026-09-03");
    expect(parsed.sales[0].lines).toHaveLength(2);
  });

  it("والصنفُ المذكور مرّتين في اليوم تُجمَع كمّيّتُه — اليومُ واحد والصنفُ واحد", () => {
    const parsed = foodicsExcelAdapter.parse(
      [PMIX_HEADER, ["2026-09-03", "لاتيه", "60", "1080.00"], ["2026-09-03", "لاتيه", "40", "720.00"]],
      {},
    );
    expect(parsed.sales[0].lines).toHaveLength(1);
    expect(parsed.sales[0].lines[0].quantityMilli).toBe(100_000);
    expect(parsed.sales[0].lines[0].lineTotalMinor).toBe(1800_00);
  });
});

describe("لا صفَّ يُرمى صامتاً", () => {
  it("كلُّ صفٍّ يُحفَظ بحاله وسببه", () => {
    const parsed = foodicsExcelAdapter.parse(
      ordersGrid([
        ["ORD-1", "2026-09-03", "النسيم", "SKU-1", "Latte", "Hot", "2", "18.00", "36.00", "", "", ""],
        [],
        ["", "", "", "", "الإجمالي", "", "", "", "36.00", "", "", ""],
        ["ORD-2", "2026-09-03", "النسيم", "SKU-2", "Tea", "Hot", "غير مقروء", "9.00", "9.00", "", "", ""],
        ["ORD-3", "بلا تاريخ", "النسيم", "SKU-2", "Tea", "Hot", "1", "9.00", "9.00", "", "", ""],
      ]),
      {},
    );

    expect(parsed.rows).toHaveLength(5);
    const byStatus = parsed.rows.map((r) => r.status);
    expect(byStatus).toEqual(["PARSED", "SKIPPED", "SKIPPED", "ERROR", "ERROR"]);
    expect(parsed.rows.every((r) => r.status === "PARSED" || r.reason !== null)).toBe(true);
    /* والصفُّ الخام محفوظٌ بنصّه */
    expect(parsed.rows[3].raw["Product"]).toBe("Tea");
  });

  it("وصفٌّ بلا يومِ عملٍ يُردّ — لا يُنسَب إلى يومٍ بالحدس", () => {
    const parsed = foodicsExcelAdapter.parse([PMIX_HEADER, ["", "لاتيه", "5", "90.00"]], {});
    expect(parsed.rows[0].status).toBe("ERROR");
    expect(parsed.rows[0].reason).toContain("يومُ عمل");
  });

  it("وما لم يُفهَم أصلاً يُعلَن سببُه لقارئه — لا خطأٌ تقنيّ", () => {
    const parsed = foodicsExcelAdapter.parse([["اسم"], ["قيمة"]], {});
    expect(parsed.blocked).toContain("اسم الصنف");
    expect(parsed.sales).toEqual([]);
  });
});
