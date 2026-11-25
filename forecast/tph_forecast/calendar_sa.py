"""التقويم السعودي كما يراه مقهى في جدّة: الهجريّ، والإجازات الرسمية، والمدارس، والرواتب.

كلُّ تاريخٍ هنا له مصدرٌ مكتوب بجانبه. وما لم تُعلنه جهتُه بعد يُعلَّم «تقديريّ»
(`estimated`)، فتقول الصفحةُ إنّه تقدير ويستطيع أحمد تصحيحه من «أحداث» التنبّؤ.

الهجريُّ بتقويم أمّ القرى (`hijridate`). والرؤيةُ الفعليّة قد تخالفه بيوم — فأوّلُ رمضان
والعيدُ يُقرآن «حول» تاريخهما لا عليه بالضبط (`eid_window`).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from hijridate import Gregorian, Hijri


def _d(s: str) -> date:
    return date.fromisoformat(s)


def _range(a: str, b: str) -> set[date]:
    x, y = _d(a), _d(b)
    return {x + timedelta(days=i) for i in range((y - x).days + 1)}


# ─── المدارس الحكومية (وزارة التعليم) ───
# ٢٠٢٥–٢٠٢٦ (١٤٤٧): فصلان. الصيفُ من ٢٦ يونيو ٢٠٢٦ حتى ٢٢ أغسطس ٢٠٢٦.
#   whichschooladvisor.com · timeoutriyadh.com (saudi-academic-calendar-2025-26)
# ٢٠٢٦–٢٠٢٧ (١٤٤٨): البدءُ ٢٣ أغسطس ٢٠٢٦، إجازةُ الخريف ٢٠–٢٨ نوفمبر، نهايةُ الفصل الأوّل
#   ٧ يناير ٢٠٢٧، إجازةُ منتصف العام ٨–١٦ يناير. (egypttelegraph · edu-forms · calculatorvip)
SCHOOL_BREAKS: list[tuple[str, str, str, bool]] = [
    # (من, إلى, الاسم, تقديريّ)
    ("2026-05-22", "2026-06-01", "إجازة عيد الأضحى المدرسية", False),
    ("2026-06-26", "2026-08-22", "الإجازة الصيفية", False),
    ("2026-11-20", "2026-11-28", "إجازة الخريف", False),
    ("2027-01-08", "2027-01-16", "إجازة منتصف العام", False),
    # بالقياس على ١٤٤٧ (١٧ رمضان → ٩ شوال) — لم تُعلَن بعد
    ("2027-02-25", "2027-03-18", "إجازة عيد الفطر المدرسية", True),
    ("2027-05-13", "2027-05-22", "إجازة عيد الأضحى المدرسية", True),
    ("2027-06-18", "2027-08-21", "الإجازة الصيفية", True),
]

# أيّامٌ رسمية ثابتة بالميلاديّ (نظام العمل): اليوم الوطني ٢٣ سبتمبر، يوم التأسيس ٢٢ فبراير
FIXED_HOLIDAYS = {(9, 23): "اليوم الوطني", (2, 22): "يوم التأسيس"}


@dataclass(frozen=True)
class DayInfo:
    day: date
    dow: int  # 0 الاثنين … 6 الأحد (بايثون)
    hijri_month: int
    hijri_day: int
    ramadan: bool
    ramadan_day: int  # 0 خارجه
    ramadan_last10: bool
    eid_fitr: bool
    eid_adha: bool
    arafah: bool
    eid_window: bool  # العيدُ ويومٌ قبله ويومان بعده — الرؤيةُ قد تزيح يوماً
    public_holiday: str | None
    holiday_eve: bool
    school_break: str | None
    school_estimated: bool
    days_from_payday: int  # منذ راتب الحكومة (٢٧ أو الخميسُ قبله)
    days_to_payday: int
    citizen_account: bool  # حساب المواطن ~ يوم ١٠
    month_end: bool
    weekend: bool  # الجمعة والسبت
    weekend_eve: bool  # الخميس


def payday_of(year: int, month: int) -> date:
    """راتبُ الحكومة يومَ ٢٧؛ فإن وقع جمعةً أو سبتاً صُرف الخميسَ قبله."""
    d = date(year, month, 27)
    while d.weekday() in (4, 5):  # الجمعة · السبت
        d -= timedelta(days=1)
    return d


def _paydays_around(d: date) -> tuple[date, date]:
    this = payday_of(d.year, d.month)
    if d >= this:
        nxt = payday_of(d.year + (d.month == 12), d.month % 12 + 1)
        return this, nxt
    prev = payday_of(d.year - (d.month == 1), (d.month - 2) % 12 + 1)
    return prev, this


def _hijri(d: date) -> Hijri:
    return Gregorian(d.year, d.month, d.day).to_hijri()


def _is_eid(h: Hijri) -> tuple[bool, bool, bool]:
    fitr = h.month == 10 and h.day <= 4
    adha = h.month == 12 and 10 <= h.day <= 13
    arafah = h.month == 12 and h.day == 9
    return fitr, adha, arafah


def day_info(d: date) -> DayInfo:
    h = _hijri(d)
    fitr, adha, arafah = _is_eid(h)
    window = False
    for k in (-1, 0, 1, 2):
        hk = _hijri(d - timedelta(days=k))
        f, a, _ = _is_eid(hk)
        if (f and hk.day == 1) or (a and hk.day == 10):
            window = True
    holiday = FIXED_HOLIDAYS.get((d.month, d.day))
    if fitr:
        holiday = "عيد الفطر"
    elif adha or arafah:
        holiday = "عيد الأضحى"
    nxt = d + timedelta(days=1)
    hn = _hijri(nxt)
    fn, an, arn = _is_eid(hn)
    eve = holiday is None and (FIXED_HOLIDAYS.get((nxt.month, nxt.day)) is not None or fn or an or arn)
    school, est = None, False
    for a, b, name, e in SCHOOL_BREAKS:
        if _d(a) <= d <= _d(b):
            school, est = name, e
    prev_pay, next_pay = _paydays_around(d)
    return DayInfo(
        day=d, dow=d.weekday(), hijri_month=h.month, hijri_day=h.day,
        ramadan=h.month == 9, ramadan_day=h.day if h.month == 9 else 0,
        ramadan_last10=h.month == 9 and h.day >= 20,
        eid_fitr=fitr, eid_adha=adha, arafah=arafah, eid_window=window,
        public_holiday=holiday, holiday_eve=eve,
        school_break=school, school_estimated=est,
        days_from_payday=(d - prev_pay).days, days_to_payday=(next_pay - d).days,
        citizen_account=d.day == 10, month_end=(d + timedelta(days=1)).month != d.month,
        weekend=d.weekday() in (4, 5), weekend_eve=d.weekday() == 3,
    )


def feature_row(info: DayInfo) -> dict[str, float]:
    """المتغيّراتُ العدديّة التي تراها النماذج — كلُّها معروفةٌ مقدَّماً لأيّ يوم."""
    return {
        "dow": float(info.dow),
        "dom": float(info.day.day),
        "ramadan": float(info.ramadan),
        "ramadan_day": float(info.ramadan_day),
        "ramadan_last10": float(info.ramadan_last10),
        "eid": float(info.eid_fitr or info.eid_adha or info.arafah),
        "eid_window": float(info.eid_window),
        "holiday": float(info.public_holiday is not None),
        "holiday_eve": float(info.holiday_eve),
        "school_break": float(info.school_break is not None),
        "summer": float(info.school_break == "الإجازة الصيفية"),
        "days_from_payday": float(info.days_from_payday),
        "days_to_payday": float(info.days_to_payday),
        "payday_week": float(info.days_from_payday <= 6),
        "citizen_account": float(info.citizen_account),
        "month_end": float(info.month_end),
    }


CALENDAR_FEATURES = list(feature_row(day_info(date(2026, 1, 1))).keys())


def context_of(info: DayInfo) -> dict:
    """ما يُعرض بجانب اليوم في الصفحة — بالعربية."""
    tags: list[str] = []
    if info.public_holiday:
        tags.append(info.public_holiday)
    if info.holiday_eve:
        tags.append("ليلة إجازة رسمية")
    if info.ramadan:
        tags.append(f"رمضان — اليوم {info.ramadan_day}")
    if info.school_break:
        tags.append(info.school_break + (" (تقديريّ)" if info.school_estimated else ""))
    if info.days_from_payday == 0:
        tags.append("يوم الراتب")
    elif info.days_from_payday <= 3:
        tags.append("بعد الراتب بأيّام")
    if info.citizen_account:
        tags.append("حساب المواطن")
    return {
        "hijri": f"{info.hijri_day}/{info.hijri_month}",
        "tags": tags,
        "estimated": info.school_estimated,
    }
