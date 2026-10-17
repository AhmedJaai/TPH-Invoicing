import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Money } from "./money";
import { LinkTabs } from "./ui";
import { formatShare } from "@/lib/finance/format";
import { formatMonth } from "@/lib/riyadh-time";

/** ألسنةُ الأشهر — الأحدثُ أوّلاً. */
export function MonthTabs({ base, months, active, extra = "" }: { base: string; months: readonly string[]; active: string; extra?: string }) {
  return (
    <LinkTabs
      label="الشهر"
      items={months.map((m) => ({ href: `${base}?month=${m}${extra}`, label: formatMonth(m), active: m === active }))}
    />
  );
}

/** «غير معروف» وسببُه — لا صفر. */
export function Unknown({ why, className = "" }: { why?: string; className?: string }) {
  return (
    <span className={`text-[11px] text-muted ${className}`}>
      <span className="inline-flex items-center gap-1 font-bold text-ink-soft">
        <CircleHelp className="h-3 w-3" strokeWidth={2} aria-hidden />
        غير معروف
      </span>
      {why && <span className="block max-w-[22rem]">{why}</span>}
    </span>
  );
}

/** مبلغٌ أو «غير معروف». */
export function MaybeMoney({ minor, signed = false, why }: { minor: number | null; signed?: boolean; why?: string }) {
  return minor === null ? <Unknown why={why} /> : <Money minor={minor} signed={signed} />;
}

export interface TrendMonth {
  month: string;
  revenueMinor: number | null;
  costsMinor: number | null;
  profitMinor: number | null;
  /** اسمُ الرقم الثالث — «صافي الربح» أو «الربح قبل الإيجار». */
  profitLabel: string;
  complete: boolean;
  marginBp: number | null;
  note: string | null;
}

/**
 * الأشهرُ جنباً إلى جنب: الإيراد، وما خرج (تكلفةٌ ومصروفات)، وما بقي — على محورٍ واحد،
 * والقيمُ مكتوبةٌ بجانب أشرطتها. والشهرُ الناقص شريطُ ربحه مخطَّط واسمُه بجانبه: لا يُقرأ
 * «قبل الإيجار» كما يُقرأ «صافٍ». والألوانُ من هويّة النظام لا من ألوان الحكم.
 */
export function ProfitTrend({ months, active, hrefOf }: { months: readonly TrendMonth[]; active: string | null; hrefOf: (month: string) => string }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.revenueMinor ?? 0, m.costsMinor ?? 0, Math.abs(m.profitMinor ?? 0)]));
  const width = (v: number | null) => (v === null ? "0%" : `${Math.max(v !== 0 ? 1.5 : 0, (Math.abs(v) / max) * 100)}%`);
  const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--raised)_3px_5px)]";
  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-ink-soft">
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-accent" /> الإيراد</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-sand" /> التكلفة والمصروفات</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-plum" /> الربح</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-2.5 rounded-sm bg-plum ${HATCH}`} /> ربح ناقص (ينقصه عنصر)</span>
      </div>
      <ol className="space-y-1">
        {months.map((m) => {
          const on = active === m.month;
          return (
            <li key={m.month}>
              <Link
                href={hrefOf(m.month)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={`grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2.5 transition-colors hover:bg-hover sm:grid-cols-[7rem_minmax(0,1fr)] ${on ? "bg-accent-soft/60 ring-1 ring-accent-line" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold">{formatMonth(m.month)}</span>
                  {m.note && <span className="block text-[10px] font-bold text-warn">{m.note}</span>}
                </span>
                <span className="min-w-0 space-y-1.5">
                  <TrendBar tone="bg-accent" width={width(m.revenueMinor)} label="الإيراد" minor={m.revenueMinor} />
                  <TrendBar tone="bg-sand" width={width(m.costsMinor)} label="التكلفة والمصروفات" minor={m.costsMinor} />
                  <TrendBar
                    tone={`bg-plum ${m.complete ? "" : HATCH}`}
                    width={width(m.profitMinor)}
                    label={m.profitLabel}
                    minor={m.profitMinor}
                    suffix={m.marginBp !== null ? formatShare(m.marginBp) : undefined}
                    showLabel
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TrendBar({ tone, width, label, minor, suffix, showLabel = false }: { tone: string; width: string; label: string; minor: number | null; suffix?: string; showLabel?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
        <span aria-hidden className={`block h-full rounded-full ${tone}`} style={{ width }} />
      </span>
      <span className="w-[9.5rem] shrink-0 text-end text-[11px] leading-tight sm:w-[13rem]">
        <span className="sr-only">{label}: </span>
        {minor === null ? <span className="text-muted">غير معروف</span> : <span className="font-bold"><Money minor={minor} signed /></span>}
        {suffix && <span className="ms-1 text-muted">{suffix}</span>}
        {showLabel && <span className="block truncate text-[10px] text-muted">{label}</span>}
      </span>
    </span>
  );
}
