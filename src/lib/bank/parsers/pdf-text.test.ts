import { describe, expect, it } from "vitest";
import { ROW_TOLERANCE, groupIntoRows, type PdfWord } from "./pdf-text";

const w = (text: string, x: number, y: number, page = 1): PdfWord => ({ text, x, y, page });

describe("groupIntoRows", () => {
  it("يجمع ما تقارب ارتفاعه في صفّ", () => {
    const rows = groupIntoRows([
      w("التاريخ", 500, 700),
      w("المبلغ", 300, 700),
      w("17/08/2026", 500, 680),
      w("500.00", 300, 680),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["التاريخ", "المبلغ"]);
    expect(rows[1]).toEqual(["17/08/2026", "500.00"]);
  });

  it("يتسامح مع اختلاف الارتفاع داخل السطر الواحد", () => {
    const rows = groupIntoRows([
      w("أ", 500, 700),
      w("ب", 300, 700 + ROW_TOLERANCE - 1),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("وما جاوز التسامح سطرٌ آخر", () => {
    const rows = groupIntoRows([
      w("أ", 500, 700),
      w("ب", 300, 700 + ROW_TOLERANCE + 2),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("يرتّب داخل السطر من اليمين — الكشوف عربية", () => {
    const rows = groupIntoRows([w("يسار", 100, 500), w("يمين", 900, 500)]);
    expect(rows[0]).toEqual(["يمين", "يسار"]);
  });

  it("ينزل في الصفحة: الأعلى أوّلاً", () => {
    const rows = groupIntoRows([w("أسفل", 500, 100), w("أعلى", 500, 700)]);
    expect(rows[0]).toEqual(["أعلى"]);
    expect(rows[1]).toEqual(["أسفل"]);
  });

  it("الصفحات بترتيبها ولا تختلط أسطرها", () => {
    const rows = groupIntoRows([
      w("صفحة٢", 500, 700, 2),
      w("صفحة١", 500, 700, 1),
    ]);
    expect(rows[0]).toEqual(["صفحة١"]);
    expect(rows[1]).toEqual(["صفحة٢"]);
  });

  it("لا كلمات فلا صفوف", () => {
    expect(groupIntoRows([])).toEqual([]);
  });
});
