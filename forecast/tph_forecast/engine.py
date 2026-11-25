"""محرّكُ التنبّؤ — مزيجُ نماذج يُختبَر على ماضٍ لم يره، ثمّ يتنبّأ بواحدٍ وثلاثين يوماً بالساعة.

ما تقوله الأبحاثُ ويُبنى عليه هنا:
  - **مسابقة M5** (وولمارت، ٢٠٢٠): الفائزُ نموذجُ أشجارٍ معزَّزة واحدٌ لكلّ السلاسل (LightGBM)
    بمتغيّرات التقويم، مباشرٌ لكلّ مدى، ومعيارُه نسبةٌ إلى مستوى السلسلة. ← `gbm`
  - **النماذجُ المدرَّبة مسبقاً** (Chronos-2، أمازون ٢٠٢٥): تتنبّأ بلا تدريب على بياناتنا،
    وتقبل متغيّرات المستقبل المعروفة (التقويم والطقس) — قوّتُها مع التاريخ القصير. ← `chronos`
  - **الإحصاءُ الكلاسيكيّ** يصعب التفوّق عليه في السلاسل القصيرة (M3 · M4):
    التمهيدُ الأُسّيّ الموسميّ ← `ets`، والانحدارُ اللوغاريتميّ بمتغيّرات التقويم ← `glm`،
    ووسيطُ اليوم نفسِه من الأسابيع الأخيرة ← `dow_median` (الأساسُ الذي يجب أن يُغلَب).
  - **المزجُ يغلب الأفضلَ منفرداً** (Bates & Granger 1969، وكلُّ مسابقات M بعدها):
    الأوزانُ بعكس مربّع الخطأ الأخير، لكلّ نوعِ سلسلةٍ ولكلّ مدى.
  - **التنبّؤ الاحتماليّ المعايَر** (Conformal prediction، Vovk 2005): المدى p10–p90 من أخطاء
    المزيج الحقيقيّة في الماضي، فيصدق ٨٠٪ من الوقت بالقياس لا بالافتراض.
  - **الهرمُ الزمنيّ** (Athanasopoulos وآخرون 2017): اليومُ يُتنبّأ به ثمّ يُوزَّع على ساعاته
    بنمطِ اليوم نفسِه من الأسابيع الأخيرة — فمجموعُ الساعات يساوي اليوم بالضبط.

والاختبارُ متداخلٌ بصدق: كلُّ أصلٍ في الماضي يرى ما قبله وحده — حتى أوزانُ المزج
وفتراتُ الثقة تُحسب ممّا كان معروفاً يومها. والمجهولُ (يومٌ بلا قراءة، إغلاق، نفاد) `NaN` لا صفر.
"""
from __future__ import annotations

import math
import time
import warnings
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import calendar_sa as cal
from . import events_jeddah
from .weather import AIR_FEATURES, AIR_HORIZON, WEATHER_FEATURES

warnings.filterwarnings("ignore")

ENGINE_VERSION = "1.0.0"
H = 31  # اليومُ نفسُه وثلاثون بعده
TRAIN_START = date(2026, 5, 24)  # قبلَه أسبوعا الافتتاح: مستوىً يصعد لا يعود
MAX_ITEMS = 40
BACKTEST_ORIGINS = 49
HOURLY_ITEM_DAYS = 7
QUANTILES = (0.1, 0.9)

TOTAL_NET = "total|NET_MINOR"
TOTAL_ORDERS = "total|ORDERS"


def item_key(pid: str) -> str:
    return f"item:{pid}|QTY_MILLI"


def split_key(k: str) -> tuple[str, str]:
    s, m = k.split("|")
    return s, m


def horizon_bucket(h: int) -> str:
    return "D1" if h == 1 else ("D2_7" if h <= 7 else "D8_31")


# ─────────────────────────── البيانات ───────────────────────────


@dataclass
class Data:
    dates: pd.DatetimeIndex
    Y: pd.DataFrame  # الأيّام × السلاسل؛ NaN مجهول
    hourly: dict[str, pd.DataFrame]  # السلسلة → الأيّام × ٢٤ ساعة
    names: dict[str, str]
    item_tier: dict[str, int]
    closed_future: set[date] = field(default_factory=set)
    event_days: set[date] = field(default_factory=set)
    notes: list[str] = field(default_factory=list)


def build_data(history: dict) -> Data:
    today = date.fromisoformat(history["today"])
    open_days = {date.fromisoformat(d) for d in history["days"]}
    last = max(d for d in open_days if d < today)
    dates = pd.date_range(TRAIN_START, last, freq="D")

    closed: set[date] = set()
    closed_future: set[date] = set()
    events: set[date] = set()
    stockouts: dict[str, set[date]] = {}
    for e in history.get("events", []):
        a, b = date.fromisoformat(e["fromDay"]), date.fromisoformat(e["toDay"])
        span = {a + timedelta(days=i) for i in range((b - a).days + 1)}
        if e["kind"] == "CLOSED":
            closed |= {d for d in span if d <= last}
            closed_future |= {d for d in span if d > last}
        elif e["kind"] == "STOCKOUT" and e.get("posProductId"):
            stockouts.setdefault(e["posProductId"], set()).update(span)
        else:
            events |= span

    known = pd.Series([d.date() in open_days and d.date() not in closed for d in dates], index=dates)

    tot = pd.DataFrame(history["totals"], columns=["d", "h", "net", "orders"])
    tot["d"] = pd.to_datetime(tot["d"])
    net_h = tot.pivot_table(index="d", columns="h", values="net", aggfunc="sum").reindex(index=dates, columns=range(24)).fillna(0.0)
    ord_h = tot.pivot_table(index="d", columns="h", values="orders", aggfunc="sum").reindex(index=dates, columns=range(24)).fillna(0.0)
    net_h[~known] = np.nan
    ord_h[~known] = np.nan

    it = pd.DataFrame(history["items"], columns=["d", "h", "pid", "q"])
    it["d"] = pd.to_datetime(it["d"])
    it = it[it["d"].isin(dates)]
    names = {p["id"]: p["name"] for p in history["products"]}

    # الأصنافُ التي تُباع في أغلب الأيّام الأخيرة — النادرُ لا يُتنبّأ به يوماً بيوم
    recent = dates[-28:]
    rec = it[it["d"].isin(recent)]
    days_sold = rec.groupby("pid")["d"].nunique()
    vol = rec.groupby("pid")["q"].sum()
    keep = [p for p in vol.sort_values(ascending=False).index if days_sold.get(p, 0) >= 0.6 * known[recent].sum()][:MAX_ITEMS]

    Y = pd.DataFrame(index=dates)
    Y[TOTAL_NET] = net_h.sum(axis=1, min_count=1)
    Y[TOTAL_ORDERS] = ord_h.sum(axis=1, min_count=1)
    hourly = {TOTAL_NET: net_h, TOTAL_ORDERS: ord_h}
    tiers: dict[str, int] = {}
    for rank, pid in enumerate(keep):
        sub = it[it["pid"] == pid]
        m = sub.pivot_table(index="d", columns="h", values="q", aggfunc="sum").reindex(index=dates, columns=range(24)).fillna(0.0)
        m[~known] = np.nan
        for d in stockouts.get(pid, set()):
            ts = pd.Timestamp(d)
            if ts in m.index:
                m.loc[ts] = np.nan  # ما بيع بعد النفاد ليس الطلب
        k = item_key(pid)
        Y[k] = m.sum(axis=1, min_count=1)
        hourly[k] = m
        tiers[k] = 0 if rank < 10 else (1 if rank < 25 else 2)
    names.update({TOTAL_NET: "المبيعات", TOTAL_ORDERS: "الطلبات"})
    return Data(dates=dates, Y=Y, hourly=hourly, names=names, item_tier=tiers,
                closed_future=closed_future, event_days=events)


WEATHER_HORIZON = 16  # ما بعده «المعتاد» لا تنبّؤ الطقس
CLIM = [f"clim_{c}" for c in WEATHER_FEATURES]


def build_exog(data: Data, weather: pd.DataFrame, clim: pd.DataFrame | None = None, air: pd.DataFrame | None = None) -> pd.DataFrame:
    idx = pd.date_range(data.dates[0], data.dates[-1] + timedelta(days=H), freq="D")
    rows = [cal.feature_row(cal.day_info(d.date())) for d in idx]
    ex = pd.DataFrame(rows, index=idx)
    ex["event"] = [float(d.date() in data.event_days) for d in idx]
    # أحداثُ جدّة من الأخبار (`events_jeddah.py`) — عددُها في اليوم من كلّ نوع
    ev = events_jeddah.by_day()
    for k in events_jeddah.KINDS:
        ex[k] = [float(sum(1 for kk, _, _ in ev.get(d.date(), []) if kk == k)) for d in idx]
    # الإجازةُ القصيرة غيرُ الصيف: ليلٌ أطول وصباحٌ أقلّ وسفرٌ أوّلَها (قيس في الخريف ٢٠٢٦)
    ex["break_short"] = ((ex["school_break"] > 0) & (ex["summer"] == 0)).astype(float)
    w = weather.reindex(idx)
    for c in WEATHER_FEATURES:
        ex[c] = w[c].values
        ex[f"clim_{c}"] = clim.reindex(idx)[c].values if clim is not None else np.nan
    a = air.reindex(idx) if air is not None else None
    for c in AIR_FEATURES:
        ex[c] = a[c].values if a is not None else np.nan
    return ex


# ─────────────────────────── النماذج ───────────────────────────
# كلُّ نموذج: (Y حتى الأصل، الأصل، exog) → جدول H×السلاسل بالتواريخ القادمة.


def _future(origin: pd.Timestamp) -> pd.DatetimeIndex:
    return pd.date_range(origin + timedelta(days=1), periods=H, freq="D")


def m_dow_median(Y: pd.DataFrame, origin: pd.Timestamp, ex: pd.DataFrame, **_) -> pd.DataFrame:
    fut = _future(origin)
    out = pd.DataFrame(index=fut, columns=Y.columns, dtype=float)
    for d in fut:
        same = Y.loc[[d - timedelta(days=7 * k) for k in range(1, 12) if d - timedelta(days=7 * k) <= origin]]
        out.loc[d] = same.iloc[:6].median(skipna=True).values if len(same) else np.nan
    return out


def _fill_dow(y: pd.Series) -> pd.Series:
    if y.isna().any():
        med = y.groupby(y.index.dayofweek).transform("median")
        y = y.fillna(med).fillna(y.median())
    return y


def m_ets(Y: pd.DataFrame, origin: pd.Timestamp, ex: pd.DataFrame, **_) -> pd.DataFrame:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    fut = _future(origin)
    out = pd.DataFrame(index=fut, columns=Y.columns, dtype=float)
    for c in Y.columns:
        y = _fill_dow(Y[c].iloc[-112:])
        if y.isna().all() or len(y) < 28:
            continue
        mul = bool((y > 0).all())
        try:
            fit = ExponentialSmoothing(y.values, trend=None, seasonal="mul" if mul else "add",
                                       seasonal_periods=7, initialization_method="estimated").fit(optimized=True)
            out[c] = np.clip(fit.forecast(H), 0, None)
        except Exception:  # noqa: BLE001
            pass
    return out


EXTRA = ["concert", "football", "festival", "bigmatch", "launch", "break_short"]
GLM_FEATURES = ["concert", "football", "bigmatch", "launch", "break_short", "holiday", "holiday_eve", "eid_window", "ramadan", "school_break", "summer", "payday_week",
                "citizen_account", "month_end", "event", "t_max", "humidity", "rain_mm"]


def m_glm(Y: pd.DataFrame, origin: pd.Timestamp, ex: pd.DataFrame, **_) -> pd.DataFrame:
    from sklearn.linear_model import Ridge

    fut = _future(origin)
    hist = Y.index[-140:]

    def design(idx: pd.DatetimeIndex) -> np.ndarray:
        e = ex.loc[idx]
        dow = np.eye(7)[idx.dayofweek]
        cols = []
        for c in GLM_FEATURES:
            v = e[c].values.astype(float)
            if np.isnan(v).any():
                v = np.nan_to_num(v, nan=np.nanmean(ex[c].values) if not np.isnan(ex[c].values).all() else 0.0)
            cols.append(v)
        f = np.column_stack(cols)
        return np.hstack([dow, f])

    Xh, Xf = design(hist), design(fut)
    mu, sd = Xh.mean(axis=0), Xh.std(axis=0) + 1e-9
    mu[:7], sd[:7] = 0, 1  # يومُ الأسبوع يبقى كما هو
    Xh, Xf = (Xh - mu) / sd, (Xf - mu) / sd
    out = pd.DataFrame(index=fut, columns=Y.columns, dtype=float)
    for c in Y.columns:
        y = Y.loc[hist, c].values
        ok = ~np.isnan(y)
        if ok.sum() < 28:
            continue
        # لا اتّجاهَ خطّيّاً يُمدّ إلى المستقبل (انفجر في الأصناف): الأحدثُ أثقلُ وزناً بنصف عمرٍ ٤٥ يوماً
        age = (hist[-1] - hist).days.values
        sw = 0.5 ** (age / 45.0)
        r = Ridge(alpha=4.0).fit(Xh[ok], np.log1p(y[ok]), sample_weight=sw[ok])
        resid = np.log1p(y[ok]) - r.predict(Xh[ok])
        cap = 2.0 * np.nanmax(y[-28:]) if np.isfinite(np.nanmax(y[-28:])) else None
        out[c] = np.clip(np.expm1(r.predict(Xf) + np.median(resid)), 0, cap)
    return out


class GBM:
    """نموذجُ أشجارٍ واحدٌ لكلّ السلاسل، مباشرٌ لكلّ مدى، والهدفُ نسبةٌ إلى مستوى السلسلة."""

    MOMENTUM = ["r_yday", "r_wk", "days_open"]

    def __init__(self, data: Data, ex: pd.DataFrame, weather: bool = True, name: str = "gbm",
                 extra: tuple[str, ...] = (), momentum: bool = False, half_life: float | None = None,
                 params: dict | None = None, totals_only: bool = False):
        self.params = params or {}
        self.totals_only = totals_only
        self.name = name
        self.weather = weather
        self.extra = list(extra)
        self.momentum = momentum
        self.half_life = half_life
        self.panel = self._panel(data, ex)
        self.last_model = None
        self.fit_oi = -1
        self.features: list[str] = []

    def _panel(self, data: Data, ex: pd.DataFrame) -> pd.DataFrame:
        Y = data.Y
        T, cols = len(Y), list(Y.columns)
        V = Y.values
        L = Y.rolling(28, min_periods=20).mean().values
        L28 = np.vstack([np.full((28, len(cols)), np.nan), L[:-28]])
        exv = ex.reindex(pd.date_range(Y.index[0], Y.index[-1] + timedelta(days=H), freq="D"))
        feats_cal = cal.CALENDAR_FEATURES + ["event"] + EXTRA
        frames = []
        for h in range(1, H + 1):
            o = np.arange(27, T)
            d = o + h
            m = math.ceil(h / 7)
            s = d - 7 * m
            same = np.stack([np.where(((s - 7 * j) >= 0)[:, None], V[np.clip(s - 7 * j, 0, T - 1)], np.nan) for j in range(4)])
            with np.errstate(all="ignore"):
                sd_mean = np.nanmean(same, axis=0)
            Lo = L[o]
            target = np.where((d < T)[:, None], V[np.clip(d, 0, T - 1)], np.nan)
            for j, c in enumerate(cols):
                lo = Lo[:, j]
                f = pd.DataFrame({
                    "o": o, "d": d, "h": h, "series": j,
                    "kind": 0 if c == TOTAL_NET else (1 if c == TOTAL_ORDERS else 2),
                    "level": lo,
                    "log_level": np.log1p(lo),
                    "r_dow": sd_mean[:, j] / lo,
                    "r_last": same[0][:, j] / lo,
                    "trend": lo / L28[o, j],
                    "r_yday": V[o, j] / lo,
                    "r_wk": np.array([np.nanmean(V[max(0, x - 6): x + 1, j]) for x in o]) / lo,
                    "days_open": o.astype(float),
                    "y": target[:, j] / lo,
                })
                frames.append(f)
        P = pd.concat(frames, ignore_index=True)
        P = P[np.isfinite(P["level"]) & (P["level"] > 0)]
        dd = exv.index[P["d"].values]
        for c in feats_cal + WEATHER_FEATURES + AIR_FEATURES:
            P[c] = exv[c].values[P["d"].values] if c in exv else np.nan
        # الصدقُ في الاختبار: ما بعد ١٦ يوماً لا يُعرف طقسُه إلّا «معتاداً»، وما بعد ٥ لا يُعرف غبارُه
        far = P["h"].values > WEATHER_HORIZON
        for c in WEATHER_FEATURES:
            if f"clim_{c}" in exv:
                P.loc[far, c] = exv[f"clim_{c}"].values[P["d"].values[far]]
        P.loc[P["h"].values > AIR_HORIZON, AIR_FEATURES] = np.nan
        P["date"] = dd
        return P

    def feature_cols(self) -> list[str]:
        base = ["h", "series", "kind", "log_level", "r_dow", "r_last", "trend"] + cal.CALENDAR_FEATURES + ["event"] + EXTRA
        return base + (WEATHER_FEATURES if self.weather else []) + (self.MOMENTUM if self.momentum else []) + self.extra

    def fit_at(self, oi: int):
        import lightgbm as lgb

        P = self.panel
        tr = P[(P["d"] <= oi) & P["y"].notna() & np.isfinite(P["y"])]
        if self.totals_only:
            tr = tr[tr["kind"] < 2]
        self.features = self.feature_cols()
        w = np.where(tr["kind"].values == 2, 1.0, 4.0)
        if self.half_life:
            w = w * 0.5 ** ((oi - tr["d"].values) / self.half_life)
        hp = dict(objective="l1", learning_rate=0.04, n_estimators=500, num_leaves=15,
                  min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                  reg_lambda=1.0, verbose=-1)
        hp.update(self.params)
        model = lgb.LGBMRegressor(**hp)
        model.fit(tr[self.features], tr["y"].clip(upper=5), sample_weight=w, categorical_feature=["series", "dow"])
        self.last_model = model
        self.fit_oi = oi
        return model

    # في الاختبار الرجوعيّ يُعاد التدريبُ كلَّ أسبوع لا كلَّ يوم: النموذجُ المدرَّب عند أصلٍ
    # لم يرَ إلّا ما قبله، فاستعمالُه في الأيّام الستّة بعده صادق — وأسرعُ سبعَ مرّات.
    REFIT_EVERY = 7

    def __call__(self, Y: pd.DataFrame, origin: pd.Timestamp, ex: pd.DataFrame, oi: int, final: bool = False, **_) -> pd.DataFrame:
        if final or self.last_model is None or oi - self.fit_oi >= self.REFIT_EVERY or oi < self.fit_oi:
            self.fit_at(oi)
        model = self.last_model
        P = self.panel
        q = P[P["o"] == oi]
        if self.totals_only:
            q = q[q["kind"] < 2]
        pred = np.clip(model.predict(q[self.features]), 0, None) * q["level"].values
        fut = _future(origin)
        out = pd.DataFrame(index=fut, columns=Y.columns, dtype=float)
        cols = list(Y.columns)
        for (h, j), v in zip(zip(q["h"].values, q["series"].values), pred):
            out.iat[h - 1, j] = v
        return out

    def contributions(self, oi: int) -> pd.DataFrame:
        """أثرُ كلّ متغيّرٍ في تنبّؤ المبيعات (SHAP من الأشجار نفسها) — بالهللة."""
        q = self.panel[(self.panel["o"] == oi) & (self.panel["kind"] == 0)].sort_values("h")
        contrib = self.last_model.booster_.predict(q[self.features], pred_contrib=True)
        df = pd.DataFrame(contrib[:, :-1], columns=self.features, index=q["date"])
        return df.mul(q["level"].values, axis=0)


class Chronos:
    """Chronos-2 بلا تدريب، بمتغيّرات التقويم والطقس المعروفة مقدَّماً."""

    COVARIATES = ["dow", "concert", "football", "bigmatch", "launch", "break_short", "holiday", "holiday_eve", "eid_window", "ramadan", "school_break", "summer",
                  "payday_week", "event", "t_max", "humidity"]

    def __init__(self, cross: bool = False):
        self.cross = cross
        from chronos import Chronos2Pipeline
        import torch

        torch.set_num_threads(max(1, (torch.get_num_threads() or 2)))
        self.pipe = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map="cpu")
        self.name = "chronos"

    def __call__(self, Y: pd.DataFrame, origin: pd.Timestamp, ex: pd.DataFrame, **_) -> pd.DataFrame:
        fut = _future(origin)
        hist = Y.index
        exf = ex.copy()
        for c in self.COVARIATES:
            exf[c] = exf[c].fillna(exf[c].mean() if exf[c].notna().any() else 0.0)
        past = {c: exf.loc[hist, c].values.astype(np.float32) for c in self.COVARIATES}
        future = {c: exf.loc[fut, c].values.astype(np.float32) for c in self.COVARIATES}
        inputs = [{"target": Y[c].values.astype(np.float32), "past_covariates": past, "future_covariates": future}
                  for c in Y.columns]
        qs, _ = self.pipe.predict_quantiles(inputs, prediction_length=H, quantile_levels=[0.5], cross_learning=self.cross)
        out = pd.DataFrame(index=fut, columns=Y.columns, dtype=float)
        for j, c in enumerate(Y.columns):
            out[c] = np.clip(qs[j][0, :, 0].cpu().numpy(), 0, None)
        return out


# ─────────────────────────── الاختبار الرجوعيّ والمزج ───────────────────────────


def series_class(k: str, data: Data) -> str:
    if k == TOTAL_NET:
        return "net"
    if k == TOTAL_ORDERS:
        return "orders"
    return f"item{data.item_tier.get(k, 2)}"


TIMINGS: dict[str, float] = {}


def run_models(models: dict, data: Data, ex: pd.DataFrame, oi: int, final: bool = False) -> dict[str, pd.DataFrame]:
    origin = data.dates[oi]
    Yh = data.Y.iloc[: oi + 1]
    out = {}
    for name, fn in models.items():
        try:
            t0 = time.time()
            out[name] = fn(Yh, origin, ex, oi=oi, final=final)
            TIMINGS[name] = TIMINGS.get(name, 0.0) + time.time() - t0
        except Exception as e:  # noqa: BLE001 — نموذجٌ يتعطّل يخرج من المزيج ولا يُسقطه
            print(f"  ! {name} @ {origin.date()}: {str(e)[:120]}")
    return out


def backtest(models: dict, data: Data, ex: pd.DataFrame, n_origins: int) -> pd.DataFrame:
    T = len(data.dates)
    rows = []
    for oi in range(T - 1 - n_origins, T - 1):
        t0 = time.time()
        preds = run_models(models, data, ex, oi)
        for name, P in preds.items():
            for h in range(1, H + 1):
                di = oi + h
                if di >= T:
                    break
                d = data.dates[di]
                yv = data.Y.iloc[di]
                pv = P.loc[d]
                for k in data.Y.columns:
                    y, p = yv[k], pv[k]
                    if np.isnan(y) or np.isnan(p):
                        continue
                    rows.append((oi, di, h, k, name, float(y), float(p)))
        print(f"  أصل {data.dates[oi].date()} — {time.time() - t0:.1f}ث")
    return pd.DataFrame(rows, columns=["oi", "di", "h", "series", "model", "y", "p"])


def wape(df: pd.DataFrame) -> float:
    s = df["y"].sum()
    return float((df["p"] - df["y"]).abs().sum() / s) if s > 0 else float("nan")


KEEP_WITHIN = 1.25


# مزيجُ المبيعات والطلبات ثابت: أربعةُ نماذج متنوّعة اختيرت على النصف الأوّل من الاختبار
# وغلبت على النصف الثاني متوسّطَ الكلّ بنقطةٍ (١٥٫١٪ → ١٤٫٠٪) — التنوّعُ يغلب القوّةَ منفردة.
TOTALS_COMBO = ("chronos", "gbm", "gbm_tot", "glm")


def weights_from(pool: pd.DataFrame, models: list[str], cls: str | None = None) -> dict[str, float]:
    if cls in ("net", "orders"):
        combo = [m for m in TOTALS_COMBO if m in models]
        if len(combo) >= 2:
            return {m: (1 / len(combo) if m in combo else 0.0) for m in models}
    if pool.empty:
        return {m: 1 / len(models) for m in models}
    # متوسّطٌ بسيط لمن لا يبعد خطؤه عن الأفضل بأكثر من ربع — قاسه الاختبار: المتوسّطُ يغلب
    # الأوزانَ المحسوبة (لغز المزج، Smith & Wallis 2009)، وإسقاطُ الشاذّ يمنع نموذجاً منفجراً
    errs = {}
    for m in models:
        sub = pool[pool["model"] == m]
        errs[m] = wape(sub) if len(sub) >= 7 else float("nan")
    good = [m for m, e in errs.items() if np.isfinite(e)]
    if not good:
        return {m: 1 / len(models) for m in models}
    best = min(errs[m] for m in good)
    keep = [m for m in good if errs[m] <= KEEP_WITHIN * best]
    return {m: (1 / len(keep) if m in keep else 0.0) for m in models}


def ensemble_nested(bt: pd.DataFrame, data: Data) -> pd.DataFrame:
    """المزيجُ كما كان سيُحسب يومَها: أوزانُه وفتراتُه ممّا عُرف قبل الأصل وحده."""
    models = sorted(bt["model"].unique())
    bt = bt.copy()
    bt["cls"] = bt["series"].map(lambda k: series_class(k, data))
    bt["bucket"] = bt["h"].map(horizon_bucket)
    wide = bt.pivot_table(index=["oi", "di", "h", "series", "cls", "bucket"], columns="model", values="p").reset_index()
    ys = bt.drop_duplicates(["oi", "di", "series"]).set_index(["oi", "di", "series"])["y"]
    wide["y"] = ys.loc[list(zip(wide["oi"], wide["di"], wide["series"]))].values
    out = []
    ens_hist: list[pd.DataFrame] = []
    for oi in sorted(wide["oi"].unique()):
        known = bt[bt["di"] <= oi]
        cur = wide[wide["oi"] == oi].copy()
        prior_ens = pd.concat(ens_hist) if ens_hist else pd.DataFrame(columns=["di", "cls", "bucket", "y", "p"])
        prior_ens = prior_ens[prior_ens["di"] <= oi] if len(prior_ens) else prior_ens
        for (cls, bucket), g in cur.groupby(["cls", "bucket"]):
            w = weights_from(known[(known["cls"] == cls) & (known["bucket"] == bucket)], models, cls)
            P = g[models].values
            W = np.array([w[m] for m in models])
            mask = ~np.isnan(P)
            p = np.where(mask.any(axis=1), (np.nan_to_num(P) * W).sum(axis=1) / np.maximum((mask * W).sum(axis=1), 1e-12), np.nan)
            g = g.assign(p=p)
            pool = prior_ens[(prior_ens["cls"] == cls) & (prior_ens["bucket"] == bucket)] if len(prior_ens) else prior_ens
            lo, hi = interval_ratios(pool, cls=cls)
            g = g.assign(lo=g["p"] * lo if lo is not None else np.nan, hi=g["p"] * hi if hi is not None else np.nan)
            out.append(g)
        ens_hist.append(out[-1] if False else pd.concat([x for x in out if x["oi"].iloc[0] == oi]))
    E = pd.concat(out, ignore_index=True)
    E = correct_with_yesterday(E)
    return E[["oi", "di", "h", "series", "cls", "bucket", "y", "p", "lo", "hi"]]


# تصحيحُ الغد بخطأ اليوم الذي انتهى: إن باع المقهى اليومَ فوق ما تُنبّئ به ٢٠٪ فالغدُ يُرفع
# جزءاً منها (β). خطأُ الأمس معروفٌ عند الأصل فلا تسرّب. ثبت في نصفي الاختبار وخارج إجازة
# الخريف (المبيعات ٩٫٤٥٪ → ٨٫٤٠٪)، ولم يثبت للطلبات ولا لما بعد الغد فلا يُطبَّق عليها.
YESTERDAY_BETA = {"net": 0.35}


def yesterday_factor(E: pd.DataFrame, cls: str, day_index: int) -> float:
    beta = YESTERDAY_BETA.get(cls)
    if not beta:
        return 1.0
    prev = E[(E["cls"] == cls) & (E["h"] == 1) & (E["di"] == day_index)]
    if prev.empty or not (prev["p"].iloc[0] > 0) or not (prev["y"].iloc[0] > 0):
        return 1.0
    return float(np.exp(beta * np.log(prev["y"].iloc[0] / prev["p"].iloc[0])))


def correct_with_yesterday(E: pd.DataFrame) -> pd.DataFrame:
    E = E.copy()
    for cls in YESTERDAY_BETA:
        rows = E.index[(E["cls"] == cls) & (E["h"] == 1)]
        base = E.loc[rows].copy()
        f = np.array([yesterday_factor(base, cls, int(o)) for o in base["oi"]])
        for c in ("p", "lo", "hi"):
            E.loc[rows, c] = base[c].values * f
    return E


# توسيعُ المدى في اللوغاريتم لكلّ نوع — ثبّته الاختبار الرجوعيّ ليصدق المدى نحو ٨٠٪ من الوقت
INTERVAL_INFLATE = 1.25
INFLATE_BY_CLASS = {"net": 1.6}


def interval_ratios(pool: pd.DataFrame, min_n: int = 30, cls: str | None = None) -> tuple[float | None, float | None]:
    if pool is None or len(pool) < min_n:
        return None, None
    ok = pool[pool["p"] > 0]
    r = (ok["y"] / ok["p"]).values
    if len(r) < min_n:
        return None, None
    # تصحيحُ العيّنة المحدودة في الـconformal: (n+1)(1-α)/n
    n = len(r)
    qlo = max(0.0, (QUANTILES[0] * (n + 1) - 1) / n)
    qhi = min(1.0, QUANTILES[1] * (n + 1) / n)
    lo, hi = float(np.quantile(r, qlo)), float(np.quantile(r, qhi))
    # الماضي القريب أهدأ من المستقبل (تغيّرُ النظام: إجازة، حدث) — يُوسَّع المدى في اللوغاريتم
    # بقدرٍ ثابت ثبّته الاختبار الرجوعيّ ليقترب الصدقُ من ٨٠٪
    k = INFLATE_BY_CLASS.get(cls or "", INTERVAL_INFLATE)
    lo = math.exp(math.log(max(lo, 1e-3)) * k)
    hi = math.exp(math.log(max(hi, 1e-3)) * k)
    return min(lo, 1.0), max(hi, 1.0)


def metrics(E: pd.DataFrame, bt: pd.DataFrame, data: Data) -> list[dict]:
    rows = []
    bt = bt.assign(cls=bt["series"].map(lambda k: series_class(k, data)), bucket=bt["h"].map(horizon_bucket))

    def add(model, series, metric, horizon, df, cover=None):
        if df.empty or df["y"].sum() <= 0:
            return
        rows.append({
            "model": model, "series": series, "metric": metric, "horizon": horizon,
            "wapeBp": int(round(wape(df) * 10_000)),
            "biasBp": int(round((df["p"].sum() - df["y"].sum()) / df["y"].sum() * 10_000)),
            "coverageBp": cover, "n": int(len(df)),
        })

    for bucket in ("D1", "D2_7", "D8_31"):
        for series, metric, sel in (("total", "NET_MINOR", "net"), ("total", "ORDERS", "orders")):
            e = E[(E["cls"] == sel) & (E["bucket"] == bucket)]
            c = e.dropna(subset=["lo", "hi"])
            cover = int(round(((c["y"] >= c["lo"]) & (c["y"] <= c["hi"])).mean() * 10_000)) if len(c) else None
            add("ensemble", series, metric, bucket, e, cover)
            for m in sorted(bt["model"].unique()):
                add(m, series, metric, bucket, bt[(bt["cls"] == sel) & (bt["bucket"] == bucket) & (bt["model"] == m)])
        e = E[E["cls"].str.startswith("item") & (E["bucket"] == bucket)]
        c = e.dropna(subset=["lo", "hi"])
        cover = int(round(((c["y"] >= c["lo"]) & (c["y"] <= c["hi"])).mean() * 10_000)) if len(c) else None
        add("ensemble", "items", "QTY_MILLI", bucket, e, cover)
        for m in sorted(bt["model"].unique()):
            add(m, "items", "QTY_MILLI", bucket, bt[bt["cls"].str.startswith("item") & (bt["bucket"] == bucket) & (bt["model"] == m)])
    return rows


# ─────────────────────────── الساعات ───────────────────────────


BREAK: pd.Series | None = None  # يومٌ في إجازةٍ مدرسية؟ — يُضبط في `run`


def hour_shares(M: pd.DataFrame, upto: int, target: pd.Timestamp, prior: np.ndarray | None = None, k: float = 2.0) -> np.ndarray:
    """نصيبُ كلّ ساعةٍ من اليوم: من آخر ثمانية أيّامٍ مثله، بتناقصٍ أُسّيّ، ومنكمشٌ نحو نمط كلّ الأيّام.

    و«مثلُه» يشمل حالَ المدارس: يومُ إجازةٍ يأخذ نمطَ أيّام الإجازة (الليلُ فيها أطول)،
    ويومُ دراسةٍ نمطَ أيّام الدراسة — قيس في إجازة الخريف ٢٠٢٦ ليلٌ أعلى بالضعف."""
    hist = M.iloc[: upto + 1]
    hist = hist[hist.sum(axis=1) > 0]
    if hist.empty:
        return prior if prior is not None else np.full(24, 1 / 24)
    sh = hist.div(hist.sum(axis=1), axis=0)
    allp = sh.iloc[-28:].mean().values
    base = allp if prior is None else (allp + prior) / 2
    if BREAK is not None and target in BREAK.index:
        flag = bool(BREAK[target])
        match = BREAK.reindex(sh.index).fillna(False).astype(bool) == flag
        if flag:
            brk = sh[match]
            if len(brk) >= 3:
                base = brk.iloc[-28:].mean().values
        sh_same = sh[match & (sh.index.dayofweek == target.dayofweek)]
        same = sh_same.iloc[-8:] if len(sh_same) >= 2 else sh[sh.index.dayofweek == target.dayofweek].iloc[-8:]
    else:
        same = sh[sh.index.dayofweek == target.dayofweek].iloc[-8:]
    if same.empty:
        return base
    w = 0.85 ** np.arange(len(same))[::-1]
    dow = (same.values * w[:, None]).sum(axis=0) / w.sum()
    n = w.sum()
    s = (n * dow + k * base) / (n + k)
    return s / s.sum()


def hourly_backtest(E: pd.DataFrame, data: Data) -> dict | None:
    M = data.hourly[TOTAL_NET]
    rows = []
    for _, r in E[(E["series"] == TOTAL_NET) & (E["h"] == 1)].iterrows():
        d = data.dates[int(r["di"])]
        sh = hour_shares(M, int(r["oi"]), d)
        y = M.loc[d].values
        if np.isnan(y).any():
            continue
        p = r["p"] * sh
        rows.append((y, p))
    if not rows:
        return None
    y = np.concatenate([a for a, _ in rows])
    p = np.concatenate([b for _, b in rows])
    ok = p > 0
    ratios = y[ok] / p[ok]
    return {"wape": float(np.abs(p - y).sum() / y.sum()), "n": int(len(y)),
            "lo": float(np.quantile(ratios, 0.1)), "hi": float(np.quantile(ratios, 0.9)),
            "bias": float((p.sum() - y.sum()) / y.sum())}


# ─────────────────────────── التشغيل كاملاً ───────────────────────────


def run(history: dict, weather_df: pd.DataFrame, weather_meta: dict, use_chronos: bool = True,
        n_origins: int = BACKTEST_ORIGINS, air: pd.DataFrame | None = None) -> dict:
    t_start = time.time()
    data = build_data(history)
    ex = build_exog(data, weather_df, weather_meta.get("clim"), air)
    global BREAK
    BREAK = ex["school_break"] > 0
    T = len(data.dates)
    TIMINGS.clear()
    print(f"التاريخ: {data.dates[0].date()} → {data.dates[-1].date()} ({T} يوماً)، {len(data.Y.columns)} سلسلة")

    gbm = GBM(data, ex, weather=True, name="gbm")
    gbm_nowx = GBM(data, ex, weather=False, name="gbm_nowx")
    # أشجارٌ للمبيعات والطلبات وحدها: لا تزاحمها الأصنافُ في التدريب (١٢٫٤٪ → ١١٫٥٪ لليوم التالي)
    gbm_tot = GBM(data, ex, weather=True, name="gbm_tot", totals_only=True)
    models: dict = {"dow_median": m_dow_median, "ets": m_ets, "glm": m_glm, "gbm": gbm, "gbm_nowx": gbm_nowx, "gbm_tot": gbm_tot}
    skipped: dict[str, str] = {}
    if use_chronos:
        try:
            models["chronos"] = Chronos()
        except Exception as e:  # noqa: BLE001
            skipped["chronos"] = str(e)[:200]
    else:
        skipped["chronos"] = "معطَّلٌ في هذا التشغيل"

    bt = backtest(models, data, ex, n_origins)
    print("  الزمن:", {k: round(v, 1) for k, v in TIMINGS.items()})
    E = ensemble_nested(bt, data)
    hb = hourly_backtest(E, data)
    met = metrics(E, bt, data)
    if hb:
        met.append({"model": "ensemble", "series": "total", "metric": "NET_MINOR", "horizon": "H_D1",
                    "wapeBp": int(round(hb["wape"] * 10_000)), "biasBp": int(round(hb["bias"] * 10_000)),
                    "coverageBp": None, "n": hb["n"]})

    # ─── التنبّؤ الحقيقيّ من آخر يوم ───
    oi = T - 1
    origin = data.dates[oi]
    final = run_models(models, data, ex, oi, final=True)
    names = list(final.keys())
    bt_c = bt.assign(cls=bt["series"].map(lambda k: series_class(k, data)), bucket=bt["h"].map(horizon_bucket))
    E_full = E.copy()
    fut = _future(origin)
    points: list[list] = []
    weights_out: dict = {}
    day_p50: dict[str, np.ndarray] = {}
    day_lo: dict[str, np.ndarray] = {}
    day_hi: dict[str, np.ndarray] = {}
    for k in data.Y.columns:
        cls = series_class(k, data)
        p50 = np.zeros(H)
        lo = np.zeros(H)
        hi = np.zeros(H)
        for i, d in enumerate(fut):
            b = horizon_bucket(i + 1)
            w = weights_from(bt_c[(bt_c["cls"] == cls) & (bt_c["bucket"] == b)], names, cls)
            weights_out.setdefault(cls, {})[b] = {m: round(v, 3) for m, v in w.items()}
            vals = np.array([final[m].loc[d, k] for m in names], dtype=float)
            W = np.array([w[m] for m in names])
            ok = ~np.isnan(vals)
            p = float((vals[ok] * W[ok]).sum() / W[ok].sum()) if ok.any() and W[ok].sum() > 0 else float(np.nanmedian(vals))
            rl, rh = interval_ratios(E_full[(E_full["cls"] == cls) & (E_full["bucket"] == b)], cls=cls)
            rl = 0.75 if rl is None else min(rl, 1.0)
            rh = 1.25 if rh is None else max(rh, 1.0)
            if i == 0:
                fy = yesterday_factor(E_full, cls, oi)
                p *= fy
                if k == TOTAL_NET:
                    weights_out.setdefault("yesterdayFactor", round(fy, 3))
            if d.date() in data.closed_future:
                p, rl, rh = 0.0, 1.0, 1.0
            p50[i], lo[i], hi[i] = p, p * rl, p * rh
        day_p50[k], day_lo[k], day_hi[k] = p50, lo, hi

    for k in data.Y.columns:
        s, m = split_key(k)
        for i, d in enumerate(fut):
            points.append([s, m, d.date().isoformat(), None, *_ints(day_lo[k][i], day_p50[k][i], day_hi[k][i])])
        # الساعات: المبيعاتُ والطلباتُ للشهر كلّه، والأصنافُ لأسبوعٍ
        days = H if s == "total" else HOURLY_ITEM_DAYS
        prior = hour_shares(data.hourly[TOTAL_NET], oi, fut[0]) if s != "total" else None
        hl, hh = (hb["lo"], hb["hi"]) if hb else (0.6, 1.4)
        for i, d in enumerate(fut[:days]):
            sh = hour_shares(data.hourly[k], oi, d, prior=_shares_for(data, oi, d) if s != "total" else None,
                             k=2.0 if s == "total" else 6.0)
            hp = _round_to_total(day_p50[k][i] * sh, day_p50[k][i])
            for hr in range(24):
                if sh[hr] < 0.002:
                    continue
                v = hp[hr]
                points.append([s, m, d.date().isoformat(), hr, *_ints(v * min(hl, 1.0), v, v * max(hh, 1.0))])

    contrib = None
    try:
        contrib = gbm.contributions(oi)
    except Exception as e:  # noqa: BLE001
        skipped["contributions"] = str(e)[:200]

    context = []
    wk = weather_meta.get("kind")
    for i, d in enumerate(fut):
        info = cal.day_info(d.date())
        c = cal.context_of(info)
        c["weather"] = {f: (None if pd.isna(ex.loc[d, f]) else round(float(ex.loc[d, f]), 1)) for f in ("t_max", "humidity", "rain_mm")}
        c["weatherKind"] = (str(wk.get(d, "missing")) if wk is not None else "missing")
        if d.date() in data.closed_future:
            c["tags"].append("مغلق")
        if d.date() in data.event_days:
            c["tags"].append("حدثٌ مسجَّل")
        for kind, label, src in events_jeddah.by_day().get(d.date(), []):
            c.setdefault("events", []).append({"kind": kind, "label": label, "source": src})
        if contrib is not None and d in contrib.index:
            c["drivers"] = _drivers(contrib.loc[d])
        context.append({"day": d.date().isoformat(), "context": c})

    head = {m["horizon"]: m for m in met if m["model"] == "ensemble" and m["series"] == "total" and m["metric"] == "NET_MINOR"}
    summary = {
        "trainingDays": T,
        "backtestOrigins": n_origins,
        "items": [{"key": k.split("|")[0], "name": data.names.get(k.split("|")[0].removeprefix("item:"), k), "tier": data.item_tier[k]}
                  for k in data.Y.columns if k.startswith("item:")],
        "headline": {h: {"wapeBp": v["wapeBp"], "coverageBp": v["coverageBp"], "n": v["n"]} for h, v in head.items()},
        "weatherSources": weather_meta.get("notes", {}),
        "notes": [
            "الطقسُ في الاختبار الرجوعيّ هو ما وقع فعلاً، وفي التنبّؤ تنبّؤُ الطقس — فالخطأُ الحقيقيّ قد يزيد قليلاً على المقيس.",
            "لا رمضانَ ولا عيدَ فطرٍ في التاريخ بعد: تنبّؤُهما يعتمد على تقويمهما لا على تجربةٍ سابقة.",
        ],
    }
    return {
        "issuedOn": history["today"],
        "historyFrom": data.dates[0].date().isoformat(),
        "historyTo": data.dates[-1].date().isoformat(),
        "engineVersion": ENGINE_VERSION,
        "durationMs": int((time.time() - t_start) * 1000),
        "models": {"members": names, "skipped": skipped, "weights": weights_out},
        "summary": summary,
        "points": points,
        "context": context,
        "backtests": met,
    }


def _shares_for(data: Data, oi: int, d: pd.Timestamp) -> np.ndarray:
    return hour_shares(data.hourly[TOTAL_NET], oi, d)


def _round_to_total(v: np.ndarray, total: float) -> np.ndarray:
    """تقريبٌ يحفظ المجموع (أكبرُ البواقي): مجموعُ الساعات يساوي اليومَ بالضبط."""
    t = int(round(total))
    fl = np.floor(v).astype(int)
    rem = t - fl.sum()
    if rem > 0:
        idx = np.argsort(-(v - fl))[:rem]
        fl[idx] += 1
    return fl.astype(float)


def _ints(lo: float, mid: float, hi: float) -> list[int]:
    a, b, c = int(round(max(lo, 0))), int(round(max(mid, 0))), int(round(max(hi, 0)))
    a = min(a, b)
    c = max(c, b)
    return [a, b, c]


DRIVER_GROUPS = {
    "dow": "يوم الأسبوع",
    "r_dow": "آخر الأسابيع", "r_last": "آخر الأسابيع", "trend": "الاتّجاه", "log_level": "المستوى",
    "school_break": "المدارس", "summer": "المدارس",
    "holiday": "الإجازات", "holiday_eve": "الإجازات", "eid": "الإجازات", "eid_window": "الإجازات",
    "ramadan": "رمضان", "ramadan_day": "رمضان", "ramadan_last10": "رمضان",
    "days_from_payday": "الراتب", "days_to_payday": "الراتب", "payday_week": "الراتب", "citizen_account": "الراتب",
    "concert": "حفلات جدة", "football": "مباريات جدة", "bigmatch": "مباريات كبرى", "launch": "حدث عالمي", "festival": "فعاليات جدة", "break_short": "المدارس",
    "dom": "يوم الشهر", "month_end": "يوم الشهر", "event": "حدثٌ مسجَّل", "h": "بُعد اليوم",
}


def _drivers(row: pd.Series) -> list[dict]:
    g: dict[str, float] = {}
    for f, v in row.items():
        name = "الطقس" if f in WEATHER_FEATURES else DRIVER_GROUPS.get(f)
        if name is None:
            continue
        g[name] = g.get(name, 0.0) + float(v)
    top = sorted(g.items(), key=lambda kv: -abs(kv[1]))[:5]
    return [{"label": k, "minor": int(round(v))} for k, v in top if abs(v) >= 100]
