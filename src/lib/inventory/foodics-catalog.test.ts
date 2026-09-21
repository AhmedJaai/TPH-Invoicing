import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  lineCostMilliMinor, parseCatalogFile, readUnit, toMinor, unitCostMilliMinor,
  type StockItemRow,
} from "./foodics-catalog";

/**
 * الكتالوج يُختبَر على التصدير الحقيقيّ — لا على ملفٍّ مصنوع.
 *
 * والملفّاتُ الثلاثة كما نزلت من فودكس: ‏٦٠ صنفَ مخزون، و٥٨ صنفاً
 * يُباع، و١٤٢ سطرَ وصفة. ولا شيءَ فيها شخصيّ.
 */
const ITEMS = "src/test/fixtures/foodics-inventory-items.csv";
const PRODUCTS = "src/test/fixtures/foodics-products.csv";
const INGREDIENTS = "src/test/fixtures/foodics-product-ingredients.csv";

const read = (p: string) => parseCatalogFile(readFileSync(p));

describe("الملفُّ يُعرَف بأعمدته لا باسمه", () => {
  it("الثلاثةُ تُميَّز، ولا يلتبس ملفٌّ بآخر", () => {
    expect(read(ITEMS).kind).toBe("ITEMS");
    expect(read(PRODUCTS).kind).toBe("PRODUCTS");
    expect(read(INGREDIENTS).kind).toBe("INGREDIENTS");
  });

  /*
    ── ولماذا تُفحَص الوصفاتُ أوّلاً ──

    ملفُّ الوصفات فيه `product_sku` لا `sku`، فلا يلتبس بملفّ المنتجات.
    لكنّ الترتيبَ مثبَّتٌ باختبارٍ كي لا يُقلَب سهواً: ملفٌّ يُقرأ على
    أنّه غيرُه يُنشئ أصنافاً وهميّة بأسماءِ وصفات.
  */
  it("وترويسةٌ غريبة تُعلَن ولا تُقرأ بالحدس", () => {
    const r = parseCatalogFile(Buffer.from("alpha,beta\n1,2\n", "utf8"));
    expect(r.items).toHaveLength(0);
    expect(r.issues[0].reason).toBe("ترويسةٌ غير مفهومة");
    expect(r.issues[0].detail).toContain("alpha");
  });
});

describe("أصنافُ المخزون — ٦٠ صنفاً", () => {
  const parsed = read(ITEMS);

  it("تُقرأ كلُّها بلا صفٍّ ساقط", () => {
    expect(parsed.rows).toBe(60);
    expect(parsed.items).toHaveLength(60);
    expect(parsed.issues).toHaveLength(0);
  });

  it("والعبوةُ تُقرأ بمعامِلها: كرتونُ ٥٠٠ كاسٍ بـ٢١٥ ريالاً", () => {
    const cups = parsed.items.find((i) => i.itemSku === "sk-0018")!;
    expect(cups.name).toBe("كاسات ١٢ اونص");
    expect(cups.storageUnit).toBe("كرتون");
    expect(cups.baseUnit).toBe("PIECE");
    expect(cups.packQuantityMilli).toBe(500_000);
    expect(cups.packCostMinor).toBe(21_500);
  });

  it("وعلبةُ الحليب ١٫٧٥ لترٍ بـ١١ ريالاً — والكسرُ في المعامِل لا في المال", () => {
    const milk = parsed.items.find((i) => i.itemSku === "sk-0008")!;
    expect(milk.baseUnit).toBe("L");
    expect(milk.packQuantityMilli).toBe(1_750);
    expect(milk.packCostMinor).toBe(1_100);
  });

  /*
    ── «حبة» و«حبه» ──

    الملفُّ يكتبهما بالتاء المربوطة وبالهاء، وفي الوصفات ٥١ سطراً بهذه
    و٣٦ بتلك. ولو لم يُطبَّعا لخرج ثلثُ الوصفات «بوحدةٍ غير معروفة».
  */
  it("والتاءُ المربوطة والهاءُ وحدةٌ واحدة", () => {
    expect(readUnit("حبة")).toBe("PIECE");
    expect(readUnit("حبه")).toBe("PIECE");
    expect(readUnit("قطعة")).toBe("PIECE");
    expect(readUnit("جرام")).toBe("G");
    expect(readUnit("كيلو")).toBe("KG");
    expect(readUnit("لتر")).toBe("L");
    expect(readUnit("ملل")).toBe("ML");
    expect(readUnit("علبة")).toBe("PACK");
  });

  it("وما لا يُفهَم يُعلَن ولا يُخمَّن", () => {
    expect(readUnit("صندوق كبير")).toBeNull();
    expect(readUnit("")).toBeNull();
  });
});

describe("الأصناف المباعة — ٥٨ صنفاً", () => {
  const parsed = read(PRODUCTS);

  it("تُقرأ كلُّها", () => {
    expect(parsed.rows).toBe(58);
    expect(parsed.products).toHaveLength(58);
    expect(parsed.issues).toHaveLength(0);
  });

  it("والسعرُ هللاتٌ صحيحة", () => {
    const latte = parsed.products.find((p) => p.productSku === "sk-0007")!;
    expect(latte.name).toBe("Latte");
    expect(latte.priceMinor).toBe(1_900);
    expect(latte.isActive).toBe(true);
  });

  it("والمعطَّلُ يُقرأ معطَّلاً — أربعةٌ منها", () => {
    const off = parsed.products.filter((p) => !p.isActive).map((p) => p.productSku);
    expect(off).toEqual(["sk-0082", "sk-0066", "sk-0057", "sk-0053"]);
  });

  /*
    كلفةُ «تشيز مدريد» عند فودكس ‏١١٠ ÷ ١٢ = ‏٩٫١٦٦٦٧، بخمس منازل.
    و`parseRiyals` يردّ ما جاوز منزلتين عن قصد — فتُقرأ بقارئ الكلفة
    الإعلاميّة وتُقرَّب، وتبقى للمقارنة لا للتقييم.
  */
  it("والكلفةُ المعلَنة بخمس منازلَ تُقرَّب ولا تُردّ", () => {
    const cheesecake = parsed.products.find((p) => p.productSku === "sk-0023")!;
    expect(cheesecake.declaredCostMinor).toBe(917);
  });

  it("ومن لا كلفةَ معلَنةً له تبقى فارغةً لا صفراً", () => {
    expect(parsed.products.find((p) => p.productSku === "sk-0007")!.declaredCostMinor).toBeNull();
  });
});

describe("الوصفات — ١٤٢ سطراً", () => {
  const parsed = read(INGREDIENTS);

  it("تُقرأ كلُّها", () => {
    expect(parsed.rows).toBe(142);
    expect(parsed.recipeLines).toHaveLength(142);
    expect(parsed.issues).toHaveLength(0);
  });

  it("والسطرُ يحمل طرفيه بنطاقيهما", () => {
    const line = parsed.recipeLines[0];
    expect(line.productSku).toBe("sk-0059");
    expect(line.productName).toBe("Iced V60 Colombia");
    expect(line.itemSku).toBe("sk-0002");
    expect(line.itemName).toBe("Colombia margo");
    expect(line.quantityMilli).toBe(20_000);
    expect(line.unit).toBe("G");
  });

  /*
    ── ٣٩ رمزاً من ٦٠ تعني شيئين ──

    `sk-0002` منتجاً «Espresso» وصنفَ مخزونٍ «Colombia margo». وهذا
    الاختبار يقف على الحدّ: لو خُلط النطاقان لصار البنُّ هو الإسبريسو،
    ولاستهلكت الوصفةُ نفسَها.
  */
  it("ورمزُ المنتج ورمزُ المكوّن نطاقان — ولهما ٣٩ تصادماً", () => {
    const products = new Set(read(PRODUCTS).products.map((p) => p.productSku));
    const items = new Set(read(ITEMS).items.map((i) => i.itemSku));
    const clashes = [...items].filter((s) => products.has(s));
    expect(clashes).toHaveLength(39);
    expect(clashes).toContain("sk-0002");

    /* وفي الوصفة الواحدة يظهر الرمزان معاً بمعنيين مختلفين */
    const espresso = parsed.recipeLines.filter((l) => l.productSku === "sk-0002");
    expect(espresso.map((l) => l.itemSku).sort()).toEqual(["sk-0039", "sk-0043"]);
  });

  it("وكلُّ مكوّنٍ له صنفُ مخزونٍ قائم", () => {
    const items = new Set(read(ITEMS).items.map((i) => i.itemSku));
    const orphans = parsed.recipeLines.filter((l) => !items.has(l.itemSku));
    expect(orphans).toHaveLength(0);
  });
});

describe("الكلفةُ تُحسَب ولا تُنسَخ", () => {
  const items = new Map(read(ITEMS).items.map((i) => [i.itemSku, i] as const));
  const lines = read(INGREDIENTS).recipeLines;

  /*
    ── المطابقةُ دليلُ فهمٍ لا بديلٌ عن الحساب ──

    ‏١٤٢ سطراً، وحسابُنا يطابق `ingredient_cost` في كلٍّ منها إلى
    الهللة. ولو اختلف سطرٌ واحد لكان معناه أنّنا أسأنا فهمَ العبوة أو
    الوحدة — ولم نكن لنعلم لولا المقابلة.
  */
  it("‏١٤٢ سطراً: حسابُنا يطابق ما يقوله الملفّ في كلٍّ منها", () => {
    const off: string[] = [];
    for (const l of lines) {
      const item = items.get(l.itemSku)!;
      const ours = lineCostMilliMinor(l.quantityMilli, l.unit, item);
      expect(ours).not.toBeNull();
      if (l.statedCostMinor === null) continue;
      if (Math.abs(toMinor(ours!) - l.statedCostMinor) > 1) {
        off.push(`${l.productSku}←${l.itemSku}: ${toMinor(ours!)} ≠ ${l.statedCostMinor}`);
      }
    }
    expect(off).toEqual([]);
  });

  /*
    ── ٢٫١٢٥ هللة ──

    كرتونُ المصّاصات ٨٥ ريالاً لأربعة آلاف. فالكلفةُ لا تُمثَّل بهللةٍ
    صحيحة، ومن قرّبها إلى ٢ أسقط ٦٪ ومن قرّبها إلى ٣ زادها ٤١٪. وفي
    مِلّي‑الهللة تُمثَّل بالضبط.
  */
  it("ومصّاصةٌ واحدة ٢٬١٢٥ مِلّي‑هللة — لا هللتين ولا ثلاثاً", () => {
    const straws = items.get("sk-0007")!;
    expect(unitCostMilliMinor(straws)).toBe(2_125);
  });

  it("وكلفةُ الوصفة تُجمَع بالمِلّي وتُقرَّب مرّةً واحدة", () => {
    const iced = lines.filter((l) => l.productSku === "sk-0009");
    const total = iced.reduce((s, l) => s + lineCostMilliMinor(l.quantityMilli, l.unit, items.get(l.itemSku)!)!, 0);
    expect(total).toBe(268_868);
    /* ‏٢٫٦٩ ريالاً — ولو قُرِّب كلُّ سطرٍ على حدةٍ لخرج غيرُه */
    expect(toMinor(total)).toBe(269);
  });

  /*
    ── ولا جسر بين وزنٍ وحجم ──

    عشرون جراماً من صنفٍ وحدتُه اللتر لا تُحوَّل، فتعود `null` ولا
    يُحسَب لها ثمن. وصفرٌ هنا يقول «بلا كلفة» وهو كذب.
  */
  it("ووحدةٌ من عائلةٍ أخرى تُرَدّ `null` لا صفراً", () => {
    const milk: StockItemRow = items.get("sk-0008")!;
    expect(lineCostMilliMinor(20_000, "G", milk)).toBeNull();
  });

  it("ويُحوَّل داخل العائلة: ٠٫٠٢ كيلو سكرٍ = ‏١٠ هللات", () => {
    const sugar = items.get("sk-0027")!;
    expect(sugar.baseUnit).toBe("KG");
    expect(toMinor(lineCostMilliMinor(20, "KG", sugar)!)).toBe(10);
    expect(toMinor(lineCostMilliMinor(20_000, "G", sugar)!)).toBe(10);
  });
});
