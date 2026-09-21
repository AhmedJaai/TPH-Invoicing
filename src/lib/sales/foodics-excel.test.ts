import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { adapterFor, contentFingerprint, findHeader, foodicsExcelAdapter } from "./foodics-excel";
import { mapColumns, normaliseHeader } from "./columns";
import { detectDateOrder, parseBusinessDate, parseSourceCostMinor, parseQuantityMilli } from "./values";
import { toSalesTransactions, type ParsedSalesFile } from "./file-import";
import { readWorkbookSafely } from "@/lib/bank/parsers/safe-xlsx";

/**
 * المحوِّل يُختبَر على **التصدير الحقيقيّ** لا على ملفٍّ مصنوع.
 *
 * والنسخةُ في `src/test/fixtures` هي الملفُّ نفسُه، فُرّغت منه ثلاثةُ
 * أعمدةٍ شخصيّة (اسمُ العميل ومفتاحُه ورقمُ جوّاله) لا شأن للجرد بها.
 * وما عداها كما ورد حرفاً بحرف: الطلباتُ والأصنافُ والحالاتُ
 * والمُعدِّلاتُ والتواريخُ والمبالغ.
 */
const FIXTURE = "src/test/fixtures/foodics-order-items.xlsx";

function parseReal(): ParsedSalesFile {
  const wb = readWorkbookSafely(readFileSync(FIXTURE), { includeRaw: true });
  return foodicsExcelAdapter.parse({ grid: wb.sheets[0].grid, raw: wb.sheets[0].raw }, {});
}

/** ملفٌّ مصنوع بترويسة فودكس نفسِها — لحالاتٍ لا توجد في الملفّ الحقيقيّ. */
const HEADER = [
  "order_reference", "order_status", "type", "parent_item_sku", "status",
  "sku", "name", "unit_price", "unit_cost", "quantity", "total_price", "business_date",
  "branch_name", "branch_reference",
];

function sheet(rows: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), "S");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safe = readWorkbookSafely(buf, { includeRaw: true });
  return { grid: safe.sheets[0].grid, raw: safe.sheets[0].raw };
}

const line = (over: Partial<Record<string, string | number>> = {}) => {
  const base: Record<string, string | number> = {
    order_reference: 1, order_status: "Done", type: "المنتج", parent_item_sku: "",
    status: "Done", sku: "sk-0001", name: "Latte", unit_price: 20, unit_cost: 3.876,
    quantity: 1, total_price: 20, business_date: "2026-09-13",
    branch_name: "Branch 1", branch_reference: "B01",
  };
  return HEADER.map((h) => ({ ...base, ...over })[h] ?? "");
};

/* ═══════════ التصدير الحقيقيّ ═══════════ */

describe("التصديرُ الحقيقيّ يُقرأ كما هو", () => {
  const parsed = parseReal();

  it("يُعرَف بترويسته، وصيغتُه بنودُ طلبات", () => {
    expect(parsed.shape).toBe("FOODICS_ORDER_ITEMS");
    expect(parsed.blocked).toBeUndefined();
  });

  it("‏١٬٠٩٠ طلباً و٢٬٠٨١ سطراً — كلُّها مقروءة", () => {
    expect(parsed.sales).toHaveLength(1090);
    expect(parsed.rows).toHaveLength(2081);
    expect(parsed.rows.every((r) => r.status === "PARSED")).toBe(true);
  });

  it("والفترةُ سبعةُ أيّامٍ متّصلة — من عددٍ تسلسليّ لا من نصٍّ مصيَّر", () => {
    expect(parsed.periodStart).toBe("2026-09-13");
    expect(parsed.periodEnd).toBe("2026-09-19");
    const days = new Set(parsed.sales.map((s) => s.businessDate));
    expect(days.size).toBe(7);
  });

  it("‏١٬٧١٧ منتجاً و٣٦٤ خيارَ إضافة — والفضاءان لا يتقاطعان", () => {
    const lines = parsed.sales.flatMap((s) => s.lines);
    expect(lines.filter((l) => !l.isModifier)).toHaveLength(1717);
    expect(lines.filter((l) => l.isModifier)).toHaveLength(364);

    const productSkus = new Set(lines.filter((l) => !l.isModifier).map((l) => l.productExternalId));
    const modSkus = new Set(lines.filter((l) => l.isModifier).map((l) => l.productExternalId));
    expect([...modSkus].filter((s) => productSkus.has(s))).toEqual([]);
  });

  it("والوحداتُ: إجمالي ٢٬٠٦١ · تامّ ٢٬٠٣٣ · مرتجَع ٢١ · ملغى ٧", () => {
    const p = parsed.sales.flatMap((s) => s.lines).filter((l) => !l.isModifier);
    const units = (f: (l: typeof p[number]) => boolean) =>
      p.filter(f).reduce((s, l) => s + l.quantityMilli / 1000, 0);

    expect(units(() => true)).toBe(2061);
    expect(units((l) => !l.isRefund && !l.isVoid)).toBe(2033);
    expect(units((l) => l.isRefund)).toBe(21);
    expect(units((l) => l.isVoid)).toBe(7);
  });

  it("**والمرتجَعُ كمّيّتُه موجبة** — لا سالبَ في الملفّ إطلاقاً", () => {
    const lines = parsed.sales.flatMap((s) => s.lines);
    expect(lines.every((l) => l.quantityMilli > 0)).toBe(true);
    const returned = lines.filter((l) => l.isRefund);
    expect(returned.length).toBeGreaterThan(0);
    expect(returned.every((l) => l.sourceStatus === "Returned")).toBe(true);
  });

  it("وحالُ البند تغلب حالَ الطلب — طلبٌ فيه ملغىً وتامّ معاً", () => {
    const mixed = parsed.sales.find((s) => {
      const p = s.lines.filter((l) => !l.isModifier);
      return p.some((l) => l.isVoid) && p.some((l) => !l.isVoid);
    });
    expect(mixed).toBeDefined();
    /* ولا يُعَدّ الطلبُ كلُّه ملغىً ما دام فيه بندٌ صُنع */
    expect(mixed!.isVoid).toBe(false);
  });

  it("و«دبل شوت» خيارٌ بسعر صفرٍ لا إضافةُ مكوّن", () => {
    const doubles = parsed.sales.flatMap((s) => s.lines)
      .filter((l) => l.isModifier && l.name === "Double shots");
    expect(doubles).toHaveLength(158);
    expect(doubles.every((l) => l.unitPriceMinor === 0)).toBe(true);
    expect(doubles.every((l) => l.parentExternalId !== null)).toBe(true);
  });

  it("وكمّيّةُ الخيار = كمّيّةُ أصله دائماً", () => {
    for (const sale of parsed.sales) {
      for (const m of sale.lines.filter((l) => l.isModifier)) {
        const parent = sale.lines.find((l) => !l.isModifier && l.productExternalId === m.parentExternalId);
        if (parent) expect(m.quantityMilli).toBe(parent.quantityMilli);
      }
    }
  });

  it("**وسعرُ الأصل يشمل خياراته** — فلا يُجمَع إيرادُ الخيار معه", () => {
    /* ماتشا ٢٥×٢ مع Coconut ٤×٢ ← إجمالي ٥٨ لا ٥٠ */
    const matcha = parsed.sales
      .flatMap((s) => s.lines)
      .find((l) => l.name === "Matcha" && (l.modifiers?.includes("Coconut") ?? false) && l.quantityMilli === 2000);
    expect(matcha).toBeDefined();
    expect(matcha!.unitPriceMinor).toBe(2500);
    expect(matcha!.lineTotalMinor).toBe(5800);

    /* والإيرادُ المجمَّع لا يعدّ صفوف الخيارات */
    const revenue = parsed.sales.reduce((s, x) => s + x.netMinor + x.refundMinor, 0);
    const productSum = parsed.sales.flatMap((s) => s.lines)
      .filter((l) => !l.isModifier && !l.isVoid)
      .reduce((s, l) => s + l.lineTotalMinor, 0);
    expect(revenue).toBe(productSum);
  });

  it("ولا يُدَّعى «مجانيّ» — لا عمودَ يدلّ عليه في هذا المصدر", () => {
    expect(parsed.sales.flatMap((s) => s.lines).every((l) => l.isComplimentary === false)).toBe(true);
  });

  it("والطلبُ لا يمتدّ على يومين", () => {
    expect(new Set(parsed.sales.map((s) => s.externalId)).size).toBe(parsed.sales.length);
  });

  it("ومخرَجُه هو نوعُ الموصل نفسُه — بلا خيارات", () => {
    const tx = toSalesTransactions(parsed);
    expect(tx).toHaveLength(1090);
    expect(tx.flatMap((t) => t.lines)).toHaveLength(1717);
  });

  it("والأعمدةُ التي لم تُقرأ تُعلَن بأسمائها", () => {
    expect(parsed.recognisedColumns.length).toBeGreaterThan(10);
    expect(parsed.unrecognisedColumns).not.toContain("quantity");
  });
});

/* ═══════════ الترويسة والقيم ═══════════ */

describe("فهمُ الترويسة", () => {
  it("يوحّد الفراغَ والشرطةَ والهمزةَ والتاء المربوطة", () => {
    expect(normaliseHeader("Net Sales")).toBe("netsales");
    expect(normaliseHeader("business_date")).toBe("businessdate");
    expect(normaliseHeader("الكمّيّة")).toBe("الكميه");
  });

  it("**`name` يسبق `name_localized`** — والثاني فارغٌ في التصدير الحقيقيّ", () => {
    const m = mapColumns(["sku", "name", "name_localized", "quantity"]);
    expect(m.index.productName).toBe(1);
    expect(m.index.productNameLocalized).toBe(2);
  });

  it("ويربط أعمدةَ فودكس بحقولها", () => {
    const m = mapColumns(HEADER);
    expect(m.index.orderId).toBe(0);
    expect(m.index.lineType).toBe(2);
    expect(m.index.parentSku).toBe(3);
    expect(m.index.lineStatus).toBe(4);
    expect(m.index.productExternalId).toBe(5);
    expect(m.index.businessDate).toBe(11);
  });

  it("والترويسةُ تُطلَب بعد أسطر العنوان", () => {
    expect(findHeader([["تقرير"], [], HEADER])?.rowIndex).toBe(2);
    expect(findHeader([["عنوان"], ["فترة"]])).toBeNull();
  });
});

describe("التواريخ والقيم", () => {
  it("العددُ التسلسليّ لا لبسَ فيه", () => {
    expect(parseBusinessDate("46284", "ISO")).toBe("2026-09-19");
    expect(parseBusinessDate("46278", "ISO")).toBe("2026-09-13");
  });

  it("**والسنةُ من خانتين تُقرأ** — «9/19/26» يُصيَّرها إكسل", () => {
    expect(parseBusinessDate("9/19/26", "MDY")).toBe("2026-09-19");
    expect(parseBusinessDate("19/9/26", "DMY")).toBe("2026-09-19");
    expect(detectDateOrder(["9/19/26", "9/13/26"])).toBe("MDY");
  });

  it("وكلفةُ المصدر تُقرأ بمنازلها الخمس — إعلاميّةً لا للتقييم", () => {
    expect(parseSourceCostMinor("2.92246")).toBe(292);
    expect(parseSourceCostMinor("3.876")).toBe(388);
    expect(parseSourceCostMinor("-")).toBeNull();
  });

  it("والكمّيّةُ تُقرأ عربيّةً ولاتينيّة", () => {
    expect(parseQuantityMilli("٣")).toBe(3000);
    expect(parseQuantityMilli("1,234.5")).toBe(1_234_500);
    expect(parseQuantityMilli("")).toBeNull();
  });
});

/* ═══════════ حالاتٌ لا توجد في الملفّ الحقيقيّ ═══════════ */

describe("حالاتٌ تُصنَع لأنّها لم ترد", () => {
  it("الصنفُ المكرَّر في الطلب الواحد يبقى سطرين — الترتيبُ يفرّقهما", () => {
    const p = foodicsExcelAdapter.parse(sheet([
      line({ order_reference: 7, sku: "sk-0014", name: "Water" }),
      line({ order_reference: 7, sku: "sk-0014", name: "Water" }),
    ]), {});
    expect(p.sales[0].lines).toHaveLength(2);
    expect(new Set(p.sales[0].lines.map((l) => l.externalId)).size).toBe(2);
  });

  it("وخيارٌ بلا أصلٍ يُعلَن ولا يُطرَح", () => {
    const p = foodicsExcelAdapter.parse(sheet([
      line({ order_reference: 8, type: "خيار الإضافة", parent_item_sku: "sk-9999", sku: "sk-0039", name: "Double shots", unit_price: 0, total_price: 0 }),
    ]), {});
    expect(p.warnings.some((w) => w.includes("لا أصلَ له"))).toBe(true);
    expect(p.sales[0].lines[0].isModifier).toBe(true);
  });

  it("وصفٌّ بلا كمّيّة يُتخطّى بسببه لا يُعَدّ خطأً", () => {
    const p = foodicsExcelAdapter.parse(sheet([
      line({ order_reference: 9 }),
      line({ order_reference: 0, sku: "", name: "الإجمالي", quantity: "" }),
    ]), {});
    expect(p.rows[1].status).toBe("SKIPPED");
    expect(p.rows[1].reason).toContain("مجموع");
  });

  it("وكمّيّةٌ مكتوبةٌ لا تُقرأ خطأٌ يُعلَن", () => {
    const p = foodicsExcelAdapter.parse(sheet([line({ order_reference: 10, quantity: "غير مقروء" })]), {});
    expect(p.rows[0].status).toBe("ERROR");
    expect(p.rows[0].reason).toContain("الكمّيّة");
    expect(p.rows[0].raw["name"]).toBe("Latte");
  });

  it("وبصمةُ المحتوى تتغيّر بتغيّر الحال — وبها يُعرَف المُراجَع", () => {
    const a = foodicsExcelAdapter.parse(sheet([line({ order_reference: 11 })]), {});
    const b = foodicsExcelAdapter.parse(sheet([line({ order_reference: 11, status: "Void", order_status: "Void" })]), {});
    expect(a.sales[0].lines[0].externalId).toBe(b.sales[0].lines[0].externalId);
    expect(a.sales[0].lines[0].contentHash).not.toBe(b.sales[0].lines[0].contentHash);
  });

  it("والبصمةُ ثابتةٌ لما لم يتغيّر", () => {
    expect(contentFingerprint([1, "Done", 20, "2026-09-13", "B01"]))
      .toBe(contentFingerprint([1, "Done", 20, "2026-09-13", "B01"]));
    expect(contentFingerprint([1, "Done", 20, "2026-09-13", "B01"]))
      .not.toBe(contentFingerprint([2, "Done", 20, "2026-09-13", "B01"]));
  });

  it("وما لم يُفهَم يُعلَن سببُه لقارئه", () => {
    const p = foodicsExcelAdapter.parse({ grid: [["اسم"], ["قيمة"]] }, {});
    expect(p.blocked).toContain("اسم الصنف");
  });

  it("والمحوِّلُ يُعرَف بالترويسة لا باسم الملفّ", () => {
    expect(adapterFor([HEADER])).toBe(foodicsExcelAdapter);
    expect(adapterFor([["a", "b"]])).toBeNull();
  });
});
