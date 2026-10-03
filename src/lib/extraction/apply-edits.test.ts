import { describe, expect, it } from "vitest";
import { applyEdits } from "./apply-edits";
import { runPipeline } from "./pipeline";
import type { ExtractionResult } from "./schema";

const statement = {
  documentKind: "STATEMENT", supplierNameAr: "أوراق الزيتون", supplierNameEn: "", sellerVatNumber: "", buyerVatNumber: "",
  invoiceNumber: "", invoiceDate: "", subtotalAmount: "", vatAmount: "", totalAmount: "", discountAmount: "", chargesAmount: "",
  beneficiaryName: "", lines: [], statementLines: [], openingBalance: "", closingBalance: "",
  confidence: { documentKind: 0.9, supplierName: 0.9, invoiceNumber: 0, invoiceDate: 0.2, amounts: 0.2, vatNumbers: 0.2 },
  notes: "",
} as unknown as ExtractionResult;

const supplier = { id: "s1", slug: "OliveLeaves", nameAr: "أوراق الزيتون", driveFolderName: "Olive Leaves", issuesInvoices: true, contractOnFile: false, aliases: [] };
const judge = (x: ExtractionResult) => runPipeline({ extraction: x, match: { supplier, method: "NAME", confidence: 1, candidates: [] }, companyVat: "310007971600003", originalFileName: "كشف حساب.pdf" });

describe("الحكمُ بعد تعديل الإنسان", () => {
  it("كشفٌ لم يُقرأ تاريخُه يُقفل — ويُفتح حين يُكتب تاريخُه بيد", () => {
    const before = judge(statement);
    expect(before.canArchive).toBe(false);
    expect(before.findings.some((f) => f.severity === "BLOCKER" && f.message.includes("تاريخ"))).toBe(true);

    const after = judge(applyEdits(statement, { invoiceDate: "2026-09-30" }));
    expect(after.canArchive).toBe(true);
    expect(after.periodMonth).toBe("2026-09");
    expect(after.proposedFileName).toBe("2026-09-30_OliveLeaves_Statement.pdf");
  });

  it("وما كُتب «30/09/2026» يُوحَّد، والمبلغُ بفواصله يُقرأ، وثقتُه كاملة", () => {
    const x = applyEdits(statement, { invoiceDate: "30/09/2026", total: "2,490.00" });
    expect(x.invoiceDate).toBe("2026-09-30");
    expect(x.totalAmount).toBe("2490.00");
    expect(x.confidence.invoiceDate).toBe(1);
    expect(x.confidence.amounts).toBe(1);
    expect(judge(x).proposedFileName).toBe("2026-09-30_OliveLeaves_Statement_SAR2490.00.pdf");
  });

  it("وما لم يتغيّر لا تُرفع ثقتُه", () => {
    expect(applyEdits(statement, { invoiceNumber: "", total: "" }).confidence.amounts).toBe(0.2);
  });
});

describe("الكشفُ لا يُطلب له تاريخٌ ولا إجماليّ", () => {
  it("تاريخُه آخرُ أيّام أسطره، ومبلغُ اسمه رصيدُه الختاميّ — فيُؤرشَف بلا تعديل", () => {
    const read = {
      ...statement,
      closingBalance: "2,490.00",
      statementLines: [
        { date: "2026-08-01", ref: "260266", description: "فاتورة", debit: "410.00", credit: "", balance: "" },
        { date: "2026-09-26", ref: "260400", description: "فاتورة", debit: "140.00", credit: "", balance: "" },
        { date: "", ref: "", description: "الإجمالي", debit: "", credit: "", balance: "" },
      ],
    } as unknown as ExtractionResult;
    const r = judge(read);
    expect(r.invoiceDate).toBe("2026-09-26");
    expect(r.periodMonth).toBe("2026-09");
    expect(r.proposedFileName).toBe("2026-09-26_OliveLeaves_Statement_SAR2490.00.pdf");
    expect(r.canArchive).toBe(true);
  });
});
