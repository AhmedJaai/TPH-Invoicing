import { describe, expect, it } from "vitest";
import { overdueOwedMinor, supplierBalance, totalBalances } from "./supplier-balances";

const row = (id: string, openMinor: number, creditMinor: number, openCount = 1) =>
  supplierBalance({ supplierId: id, billedMinor: 0, openMinor, openCount, paidNetMinor: 0, creditMinor });

describe("supplierBalance", () => {
  it("رصيدُنا عند المورّد يُخصم من فواتيره المفتوحة", () => {
    // لوريفا: ثلاث فواتير ١٬٠١٢٫٠٠، وبقي من حوالتها ٦٣٢٫٥٠
    const b = row("loreva", 101_200, 63_250);
    expect(b.owedMinor).toBe(37_950);
    expect(b.creditLeftMinor).toBe(0);
  });

  it("الرصيد الأكبر من المفتوح يبقى لنا عنده ولا يصير ديناً سالباً", () => {
    const b = row("ganache", 0, 2_909_500, 0);
    expect(b.owedMinor).toBe(0);
    expect(b.creditLeftMinor).toBe(2_909_500);
  });
});

describe("totalBalances", () => {
  it("لا يُخصم رصيدُ مورّدٍ من دَين مورّدٍ آخر", () => {
    const t = totalBalances([row("golden", 1_215_550, 0), row("ganache", 0, 2_909_500, 0)]);
    expect(t.owedMinor).toBe(1_215_550);
    expect(t.creditLeftMinor).toBe(2_909_500);
    expect(t.owedSuppliers).toBe(1);
    expect(t.creditSuppliers).toBe(1);
  });

  it("يُعلن ما خُصم من المفتوح كي يُقارَن بالرقم القديم", () => {
    const t = totalBalances([row("loreva", 101_200, 63_250, 3), row("aval", 165_715, 0, 2)]);
    expect(t.openInvoicesMinor).toBe(266_915);
    expect(t.offsetMinor).toBe(63_250);
    expect(t.owedMinor).toBe(266_915 - 63_250);
    expect(t.openInvoiceCount).toBe(5);
  });
});

describe("overdueOwedMinor", () => {
  it("رصيدُنا عند المورّد يُخصم من متأخّره أوّلاً — الأقدم أوّلاً", () => {
    // فاتورة ١٬٧٩٦٫٠٠ عمرها ١٠٧ أيّام، ولنا عنده ٥٠٠ من حوالةٍ لم تُخصَّص
    expect(overdueOwedMinor(179_600, 50_000)).toBe(129_600);
  });

  it("الرصيد الذي يغطّي المتأخّر لا يترك «مستحقّاً عليك»", () => {
    expect(overdueOwedMinor(179_600, 200_000)).toBe(0);
  });

  it("ولا رصيد: المتأخّر كما هو", () => {
    expect(overdueOwedMinor(179_600, 0)).toBe(179_600);
  });

  it("ولا يزيد على «عليك له» أبداً", () => {
    const open = 179_600 + 69_000; // متأخّرة وحديثة
    const credit = 100_000;
    expect(overdueOwedMinor(179_600, credit)).toBeLessThanOrEqual(row("x", open, credit).owedMinor);
  });
});
