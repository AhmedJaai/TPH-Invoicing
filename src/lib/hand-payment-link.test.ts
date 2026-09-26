import { describe, expect, it } from "vitest";
import { linkHandPayments, linkKey } from "./hand-payment-link";

describe("linkHandPayments — الحوالةُ وسدادُها المقيَّد بيد", () => {
  it("مختبرات القهوة كما في الإنتاج: ٦٣٨ في يومها — مطابقٌ يُربط", () => {
    const out = linkHandPayments(
      [{ id: "t", supplierId: "labs", day: "2026-09-08", amountMinor: 638_00 }],
      [{ id: "p", supplierId: "labs", day: "2026-09-08", amountMinor: 638_00 }],
    );
    expect(out).toEqual([{
      transferId: "t", paymentId: "p", supplierId: "labs", transferMinor: 638_00, paymentMinor: 638_00,
      extraMinor: 0, daysApart: 0, exact: true,
    }]);
  });

  it("رونة: الحوالةُ ٤٦٢ والدفعةُ ٤٣٧ — اقتراحٌ بفرق ٢٥", () => {
    const [l] = linkHandPayments(
      [{ id: "t", supplierId: "rawnah", day: "2026-09-06", amountMinor: 462_00 }],
      [{ id: "p", supplierId: "rawnah", day: "2026-09-06", amountMinor: 437_00 }],
    );
    expect(l).toMatchObject({ exact: false, extraMinor: 25_00 });
  });

  it("لا ربط: الحوالةُ أقلّ من الدفعة، أو مورّدٌ آخر، أو أبعدُ من النافذة", () => {
    const t = { id: "t", supplierId: "s", day: "2026-09-06", amountMinor: 400_00 };
    expect(linkHandPayments([t], [{ id: "p", supplierId: "s", day: "2026-09-06", amountMinor: 437_00 }])).toEqual([]);
    expect(linkHandPayments([t], [{ id: "p", supplierId: "x", day: "2026-09-06", amountMinor: 400_00 }])).toEqual([]);
    expect(linkHandPayments([t], [{ id: "p", supplierId: "s", day: "2026-08-01", amountMinor: 400_00 }])).toEqual([]);
  });

  it("المطابقُ مبلغاً يسبق الأقربَ يوماً، وكلٌّ يُستعمل مرّة", () => {
    const out = linkHandPayments(
      [
        { id: "t1", supplierId: "s", day: "2026-09-10", amountMinor: 500_00 },
        { id: "t2", supplierId: "s", day: "2026-09-12", amountMinor: 520_00 },
      ],
      [
        { id: "near", supplierId: "s", day: "2026-09-10", amountMinor: 480_00 },
        { id: "same", supplierId: "s", day: "2026-09-04", amountMinor: 500_00 },
      ],
    );
    expect(out.map(linkKey).sort()).toEqual(["t1:same", "t2:near"]);
  });
});
