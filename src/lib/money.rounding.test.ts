import { describe, expect, it } from "vitest";
import { TOTAL_ROUNDING_TOLERANCE_MINOR, isSupplierRounding } from "./money";

describe("isSupplierRounding", () => {
  it("تقبل الفاتورتين الحقيقيتين اللتين رفضهما القيد الصارم", () => {
    // ملتقى الأواني: ٥٢٥٫٠٠ + ٧٨٫٧٥ = ٦٠٣٫٧٥، والمطبوع ٦٠٣٫٠٠
    expect(isSupplierRounding(525_00, 78_75, 603_00)).toBe(true);
    // مختبرات القهوة: ٥٧٤٫٠٠ + ٨٦٫١٠ = ٦٦٠٫١٠، والمطبوع ٦٦٠٫٠٠
    expect(isSupplierRounding(574_00, 86_10, 660_00)).toBe(true);
  });

  it("الاتّساق التامّ ليس تقريباً", () => {
    expect(isSupplierRounding(100_00, 15_00, 115_00)).toBe(false);
  });

  it("التقريب لأعلى كالتقريب لأدنى", () => {
    expect(isSupplierRounding(100_00, 15_00, 115_50)).toBe(true);
  });

  it("حدّ التسامح ريالٌ واحد لا أكثر", () => {
    expect(TOTAL_ROUNDING_TOLERANCE_MINOR).toBe(100);
    expect(isSupplierRounding(100_00, 15_00, 114_00)).toBe(true);
    expect(isSupplierRounding(100_00, 15_00, 113_99)).toBe(false);
  });

  it("ما جاوز الريال خطأ قراءة لا تقريب", () => {
    expect(isSupplierRounding(100_00, 15_00, 200_00)).toBe(false);
  });
});
