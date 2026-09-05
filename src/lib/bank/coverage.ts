/**
 * تغطية الفترات.
 *
 * «استوردتُ الملفّ» ليست «غطّيتُ الشهر». وكان النظام يعرف أنّ الحركة
 * مكرّرة، ولا يعرف أنّ بين آخر كشفٍ وهذا **فجوةَ أسبوع** لم تُستورَد
 * أصلاً — فتغيب حركاتها ولا يشكو أحد، لأنّ الغائب لا يُرى.
 *
 * ودوالّ خالصة: تأخذ فترات وتُرجع تداخلها وفجواتها.
 */

export interface Period {
  start: string;
  end: string;
  label?: string;
}

export interface Gap {
  start: string;
  end: string;
  days: number;
}

export interface Overlap {
  a: Period;
  b: Period;
  start: string;
  end: string;
  days: number;
}

export interface Coverage {
  /** أوّل يومٍ مغطّى وآخره. */
  from: string | null;
  to: string | null;
  gaps: Gap[];
  overlaps: Overlap[];
  /** عدد الأيام المغطّاة فعلاً. */
  coveredDays: number;
}

const DAY = 86_400_000;

function toTime(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function toIso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((toTime(b) - toTime(a)) / DAY) + 1;
}

/**
 * يحسب التغطية من فتراتٍ قد تتداخل.
 *
 * والفجوة تُحسب بيوم كامل: كشفٌ ينتهي في ٣١ وآخر يبدأ في ١ ليس بينهما
 * فجوة، وإن اختلف رقماهما.
 */
export function analyzeCoverage(periods: readonly Period[]): Coverage {
  const valid = periods.filter((p) => p.start <= p.end);
  if (valid.length === 0) {
    return { from: null, to: null, gaps: [], overlaps: [], coveredDays: 0 };
  }

  const sorted = [...valid].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  const overlaps: Overlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const start = sorted[i].start > sorted[j].start ? sorted[i].start : sorted[j].start;
      const end = sorted[i].end < sorted[j].end ? sorted[i].end : sorted[j].end;
      if (start > end) continue;
      overlaps.push({ a: sorted[i], b: sorted[j], start, end, days: daysBetween(start, end) });
    }
  }

  /* دمج الفترات المتّصلة كي تُقاس الفجوات بينها لا داخلها */
  const merged: { start: string; end: string }[] = [];
  for (const p of sorted) {
    const last = merged[merged.length - 1];
    if (last && toTime(p.start) <= toTime(last.end) + DAY) {
      if (p.end > last.end) last.end = p.end;
    } else {
      merged.push({ start: p.start, end: p.end });
    }
  }

  const gaps: Gap[] = [];
  for (let i = 1; i < merged.length; i++) {
    const gapStart = toIso(toTime(merged[i - 1].end) + DAY);
    const gapEnd = toIso(toTime(merged[i].start) - DAY);
    if (toTime(gapStart) > toTime(gapEnd)) continue;
    gaps.push({ start: gapStart, end: gapEnd, days: daysBetween(gapStart, gapEnd) });
  }

  const coveredDays = merged.reduce((s, m) => s + daysBetween(m.start, m.end), 0);

  return {
    from: merged[0].start,
    to: merged[merged.length - 1].end,
    gaps,
    overlaps,
    coveredDays,
  };
}

/**
 * جملةٌ تصف حال التغطية.
 *
 * الفجوة تُذكر أوّلاً: التداخل يُصلحه منع التكرار، أمّا الفجوة فلا
 * يُصلحها شيء إلّا أن يُرفَع كشفها.
 */
export function describeCoverage(c: Coverage): string {
  if (c.from === null) return "لم يُستورَد شيء بعد.";

  const span = `من ${c.from} إلى ${c.to}`;
  if (c.gaps.length === 0 && c.overlaps.length === 0) return `${span} — متّصلة بلا فجوة.`;

  const parts: string[] = [span];
  if (c.gaps.length > 0) {
    const worst = [...c.gaps].sort((a, b) => b.days - a.days)[0];
    parts.push(
      c.gaps.length === 1
        ? `وفيها فجوة من ${worst.start} إلى ${worst.end} (${worst.days} يوماً) لم تُستورَد`
        : `وفيها ${c.gaps.length} فجوات، أطولها ${worst.days} يوماً من ${worst.start}`,
    );
  }
  if (c.overlaps.length > 0) {
    parts.push(`و${c.overlaps.length} تداخلاً بين كشوف — لا يضرّ، فالحركة المكرّرة تُرفَض`);
  }
  return `${parts.join("، ")}.`;
}
