import { describe, expect, it } from "vitest";
import {
  activeSalesConnector, NotConnectedError, notConnected, salesAvailable,
} from "./connector";

describe("موصل المبيعات", () => {
  it("الحال الافتراضي غير موصول", async () => {
    expect((await notConnected.status()).connected).toBe(false);
    expect(await salesAvailable()).toBe(false);
  });

  it("يرمي عند الطلب ولا يُرجع أصفاراً", async () => {
    // الصفر يوحي بأنّ المقهى لم يبع شيئاً — والرمي يجعل المستدعي يُعلن الحقيقة
    await expect(notConnected.fetchDays("2026-08-01", "2026-08-31")).rejects.toThrow(NotConnectedError);
    await expect(notConnected.fetchTransactions("2026-08-01", "2026-08-31")).rejects.toThrow(NotConnectedError);
    await expect(notConnected.fetchProducts()).rejects.toThrow(NotConnectedError);
  });

  it("سبب عدم الوصل معلَن لا مسكوت عنه", async () => {
    const s = await notConnected.status();
    expect(s.connected).toBe(false);
    if (!s.connected) expect(s.reason).toBeTruthy();
  });

  it("الموصل غير المعروف يرجع «غير موصول» لا يكسر", () => {
    const before = process.env.SALES_CONNECTOR;
    process.env.SALES_CONNECTOR = "لا-يوجد";
    expect(activeSalesConnector().name).toBe("غير موصول");
    process.env.SALES_CONNECTOR = before;
  });

  it("بلا متغيّر بيئة يبقى غير موصول", () => {
    const before = process.env.SALES_CONNECTOR;
    delete process.env.SALES_CONNECTOR;
    expect(activeSalesConnector().name).toBe("غير موصول");
    if (before !== undefined) process.env.SALES_CONNECTOR = before;
  });
});
