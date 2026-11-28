"use client";

import { useState } from "react";
import { Money } from "./money";
import { formatDay } from "@/lib/riyadh-time";
import { formatRiyalsDisplay } from "@/lib/money";

export interface PricePoint {
  /** YYYY-MM-DD */
  day: string;
  unitMinor: number;
  invoiceNumber: string | null;
}

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * سعرُ الوحدة عبر الزمن لصنفٍ واحد — لونٌ واحد، خطٌّ رفيع، والمسافةُ بين النقاط
 * بالأيّام لا بالترتيب (فشهران بلا شراء يُريان فجوةً لا خطوةً). الضغطُ أو المرورُ
 * على نقطةٍ يقول سعرَها ويومها وفاتورتها، والجدولُ تحت الرسم يقول ما يقوله كلَّه.
 * و`since` أوّلُ فاتورةٍ بالسعر الجديد — تُعلَّم لأنّها جوابُ «متى تغيّر؟».
 */
export function PriceHistoryChart({ points, since, label }: { points: readonly PricePoint[]; since: string | null; label: string }) {
  const [active, setActive] = useState<number>(points.length - 1);
  if (points.length < 2) return null;

  const xs = points.map((p) => dayNum(p.day));
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const xSpan = x1 - x0 || 1;
  const prices = points.map((p) => p.unitMinor);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  /* هامشٌ فوق وتحت كي لا يلتصق الخطّ بالحافّة، والسعرُ الثابت خطٌّ في الوسط */
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.05);
  const yLo = lo - pad, yHi = hi + pad;
  const xPct = (i: number) => ((xs[i] - x0) / xSpan) * 100;
  const yPct = (v: number) => 100 - ((v - yLo) / (yHi - yLo)) * 100;

  /* خطُّ خطواتٍ: السعرُ يبقى حتى الفاتورة التالية — لا ميلٌ يوحي بغلاءٍ تدريجيّ */
  let d = "";
  points.forEach((p, i) => {
    const x = xPct(i), y = yPct(p.unitMinor);
    if (i === 0) d += `M${x.toFixed(2)},${y.toFixed(2)}`;
    else d += ` H${x.toFixed(2)} V${y.toFixed(2)}`;
  });
  const sinceIdx = since === null ? -1 : points.findIndex((p) => p.day === since);
  const cur = points[Math.min(active, points.length - 1)];

  return (
    <figure className="min-w-0" aria-label={label}>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] text-muted" aria-live="polite">
        <span>
          <span className="font-bold text-ink"><Money minor={cur.unitMinor} /></span>
          {" · "}{formatDay(cur.day)}
          {cur.invoiceNumber && <> · <bdi className="font-mono">{cur.invoiceNumber}</bdi></>}
        </span>
        <span className="nums">
          <Money minor={lo} /> – <Money minor={hi} />
        </span>
      </figcaption>
      <div className="relative h-24 rounded-lg border border-line-soft bg-sunken/40" dir="ltr">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-accent" aria-hidden>
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <line x1={xPct(active)} x2={xPct(active)} y1="0" y2="100" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <button
            key={`${p.day}-${i}`}
            type="button"
            onPointerEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
            aria-label={`${formatDay(p.day)}: ${formatRiyalsDisplay(p.unitMinor)}`}
            aria-pressed={i === active}
            /* هدفُ اللمس ٤٤ والنقطةُ داخله ٨ */
            className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ left: `${xPct(i)}%`, top: `${yPct(p.unitMinor)}%` }}
          >
            <span
              className={`block rounded-full border-2 ${i === sinceIdx ? "h-3.5 w-3.5 border-accent bg-raised" : i === active ? "h-3 w-3 border-raised bg-accent" : "h-2 w-2 border-raised bg-accent"}`}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted" dir="ltr">
        <span>{formatDay(points[0].day)}</span>
        <span>{formatDay(points[points.length - 1].day)}</span>
      </div>
    </figure>
  );
}
