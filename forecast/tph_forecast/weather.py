"""الطقسُ في جدّة من Open-Meteo — مجانيّ وبلا مفتاح، ولا يُرسَل إليه إلّا إحداثيّاتُ المدينة.

ثلاثةُ مصادر لثلاثة أزمنة:
  - ما وقع:      أرشيفُ ERA5 (`archive-api`) — يتأخّر أيّاماً، فتُكمَل الأيّامُ الأخيرة من
                  التنبّؤ نفسِه بـ`past_days`.
  - الأيّامُ ١٦ القادمة: تنبّؤ الطقس (`api.open-meteo.com`).
  - ما بعدها:    «المعتاد» — متوسّطُ اليوم نفسِه ±٧ أيّام في السنوات العشر الماضية.

والتعذّرُ لا يُسقط التنبّؤ: تعود المتغيّراتُ فارغة (`NaN`) ويُقال في الخلاصة.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests

# جدّة — وسط المدينة (شبكةُ النموذج نحو ١٠ كم، فالحيُّ لا يغيّر شيئاً)
LAT, LON = 21.54, 39.17
DAILY = [
    "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max",
    "relative_humidity_2m_mean", "precipitation_sum", "wind_speed_10m_max",
]
WEATHER_FEATURES = ["t_max", "t_min", "feels_max", "humidity", "rain_mm", "wind_max"]
_RENAME = dict(zip(DAILY, WEATHER_FEATURES))
TIMEOUT = 30


def _get(url: str, params: dict) -> pd.DataFrame:
    r = requests.get(url, params={**params, "latitude": LAT, "longitude": LON, "timezone": "Asia/Riyadh",
                                  "daily": ",".join(DAILY)}, timeout=TIMEOUT)
    r.raise_for_status()
    js = r.json()["daily"]
    df = pd.DataFrame(js).rename(columns=_RENAME)
    df["time"] = pd.to_datetime(df["time"])
    return df.set_index("time")[WEATHER_FEATURES].astype(float)


def load_weather(start: date, end: date) -> tuple[pd.DataFrame, dict]:
    """يُرجع جدولاً لكلّ يومٍ من `start` إلى `end`، ومعه مصدرُ كلّ يوم."""
    idx = pd.date_range(start, end, freq="D")
    out = pd.DataFrame(index=idx, columns=WEATHER_FEATURES, dtype=float)
    kind = pd.Series("missing", index=idx)
    notes: dict = {}
    today = date.today()
    try:
        arch = _get("https://archive-api.open-meteo.com/v1/archive",
                    {"start_date": start.isoformat(), "end_date": min(end, today - timedelta(days=2)).isoformat()})
        arch = arch.dropna(how="all")
        out.loc[arch.index.intersection(idx)] = arch.loc[arch.index.intersection(idx)]
        kind.loc[arch.index.intersection(idx)] = "observed"
    except Exception as e:  # noqa: BLE001 — الطقسُ إضافة: تعذّرُه يُقال ولا يُسقط
        notes["archive"] = str(e)[:200]
    try:
        fc = _get("https://api.open-meteo.com/v1/forecast", {"past_days": 10, "forecast_days": 16})
        fc = fc.dropna(how="all")
        common = fc.index.intersection(idx)
        missing = [d for d in common if kind[d] != "observed"]
        out.loc[missing] = fc.loc[missing]
        kind.loc[[d for d in missing if d.date() < today]] = "observed"
        kind.loc[[d for d in missing if d.date() >= today]] = "forecast"
    except Exception as e:  # noqa: BLE001
        notes["forecast"] = str(e)[:200]
    rest = [d for d in idx if kind[d] == "missing"]
    clim_frame = None
    try:
        clim = _climatology(today)
        clim_frame = pd.DataFrame([clim.loc[min(d.dayofyear, 365)].values for d in idx], index=idx, columns=WEATHER_FEATURES)
        for d in rest:
            out.loc[d] = clim_frame.loc[d]
            kind[d] = "normal"
    except Exception as e:  # noqa: BLE001
        notes["climatology"] = str(e)[:200]
    notes["counts"] = kind.value_counts().to_dict()
    return out, {"kind": kind, "notes": notes, "clim": clim_frame}


AIR_FEATURES = ["pm10", "dust"]
# جودةُ الهواء (CAMS عبر Open-Meteo): الغبارُ يُبقي الناس في بيوتهم — وتنبّؤُه خمسةُ أيّامٍ وحدها
AIR_HORIZON = 5


def load_air(start: date, end: date) -> tuple[pd.DataFrame, dict]:
    """الغبارُ وPM10 يومياً: متوسّطُ ساعات العمل (٧ ص – ١٢ ل) — ممّا وقع ومن تنبّؤ الأيّام الخمسة."""
    idx = pd.date_range(start, end, freq="D")
    out = pd.DataFrame(np.nan, index=idx, columns=AIR_FEATURES)
    end = min(end, date.today() + timedelta(days=AIR_HORIZON - 1))  # بعدها لا تنبّؤَ للغبار
    try:
        r = requests.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={
            "latitude": LAT, "longitude": LON, "timezone": "Asia/Riyadh", "hourly": "pm10,dust",
            "start_date": start.isoformat(), "end_date": end.isoformat()}, timeout=TIMEOUT)
        r.raise_for_status()
        hz = pd.DataFrame(r.json()["hourly"])
        hz["time"] = pd.to_datetime(hz["time"])
        hz = hz[hz["time"].dt.hour >= 7]
        daily = hz.groupby(hz["time"].dt.normalize())[["pm10", "dust"]].mean()
        common = daily.index.intersection(idx)
        out.loc[common] = daily.loc[common].values
        return out, {"days": int(out.notna().all(axis=1).sum())}
    except Exception as e:  # noqa: BLE001
        return out, {"error": str(e)[:200]}


def _climatology(today: date) -> pd.DataFrame:
    a = date(today.year - 10, 1, 1)
    b = date(today.year - 1, 12, 31)
    hist = _get("https://archive-api.open-meteo.com/v1/archive", {"start_date": a.isoformat(), "end_date": b.isoformat()})
    hist["doy"] = hist.index.dayofyear.clip(upper=365)
    by = hist.groupby("doy")[WEATHER_FEATURES].mean()
    # نافذةٌ دائريّة ±٧ أيّام
    ext = pd.concat([by.iloc[-7:], by, by.iloc[:7]])
    smooth = ext.rolling(15, center=True).mean().iloc[7:-7]
    smooth.index = by.index
    return smooth.reindex(range(1, 366)).interpolate().bfill().ffill()


def empty_weather(start: date, end: date) -> pd.DataFrame:
    idx = pd.date_range(start, end, freq="D")
    return pd.DataFrame(np.nan, index=idx, columns=WEATHER_FEATURES)
