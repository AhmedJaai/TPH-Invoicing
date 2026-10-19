import { describe, expect, it } from "vitest";
import { adoptionInClosedMonth } from "./statement-adoption";

const base = { month: "2026-06", invoiceNumber: "CIV-1", recordedTotalMinor: 455_40 };

describe("ملفُّ فاتورةٍ من الكشف يصل وشهرُها مقفل", () => {
  it("بالإجماليّ نفسه يُربط الملفّ وحده — لا رقمَ يتغيّر", () => {
    expect(adoptionInClosedMonth({ ...base, fileTotalMinor: 455_40 })).toEqual({ ok: true });
  });
  it("وفرقُ ريالٍ تقريبٌ يُتسامح فيه", () => {
    expect(adoptionInClosedMonth({ ...base, fileTotalMinor: 456_40 }).ok).toBe(true);
  });
  it("وما خالفه يُقال بالمبلغين ولا يُبتلَع", () => {
    const r = adoptionInClosedMonth({ ...base, fileTotalMinor: 500_00 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("455.40");
  });
  it("وإجماليٌّ لم يُقرأ لا يُدّعى به خلاف", () => {
    expect(adoptionInClosedMonth({ ...base, fileTotalMinor: null }).ok).toBe(true);
  });
});
