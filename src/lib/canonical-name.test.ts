import { describe, expect, it } from "vitest";
import { canonicalName, type NamedDocument } from "./canonical-name";

const doc = (over: Partial<NamedDocument>): NamedDocument => ({
  driveFileId: "f1",
  fileName: "2026-08-06_KohiRoastary_Invoice_INV1759_SAR833.75.pdf",
  kind: "TAX_INVOICE",
  slug: "KohiRoastary",
  date: "2026-08-06",
  totalMinor: 833_75,
  invoiceNumber: "INV1759",
  ...over,
});

describe("الاسم القياسيّ يُشتقّ من المقيَّد لا من التخمين", () => {
  it("ما هو على الصيغة لا يُمَسّ", () => {
    expect(canonicalName(doc({})).status).toBe("OK");
  });

  it("ما رُفع باليد يُقترَح له الاسم القياسيّ", () => {
    const v = canonicalName(doc({ fileName: "فاتورة ٣.pdf" }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") {
      expect(v.proposed).toBe("2026-08-06_KohiRoastary_Invoice_INV1759_SAR833.75.pdf");
    }
  });

  it("والامتداد يبقى كما هو — تغييرُه يكسر فتح الملفّ", () => {
    const v = canonicalName(doc({ fileName: "IMG_2041.jpg" }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") expect(v.proposed.endsWith(".jpg")).toBe(true);
  });

  it("الكشف صيغتُه غير صيغة الفاتورة", () => {
    const v = canonicalName(doc({
      kind: "STATEMENT", fileName: "كشف.pdf", invoiceNumber: null,
    }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") expect(v.proposed).toContain("_Statement_");
  });

  it("وما نقص منه ما يُميّز لا يُقترَح له اسم", () => {
    /*
      والصمت هنا أصدق من اسمٍ يبدو قياسيّاً ويحمل معلومةً مخترَعة:
      «SAR0.00» يقول إنّ الفاتورة بلا مبلغ، وهي إنّما لم تُقرأ.
    */
    for (const gap of [
      { slug: null }, { date: null }, { totalMinor: null }, { invoiceNumber: null },
    ]) {
      const v = canonicalName(doc({ fileName: "مجهول.pdf", ...gap }));
      expect(v.status).toBe("CANNOT");
    }
  });

  it("ولا يُمَسّ ما لا صيغة قياسية له هنا", () => {
    expect(canonicalName(doc({ kind: "RECEIPT", fileName: "إيصال.pdf" })).status)
      .toBe("CANNOT");
  });

  it("ولا يُنزَع ترقيمُ التكرار — إعادتُه للأصل تُنشئ التصادم الذي تفاداه", () => {
    const v = canonicalName(doc({
      fileName: "2026-08-06_KohiRoastary_Invoice_INV1759_SAR833.75 (2).pdf",
    }));
    expect(v.status).toBe("OK");
  });

  it("والاسمُ الذي يُقرأ لا يُمَسّ ولو خالف المبنيّ — فيه تفصيلٌ كتبه إنسان", () => {
    /*
      «Ganache-AGK» و«Statement_May» اسمان صحيحان يحملان تفصيلاً لا
      نعرفه. وإعادةُ بنائهما تمحو «AGK» و«May» — تصحيحٌ يخسر معلومة.
    */
    expect(canonicalName(doc({
      kind: "STATEMENT", invoiceNumber: null,
      fileName: "2026-05-31_Ganache-AGK_Statement_May_SAR6371.00.pdf",
    })).status).toBe("OK");
  });

  it("المبلغُ ليس امتداداً — ولا يُلحَق بالاسم مرّتين", () => {
    /*
      وقع هذا في الدرايف يوم ١٤ سبتمبر ٢٠٢٦ (سجلّ `DRIVE_FILE_RENAMED`):
      «‏…_SAR638.71» بلا امتداد، فقُرئت «71» امتداداً وأُلحقت باسمٍ
      مبنيٍّ ينتهي بالمبلغ — فخرج الملفّ باسمٍ لا يُفتَح.
    */
    const v = canonicalName(doc({
      fileName: "2026-09-08_CoffeeLabs_Invoice_V405669_SAR638.71",
      slug: "CoffeeLabs", date: "2026-09-08", totalMinor: 638_00,
      invoiceNumber: "V405669", mimeType: "application/pdf",
    }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") {
      expect(v.proposed).toBe("2026-09-08_CoffeeLabs_Invoice_V405669_SAR638.00.pdf");
    }
  });

  it("والاسمُ الذي أُفسد يُقترَح إصلاحُه — لا يُقرأ صحيحاً فيبقى", () => {
    const v = canonicalName(doc({
      fileName: "2026-09-06_AVAL_Invoice_INV-2026-00130_SAR996.19.19",
      slug: "AVAL", date: "2026-09-06", totalMinor: 996_19,
      invoiceNumber: "INV-2026-00130", mimeType: "application/pdf",
    }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") {
      expect(v.proposed).toBe("2026-09-06_AVAL_Invoice_INV-2026-00130_SAR996.19.pdf");
    }
  });

  it("وحين لا يحمل الاسمُ امتداداً يُؤخَذ من نوع المحتوى المقيَّد", () => {
    const v = canonicalName(doc({ fileName: "IMG_2041", mimeType: "image/jpeg" }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") expect(v.proposed.endsWith(".jpg")).toBe(true);
  });

  it("ولا يُبدَّل امتدادٌ حقيقيّ بامتدادِ نوعِ المحتوى — ذاك كسرُ الملفّ", () => {
    const v = canonicalName(doc({
      fileName: "كشف الحساب.xlsx", mimeType: "application/pdf",
    }));
    expect(v.status).toBe("RENAME");
    if (v.status === "RENAME") expect(v.proposed.endsWith(".xlsx")).toBe(true);
  });
});
