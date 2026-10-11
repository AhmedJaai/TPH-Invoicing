import { describe, expect, it } from "vitest";
import { compareCardTakings, summariseCash, type BankBatchDay, type CardPayment } from "./takings";

/** لحظةٌ بتوقيت الرياض. */
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+03:00`);
const pay = (day: string, time: string, amountMinor: number): CardPayment => ({ atMs: at(day, time), amountMinor });
const batch = (day: string, settlementMinor: number, byValueDate = false): BankBatchDay => ({ day, settlementMinor, byValueDate });

describe("بطاقاتُ فودكس أمام دفعات البنك", () => {
  it("إقفالٌ آليٌّ عند منتصف الليل: دفعةُ اليوم تحمل بطاقاتِ اليوم الذي قبله", () => {
    const r = compareCardTakings(
      [pay("2026-06-12", "18:00", 500_000), pay("2026-06-12", "23:50", 302_700), pay("2026-06-13", "00:10", 40_000)],
      [batch("2026-06-13", 802_700)],
      "2026-06-30",
    );
    expect(r.batches[0]).toMatchObject({ day: "2026-06-13", foodicsMinor: 802_700, gapMinor: 0, verdict: "AGREES", payments: 2 });
    expect(r.unsettled).toMatchObject({ foodicsMinor: 40_000, payments: 1 });
  });

  it("إقفالٌ بيدٍ يتغيّر كلَّ ليلة: الحدُّ يُبحَث عنه ولا يُفترَض", () => {
    const r = compareCardTakings(
      [
        pay("2026-09-22", "21:00", 100_000), pay("2026-09-23", "01:40", 30_000),
        /* أُقفلت الأولى ٢:١٠ فجراً، والثانية ٣:٠٥ */
        pay("2026-09-23", "02:30", 20_000), pay("2026-09-23", "22:00", 90_000), pay("2026-09-24", "02:50", 15_000),
        pay("2026-09-24", "03:20", 7_000),
      ],
      [batch("2026-09-23", 130_000), batch("2026-09-24", 125_000)],
      "2026-10-09",
    );
    const by = new Map(r.batches.map((b) => [b.day, b]));
    expect(by.get("2026-09-23")).toMatchObject({ gapMinor: 0, verdict: "AGREES", payments: 2 });
    expect(by.get("2026-09-24")).toMatchObject({ gapMinor: 0, verdict: "AGREES", payments: 3 });
    expect(r.unsettled?.foodicsMinor).toBe(7_000);
  });

  it("ما لا موضعَ يساويه فالباقي فرقُ تلك الدفعة — ولا يُعدي جارتَها", () => {
    const r = compareCardTakings(
      [pay("2026-06-12", "20:00", 100_000), pay("2026-06-13", "20:00", 100_000), pay("2026-06-14", "20:00", 100_000)],
      /* دفعةُ الرابع عشر نقصت ٤٠٠ ريال */
      [batch("2026-06-13", 100_000), batch("2026-06-14", 60_000), batch("2026-06-15", 100_000)],
      "2026-06-30",
    );
    const by = new Map(r.batches.map((b) => [b.day, b]));
    expect(by.get("2026-06-13")?.verdict).toBe("AGREES");
    expect(by.get("2026-06-14")).toMatchObject({ gapMinor: 40_000, verdict: "BANK_SHORT" });
    expect(by.get("2026-06-15")?.verdict).toBe("AGREES");
    expect(r.months[0]).toMatchObject({ month: "2026-06", comparedBatches: 3, exactBatches: 2, gapMinor: 40_000, notable: true });
  });

  it("وصل البنكَ أكثر ممّا سجّله فودكس بطاقةً ← يُقال باتّجاهه", () => {
    const r = compareCardTakings([pay("2026-06-12", "20:00", 100_000)], [batch("2026-06-13", 130_000)], "2026-06-30");
    expect(r.batches[0]).toMatchObject({ gapMinor: -30_000, verdict: "BANK_OVER" });
  });

  it("ليلةٌ لم يُقفَل فيها الجهاز: الدفعةُ التالية تحمل اليومين", () => {
    const r = compareCardTakings(
      [pay("2026-06-11", "20:00", 50_000), pay("2026-06-12", "20:00", 100_000), pay("2026-06-13", "20:00", 70_000)],
      [batch("2026-06-12", 50_000), batch("2026-06-14", 170_000)],
      "2026-06-30",
    );
    expect(r.batches[0]).toMatchObject({ day: "2026-06-14", gapMinor: 0, payments: 2 });
  });

  it("المردودُ على البطاقة يُنقص مقطعَه", () => {
    const r = compareCardTakings(
      [pay("2026-06-12", "20:00", 100_000), pay("2026-06-12", "21:00", -9_400)],
      [batch("2026-06-13", 90_600)],
      "2026-06-30",
    );
    expect(r.batches[0].verdict).toBe("AGREES");
  });

  it("دفعاتُ الأيّام الأخيرة قد لا تكتمل — لا حكمَ ولا تدخل فرقَ الشهر", () => {
    const r = compareCardTakings([pay("2026-06-12", "20:00", 100_000)], [batch("2026-06-13", 80_000)], "2026-06-14");
    expect(r.batches[0].verdict).toBe("RECENT");
    expect(r.months).toEqual([]);
  });

  it("فرقٌ صغير يُعرَض ولا يُسمّى نقصاً", () => {
    const r = compareCardTakings([pay("2026-06-12", "20:00", 100_000)], [batch("2026-06-13", 98_100)], "2026-06-30");
    expect(r.batches[0].verdict).toBe("SMALL_GAP");
  });

  it("ما بِيع قبل أن يبدأ الكشف لا يُحمَّل على أوّل دفعة", () => {
    const r = compareCardTakings(
      [pay("2026-05-05", "20:00", 999_000), pay("2026-06-12", "20:00", 100_000)],
      [batch("2026-06-13", 100_000)],
      "2026-06-30",
    );
    expect(r.batches[0]).toMatchObject({ gapMinor: 0, payments: 1 });
  });

  it("دفعاتٌ قبل أوّل ما قُرئ من فودكس أو بعد آخره: مجهولةٌ لا «فودكس صفر»", () => {
    const r = compareCardTakings(
      [pay("2026-08-20", "20:00", 100_000)],
      [batch("2026-08-10", 400_000), batch("2026-08-21", 100_000), batch("2026-09-15", 300_000)],
      "2026-09-30",
      at("2026-08-22", "09:00"),
    );
    expect(r.batches.map((b) => b.day)).toEqual(["2026-08-21"]);
    expect(r.months[0]).toMatchObject({ comparedBatches: 1, gapMinor: 0 });
  });

  it("النتيجةُ لا تتغيّر بترتيب المدخلات", () => {
    const ps = [pay("2026-06-12", "20:00", 100_000), pay("2026-06-13", "20:00", 70_000)];
    const bs = [batch("2026-06-13", 100_000), batch("2026-06-14", 70_000)];
    expect(compareCardTakings([...ps].reverse(), [...bs].reverse(), "2026-06-30")).toEqual(compareCardTakings(ps, bs, "2026-06-30"));
  });

  it("فودكس لم يُقرأ بعد ← لا صفوف، لا أصفار", () => {
    expect(compareCardTakings([], [batch("2026-06-13", 1)], "2026-06-20")).toEqual({ batches: [], months: [], unsettled: null });
  });
});

describe("النقدُ شهراً بشهر", () => {
  it("ما قُبض نقداً ولا أثرَ لإيداعه، وما كُتب للإقرار بجانبه", () => {
    const [m] = summariseCash([{ month: "2026-06", cashMinor: 537_019, staffDrinksMinor: 307_500, otherMinor: 0, tillVarianceMinor: -300, bankOtherCreditsMinor: 0, typedForVatMinor: 500_000 }]);
    expect(m.notBankedMinor).toBe(537_019);
    expect(m.vatTypedGapMinor).toBe(37_019);
  });
  it("ما لم يُكتب للإقرار «غير معروف» لا صفر", () => {
    const [m] = summariseCash([{ month: "2026-06", cashMinor: 10, staffDrinksMinor: 0, otherMinor: 0, tillVarianceMinor: null, bankOtherCreditsMinor: 0, typedForVatMinor: null }]);
    expect(m.vatTypedGapMinor).toBeNull();
  });
});
