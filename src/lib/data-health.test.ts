import { describe, expect, it } from "vitest";
import { buildDataHealth, type HealthInput } from "./data-health";

const full: HealthInput = {
  documents: 157, invoices: 126, invoicesWithLines: 126, invoicesWithTaxDetail: 126,
  monthsWithInvoices: 5, monthsWithBank: 5,
  suppliersWithInvoices: 12, suppliersWithStatements: 12,
  unclassifiedBankTx: 0, bankTx: 1428,
};

const get = (h: ReturnType<typeof buildDataHealth>, id: string) =>
  h.metrics.find((m) => m.id === id)!;

describe("buildDataHealth", () => {
  it("البيانات الكاملة تعطي ثقة عالية", () => {
    const h = buildDataHealth(full);
    expect(h.confidence).toBeGreaterThan(0.95);
    expect(get(h, "lines").state).toBe("GOOD");
  });

  it("البنود الناقصة تخفض التغطية وتعلن بنسبتها", () => {
    const h = buildDataHealth({ ...full, invoicesWithLines: 48 });
    const m = get(h, "lines");
    expect(m.state).toBe("PARTIAL");
    expect(m.coverage).toBeCloseTo(48 / 126);
    expect(m.detail).toContain("38٪");
  });

  it("المبيعات غير موصولة — لا تملأ بصفر", () => {
    const m = get(buildDataHealth(full), "sales");
    expect(m.state).toBe("NOT_CONNECTED");
    expect(m.coverage).toBeNull();
  });

  it("غير الموصول لا يدخل حساب الثقة", () => {
    const h = buildDataHealth(full);
    expect(h.notConnected).toBe(2);
    // لو دخلت المبيعات والمخزون صفراً لهبطت الثقة كثيراً
    expect(h.confidence).toBeGreaterThan(0.9);
  });

  it("كل بند ناقص يحمل خطوة تصلحه", () => {
    const h = buildDataHealth({ ...full, invoicesWithLines: 10, invoicesWithTaxDetail: 10, unclassifiedBankTx: 40 });
    for (const m of h.metrics) {
      if (m.state === "PARTIAL" || m.state === "MISSING") expect(m.action, m.id).toBeTruthy();
    }
  });

  it("البند المكتمل لا يحمل خطوة", () => {
    const h = buildDataHealth(full);
    expect(get(h, "lines").action).toBeUndefined();
    expect(get(h, "bank").action).toBeUndefined();
  });

  it("قاعدة فارغة لا تكسر الحساب", () => {
    const h = buildDataHealth({
      documents: 0, invoices: 0, invoicesWithLines: 0, invoicesWithTaxDetail: 0,
      monthsWithInvoices: 0, monthsWithBank: 0, suppliersWithInvoices: 0,
      suppliersWithStatements: 0, unclassifiedBankTx: 0, bankTx: 0,
    });
    expect(Number.isFinite(h.confidence)).toBe(true);
    expect(get(h, "invoices").state).toBe("MISSING");
  });

  it("الحركات غير المصنّفة تعلن بعددها", () => {
    const m = get(buildDataHealth({ ...full, unclassifiedBankTx: 8 }), "bank-classified");
    expect(m.detail).toContain("8");
    expect(m.state).toBe("GOOD"); // ٨ من ١٤٢٨ تغطية عالية
  });
});

describe("المبيعات والمخزون من البيانات لا مكتوبةً بيد", () => {
  it("بلا مبيعات: «غير موصولة» لا صفر", () => {
    const h = buildDataHealth({ ...full, sales: { days: 0, firstDay: null, lastDay: null }, today: "2026-10-25" });
    expect(get(h, "sales")?.state).toBe("NOT_CONNECTED");
    expect(get(h, "sales")?.coverage).toBeNull();
  });

  it("فودكس موصول: الأيّامُ من أوّل يوم بيعٍ حتى أمس", () => {
    const h = buildDataHealth({ ...full, sales: { days: 169, firstDay: "2026-05-05", lastDay: "2026-10-25" }, today: "2026-10-25" });
    const m = get(h, "sales");
    expect(m?.state).toBe("GOOD");
    expect(m?.total).toBe(174);
    expect(m?.detail).toMatch(/169 من 174 يوماً/);
  });

  it("آخرُ مبيعاتٍ قبل أكثر من ثلاثة أيّام: ناقصة، وفعلُها المزامنة", () => {
    const m = get(buildDataHealth({ ...full, sales: { days: 100, firstDay: "2026-05-05", lastDay: "2026-10-10" }, today: "2026-10-25" }), "sales");
    expect(m?.state).toBe("PARTIAL");
    expect(m?.action).toMatch(/زامن فودكس/);
  });

  it("الجرد: آخرُه قريب «مكتمل»، وبعد أربعين يوماً «ناقص»", () => {
    expect(get(buildDataHealth({ ...full, inventory: { counts: 4, lastDay: "2026-10-17" }, today: "2026-10-25" }), "inventory")?.state).toBe("GOOD");
    expect(get(buildDataHealth({ ...full, inventory: { counts: 4, lastDay: "2026-08-01" }, today: "2026-10-25" }), "inventory")?.state).toBe("PARTIAL");
    expect(get(buildDataHealth({ ...full, inventory: { counts: 0, lastDay: null }, today: "2026-10-25" }), "inventory")?.state).toBe("NOT_CONNECTED");
  });
});
