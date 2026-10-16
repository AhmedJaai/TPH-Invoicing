import { describe, expect, it } from "vitest";
import {
  detectRecurring, nextDueOn, noteKey, registeredFor, suggestionKey, type DebitTx,
} from "./recurring-detect";

let seq = 0;
function tx(day: string, amountMinor: number, over: Partial<DebitTx> = {}): DebitTx {
  return { id: `t${seq++}`, day, amountMinor, category: "UTILITY", description: "سداد فاتورة", beneficiaryRaw: "شركة الإنترنت", ...over };
}

describe("detectRecurring", () => {
  it("جهة واحدة بمبلغ متقارب كلّ شهر سلسلة بيومها وعادتها", () => {
    const [s] = detectRecurring(
      [tx("2026-05-07", 460_00), tx("2026-06-07", 460_00), tx("2026-07-08", 462_00), tx("2026-08-07", 460_00)],
      "2026-08-20",
    );
    expect(s.label).toBe("شركة الإنترنت");
    expect(s.usualMinor).toBe(460_00);
    expect(s.dayOfMonth).toBe(7);
    expect(s.months).toBe(4);
    expect(s.annualMinor).toBe(460_00 * 12);
    expect(s.notes).toEqual([]);
  });

  it("شهران لا يكفيان، ولا تحويلات بلا إيقاع", () => {
    expect(detectRecurring([tx("2026-06-07", 460_00), tx("2026-07-07", 460_00)], "2026-08-20")).toEqual([]);
    /* ثلاثةٌ في شهرٍ واحد ثمّ لا شيء — ليست شهريّة */
    expect(detectRecurring([tx("2026-06-07", 460_00), tx("2026-06-17", 460_00), tx("2026-06-27", 460_00)], "2026-08-20")).toEqual([]);
  });

  it("سداد المورّد وسحب المالك والرسوم ليست اشتراكات", () => {
    const monthly = (category: DebitTx["category"]) =>
      ["2026-05-07", "2026-06-07", "2026-07-07"].map((d) => tx(d, 900_00, { category, beneficiaryRaw: `جهة ${category}` }));
    expect(detectRecurring([...monthly("SUPPLIER"), ...monthly("PERSONAL"), ...monthly("BANK_FEE"), ...monthly("UNKNOWN")], "2026-08-20")).toEqual([]);
  });

  it("ما دون الحدّ لا يقترح", () => {
    expect(detectRecurring(["2026-05-07", "2026-06-07", "2026-07-07"].map((d) => tx(d, 5_00)), "2026-08-20")).toEqual([]);
  });

  it("عدّادان عند جهة واحدة سلسلتان — رقم السداد يفصل", () => {
    const a = ["2026-05-10", "2026-06-10", "2026-07-10"].map((d) => tx(d, 800_00, { beneficiaryRaw: null, description: "سداد كهرباء رقم السداد 1234567890" }));
    const b = ["2026-05-12", "2026-06-12", "2026-07-12"].map((d) => tx(d, 300_00, { beneficiaryRaw: null, description: "سداد كهرباء رقم السداد 9999999999" }));
    const out = detectRecurring([...a, ...b], "2026-07-20");
    expect(out.map((s) => s.usualMinor)).toEqual([800_00, 300_00]);
    expect(new Set(out.map((s) => s.key)).size).toBe(2);
  });

  it("ارتفع: آخر خصم فوق عادته بأكثر من ١٠٪ يقال بفرقه", () => {
    const [s] = detectRecurring(
      [tx("2026-05-07", 460_00), tx("2026-06-07", 460_00), tx("2026-07-07", 460_00), tx("2026-08-07", 520_00)],
      "2026-08-20",
    );
    expect(s.usualMinor).toBe(460_00);
    expect(s.lastMinor).toBe(520_00);
    expect(s.notes).toEqual([{ kind: "ROSE", day: "2026-08-07", fromMinor: 460_00, toMinor: 520_00, diffMinor: 60_00 }]);
  });

  it("على الحدّ تماماً (١٠٪) ليس ارتفاعاً", () => {
    const [s] = detectRecurring(
      [tx("2026-05-07", 1000_00), tx("2026-06-07", 1000_00), tx("2026-07-07", 1000_00), tx("2026-08-07", 1100_00)],
      "2026-08-20",
    );
    expect(s.notes).toEqual([]);
  });

  it("دفع بأضعاف العادة ليس «ارتفاع سعر»", () => {
    const [s] = detectRecurring(
      [tx("2026-05-07", 460_00), tx("2026-06-07", 460_00), tx("2026-07-07", 460_00), tx("2026-08-07", 4600_00)],
      "2026-08-20",
    );
    expect(s.notes.filter((n) => n.kind === "ROSE")).toEqual([]);
  });

  it("مرّتين: خصمان في شهر واحد والمعتاد مرّة — والزائد ما بعد الأوّل", () => {
    const rows = [tx("2026-05-07", 460_00), tx("2026-06-07", 460_00), tx("2026-07-07", 460_00), tx("2026-08-07", 460_00), tx("2026-08-09", 460_00)];
    const [s] = detectRecurring(rows, "2026-08-20");
    const twice = s.notes.find((n) => n.kind === "TWICE");
    expect(twice).toMatchObject({ kind: "TWICE", month: "2026-08", excessMinor: 460_00 });
  });

  it("من يدفع له مرّتين كلّ شهر عادةً لا ينبّه عليه", () => {
    const rows = ["2026-05", "2026-06", "2026-07", "2026-08"].flatMap((m) => [tx(`${m}-01`, 460_00), tx(`${m}-15`, 460_00)]);
    const out = detectRecurring(rows, "2026-08-20");
    expect(out.flatMap((s) => s.notes.filter((n) => n.kind === "TWICE"))).toEqual([]);
  });

  it("غاب: يقال لشهر انقضى في الكشف وحده", () => {
    const rows = [tx("2026-05-07", 460_00), tx("2026-06-07", 460_00), tx("2026-07-07", 460_00)];
    expect(detectRecurring(rows, "2026-08-20")[0].notes).toEqual([]);
    expect(detectRecurring(rows, "2026-09-03")[0].notes).toEqual([{ kind: "MISSING", month: "2026-08" }]);
    expect(detectRecurring(rows, null)[0].notes).toEqual([]);
  });

  it("المفاتيح تشتقّ من الجهة والحدث — فيعود السؤال إن تغيّر", () => {
    const [s] = detectRecurring(
      [tx("2026-05-07", 460_00), tx("2026-06-07", 460_00), tx("2026-07-07", 460_00), tx("2026-08-07", 520_00)],
      "2026-08-20",
    );
    expect(suggestionKey(s)).toBe(`recurring-suggest:${s.key}`);
    expect(noteKey(s, s.notes[0])).toBe(`recurring-rose:${s.key}:2026-08-07`);
  });
});

describe("registeredFor · nextDueOn", () => {
  it("المسجّل يقابل بالباب والمبلغ في حدود ١٠٪", () => {
    const series = { category: "UTILITY" as const, usualMinor: 460_00 };
    expect(registeredFor(series, [{ id: "r1", label: "إنترنت", category: "UTILITY", monthlyMinor: 450_00 }])?.id).toBe("r1");
    expect(registeredFor(series, [{ id: "r1", label: "إيجار", category: "RENT", monthlyMinor: 460_00 }])).toBeNull();
    expect(registeredFor(series, [{ id: "r1", label: "إنترنت", category: "UTILITY", monthlyMinor: 900_00 }])).toBeNull();
  });

  it("أوّل استحقاق قادم بيوم السلسلة، ويوم ٣١ يقع آخر الشهر الأقصر", () => {
    expect(nextDueOn({ lastDay: "2026-08-07", dayOfMonth: 7 })).toBe("2026-09-07");
    expect(nextDueOn({ lastDay: "2026-01-31", dayOfMonth: 31 })).toBe("2026-02-28");
    expect(nextDueOn({ lastDay: "2026-12-15", dayOfMonth: 15 })).toBe("2027-01-15");
  });
});
