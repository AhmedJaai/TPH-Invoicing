import { describe, expect, it } from "vitest";
import { MIN_ACCOUNT_DIGITS, normalizeAccountNumber } from "./bank-account.service";

describe("توحيد رقم الحساب", () => {
  it("الفراغات والشرَط عرضٌ لا معنى", () => {
    expect(normalizeAccountNumber("1260 0000 9420 05")).toBe("12600000942005");
    expect(normalizeAccountNumber("126-0000-0942005")).toBe("12600000942005");
  });

  it("الصيغتان لحسابٍ واحد تلتقيان", () => {
    expect(normalizeAccountNumber("SA03 8000 0000 6080 1016 7519"))
      .toBe(normalizeAccountNumber("sa0380000000608010167519"));
  });

  it("الرقم المحجوب يُقاس بما بقي منه", () => {
    expect(normalizeAccountNumber("****2005")).toBe("2005");
    expect(normalizeAccountNumber("****")).toBeNull();
    expect(normalizeAccountNumber("**5")).toBeNull();
  });

  it("المجهول يبقى مجهولاً — لا يُخترَع له حساب", () => {
    expect(normalizeAccountNumber(null)).toBeNull();
    expect(normalizeAccountNumber("")).toBeNull();
    expect(normalizeAccountNumber("  ")).toBeNull();
  });

  it("أقلّ من أربع خانات لا يميّز حساباً", () => {
    expect(MIN_ACCOUNT_DIGITS).toBe(4);
    expect(normalizeAccountNumber("123")).toBeNull();
    expect(normalizeAccountNumber("1234")).toBe("1234");
  });
});
