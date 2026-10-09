import { describe, expect, it } from "vitest";
import {
  daysPastDue, dueDay, isValidSaudiIban, normalizeIban, normalizePhoneE164, pastDueOf, supplierProfileRequest, whatsappHref,
} from "./supplier-edit";

describe("الآيبان السعوديّ — mod-97", () => {
  it("آيبانٌ صحيح بفراغاته وحروفه الصغيرة وأرقامه العربيّة", () => {
    expect(isValidSaudiIban("SA03 8000 0000 6080 1016 7519")).toBe(true);
    expect(isValidSaudiIban("sa0380000000608010167519")).toBe(true);
    expect(normalizeIban("sa03 ٨٠٠٠ 0000 6080 1016 7519")).toBe("SA0380000000608010167519");
  });
  it("خانةٌ واحدة خاطئة أو خانتان مقلوبتان تُسقطانه", () => {
    expect(isValidSaudiIban("SA0380000000608010167518")).toBe(false);
    expect(isValidSaudiIban("SA0380000000608010165719")).toBe(false);
  });
  it("وما ليس سعوديّاً أو ناقصَ الطول ليس آيباناً لنا", () => {
    expect(isValidSaudiIban("SA038000000060801016751")).toBe(false);
    expect(isValidSaudiIban("GB82WEST12345698765432")).toBe(false);
    expect(isValidSaudiIban("")).toBe(false);
  });
});

describe("الهاتف E.164", () => {
  it("صيغُ الجوّال السعوديّ كلُّها رقمٌ واحد", () => {
    for (const v of ["0551234567", "551234567", "966551234567", "+966 55 123 4567", "00966551234567", "٠٥٥١٢٣٤٥٦٧"]) {
      expect(normalizePhoneE164(v)).toBe("+966551234567");
    }
  });
  it("وما لا يُفهم لا يُخمَّن", () => {
    expect(normalizePhoneE164("12345")).toBeNull();
    expect(normalizePhoneE164("هاتف")).toBeNull();
  });
  it("رابطُ واتساب على الرقم، وبلا رقمٍ شاشةُ الاختيار", () => {
    expect(whatsappHref("+966551234567", "سلام")).toBe(`https://wa.me/966551234567?text=${encodeURIComponent("سلام")}`);
    expect(whatsappHref(null, "x")).toBe("https://wa.me/?text=x");
  });
});

describe("الاستحقاق = يوم الفاتورة + الأجل", () => {
  it("يعبر الشهرَ والسنة", () => {
    expect(dueDay("2026-08-20", 30)).toBe("2026-09-19");
    expect(dueDay("2026-12-20", 45)).toBe("2027-02-03");
    expect(dueDay("2026-08-20", 0)).toBe("2026-08-20");
  });
  it("الأجلُ المجهول لا يُفترض — لا استحقاقَ ولا تأخّر", () => {
    expect(dueDay("2026-08-20", null)).toBeNull();
    expect(daysPastDue("2026-08-20", null, "2026-12-01")).toBeNull();
  });
  it("المتأخّرُ ما جاوز استحقاقَه لا ما جاوز ستّين يوماً", () => {
    expect(daysPastDue("2026-08-20", 0, "2026-08-25")).toBe(5);
    expect(daysPastDue("2026-08-20", 45, "2026-09-25")).toBe(-9);
  });
});

describe("طلبُ تعديل بيانات المورّد", () => {
  const ok = (o: object) => supplierProfileRequest.safeParse({ supplierId: "s1", ...o }).success;
  it("الفارغُ مقبول (يمحو)، والغائبُ لا يُمسّ", () => {
    expect(ok({})).toBe(true);
    expect(ok({ vatNumber: "", iban: "", phone: "", paymentTermsDays: "", balanceAlert: "" })).toBe(true);
  });
  it("يردّ ما لا يستقيم بجملته", () => {
    expect(ok({ vatNumber: "31000797160000" })).toBe(false);
    expect(ok({ iban: "SA0380000000608010167518" })).toBe(false);
    expect(ok({ paymentTermsDays: "400" })).toBe(false);
    expect(ok({ balanceAlert: "0" })).toBe(false);
    expect(ok({ phone: "123" })).toBe(false);
    expect(ok({ nameAr: "أ" })).toBe(false);
    expect(ok({ unknownField: 1 })).toBe(false);
  });
  it("ويقبل الصحيح", () => {
    expect(ok({ vatNumber: "310111111100003", iban: "SA03 8000 0000 6080 1016 7519", paymentTermsDays: "45", balanceAlert: "5000", phone: "0551234567", email: "a@b.sa", crNumber: "4030123456" })).toBe(true);
  });
});

describe("pastDueOf — المتأخّرُ بأجل المورّد", () => {
  const open = [
    { date: "2026-08-01", openMinor: 100_00 },
    { date: "2026-09-20", openMinor: 50_00 },
  ];
  it("نقديٌّ: كلُّ مفتوحٍ فات يومُه متأخّر", () => {
    expect(pastDueOf(open, 0, "2026-10-07")).toEqual({ count: 2, totalMinor: 150_00, oldestDays: 67 });
  });
  it("بأجل 45 يوماً: الأقدمُ وحده", () => {
    expect(pastDueOf(open, 45, "2026-10-07")).toEqual({ count: 1, totalMinor: 100_00, oldestDays: 22 });
  });
  it("والأجلُ المجهول لا يُحكم به — ولا صفرَ يُقرأ «لا متأخّر»", () => {
    expect(pastDueOf(open, null, "2026-10-07")).toBeNull();
  });
});
