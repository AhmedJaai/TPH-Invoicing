import { describe, expect, it } from "vitest";
import { ACTION_LABEL } from "./audit-labels";
import { FIGURE_ACTIONS, describeMover, isFigureId, isRecordId, type AuditRow } from "./figure-history";

const row = (o: Partial<AuditRow>): AuditRow => ({
  action: "PAYMENT_RECORDED", entityType: "payment", entityId: "p1", after: null, actorId: "u1", actorName: "أحمد", ...o,
});

describe("لماذا هذا الرقم؟", () => {
  it("كلّ فعل في القائمة فعل معروف له اسم عربيّ", () => {
    for (const list of Object.values(FIGURE_ACTIONS)) {
      for (const a of list) expect(Object.hasOwn(ACTION_LABEL, a), a).toBe(true);
      expect(new Set(list).size, "فعل مكرّر").toBe(list.length);
    }
  });

  it("الأرقام المعروفة ثلاثة، وما عداها يردّ — و«__proto__» ليس رقماً", () => {
    expect(isFigureId("owed") && isFigureId("vat") && isFigureId("payrun")).toBe(true);
    expect(isFigureId("__proto__")).toBe(false);
    expect(isFigureId("toString")).toBe(false);
    expect(isFigureId(null)).toBe(false);
  });

  it("اختيار حركة في الإقرار يحرّك رقم الضريبة لا «عليك»", () => {
    expect(FIGURE_ACTIONS.vat).toContain("VAT_TX_CHOSEN");
    expect(FIGURE_ACTIONS.owed).not.toContain("VAT_TX_CHOSEN");
    expect(FIGURE_ACTIONS.payrun).toContain("PAYMENT_HOLD_OVERRIDDEN");
  });

  it("فعلك يقال «أنت»، وفعل غيرك باسمه", () => {
    expect(describeMover(row({}), "u1").who).toBe("أنت");
    expect(describeMover(row({}), "u2").who).toBe("أحمد");
  });

  it("الآليّ يعرف من سببه لا من فاعله — الاستدراك يكتب باسم من فتحت الصفحة عنده", () => {
    const m = describeMover(row({ action: "DOCUMENT_STATUS_CHANGED", after: { السبب: "اجتمعت فيه شروط الأرشفة الآليّة" } }), "u1");
    expect(m.automatic).toBe(true);
    expect(m.who).toBe("النظام");
  });

  it("المبلغ يعرض إن حمله السجلّ، ولا يخترع إن لم يحمله", () => {
    expect(describeMover(row({ after: { المبلغ_بالهللات: 115_000 } }), "u1").amountMinor).toBe(115_000);
    expect(describeMover(row({ after: { الملف: "x.pdf" } }), "u1").amountMinor).toBeNull();
    expect(describeMover(row({ after: { المبلغ_بالهللات: "115000" } }), "u1").amountMinor).toBeNull();
  });

  it("الفاتورة تفتح بملفّها، ووسم السداد (المقيّد بالمورّد) بلا رابط مخترع", () => {
    expect(describeMover(row({ action: "INVOICE_FIELDS_CORRECTED", entityType: "invoice", entityId: "e72fefcd-0feb-4de5-b05c-4b7ecbb1dd16" }), "u1").href).toBe("/purchases/invoices/e72fefcd-0feb-4de5-b05c-4b7ecbb1dd16");
    expect(describeMover(row({ action: "VAT_INVOICE_CHOSEN", entityType: "invoice", entityId: "14 فاتورة" }), "u1").href).toBeNull();
    expect(describeMover(row({ action: "INVOICES_MARKED_PAID", entityType: "invoice", entityId: "s1", after: { الفواتير: ["A-1", "A-2"] } }), "u1"))
      .toMatchObject({ href: null, detail: "A-1، A-2" });
  });
});

describe("isRecordId", () => {
  it("المعرّفُ وحده رابط، والقيدُ الجماعيّ نصّ", () => {
    expect(isRecordId("fed72843-fb77-44f9-90a7-f1f99c1c0233")).toBe(true);
    for (const v of ["14 فاتورة", "11 حركة", "manual", "bulk:0", "repair-months:6"]) expect(isRecordId(v)).toBe(false);
  });
});
