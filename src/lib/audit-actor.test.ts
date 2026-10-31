import { describe, expect, it } from "vitest";
import { auditActorName, isSystemAudit } from "./audit-actor";
import { BACKGROUND_ACTOR_LABEL, CRON_ACTOR_LABEL, runAsSystemIf, systemActorLabel } from "./actor-context";
import { tagAuditAfter } from "./audit";

const human = { actorId: "u1", actorName: "Ahmed" };

describe("مَن فعل هذا؟", () => {
  it("التشغيلُ المجدول والاستدراكُ الخلفيّ يُقالان «النظام» وإن حملا معرّف المالك", () => {
    for (const label of [CRON_ACTOR_LABEL, BACKGROUND_ACTOR_LABEL]) {
      const after = tagAuditAfter({ الملفّ: "x" }, { "المنفّذ": label });
      expect(isSystemAudit({ ...human, after })).toBe(true);
      expect(auditActorName({ ...human, after }, "u1")).toBe("النظام");
    }
  });

  it("ما سبق الوسمَ يُعرَف بعلاماته الصريحة", () => {
    expect(isSystemAudit({ ...human, after: { auto: true } })).toBe(true);
    expect(isSystemAudit({ ...human, after: { المصدر: "المزامنة" } })).toBe(true);
    expect(isSystemAudit({ ...human, after: { المصدر: "الاستدراك" } })).toBe(true);
    expect(isSystemAudit({ ...human, after: { السبب: "أُرشف دون قيد، فقُيّد آلياً من قراءته المحفوظة" } })).toBe(true);
    expect(isSystemAudit({ ...human, after: { المصدر: "إصلاحٌ بإذن أحمد — نفّذه Claude" } })).toBe(true);
    expect(isSystemAudit({ actorId: null, after: null })).toBe(true);
  });

  it("ما ضغطه إنسانٌ يبقى باسمه — ولا يُنسَب إلى النظام بالظنّ", () => {
    expect(isSystemAudit({ ...human, after: { auto: false } })).toBe(false);
    expect(isSystemAudit({ ...human, after: { المصدر: "الاعتماد" } })).toBe(false);
    expect(isSystemAudit({ ...human, after: { السبب: "أكّد ما قرأه النموذج" } })).toBe(false);
    expect(isSystemAudit({ ...human, after: tagAuditAfter({}, { "وضع التجربة": true }) })).toBe(false);
    expect(isSystemAudit({ ...human, after: ["auto"] })).toBe(false);
    expect(auditActorName({ ...human, after: null }, "u1")).toBe("أنت");
    expect(auditActorName({ ...human, after: null }, "u2")).toBe("Ahmed");
    expect(auditActorName({ ...human, after: null })).toBe("Ahmed");
  });

  it("الخلفيُّ وحده يجري باسم النظام، والضغطُ بيدٍ باسم صاحبه", async () => {
    expect(await runAsSystemIf(true, async () => systemActorLabel())).toBe(BACKGROUND_ACTOR_LABEL);
    expect(await runAsSystemIf(false, async () => systemActorLabel())).toBeNull();
  });
});
