import { describe, expect, it } from "vitest";
import { FINDING_KINDS } from "./ai/finding-labels";
import { CATEGORY_LABEL } from "./bank/rules";
import { VALUE_LABEL, auditEntries, labelValue } from "./audit-labels";

describe("تسميات سجلّ التدقيق", () => {
  it("لكلّ نوع اقتراح تسمية", () => {
    for (const kind of FINDING_KINDS) {
      expect(VALUE_LABEL[kind], kind).toBeTruthy();
      expect(VALUE_LABEL[kind]).not.toBe(kind);
    }
  });

  it("لكلّ باب حركة تسمية", () => {
    for (const category of Object.keys(CATEGORY_LABEL)) {
      expect(VALUE_LABEL[category], category).toBeTruthy();
      expect(VALUE_LABEL[category]).not.toBe(category);
    }
  });

  it("ولا تسمية إنجليزيّة واحدة", () => {
    for (const [key, label] of Object.entries(VALUE_LABEL)) {
      expect(/[A-Za-z]/.test(label) && label === key, key).toBe(false);
    }
  });

  it("وما لا تسمية له يبقى كما هو — السجلّ لا يخفي شيئاً وقع", () => {
    expect(labelValue("MISSING_INVOICES")).toBe("المدفوع أكثر من فواتيره");
    expect(labelValue("BANK_FEE")).toBe("رسوم بنكية");
    expect(labelValue("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(labelValue(42)).toBe("42");
  });
});

describe("auditEntries — تفاصيلُ القرار مقروءة", () => {
  it("الهللاتُ تُعرض ريالاتٍ، والمفتاحُ الذي يذكر الهللة يُعرض بلا ذكرها", () => {
    const e = auditEntries({ "خصّص": 432630, "بقي غير مخصّص": 0, "عليك قبل (هللة)": 150, amountMinor: -2500 });
    expect(e.map((x) => [x.label, x.text])).toEqual([
      ["خصّص", "4,326.30 ريال"], ["بقي غير مخصّص", "0.00 ريال"], ["عليك قبل", "1.50 ريال"], ["المبلغ", "-25.00 ريال"],
    ]);
  });
  it("العددُ الذي ليس مالاً يبقى كما هو، والمفتاحُ الإنجليزيّ يُسمّى", () => {
    expect(auditEntries({ shiftMinutes: 480, daysOff: [5, 6], auto: true })).toEqual([
      { key: "shiftMinutes", label: "مدّة الدوام (دقيقة)", text: "480" },
      { key: "daysOff", label: "أيّام الراحة", text: "5، 6" },
      { key: "auto", label: "آلياً", text: "نعم" },
    ]);
  });
  it("المعرّفاتُ الداخليّة لا تُعرض", () => {
    expect(auditEntries({ invoiceId: "x", driveFileId: "y", supplier_id: "z", id: "w", note: "ن" }).map((x) => x.key)).toEqual(["note"]);
  });
  it("في التعديل يُعرض ما تغيّر وحده، وإن لم يتغيّر شيءٌ عُرض كلُّه", () => {
    const before = { shiftStart: "17:00", shiftMinutes: 480, lateGraceMinutes: 0 };
    const after = { shiftStart: "17:00", shiftMinutes: 541, lateGraceMinutes: 0 };
    expect(auditEntries(after, before).map((x) => x.key)).toEqual(["shiftMinutes"]);
    expect(auditEntries(before, before).map((x) => x.key)).toEqual(["shiftStart", "shiftMinutes", "lateGraceMinutes"]);
  });
  it("ما ليس كائناً لا تفاصيلَ له", () => {
    expect(auditEntries(null)).toEqual([]);
    expect(auditEntries([1, 2])).toEqual([]);
  });
});
