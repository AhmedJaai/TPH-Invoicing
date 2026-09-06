import { describe, expect, it } from "vitest";
import { toCanonical, type RawBankRow } from "./canonical";
import { buildMemory, classify, merchantKey } from "./classification";

const base: RawBankRow = {
  valueDate: new Date("2026-08-27T00:00:00Z"),
  amountMinor: 1_000_00,
  direction: "DEBIT",
};
const row = (over: Partial<RawBankRow>) => toCanonical({ ...base, ...over });

describe("الطبقة الأولى — البنية تحسم", () => {
  it("تسوية الشبكة تُعرَف من بنيتها لا من كلمة", () => {
    const c = classify(row({ direction: "CREDIT", description: "81140155-260718-POS MC Se ttlem 125207" }));
    expect(c.kind).toBe("POS_SETTLEMENT");
    expect(c.layer).toBe("STRUCTURE");
  });

  it("الوارد من الشبكة لم يعد ضجيجاً داخلياً", () => {
    const c = classify(row({ direction: "CREDIT", description: "REFERENCE : 81140155 MC26 0831 000000" }));
    expect(c.kind).not.toBe("INTERNAL_TRANSFER");
    expect(c.kind).toBe("POS_SETTLEMENT");
  });

  it("رسوم الشبكة وضريبتها تُفصلان", () => {
    expect(classify(row({ description: "81140155-260727-POS FV Fe es 825258" })).kind).toBe("POS_FEE");
    expect(classify(row({ description: "81140155-260724-POS VM VA T 607110" })).kind).toBe("POS_VAT");
  });

  it("الصفّ المتطابق يُصنَّف تصنيفاً واحداً دائماً", () => {
    const line = "81140155-260508-POS VS VA T 418069";
    const a = classify(row({ description: line }));
    const b = classify(row({ description: line }));
    expect(a).toEqual(b);
  });
});

describe("الطبقة الثانية — المتعلَّم يسبق الكلمات", () => {
  const memory = buildMemory([
    { key: "NAME:لوريفا كيك", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: new Date("2026-08-01") },
  ]);

  it("ما أكّده الإنسان يُقدَّم على الكلمة المفتاحية", () => {
    // الوصف فيه «رواتب» والمستفيد مؤكَّد أنّه مورّد
    const c = classify(
      row({ beneficiaryRaw: "لوريفا كيك", description: "BV:رواتب شهرية" }),
      memory,
    );
    expect(c.kind).toBe("SUPPLIER_PAYMENT");
    expect(c.layer).toBe("LEARNED");
    expect(c.reason).toContain("أكّدتَ");
  });

  it("بلا ذاكرة تعمل الكلمة", () => {
    const c = classify(row({ beneficiaryRaw: "لوريفا كيك", description: "BV:رواتب شهرية" }));
    expect(c.kind).toBe("SALARY");
    expect(c.layer).toBe("KEYWORD");
  });
});

describe("الطبقة الثالثة — الكلمات بشروطها", () => {
  it("«شراء بضاعة» يُقدَّم على «رواتب» في الوصف نفسه", () => {
    const c = classify(row({ description: "سالم باحاج BV:رواتب شهرية شراء بضاعة 12178872" }));
    expect(c.kind).toBe("SUPPLIER_PAYMENT");
    expect(c.reason).toContain("شراء بضاعة");
  });

  it("زاتكا حكوميّة لا صدقة", () => {
    expect(classify(row({ description: "ZATCA سداد ضريبة" })).kind).toBe("GOVERNMENT");
  });

  it("إيجار من منصّة إيجار", () => {
    expect(classify(row({ description: "EJAR رقم السداد20904553589" })).kind).toBe("RENT");
  });

  it("الاتجاه شرطٌ: الراتب صادر لا وارد", () => {
    expect(classify(row({ direction: "CREDIT", description: "رواتب شهرية" })).kind).not.toBe("SALARY");
  });

  it("الكهرباء تُعرَف من اسم الشركة", () => {
    expect(classify(row({ description: "Saudi Energy رقم السداد30151604771" })).kind).toBe("UTILITY");
  });
});

describe("الطبقة الرابعة — المجهول يُعلَن", () => {
  it("الصادر المجهول يُقال عنه مجهول", () => {
    const c = classify(row({ description: "تحويل الى حساب" }));
    expect(c.kind).toBe("UNKNOWN");
    expect(c.layer).toBe("NONE");
  });

  it("الوارد المجهول لا يُفترَض ضجيجاً — وهذا كان الخلل", () => {
    const c = classify(row({ direction: "CREDIT", description: "ايداع" }));
    expect(c.kind).toBe("UNKNOWN");
    expect(c.reason).toContain("لا يُفترَض أنّه ضجيج");
  });
});

describe("merchantKey", () => {
  it("رقم الحساب أثبت من الاسم", () => {
    expect(merchantKey(row({ description: "تحويل 12600000942005", beneficiaryRaw: "فلان" })))
      .toBe("ACC:12600000942005");
  });

  it("ثمّ رقم الهوية", () => {
    expect(merchantKey(row({ description: "BEN ID:1115891903", beneficiaryRaw: "فلان" })))
      .toBe("ID:1115891903");
  });

  it("ثمّ الاسم موحَّداً", () => {
    expect(merchantKey(row({ beneficiaryRaw: "  لوريفا   كيك " }))).toBe("NAME:لوريفا كيك");
  });

  it("الاسم القصير جداً لا يصلح مفتاحاً", () => {
    expect(merchantKey(row({ beneficiaryRaw: "أب" }))).toBeNull();
  });
});

describe("buildMemory", () => {
  it("التأكيد المتكرّر يُعدّ", () => {
    const m = buildMemory([
      { key: "K", kind: "RENT", supplierId: null, at: new Date("2026-01-01") },
      { key: "K", kind: "RENT", supplierId: null, at: new Date("2026-02-01") },
    ]);
    expect(m.get("K")!.confirmations).toBe(2);
  });

  it("التضارب يُحسم للأحدث لا للأغلبية — الباب قد يتغيّر فعلاً", () => {
    const m = buildMemory([
      { key: "K", kind: "SALARY", supplierId: null, at: new Date("2026-01-01") },
      { key: "K", kind: "SALARY", supplierId: null, at: new Date("2026-02-01") },
      { key: "K", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: new Date("2026-03-01") },
    ]);
    expect(m.get("K")!.kind).toBe("SUPPLIER_PAYMENT");
    expect(m.get("K")!.confirmations).toBe(1);
  });

  it("لا تأكيدات فلا ذاكرة", () => {
    expect(buildMemory([]).size).toBe(0);
  });
});

describe("الطبقة الرابعة — المقدار يدلّ حين يصمت الوصف", () => {
  it("صادرٌ صغير بلا وصفٍ رسمُ بنك", () => {
    const c = classify(row({ amountMinor: 3_00, description: "" }));
    expect(c.kind).toBe("BANK_FEE");
    expect(c.layer).toBe("AMOUNT");
    expect(c.source).toBe("AMOUNT");
  });

  it("الضريبة تخرج من حكم الرسم — بابها غير بابه", () => {
    const c = classify(row({
      amountMinor: 1_05, description: "", transactionType: "ضريبة القيمة المضافة",
    }));
    expect(c.kind).not.toBe("BANK_FEE");
  });

  it("العشرون نفسها ليست رسماً — الحدّ دون لا حتّى", () => {
    expect(classify(row({ amountMinor: 20_00, description: "" })).kind).toBe("UNKNOWN");
    expect(classify(row({ amountMinor: 19_99, description: "" })).kind).toBe("BANK_FEE");
  });

  it("الوارد الصغير ليس رسماً مهما صغر", () => {
    const c = classify(row({ amountMinor: 5_00, direction: "CREDIT", description: "" }));
    expect(c.kind).not.toBe("BANK_FEE");
  });

  it("المقدار لا ينقض ما قيل صراحةً: زكاةُ خمسة ريالات زكاة", () => {
    expect(classify(row({ amountMinor: 5_00, description: "صدقه" })).kind).toBe("ZAKAT");
  });

  it("ولا ينقض ما تعلّمه النظام", () => {
    const memory = buildMemory([{
      key: "NAME:المراعي", kind: "SUPPLIER_PAYMENT", supplierId: "S1", at: new Date("2026-01-01"),
    }]);
    const c = classify(row({ amountMinor: 2_00, beneficiaryRaw: "المراعي" }), memory);
    expect(c.kind).toBe("SUPPLIER_PAYMENT");
  });
});

describe("الضريبة على الرسم بابٌ غير باب الرسم", () => {
  it("رسمُ القناة الرقمية رسم، وضريبتُه ضريبة — والوصف واحد", () => {
    const fee = classify(row({ amountMinor: 50, description: "CITY:Digital Channel" }));
    const vat = classify(row({
      amountMinor: 8, description: "CITY:Digital Channel",
      transactionType: "ضريبة القيمة المضافة",
    }));
    expect(fee.kind).toBe("BANK_FEE");
    expect(vat.kind).toBe("BANK_VAT");
  });

  it("حضورُ «نوع العملية» لا يُخرِج الرسم من بابه", () => {
    /*
      كانت القاعدة مقيَّدة بأوّل النصّ وآخره، و`searchText` يجمع الوصف
      والنوع — فالرسم الذي يُعرَف حين يغيب نوعه يخرج مجهولاً حين يحضر.
    */
    const c = classify(row({
      amountMinor: 50, description: "CITY:Digital Channel",
      transactionType: "رسوم القناة الرقمية",
    }));
    expect(c.kind).toBe("BANK_FEE");
  });

  it("سدادُ زاتكا حكوميّ — ولا تخدع كلمةُ Tax في وصفه", () => {
    const c = classify(row({
      amountMinor: 14_209_32,
      description: "Zakat, Tax and Customs Au thority رقم السداد310007971626300",
      transactionType: "مدفوعات سداد",
    }));
    expect(c.kind).toBe("GOVERNMENT");
  });

  it("الوزارات والأمانات حكوميّة", () => {
    expect(classify(row({
      amountMinor: 250_00,
      description: "Ministry of Municipal and  Rural Affairs رقم السداد982521151712",
    })).kind).toBe("GOVERNMENT");
  });
});

describe("«نوع العملية» يُصنّف حين يصمت الوصف", () => {
  it("وصفٌ بلا كلمة، ونوعٌ يقولها كاملة", () => {
    const c = classify(row({
      amountMinor: 13, description: "81140155-260626-POS 0",
      transactionType: "ضريبة عملية نقاط بيع فوري",
    }));
    expect(c.kind).toBe("POS_VAT");
    expect(c.layer).toBe("STRUCTURE");
  });

  it("الرسم الشهريّ لأجهزة الشبكة وضريبتُه", () => {
    expect(classify(row({
      amountMinor: 100_00, description: "PoSMonthlyFeeSep81140156",
      transactionType: "نقاط بيع شهري",
    })).kind).toBe("POS_FEE");
    expect(classify(row({
      amountMinor: 15_00, description: "PoSMonthlyFeeSep81140156",
      transactionType: "ضريبة رسوم أجهزة نقاط بيع",
    })).kind).toBe("POS_VAT");
  });

  it("ولا يُصنَّف بالنوع ما ليس من الشبكة", () => {
    const c = classify(row({
      amountMinor: 5_000_00, description: "حوالة لمورّد",
      transactionType: "حوالة فورية محلية صادرة",
    }));
    expect(c.kind).not.toBe("POS_FEE");
  });
});

describe("الذاكرة تعمل على المستقبل لا على الكشف نفسه فقط", () => {
  /*
    وهذا هو تعريف «أعرّفه مرّة» الحقيقيّ: لا أن يختفي التنبيه من هذه
    الشاشة، بل أن يأتي كشفُ الشهر القادم فيُعرَف بلا سؤال.
  */
  const memory = buildMemory([{
    key: "ID:2149830115",
    kind: "SUPPLIER_PAYMENT",
    supplierId: "S-almarai",
    at: new Date("2026-09-01"),
  }]);

  it("عُرّف في سبتمبر ← كشفُ أكتوبر يعرفه", () => {
    const october = classify(row({
      valueDate: new Date("2026-10-14T00:00:00Z"),
      amountMinor: 4_120_00,
      description: "المراعي BEN ID:2149830115 شراء بضاعة 99887766",
    }), memory);
    expect(october.kind).toBe("SUPPLIER_PAYMENT");
    expect(october.source).toBe("MEMORY");
  });

  it("ويعرفه وإن تغيّر مبلغُه ووصفُه ما دامت هويّتُه واحدة", () => {
    const later = classify(row({
      valueDate: new Date("2026-11-02T00:00:00Z"),
      amountMinor: 777_25,
      description: "LOCAL TRANSFER المراعي BEN ID:2149830115 دفعة",
    }), memory);
    expect(later.kind).toBe("SUPPLIER_PAYMENT");
  });

  it("ولا يعرف من ليس هو — الهويّة لا التشابه", () => {
    const other = classify(row({
      valueDate: new Date("2026-10-14T00:00:00Z"),
      description: "المراعي BEN ID:1111111111 شراء بضاعة",
    }), memory);
    expect(other.source).not.toBe("MEMORY");
  });
});
