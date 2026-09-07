import { describe, expect, it } from "vitest";
import { detectChannel, extractReferences, matchableReferences, normalizeText, statedValueDate, toCanonical, toLatinDigits } from "./canonical";

/** النصوص منقولة حرفياً من كشف الأهلي في قاعدة أحمد. */
const SALARY =
  "عبدالرحمن احمد بن عبدالرح من بلخير BEN ID:1115891903 BV:رواتب شهرية 10191316000107 الأهلي إي كورب مرجع133731545";
const RENT =
  "EJAR رقم السداد20904553589 هاتف الأهلي مرجع سداد6959405833";
const POS_SETTLE = "81140155-260718-POS MC Se ttlem 125207";

describe("toLatinDigits", () => {
  it("تحوّل الأرقام العربية", () => {
    expect(toLatinDigits("٤٧٥٠٠")).toBe("47500");
  });
});

describe("normalizeText", () => {
  it("توحّد الهمزة والياء والتاء المربوطة وتُسقط التشكيل", () => {
    expect(normalizeText("مُؤسَّسة الأحمد")).toBe("مؤسسه الاحمد");
  });

  it("لا تدمج ما يفصله البنك من رموز", () => {
    // «VM26» ليست «VM 26» — دمجهما يفسد رمز الشبكة
    expect(normalizeText("VM26 0826")).toBe("VM26 0826");
  });
});

describe("extractReferences — ينسب كل رقم إلى نوعه", () => {
  it("يميّز رقم الهوية من المرجع في صفّ الراتب", () => {
    const refs = extractReferences(normalizeText(SALARY));
    const id = refs.find((r) => r.kind === "NATIONAL_ID");
    const ref = refs.find((r) => r.kind === "BANK_REF");
    expect(id?.value).toBe("1115891903");
    expect(ref?.value).toBe("133731545");
  });

  it("يميّز رقم السداد في صفّ الإيجار", () => {
    const refs = extractReferences(normalizeText(RENT));
    expect(refs.find((r) => r.kind === "SADAD")?.value).toBe("20904553589");
    expect(refs.find((r) => r.kind === "BANK_REF")?.value).toBe("6959405833");
  });

  it("رقم الحساب من أربعة عشر رقماً يُعرَف", () => {
    const refs = extractReferences("تحويل الى 12600000942005 مبلغ");
    expect(refs.find((r) => r.kind === "ACCOUNT")?.value).toBe("12600000942005");
  });

  it("الآيبان لا يُخلط بمرجع", () => {
    const refs = extractReferences("SA0380000000608010167519 تحويل");
    expect(refs[0].kind).toBe("IBAN");
    expect(refs.filter((r) => r.kind === "BANK_REF")).toHaveLength(0);
  });

  it("ما لا دليل على نوعه يبقى مجهول النوع ولا يُدَّعى مرجعاً", () => {
    const refs = extractReferences("تحويل 998877665544 بلا وصف");
    expect(refs[0].kind).toBe("NUMBER");
    expect(refs[0].evidence).toContain("بلا دليل");
  });

  it("لا يُكرَّر الرقم الواحد تحت نوعين", () => {
    const refs = extractReferences(normalizeText(RENT));
    const values = refs.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("النصّ بلا أرقام لا يُنتج مراجع", () => {
    expect(extractReferences("تحويل محلي")).toEqual([]);
  });
});

describe("matchableReferences", () => {
  it("تُسقط الآيبان والهوية ورقم الحساب", () => {
    const refs = extractReferences(normalizeText(SALARY));
    const kinds = matchableReferences(refs).map((r) => r.kind);
    expect(kinds).not.toContain("NATIONAL_ID");
    expect(kinds).not.toContain("IBAN");
    expect(kinds).not.toContain("ACCOUNT");
  });
});

describe("detectChannel", () => {
  it("يقرأ القناة من نصّ حقيقيّ", () => {
    expect(detectChannel(normalizeText(SALARY))).toBe("الخدمة المؤسسية");
    expect(detectChannel(normalizeText(RENT))).toBe("هاتف البنك");
    expect(detectChannel(POS_SETTLE)).toBe("نقاط البيع");
  });

  it("ما لا قناة فيه يُرجع null لا تخميناً", () => {
    expect(detectChannel("تحويل")).toBeNull();
  });
});

describe("toCanonical", () => {
  const base = {
    valueDate: new Date("2026-08-27T00:00:00Z"),
    amountMinor: 3_000_00,
    direction: "DEBIT" as const,
  };

  it("يبني نصّ البحث من الحقول كلّها ويُبقيها منفصلة", () => {
    const c = toCanonical({
      ...base,
      beneficiaryRaw: "لوريفا كيك",
      description: SALARY,
      transactionType: "حوالة فورية محلية صادرة",
    });
    expect(c.searchText).toContain("لوريفا كيك");
    expect(c.searchText).toContain("حواله فوريه");
    // والحقل الأصلي باقٍ لمن يريده وحده
    expect(c.beneficiaryRaw).toBe("لوريفا كيك");
  });

  it("يتعرّف على حركة الشبكة", () => {
    const c = toCanonical({ ...base, direction: "CREDIT", description: POS_SETTLE });
    expect(c.pos?.kind).toBe("POS_SETTLEMENT");
    expect(c.pos?.merchantId).toBe("81140155");
  });

  it("ما ليس حركة شبكة يبقى pos فارغاً", () => {
    expect(toCanonical({ ...base, description: RENT }).pos).toBeNull();
  });

  it("النتيجة واحدة لنفس المدخل", () => {
    const row = { ...base, description: SALARY, transactionType: "حوالة" };
    expect(toCanonical(row)).toEqual(toCanonical(row));
  });

  it("الحقول الفارغة لا تكسر شيئاً", () => {
    const c = toCanonical({ ...base, description: null, beneficiaryRaw: null });
    expect(c.searchText).toBe("");
    expect(c.references).toEqual([]);
    expect(c.channel).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════
   تاريخُ القيمة الذي نطق به البنك

   وُجد على ملفّات أحمد الحقيقية: الأهليّ يُصدر الكشف بعمود تاريخٍ
   مبدئيّ ويكتب في النصّ `Value Date:DD/MM/YYYY`، ثمّ يُصحَّح العمود
   في تصديرٍ لاحق. والتاريخ جزءٌ من الهويّة — فإعادةُ استيراد الكشفين
   كانت تُدخل الحركة مرّتين. ثلاثُ حركات في كشوفه: ٣٬٤٠٠ و٧٬٥٠٠
   و٨٩١٫٢٥ — مجموعها ١١٬٧٩١٫٢٥ ريالاً.
   ═══════════════════════════════════════════════════════════════ */
describe("تاريخُ القيمة: نصّ البنك يسبق العمود", () => {
  const REAL = "حوالات تحت الطلب NCBK8242 6186AJSX محمصة الغربية بنك الراجحي Buying Goods شراء بضاعة Value Date:05/07/2026";
  const col = (d: string) => new Date(`${d}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("يُؤخَذ من النصّ حين خالف العمود", () => {
    expect(iso(statedValueDate(REAL, col("2026-07-04")))).toBe("2026-07-05");
  });

  it("والتصديران يتّفقان بعده — فلا تُقيَّد الحركة مرّتين", () => {
    const one = toCanonical({
      valueDate: col("2026-07-04"), description: REAL, beneficiaryRaw: null,
      transactionType: "حوالة محلية صادرة", amountMinor: 89125, direction: "DEBIT",
    });
    const two = toCanonical({
      valueDate: col("2026-07-05"), description: REAL, beneficiaryRaw: null,
      transactionType: "حوالة محلية صادرة", amountMinor: 89125, direction: "DEBIT",
    });
    expect(iso(one.valueDate)).toBe(iso(two.valueDate));
  });

  it("وبلا نصٍّ يبقى العمود على حاله", () => {
    expect(iso(statedValueDate("CITY:Digital Channel", col("2026-07-04")))).toBe("2026-07-04");
    expect(iso(statedValueDate(null, col("2026-07-04")))).toBe("2026-07-04");
  });

  it("ولا يُقبَل ما ليس تاريخاً ولا ما بعُد عن العمود", () => {
    /* يومٌ لا وجود له في شهره */
    expect(iso(statedValueDate("Value Date:31/02/2026", col("2026-02-28")))).toBe("2026-02-28");
    /* شهرٌ خارج الحدّ */
    expect(iso(statedValueDate("Value Date:05/13/2026", col("2026-07-04")))).toBe("2026-07-04");
    /* بعيدٌ عن العمود — رقمٌ آخر لا تاريخ قيمة */
    expect(iso(statedValueDate("Value Date:05/01/2026", col("2026-07-04")))).toBe("2026-07-04");
  });
});
