import { describe, expect, it } from "vitest";
import type { AttentionItem } from "./attention";
import { partitionSnoozed, snoozeKey, snoozeOptions, snoozePrefix, validSnoozeDay } from "./attention-snooze";

const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "overdue", area: "PAYMENTS", severity: "HIGH", title: "متأخّر", detail: "", action: "", href: "/suppliers",
  count: 3, amountMinor: 1_200_00, impact: { kind: "OWED", amountMinor: 1_200_00 }, evidence: [], ...over,
});

describe("تأجيل بند الطابور", () => {
  it("المؤجَّل يخرج من العدّ حتى اليوم السابق ليوم عودته، ويعود في يومه", () => {
    const rows = [{ key: snoozeKey(item()), decision: "SNOOZED:2026-10-15", note: "أنتظر ردَّ المورّد" }];
    const before = partitionSnoozed([item()], rows, "2026-10-14");
    expect(before.active).toEqual([]);
    expect(before.snoozed).toEqual([{ item: item(), until: "2026-10-15", note: "أنتظر ردَّ المورّد" }]);
    expect(partitionSnoozed([item()], rows, "2026-10-15").active).toHaveLength(1);
    expect(partitionSnoozed([item()], rows, "2026-10-20").snoozed).toEqual([]);
  });

  it("إن تغيّر مبلغُ البند أو عددُه عاد قبل يومه — تأجيلُ ما كان لا يُسكت ما استجدّ", () => {
    const rows = [{ key: snoozeKey(item()), decision: "SNOOZED:2026-10-30", note: null }];
    expect(partitionSnoozed([item({ amountMinor: 1_900_00 })], rows, "2026-10-12").active).toHaveLength(1);
    expect(partitionSnoozed([item({ count: 4 })], rows, "2026-10-12").active).toHaveLength(1);
  });

  it("البندُ بلا مبلغ مفتاحُه لا يساوي مبلغاً صفراً", () => {
    expect(snoozeKey(item({ amountMinor: undefined }))).toBe("attn:overdue:-:3");
    expect(snoozeKey(item({ amountMinor: 0 }))).toBe("attn:overdue:0:3");
    expect(snoozeKey(item()).startsWith(snoozePrefix("overdue"))).toBe(true);
  });

  it("قرارٌ لا يُفهم نصُّه لا يُسكت بنداً", () => {
    const rows = [{ key: snoozeKey(item()), decision: "شيءٌ آخر", note: null }];
    expect(partitionSnoozed([item()], rows, "2026-10-12").active).toHaveLength(1);
  });

  it("يومُ التأجيل بعد اليوم وفي حدود شهر", () => {
    expect(validSnoozeDay("2026-10-12", "2026-10-12")).toBe(false);
    expect(validSnoozeDay("2026-10-13", "2026-10-12")).toBe(true);
    expect(validSnoozeDay("2026-11-12", "2026-10-12")).toBe(true);
    expect(validSnoozeDay("2026-11-13", "2026-10-12")).toBe(false);
    expect(validSnoozeDay("غداً", "2026-10-12")).toBe(false);
  });

  it("الاختياراتُ الجاهزة بلا يومٍ مكرَّر", () => {
    expect(snoozeOptions("2026-10-12").map((o) => o.day)).toEqual(["2026-10-13", "2026-10-15", "2026-10-19", "2026-11-01"]);
    /* آخرُ الشهر: «غداً» و«أوّل الشهر القادم» يومٌ واحد */
    expect(snoozeOptions("2026-10-31").map((o) => o.day)).toEqual(["2026-11-01", "2026-11-03", "2026-11-07"]);
  });
});
