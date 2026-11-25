"""أحداثُ جدّة التي قد تحرّك المبيعات — جُمعت من الأخبار ومواقع التذاكر (٢٥ نوفمبر ٢٠٢٦).

لكلّ حدثٍ مصدرُه. والنوعُ يصير متغيّراً يراه النموذج (`concert` · `football` · `festival`):
بمثالٍ أو مثالين لا يتعلّم النموذجُ أثرَه بثقة، فيبقى قليلَ الوزن حتى تتراكم الأمثلة —
ولذلك تُجمع من الآن. وما يعرفه أحمد ولا تعرفه الأخبار يُضاف من الصفحة (`forecast_events`).

ما قيس حتى اليوم (بالساعة، مقابل متوسّط الأيّام الأربعة نفسِها قبله):
  - إجازة الخريف ٢٠–٢٨ نوفمبر: الخميسُ قبلها −٣٢٪ (سفر)، وأيّامُها ليلٌ أعلى بـ٥٥–١١١٪ وصباحٌ أقلّ.
  - فضل شاكر (عبادي الجوهر أرينا، ٥ نوفمبر): اليومُ +٢٣٪، والمساءُ +٦٦٪.
  - MDLBEAST (أونكس أرينا، ٢٩–٣٠ أكتوبر): −٥٪ ثمّ −١٥٪.
  مثالٌ واحد لكلّ نوع — قرينةٌ لا قاعدة.
"""
from __future__ import annotations

from datetime import date

KHALEEJ = "https://www.khaleajvoice.com/2026/10/saudi-arabia-concerts-events-october-november-2026.html"
TIKEVENT = "https://tikevent.com/blog/best-saudi-events-november-2026/"
WEBOOK = "https://webook.com/blog/music-events-saudi-arabia-concerts/"
GOAL = "https://www.goal.com/en-ae/tickets-travel/match/al-ahli-al-ittihad/A~blt147f6398448299e4"
DESTKSA = "https://destinationksa.com/en/pink-october-jeddah-2026/"

# (اليوم, النوع, الوصف, المصدر)
EVENTS: list[tuple[str, str, str, str]] = [
    ("2026-07-17", "concert", "محمد حماقي — عبادي الجوهر أرينا (موسم جدة)", "https://misrconnect.com/en/news/celebrities/mohamed-hamaki-saudi-arabia-concert-july-17-2026"),
    ("2026-09-17", "concert", "عمرو دياب — عبادي الجوهر أرينا (موسم جدة)", "https://misrconnect.com/en/news/celebrities/amr-diab-to-perform-in-jeddah-on-september-17-concert-details-and-what-fans-can-expect"),
    ("2026-10-02", "concert", "Tul8te (FAWERHA) — جدة سوبردوم", "https://english.ahram.org.eg/News/577547.aspx"),
    ("2026-10-16", "concert", "ندى القلعة — مسرح ماربل آرتش", "https://jeddah.platinumlist.net/event"),
    ("2026-10-17", "festival", "سباق الكورنيش للتوعية بسرطان الثدي", DESTKSA),
    ("2026-10-22", "festival", "سباق Defe على حلبة الكورنيش", DESTKSA),
    ("2026-10-24", "festival", "Pink Run على حلبة الكورنيش", DESTKSA),
    ("2026-10-29", "concert", "MDLBEAST — أونكس أرينا (الليلة الأولى)", KHALEEJ),
    ("2026-10-30", "concert", "MDLBEAST — أونكس أرينا (الليلة الثانية)", KHALEEJ),
    ("2026-11-04", "festival", "معرض جدة الدولي للسيارات — يبدأ", "https://saudicon.app/ar/events/city/jeddah"),
    ("2026-11-05", "concert", "فضل شاكر — عبادي الجوهر أرينا", TIKEVENT),
    ("2026-11-05", "concert", "كورالا — النادي الأدبي", WEBOOK),
    ("2026-11-06", "concert", "كورالا — النادي الأدبي (الثانية)", WEBOOK),
    ("2026-11-20", "football", "الأهلي × الفيحاء — جدة ٩ م", TIKEVENT),
    ("2026-11-23", "football", "الاتحاد × باختاكور (آسيا) — جدة ٩:١٥ م", TIKEVENT),
    ("2026-11-26", "football", "ديربي جدة: الاتحاد × الأهلي — ٨ م", GOAL),
    ("2026-11-26", "concert", "محمد حلمي Plus One — دار الحكمة", TIKEVENT),
    ("2026-11-27", "concert", "محمد حلمي Plus One — دار الحكمة (الثانية)", TIKEVENT),
]

KINDS = ("concert", "football", "festival")


def by_day() -> dict[date, list[tuple[str, str, str]]]:
    out: dict[date, list[tuple[str, str, str]]] = {}
    for d, k, label, src in EVENTS:
        out.setdefault(date.fromisoformat(d), []).append((k, label, src))
    return out
