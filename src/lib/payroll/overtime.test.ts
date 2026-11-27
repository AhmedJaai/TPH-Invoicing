import { describe, expect, it } from "vitest";
import type { DayShift } from "./attendance";
import { measureOvertime, overtimeHourMinor, overtimeMinor, type OvertimeCheckin } from "./overtime";

/* لحظةٌ بتوقيت الرياض (UTC+3) */
const at = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00+03:00`));
const morning: DayShift = { off: false, start: "07:00", minutes: 540, source: "BASE" };
const evening: DayShift = { off: false, start: "18:00", minutes: 540, source: "BASE" };

function run(checkins: OvertimeCheckin[], shift: (d: string) => DayShift = () => morning) {
  return measureOvertime({ checkins, shiftFor: shift, fromDay: "2026-10-27", toDay: "2026-11-26" });
}

describe("العمل الإضافيّ من التسجيل", () => {
  it("ما بعد نهاية الدوام — صالح ٢٤ نوفمبر: ٧:٣٩ إلى ١٨:٢٠ ودوامه ٧–١٦", () => {
    const [d] = run([
      { kind: "IN", at: at("2026-11-24", "07:39"), day: "2026-11-24" },
      { kind: "OUT", at: at("2026-11-24", "18:20"), day: "2026-11-24" },
    ]);
    /* لا مقاصّة بالتأخير: ١٤٠ دقيقة بعد الرابعة ولو تأخّر ٣٩ */
    expect(d).toMatchObject({ day: "2026-11-24", minutes: 140, status: "SUGGESTED", restDay: false });
  });

  it("الحضورُ المبكّر لا يُعدّ، وأقلُّ من ربع ساعة يُعدّ ولا يُقترح", () => {
    const [d] = run([
      { kind: "IN", at: at("2026-11-22", "06:30"), day: "2026-11-22" },
      { kind: "OUT", at: at("2026-11-22", "16:13"), day: "2026-11-22" },
    ]);
    expect(d).toMatchObject({ minutes: 13, status: "BELOW_MIN" });
  });

  it("الانصرافُ بعد منتصف الليل لدوام أمسه", () => {
    const [d] = run([
      { kind: "IN", at: at("2026-11-19", "18:05"), day: "2026-11-19" },
      { kind: "OUT", at: at("2026-11-20", "03:40"), day: "2026-11-19" },
    ], () => evening);
    expect(d).toMatchObject({ day: "2026-11-19", minutes: 40, status: "SUGGESTED" });
  });

  it("يومٌ بلا انصراف لا يُقاس، وانصرافٌ قبل النهاية لا يُعدّ", () => {
    expect(run([{ kind: "IN", at: at("2026-11-18", "07:00"), day: "2026-11-18" }])).toEqual([]);
    expect(run([
      { kind: "IN", at: at("2026-11-18", "07:00"), day: "2026-11-18" },
      { kind: "OUT", at: at("2026-11-18", "15:00"), day: "2026-11-18" },
    ])).toEqual([]);
  });

  it("التسجيلُ الناقص مشكوك — ١٤٦٨ دقيقة ليست عملاً", () => {
    const [d] = run([
      { kind: "IN", at: at("2026-11-08", "00:32"), day: "2026-11-08" },
      { kind: "OUT", at: at("2026-11-09", "01:00"), day: "2026-11-08" },
    ]);
    expect(d.status).toBe("SUSPECT");
  });

  it("انصرافٌ بلا حضورٍ في يومه مشكوك", () => {
    const [d] = run([{ kind: "OUT", at: at("2026-11-08", "17:00"), day: "2026-11-08" }]);
    expect(d).toMatchObject({ minutes: 60, status: "SUSPECT" });
  });

  it("يومُ الراحة يُعدّ كلُّه، والمردودُ وما خارج الفترة يُترك", () => {
    const days = run([
      { kind: "IN", at: at("2026-11-13", "10:00"), day: "2026-11-13" },
      { kind: "OUT", at: at("2026-11-13", "14:30"), day: "2026-11-13" },
      { kind: "IN", at: at("2026-11-14", "07:00"), day: "2026-11-14", rejected: true },
      { kind: "OUT", at: at("2026-11-14", "20:00"), day: "2026-11-14", rejected: true },
      { kind: "IN", at: at("2026-11-27", "07:00"), day: "2026-11-27" },
      { kind: "OUT", at: at("2026-11-27", "20:00"), day: "2026-11-27" },
    ], (d) => (d === "2026-11-13" ? { off: true } : morning));
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ day: "2026-11-13", restDay: true, minutes: 270, status: "SUGGESTED" });
  });

  it("بلا وقت دوامٍ لا يُقاس", () => {
    expect(run([
      { kind: "IN", at: at("2026-11-18", "07:00"), day: "2026-11-18" },
      { kind: "OUT", at: at("2026-11-18", "23:00"), day: "2026-11-18" },
    ], () => ({ off: false, start: null, minutes: 480, source: "BASE" }))).toEqual([]);
  });
});

describe("أجر العمل الإضافيّ (م ١٠٧)", () => {
  it("أجرُ الساعة ونصفُه: ٣٬٥٠٠ بدوام تسع ساعات ← الساعة ١٢٫٩٦ والإضافيّة ١٩٫٤٤", () => {
    expect(overtimeHourMinor(350_000, 540)).toBe(1944);
    /* ١٤٠ دقيقة = ٤٥٫٣٧ — بقسمةٍ واحدة لا بضرب أجر الساعة المقرَّب */
    expect(overtimeMinor(350_000, 540, 140)).toBe(4537);
  });
  it("قسمةٌ واحدة في الآخر", () => {
    expect(overtimeMinor(280_000, 360, 1)).toBe(39); // ٢٨٠٠٠٠×٣ ÷ (٣٠×٣٦٠×٢) = ٣٨٫٩
  });
});
