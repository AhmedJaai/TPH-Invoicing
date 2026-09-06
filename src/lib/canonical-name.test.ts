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
});
