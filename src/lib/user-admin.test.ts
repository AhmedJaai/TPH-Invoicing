import { describe, expect, it } from "vitest";
import { ROLE_LABEL } from "./permissions";
import { allowlistNote, approxLastSeen, checkUserChange, type AdminUser } from "./user-admin";

const owner: AdminUser = { id: "o1", role: "OWNER", isActive: true, allowlisted: true };
const accountant: AdminUser = { id: "a1", role: "ACCOUNTANT", isActive: true, allowlisted: true };
const buyer: AdminUser = { id: "p1", role: "PURCHASING", isActive: true, allowlisted: true };
const all = [owner, accountant, buyer];

describe("إدارة المستخدمين — المالك لا يحبس نفسه", () => {
  it("لا يغيّر دوره ولا يعطّل نفسه", () => {
    expect(checkUserChange("o1", owner, { kind: "role", role: "ACCOUNTANT" }, all).ok).toBe(false);
    expect(checkUserChange("o1", owner, { kind: "active", active: false }, all).ok).toBe(false);
  });

  it("وينهي جلساته هو — يدخل من جديد بجوجل", () => {
    expect(checkUserChange("o1", owner, { kind: "end-sessions" }, all)).toEqual({ ok: true });
  });

  it("يغيّر دور غيره ويعطّله ويعيده", () => {
    expect(checkUserChange("o1", accountant, { kind: "role", role: "AUDITOR" }, all)).toEqual({ ok: true });
    expect(checkUserChange("o1", buyer, { kind: "active", active: false }, all)).toEqual({ ok: true });
    const off = { ...buyer, isActive: false };
    expect(checkUserChange("o1", off, { kind: "active", active: true }, [owner, accountant, off])).toEqual({ ok: true });
  });

  it("ما لا يغيّر شيئاً يقال ولا يكتب", () => {
    expect(checkUserChange("o1", accountant, { kind: "role", role: "ACCOUNTANT" }, all).ok).toBe(false);
    expect(checkUserChange("o1", buyer, { kind: "active", active: true }, all).ok).toBe(false);
  });

  it("مالك ثان لا ينزل المالك الوحيد الذي يدخل — ولو كان هو نفسه خارج القائمة", () => {
    const second: AdminUser = { id: "o2", role: "OWNER", isActive: true, allowlisted: false };
    const everyone = [owner, second];
    /* o2 جلستُه قائمة لكنّه حُذف من القائمة: إن أنزل o1 لم يبقَ مالكٌ يدخل */
    const verdict = checkUserChange("o2", owner, { kind: "role", role: "ACCOUNTANT" }, everyone);
    expect(verdict.ok).toBe(false);
    expect(checkUserChange("o2", owner, { kind: "active", active: false }, everyone).ok).toBe(false);
  });

  it("وبمالكين يدخلان ينزل أحدهما", () => {
    const second: AdminUser = { id: "o2", role: "OWNER", isActive: true, allowlisted: true };
    expect(checkUserChange("o1", second, { kind: "role", role: "ACCOUNTANT" }, [owner, second])).toEqual({ ok: true });
  });
});

describe("الدور هنا وقائمة الدخول", () => {
  it("اتّفقا: لا ملاحظة", () => {
    expect(allowlistNote("ACCOUNTANT", "ACCOUNTANT", ROLE_LABEL)).toBeNull();
  });
  it("خفّض في القائمة وبقي هنا: يقال أيّهما النافذ", () => {
    const note = allowlistNote("ACCOUNTANT", "PURCHASING", ROLE_LABEL);
    expect(note).toContain("مدير المشتريات");
    expect(note).toContain("المعتمد هو الدور هنا");
  });
  it("خارج القائمة: لا يدخل", () => {
    expect(allowlistNote("ACCOUNTANT", undefined, ROLE_LABEL)).toContain("لا يستطيع الدخول");
  });
});

describe("آخر نشاط تقريباً", () => {
  it("انتهاء الجلسة ناقصاً عمرها، وبلا جلسة غير معروف", () => {
    const expiry = new Date("2026-10-16T09:00:00Z");
    expect(approxLastSeen(expiry, 7 * 24 * 3600)?.toISOString()).toBe("2026-10-09T09:00:00.000Z");
    expect(approxLastSeen(null, 7 * 24 * 3600)).toBeNull();
  });
});
