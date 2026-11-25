"""التشغيلُ الليليّ: يقرأ التاريخ من التطبيق، ويتنبّأ، ويرسل النتيجة إليه.

  python -m tph_forecast.cli --url https://tph-invoicing.vercel.app   (بسرّ CRON_SECRET)
  python -m tph_forecast.cli --history-file h.json --out r.json      (محلّيّاً، بلا إرسال)

لا يملك المحرّكُ اتّصالاً بالقاعدة: يقرأ ويكتب عبر `/api/cron/forecast` وحده، والتطبيقُ
لا يكتب ما يرسله إلّا في جداول `forecast_*`.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from datetime import date, timedelta

import requests

from . import engine
from .weather import empty_weather, load_air, load_weather


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="أصلُ التطبيق — يقرأ ويرسل")
    ap.add_argument("--history-file")
    ap.add_argument("--out")
    ap.add_argument("--no-chronos", action="store_true")
    ap.add_argument("--no-weather", action="store_true")
    ap.add_argument("--origins", type=int, default=engine.BACKTEST_ORIGINS)
    a = ap.parse_args()

    secret = os.environ.get("CRON_SECRET", "")
    headers = {"Authorization": f"Bearer {secret}"}
    if a.history_file:
        history = json.load(open(a.history_file))
    elif a.url:
        if not secret:
            print("::error::CRON_SECRET غير موجود", file=sys.stderr)
            return 1
        r = requests.get(f"{a.url}/api/cron/forecast", headers=headers, timeout=120)
        r.raise_for_status()
        history = r.json()["history"]
    else:
        ap.error("--url أو --history-file")

    start = engine.TRAIN_START
    end = date.fromisoformat(history["today"]) + timedelta(days=engine.H + 1)
    if a.no_weather:
        wx, meta = empty_weather(start, end), {"notes": {"disabled": True}}
    else:
        wx, meta = load_weather(start, end)
    air, air_meta = (None, {"disabled": True}) if a.no_weather else load_air(start, end)
    meta.setdefault("notes", {})["air"] = air_meta

    result = engine.run(history, wx, meta, use_chronos=not a.no_chronos, n_origins=a.origins, air=air)
    body = json.dumps(result, ensure_ascii=False)
    if a.out:
        open(a.out, "w").write(body)
    head = result["summary"]["headline"]
    print("الدقّة (المزيج، المبيعات):", {h: f"{v['wapeBp'] / 100:.1f}٪" for h, v in head.items()})
    if a.url and not a.history_file:
        r = requests.post(f"{a.url}/api/cron/forecast", data=gzip.compress(body.encode()),
                          headers={**headers, "Content-Type": "application/json", "Content-Encoding": "gzip"}, timeout=280)
        print(r.status_code, r.text[:500])
        return 0 if r.ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
