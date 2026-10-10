"use client";

import { dateShortcuts, formatHijri } from "@/lib/riyadh-time";

/**
 * اختصاراتٌ تحت حقل التاريخ — «اليوم · أمس · آخر الشهر الماضي» تملؤه بضغطة،
 * ومعها مقابلُ التاريخ المختار بتقويم أمّ القرى (للقراءة وحدها).
 *
 * الحقلُ الأصليّ `type="date"` يبقى كما هو — هذه إضافةٌ بجانبه لا بديلٌ عنه.
 * و`max` يُسقط ما بعده: حقلٌ لا يقبل المستقبل لا يُعرَض له اختصارٌ يردّه.
 */
export function DateChips({
  value,
  onPick,
  disabled = false,
  max,
  hijri = true,
}: {
  value: string;
  onPick: (day: string) => void;
  disabled?: boolean;
  /** YYYY-MM-DD — ما بعده لا يُعرَض. */
  max?: string;
  hijri?: boolean;
}) {
  const chips = dateShortcuts().filter((c) => !max || c.value <= max);
  const inHijri = hijri ? formatHijri(value) : null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          disabled={disabled}
          aria-pressed={value === c.value}
          onClick={() => onPick(c.value)}
          className={`min-h-8 rounded-full border px-2.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
            value === c.value ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-raised text-ink-soft hover:bg-hover"
          }`}
        >
          {c.label}
        </button>
      ))}
      {inHijri && <span className="text-[11px] font-normal text-muted">{inHijri}</span>}
    </span>
  );
}
