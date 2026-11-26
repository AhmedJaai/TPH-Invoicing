"""الأشهرُ القادمة: كم يُقفل هذا الشهر، والذي بعده، وحتى نهاية السنة القادمة.

ستّةُ أشهرٍ من التاريخ لا تكفي لنموذجٍ يتعلّم موسمَ السنة — فلا يُدّعى ذلك. البناءُ بنيويّ صريح:

    مبيعُ اليوم = المستوى الحاليّ × نصيبُ يومِ الأسبوع × أثرُ التقويم

  - **المستوى**: متوسّطُ آخر ثمانية أسابيع بعد نزع أثر التقويم منها — لا اتّجاهَ يُمدّ إلى المستقبل.
  - **يومُ الأسبوع**: من الأسابيع الثمانية نفسها.
  - **أثرُ التقويم**: انحدارٌ لوغاريتميّ على التاريخ كلّه لما وقع منه فعلاً (الصيف، الإجازاتُ القصيرة،
    الإجازاتُ الرسمية وليلتُها). وما لم يقع بعد (رمضان، عيدُ الفطر) أثرُه «غير مقيس»: يُترك ١ ويتّسع مداه.
  - **الأيّامُ الواحد والثلاثون الأولى** من المزيج اليوميّ نفسِه لا من هذا البناء.

والمدى من تذبذب المستوى بين الأشهر الماضية، يتّسع بجذر بُعد الشهر، ويُزاد لشهرٍ فيه ما لم يُقَس.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import calendar_sa as cal

MONTHS_AHEAD = 14  # الشهرُ الجاري وما يكفي لتغطية السنة القادمة كاملة
Z80 = 1.2816
EFFECTS = ["summer", "break_short", "holiday", "holiday_eve", "eid_window"]
UNMEASURED_EXTRA = 0.25  # لوغاريتماً: شهرٌ فيه رمضان أو عيدُ الفطر بلا مثالٍ سابق


def _flags(d: date) -> dict[str, float]:
    i = cal.day_info(d)
    f = cal.feature_row(i)
    return {
        "summer": f["summer"],
        "break_short": float(f["school_break"] > 0 and f["summer"] == 0),
        "holiday": f["holiday"],
        "holiday_eve": f["holiday_eve"],
        "eid_window": f["eid_window"],
        "ramadan": f["ramadan"],
        "eid_fitr": float(i.eid_fitr),
    }


def calendar_effects(y: pd.Series) -> tuple[dict[str, float], dict[str, int]]:
    """أثرُ كلّ متغيّرٍ تقويميّ (لوغاريتماً) من التاريخ كلّه، مع يوم الأسبوع — وكم يوماً قيس عليه."""
    from sklearn.linear_model import Ridge

    y = y.dropna()
    y = y[y > 0]
    F = pd.DataFrame([_flags(d.date()) for d in y.index], index=y.index)
    # المستوى (القاطع) ويومُ الأسبوع لا يُعاقَبان — وإلّا انكمش المستوى وحملت متغيّراتُ التقويم مكانَه
    dow = pd.get_dummies(y.index.dayofweek).astype(float).values[:, 1:]
    ly = np.log(y.values)
    X = np.hstack([dow * 10.0, F[EFFECTS].values])  # تكبيرُ يوم الأسبوع يكاد يرفع العقوبة عنه
    r = Ridge(alpha=1.0, fit_intercept=True).fit(X, ly)
    coef = dict(zip(EFFECTS, r.coef_[6:]))
    counts = {k: int(F[k].sum()) for k in EFFECTS}
    # ما قيس على أقلّ من يومين لا يُصدَّق أثرُه
    return {k: (float(v) if counts[k] >= 2 else 0.0) for k, v in coef.items()}, counts


def level_sigma(y: pd.Series) -> float:
    """تذبذبُ مستوى الشهر عن سابقه (لوغاريتماً) — من متوسّطات الأشهر الكاملة."""
    m = y.dropna().groupby(y.dropna().index.to_period("M")).agg(["mean", "count"])
    m = m[m["count"] >= 20]["mean"]
    if len(m) < 3:
        return 0.10
    return float(max(0.05, np.std(np.diff(np.log(m.values)), ddof=1)))


def monthly(y: pd.Series, first_day: date, daily_p50: dict[date, float], horizon_days: int) -> list[dict]:
    """لكلّ شهرٍ من شهر `first_day`: مجموعُ المتوقَّع من `first_day` (ما قبله واقعٌ يضيفه التطبيق)."""
    eff, counts = calendar_effects(y)
    sigma = level_sigma(y)
    hist = y.dropna().iloc[-56:]
    hist = hist[hist > 0]
    adj = np.array([sum(eff[k] * _flags(d.date())[k] for k in EFFECTS) for d in hist.index])
    deseason = hist.values / np.exp(adj)
    dow_mean = pd.Series(deseason, index=hist.index).groupby(hist.index.dayofweek).mean()
    level_by_dow = dow_mean.reindex(range(7)).fillna(float(np.mean(deseason)))

    out: list[dict] = []
    start = date(first_day.year, first_day.month, 1)
    for k in range(MONTHS_AHEAD):
        ms = (pd.Timestamp(start) + pd.DateOffset(months=k)).date()
        me = (pd.Timestamp(ms) + pd.offsets.MonthEnd(0)).date()
        d0 = max(ms, first_day)
        total = 0.0
        days = 0
        unmeasured = set()
        tags = set()
        d = d0
        while d <= me:
            fl = _flags(d)
            if d in daily_p50:
                v = daily_p50[d]
            else:
                v = float(level_by_dow[d.weekday()] * math.exp(sum(eff[k2] * fl[k2] for k2 in EFFECTS)))
            if fl["ramadan"]:
                unmeasured.add("رمضان")
            if fl["eid_fitr"]:
                unmeasured.add("عيد الفطر")
            if fl["summer"]:
                tags.add("الإجازة الصيفية")
            if fl["break_short"]:
                tags.add("إجازة مدرسية")
            total += v
            days += 1
            d += timedelta(days=1)
        # البُعدُ بالأشهر من أوّل يومٍ متوقَّع — والأيّامُ القريبة من المزيج مداها أضيق
        months_out = max(0.5, (d0 - first_day).days / 30.0 + 0.5)
        s = sigma * math.sqrt(months_out)
        if unmeasured:
            s = math.sqrt(s ** 2 + UNMEASURED_EXTRA ** 2)
        within = (me - first_day).days < horizon_days
        out.append({
            "period": ms.strftime("%Y-%m"),
            "fromDay": d0.isoformat(),
            "days": days,
            "p10": total * math.exp(-Z80 * s),
            "p50": total,
            "p90": total * math.exp(Z80 * s),
            "source": "daily" if within else "structural",
            "unmeasured": sorted(unmeasured),
            "tags": sorted(tags),
        })
    return out, {"effects": {k: round(math.exp(v) - 1, 3) for k, v in eff.items()}, "effectDays": counts, "levelSigma": round(sigma, 3)}


def backtest_months(y: pd.Series) -> list[dict]:
    """قياسٌ صادق بما يتيحه التاريخ: من آخر يومٍ في كلّ شهر، تنبّؤُ الشهر التالي كلِّه بالبناء وحده."""
    rows = []
    months = sorted({(d.year, d.month) for d in y.dropna().index})
    for (yy, mm) in months[2:]:
        start = date(yy, mm, 1)
        hist = y[y.index < pd.Timestamp(start)]
        if hist.dropna().shape[0] < 56:
            continue
        actual = y[(y.index >= pd.Timestamp(start)) & (y.index <= pd.Timestamp(start) + pd.offsets.MonthEnd(0))]
        if actual.notna().sum() < 25:
            continue
        pred, _ = monthly(hist, start, {}, 0)
        p = pred[0]["p50"] * actual.notna().sum() / pred[0]["days"]
        rows.append({"period": start.strftime("%Y-%m"), "actual": float(actual.sum()), "p50": p,
                     "errorPct": round((p / float(actual.sum()) - 1) * 100, 1)})
    return rows
