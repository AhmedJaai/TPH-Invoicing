import { describe, expect, it } from "vitest";
import {
  findDuplicatePayments, findInvoiceCombination, findSupplierInText,
  isInternalNoise, matchBankTransactions,
  type BankTx, type OpenInvoice, type SupplierAliasIndex,
} from "./match";
import { normalizeName } from "@/lib/suppliers-seed";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const tx = (o: Partial<BankTx> & { id: string }): BankTx => ({
  valueDate: d("2026-09-02"), description: "", transactionType: "تحويل داخلي صادر",
  amountMinor: 10_000, direction: "DEBIT", ...o,
});

const inv = (o: Partial<OpenInvoice> & { invoiceId: string }): OpenInvoice => ({
  supplierId: "s1", supplierName: "غاناش", invoiceNumber: o.invoiceId,
  invoiceDate: d("2026-08-15"), periodMonth: "2026-08", outstandingMinor: 10_000, ...o,
});

const index: SupplierAliasIndex[] = [
  {
    supplierId: "s1", supplierName: "غاناش",
    normalizedNames: ["غاناش", "ganache", "شركة انس غالب حمزه خاشقجي التجاريه المحدوده"].map(normalizeName),
  },
  {
    supplierId: "s2", supplierName: "أفال — بدر",
    normalizedNames: ["افال", "aval", "شركة ايفال بي بي اس"].map(normalizeName),
  },
];

describe("استبعاد الحركات التشغيلية", () => {
  it("يستبعد نقاط البيع والرسوم والضرائب", () => {
    expect(isInternalNoise(tx({ id: "1", transactionType: "نقاط بيع ودفع إلكتروني" }))).toBe(true);
    expect(isInternalNoise(tx({ id: "2", transactionType: "رسوم عملية نقاط بيع فوري" }))).toBe(true);
    expect(isInternalNoise(tx({ id: "3", transactionType: "ضريبة عملية نقاط بيع فوري" }))).toBe(true);
  });

  it("لا يستبعد التحويلات للموردين", () => {
    expect(isInternalNoise(tx({ id: "4", transactionType: "تحويل داخلي صادر" }))).toBe(false);
  });
});

describe("التعرّف على المورّد من وصف البنك", () => {
  it("يتعرّف على غاناش من اسمها التجاري المختلف تماماً", () => {
    const s = findSupplierInText("شركة انس غالب حمزه خاشقجي التجارية المحدودة BEN ID:123", index);
    expect(s?.supplierName).toBe("غاناش");
  });

  it("يتعرّف على أفال من «شركة إيفال بي بي إس»", () => {
    expect(findSupplierInText("شركة إيفال بي بي إس BEN ID:7052673337 شراء بضاعة", index)?.supplierId).toBe("s2");
  });

  it("لا يتعرّف على من ليس في القائمة", () => {
    expect(findSupplierInText("احمد محمد يسلم الجعيدي تحويل", index)).toBeUndefined();
  });

  it("يتعرّف عليها من كلمة مميِّزة واحدة رغم قطع الوصف", () => {
    expect(findSupplierInText("خاشقجي BV:رواتب", index)?.supplierName).toBe("غاناش");
  });

  it("لا يخدعه وصف يحمل كلمات شائعة فقط", () => {
    expect(findSupplierInText("شركة تجارية محدودة تحويل سداد", index)).toBeUndefined();
  });

  it("يفضّل التطابق النصّي الكامل على الجزئي", () => {
    const both: SupplierAliasIndex[] = [
      { supplierId: "a", supplierName: "سرد", normalizedNames: [normalizeName("سرد")] },
      { supplierId: "b", supplierName: "سرد للتجارة", normalizedNames: [normalizeName("سرد للتجاره")] },
    ];
    expect(findSupplierInText("تحويل إلى سرد للتجارة المحدودة", both)?.supplierId).toBe("b");
  });
});

describe("إيجاد الفواتير التي تفسّر المبلغ", () => {
  it("فاتورة واحدة بالمبلغ نفسه", () => {
    const c = findInvoiceCombination([inv({ invoiceId: "a", outstandingMinor: 25_000 })], 25_000);
    expect(c).toHaveLength(1);
  });

  it("يتسامح بريال في فروق التقريب", () => {
    expect(findInvoiceCombination([inv({ invoiceId: "a", outstandingMinor: 25_000 })], 25_050)).toHaveLength(1);
  });

  it("يجمع فواتير الشهر كلّها — النمط الشائع", () => {
    const c = findInvoiceCombination([
      inv({ invoiceId: "a", outstandingMinor: 10_000 }),
      inv({ invoiceId: "b", outstandingMinor: 15_000 }),
      inv({ invoiceId: "c", outstandingMinor: 20_000 }),
    ], 45_000);
    expect(c).toHaveLength(3);
  });

  it("يجمع فاتورتين من بين ثلاث", () => {
    const c = findInvoiceCombination([
      inv({ invoiceId: "a", outstandingMinor: 10_000 }),
      inv({ invoiceId: "b", outstandingMinor: 15_000 }),
      inv({ invoiceId: "c", outstandingMinor: 99_999 }),
    ], 25_000);
    expect(c?.map((x) => x.invoiceId).sort()).toEqual(["a", "b"]);
  });

  it("لا يخترع تركيبة غير موجودة", () => {
    expect(findInvoiceCombination([inv({ invoiceId: "a", outstandingMinor: 10_000 })], 77_777)).toBeNull();
  });
});

describe("المطابقة الكاملة", () => {
  it("تطابق تحويلاً بفاتورة وتسمّي المورّد", () => {
    const r = matchBankTransactions(
      [tx({ id: "t1", description: "شركة انس غالب حمزه خاشقجي التجارية", amountMinor: 993_140 })],
      [inv({ invoiceId: "i1", outstandingMinor: 993_140 })],
      index,
    );
    expect(r[0].kind).toBe("EXACT_INVOICE");
    expect(r[0].supplierName).toBe("غاناش");
    expect(r[0].invoices).toHaveLength(1);
  });

  it("لا تطابق فاتورة صدرت بعد تاريخ التحويل", () => {
    const r = matchBankTransactions(
      [tx({ id: "t1", description: "خاشقجي", valueDate: d("2026-08-01"), amountMinor: 10_000 })],
      [inv({ invoiceId: "i1", invoiceDate: d("2026-08-20") })],
      index,
    );
    expect(r[0].kind).toBe("SUPPLIER_ONLY");
  });

  it("لا تخصّص الفاتورة نفسها لتحويلين", () => {
    const r = matchBankTransactions(
      [tx({ id: "t1", description: "خاشقجي" }), tx({ id: "t2", description: "خاشقجي" })],
      [inv({ invoiceId: "i1", outstandingMinor: 10_000 })],
      index,
    );
    expect(r[0].kind).toBe("EXACT_INVOICE");
    expect(r[1].kind).toBe("SUPPLIER_ONLY");
  });

  it("تصنّف الوارد ونقاط البيع كحركات تشغيلية", () => {
    const r = matchBankTransactions([
      tx({ id: "t1", direction: "CREDIT", amountMinor: 50_000 }),
      tx({ id: "t2", transactionType: "نقاط بيع ودفع إلكتروني" }),
    ], [], index);
    expect(r.every((x) => x.kind === "INTERNAL")).toBe(true);
  });

  it("ترفع الحركة المجهولة للمراجعة بدل تخمينها", () => {
    const r = matchBankTransactions([tx({ id: "t1", description: "جهة مجهولة" })], [], index);
    expect(r[0].kind).toBe("NONE");
    expect(r[0].confidence).toBe(0);
  });
});

describe("كشف الدفع المكرر", () => {
  it("يكشف تحويلين متطابقين في اليوم نفسه", () => {
    const dups = findDuplicatePayments([
      tx({ id: "a", description: "خاشقجي", amountMinor: 50_000, valueDate: d("2026-09-02") }),
      tx({ id: "b", description: "خاشقجي", amountMinor: 50_000, valueDate: d("2026-09-02") }),
      tx({ id: "c", description: "خاشقجي", amountMinor: 50_000, valueDate: d("2026-09-03") }),
    ]);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toHaveLength(2);
  });

  it("لا يعدّ اختلاف المبلغ تكراراً", () => {
    expect(findDuplicatePayments([
      tx({ id: "a", description: "خاشقجي", amountMinor: 50_000 }),
      tx({ id: "b", description: "خاشقجي", amountMinor: 60_000 }),
    ])).toHaveLength(0);
  });

  it("يتجاهل حركات نقاط البيع المتكررة بطبيعتها", () => {
    expect(findDuplicatePayments([
      tx({ id: "a", transactionType: "نقاط بيع ودفع إلكتروني", amountMinor: 100 }),
      tx({ id: "b", transactionType: "نقاط بيع ودفع إلكتروني", amountMinor: 100 }),
    ])).toHaveLength(0);
  });
});
