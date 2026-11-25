"use client";

import { useState } from "react";
import { Flame } from "lucide-react";
import { Money } from "./money";
import { T } from "@/components/i18n/t";
import { formatRiyalsDisplay } from "@/lib/money";
import { ORDER, countNoun } from "@/lib/arabic";
import { HEAT_LEVELS, hourLabel, type HeatmapView } from "@/lib/finance/sales-heatmap";

/**
 * خريطةُ الأسبوع — صفٌّ لكلّ يوم، وعمودٌ لكلّ ساعة، ولونُ الخليّة متوسّطُ ما يُباع فيها.
 * لونٌ واحد يشتدّ (الزيتون)، والصفرُ خليّةٌ فارغة. والرقمُ لا يُقرأ من اللون وحده: سطرُ
 * الرأس يقول رقمَ الخليّة التي تُلمس أو يُمرَّر عليها أو تُبلَغ بلوحة المفاتيح — والجوّالُ
 * لا تلميحَ فيه (`title`)، فالتلميحُ وحده كان يترك صاحبَ الهاتف أمام ألوانٍ بلا أرقام.
 */

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** شدّةُ الزيتون لكلّ درجة — من الفاتح إلى الكامل. */
const MIX = [0, 16, 32, 52, 74, 100];

function cellStyle(level: number) {
  if (level === 0) return undefined;
  return { background: `color-mix(in oklab, var(--accent) ${MIX[Math.min(level, HEAT_LEVELS)]}%, var(--sunken))` };
}

export function SalesHeatmap({ view }: { view: HeatmapView }) {
  if (view.rows.length === 0 || view.peak === null) return null;
  return <Heatmap view={view} peak={view.peak} />;
}

function Heatmap({ view, peak }: { view: HeatmapView; peak: NonNullable<HeatmapView["peak"]> }) {
  const [picked, setPicked] = useState<{ weekday: number; hour: number } | null>(null);
  const cols = view.hours.length;
  const pickedCell = picked
    ? view.rows.find((r) => r.weekday === picked.weekday)?.cells.find((c) => c.hour === picked.hour) ?? null
    : null;

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
      <p className="mb-3 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-live="polite">
        <Flame className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
        {picked && pickedCell && !(picked.weekday === peak.weekday && picked.hour === peak.hour) ? (
          <>
            <span className="font-bold"><T s="{0} الساعة {1}" a={[WEEKDAYS[picked.weekday], hourLabel(picked.hour)]} /></span>
            <span className="text-muted">
              {pickedCell.avgMinor > 0
                ? <T s="بمتوسّط {0}، ونحو {1}." a={[<Money key="0" minor={pickedCell.avgMinor} />, countNoun(Math.max(1, Math.round(pickedCell.avgOrders)), ORDER)]} />
                : "لا بيع في هذه الساعة."}
            </span>
          </>
        ) : (
          <>
            <span className="font-bold">
              <T s="أزحمُ ساعة: {0} الساعة {1}" a={[WEEKDAYS[peak.weekday], hourLabel(peak.hour)]} />
            </span>
            <span className="text-muted">
              <T s="بمتوسّط {0} في تلك الساعة وحدها." a={[<Money key="0" minor={peak.avgMinor} />]} />
            </span>
          </>
        )}
      </p>

      {/* تتّسع للجوّال كاملةً (٢١ ساعة × ١٣ بكسل)؛ والتمريرُ احتياطٌ لشاشةٍ أضيق، والصفحةُ لا تتمرّر */}
      <div className="relative -mx-1 overflow-x-auto px-1 py-1" onMouseLeave={() => setPicked(null)}>
        <div
          role="table"
          aria-label="متوسّط المبيعات لكلّ ساعة من كلّ يوم"
          className="grid min-w-[19rem] gap-[2px] sm:gap-[3px]"
          style={{ gridTemplateColumns: `3.25rem repeat(${cols}, minmax(0, 1fr))` }}
        >
          <div role="row" className="contents">
            <span role="columnheader" />
            {view.hours.map((h, i) => (
              <span key={h} role="columnheader" className="relative text-center text-[9px] leading-4 text-muted">
                {i % 2 === 0 ? hourLabel(h) : ""}
                <span className="sr-only">{i % 2 === 0 ? "" : hourLabel(h)}</span>
              </span>
            ))}
          </div>
          {view.rows.map((r) => (
            <div key={r.weekday} role="row" className="contents">
              <span role="rowheader" className="flex items-center text-[11px] font-medium text-ink-soft">{WEEKDAYS[r.weekday]}</span>
              {r.cells.map((c) => {
                const label = c.avgMinor > 0
                  ? `${WEEKDAYS[r.weekday]} ${hourLabel(c.hour)}: ${formatRiyalsDisplay(c.avgMinor)} ريال في المتوسّط، نحو ${countNoun(Math.max(1, Math.round(c.avgOrders)), ORDER)}`
                  : `${WEEKDAYS[r.weekday]} ${hourLabel(c.hour)}: لا بيع`;
                const isPeak = r.weekday === peak.weekday && c.hour === peak.hour;
                const isPicked = picked?.weekday === r.weekday && picked.hour === c.hour;
                return (
                  <span key={c.hour} role="cell" className="relative">
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={isPicked}
                      onClick={() => setPicked({ weekday: r.weekday, hour: c.hour })}
                      onMouseEnter={() => setPicked({ weekday: r.weekday, hour: c.hour })}
                      onFocus={() => setPicked({ weekday: r.weekday, hour: c.hour })}
                      className={`block h-6 w-full rounded-[4px] transition-transform duration-150 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:scale-100 sm:h-7 sm:rounded-[5px] ${c.level === 0 ? "bg-sunken/60" : ""} ${isPeak || isPicked ? "ring-2 ring-accent ring-offset-1 ring-offset-raised" : ""}`}
                      style={cellStyle(c.level)}
                    />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>متوسّطُ اليوم الواحد من ذلك اليوم، لا مجموعُ الشهر. المس الخليّة أو مرِّر عليها لترى رقمها.</span>
        <span className="flex items-center gap-1" aria-hidden>
          أقلّ
          {MIX.slice(1).map((_, i) => (
            <span key={i} className="h-3 w-4 rounded-[3px]" style={cellStyle(i + 1)} />
          ))}
          أكثر
        </span>
      </div>
    </div>
  );
}
