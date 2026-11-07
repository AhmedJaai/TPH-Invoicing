import { describe, expect, it } from "vitest";
import { partFields, partsText, readParts, storagePack, sumParts, unusualCount } from "./count-parts";

/** ورقةُ أنس: «اكواب ١٢ اونص — كرتون ١٩، حبّة ٨٩٧»، و«سيرب فانيلا — جرام ٥٠٠». */
describe("sumParts", () => {
  const carton = storagePack("PIECE", "كرتون", 500_000); // ٥٠٠ كاس
  it("كرتونٌ وحبّاتٌ تُجمع حبّاتٍ: ١٩ × ٥٠٠ + ٨٩٧ = ١٠٣٩٧", () => {
    const r = sumParts([{ key: "STORAGE", quantity: "19" }, { key: "PIECE", quantity: "897" }], "PIECE", carton);
    expect(r).toEqual({ ok: true, canonical: 10_397_000, parts: [
      { key: "STORAGE", label: "كرتون", quantity: "19" }, { key: "PIECE", label: "حبّة", quantity: "897" },
    ] });
  });
  it("كيلو وجرام تُجمع جراماتٍ — بأرقامٍ عربيّة أيضاً", () => {
    const r = sumParts([{ key: "KG", quantity: "٢" }, { key: "G", quantity: "300" }], "G", null);
    expect(r.ok && r.canonical).toBe(2_300_000);
  });
  it("لترٌ ونصف وملّلات", () => {
    const r = sumParts([{ key: "L", quantity: "1.5" }, { key: "ML", quantity: "250" }], "ML", null);
    expect(r.ok && r.canonical).toBe(1_750_000);
  });
  it("كلُّ الخانات فارغة ← «لم يُعَدّ» لا صفر؛ وصفرٌ مكتوبٌ صفر", () => {
    expect(sumParts([{ key: "PIECE", quantity: "" }], "PIECE", null)).toEqual({ ok: true, canonical: null, parts: [] });
    expect(sumParts([{ key: "PIECE", quantity: "0" }], "PIECE", null)).toMatchObject({ ok: true, canonical: 0 });
  });
  it("يرفض وحدةً من غير العائلة، وكرتوناً لا يُعرف محتواه، وما ليس رقماً", () => {
    expect(sumParts([{ key: "KG", quantity: "1" }], "ML", null).ok).toBe(false);
    expect(sumParts([{ key: "STORAGE", quantity: "1" }], "PIECE", null).ok).toBe(false);
    expect(sumParts([{ key: "PIECE", quantity: "1-7" }], "PIECE", null).ok).toBe(false);
    expect(sumParts([{ key: "PIECE", quantity: "1,500" }], "PIECE", null).ok).toBe(false);
  });
  it("نصفُ كرتونٍ من ٣٣٣ يُقرَّب إلى جزءٍ من ألفٍ من الحبّة", () => {
    const r = sumParts([{ key: "STORAGE", quantity: "0.5" }], "PIECE", storagePack("PIECE", "كرتون", 333_000));
    expect(r.ok && r.canonical).toBe(166_500);
  });
});

describe("partFields · storagePack", () => {
  it("وحدةُ التخزين أوّلاً ثمّ الأكبرُ فالأصغر", () => {
    expect(partFields("G", storagePack("G", "كيس", 1_000_000)).map((f) => f.label)).toEqual(["كيس", "كيلو", "جرام"]);
    expect(partFields("PIECE", null).map((f) => f.key)).toEqual(["PIECE"]);
  });
  it("«كيلو» وحدةَ تخزينٍ للبنّ لا تُكرّر خانةَ الكيلو، والكرتونُ والكيسُ يبقيان", () => {
    expect(storagePack("G", "كيلو", 1_000_000)).toBeNull();
    expect(storagePack("G", "Kg", 1_000_000)).toBeNull();
    expect(storagePack("PIECE", "حبّة", 12_000)).toBeNull();
    expect(storagePack("G", "كيس", 1_000_000)?.label).toBe("كيس");
  });
  it("«G» بمعاملٍ واحد ليست وحدةَ تخزين", () => {
    expect(storagePack("G", "G", 1000)).toBeNull();
    expect(storagePack("PIECE", "", 500_000)).toBeNull();
    expect(storagePack("PIECE", "كرتون", null)).toBeNull();
  });
});

describe("partsText · readParts", () => {
  it("يكتب ما عُدّ كما كُتب، ويقرأ المخزَّنَ بفحص", () => {
    const parts = [{ key: "STORAGE" as const, label: "كرتون", quantity: "19" }, { key: "PIECE" as const, label: "حبّة", quantity: "897" }];
    expect(partsText(parts)).toBe("19 كرتون + 897 حبّة");
    expect(readParts(JSON.parse(JSON.stringify(parts)))).toEqual(parts);
    expect(readParts([{ key: "WAT", label: "x", quantity: "1" }])).toBeNull();
    expect(readParts("x")).toBeNull();
  });
});

describe("unusualCount", () => {
  it("صفرٌ زائد أو ناقص عن الأسبوع الماضي يُسأل عنه، والتغيّرُ العاديّ لا", () => {
    expect(unusualCount(8_970_000, 897_000)).toBe(true);
    expect(unusualCount(89_000, 897_000)).toBe(true);
    expect(unusualCount(700_000, 897_000)).toBe(false);
    expect(unusualCount(2_000_000, 897_000)).toBe(false);
  });
  it("ولا يُحكم بلا سابقٍ أو على صفر", () => {
    expect(unusualCount(5_000, null)).toBe(false);
    expect(unusualCount(0, 897_000)).toBe(false);
    expect(unusualCount(null, 897_000)).toBe(false);
  });
});
