import { describe, expect, it } from "vitest";
import { addDays } from "./riyadh-time";
import { DISMISSED, isSilenced, signalPrefix, silencedKeys, snoozeDay, snoozedUntil } from "./signal-decisions";

describe("signal-decisions", () => {
  it("المفتاحُ يُقبل ببادئته المعروفة وحدها", () => {
    expect(signalPrefix("pos-missing:2026-07-20")).toBe("pos-missing");
    expect(signalPrefix("recurring-rose:NAME:شركة:2026-08-07")).toBe("recurring-rose");
    expect(signalPrefix("double-paid:abc")).toBeNull();
    expect(signalPrefix("pos-missing")).toBeNull();
    expect(signalPrefix("pos-missing: 2026")).toBeNull();
  });

  it("المُسكَتُ صامتٌ دائماً، والمؤجَّلُ حتى يومه داخلاً ثمّ يعود", () => {
    expect(isSilenced(DISMISSED, "2030-01-01")).toBe(true);
    const snooze = snoozedUntil("2026-08-10");
    expect(snoozeDay(snooze)).toBe("2026-08-10");
    expect(isSilenced(snooze, "2026-08-09")).toBe(true);
    expect(isSilenced(snooze, "2026-08-10")).toBe(true);
    expect(isSilenced(snooze, "2026-08-11")).toBe(false);
  });

  it("قرارٌ لا يُفهم لا يُسكت شيئاً", () => {
    expect(isSilenced("CLAIMED", "2026-08-10")).toBe(false);
    expect(isSilenced("SNOOZED:قريباً", "2026-08-10")).toBe(false);
    expect(isSilenced(null, "2026-08-10")).toBe(false);
  });

  it("المفاتيحُ الصامتة تُجمع من الصفوف بتاريخ اليوم", () => {
    const keys = silencedKeys(
      [
        { key: "a:1", decision: DISMISSED },
        { key: "a:2", decision: snoozedUntil("2026-08-01") },
        { key: "a:3", decision: snoozedUntil("2026-09-01") },
      ],
      "2026-08-15",
    );
    expect([...keys].sort()).toEqual(["a:1", "a:3"]);
  });

  it("addDays يعبر الشهر والسنة", () => {
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });
});
