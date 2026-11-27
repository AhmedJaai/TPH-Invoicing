import { describe, expect, it } from "vitest";
import { whatsappNumber } from "./whatsapp";

describe("رقمُ واتساب", () => {
  it("الصيغُ السعوديّة كلُّها", () => {
    expect(whatsappNumber("0551234567")).toBe("966551234567");
    expect(whatsappNumber("٠٥٥١٢٣٤٥٦٧")).toBe("966551234567");
    expect(whatsappNumber("+966 55 123 4567")).toBe("966551234567");
    expect(whatsappNumber("00966551234567")).toBe("966551234567");
    expect(whatsappNumber("551234567")).toBe("966551234567");
  });
  it("غيرُ المفهوم لا يُفتح عليه", () => {
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
  it("رقمٌ دوليٌّ بمفتاحه", () => {
    expect(whatsappNumber("+20 100 123 4567")).toBe("201001234567");
  });
});
