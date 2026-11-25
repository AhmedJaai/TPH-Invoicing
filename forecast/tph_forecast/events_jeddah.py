"""أحداثُ جدّة والعالم التي قد تحرّك المبيعات — جُمعت من الأخبار ومواقع التذاكر (٢٥ نوفمبر ٢٠٢٦).

لكلّ حدثٍ مصدرُه. والنوعُ يصير متغيّراً يراه النموذج: `concert` حفلٌ أو عرض · `football` مباراةٌ
للاتحاد أو الأهلي · `festival` مهرجانٌ أو معرضٌ أو سباق · `bigmatch` مباراةٌ جماهيريّة كبرى (الهلال والنصر،
الكلاسيكو والديربي، المنتخب، النهائيات العالمية) · `launch` حدثٌ عالميّ يُبقي الناس في بيوتهم (صدور GTA 6).
ومواعيدُ المباريات من صفحات ESPN للأندية والمنتخب (٢٥ نوفمبر ٢٠٢٦).
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
    ("2026-05-30", "bigmatch", "الإكوادور × السعودية (ودّيّة)", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-05-30", "bigmatch", "نهائي دوري أبطال أوروبا", "https://www.fourfourtwo.com/us/features/fifa-world-cup-2026-dates-fixtures-stadiums-tickets-and-everything-you-need-to-know"),
    ("2026-06-05", "bigmatch", "بورتوريكو × السعودية (ودّيّة)", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-06-09", "bigmatch", "السعودية × السنغال (ودّيّة)", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-06-15", "bigmatch", "كأس العالم: السعودية × الأوروغواي", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-06-21", "bigmatch", "كأس العالم: إسبانيا × السعودية", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-06-26", "bigmatch", "كأس العالم: الرأس الأخضر × السعودية", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-07-17", "concert", "محمد حماقي — عبادي الجوهر أرينا (موسم جدة)", "https://misrconnect.com/en/news/celebrities/mohamed-hamaki-saudi-arabia-concert-july-17-2026"),
    ("2026-07-19", "bigmatch", "نهائي كأس العالم", "https://www.fourfourtwo.com/competition/when-does-the-world-cup-end"),
    ("2026-08-11", "football", "الاتحاد × الجزيرة (آسيا، تمهيدي)", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-08-13", "football", "الأهلي × الدرعية", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-08-14", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-08-15", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-08-15", "football", "الخلود × الاتحاد", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-08-17", "football", "الأهلي × الأنوار (كأس الملك)", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-08-17", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-08-18", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-08-18", "football", "الاتحاد × النجمة (كأس الملك)", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-08-20", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-08-21", "football", "الاتحاد × القادسية", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-08-21", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-08-22", "football", "أبها × الأهلي", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-08-24", "football", "الحزم × الاتحاد", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-08-25", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-08-26", "football", "أوكلاند × الأهلي (كأس القارّات للأندية)", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-08-28", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-08-29", "football", "الاتحاد × الفتح · الأهلي × الخلود", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-09-01", "bigmatch", "الهلال × الأهلي", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-09-04", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-09-04", "football", "الرياض × الأهلي", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-09-05", "bigmatch", "الاتحاد × النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-09-07", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-09-08", "football", "الفيحاء × الاتحاد · الأهلي × القادسية", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-09-09", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-09-11", "football", "الاتحاد × الفيصلي · الحزم × الأهلي", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-09-12", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-09-14", "football", "الاتحاد × الشمال · باختاكور × الأهلي (آسيا)", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-09-15", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-09-17", "concert", "عمرو دياب — عبادي الجوهر أرينا (موسم جدة)", "https://misrconnect.com/en/news/celebrities/amr-diab-to-perform-in-jeddah-on-september-17-concert-details-and-what-fans-can-expect"),
    ("2026-09-19", "football", "الأهلي × صن داونز (كأس القارّات للأندية)", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-09-23", "bigmatch", "كأس الخليج: السعودية × الكويت", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-09-26", "bigmatch", "كأس الخليج: عُمان × السعودية", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-09-29", "bigmatch", "كأس الخليج: السعودية × العراق", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-10-02", "concert", "Tul8te (FAWERHA) — جدة سوبردوم", "https://english.ahram.org.eg/News/577547.aspx"),
    ("2026-10-03", "bigmatch", "كأس الخليج: السعودية × قطر (ترجيح)", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-10-06", "bigmatch", "كأس الخليج: الإمارات × السعودية", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-10-09", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-10-09", "football", "الأهلي × الفتح", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-10-10", "bigmatch", "الهلال × الاتحاد", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-10-12", "football", "الأهلي × الوصل (آسيا)", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-10-12", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-10-13", "football", "شباب الأهلي × الاتحاد (آسيا)", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-10-13", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-10-16", "concert", "ندى القلعة — مسرح ماربل آرتش", "https://jeddah.platinumlist.net/event"),
    ("2026-10-17", "festival", "سباق الكورنيش للتوعية بسرطان الثدي", DESTKSA),
    ("2026-10-19", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-10-19", "football", "الفيحاء × الأهلي", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-10-20", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-10-20", "football", "الاتحاد × الاتفاق", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-10-22", "festival", "سباق Defe على حلبة الكورنيش", DESTKSA),
    ("2026-10-23", "football", "الدرعية × الاتحاد · الخليج × الأهلي", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-10-23", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-10-24", "festival", "Pink Run على حلبة الكورنيش", DESTKSA),
    ("2026-10-26", "football", "الاتحاد × نفط فرغانة · الغرافة × الأهلي (آسيا)", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-10-27", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-10-29", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-10-29", "concert", "MDLBEAST — أونكس أرينا (الليلة الأولى)", KHALEEJ),
    ("2026-10-30", "concert", "MDLBEAST — أونكس أرينا (الليلة الثانية)", KHALEEJ),
    ("2026-10-30", "football", "الاتحاد × أبها · الأهلي × الشباب", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-10-31", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-11-02", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-11-02", "football", "العين × الاتحاد · الأهلي × السد (آسيا)", "https://www.espn.com/soccer/team/results/_/id/8346/al-ahli"),
    ("2026-11-03", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-11-04", "festival", "معرض جدة الدولي للسيارات — يبدأ", "https://saudicon.app/ar/events/city/jeddah"),
    ("2026-11-05", "concert", "كورالا — النادي الأدبي", WEBOOK),
    ("2026-11-05", "concert", "فضل شاكر — عبادي الجوهر أرينا", TIKEVENT),
    ("2026-11-06", "concert", "كورالا — النادي الأدبي (الثانية)", WEBOOK),
    ("2026-11-13", "bigmatch", "السعودية × كوريا الجنوبية (ودّيّة)", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-11-17", "bigmatch", "السعودية × أوزبكستان (ودّيّة)", "https://www.espn.com/soccer/team/results/_/id/655/saudi-arabia"),
    ("2026-11-19", "launch", "صدور GTA 6 (بلايستيشن 5 وإكس بوكس)", "https://www.fox10tv.com/2026/10/16/gta-6-locks-nov-19-release-date-after-delays/"),
    ("2026-11-20", "bigmatch", "الأهلي × النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-11-23", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/929/al-hilal"),
    ("2026-11-23", "football", "باختاكور × الاتحاد · الأهلي × الشمال (آسيا)", "https://www.espn.com/soccer/team/results/_/id/2276/al-ittihad"),
    ("2026-11-24", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/results/_/id/817/al-nassr"),
    ("2026-11-26", "concert", "محمد حلمي Plus One — دار الحكمة", TIKEVENT),
    ("2026-11-27", "football", "نيوم × الاتحاد", "https://www.espn.com/soccer/team/fixtures/_/id/2276/al-ittihad"),
    ("2026-11-27", "concert", "محمد حلمي Plus One — دار الحكمة (الثانية)", TIKEVENT),
    ("2026-11-28", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/929/al-hilal"),
    ("2026-11-28", "football", "التعاون × الأهلي", "https://www.espn.com/soccer/team/fixtures/_/id/8346/al-ahli"),
    ("2026-12-03", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/929/al-hilal"),
    ("2026-12-04", "football", "الاتحاد × الخليج · الفيصلي × الأهلي", "https://www.espn.com/soccer/team/fixtures/_/id/2276/al-ittihad"),
    ("2026-12-04", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/817/al-nassr"),
    ("2026-12-07", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/929/al-hilal"),
    ("2026-12-07", "football", "الاتحاد × الوصل (آسيا)", "https://www.espn.com/soccer/team/fixtures/_/id/2276/al-ittihad"),
    ("2026-12-08", "football", "شباب الأهلي × الأهلي (آسيا)", "https://www.espn.com/soccer/team/fixtures/_/id/8346/al-ahli"),
    ("2026-12-08", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/817/al-nassr"),
    ("2026-12-11", "bigmatch", "ديربي جدّة: الأهلي × الاتحاد", "https://www.espn.com/soccer/team/fixtures/_/id/8346/al-ahli"),
    ("2026-12-12", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/817/al-nassr"),
    ("2026-12-15", "football", "الاتفاق × الأهلي", "https://www.espn.com/soccer/team/fixtures/_/id/8346/al-ahli"),
    ("2026-12-16", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/817/al-nassr"),
    ("2026-12-17", "football", "الاتحاد × الرياض", "https://www.espn.com/soccer/team/fixtures/_/id/2276/al-ittihad"),
    ("2026-12-17", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/929/al-hilal"),
    ("2026-12-21", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/929/al-hilal"),
    ("2026-12-21", "football", "الشباب × الاتحاد", "https://www.espn.com/soccer/team/fixtures/_/id/2276/al-ittihad"),
    ("2026-12-27", "bigmatch", "مباراة للهلال أو النصر", "https://www.espn.com/soccer/team/fixtures/_/id/817/al-nassr"),
]

KINDS = ("concert", "football", "festival", "bigmatch", "launch")


def by_day() -> dict[date, list[tuple[str, str, str]]]:
    out: dict[date, list[tuple[str, str, str]]] = {}
    for d, k, label, src in EVENTS:
        out.setdefault(date.fromisoformat(d), []).append((k, label, src))
    return out
