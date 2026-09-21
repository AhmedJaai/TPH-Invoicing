import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CORROBORATION_TOLERANCE_BP, READY_MADE, corroborationGapBp, readyMadeFor,
} from "./ready-made";
import { parseCatalogFile } from "./foodics-catalog";
import { recipeCost, type CostedIngredient } from "./recipe-cost";

/**
 * الاقترانُ يُثبَت بالكلفة المعلَنة، لا بتشابه الاسم.
 *
 * «Madrid Cheesecake» و«تشيز مدريد» لا يلتقيان في حرف. والذي يربطهما
 * أنّ كلفةَ الصنف المحسوبة من عبوته تقارب ما يعلنه فودكس كلفةً
 * للمنتج — **واقعةٌ في الملفّ، لا ظنٌّ من عندنا**.
 */
const ITEMS = parseCatalogFile(readFileSync("src/test/fixtures/foodics-inventory-items.csv")).items;
const PRODUCTS = parseCatalogFile(readFileSync("src/test/fixtures/foodics-products.csv")).products;
const LINES = parseCatalogFile(readFileSync("src/test/fixtures/foodics-product-ingredients.csv")).recipeLines;

const itemBySku = new Map(ITEMS.map((i) => [i.itemSku, i] as const));
const productBySku = new Map(PRODUCTS.map((p) => [p.productSku, p] as const));

/** وصفةُ المنتج بعد إضافة صنفه الجاهز — كما يكتبها الاستيراد. */
function completedIngredients(productSku: string): CostedIngredient[] {
  const out: CostedIngredient[] = LINES
    .filter((l) => l.productSku === productSku)
    .map((l) => {
      const it = itemBySku.get(l.itemSku)!;
      return {
        productId: l.itemSku, name: it.name, quantityMilli: l.quantityMilli, unit: l.unit,
        baseUnit: it.baseUnit, packMilli: it.packQuantityMilli, packCostMinor: it.packCostMinor,
      };
    });

  const ready = readyMadeFor(productSku);
  if (ready && !out.some((o) => o.productId === ready.itemSku)) {
    const it = itemBySku.get(ready.itemSku)!;
    out.push({
      productId: ready.itemSku, name: it.name, quantityMilli: ready.quantity * 1000,
      unit: it.baseUnit, baseUnit: it.baseUnit,
      packMilli: it.packQuantityMilli, packCostMinor: it.packCostMinor,
    });
  }
  return out;
}

describe("الجاهزُ مقترنٌ بصنفٍ قائم", () => {
  it("كلُّ منتجٍ وكلُّ صنفٍ في الجدول موجودٌ في الكتالوج", () => {
    for (const r of READY_MADE) {
      expect(productBySku.has(r.productSku), `منتج ${r.productSku}`).toBe(true);
      expect(itemBySku.has(r.itemSku), `صنف ${r.itemSku}`).toBe(true);
    }
  });

  /*
    ── والاسمُ المكتوب في الجدول يطابق الكتالوج ──

    وهو للقراءة وحدها، ولا يُبنى عليه ربط. لكنّ اسماً يخالف الكتالوج
    يجعل المعاينةَ تعرض شيئاً والاستيرادَ يكتب غيرَه.
  */
  it("والاسمُ المعروض هو اسمُ الصنف في الكتالوج", () => {
    for (const r of READY_MADE) {
      expect(itemBySku.get(r.itemSku)!.name).toBe(r.itemName);
    }
  });

  it("ولا يتكرّر منتجٌ ولا يُقترَن صنفان بمنتجٍ واحد", () => {
    const skus = READY_MADE.map((r) => r.productSku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  /*
    ── الشهادة ──

    خمسةٌ تطابق إلى الهللة: براوني ٦٫٦٠، وكوكيز ٤٫٥٠، وكيكة الباشن
    ‏١٢٫٠٠، وCrinkle ٥٫٠٠، وBrown Butter ٦٫٠٠. **وتطابقٌ تامّ في
    خمسةٍ لا يقع مصادفةً** — هو الدليل على أنّ الاقتران صحيح.
  */
  it("وخمسةٌ منها تطابق الكلفةَ المعلَنة إلى الهللة", () => {
    const exact = READY_MADE.filter((r) => {
      const cost = recipeCost(completedIngredients(r.productSku)).costMinor;
      return corroborationGapBp(cost, productBySku.get(r.productSku)!.declaredCostMinor) === 0;
    }).map((r) => productBySku.get(r.productSku)!.name);

    expect(exact.sort()).toEqual([
      "Brawnie", "Brown Butter Cookie", "Cookie", "Crinkle Cookie", "Passion Fruit Cheesecake",
    ]);
  });

  /*
    وما بقي يقارب: الفارقُ تغليفٌ لا يعدّه فودكس في كلفته. واثنان
    يجاوزان الحدّ ولهما ملاحظةٌ مكتوبة — فلا يمرّ فارقٌ صامتاً.
  */
  it("وما جاوز الحدَّ له ملاحظةٌ تقول لماذا", () => {
    const loud: string[] = [];
    for (const r of READY_MADE) {
      const cost = recipeCost(completedIngredients(r.productSku)).costMinor;
      const gap = corroborationGapBp(cost, productBySku.get(r.productSku)!.declaredCostMinor);
      if (gap !== null && gap > CORROBORATION_TOLERANCE_BP) {
        loud.push(productBySku.get(r.productSku)!.name);
        expect(r.note, `${r.productSku} بلا ملاحظة`).toBeTruthy();
      }
    }
    /* واحدٌ وحده يجاوز: «كرنشي ويفر» صنفُه بسبعة والمعلَنة ٥٫١٠ */
    expect(loud).toEqual(["Crunchy wafer"]);
  });

  it("و«تشيز مدريد» تُضاف إلى تغليفها ولا تحلّ محلَّه", () => {
    const ings = completedIngredients("sk-0023");
    expect(ings.map((i) => i.name).sort()).toEqual(["تشيز مدريد", "شوك", "علب تيكاوي"]);
    /* ‏٠٫٧٦ تغليفاً + ٩٫١٧ كعكةً = ٩٫٩٣ */
    expect(recipeCost(ings).costMinor).toBe(993);
  });

  it("و«الماء» بلا وصفةٍ في الملفّ صار قارورةً واحدة", () => {
    const ings = completedIngredients("sk-0014");
    expect(ings).toHaveLength(1);
    expect(ings[0].name).toBe("مياه معدنية");
    expect(ings[0].baseUnit).toBe("PIECE");
  });

  /*
    ── وما ليس جاهزاً لا يدخل الجدول ──

    خياراتُ الإضافة — الفانيلا والعسل وحليبُ الشوفان — جرعتُها ليست
    في أيّ ملفّ. واختراعُها يُنتج استهلاكاً مخترَعاً، فتبقى بلا وصفة
    وتُعلَن في التغطية.
  */
  it("ولا خيارَ إضافةٍ في الجدول — جرعتُه ليست في أيّ ملفّ", () => {
    for (const sku of ["sk-0019", "sk-0020", "sk-0018", "sk-0017", "sk-0068"]) {
      expect(readyMadeFor(sku), sku).toBeUndefined();
    }
  });
});

describe("فارقُ الشهادة", () => {
  it("يُحسَب نسبةً إلى المعلَنة", () => {
    expect(corroborationGapBp(1_000, 1_000)).toBe(0);
    expect(corroborationGapBp(1_100, 1_000)).toBe(1_000);
    expect(corroborationGapBp(900, 1_000)).toBe(1_000);
  });

  it("و`null` حين لا كلفةَ معلَنة — لا صفراً يُقرأ «مطابق»", () => {
    expect(corroborationGapBp(1_000, null)).toBeNull();
    expect(corroborationGapBp(null, 1_000)).toBeNull();
    expect(corroborationGapBp(1_000, 0)).toBeNull();
  });
});
