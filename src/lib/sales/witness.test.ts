import { describe, expect, it } from "vitest";
import { buildSalesWitness, expectedDaysOf, type WitnessDay } from "./witness";

const day = (d: string, salesMinor: number, vatMinor: number, refundMinor = 0): WitnessDay => ({ day: d, salesMinor, vatMinor, refundMinor });

describe("شاهد المبيعات من ملفّ فودكس", () => {
  it("بلا ملفٍّ للشهر: لا شاهد، والأرقامُ مجهولةٌ لا صفر", () => {
    const w = buildSalesWitness({ month: "2026-08", today: "2026-10-10", days: [day("2026-09-01", 100_00, 15_00)], returnOutputVatMinor: 900_00, cashTypedGrossMinor: null });
    expect(w.verdict).toBe("NO_FILE");
    expect(w.salesMinor).toBeNull();
    expect(w.vatMinor).toBeNull();
    expect(w.vatGapMinor).toBeNull();
    expect(w.expectedDays).toBe(31);
  });

  it("فودكس أعلى: الفرقُ بالضريبة وبما يقابله مبيعاتٍ شاملةً", () => {
    const w = buildSalesWitness({
      month: "2026-09", today: "2026-10-10",
      days: [day("2026-09-01", 10_000_00, 1_500_00), day("2026-09-02", 10_000_00, 1_500_00)],
      returnOutputVatMinor: 2_700_00, cashTypedGrossMinor: 1_150_00,
    });
    expect(w.verdict).toBe("FOODICS_HIGHER");
    expect(w.vatMinor).toBe(3_000_00);
    expect(w.vatGapMinor).toBe(300_00);
    expect(w.grossGapMinor).toBe(2_300_00);
    expect(w.coveredDays).toBe(2);
    expect(w.expectedDays).toBe(30);
    expect(w.cashTypedGrossMinor).toBe(1_150_00);
  });

  it("الإقرارُ أعلى: الفرقُ سالب ولا يُقلَب", () => {
    const w = buildSalesWitness({ month: "2026-09", today: "2026-10-10", days: [day("2026-09-05", 1_000_00, 150_00)], returnOutputVatMinor: 450_00, cashTypedGrossMinor: null });
    expect(w.verdict).toBe("RETURN_HIGHER");
    expect(w.vatGapMinor).toBe(-300_00);
    expect(w.grossGapMinor).toBe(-2_300_00);
  });

  it("فرقُ هللاتٍ على مئات البيعات يُعدّ اتّفاقاً", () => {
    const w = buildSalesWitness({ month: "2026-09", today: "2026-10-10", days: [day("2026-09-05", 1_000_00, 150_37)], returnOutputVatMinor: 150_00, cashTypedGrossMinor: 0 });
    expect(w.verdict).toBe("AGREES");
    expect(w.cashTypedGrossMinor).toBe(0);
  });

  it("أيّامُ شهرٍ آخر لا تُحسب، والمرتجعُ يُعرض على حدة", () => {
    const w = buildSalesWitness({
      month: "2026-09", today: "2026-10-10",
      days: [day("2026-08-31", 500_00, 75_00), day("2026-09-01", 100_00, 15_00, 20_00), day("2026-10-01", 900_00, 135_00)],
      returnOutputVatMinor: 15_00, cashTypedGrossMinor: null,
    });
    expect(w.salesMinor).toBe(100_00);
    expect(w.refundMinor).toBe(20_00);
    expect(w.coveredDays).toBe(1);
  });

  it("الشهرُ الجاري يُنتظر له حتى أمس، واليومُ نفسُه لا يُعدّ يوماً مغطّى", () => {
    expect(expectedDaysOf("2026-10", "2026-10-10")).toBe(9);
    expect(expectedDaysOf("2026-10", "2026-10-01")).toBe(0);
    expect(expectedDaysOf("2026-11", "2026-10-10")).toBe(0);
    expect(expectedDaysOf("2026-02", "2026-10-10")).toBe(28);
    const w = buildSalesWitness({
      month: "2026-10", today: "2026-10-10",
      days: [day("2026-10-09", 100_00, 15_00), day("2026-10-10", 50_00, 7_50)],
      returnOutputVatMinor: 0, cashTypedGrossMinor: null,
    });
    expect(w.coveredDays).toBe(1);
    expect(w.vatMinor).toBe(22_50);
  });
});
