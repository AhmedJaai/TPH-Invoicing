import { describe, expect, it } from "vitest";
import {
  dayForOut, distanceMeters, earlyMinutesAt, isWorkday, judgeCheckin, lateMinutesAt, riyadhClock, riyadhDay, toMicro, workedMinutes,
} from "./attendance";

const cafe = { latMicro: toMicro(21.6136), lngMicro: toMicro(39.1567), radiusM: 120 };

describe("الموقع والشبكة", () => {
  it("المسافة بالأمتار", () => {
    expect(distanceMeters(cafe.latMicro, cafe.lngMicro, cafe.latMicro + 1_000, cafe.lngMicro)).toBe(111);
  });
  it("داخل النطاق مع هامش الدقّة", () => {
    expect(judgeCheckin({ place: cafe, position: { latMicro: cafe.latMicro + 1_500, lngMicro: cafe.lngMicro, accuracyM: 60 }, onNetwork: false }).verdict).toBe("IN_PLACE");
  });
  it("بعيدٌ لكنّه على شبكة المقهى", () => {
    expect(judgeCheckin({ place: cafe, position: { latMicro: cafe.latMicro + 50_000, lngMicro: cafe.lngMicro, accuracyM: 20 }, onNetwork: true }).verdict).toBe("ON_NETWORK");
  });
  it("بعيدٌ بلا شبكة، وبلا موقع", () => {
    expect(judgeCheckin({ place: cafe, position: { latMicro: cafe.latMicro + 50_000, lngMicro: cafe.lngMicro, accuracyM: 5_000 }, onNetwork: false }).verdict).toBe("FAR");
    expect(judgeCheckin({ place: cafe, position: null, onNetwork: false }).verdict).toBe("NO_LOCATION");
    expect(judgeCheckin({ place: null, position: { latMicro: 1, lngMicro: 1, accuracyM: 5 }, onNetwork: false }).verdict).toBe("FAR");
  });
});

describe("الوقت بتوقيت الرياض", () => {
  const at = (iso: string) => new Date(iso);
  it("يوم الرياض وساعته", () => {
    expect(riyadhDay(at("2026-10-22T22:30:00Z"))).toBe("2026-10-23");
    expect(riyadhClock(at("2026-10-23T13:05:00Z"))).toBe("16:05");
  });
  it("التأخير عن بداية الدوام", () => {
    expect(lateMinutesAt(at("2026-10-23T13:17:00Z"), "2026-10-23", "16:00")).toBe(17);
    expect(lateMinutesAt(at("2026-10-23T12:50:00Z"), "2026-10-23", "16:00")).toBe(0);
  });
  it("الانصراف المبكّر، ودوامٌ يعبر منتصف الليل", () => {
    expect(earlyMinutesAt(at("2026-10-23T20:30:00Z"), "2026-10-23", "16:00", 480)).toBe(30);
    expect(dayForOut(at("2026-10-23T21:10:00Z"), { at: at("2026-10-23T13:00:00Z"), day: "2026-10-23" })).toBe("2026-10-23");
    expect(dayForOut(at("2026-10-25T21:10:00Z"), { at: at("2026-10-23T13:00:00Z"), day: "2026-10-23" })).toBe("2026-10-26");
  });
  it("يوم الراحة", () => {
    expect(isWorkday("2026-10-23", "5")).toBe(false);
    expect(isWorkday("2026-10-24", "5")).toBe(true);
  });
  it("ساعات الجزئي من أزواج الحضور", () => {
    const r = workedMinutes([
      { kind: "IN", at: at("2026-10-20T13:00:00Z") }, { kind: "OUT", at: at("2026-10-20T17:30:00Z") },
      { kind: "IN", at: at("2026-10-21T13:00:00Z") },
      { kind: "IN", at: at("2026-10-22T13:00:00Z"), rejected: true }, { kind: "OUT", at: at("2026-10-22T15:00:00Z"), rejected: true },
    ]);
    expect(r).toEqual({ minutes: 270, open: 1 });
  });
});
