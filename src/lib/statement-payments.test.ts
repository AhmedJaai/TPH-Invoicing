import { describe, expect, it } from "vitest";
import { compareSettlements, type OurSettlement, type StatementCreditLine } from "./statement-payments";

const PERIOD = { from: "2026-08-01", to: "2026-10-31" };
const line = (day: string, amountMinor: number, description: string | null = "حوالة بنكية", ref: string | null = null): StatementCreditLine =>
  ({ day, amountMinor, description, ref });
const ours = (paymentId: string, day: string, amountMinor: number, over: Partial<OurSettlement> = {}): OurSettlement =>
  ({ paymentId, day, amountMinor, feeMinor: 0, isCreditNote: false, method: "BANK_TRANSFER", ...over });

describe("سداد الكشف مقابل دفعاتنا", () => {
  it("حوالةٌ قيّدها المورّد بعد يومين تقابل دفعتنا", () => {
    const r = compareSettlements([line("2026-09-17", 69_000)], [ours("p1", "2026-09-15", 69_000)], PERIOD);
    expect(r.matched.map((m) => m.ours.map((o) => o.paymentId))).toEqual([["p1"]]);
    expect(r.oursOnly).toEqual([]);
    expect(r.theirsOnly).toEqual([]);
  });

  it("المورّد يقيّد ما وصله بعد رسوم التحويل", () => {
    const r = compareSettlements([line("2026-09-15", 95_975)], [ours("p1", "2026-09-15", 96_550, { feeMinor: 575 })], PERIOD);
    expect(r.matched).toHaveLength(1);
  });

  it("المورّد يقسم حوالتنا على فواتيره: بيكوف ٩٠٠ = ١٥٠ + ٧٥٠ في كشفه", () => {
    const r = compareSettlements(
      [line("2026-08-26", 15_000, "عملية الدفع 000285"), line("2026-08-26", 75_000, "عملية الدفع")],
      [ours("p1", "2026-08-25", 90_000)],
      PERIOD,
    );
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].lines.map((l) => l.amountMinor)).toEqual([15_000, 75_000]);
    expect(r.theirsOnly).toEqual([]);
    expect(r.oursOnly).toEqual([]);
  });

  it("سطرٌ واحد يجمع حوالتين", () => {
    const r = compareSettlements([line("2026-09-20", 100_000)], [ours("a", "2026-09-18", 40_000), ours("b", "2026-09-19", 60_000)], PERIOD);
    expect(r.matched.map((m) => m.ours.map((o) => o.paymentId))).toEqual([["a", "b"]]);
  });

  it("مجموعتان توافقان المبلغ: التباسٌ يُترك للإنسان ولا يُحسم بالترتيب", () => {
    const r = compareSettlements(
      [line("2026-09-20", 30_000), line("2026-09-20", 70_000), line("2026-09-21", 40_000), line("2026-09-21", 60_000)],
      [ours("p", "2026-09-19", 100_000)],
      PERIOD,
    );
    expect(r.matched).toEqual([]);
  });

  it("كشفٌ لا سطرَ سدادٍ فيه لا يُسأل عن حوالاتنا", () => {
    const r = compareSettlements([], [ours("p", "2026-10-02", 512_992)], { from: "2026-10-01", to: "2026-10-31" });
    expect(r.listsPayments).toBe(false);
    expect(r.oursOnly).toEqual([]);
  });

  it("دفعناها ولم يقيّدها: تُسأل — هي المالُ الذي يُطالَب به مرّتين", () => {
    const r = compareSettlements([line("2026-09-17", 69_000)], [ours("p1", "2026-09-15", 69_000), ours("p2", "2026-10-02", 68_000)], PERIOD);
    expect(r.oursOnly.map((o) => o.paymentId)).toEqual(["p2"]);
  });

  it("في كشفه سدادٌ لا نعرفه", () => {
    const r = compareSettlements([line("2026-09-17", 69_000), line("2026-10-20", 12_000, "سداد")], [ours("p1", "2026-09-15", 69_000)], PERIOD);
    expect(r.theirsOnly.map((t) => [t.line.amountMinor, t.kind])).toEqual([[12_000, "PAYMENT"]]);
  });

  it("سدادُ آخر الأسبوع قد يكون في الطريق — لا يُقال «لم يقيّده»", () => {
    const r = compareSettlements([line("2026-08-10", 9_000)], [ours("late", "2026-10-28", 50_000), ours("early", "2026-10-20", 50_000)], PERIOD);
    expect(r.inTransit.map((o) => o.paymentId)).toEqual(["late"]);
    expect(r.oursOnly.map((o) => o.paymentId)).toEqual(["early"]);
  });

  it("ما دفعناه خارج مدّة الكشف لا يُسأل عنه", () => {
    const r = compareSettlements([], [ours("before", "2026-07-20", 50_000), ours("after", "2026-11-03", 50_000)], PERIOD);
    expect(r.oursOnly).toEqual([]);
    expect(r.inTransit).toEqual([]);
  });

  it("الحوالةُ قبل أوّل الكشف بأيّام يقابلها سطرُه الأوّل", () => {
    const r = compareSettlements([line("2026-08-02", 30_000)], [ours("p0", "2026-07-30", 30_000)], PERIOD);
    expect(r.matched).toHaveLength(1);
    expect(r.theirsOnly).toEqual([]);
  });

  it("الإشعارُ يقابل إشعاراً لا سداداً", () => {
    const r = compareSettlements(
      [line("2026-09-10", 20_000, "إشعار دائن مرتجع")],
      [ours("pay", "2026-09-10", 20_000), ours("cn", "2026-09-11", 20_000, { isCreditNote: true, method: "CREDIT_NOTE" })],
      PERIOD,
    );
    expect(r.matched.map((m) => [m.ours[0].paymentId, m.kind])).toEqual([["cn", "CREDIT_NOTE"]]);
    /* كشفٌ فيه إشعارٌ ولا سطرَ سدادٍ فيه لا يُسأل عن الحوالة */
    expect(r.listsPayments).toBe(false);
    expect(r.oursOnly).toEqual([]);
  });

  it("إشعارٌ قيّدناه آخرَ الكشف ولم يرد فيه يُسأل عنه — لا «طريق» له", () => {
    const r = compareSettlements([line("2026-08-10", 9_000, "إشعار دائن")], [ours("cn", "2026-10-30", 20_000, { isCreditNote: true })], PERIOD);
    expect(r.oursOnly.map((o) => o.paymentId)).toEqual(["cn"]);
  });

  it("واحدةٌ بواحدة: حوالتان بالمبلغ نفسه وسطرٌ واحد — الأقربُ يوماً تأخذه", () => {
    const r = compareSettlements([line("2026-09-20", 24_000)], [ours("a", "2026-09-14", 24_000), ours("b", "2026-09-19", 24_000)], PERIOD);
    expect(r.matched.map((m) => m.ours[0].paymentId)).toEqual(["b"]);
    expect(r.oursOnly.map((o) => o.paymentId)).toEqual(["a"]);
  });

  it("النتيجة لا تتغيّر بترتيب الصفوف", () => {
    const L = [line("2026-09-20", 24_000), line("2026-09-21", 24_000), line("2026-10-01", 5_000, "سداد")];
    const O = [ours("a", "2026-09-14", 24_000), ours("b", "2026-09-19", 24_000), ours("c", "2026-09-20", 24_000)];
    expect(compareSettlements([...L].reverse(), [...O].reverse(), PERIOD)).toEqual(compareSettlements(L, O, PERIOD));
  });

  it("فرقٌ فوق الريال ليس الحوالة نفسها", () => {
    const r = compareSettlements([line("2026-09-15", 69_000)], [ours("p1", "2026-09-15", 69_101)], PERIOD);
    expect(r.matched).toEqual([]);
  });
});
