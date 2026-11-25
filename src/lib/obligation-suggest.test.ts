import { describe, expect, it } from "vitest";
import { suggestObligations } from "./obligation-suggest";

const pays = [
  { day: "2026-06-30", amountMinor: 250_00, text: "Ministry of Municipal and Rural Affairs" },
  { day: "2026-06-30", amountMinor: 250_00, text: "Ministry of Municipal and Rural Affairs" },
  { day: "2026-11-09", amountMinor: 998_00, text: "Saudi Center For Economic  Business" },
  { day: "2026-11-09", amountMinor: 1020_00, text: "The General Organization for Social Insurance" },
];

describe("وثائق مقترحة من المدفوعات الحكوميّة", () => {
  it("البلديةُ والسجلُّ التجاريّ بعد سنةٍ من آخر سداد، والتأميناتُ ليست وثيقة", () => {
    expect(suggestObligations(pays, new Set())).toEqual([
      { kind: "MUNICIPAL_LICENCE", title: "رخصة البلدية", issuer: "وزارة الشؤون البلدية", paidOn: "2026-06-30", amountMinor: 500_00, expiresOn: "2027-06-30" },
      { kind: "COMMERCIAL_REGISTER", title: "السجل التجاري", issuer: "المركز السعودي للأعمال", paidOn: "2026-11-09", amountMinor: 998_00, expiresOn: "2027-11-09" },
    ]);
  });
  it("النوعُ الذي له وثيقةٌ قائمة لا يُقترح", () => {
    expect(suggestObligations(pays, new Set(["MUNICIPAL_LICENCE"])).map((s) => s.kind)).toEqual(["COMMERCIAL_REGISTER"]);
  });
});
