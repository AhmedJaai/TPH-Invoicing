import { describe, expect, it } from "vitest";
import {
  comparePurchases, normaliseInvoiceNumber, suggestSupplierLinks,
  type InvoiceSide, type PurchaseSide,
} from "./purchase-compare";

function purchase(over: Partial<PurchaseSide> = {}): PurchaseSide {
  return {
    id: "p1", reference: "PUR-000001", businessDate: "2026-10-07", foodicsSupplierId: "fs1", foodicsSupplierName: "بُنساك",
    linkedSupplierId: null, invoiceNumber: "175629", invoiceDate: "2026-10-07", totalMinor: 154_986, ...over,
  };
}
function invoice(over: Partial<InvoiceSide> = {}): InvoiceSide {
  return { id: "i1", supplierId: "s1", supplierName: "Bonsack", invoiceNumber: "175629", day: "2026-10-07", totalMinor: 154_986, ...over };
}

describe("رقمُ الفاتورة بلا زخرفه", () => {
  it("الفواصلُ والأصفارُ الأولى لا تفرّق", () => {
    expect(normaliseInvoiceNumber("SI-0107")).toBe("si0107");
    expect(normaliseInvoiceNumber("00536")).toBe("536");
    expect(normaliseInvoiceNumber(" 536 ")).toBe("536");
    expect(normaliseInvoiceNumber(null)).toBe("");
  });
  it("السنةُ بين فاصلين لا تفرّق، والملتصقةُ بالرقم جزءٌ منه", () => {
    expect(normaliseInvoiceNumber("INV/2026/00228")).toBe(normaliseInvoiceNumber("INV00228"));
    expect(normaliseInvoiceNumber("INV-2026-00015")).toBe("inv00015");
    expect(normaliseInvoiceNumber("2026/536")).toBe("536");
    expect(normaliseInvoiceNumber("20261102-001")).toBe("20261102001");
    expect(normaliseInvoiceNumber("RIFT-20261101-001")).toBe("rift20261101001");
    expect(normaliseInvoiceNumber("2026")).toBe("2026");
  });
});

describe("مشترياتُ فودكس أمام فواتيرنا", () => {
  it("الرقمُ والمبلغُ نفسُهما ← متّفقان", () => {
    const r = comparePurchases([purchase()], [invoice()]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]).toMatchObject({ basis: "NUMBER", agrees: true, gapMinor: 0 });
    expect(r.onlyFoodics).toHaveLength(0);
  });

  it("الرقمُ نفسُه والمبلغُ مختلف ← يُعرَض الفرقُ ولا يُحسَم", () => {
    const r = comparePurchases([purchase({ totalMinor: 150_000 })], [invoice()]);
    expect(r.matched[0]).toMatchObject({ agrees: false, gapMinor: -4_986 });
  });

  it("«INV175629» و«INV/2026/175629» رقمٌ واحد — السنةُ بين فاصلين لا تفرّق", () => {
    const r = comparePurchases([purchase({ invoiceNumber: "INV175629" })], [invoice({ invoiceNumber: "INV/2026/175629" })]);
    expect(r.matched[0]).toMatchObject({ basis: "NUMBER", numberConfirms: true });
  });
  it("«INV175629» و«SI-175629» يلتقيان عند ذيل الأرقام حين يتّفق المبلغ", () => {
    const r = comparePurchases([purchase({ invoiceNumber: "INV175629" })], [invoice({ invoiceNumber: "SI-175629" })]);
    expect(r.matched[0].basis).toBe("NUMBER_TAIL");
  });

  it("ذيلٌ قصير («003») لا يكفي بلا مورّدٍ مربوط ولا مبلغ", () => {
    const r = comparePurchases([purchase({ invoiceNumber: "A-003", totalMinor: 100 })], [invoice({ invoiceNumber: "B/003", totalMinor: 999 })]);
    expect(r.matched).toHaveLength(0);
    expect(r.onlyFoodics).toHaveLength(1);
  });

  it("«Aval» ‎PUR-000256‎: تاريخُ الفاتورة في فودكس قبل أسبوع ويومُ إدخالها بعد يوم — والرقمُ نفسُه بلا السنة", () => {
    const r = comparePurchases(
      [purchase({ linkedSupplierId: "s1", invoiceNumber: "INV00228", invoiceDate: "2026-10-31", businessDate: "2026-11-08", totalMinor: 213_785 })],
      [invoice({ invoiceNumber: "INV/2026/00228", day: "2026-11-07", totalMinor: 213_785 })],
    );
    expect(r.matched.map((m) => [m.basis, m.agrees, m.numberConfirms])).toEqual([["SUPPLIER_DATE_AMOUNT", true, true]]);
  });
  it("المورّدُ نفسُه واليومُ نفسُه والمبلغُ نفسُه ← موجودة، ولو كُتب الرقمُ في فودكس على غير صيغته", () => {
    const p = purchase({ invoiceNumber: "رقمٌ آخر", linkedSupplierId: "s1" });
    const r = comparePurchases([p], [invoice({ invoiceNumber: "X9" })]);
    expect(r.matched[0]).toMatchObject({ basis: "SUPPLIER_DAY_AMOUNT", agrees: true, numberConfirms: false });
    expect(r.onlyFoodics).toEqual([]);
  });

  it("والرقمُ إن طابق تأكيدٌ زائد يُقال", () => {
    const r = comparePurchases([purchase({ linkedSupplierId: "s1" })], [invoice()]);
    expect(r.matched[0]).toMatchObject({ basis: "SUPPLIER_DAY_AMOUNT", numberConfirms: true });
  });

  it("اليومُ يومُ الفاتورة أو يومُ إدخالها في فودكس", () => {
    const p = purchase({ invoiceNumber: null, linkedSupplierId: "s1", invoiceDate: "2026-10-05", businessDate: "2026-10-07" });
    expect(comparePurchases([p], [invoice({ day: "2026-10-05" })]).matched[0].basis).toBe("SUPPLIER_DAY_AMOUNT");
    expect(comparePurchases([p], [invoice({ day: "2026-10-07" })]).matched[0].basis).toBe("SUPPLIER_DAY_AMOUNT");
  });

  it("تاريخٌ يبعد أيّاماً بالمبلغ نفسِه يُقبَل ويُقال إنّه قريب؛ والبعيدُ لا", () => {
    const p = purchase({ invoiceNumber: "خطأ", linkedSupplierId: "s1", invoiceDate: "2026-10-05", businessDate: "2026-10-05" });
    expect(comparePurchases([p], [invoice({ invoiceNumber: "X9" })]).matched[0].basis).toBe("SUPPLIER_DATE_AMOUNT");
    expect(comparePurchases([p], [invoice({ invoiceNumber: "X9", day: "2026-09-20" })]).matched).toHaveLength(0);
  });

  it("بلا ربطٍ: فاتورةٌ واحدةٌ لا غيرُها بالمبلغ في اليوم ← هي، والرقمُ مكتوبٌ على غير صيغته", () => {
    /* «مورد حبوب قهوة» ‎00030‎ هو «أفال» ‎INV-2026-00015‎ — ١٨ يونيو بـ‏١٬٥٤٩٫٦٣ */
    const r = comparePurchases(
      [purchase({ foodicsSupplierName: "مورد حبوب قهوة", invoiceNumber: "00030", businessDate: "2026-06-18", invoiceDate: "2026-06-18", totalMinor: 154_963 })],
      [invoice({ supplierName: "أفال — بدر", invoiceNumber: "INV-2026-00015", day: "2026-06-18", totalMinor: 154_963 })],
    );
    expect(r.matched.map((m) => [m.basis, m.agrees])).toEqual([["DAY_AMOUNT", true]]);
    expect(r.onlyFoodics).toEqual([]);
    expect(r.onlyOurs).toEqual([]);
  });
  it("بلا ربطٍ: المبلغُ على فاتورتَين، أو حركتان تطلبان فاتورةً واحدة ← لا يُختار", () => {
    expect(comparePurchases([purchase({ invoiceNumber: "خطأ" })], [invoice({ invoiceNumber: "X9" }), invoice({ id: "i2", invoiceNumber: "X8", supplierId: "s2" })]).matched).toHaveLength(0);
    expect(comparePurchases([purchase({ invoiceNumber: "خطأ" }), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "خطأ2" })], [invoice({ invoiceNumber: "X9" })]).matched).toHaveLength(0);
  });
  it("بلا ربطٍ: المبلغُ بالهللة لا بسماحة الريال — «١٤٠» من البقالة ليست «١٤١» من المطبعة", () => {
    expect(comparePurchases([purchase({ invoiceNumber: "183", totalMinor: 14_000 })], [invoice({ invoiceNumber: "1139", totalMinor: 14_100 })]).matched).toHaveLength(0);
  });
  it("بلا ربطٍ: اليومُ نفسُه يسبق القريب — فلا تأخذ حركةٌ فاتورةَ يومِ غيرها", () => {
    /* ‎PUR-000007‎ (٦ يونيو) و‎PUR-000009‎ (أُدخلت ١٠ يونيو) بالمبلغ نفسِه، وفاتورتان: ٦ و‏١٣ يونيو */
    const r = comparePurchases(
      [purchase({ id: "p7", reference: "PUR-000007", invoiceNumber: "00022", businessDate: "2026-06-06", invoiceDate: "2026-06-06", totalMinor: 132_825 }),
        purchase({ id: "p9", reference: "PUR-000009", invoiceNumber: "00023", businessDate: "2026-06-10", invoiceDate: "2026-06-07", totalMinor: 132_825 })],
      [invoice({ id: "i17", invoiceNumber: "INV-2026-00017", day: "2026-06-06", totalMinor: 132_825 }), invoice({ id: "i16", invoiceNumber: "INV-2026-00016", day: "2026-06-13", totalMinor: 132_825 })],
    );
    expect(r.matched.map((m) => [m.purchase.id, m.invoice.id]).sort()).toEqual([["p7", "i17"], ["p9", "i16"]]);
  });

  it("الرقمُ والمبلغُ معاً يُحجَزان أوّلاً: حركةٌ أخرى بالمبلغ نفسِه لا تأخذ فاتورةَ غيرها", () => {
    /* فاتورتان للمورّد في اليوم نفسِه؛ الحركةُ «أ» رقمُها X ومبلغُها مبلغُ Y خطأً */
    const r = comparePurchases(
      [
        purchase({ id: "a", reference: "PUR-000001", linkedSupplierId: "s1", invoiceNumber: "X", totalMinor: 28_000 }),
        purchase({ id: "b", reference: "PUR-000002", linkedSupplierId: "s1", invoiceNumber: "Y", totalMinor: 28_000 }),
      ],
      [invoice({ id: "ix", invoiceNumber: "X", totalMinor: 26_000 }), invoice({ id: "iy", invoiceNumber: "Y", totalMinor: 28_000 })],
    );
    const by = new Map(r.matched.map((m) => [m.purchase.id, m]));
    expect(by.get("b")).toMatchObject({ invoice: expect.objectContaining({ id: "iy" }), agrees: true });
    expect(by.get("a")).toMatchObject({ invoice: expect.objectContaining({ id: "ix" }), agrees: false, basis: "NUMBER", gapMinor: 2_000 });
  });

  it("فاتورةٌ واحدة لا تُؤخَذ مرّتين — المكرَّرُ في فودكس يظهر زائداً", () => {
    const r = comparePurchases([purchase(), purchase({ id: "p2", reference: "PUR-000002" })], [invoice()]);
    expect(r.matched).toHaveLength(1);
    expect(r.onlyFoodics.map((p) => p.reference)).toEqual(["PUR-000002"]);
  });

  it("الرقمُ نفسُه عند مورّدين: يُقدَّم المورّدُ المربوط", () => {
    const r = comparePurchases(
      [purchase({ linkedSupplierId: "s2" })],
      [invoice({ id: "a", supplierId: "s1" }), invoice({ id: "b", supplierId: "s2" })],
    );
    expect(r.matched[0].invoice.id).toBe("b");
  });

  it("فاتورتُنا خارج فودكس تُسأل لمورّدٍ يتابعه وفي مدّته وحدها", () => {
    const r = comparePurchases(
      [purchase({ linkedSupplierId: "s1" })],
      [
        invoice(),
        invoice({ id: "late", invoiceNumber: "999999", day: "2026-10-09", totalMinor: 5_000 }),
        invoice({ id: "early", invoiceNumber: "111111", day: "2026-05-01", totalMinor: 5_000 }),
        invoice({ id: "other", supplierId: "equipment", invoiceNumber: "E-1", day: "2026-10-09", totalMinor: 1_160_000 }),
      ],
    );
    expect(r.onlyOurs.map((i) => i.id)).toEqual(["late"]);
    expect(r.outOfScope).toBe(2);
  });

  it("النتيجةُ لا تتغيّر بترتيب الصفوف", () => {
    const ps = [purchase(), purchase({ id: "p2", reference: "PUR-000002", totalMinor: 100 })];
    const is = [invoice(), invoice({ id: "i2", totalMinor: 100 })];
    const a = comparePurchases(ps, is).matched.map((m) => `${m.purchase.id}:${m.invoice.id}`).sort();
    const b = comparePurchases([...ps].reverse(), [...is].reverse()).matched.map((m) => `${m.purchase.id}:${m.invoice.id}`).sort();
    expect(a).toEqual(b);
  });
});

describe("اقتراحُ ربط المورّد من الفواتير لا من الاسم", () => {
  it("حركتان طابقتا مورّداً واحداً ← يُقترَح", () => {
    const r = comparePurchases(
      [purchase(), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "175630" })],
      [invoice(), invoice({ id: "i2", invoiceNumber: "175630" })],
    );
    expect(suggestSupplierLinks(r)).toEqual([expect.objectContaining({ foodicsSupplierId: "fs1", supplierId: "s1", evidence: 2, against: 0 })]);
  });
  it("اسمٌ جامعٌ توزّعت حركاتُه على مورّدين ← لا اقتراح", () => {
    const r = comparePurchases(
      [purchase(), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "175630" })],
      [invoice(), invoice({ id: "i2", invoiceNumber: "175630", supplierId: "s2" })],
    );
    expect(suggestSupplierLinks(r)).toEqual([]);
  });
  it("«Aval»: الرقمُ لا يلتقي (S000102 · INV-2026-00080) والمبلغُ في يومه يلتقي ← يُقترَح «أفال»", () => {
    const ps = [
      purchase({ id: "p1", reference: "PUR-000089", foodicsSupplierName: "Aval", invoiceNumber: "S000102", businessDate: "2026-08-13", invoiceDate: "2026-08-13", totalMinor: 199_870 }),
      purchase({ id: "p2", reference: "PUR-000120", foodicsSupplierName: "Aval", invoiceNumber: "S00134", businessDate: "2026-08-29", invoiceDate: "2026-08-29", totalMinor: 50_600 }),
      /* يومُ إدخالها في فودكس بعد يومٍ من فاتورتنا، وتاريخُ فاتورتها قبلها بأسبوع */
      purchase({ id: "p3", reference: "PUR-000045", foodicsSupplierName: "Aval", invoiceNumber: "00057", businessDate: "2026-06-30", invoiceDate: "2026-06-22", totalMinor: 101_200 }),
    ];
    const is = [
      invoice({ id: "i1", supplierId: "aval", supplierName: "أفال — بدر", invoiceNumber: "INV-2026-00080", day: "2026-08-13", totalMinor: 199_870 }),
      invoice({ id: "i2", supplierId: "aval", supplierName: "أفال — بدر", invoiceNumber: "INV-2026-00110", day: "2026-08-29", totalMinor: 50_600 }),
      invoice({ id: "i3", supplierId: "aval", supplierName: "أفال — بدر", invoiceNumber: "INV-2026-00046", day: "2026-06-29", totalMinor: 101_200 }),
    ];
    const before = comparePurchases(ps, is);
    /* بلا ربطٍ تُقرَن بالمبلغ في اليوم، والاقتراحُ يبقى ليُربَط فيُطابَق ما بعدها بالمورّد */
    expect(before.matched.map((m) => m.basis)).toEqual(["DAY_AMOUNT", "DAY_AMOUNT", "DAY_AMOUNT"]);
    expect(suggestSupplierLinks(before, is)).toEqual([expect.objectContaining({ foodicsSupplierId: "fs1", supplierId: "aval", evidence: 3, against: 0 })]);
    /* وبعد الربط تُطابَق كلُّها بالمورّد والمبلغ — والثالثةُ بأقرب تاريخَيها */
    const after = comparePurchases(ps.map((p) => ({ ...p, linkedSupplierId: "aval" })), is);
    expect(after.onlyFoodics).toEqual([]);
    expect(after.matched.map((m) => [m.purchase.id, m.invoice.id, m.basis]).sort()).toEqual([
      ["p1", "i1", "SUPPLIER_DAY_AMOUNT"], ["p2", "i2", "SUPPLIER_DAY_AMOUNT"], ["p3", "i3", "SUPPLIER_DATE_AMOUNT"],
    ]);
  });
  it("اسمٌ جامعٌ حملت حركاتُه فواتيرَ مورّدٍ اقتُرح لغيره أقوى دليلاً ← لا يُقترَح له، ولا لمورّدٍ مربوط", () => {
    const aval = (id: string, day: string, totalMinor: number) => purchase({ id, reference: `PUR-${id}`, foodicsSupplierId: "aval", invoiceNumber: `S${id}`, businessDate: day, invoiceDate: day, totalMinor });
    const generic = (id: string, day: string, totalMinor: number) => purchase({ id, reference: `PUR-${id}`, foodicsSupplierId: "generic", invoiceNumber: `0${id}`, businessDate: day, invoiceDate: day, totalMinor });
    const ps = [aval("a1", "2026-08-01", 100_00), aval("a2", "2026-08-08", 200_00), aval("a3", "2026-08-15", 300_00), generic("g1", "2026-06-03", 400_00), generic("g2", "2026-06-11", 500_00)];
    const is = [
      invoice({ id: "i1", invoiceNumber: "INV-1", day: "2026-08-01", totalMinor: 100_00 }), invoice({ id: "i2", invoiceNumber: "INV-2", day: "2026-08-08", totalMinor: 200_00 }),
      invoice({ id: "i3", invoiceNumber: "INV-3", day: "2026-08-15", totalMinor: 300_00 }), invoice({ id: "i4", invoiceNumber: "INV-4", day: "2026-06-03", totalMinor: 400_00 }),
      invoice({ id: "i5", invoiceNumber: "INV-5", day: "2026-06-11", totalMinor: 500_00 }),
    ];
    expect(suggestSupplierLinks(comparePurchases(ps, is), is)).toEqual([expect.objectContaining({ foodicsSupplierId: "aval", supplierId: "s1", evidence: 3 })]);
    const linked = ps.map((p) => (p.foodicsSupplierId === "aval" ? { ...p, linkedSupplierId: "s1" } : p));
    expect(suggestSupplierLinks(comparePurchases(linked, is), is)).toEqual([]);
  });
  it("مبلغٌ يقع عند مورّدَين في الأيّام نفسها لا يشهد لأحدهما", () => {
    const ps = [purchase({ invoiceNumber: "X1" }), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "X2" })];
    const is = [
      invoice({ invoiceNumber: "A1" }), invoice({ id: "i2", invoiceNumber: "A2", supplierId: "s2" }),
      invoice({ id: "i3", invoiceNumber: "A3" }), invoice({ id: "i4", invoiceNumber: "A4", supplierId: "s2" }),
    ];
    expect(suggestSupplierLinks(comparePurchases(ps, is), is)).toEqual([]);
  });
  it("مبلغُها بعيدُ اليوم لا يشهد", () => {
    const ps = [purchase({ invoiceNumber: "X1" }), purchase({ id: "p2", reference: "PUR-000002", invoiceNumber: "X2" })];
    const is = [invoice({ invoiceNumber: "A1", day: "2026-09-20" }), invoice({ id: "i2", invoiceNumber: "A2", day: "2026-09-20" })];
    expect(suggestSupplierLinks(comparePurchases(ps, is), is)).toEqual([]);
  });
  it("حركةٌ واحدة لا تكفي", () => {
    expect(suggestSupplierLinks(comparePurchases([purchase()], [invoice()]), [invoice()])).toEqual([]);
  });
});
