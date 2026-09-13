import { describe, expect, it } from "vitest";
import {
  findDuplicatePayments, findSupplierInText,
  isInternalNoise,
  type BankTx, type SupplierAliasIndex, suggestAlias } from "./match";
import { normalizeName } from "@/lib/suppliers-seed";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const tx = (o: Partial<BankTx> & { id: string }): BankTx => ({
  valueDate: d("2026-09-02"), description: "", transactionType: "تحويل داخلي صادر",
  amountMinor: 10_000, direction: "DEBIT", ...o,
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

describe("suggestAlias", () => {
  it("يستخرج الاسم المميِّز من وصف بنكي مزدحم", () => {
    const s = suggestAlias("تحويل الى شركة انس غالب حمزه خاشقجي التجارية المحدودة 123456789");
    expect(s).toContain("خاشقجي");
    expect(s).not.toContain("شركه");
    expect(s).not.toContain("123456789");
  });

  it("يُسقط الكلمات الشائعة وحدها فلا يعود بفراغ حين لا يبقى غيرها", () => {
    expect(suggestAlias("شركة التجارية المحدودة")).toBe("");
  });

  it("يحدّ عدد الكلمات", () => {
    const s = suggestAlias("مطاعم ومقاهي الوجبات السريعة الشهية اللذيذة الفاخرة", 3);
    expect(s.split(" ")).toHaveLength(3);
  });
});

describe("ركام كشف البنك لا يُنسَب إلى أحد", () => {
  /** سداد إيجار عبر منصّة «إيجار» — لا اسم مستفيد فيه إطلاقاً */
  const EJAR = "EJAR رقم السداد20904553589 هاتف الأهلي مرجع سداد6959405833 مرجع107125784";

  const index: SupplierAliasIndex[] = [
    {
      supplierId: "mariah", supplierName: "مريم — براونيز",
      // اسمان بديلان مسمومان حُفظا من وصف حوالة سابقة
      normalizedNames: ["مريم براونيز", "ماريه بامخشب الاهلي مرجع100344323"],
    },
    { supplierId: "sabea", supplierName: "سبعة جرة", normalizedNames: ["sabea jar"] },
    { supplierId: "olive", supplierName: "أوراق الزيتون", normalizedNames: ["اوراق الزيتون"] },
  ];

  it("لا يُنسب سداد الإيجار إلى مورّد لمجرّد ورود اسم البنك في وصفه", () => {
    expect(findSupplierInText(EJAR, index)).toBeUndefined();
  });

  it("«jar» لا تطابق داخل «EJAR» — الكلمة تُطابَق كلمةً لا حرفاً في وسط أخرى", () => {
    const only = [index[1]];
    expect(findSupplierInText(EJAR, only)).toBeUndefined();
    expect(findSupplierInText("تحويل الى Sabea Jar", only)?.supplierId).toBe("sabea");
  });

  it("لصق الأرقام بالكلمة لا يمنع المطابقة", () => {
    const idx: SupplierAliasIndex[] = [
      { supplierId: "x", supplierName: "س", normalizedNames: ["خاشقجي"] },
    ];
    expect(findSupplierInText("حوالة خاشقجي12345 مبلغ", idx)?.supplierId).toBe("x");
  });

  it("الاسم الحقيقي ما زال يُطابَق رغم تشديد القواعد", () => {
    expect(
      findSupplierInText("شركة انس غالب حمزه خاشقجي  التجارية المحد ودة", [
        { supplierId: "g", supplierName: "غاناش", normalizedNames: ["شركه انس غالب حمزه خاشقجي التجاريه المحدوده"] },
      ])?.supplierId,
    ).toBe("g");
  });

  it("مولّد الاسم البديل يُسقط الأرقام وركام البنك", () => {
    const s = suggestAlias(EJAR);
    expect(s).not.toContain("الاهلي");
    expect(s).not.toContain("مرجع");
    expect(s).not.toMatch(/\d/);
  });

  it("مولّد الاسم البديل يُبقي الاسم الحقيقي", () => {
    const s = suggestAlias("ماريه بامخشب الاهلي مرجع100344323");
    expect(s).toContain("ماريه");
    expect(s).toContain("بامخشب");
    expect(s).not.toContain("الاهلي");
  });
});

describe("سطور تسوية شبكة البطاقات تشغيلية", () => {
  const tx = (description: string): BankTx => ({
    id: "t", valueDate: new Date("2026-08-12T00:00:00Z"), description,
    transactionType: "", amountMinor: 322, direction: "DEBIT",
  });

  it("سطر المرجع من شبكة البطاقات ليس مدفوعاً لأحد", () => {
    expect(isInternalNoise(tx("REFERENCE : 81140155 VS26 0812 000000"))).toBe(true);
  });

  it("حوالة حقيقية لا تُعدّ تشغيلية", () => {
    expect(isInternalNoise(tx("شركة الصرد للتعبئة والتغليف BEN ID:40305412"))).toBe(false);
  });
});
