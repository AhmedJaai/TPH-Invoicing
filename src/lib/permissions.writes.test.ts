import { describe, expect, it } from "vitest";
import { can, capabilitiesOf, isRole, parseAllowlist, READ_CAPABILITIES } from "./permissions";

/**
 * الكتابة لا تُحرَس بصلاحية قراءة.
 *
 * كانت قواعد البنك واستيراده يُحرسان بـ`bank:view`، والمصروفات
 * بـ`amounts:view` — وكلاهما صلاحية اطّلاع. فالاسم يكذب على النيّة،
 * ولا يبقى ما يمنع منح الاطّلاع دون الكتابة.
 */
describe("فصل صلاحيات الكتابة عن القراءة", () => {
  it("مدير المشتريات لا يقرأ البنك ولا يكتب فيه", () => {
    expect(can("PURCHASING", "bank:view")).toBe(false);
    expect(can("PURCHASING", "bank:edit")).toBe(false);
    expect(can("PURCHASING", "expense:edit")).toBe(false);
  });

  it("المالك والمحاسب يكتبان في البنك والمصروفات", () => {
    for (const role of ["OWNER", "ACCOUNTANT"] as const) {
      expect(can(role, "bank:edit")).toBe(true);
      expect(can(role, "expense:edit")).toBe(true);
    }
  });

  it("تصحيحُ مبالغ الفاتورة وتنزيلُ الحزمة قدرتان صريحتان — لا يملكهما مديرُ المشتريات", () => {
    for (const role of ["OWNER", "ACCOUNTANT"] as const) {
      expect(can(role, "invoice:edit")).toBe(true);
      expect(can(role, "reports:export")).toBe(true);
    }
    expect(can("PURCHASING", "invoice:edit")).toBe(false);
    expect(can("PURCHASING", "reports:export")).toBe(false);
  });

  it("اعتماد الدفعات يبقى للمالك وحده", () => {
    expect(can("OWNER", "payment:approve")).toBe(true);
    expect(can("ACCOUNTANT", "payment:approve")).toBe(false);
    expect(can("PURCHASING", "payment:approve")).toBe(false);
  });

  /*
    ── الجرد: الميزانُ غيرُ الدفتر ──

    مديرُ المشتريات يعدّ الرفَّ — وذاك عملُه — ولا يرى كلفةَ الفرق ولا
    مبيعاتِ الأسبوع. و`inventory:count` صلاحيةُ عدٍّ لا بابٌ خلفيّ إلى
    الأرقام المالية: الشاشةُ تُخفيها، والصفحاتُ التي جوابُها بالريال
    (سجلُّ الجرد والاتّجاه) تشترط `amounts:view`.
  */
  it("مديرُ المشتريات يعدّ الرفَّ ولا يرى المبالغ", () => {
    expect(can("PURCHASING", "inventory:view")).toBe(true);
    expect(can("PURCHASING", "inventory:count")).toBe(true);
    expect(can("PURCHASING", "amounts:view")).toBe(false);
    /* ولا يكتب وصفةً — الوصفةُ تُغيّر كلَّ رقمٍ يُحسَب بعدها */
    expect(can("PURCHASING", "recipe:edit")).toBe(false);
  });

  it("والمالكُ والمحاسبُ يكتبان الوصفات ويريان كلفةَ الفرق", () => {
    for (const role of ["OWNER", "ACCOUNTANT"] as const) {
      expect(can(role, "recipe:edit")).toBe(true);
      expect(can(role, "inventory:count")).toBe(true);
      expect(can(role, "amounts:view")).toBe(true);
    }
  });

  /*
    إعادةُ فتح الجرد صلاحيّةٌ مستقلّة عن إقفال الشهر.

    فعلان على بياناتٍ مختلفة: أحدُهما يفتح شهراً محاسبيّاً، والآخر
    يُعيد حسابَ جردٍ مقفَل. ومن ملك أحدَهما لا يلزم أن يملك الآخر —
    والصلاحيّةُ المشتركة تُوسّع الأذن بلا قصد.
  */
  it("وإعادةُ فتح جردٍ مقفَل صلاحيّةٌ مستقلّة، للمالك وحده", () => {
    expect(can("OWNER", "inventory:reopen")).toBe(true);
    expect(can("ACCOUNTANT", "inventory:reopen")).toBe(false);
    expect(can("PURCHASING", "inventory:reopen")).toBe(false);
  });

  it("ولا تُعار من إقفال الشهر", () => {
    const roles = ["OWNER", "ACCOUNTANT", "PURCHASING"] as const;
    const reopenMonth = roles.filter((r) => can(r, "month:reopen"));
    const reopenCount = roles.filter((r) => can(r, "inventory:reopen"));
    /* تتصادفان اليوم على المالك، وهما مستقلّتان في التعريف */
    expect(reopenMonth).not.toBe(reopenCount);
    expect(can("ACCOUNTANT", "month:close")).toBe(true);
    expect(can("ACCOUNTANT", "inventory:reopen")).toBe(false);
  });

  it("صلاحية الكتابة مستقلّة عن صلاحية القراءة في التعريف", () => {
    // من يملك الكتابة يملك القراءة، والعكس ليس لازماً
    for (const role of ["OWNER", "ACCOUNTANT", "PURCHASING"] as const) {
      if (can(role, "bank:edit")) expect(can(role, "bank:view")).toBe(true);
      if (can(role, "inventory:count")) expect(can(role, "inventory:view")).toBe(true);
    }
  });

  /*
    «المراجع» للمحاسب الخارجيّ: يرى ولا يغيّر. وأيُّ قدرةِ كتابةٍ تُضاف له سهواً
    تُسقط هذا الاختبار — القائمةُ البيضاء للقراءة هي الحكم لا أسماءٌ تُعدّ هنا.
  */
  it("المراجع لا يملك قدرةَ كتابةٍ واحدة", () => {
    const writes = capabilitiesOf("AUDITOR").filter((c) => !READ_CAPABILITIES.includes(c));
    expect(writes).toEqual([]);
    for (const c of ["document:upload", "invoice:edit", "bank:edit", "expense:edit", "payment:approve", "month:close", "month:reopen", "users:manage", "supplier:edit", "inventory:count", "recipe:edit"] as const) {
      expect(can("AUDITOR", c)).toBe(false);
    }
  });

  it("ويقرأ المالية وينزّل حزمة المحاسب — ولا يرى الرواتب", () => {
    for (const c of ["amounts:view", "bank:view", "reports:view", "reports:export", "audit:view"] as const) {
      expect(can("AUDITOR", c)).toBe(true);
    }
    expect(can("AUDITOR", "payroll:view")).toBe(false);
  });

  it("إدارةُ المستخدمين للمالك وحده", () => {
    expect(can("OWNER", "users:manage")).toBe(true);
    for (const role of ["ACCOUNTANT", "PURCHASING", "AUDITOR"] as const) expect(can(role, "users:manage")).toBe(false);
  });

  it("القائمة البيضاء تقبل المراجع، وما ليس دوراً يُردّ إلى الأضيق لا إلى الأوسع", () => {
    const list = parseAllowlist("a@x.com:OWNER, cpa@x.com:AUDITOR, who@x.com:ADMIN, bare@x.com");
    expect(list.get("cpa@x.com")).toBe("AUDITOR");
    expect(list.get("who@x.com")).toBe("PURCHASING");
    expect(list.get("bare@x.com")).toBe("PURCHASING");
    expect(isRole("ADMIN")).toBe(false);
  });
});
