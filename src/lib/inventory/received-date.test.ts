import { describe, expect, it } from "vitest";
import { checkReceivedDate, MAX_DAYS_BEFORE_INVOICE } from "./received-date";

describe("يومُ وصول بضاعة الفاتورة", () => {
  const base = { invoiceDay: "2026-10-26", today: "2026-11-01" };
  it("يوم الجرد الأخير وما بعد الفاتورة مقبول", () => {
    expect(checkReceivedDate({ ...base, receivedOn: "2026-10-24" }).ok).toBe(true);
    expect(checkReceivedDate({ ...base, receivedOn: "2026-10-26" }).ok).toBe(true);
    expect(checkReceivedDate({ ...base, receivedOn: "2026-11-01" }).ok).toBe(true);
  });
  it("بعد اليوم يُرفض: بضاعةٌ لم تصل بعد", () => {
    const v = checkReceivedDate({ ...base, receivedOn: "2026-11-02" });
    expect(v).toEqual({ ok: false, error: expect.stringContaining("بعد اليوم") });
  });
  it("قبل الفاتورة بأكثر من ستّين يوماً يُرفض، وبالستّين يمرّ", () => {
    expect(checkReceivedDate({ ...base, receivedOn: "2026-08-27" }).ok).toBe(true);
    expect(MAX_DAYS_BEFORE_INVOICE).toBe(60);
    expect(checkReceivedDate({ ...base, receivedOn: "2026-08-26" }).ok).toBe(false);
  });
  it("وما ليس تاريخاً يُرفض", () => {
    expect(checkReceivedDate({ ...base, receivedOn: "أمس" }).ok).toBe(false);
    expect(checkReceivedDate({ ...base, receivedOn: "2026-13-40" }).ok).toBe(false);
  });
});
