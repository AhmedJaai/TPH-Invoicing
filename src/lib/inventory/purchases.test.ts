import { describe, expect, it } from "vitest";
import {
  purchaseQuantity, quantityInBaseUnits, summarisePurchases,
  unitCostMinor, varianceCostMinor, type PurchaseLineInput,
} from "./purchases";
import { canonicalToQuantity } from "./units";

function line(over: Partial<PurchaseLineInput> = {}): PurchaseLineInput {
  return {
    lineId: "il-1", invoiceId: "inv-1", invoiceNumber: "A-1",
    supplierName: "محمصة", invoiceDate: "2026-09-03",
    description: "بنّ عربيّ", productId: "p-coffee",
    qty: "1", lineTotalMinor: 45_000,
    packSize: "1", contentUnit: "KG", contentQuantity: "1",
    ...over,
  };
}

describe("كمّيّةُ الشراء من مواصفة العبوة", () => {
  it("كرتونان × ١٢ × ١ لتر = ٢٤ لتراً", () => {
    const q = purchaseQuantity(
      line({ qty: "2", packSize: "12", contentUnit: "L", contentQuantity: "1" }),
      "L",
    );
    expect(q.known).toBe(true);
    if (!q.known) return;
    expect(canonicalToQuantity(q.canonicalMilli, "L")).toBe(24);
  });

  it("وكيسُ ٥ كجم يُقرأ ٥ كجم", () => {
    const q = purchaseQuantity(
      line({ qty: "4", packSize: "1", contentUnit: "KG", contentQuantity: "5" }),
      "KG",
    );
    expect(q.known && canonicalToQuantity(q.canonicalMilli, "KG")).toBe(20);
  });

  it("ويُحوَّل داخل العائلة: ٥٠٠ جرامٍ × ٦ إلى وحدة الكيلو", () => {
    const q = purchaseQuantity(
      line({ qty: "1", packSize: "6", contentUnit: "G", contentQuantity: "500" }),
      "KG",
    );
    expect(q.known && canonicalToQuantity(q.canonicalMilli, "KG")).toBe(3);
  });
});

describe("المجهولُ لا يُخمَّن", () => {
  it("بلا مواصفة عبوةٍ لا كمّيّة — ولا يُفترَض واحد", () => {
    expect(purchaseQuantity(line({ packSize: null }), "KG")).toEqual({ known: false, reason: "NO_PACK_SPEC" });
    expect(purchaseQuantity(line({ contentUnit: null }), "KG")).toEqual({ known: false, reason: "NO_PACK_SPEC" });
    expect(purchaseQuantity(line({ contentQuantity: null }), "KG")).toEqual({ known: false, reason: "NO_PACK_SPEC" });
  });

  it("وبلا كمّيّةٍ مقروءةٍ في الفاتورة لا كمّيّة", () => {
    expect(purchaseQuantity(line({ qty: null }), "KG")).toEqual({ known: false, reason: "MISSING_QUANTITY" });
    expect(purchaseQuantity(line({ qty: "غير مقروء" }), "KG")).toEqual({ known: false, reason: "MISSING_QUANTITY" });
  });

  it("ولترٌ لا يصير كيلو — عائلتان", () => {
    expect(purchaseQuantity(line({ contentUnit: "L" }), "KG"))
      .toEqual({ known: false, reason: "UNIT_FAMILY_MISMATCH" });
  });

  it("وبندٌ غير مربوطٍ بصنفٍ معياريّ يخرج بسببه", () => {
    expect(purchaseQuantity(line({ productId: null }), "KG"))
      .toEqual({ known: false, reason: "UNLINKED_PRODUCT" });
  });

  it("**ولا تُشتقّ كمّيّةٌ من مبلغٍ بالريال**", () => {
    /*
      لو خُمّنت الكمّيّة من المبلغ لكان لهذا السطر «١٠ كجم» بسعرٍ سابق.
      والرقمُ الناتج يبدو دقيقاً وهو مخترَع، ثمّ يُبنى عليه فرقُ جردٍ
      يُحاسَب عليه أحد.
    */
    const q = purchaseQuantity(line({ qty: null, lineTotalMinor: 450_00 }), "KG");
    expect(q).toEqual({ known: false, reason: "MISSING_QUANTITY" });
  });
});

describe("تجميعُ مشتريات الفترة", () => {
  const baseUnit = () => "KG" as const;

  it("يجمع ما عُرف، ويفصل ما لم يُعرَف بعدده ومبلغه", () => {
    const s = summarisePurchases(
      [
        line({ lineId: "a", qty: "2", packSize: "1", contentUnit: "KG", contentQuantity: "5", lineTotalMinor: 200_00 }),
        line({ lineId: "b", qty: "1", packSize: "1", contentUnit: "KG", contentQuantity: "5", lineTotalMinor: 100_00 }),
        line({ lineId: "c", packSize: null, lineTotalMinor: 450_00 }),
      ],
      baseUnit,
    );

    const coffee = s.byProduct.get("p-coffee")!;
    expect(canonicalToQuantity(coffee.canonicalMilli, "KG")).toBe(15);
    expect(coffee.knownCostMinor).toBe(300_00);
    expect(coffee.invoiceLineIds).toEqual(["a", "b"]);

    expect(s.gaps).toHaveLength(1);
    expect(s.gapTotals).toEqual({ lines: 1, totalMinor: 450_00 });
  });
});

describe("الكلفة", () => {
  it("متوسّطٌ مرجَّح لكلفة وحدة الأساس", () => {
    const s = summarisePurchases(
      [
        line({ lineId: "a", qty: "1", packSize: "1", contentUnit: "KG", contentQuantity: "10", lineTotalMinor: 500_00 }),
        line({ lineId: "b", qty: "1", packSize: "1", contentUnit: "KG", contentQuantity: "10", lineTotalMinor: 700_00 }),
      ],
      () => "KG",
    );
    /* ‏١٢٠٠ ريالاً على ٢٠ كجم = ٦٠ للكيلو */
    expect(unitCostMinor(s.byProduct.get("p-coffee"), "KG", null)).toBe(60_00);
  });

  it("وبلا مشترياتٍ صالحةٍ تُؤخَذ الكلفةُ السابقة — وإلّا `null` لا صفر", () => {
    expect(unitCostMinor(undefined, "KG", 75_00)).toBe(75_00);
    expect(unitCostMinor(undefined, "KG", null)).toBeNull();
  });

  it("وكلفةُ الفرق عددٌ صحيح بالهللات، و`null` حين تُجهَل الكلفة", () => {
    /* ‑٢٫٥ كجم × ٧٥ ريالاً = ‑١٨٧٫٥٠ */
    expect(varianceCostMinor(-2_500_000, 75_00, "KG")).toBe(-187_50);
    expect(varianceCostMinor(-2_500_000, null, "KG")).toBeNull();
    expect(varianceCostMinor(null, 75_00, "KG")).toBeNull();
  });

  it("وعددُ وحدات الأساس يُحسَب من المعياريّ", () => {
    expect(quantityInBaseUnits(2_000_000, "KG")).toBe(2);
    expect(quantityInBaseUnits(2_000_000, "G")).toBe(2000);
  });
});
