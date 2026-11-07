import { describe, expect, it } from "vitest";
import { asTeamTab, TEAM_APP_NAME, teamAppPath, teamInvite, teamTabsFor } from "./team-app";

describe("TPH Team", () => {
  it("اسمُ التطبيق على الشاشة", () => {
    expect(TEAM_APP_NAME).toBe("TPH Team");
  });
  it("المسارُ من الرمز — هو بدايةُ التطبيق المثبَّت ونطاقُه", () => {
    expect(teamAppPath("abc_DEF-123")).toBe("/a/abc_DEF-123");
  });
  it("صفحةٌ غير معروفة تعود إلى الحضور", () => {
    expect(asTeamTab("invoices")).toBe("invoices");
    expect(asTeamTab("message")).toBe("requests");
    expect(asTeamTab("board")).toBe("board");
    expect(asTeamTab("payroll")).toBe("attend");
    expect(asTeamTab(undefined)).toBe("attend");
    /* «الجرد» لا يُفتح بالعنوان لمن لا إذنَ له */
    expect(asTeamTab("count")).toBe("attend");
    expect(asTeamTab("count", true)).toBe("count");
  });
  it("رسالةُ الدعوة تحمل الرابط وطريقةَ التثبيت ولا تطلب دخولاً", () => {
    const text = teamInvite("أنس", "https://x.test/a/tok");
    expect(text).toContain("https://x.test/a/tok");
    expect(text).toContain("إضافة إلى الشاشة الرئيسية");
    expect(text).toContain("لا يحتاج تسجيل دخول");
  });
});

describe("teamTabsFor", () => {
  it("«الجرد» لمن أذن له المالك وحده", () => {
    expect(teamTabsFor(false).map((t) => t.id)).not.toContain("count");
    expect(teamTabsFor(true).map((t) => t.id)).toContain("count");
  });
});
