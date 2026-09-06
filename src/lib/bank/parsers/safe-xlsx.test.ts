import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  MAX_CELL_CHARS, MAX_COLS, MAX_ROWS, MAX_SHEETS,
  readWorkbookSafely, stripPrototypeKeys,
} from "./safe-xlsx";

function book(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("نزع مفاتيح النموذج الأوّليّ", () => {
  /*
    الحرس يمنع الأثر لا السبب — لكنّ الأثر هو ما يضرّ.
  */
  it("`__proto__` لا يمرّ", () => {
    const dirty = JSON.parse('{"a":1,"__proto__":{"polluted":true}}');
    const clean = stripPrototypeKeys(dirty) as Record<string, unknown>;
    expect(clean.a).toBe(1);
    expect(Object.keys(clean)).not.toContain("__proto__");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("و`constructor` و`prototype` كذلك", () => {
    const clean = stripPrototypeKeys(
      JSON.parse('{"constructor":1,"prototype":2,"ok":3}'),
    ) as Record<string, unknown>;
    expect(Object.keys(clean)).toEqual(["ok"]);
  });

  it("ويعمل في العمق وفي المصفوفات", () => {
    const clean = stripPrototypeKeys(
      JSON.parse('[{"__proto__":{"x":1},"v":"أ"}]'),
    ) as Record<string, unknown>[];
    expect(clean[0].v).toBe("أ");
    expect(Object.keys(clean[0])).not.toContain("__proto__");
  });

  it("والقيم البسيطة تمرّ كما هي", () => {
    expect(stripPrototypeKeys("نصّ")).toBe("نصّ");
    expect(stripPrototypeKeys(7)).toBe(7);
    expect(stripPrototypeKeys(null)).toBeNull();
  });
});

describe("قراءة المصنّف بحدوده", () => {
  it("الملفّ العاديّ يُقرأ كاملاً", () => {
    const wb = readWorkbookSafely(book({ Sheet1: [["التاريخ", "المبلغ"], ["2026-08-01", "100"]] }));
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0].grid[0]).toEqual(["التاريخ", "المبلغ"]);
    expect(wb.warnings).toEqual([]);
  });

  /* القصّ الصامت يجعل الكشف يبدو تامّاً وهو ناقص */
  it("الأعمدة الزائدة تُقصّ ويُعلَن القصّ", () => {
    const wide = [Array.from({ length: MAX_COLS + 10 }, (_, i) => `c${i}`)];
    const wb = readWorkbookSafely(book({ Sheet1: wide }));
    expect(wb.sheets[0].grid[0]).toHaveLength(MAX_COLS);
    expect(wb.sheets[0].truncated.cols).toBe(true);
    expect(wb.warnings.some((w) => w.includes("أعرض"))).toBe(true);
  });

  it("الخلية الطويلة تُقصّ", () => {
    const wb = readWorkbookSafely(book({ Sheet1: [["أ".repeat(MAX_CELL_CHARS + 500)]] }));
    expect(wb.sheets[0].grid[0][0]).toHaveLength(MAX_CELL_CHARS);
  });

  it("الأوراق الزائدة تُترَك ويُعلَن", () => {
    const many: Record<string, unknown[][]> = {};
    for (let i = 0; i < MAX_SHEETS + 3; i++) many[`S${i}`] = [["أ"]];
    const wb = readWorkbookSafely(book(many));
    expect(wb.sheets).toHaveLength(MAX_SHEETS);
    expect(wb.warnings.some((w) => w.includes("ورقة"))).toBe(true);
  });

  it("الحدود مذكورة صراحةً لا مدفونة", () => {
    expect(MAX_ROWS).toBe(50_000);
    expect(MAX_COLS).toBe(200);
    expect(MAX_SHEETS).toBe(20);
  });

  /*
    و`xlsx` لا ترمي على نصٍّ غير مصنّف: تقرؤه جدولاً بصفٍّ واحد. وهذا
    سلوكها الموثَّق، ولا يُصلَح هنا — يُصلَح فوقه: `locateHeader` لا
    تجد رؤوساً، فيُرَدّ الملفّ بـ«لم تُقرأ أي حركة». والخطأ يُسمَع.
  */
  it("النصّ غير المصنّف لا يُنتج كشفاً — تردّه طبقةُ الرؤوس فوقه", () => {
    const wb = readWorkbookSafely(Buffer.from("ليس مصنّفاً"));
    expect(wb.sheets.flatMap((s) => s.grid).length).toBeLessThanOrEqual(1);
  });
});
