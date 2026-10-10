import { describe, expect, it } from "vitest";
import { ACTION_LABEL } from "./audit-labels";
import { FIGURE_ACTIONS, describeMover, type AuditRow } from "./figure-history";

const row = (o: Partial<AuditRow>): AuditRow => ({
  action: "PAYMENT_RECORDED", entityType: "payment", entityId: "p1", after: null, actorId: "u1", actorName: "أحمد", ...o,
});

describe("لماذا هذا الرقم؟", () => {
  it("كلُّ فعلٍ في القائمة فعلٌ معروفٌ له اسمٌ عربيّ", () => {
    for (const a of FIGURE_ACTIONS.owed) expect(Object.hasOwn(ACTION_LABEL, a), a).toBe(true);
  });

  it("فعلُك يُقال «أنت»، وفعلُ غيرك باسمه", () => {
    expect(describeMover(row({}), "u1").who).toBe("أنت");
    expect(describeMover(row({}), "u2").who).toBe("أحمد");
  });

  it("الآليُّ يُعرَف من سببه لا من فاعله — الاستدراكُ يكتب باسم من فُتحت الصفحةُ عنده", () => {
    const m = describeMover(row({ action: "DOCUMENT_STATUS_CHANGED", after: { السبب: "اجتمعت فيه شروطُ الأرشفة الآليّة" } }), "u1");
    expect(m.automatic).toBe(true);
    expect(m.who).toBe("النظام");
  });

  it("المبلغُ يُعرَض إن حمله السجلّ، ولا يُخترَع إن لم يحمله", () => {
    expect(describeMover(row({ after: { المبلغ_بالهللات: 115_000 } }), "u1").amountMinor).toBe(115_000);
    expect(describeMover(row({ after: { الملف: "x.pdf" } }), "u1").amountMinor).toBeNull();
    expect(describeMover(row({ after: { المبلغ_بالهللات: "115000" } }), "u1").amountMinor).toBeNull();
  });

  it("الفاتورةُ تُفتَح بملفّها، ووسمُ السداد (المقيَّدُ بالمورّد) بلا رابطٍ مخترَع", () => {
    expect(describeMover(row({ action: "INVOICE_FIELDS_CORRECTED", entityType: "invoice", entityId: "i1" }), "u1").href).toBe("/purchases/invoices/i1");
    expect(describeMover(row({ action: "INVOICES_MARKED_PAID", entityType: "invoice", entityId: "s1", after: { الفواتير: ["A-1", "A-2"] } }), "u1"))
      .toMatchObject({ href: null, detail: "A-1، A-2" });
  });
});
