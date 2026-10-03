import { describe, expect, it } from "vitest";
import { buildDiscrepancyMemo, normalizeRef, reconcileStatement, type OurInvoice, type StatementLineInput } from "./statement-match";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** التاريخ نصّ في الاختبار ويصير Date في المدخل — فالنوع يُكتب صراحةً لا بـPartial */
interface LineSpec {
  date: string;
  ref?: string | null;
  description?: string | null;
  debitMinor?: number;
  creditMinor?: number;
}

const line = (o: LineSpec): StatementLineInput => ({
  date: d(o.date),
  ref: o.ref ?? null,
  description: o.description ?? null,
  debitMinor: o.debitMinor ?? 0,
  creditMinor: o.creditMinor ?? 0,
});

const inv = (id: string, number: string, date: string, total: number): OurInvoice => ({
  invoiceId: id, invoiceNumber: number, invoiceDate: d(date), totalMinor: total,
});

describe("normalizeRef", () => {
  it("يوحّد الرموز والحالة", () => {
    expect(normalizeRef("civ-008205250")).toBe("CIV008205250");
    expect(normalizeRef("CIV 008205250")).toBe(normalizeRef("CIV-008205250"));
  });
  it("الفراغ يبقى فراغاً", () => {
    expect(normalizeRef(null)).toBe("");
  });
});

describe("reconcileStatement", () => {
  it("يطابق بالرقم ولو كتبه المورّد داخل نصّ", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "INV CIV-008205250 توريد", debitMinor: 68540 })],
      [inv("a", "CIV-008205250", "2026-05-14", 68540)],
    );
    expect(r.matchedCount).toBe(1);
    expect(r.lines[0].method).toBe("REF");
    expect(r.missingFromArchive).toHaveLength(0);
  });

  it("يطابق بالمبلغ والتاريخ حين لا يكتب المورّد رقماً", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-16", description: "توريد", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.matchedCount).toBe(1);
    expect(r.lines[0].method).toBe("AMOUNT_DATE");
  });

  it("لا يطابق بالمبلغ إذا بعُد التاريخ", () => {
    const r = reconcileStatement(
      [line({ date: "2026-06-30", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.missingFromArchive).toHaveLength(1);
  });

  it("يكشف الفاتورة التي حمّلها ولم تصلنا — وهي الغاية", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 }),
        line({ date: "2026-05-20", ref: "260144", debitMinor: 99000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.missingFromArchive).toHaveLength(1);
    expect(r.missingFromArchive[0].line.ref).toBe("260144");
    expect(r.findings.some((f) => f.code === "INVOICE_IN_STATEMENT_NOT_ARCHIVED")).toBe(true);
  });

  it("يكشف فرق المبلغ ويحسب اتجاهه", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 45000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.amountMismatches).toHaveLength(1);
    expect(r.amountMismatches[0].differenceMinor).toBe(3000);
    expect(r.matchedCount).toBe(0);
  });

  it("يتسامح بهللة واحدة لفرق التقريب", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42001 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.matchedCount).toBe(1);
  });

  it("يذكر فواتيرنا التي لم ترد في كشفه", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000), inv("b", "260140", "2026-05-18", 15000)],
    );
    expect(r.notInStatement).toHaveLength(1);
    expect(r.notInStatement[0].invoiceNumber).toBe("260140");
  });

  it("لا يخصّص الفاتورة الواحدة لسطرين", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", debitMinor: 42000 }),
        line({ date: "2026-05-15", debitMinor: 42000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.matchedCount).toBe(1);
    expect(r.missingFromArchive).toHaveLength(1);
  });

  it("السطر الدائن سداد لا فاتورة", () => {
    const r = reconcileStatement(
      [line({ date: "2026-06-02", creditMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.lines[0].status).toBe("PAYMENT");
    expect(r.theirPaidMinor).toBe(42000);
    expect(r.notInStatement).toHaveLength(1);
  });

  it("يجمع المحمَّل والمسدَّد ويقارنه بما عندنا", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 }),
        line({ date: "2026-06-02", creditMinor: 20000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    expect(r.theirBilledMinor).toBe(42000);
    expect(r.theirPaidMinor).toBe(20000);
    expect(r.ourBilledMinor).toBe(42000);
    expect(r.billedDifferenceMinor).toBe(0);
  });

  it("يفحص حساب الكشف نفسه ويكشف اختلاله", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
      { openingBalanceMinor: 10000, closingBalanceMinor: 60000 },
    );
    expect(r.computedClosingMinor).toBe(52000);
    expect(r.balanceArithmeticOk).toBe(false);
    expect(r.findings.some((f) => f.message.includes("لا يستقيم"))).toBe(true);
  });

  it("يقبل الحساب المستقيم", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
      { openingBalanceMinor: 10000, closingBalanceMinor: 52000 },
    );
    expect(r.balanceArithmeticOk).toBe(true);
  });

  it("بلا رصيد ختامي لا يُدّعى فحص لم يجرِ", () => {
    const r = reconcileStatement([], []);
    expect(r.balanceArithmeticOk).toBeNull();
  });

  /*
    كان الافتتاحيّ المجهول يُفترَض صفراً فتُحسَب المعادلة على رقمٍ لم
    يُقرأ، ثمّ يُتَّهم المورّد بأنّ «حسابه لا يستقيم» — والخلل عندنا.
  */
  it("بلا رصيد افتتاحي لا تُحسَب المعادلة ولا يُتَّهم المورّد", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
      { closingBalanceMinor: 60000 },
    );
    expect(r.balanceArithmeticOk).toBeNull();
    expect(r.computedClosingMinor).toBeNull();
    expect(r.findings.some((f) => f.message.includes("لا يستقيم"))).toBe(false);
  });

  it("الافتتاحيّ صفراً مقروءاً يُفحَص — الصفر المقروء ليس كالمجهول", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
      { openingBalanceMinor: 0, closingBalanceMinor: 42000 },
    );
    expect(r.balanceArithmeticOk).toBe(true);
  });

  it("المرجع القصير لا يطابق كل شيء", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "7", debitMinor: 500 })],
      [inv("a", "137", "2026-05-14", 99999)],
    );
    expect(r.missingFromArchive).toHaveLength(1);
  });
});

describe("buildDiscrepancyMemo", () => {
  it("يذكر الناقص والمختلف والزائد بأرقامها", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-05-14", ref: "260137", debitMinor: 45000 }),
        line({ date: "2026-05-20", ref: "260144", debitMinor: 99000 }),
      ],
      [inv("a", "260137", "2026-05-14", 42000), inv("b", "260150", "2026-05-25", 7000)],
    );
    const memo = buildDiscrepancyMemo("أوراق الزيتون", "مايو ٢٠٢٦", r);
    expect(memo).toContain("أوراق الزيتون");
    expect(memo).toContain("260144");
    expect(memo).toContain("260137");
    expect(memo).toContain("260150");
    expect(memo).toContain("1,440.00");
  });

  it("الكشف المتطابق لا يولّد مطالبات", () => {
    const r = reconcileStatement(
      [line({ date: "2026-05-14", ref: "260137", debitMinor: 42000 })],
      [inv("a", "260137", "2026-05-14", 42000)],
    );
    const memo = buildDiscrepancyMemo("مورّد", "مايو", r);
    expect(memo).not.toContain("نرجو إرسالها");
    expect(memo).not.toContain("يختلف مبلغها");
  });
});

describe("النواة المشتركة — لا جشع في الكشوف أيضاً", () => {
  const inv = (id: string, number: string, total: number, date: string) => ({
    invoiceId: id, invoiceNumber: number, totalMinor: total,
    invoiceDate: new Date(`${date}T00:00:00Z`),
  });
  /*
    النوع يُكتب صراحةً لا بـ`Partial<T> & { date: string }`: التقاطع
    يُنتج `Date & string` وهو نوعٌ لا يقبل شيئاً.
  */
  interface LineSpec {
    date: string;
    ref?: string;
    description?: string;
    debitMinor?: number;
    creditMinor?: number;
  }
  const line = (over: LineSpec): StatementLineInput => ({
    date: new Date(`${over.date}T00:00:00Z`),
    ref: over.ref ?? null,
    description: over.description ?? null,
    debitMinor: over.debitMinor ?? 0,
    creditMinor: over.creditMinor ?? 0,
  });

  it("الفاتورة لا تُنسب إلى سطرين", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-08-10", debitMinor: 500_00 }),
        line({ date: "2026-08-10", ref: "INV-1", debitMinor: 500_00 }),
      ],
      [inv("i1", "INV-1", 500_00, "2026-08-10")],
    );
    const matched = r.lines.filter((l) => l.invoice !== undefined);
    expect(matched).toHaveLength(1);
    // والمرجع أوثق من المبلغ والتاريخ، فيفوز صاحبُه
    expect(matched[0].method).toBe("REF");
  });

  it("السطر المكرَّر في كشف المورّد يُسمّى مكرَّراً لا مفقوداً", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-08-10", ref: "INV-1", debitMinor: 500_00 }),
        line({ date: "2026-08-10", ref: "INV-1", debitMinor: 500_00 }),
      ],
      [inv("i1", "INV-1", 500_00, "2026-08-10")],
    );
    expect(r.lines[1].status).toBe("DUPLICATE_LINE");
  });

  it("الإشعار الدائن يُفصَل عن السداد", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-08-12", description: "إشعار دائن — مرتجع", creditMinor: 200_00 }),
        line({ date: "2026-08-15", description: "سداد", creditMinor: 700_00 }),
      ],
      [],
    );
    expect(r.lines[0].status).toBe("CREDIT_NOTE");
    expect(r.lines[1].status).toBe("PAYMENT");
  });

  it("المطابقة بمرجعٍ وتاريخٍ بعيد تُسمّى اختلاف تاريخ", () => {
    const r = reconcileStatement(
      [line({ date: "2026-09-30", ref: "INV-1", debitMinor: 500_00 })],
      [inv("i1", "INV-1", 500_00, "2026-08-01")],
    );
    expect(r.lines[0].status).toBe("DATE_MISMATCH");
  });

  it("لكل سطر مطابَق درجةٌ وسببٌ مكتوب", () => {
    const r = reconcileStatement(
      [line({ date: "2026-08-10", ref: "INV-1", debitMinor: 500_00 })],
      [inv("i1", "INV-1", 500_00, "2026-08-10")],
    );
    expect(r.lines[0].score).toBeGreaterThan(0);
    expect(r.lines[0].why?.length).toBeGreaterThan(0);
  });

  it("النتيجة ثابتة لا تتقلّب", () => {
    const args: Parameters<typeof reconcileStatement> = [
      [line({ date: "2026-08-10", ref: "INV-1", debitMinor: 500_00 })],
      [inv("i1", "INV-1", 500_00, "2026-08-10")],
    ];
    expect(reconcileStatement(...args)).toEqual(reconcileStatement(...args));
  });

  it("رقمان مختلفان بالمبلغ نفسه ليسا فاتورةً واحدة، والفاتورةُ لا يأخذها سطران (غاناش)", () => {
    const r = reconcileStatement(
      [
        line({ date: "2026-08-10", ref: "CIV-008578381", debitMinor: 45540 }),
        line({ date: "2026-08-12", ref: "CIV-008585811", debitMinor: 45540 }),
        line({ date: "2026-08-14", ref: "CIV-008593996", debitMinor: 45540 }),
        line({ date: "2026-08-17", ref: "CIV-008606456", debitMinor: 45540 }),
      ],
      [inv("a", "CIV-008599396", 45540, "2026-08-14"), inv("b", "CIV-008606456", 45540, "2026-08-17")],
    );
    expect(r.lines.map((l) => l.invoice?.invoiceId ?? "-")).toEqual(["-", "-", "a", "b"]);
    expect(r.missingFromArchive).toHaveLength(2);
  });

  it("ومرجعٌ هو ترقيمُ المورّد لا رقمُ فاتورتنا يُطابَق بالمبلغ والتاريخ (زاكوباك)", () => {
    const r = reconcileStatement(
      [line({ date: "2026-07-20", ref: "SO-0045123", debitMinor: 36540 })],
      [inv("z", "2317", 36540, "2026-07-20")],
    );
    expect(r.lines[0].invoice?.invoiceId).toBe("z");
  });
});

describe("لوريفا: كشفٌ بالمبلغ قبل الضريبة، ورقمٌ قُرئ مقلوباً", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const ours = [
    { invoiceId: "a", invoiceNumber: "SI-0086", invoiceDate: d("2026-09-28"), totalMinor: 519_40, subtotalMinor: 451_65 },
    { invoiceId: "b", invoiceNumber: "0059-SI", invoiceDate: d("2026-09-13"), totalMinor: 506_00, subtotalMinor: 440_00 },
    { invoiceId: "c", invoiceNumber: "SI-0071", invoiceDate: d("2026-09-21"), totalMinor: 310_50, subtotalMinor: 270_00 },
    { invoiceId: "e", invoiceNumber: "SI-0077", invoiceDate: d("2026-09-24"), totalMinor: 241_50, subtotalMinor: 210_00, grossMinor: 220_00 },
  ];
  const lines = [
    { date: d("2026-09-28"), ref: "SI-0086", description: null, debitMinor: 451_65, creditMinor: 0 },
    { date: d("2026-09-13"), ref: "SI-0059", description: null, debitMinor: 440_00, creditMinor: 0 },
    { date: d("2026-09-21"), ref: "SI-0071", description: null, debitMinor: 330_00, creditMinor: 0 },
    { date: d("2026-09-24"), ref: "SI-0077", description: null, debitMinor: 220_00, creditMinor: 0 },
  ];
  const r = reconcileStatement(lines, ours);

  it("الصافي مطابقةٌ لا فرق، والرقمُ المقلوب هو نفسُه", () => {
    expect(r.lines[0]).toMatchObject({ status: "MATCHED", differenceMinor: 0 });
    expect(r.lines[1]).toMatchObject({ status: "MATCHED", invoice: { invoiceId: "b" } });
    expect(r.missingFromArchive).toHaveLength(0);
    expect(r.notInStatement.map((i) => i.invoiceId)).not.toContain("b");
  });

  it("والمبلغُ قبل الخصم (مجموعُ البنود) مطابقةٌ كذلك", () => {
    expect(r.lines[3]).toMatchObject({ status: "MATCHED", differenceMinor: 0 });
  });

  it("وما لا يساوي إجماليّاً ولا صافياً ولا ما قبل الخصم فرقٌ حقيقيّ يُعلَن", () => {
    expect(r.lines[2].status).toBe("AMOUNT_MISMATCH");
  });
});

describe("ما بعد آخر أيّام الكشف", () => {
  it("فاتورتُنا بعد آخر يومٍ في الكشف لا تُعدّ «لم ترد فيه»", () => {
    const dd = (x: string) => new Date(`${x}T00:00:00Z`);
    const r = reconcileStatement(
      [{ date: dd("2026-09-28"), ref: "SI-0086", description: null, debitMinor: 100_00, creditMinor: 0 }],
      [
        { invoiceId: "a", invoiceNumber: "SI-0086", invoiceDate: dd("2026-09-28"), totalMinor: 100_00 },
        { invoiceId: "b", invoiceNumber: "SI-0090", invoiceDate: dd("2026-10-02"), totalMinor: 50_00 },
        { invoiceId: "c", invoiceNumber: "SI-0080", invoiceDate: dd("2026-09-25"), totalMinor: 70_00 },
      ],
      { periodEnd: dd("2026-09-28") },
    );
    expect(r.notInStatement.map((i) => i.invoiceId)).toEqual(["c"]);
  });
});
