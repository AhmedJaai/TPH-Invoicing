import { describe, expect, it } from "vitest";
import { formatSort, nextSort, parseSort, sortRows } from "./table-sort";

describe("parseSort", () => {
  it("يقرأ المفتاحَ والاتّجاه", () => {
    expect(parseSort("owed.desc", ["owed", "name"])).toEqual({ key: "owed", dir: "desc" });
    expect(parseSort("name.asc", ["owed", "name"])).toEqual({ key: "name", dir: "asc" });
  });

  it("ما ليس عموداً يُرتَّب به، أو شكلٌ لا يُفهم، يُهمَل ولا يرمي", () => {
    expect(parseSort("secret.desc", ["owed"])).toBeNull();
    expect(parseSort("owed", ["owed"])).toBeNull();
    expect(parseSort("owed.down", ["owed"])).toBeNull();
    expect(parseSort("owed.desc;drop", ["owed"])).toBeNull();
    expect(parseSort(null, ["owed"])).toBeNull();
    expect(parseSort("", ["owed"])).toBeNull();
  });

  it("يعود كما كُتب", () => {
    expect(formatSort(parseSort("owed.desc", ["owed"]))).toBe("owed.desc");
    expect(formatSort(null)).toBeNull();
  });
});

describe("nextSort — ثلاثُ ضغطات: الطبيعيّ ثمّ عكسه ثمّ ترتيبُ الخادم", () => {
  it("المال يبدأ من الأكبر", () => {
    const one = nextSort(null, "owed", "desc");
    expect(one).toEqual({ key: "owed", dir: "desc" });
    const two = nextSort(one, "owed", "desc");
    expect(two).toEqual({ key: "owed", dir: "asc" });
    expect(nextSort(two, "owed", "desc")).toBeNull();
  });

  it("عمودٌ آخر يبدأ من أوّله لا من حال سابقه", () => {
    expect(nextSort({ key: "owed", dir: "asc" }, "name", "asc")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("sortRows", () => {
  const rows = [
    { n: "ب", owed: 500 },
    { n: "مجهول", owed: null },
    { n: "أ", owed: 120_000 },
    { n: "ج", owed: 0 },
    { n: "د", owed: 500 },
  ];

  it("من الأكبر: والمجهولُ آخراً لا صفراً", () => {
    expect(sortRows(rows, (r) => r.owed, "desc").map((r) => r.n)).toEqual(["أ", "ب", "د", "ج", "مجهول"]);
  });

  it("من الأصغر: الصفرُ المعلوم أوّلاً والمجهولُ يبقى آخراً — لا يتصدّر كأنّه صفر", () => {
    expect(sortRows(rows, (r) => r.owed, "asc").map((r) => r.n)).toEqual(["ج", "ب", "د", "أ", "مجهول"]);
  });

  it("المتساويان يبقيان على ترتيب الخادم في الاتّجاهين", () => {
    const d = sortRows(rows, (r) => r.owed, "desc").map((r) => r.n);
    const a = sortRows(rows, (r) => r.owed, "asc").map((r) => r.n);
    expect(d.indexOf("ب")).toBeLessThan(d.indexOf("د"));
    expect(a.indexOf("ب")).toBeLessThan(a.indexOf("د"));
  });

  it("النصُّ بترتيب العربيّة، والرقمُ داخله بقيمته", () => {
    expect(sortRows([{ s: "فاتورة 10" }, { s: "فاتورة 9" }, { s: "أرز" }], (r) => r.s, "asc").map((r) => r.s))
      .toEqual(["أرز", "فاتورة 9", "فاتورة 10"]);
  });

  it("لا يغيّر المصفوفةَ الأصل", () => {
    const before = rows.map((r) => r.n);
    sortRows(rows, (r) => r.owed, "desc");
    expect(rows.map((r) => r.n)).toEqual(before);
  });
});
