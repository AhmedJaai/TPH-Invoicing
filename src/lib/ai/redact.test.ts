import { describe, expect, it } from "vitest";
import { createRedactor } from "./redact";

const IBAN_A = "SA4420000001234567891234";
const IBAN_B = "SA0380000000608010167519";

describe("تنقيح بيانات الأفراد قبل النموذج", () => {
  it("الآيبان لا يغادر، ويعود في الجواب كما كان", () => {
    const r = createRedactor();
    const sent = r.redact(`حوالة إلى ${IBAN_A} باسم محمد`);
    expect(sent).not.toContain(IBAN_A);
    expect(sent).toContain("⟦IBAN_1⟧");
    expect(r.restore("المستفيد ⟦IBAN_1⟧ طابق")).toBe(`المستفيد ${IBAN_A} طابق`);
  });

  it("الآيبانُ نفسُه رمزٌ واحد ولو كُتب بفواصل — فتبقى المساواةُ دليلاً", () => {
    const r = createRedactor();
    const spaced = "SA44 2000 0001 2345 6789 1234";
    const sent = r.redact(`الحركة: ${IBAN_A}\nالمرشّح: ${spaced}\nآخر: ${IBAN_B}`);
    expect(sent).toBe("الحركة: ⟦IBAN_1⟧\nالمرشّح: ⟦IBAN_1⟧\nآخر: ⟦IBAN_2⟧");
    expect(r.count).toBe(2);
    expect(r.restore("⟦IBAN_2⟧")).toBe(IBAN_B);
  });

  it("الجوّال بصيغته الدوليّة يُنقَّح", () => {
    const r = createRedactor();
    const sent = r.redact("للتواصل +966 55 123 4567 أو 00966551234567");
    expect(sent).toBe("للتواصل ⟦MOBILE_1⟧ أو ⟦MOBILE_1⟧");
    expect(r.restore("⟦MOBILE_1⟧")).toBe("+966 55 123 4567");
  });

  it("رقمُ الفاتورة والرقمُ الضريبيّ والمبلغ لا تُمسّ — تُنسَخ حرفاً", () => {
    const r = createRedactor();
    const text = "فاتورة 0551234567 · الرقم الضريبي 310007971600003 · INV-2026-00123 · 1,250.00 · 1012345678";
    expect(r.redact(text)).toBe(text);
    expect(r.count).toBe(0);
  });

  it("رمزٌ أسقط النموذجُ قوسَيه يُعاد، ورمزٌ لم نكتبه يبقى كما هو", () => {
    const r = createRedactor();
    r.redact(IBAN_A);
    expect(r.restore("الحساب IBAN_1 صحيح")).toBe(`الحساب ${IBAN_A} صحيح`);
    expect(r.restore("⟦IBAN_7⟧")).toBe("⟦IBAN_7⟧");
  });

  it("بلا ما يُنقَّح: النصُّ كما هو ذهاباً وإياباً", () => {
    const r = createRedactor();
    expect(r.redact("فاتورة قهوة")).toBe("فاتورة قهوة");
    expect(r.restore("IBAN_1 نصٌّ من المستند")).toBe("IBAN_1 نصٌّ من المستند");
  });
});
