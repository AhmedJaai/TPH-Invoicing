import { describe, expect, it } from "vitest";
import { compareFiledQuarters, netDrivers, readFiledQuarter, shareText, type FiledQuarterInput } from "./vat-compare";

const snap = (invoices: number, fees: number, selected: number) => ({
  result: { input: { invoices: { vatMinor: invoices }, bankVat: { vatMinor: fees }, selected: { vatMinor: selected } } },
});
const q2: FiledQuarterInput = {
  periodKey: "2026-Q2", filedOn: "2026-07-20", outputVatMinor: 30_000_00, inputVatMinor: 12_000_00,
  carriedInMinor: 0, netMinor: 18_000_00, snapshot: snap(9_000_00, 1_000_00, 2_000_00),
};
const q3: FiledQuarterInput = {
  periodKey: "2026-Q3", filedOn: "2026-10-20", outputVatMinor: 33_000_00, inputVatMinor: 9_500_00,
  carriedInMinor: 0, netMinor: 23_500_00, snapshot: snap(6_000_00, 1_100_00, 2_400_00),
};

describe("مقارنة الأرباع المقدَّمة", () => {
  it("يقرأ أبوابَ المدخلات من اللقطة ونسبتَها إلى المخرجات", () => {
    const r = readFiledQuarter(q2);
    expect(r).toMatchObject({ fromInvoicesMinor: 9_000_00, fromFeesMinor: 1_000_00, fromSelectedMinor: 2_000_00, inputShareBp: 4_000 });
  });

  it("لقطةٌ لا تُقرأ أبوابُها: غير محفوظة لا صفر، وبلا مخرجات لا نسبة", () => {
    const r = readFiledQuarter({ ...q2, snapshot: { شيء: 1 }, outputVatMinor: 0 });
    expect(r.fromInvoicesMinor).toBeNull();
    expect(r.inputShareBp).toBeNull();
    expect(readFiledQuarter({ ...q2, snapshot: null }).fromSelectedMinor).toBeNull();
    expect(readFiledQuarter({ ...q2, snapshot: snap(1.5, 0, 0) }).fromInvoicesMinor).toBeNull();
  });

  it("ما حرّك الصافي: الأكبرُ أثراً أوّلاً، ومجموعُ الآثار يساوي تغيّرَ الصافي", () => {
    const c = compareFiledQuarters([q3, q2]);
    expect(c.quarters.map((q) => q.periodKey)).toEqual(["2026-Q2", "2026-Q3"]);
    expect(c.latest?.netChangeMinor).toBe(5_500_00);
    expect(c.latest?.drivers).toEqual([
      { label: "ضريبةُ المبيعات", effectMinor: 3_000_00 },
      { label: "خصمُ الفواتير", effectMinor: 3_000_00 },
      { label: "خصمُ ما اخترتَه من الصادر", effectMinor: -400_00 },
    ]);
    const all = netDrivers(readFiledQuarter(q2), readFiledQuarter({ ...q3 }));
    expect(all.reduce((s, d) => s + d.effectMinor, 0) + -100_00).toBe(5_500_00);
  });

  it("أبوابٌ غير محفوظة في إحدى اللقطتين: تُقال المدخلاتُ جملةً", () => {
    const d = netDrivers(readFiledQuarter({ ...q2, snapshot: {} }), readFiledQuarter(q3));
    expect(d.map((x) => x.label)).toEqual(["ضريبةُ المبيعات", "ضريبةُ المدخلات (أبوابُها غير محفوظة في اللقطة)"]);
    expect(d[1].effectMinor).toBe(2_500_00);
  });

  it("الرصيدُ المرحَّل يخفض الصافي", () => {
    const d = netDrivers(readFiledQuarter(q2), readFiledQuarter({ ...q2, periodKey: "2026-Q3", carriedInMinor: 700_00, netMinor: 17_300_00 }));
    expect(d).toEqual([{ label: "رصيدٌ مرحَّل من الربع السابق", effectMinor: -700_00 }]);
  });

  it("ربعٌ واحد: لا مقارنة", () => {
    expect(compareFiledQuarters([q2]).latest).toBeNull();
    expect(compareFiledQuarters([])).toEqual({ quarters: [], latest: null });
  });

  it("النسبةُ تُكتب بخانةٍ عشريّة بلا إشارة", () => {
    expect(shareText(4_000)).toBe("\u206640.0٪\u2069");
    expect(shareText(2_876)).toBe("\u206628.8٪\u2069");
  });
});
