import { describe, expect, it } from "vitest";
import { runReconciliation } from "./reconcile.service";
import type { OpenInvoice } from "@/lib/bank/candidates";
import type { SupplierIdentity } from "@/lib/bank/entities";
import { buildMemory } from "@/lib/bank/classification";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

const suppliers: SupplierIdentity[] = [
  { supplierId: "S1", nameAr: "أوراق الزيتون", slug: "OliveLeaves", aliases: [] },
  { supplierId: "S2", nameAr: "لافا كمبوتشا", slug: "Lava", aliases: ["أنس غالب خاشقجي"] },
];

const invoice = (over: Partial<OpenInvoice> & { id: string }): OpenInvoice => ({
  supplierId: "S1",
  invoiceNumber: null,
  invoiceDate: day("2026-08-10"),
  periodMonth: "2026-08",
  totalMinor: 1_000_00,
  outstandingMinor: 1_000_00,
  ...over,
});

const row = (over: Partial<Parameters<typeof runReconciliation>[0]["rows"][number]> & { key: string }) => ({
  valueDate: day("2026-08-11"),
  amountMinor: 1_000_00,
  direction: "DEBIT" as const,
  ...over,
});

describe("runReconciliation", () => {
  it("تسوية الشبكة لا تدخل مطابقة الفواتير أصلاً", () => {
    const { results, summary } = runReconciliation({
      rows: [row({ key: "t1", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 125207" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(results[0].kind).toBe("POS_SETTLEMENT");
    expect(results[0].outcome).toBe("NOT_A_PAYMENT");
    expect(results[0].candidate).toBeNull();
    expect(summary.notPayment).toBe(1);
  });

  it("مورّد معروف ومبلغ مطابق يُطابَق تلقائياً", () => {
    const { results, summary } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", description: "شراء بضاعة" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(results[0].decision?.disposition).toBe("AUTO");
    expect(results[0].candidate?.invoiceIds).toEqual(["i1"]);
    expect(summary.auto).toBe(1);
  });

  it("الاسم البديل يُعرِّف مورّداً لا يشبه اسمه", () => {
    const { results } = runReconciliation({
      rows: [row({ key: "t1", description: "شركة أنس غالب خاشقجي التجارية" })],
      invoices: [invoice({ id: "i1", supplierId: "S2" })],
      suppliers,
    });
    expect(results[0].supplierId).toBe("S2");
    expect(results[0].supplierEvidence.join(" ")).toContain("الاسم البديل");
  });

  it("مورّد معروف بلا فاتورة مفتوحة يُسمّى بذلك لا «مجهول»", () => {
    const { results } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [],
      suppliers,
    });
    expect(results[0].outcome).toBe("KNOWN_SUPPLIER_NO_INVOICE");
  });

  it("مستفيد مجهول يُسمّى مجهولاً — وهو حالٌ مختلف", () => {
    const { results } = runReconciliation({
      rows: [row({ key: "t1", description: "تحويل الى جهة" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(results[0].outcome).toBe("UNKNOWN_ENTITY");
  });

  it("حركتان تتنافسان على فاتورة: الأقوى تأخذها ولا تُخصَّص مرّتين", () => {
    const { results } = runReconciliation({
      rows: [
        row({ key: "weak", beneficiaryRaw: "أوراق الزيتون", valueDate: day("2026-09-20") }),
        row({ key: "strong", beneficiaryRaw: "أوراق الزيتون", valueDate: day("2026-08-10") }),
      ],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    const taken = results.filter((r) => r.candidate !== null);
    expect(taken).toHaveLength(1);
    expect(taken[0].key).toBe("strong");
  });

  it("الذاكرة تُقدَّم على الكلمات في التصنيف", () => {
    const memory = buildMemory([
      { key: "NAME:أوراق الزيتون", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: day("2026-01-01") },
    ]);
    const { results } = runReconciliation({
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون", description: "BV:رواتب شهرية" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
      memory,
    });
    expect(results[0].kind).toBe("SUPPLIER_PAYMENT");
    expect(results[0].classificationReason).toContain("أكّدتَ");
  });

  it("لكل نتيجة سببُ تصنيفها مكتوباً", () => {
    const { results } = runReconciliation({
      rows: [
        row({ key: "a", description: "EJAR رقم السداد20904553589" }),
        row({ key: "b", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 1" }),
      ],
      invoices: [],
      suppliers,
    });
    for (const r of results) expect(r.classificationReason.length).toBeGreaterThan(0);
  });

  it("الملخّص يعدّ ما يحتاج المستخدم لا ما في الملف", () => {
    const { summary } = runReconciliation({
      rows: [
        row({ key: "pos", direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 1" }),
        row({ key: "rent", description: "EJAR رقم السداد20904553589" }),
        row({ key: "match", beneficiaryRaw: "أوراق الزيتون" }),
        row({ key: "mystery", description: "تحويل" }),
      ],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    });
    expect(summary.total).toBe(4);
    expect(summary.notPayment).toBe(2);
    expect(summary.auto).toBe(1);
    expect(summary.review).toBe(1);
  });

  it("النتيجة واحدة لنفس المدخل", () => {
    const input = {
      rows: [row({ key: "t1", beneficiaryRaw: "أوراق الزيتون" })],
      invoices: [invoice({ id: "i1" })],
      suppliers,
    };
    expect(runReconciliation(input)).toEqual(runReconciliation(input));
  });
});
