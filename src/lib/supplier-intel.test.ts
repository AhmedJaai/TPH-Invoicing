import { describe, expect, it } from "vitest";
import {
  ageOwed,
  ageTone,
  buildLedger,
  paymentReliability,
  priceHistory,
  type AgeBucketIndex,
  type OpenInvoiceAge,
} from "./supplier-intel";
import { overdueOwedMinor, supplierBalance } from "./supplier-balances";

const inv = (id: string, date: string, openMinor: number, ageDays: number): OpenInvoiceAge => ({
  id,
  number: id,
  date,
  openMinor,
  ageDays,
  bucket: (ageDays > 90 ? 3 : ageDays > 60 ? 2 : ageDays > 30 ? 1 : 0) as AgeBucketIndex,
});

describe("أعمارُ الدَّين تتوزّع على «عليك» نفسه", () => {
  const open = [
    inv("A", "2026-05-01", 50_000, 146),
    inv("B", "2026-07-10", 30_000, 76),
    inv("C", "2026-08-20", 20_000, 35),
    inv("D", "2026-09-15", 10_000, 9),
  ];
  const totalOpen = open.reduce((s, i) => s + i.openMinor, 0);

  it("مجموعُ الشرائح هو ما يقوله مصدرُ الأرصدة بالهللة", () => {
    for (const credit of [0, 1, 40_000, 55_000, 109_999, 110_000, 200_000]) {
      const b = supplierBalance({
        supplierId: "s", billedMinor: totalOpen, openMinor: totalOpen, openCount: 4,
        paidNetMinor: 0, creditMinor: credit,
      });
      const a = ageOwed(open, b.owedMinor);
      expect(a.buckets.reduce((s, x) => s + x, 0)).toBe(b.owedMinor);
      expect(a.unagedMinor).toBe(0);
    }
  });

  it("والرصيدُ يأكل الأقدمَ أوّلاً — فالمتأخّر هو `overdueOwedMinor` بعينه", () => {
    const overdueOpen = open.filter((i) => i.bucket >= 2).reduce((s, i) => s + i.openMinor, 0);
    for (const credit of [0, 30_000, 80_000, 95_000]) {
      const owed = Math.max(0, totalOpen - credit);
      expect(ageOwed(open, owed).overdueMinor).toBe(overdueOwedMinor(overdueOpen, credit));
    }
  });

  it("أقدمُ دَينٍ هو أقدمُ فاتورةٍ بقي عليها شيءٌ بعد الرصيد، لا أقدمُ فاتورةٍ مفتوحة", () => {
    expect(ageOwed(open, totalOpen).oldestOwedDays).toBe(146);
    // رصيدٌ بستّين ألفاً يغطّي A كلّها وعشرةً من B
    const a = ageOwed(open, totalOpen - 60_000);
    expect(a.oldestOwedDays).toBe(76);
    expect(a.carrying[0]).toMatchObject({ id: "B", owedMinor: 20_000 });
    expect(a.buckets).toEqual([10_000, 20_000, 20_000, 0]);
  });

  it("لا دَين = لا عمر، ولا يُقال «صفر يوم»", () => {
    const a = ageOwed(open, 0);
    expect(a.oldestOwedDays).toBeNull();
    expect(a.carrying).toEqual([]);
  });

  it("دَينٌ أكبر من المفتوح لا يُطوى في شريحة — يُعرَض بلا عمر", () => {
    const a = ageOwed([inv("A", "2026-09-01", 1_000, 20)], 1_500);
    expect(a.buckets).toEqual([1_000, 0, 0, 0]);
    expect(a.unagedMinor).toBe(500);
  });

  it("نبرةُ العمر", () => {
    expect(ageTone(null)).toBe("muted");
    expect(ageTone(45)).toBe("muted");
    expect(ageTone(61)).toBe("warn");
    expect(ageTone(91)).toBe("danger");
  });
});

describe("انتظامُ السداد من التخصيصات وحدها", () => {
  it("دون العيّنة: غير معروف لا صفر", () => {
    const r = paymentReliability(
      [{ invoiceDate: "2026-08-01", settledOn: "2026-08-11" }],
      { invoiceCount: 5, settledCount: 1 },
    );
    expect(r.averageDays).toBeNull();
    expect(r.medianDays).toBeNull();
    expect(r.sampleCount).toBe(1);
  });

  it("المتوسّط والوسيط بالأيّام، والمسدَّد قبل تاريخه يُعدّ صفراً ويُحصى", () => {
    const r = paymentReliability(
      [
        { invoiceDate: "2026-08-01", settledOn: "2026-08-11" }, // 10
        { invoiceDate: "2026-08-05", settledOn: "2026-08-25" }, // 20
        { invoiceDate: "2026-08-10", settledOn: "2026-08-08" }, // -2 → 0
        { invoiceDate: "2026-08-12", settledOn: "2026-09-11" }, // 30
      ],
      { invoiceCount: 6, settledCount: 4 },
    );
    expect(r.averageDays).toBe(15);
    expect(r.medianDays).toBe(15);
    expect(r.prepaidCount).toBe(1);
  });
});

describe("تاريخُ الأسعار داخل المورّد", () => {
  const line = (n: string, date: string, unit: number, id = date) => ({
    normalized: n, description: n, date, unitPriceMinor: unit, invoiceId: id, invoiceNumber: id,
  });

  it("النسبة من الهللات، وآخرُ تغيّرٍ مقابل آخر سعرٍ خالفه", () => {
    const [h] = priceHistory([
      line("حليب", "2026-06-01", 1_000),
      line("حليب", "2026-07-01", 1_100),
      line("حليب", "2026-08-01", 1_100),
      line("حليب", "2026-09-01", 1_210),
    ]);
    expect(h.changePct).toBe(21);
    expect(h.lastMove).toEqual({ previousMinor: 1_100, previousDate: "2026-08-01", pct: 10 });
    expect(h.points).toEqual([1_000, 1_100, 1_100, 1_210]);
  });

  it("شراءٌ واحد لا نسبةَ له، وسعرُ صفرٍ لا يدخل", () => {
    const h = priceHistory([line("سكر", "2026-09-01", 500), line("سكر", "2026-09-02", 0)]);
    expect(h[0].purchases).toBe(1);
    expect(h[0].changePct).toBeNull();
    expect(h[0].lastMove).toBeNull();
  });

  it("ما تحرّك أكثر يتقدّم", () => {
    const h = priceHistory([
      line("أ", "2026-06-01", 1_000), line("أ", "2026-07-01", 1_050),
      line("ب", "2026-06-01", 1_000), line("ب", "2026-07-01", 1_300),
    ]);
    expect(h.map((x) => x.normalized)).toEqual(["ب", "أ"]);
  });
});

describe("كشفُ الحساب", () => {
  it("الختاميّ = الافتتاحيّ + الفواتير − المدفوعات، والفاتورة قبل الدفعة في يومها", () => {
    const l = buildLedger(5_000, [
      { id: "p1", date: "2026-09-02", kind: "PAYMENT", reference: "حوالة", amountMinor: 7_000 },
      { id: "i1", date: "2026-09-02", kind: "INVOICE", reference: "SI-1", amountMinor: 4_000 },
      { id: "i2", date: "2026-09-10", kind: "INVOICE", reference: "SI-2", amountMinor: 2_500 },
    ]);
    expect(l.rows.map((r) => r.id)).toEqual(["i1", "p1", "i2"]);
    expect(l.rows.map((r) => r.balanceMinor)).toEqual([9_000, 2_000, 4_500]);
    expect(l.closingMinor).toBe(5_000 + l.invoicedMinor - l.paidMinor);
  });

  it("والرصيدُ السالب رصيدٌ لك لا خطأ", () => {
    const l = buildLedger(0, [{ id: "p", date: "2026-09-01", kind: "PAYMENT", reference: "مقدَّمة", amountMinor: 1_000 }]);
    expect(l.closingMinor).toBe(-1_000);
  });
});
